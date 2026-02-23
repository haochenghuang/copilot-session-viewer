const path = require('path');
const createApp = require('./src/app');
const config = require('./src/config');
const processManager = require('./src/utils/processManager');

// Create the Express app
const app = createApp();

// Export app for testing
module.exports = app;

// Start server only if not being required by tests
if (require.main === module) {
  const server = app.listen(config.PORT, () => {
    console.log(`🚀 Copilot Session Viewer running at http://localhost:${config.PORT}`);
    console.log(`📂 Session directories (env vars):`);
    console.log(`   COPILOT_SESSION_DIR=${process.env.COPILOT_SESSION_DIR || 'not set'}`);
    console.log(`   CLAUDE_SESSION_DIR=${process.env.CLAUDE_SESSION_DIR || 'not set'}`);
    console.log(`   PI_MONO_SESSION_DIR=${process.env.PI_MONO_SESSION_DIR || 'not set'}`);
    console.log(`   SESSION_DIR=${process.env.SESSION_DIR || 'not set'} (legacy)`);
    console.log(`🔧 Environment: ${config.NODE_ENV}`);
    console.log(`⚡ Active processes: ${processManager.getActiveCount()}`);
    
    // Log sessions found
    const SessionRepository = require('./src/services/sessionRepository');
    const repo = new SessionRepository();
    repo.findAll().then(sessions => {
      console.log(`📊 Sessions found: ${sessions.length}`);
      if (sessions.length > 0) {
        console.log(`   First 5: ${sessions.slice(0, 5).map(s => s.id + ' (' + s.source + ')').join(', ')}`);
      }
    }).catch(err => {
      console.error(`❌ Error loading sessions:`, err.message);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📛 SIGTERM received, closing server...');
    server.close(() => {
      console.log('✅ Server closed');
    });
  });
}