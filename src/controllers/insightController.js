const InsightService = require('../services/insightService');
const { isValidSessionId } = require('../utils/helpers');

class InsightController {
  constructor(insightService = null, sessionService = null) {
    if (insightService) {
      this.insightService = insightService;
    } else {
      // Use default multi-source configuration
      this.insightService = new InsightService();
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

      // Get session to determine source and directory
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const result = await this.insightService.generateInsight(session.id, session.directory, session.source, forceRegenerate);
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

      // Get session to determine directory
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const result = await this.insightService.getInsightStatus(session.id, session.directory, session.source);
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

      // Get session to determine directory
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.directory) {
        return res.status(400).json({ error: 'Session directory not available' });
      }

      const result = await this.insightService.deleteInsight(session.id, session.directory, session.source);
      res.json(result);
    } catch (err) {
      console.error('Error deleting insight:', err);
      res.status(500).json({ error: 'Error deleting insight' });
    }
  }
}

module.exports = InsightController;