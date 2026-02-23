const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { spawn } = require('child_process');
const { isValidSessionId } = require('../utils/helpers');
const processManager = require('../utils/processManager');
const config = require('../config');

class UploadController {
  constructor() {
    this.SESSION_DIR = process.env.SESSION_DIR || path.join(os.homedir(), '.copilot', 'session-state');
    this.uploadDir = path.join(os.tmpdir(), 'copilot-session-uploads');

    // Multi-format session directories
    this.SESSION_DIRS = {
      copilot: this.SESSION_DIR,
      claude: path.join(os.homedir(), '.claude', 'projects'),
      'pi-mono': path.join(os.homedir(), '.pi', 'agent', 'sessions')
    };

    // Don't create uploadDir here - multer's DiskStorage will handle it
    // This avoids EEXIST errors when multiple tests run in parallel
    this.upload = this.createMulterInstance();
  }

  createMulterInstance() {
    return multer({
      dest: this.uploadDir,
      limits: { fileSize: config.MAX_UPLOAD_SIZE },
      fileFilter: (req, file, cb) => {
        // Check both file extension and MIME type
        const isZipExtension = file.originalname.toLowerCase().endsWith('.zip');
        const isZipMime = file.mimetype === 'application/zip' ||
                          file.mimetype === 'application/x-zip-compressed';

        if (!isZipExtension || !isZipMime) {
          return cb(new Error('Only .zip files are allowed'));
        }
        cb(null, true);
      }
    });
  }

  // Share session (export as zip)
  async shareSession(req, res) {
    try {
      const sessionId = req.params.id;

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const sessionPath = path.join(this.SESSION_DIR, sessionId);

      try {
        await fs.promises.access(sessionPath);
      } catch (_err) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const zipFile = path.join(os.tmpdir(), `session-${sessionId}.zip`);

      const zipProcess = spawn('zip', ['-r', '-q', zipFile, sessionId], {
        cwd: this.SESSION_DIR
      });

      processManager.register(zipProcess, { name: `zip-${sessionId}` });

      zipProcess.on('close', (code) => {
        if (code !== 0) {
          return res.status(500).json({ error: 'Failed to create zip file' });
        }

        res.download(zipFile, `session-${sessionId}.zip`, (err) => {
          fs.promises.unlink(zipFile).catch(() => {});
          if (err) {
            console.error('Error sending zip:', err);
          }
        });
      });

      zipProcess.on('error', (err) => {
        console.error('Error creating zip:', err);
        res.status(500).json({ error: 'Failed to create zip file' });
      });
    } catch (err) {
      console.error('Error sharing session:', err);
      res.status(500).json({ error: 'Error sharing session' });
    }
  }

