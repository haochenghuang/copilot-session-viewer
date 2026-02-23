const InsightService = require('../services/insightService');
const { isValidSessionId } = require('../utils/helpers');
const path = require('path');
const os = require('os');

class InsightController {
  constructor(insightService = null, sessionService = null) {
    if (insightService) {
      this.insightService = insightService;
    } else {
      const SESSION_DIR = process.env.SESSION_DIR || path.join(os.homedir(), '.copilot', 'session-state');
      this.insightService = new InsightService(SESSION_DIR);
    }
    
    // SessionService for getting session metadata (source)
    if (sessionService) {
      this.sessionService = sessionService;
    } else {
      const SessionService = require('../services/sessionService');
      this.sessionService = new SessionService();
    }
  }

  // Generate or get insight
  async generateInsight(req, res) {
    try {
      const sessionId = req.params.id;
      const forceRegenerate = req.body?.force === true;

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      // Get session to determine source (copilot/claude/pi-mono)
      let sessionSource = 'copilot'; // default
      try {
        const session = await this.sessionService.getSessionById(sessionId);
        if (session && session.source) {
          sessionSource = session.source;
        }
      } catch (_err) {
        // Fall back to default if session not found
        console.warn(`Could not determine session source for ${sessionId}, using default: copilot`);
      }

      const result = await this.insightService.generateInsight(sessionId, sessionSource, forceRegenerate);
      res.json(result);
    } catch (err) {
      console.error('Error generating insight:', err);
      res.status(500).json({ error: err.message || 'Error generating insight' });
    }
  }

  // Get insight status
  async getInsightStatus(req, res) {
    try {
      const sessionId = req.params.id;

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const result = await this.insightService.getInsightStatus(sessionId);
      res.json(result);
    } catch (err) {
      console.error('Error getting insight status:', err);
      res.status(500).json({ error: 'Error getting insight status' });
    }
  }

  // Delete insight
  async deleteInsight(req, res) {
    try {
      const sessionId = req.params.id;

      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const result = await this.insightService.deleteInsight(sessionId);
      res.json(result);
    } catch (err) {
      console.error('Error deleting insight:', err);
      res.status(500).json({ error: 'Error deleting insight' });
    }
  }
}

module.exports = InsightController;