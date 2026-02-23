const SessionController = require('../src/controllers/sessionController');

describe('SessionController - Rendering Coverage', () => {
  let controller;
  let mockSessionService;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockSessionService = {
      getSessionWithEvents: jest.fn()
    };

    controller = new SessionController(mockSessionService);

    mockReq = {
      params: {},
      query: {},
      headers: {}
    };

    mockRes = {
      render: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('getSessionDetail - render path', () => {
    it('should render session-vue template with sessionId, events, and metadata', async () => {
      mockReq.params.id = 'render-test-session';

      const mockEvents = [
        { type: 'user.message', content: 'Hello' },
        { type: 'assistant.message', content: 'Hi!' }
      ];

      const mockMetadata = {
        id: 'render-test-session',
        source: 'copilot',
        created: '2024-01-01',
        summary: 'Test session'
      };

      mockSessionService.getSessionWithEvents.mockResolvedValue({
        events: mockEvents,
        metadata: mockMetadata
      });

      await controller.getSessionDetail(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('session-vue', {
        sessionId: 'render-test-session',
        events: mockEvents,
        metadata: mockMetadata
      });
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('getTimeAnalysis - render path', () => {
    it('should render time-analyze template with sessionId, events, and metadata', async () => {
      mockReq.params.id = 'time-analyze-session';

      const mockEvents = [
        { type: 'tool.execution_start', timestamp: 1000 },
        { type: 'tool.execution_complete', timestamp: 2000 }
      ];

      const mockMetadata = {
        id: 'time-analyze-session',
        source: 'claude',
        created: '2024-01-15',
        summary: 'Time analysis test'
      };

      mockSessionService.getSessionWithEvents.mockResolvedValue({
        events: mockEvents,
        metadata: mockMetadata
      });

      await controller.getTimeAnalysis(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('time-analyze', {
        sessionId: 'time-analyze-session',
        events: mockEvents,
        metadata: mockMetadata
      });
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should handle time analysis for pi-mono sessions', async () => {
      mockReq.params.id = 'pi-mono-time-session';

      const mockEvents = [
        { type: 'session', data: { type: 'session' } },
        { type: 'message', role: 'user' }
      ];

      const mockMetadata = {
        id: 'pi-mono-time-session',
        source: 'pi-mono',
        created: '2024-02-01'
      };

      mockSessionService.getSessionWithEvents.mockResolvedValue({
        events: mockEvents,
        metadata: mockMetadata
      });

      await controller.getTimeAnalysis(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('time-analyze', {
        sessionId: 'pi-mono-time-session',
        events: mockEvents,
        metadata: mockMetadata
      });
    });
  });

  describe('getSessionDetail - edge cases', () => {
    it('should handle session with empty events array', async () => {
      mockReq.params.id = 'empty-events-session';

      mockSessionService.getSessionWithEvents.mockResolvedValue({
        events: [],
        metadata: { id: 'empty-events-session' }
      });

      await controller.getSessionDetail(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('session-vue', {
        sessionId: 'empty-events-session',
        events: [],
        metadata: { id: 'empty-events-session' }
      });
    });

    it('should handle session with large events array', async () => {
      mockReq.params.id = 'large-session';

      const largeEvents = new Array(1000).fill(null).map((_, i) => ({
        type: 'message',
        index: i
      }));

      mockSessionService.getSessionWithEvents.mockResolvedValue({
        events: largeEvents,
        metadata: { id: 'large-session' }
      });

      await controller.getSessionDetail(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('session-vue', {
        sessionId: 'large-session',
        events: largeEvents,
        metadata: { id: 'large-session' }
      });
    });
  });
});