  // Import session from zip (with validation)
  async importSession(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const zipPath = req.file.path;
      const extractDir = path.join(this.uploadDir, `extract-${Date.now()}`);

      await fs.promises.mkdir(extractDir, { recursive: true });

      // ZIP bomb protection: Check compressed file size first
      const MAX_COMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB (already enforced by multer)
      const MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024; // 200MB
      const MAX_FILE_COUNT = 1000; // Maximum number of files
      const MAX_DEPTH = 5; // Maximum directory nesting depth

      const stats = await fs.promises.stat(zipPath);
      if (stats.size > MAX_COMPRESSED_SIZE) {
        await fs.promises.unlink(zipPath);
        return res.status(400).json({ error: 'Compressed file too large (max 50MB)' });
      }

      // First pass: List zip contents without extracting to check for bombs
      const listProcess = spawn('unzip', ['-l', zipPath]);
      let listOutput = '';
      
      listProcess.stdout.on('data', (data) => {
        listOutput += data.toString();
      });

      await new Promise((resolve, reject) => {
        listProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error('Failed to list zip contents'));
          } else {
            resolve();
          }
        });
        listProcess.on('error', reject);
      });

      // Parse unzip output to check total size and file count
      const lines = listOutput.split('\n');
      let totalUncompressedSize = 0;
      let fileCount = 0;
      let maxDepth = 0;

      for (const line of lines) {
        const match = line.trim().match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
        if (match) {
          const size = parseInt(match[1]);
          const filename = match[2];
          totalUncompressedSize += size;
          fileCount++;

          // Check directory depth
          const depth = (filename.match(/\//g) || []).length;
          maxDepth = Math.max(maxDepth, depth);
        }
      }

      // Validate against ZIP bomb thresholds
      if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        await fs.promises.unlink(zipPath);
        return res.status(400).json({ 
          error: `Uncompressed size too large (${Math.round(totalUncompressedSize / 1024 / 1024)}MB > ${MAX_UNCOMPRESSED_SIZE / 1024 / 1024}MB)` 
        });
      }

      if (fileCount > MAX_FILE_COUNT) {
        await fs.promises.unlink(zipPath);
        return res.status(400).json({ 
          error: `Too many files in archive (${fileCount} > ${MAX_FILE_COUNT})` 
        });
      }

      if (maxDepth > MAX_DEPTH) {
        await fs.promises.unlink(zipPath);
        return res.status(400).json({ 
          error: `Directory nesting too deep (${maxDepth} > ${MAX_DEPTH})` 
        });
      }

      // If all checks pass, proceed with extraction
      const unzipProcess = spawn('unzip', ['-q', zipPath, '-d', extractDir]);

      processManager.register(unzipProcess, { name: 'unzip-import' });

      unzipProcess.on('close', async (code) => {
        try {
          await fs.promises.unlink(zipPath);

          if (code !== 0) {
            await fs.promises.rm(extractDir, { recursive: true, force: true });
            return res.status(500).json({ error: 'Failed to extract zip file' });
          }

          const entries = await fs.promises.readdir(extractDir);
          if (entries.length === 0) {
            await fs.promises.rm(extractDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'Empty zip file' });
          }

          const sessionDirName = entries[0];

          // Validate session directory name to prevent Zip Slip path traversal
          if (!isValidSessionId(sessionDirName)) {
            await fs.promises.rm(extractDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'Invalid session directory name in zip file' });
          }

          const sessionPath = path.join(extractDir, sessionDirName);
          const targetPath = path.join(this.SESSION_DIR, sessionDirName);

          const eventsFile = path.join(sessionPath, 'events.jsonl');
          try {
            await fs.promises.access(eventsFile);
          } catch (_err) {
            await fs.promises.rm(extractDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'Invalid session structure (no events.jsonl)' });
          }

          if (fs.existsSync(targetPath)) {
            await fs.promises.rm(extractDir, { recursive: true, force: true });
            return res.status(409).json({ error: 'Session already exists' });
          }

          await fs.promises.rename(sessionPath, targetPath);
          await fs.promises.rm(extractDir, { recursive: true, force: true });

          res.json({ success: true, sessionId: sessionDirName });
        } catch (err) {
          console.error('Error importing session:', err);
          await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
          res.status(500).json({ error: 'Error importing session' });
        }
      });

      unzipProcess.on('error', async (err) => {
        console.error('Error extracting zip:', err);
        await fs.promises.unlink(zipPath).catch(() => {});
        await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
        res.status(500).json({ error: 'Failed to extract zip file' });
      });
    } catch (err) {
      console.error('Error processing upload:', err);
      if (req.file) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      res.status(500).json({ error: 'Error processing upload' });
    }
  }

  // Multer middleware accessor
  getUploadMiddleware() {
    return this.upload.single('zipFile');
  }

  /**
   * Detect the format of a session from extracted directory
   * @param {string} extractDir - Directory containing extracted session files
   * @returns {Promise<Object|null>} Format information or null if unknown
   */
  async _detectFormat(extractDir) {
    try {
      const entries = await fs.promises.readdir(extractDir);

      if (entries.length === 0) {
        return null;
      }

      // Check for Pi-Mono format: timestamped filename pattern YYYY-MM-DDTHH-MM-SS-SSSZ_sessionId.jsonl
      const piMonoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_([a-zA-Z0-9_-]+)\.jsonl$/;
      for (const entry of entries) {
        const match = entry.match(piMonoPattern);
        if (match) {
          return {
            format: 'pi-mono',
            sessionId: match[1],
            fileName: entry,
            extractDir
          };
        }
      }

      // Check for Copilot format: directory with events.jsonl
      for (const entry of entries) {
        const entryPath = path.join(extractDir, entry);
        const stat = await fs.promises.stat(entryPath);
        if (stat.isDirectory()) {
          const eventsFile = path.join(entryPath, 'events.jsonl');
          if (fs.existsSync(eventsFile)) {
            return {
              format: 'copilot',
              sessionId: entry,
              directoryName: entry,
              extractDir
            };
          }
        }
      }

      // Check for Claude format: uuid.jsonl file
      const claudePattern = /^([a-zA-Z0-9_-]+)\.jsonl$/;
      for (const entry of entries) {
        const entryPath = path.join(extractDir, entry);
        const stat = await fs.promises.stat(entryPath);

        if (stat.isFile()) {
          const match = entry.match(claudePattern);
          if (match) {
            const sessionId = match[1];
            // Check if there's an optional directory with the same name
            const sessionDir = path.join(extractDir, sessionId);
            const hasDirectory = fs.existsSync(sessionDir);

            return {
              format: 'claude',
              sessionId,
              fileName: entry,
              hasDirectory,
              directoryName: hasDirectory ? sessionId : undefined,
              extractDir
            };
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Error detecting format:', err);
      return null;
    }
  }

  /**
   * Import Copilot format session
   * @param {Object} formatInfo - Format detection result
   * @param {string} extractDir - Extraction directory
   * @returns {Promise<Object>} Import result
   */
  async _importCopilotSession(formatInfo, extractDir) {
    try {
      const { sessionId, directoryName } = formatInfo;

      // Validate session ID
      if (!isValidSessionId(sessionId)) {
        return {
          success: false,
          error: 'Invalid session ID',
          statusCode: 400
        };
      }

      const sessionPath = path.join(extractDir, directoryName);
      const targetPath = path.join(this.SESSION_DIRS.copilot, sessionId);

      // Check for events.jsonl
      const eventsFile = path.join(sessionPath, 'events.jsonl');
      if (!fs.existsSync(eventsFile)) {
        return {
          success: false,
          error: 'Invalid session structure (no events.jsonl)',
          statusCode: 400
        };
      }

      // Check if session already exists
      if (fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Session already exists',
          statusCode: 409
        };
      }

      // Move session directory
      await fs.promises.rename(sessionPath, targetPath);

      // Mark as imported
      await fs.promises.writeFile(path.join(targetPath, '.imported'), '');

      return {
        success: true,
        sessionId,
        format: 'copilot'
      };
    } catch (err) {
      console.error('Error importing Copilot session:', err);
      return {
        success: false,
        error: `Error importing Copilot session: ${err.message}`,
        statusCode: 500
      };
    }
  }

  /**
   * Import Claude format session
   * @param {Object} formatInfo - Format detection result
   * @param {string} extractDir - Extraction directory
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} Import result
   */
  async _importClaudeSession(formatInfo, extractDir, req) {
    try {
      const { sessionId, fileName, hasDirectory, directoryName } = formatInfo;

      // Validate session ID
      if (!isValidSessionId(sessionId)) {
        return {
          success: false,
          error: 'Invalid session ID',
          statusCode: 400
        };
      }

      // Get project from query or use default
      const project = req.query.project || 'imported-sessions';

      // Create project directory
      const projectPath = path.join(this.SESSION_DIRS.claude, project);
      await fs.promises.mkdir(projectPath, { recursive: true });

      // Move the .jsonl file
      const sourceFile = path.join(extractDir, fileName);
      const targetFile = path.join(projectPath, fileName);
      await fs.promises.rename(sourceFile, targetFile);

      // If there's a directory, move it too
      if (hasDirectory && directoryName) {
        const sourceDir = path.join(extractDir, directoryName);
        const targetDir = path.join(projectPath, directoryName);
        await fs.promises.rename(sourceDir, targetDir);
      }

      return {
        success: true,
        sessionId,
        format: 'claude',
        project
      };
    } catch (err) {
      console.error('Error importing Claude session:', err);
      return {
        success: false,
        error: `Error importing Claude session: ${err.message}`,
        statusCode: 500
      };
    }
  }

  /**
   * Import Pi-Mono format session
   * @param {Object} formatInfo - Format detection result
   * @param {string} extractDir - Extraction directory
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} Import result
   */
  async _importPiMonoSession(formatInfo, extractDir, req) {
    try {
      const { sessionId, fileName } = formatInfo;

      // Validate session ID
      if (!isValidSessionId(sessionId)) {
        return {
          success: false,
          error: 'Invalid session ID',
          statusCode: 400
        };
      }

      // Get project from query or use default
      const project = req.query.project || 'imported-sessions';

      // Create project directory
      const projectPath = path.join(this.SESSION_DIRS['pi-mono'], project);
      await fs.promises.mkdir(projectPath, { recursive: true });

      // Move the .jsonl file
      const sourceFile = path.join(extractDir, fileName);
      const targetFile = path.join(projectPath, fileName);
      await fs.promises.rename(sourceFile, targetFile);

      return {
        success: true,
        sessionId,
        format: 'pi-mono',
        project
      };
    } catch (err) {
      console.error('Error importing Pi-Mono session:', err);
      return {
        success: false,
        error: `Error importing Pi-Mono session: ${err.message}`,
        statusCode: 500
      };
    }
  }

  /**
   * Import session by detected format
   * @param {Object} formatInfo - Format detection result
   * @param {string} extractDir - Extraction directory
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} Import result
   */
  async _importByFormat(formatInfo, extractDir, req) {
    // Validate session ID
    if (!isValidSessionId(formatInfo.sessionId)) {
      return {
        success: false,
        error: 'Invalid session ID',
        statusCode: 400
      };
    }

    switch (formatInfo.format) {
      case 'copilot':
        return await this._importCopilotSession(formatInfo, extractDir);
      case 'claude':
        return await this._importClaudeSession(formatInfo, extractDir, req);
      case 'pi-mono':
        return await this._importPiMonoSession(formatInfo, extractDir, req);
      default:
        return {
          success: false,
          error: `Unsupported format: ${formatInfo.format}`,
          statusCode: 400
        };
    }
  }

  /**
   * Find session location across all session directories
   * @param {string} sessionId - Session identifier
   * @param {string} preferredSource - Preferred source to search first
   * @returns {Promise<Object|null>} Session location info or null
   */
  async _findSessionLocation(sessionId, preferredSource = null) {
    try {
      // Define search order based on preference
      const sources = preferredSource
        ? [preferredSource, ...Object.keys(this.SESSION_DIRS).filter(s => s !== preferredSource)]
        : Object.keys(this.SESSION_DIRS);

      for (const source of sources) {
        const baseDir = this.SESSION_DIRS[source];

        if (source === 'copilot') {
          // For Copilot, sessions are directly in SESSION_DIR
          const sessionPath = path.join(baseDir, sessionId);
          if (fs.existsSync(sessionPath)) {
            const eventsFile = path.join(sessionPath, 'events.jsonl');
            if (fs.existsSync(eventsFile)) {
              return {
                source: 'copilot',
                sessionId,
                sessionPath,
                baseDir
              };
            }
          }
        } else if (source === 'claude') {
          // For Claude, search in all project directories
          if (fs.existsSync(baseDir)) {
            const projects = await fs.promises.readdir(baseDir);
            for (const project of projects) {
              const projectPath = path.join(baseDir, project);
              const stat = await fs.promises.stat(projectPath);
              if (stat.isDirectory()) {
                const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
                if (fs.existsSync(sessionFile)) {
                  return {
                    source: 'claude',
                    sessionId,
                    sessionFile,
                    projectPath,
                    project,
                    baseDir
                  };
                }
              }
            }
          }
        } else if (source === 'pi-mono') {
          // For Pi-Mono, search in all project directories for timestamped files
          if (fs.existsSync(baseDir)) {
            const projects = await fs.promises.readdir(baseDir);
            for (const project of projects) {
              const projectPath = path.join(baseDir, project);
              const stat = await fs.promises.stat(projectPath);
              if (stat.isDirectory()) {
                const files = await fs.promises.readdir(projectPath);
                const piMonoPattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z_${sessionId}\\.jsonl$`);
                for (const file of files) {
                  if (piMonoPattern.test(file)) {
                    return {
                      source: 'pi-mono',
                      sessionId,
                      fileName: file,
                      sessionFile: path.join(projectPath, file),
                      projectPath,
                      project,
                      baseDir
                    };
                  }
                }
              }
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Error finding session location:', err);
      return null;
    }
  }
}

module.exports = UploadController;