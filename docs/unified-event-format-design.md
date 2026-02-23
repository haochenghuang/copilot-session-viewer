# Unified Frontend Event Format - Design Document

## Executive Summary

This document proposes a unified event format to eliminate format-specific checks in the frontend and simplify tool call handling across three AI session formats: Copilot, Claude, and Pi-Mono.

**Current Problem:** The codebase handles three different tool event structures:
- **Copilot:** Independent `tool.execution_start` and `tool.execution_complete` events
- **Claude:** Embedded `tool_use` and `tool_result` in message content, later matched and merged
- **Pi-Mono:** Embedded tools in `assistant.message.data.tools` with results already merged

The frontend contains multiple format checks (`tool.type === 'tool_use'`, `_matched` flags, etc.) scattered across views.

**Proposed Solution:** Establish a single normalized tool representation at the API response layer that abstracts away source differences.

---

## 1. Current State Analysis

### 1.1 Current Tool Event Formats

#### Copilot Format (Independent Events)
```javascript
// Two separate events in the stream
{
  type: 'tool.execution_start',
  timestamp: '2024-01-01T10:00:00Z',
  data: {
    toolCallId: 'abc123',
    toolName: 'Read',
    arguments: { file_path: '/path/to/file' }
  }
}

{
  type: 'tool.execution_complete',
  timestamp: '2024-01-01T10:00:05Z',
  data: {
    toolCallId: 'abc123',
    toolName: 'Read',
    result: 'File contents...',
    error: null
  }
}

// After matching by sessionService._matchCopilotToolCalls():
{
  type: 'assistant.message',
  data: {
    tools: [{
      type: 'tool_use',
      id: 'abc123',
      name: 'Read',
      input: { file_path: '/path/to/file' },
      result: 'File contents...',
      status: 'completed',
      _matched: true
    }]
  }
}
```

#### Claude Format (Embedded with Separate Result)
```javascript
// User or Assistant message with tool_use
{
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Let me read that file.' },
      {
        type: 'tool_use',
        id: 'xyz789',
        name: 'Read',
        input: { file_path: '/path/to/file' }
      }
    ]
  }
}

// Later: User message with tool_result
{
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'xyz789',
        content: 'File contents...'
      }
    ]
  }
}

// After normalization and matching by sessionService._normalizeEvent() + _matchClaudeToolResults():
{
  type: 'assistant',
  data: {
    message: 'Let me read that file.',
    tools: [{
      type: 'tool_use',
      id: 'xyz789',
      name: 'Read',
      input: { file_path: '/path/to/file' },
      result: 'File contents...',
      _matched: true
    }]
  }
}
```

#### Pi-Mono Format (Already Merged)
```javascript
// Pi-Mono parser already merges tools at parse time
{
  type: 'assistant.message',
  timestamp: '2024-01-01T10:00:00Z',
  data: {
    message: 'Let me read that file.',
    tools: [{
      name: 'Read',
      input: { file_path: '/path/to/file' },
      result: 'File contents...',
      status: 'completed',
      isError: false
    }]
  }
}
```

### 1.2 Current Frontend Format Checks

**In `views/session-vue.ejs` (lines 1581-1605):**
```javascript
const getToolGroups = (event) => {
  if (event.data?.tools && Array.isArray(event.data.tools)) {
    return event.data.tools.map(tool => {
      // Claude format check: {type: 'tool_use', name, input, _matched, result}
      if (tool.type === 'tool_use') {
        return {
          tool: tool.name,
          start: { data: { toolName: tool.name, arguments: tool.input } },
          complete: tool._matched ? {
            data: { result: tool.result, isError: tool.error ? true : false }
          } : null
        };
      }
      // Copilot/Pi-Mono format (already matched)
      return tool;
    });
  }
  return [];
};
```

**In `views/time-analyze.ejs` (lines 1088-1098, 1350-1360):**
```javascript
// Multiple places checking for embedded tools
if (e.type === 'assistant.message' && e.data?.tools) {
  for (const tool of e.data.tools) {
    innerEvents.push({
      type: 'tool.execution_start',
      timestamp: e.timestamp,
      data: { tool: tool.name, toolName: tool.name, arguments: tool.input }
    });
    // ... similar expansion logic
  }
}
```

### 1.3 Issues with Current Approach

1. **Scattered Format Logic:** Frontend needs to understand internal matching state (`_matched` flag)
2. **Inconsistent Tool Schema:** Different fields across formats (`status` vs `_matched`, `isError` vs `error`)
3. **Duplicate Code:** Multiple places converting between formats
4. **Brittleness:** Changes to parser matching logic require frontend updates
5. **Testing Complexity:** Need to test all format variations in frontend code

---

## 2. Proposed Unified Format

### 2.1 Normalized Tool Schema

**Single canonical tool representation:**

```typescript
interface UnifiedToolCall {
  // Core identification
  id: string;                    // Unique tool call ID
  name: string;                  // Tool name (e.g., 'Read', 'Write', 'Bash')

  // Timing
  startTime: string;             // ISO 8601 timestamp
  endTime: string | null;        // ISO 8601 timestamp, null if still running

  // Status
  status: 'pending' | 'running' | 'completed' | 'error';

  // Input/Output
  input: Record<string, any>;    // Tool parameters
  result: string | null;         // Tool result (null if not completed)
  error: string | null;          // Error message (null if no error)

  // Metadata (optional, for advanced use cases)
  metadata?: {
    source?: string;             // 'copilot' | 'claude' | 'pi-mono'
    subagentId?: string;         // If tool was executed by subagent
    retryCount?: number;         // Number of retries
    duration?: number;           // Duration in milliseconds
  };
}
```

### 2.2 Normalized Assistant Message Schema

```typescript
interface UnifiedAssistantMessage {
  type: 'assistant.message';
  id: string;
  timestamp: string;
  parentId?: string;

  data: {
    message: string;             // Text content
    model?: string;              // Model used
    tools?: UnifiedToolCall[];   // Array of tools (if any)
    usage?: {                    // Token usage
      inputTokens?: number;
      outputTokens?: number;
    };
  };

  // Internal metadata (not for frontend consumption)
  _fileIndex?: number;
  _turnNumber?: number;
  _subagent?: {
    id: string;
    name: string;
  };
}
```

### 2.3 Timeline Event Schema (for time-analyze views)

```typescript
interface UnifiedTimelineEvent {
  type: 'user.message' | 'assistant.turn_start' | 'assistant.turn_complete'
       | 'tool.execution_start' | 'tool.execution_complete'
       | 'subagent.started' | 'subagent.completed';
  id: string;
  timestamp: string;
  parentId?: string;

  data: {
    message?: string;
    tool?: UnifiedToolCall;      // For tool events
    toolCallId?: string;         // For subagent events
    agentName?: string;          // For subagent events
    [key: string]: any;          // Flexible for other event types
  };
}
```

---

## 3. Transformation Strategy

### 3.1 Where to Transform

**Recommendation: Transform at the SessionService API layer** (Option B)

**Rationale:**
- ✅ Single point of transformation
- ✅ Frontend receives clean, consistent data
- ✅ Parsers remain focused on format-specific reading
- ✅ Easier to test (one transformation module vs. three parsers)
- ✅ Simpler to add new formats in the future

**Architecture:**

```
[Raw Files] → [Parser Layer] → [Matching Layer] → [Normalization Layer] → [API Response]
                (Pi-Mono,           (Source-          (Unified Schema)     (Clean JSON)
                 Copilot,            Specific)
                 Claude)
```

### 3.2 Implementation Approach

#### Phase 1: Add Unified Normalizer Module

Create `src/services/eventNormalizer.js`:

```javascript
class EventNormalizer {
  /**
   * Normalize all events to unified format
   * @param {Array} events - Raw events from parsers
   * @param {string} source - 'copilot' | 'claude' | 'pi-mono'
   * @returns {Array} - Normalized events
   */
  normalizeEvents(events, source) {
    return events.map(event => this.normalizeEvent(event, source));
  }

  /**
   * Normalize a single event
   */
  normalizeEvent(event, source) {
    // Handle assistant messages with tools
    if (this._isAssistantMessage(event)) {
      return this._normalizeAssistantMessage(event, source);
    }

    // Handle timeline events
    if (this._isTimelineEvent(event)) {
      return this._normalizeTimelineEvent(event, source);
    }

    // Pass through other events
    return event;
  }

  /**
   * Normalize assistant message with embedded tools
   */
  _normalizeAssistantMessage(event, source) {
    const normalized = { ...event };

    if (event.data?.tools && Array.isArray(event.data.tools)) {
      normalized.data.tools = event.data.tools.map(tool =>
        this._normalizeToolCall(tool, source, event.timestamp)
      );
    }

    return normalized;
  }

  /**
   * Normalize a tool call to unified schema
   */
  _normalizeToolCall(tool, source, messageTimestamp) {
    // Handle Copilot/Claude format with _matched flag
    if (tool.type === 'tool_use') {
      return {
        id: tool.id,
        name: tool.name,
        startTime: messageTimestamp,
        endTime: tool._matched ? messageTimestamp : null,
        status: this._computeStatus(tool),
        input: tool.input || {},
        result: tool.result || null,
        error: tool.error || null,
        metadata: {
          source,
          matched: tool._matched
        }
      };
    }

    // Handle Pi-Mono format (already has status)
    if (tool.name && tool.status) {
      return {
        id: tool.id || this._generateToolId(),
        name: tool.name,
        startTime: messageTimestamp,
        endTime: tool.status === 'completed' ? messageTimestamp : null,
        status: tool.status,
        input: tool.input || {},
        result: tool.result || null,
        error: tool.isError ? tool.result : null,
        metadata: { source }
      };
    }

    // Fallback: return as-is with minimal normalization
    return {
      id: tool.id || this._generateToolId(),
      name: tool.name || 'unknown',
      startTime: messageTimestamp,
      endTime: null,
      status: 'running',
      input: tool.input || {},
      result: null,
      error: null,
      metadata: { source }
    };
  }

  _computeStatus(tool) {
    if (tool.error) return 'error';
    if (tool._matched && tool.result !== undefined) return 'completed';
    if (tool._matched === false) return 'running';
    return 'completed'; // Default for matched tools
  }

  _generateToolId() {
    return `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _isAssistantMessage(event) {
    return event.type === 'assistant.message' || event.type === 'assistant';
  }

  _isTimelineEvent(event) {
    return event.type?.startsWith('tool.') ||
           event.type?.startsWith('subagent.');
  }

  _normalizeTimelineEvent(event, source) {
    // For tool.execution_start/complete, ensure consistent schema
    if (event.type === 'tool.execution_start' || event.type === 'tool.execution_complete') {
      return {
        ...event,
        data: {
          ...event.data,
          toolCallId: event.data?.toolCallId || event.data?.id,
          toolName: event.data?.toolName || event.data?.tool || event.data?.name
        }
      };
    }

    return event;
  }
}

module.exports = EventNormalizer;
```

#### Phase 2: Integrate into SessionService

Modify `src/services/sessionService.js`:

```javascript
const EventNormalizer = require('./eventNormalizer');

class SessionService {
  constructor(sessionDir) {
    // ... existing code ...
    this.normalizer = new EventNormalizer();
  }

  async getSessionEvents(sessionId) {
    // ... existing parsing logic ...

    // After expansion but before return:
    events = this.normalizer.normalizeEvents(events, session.source);

    return events;
  }
}
```

#### Phase 3: Simplify Frontend Code

**Before (session-vue.ejs):**
```javascript
const getToolGroups = (event) => {
  if (event.data?.tools && Array.isArray(event.data.tools)) {
    return event.data.tools.map(tool => {
      if (tool.type === 'tool_use') {
        return {
          tool: tool.name,
          start: { data: { toolName: tool.name, arguments: tool.input } },
          complete: tool._matched ? {
            data: { result: tool.result, isError: tool.error ? true : false }
          } : null
        };
      }
      return tool;
    });
  }
  return [];
};
```

**After:**
```javascript
const getToolGroups = (event) => {
  // Tools are already normalized to unified format
  return event.data?.tools || [];
};

const getToolDuration = (tool) => {
  if (tool.startTime && tool.endTime) {
    const ms = new Date(tool.endTime) - new Date(tool.startTime);
    return formatDuration(ms);
  }
  return null;
};

const getToolStatus = (tool) => {
  switch (tool.status) {
    case 'completed': return { icon: '✓', color: 'text-success' };
    case 'error': return { icon: '✗', color: 'text-error' };
    case 'running': return { icon: '⋯', color: 'text-warning' };
    default: return { icon: '?', color: 'text-muted' };
  }
};
```

---

## 4. Code Change Checklist

### 4.1 Backend Changes

#### New Files
- [ ] `src/services/eventNormalizer.js` - Main normalization module
- [ ] `src/services/__tests__/eventNormalizer.test.js` - Unit tests

#### Modified Files
- [ ] `src/services/sessionService.js`
  - [ ] Import EventNormalizer
  - [ ] Add normalizer instance to constructor
  - [ ] Call `normalizer.normalizeEvents()` in `getSessionEvents()` after expansion
  - [ ] Remove frontend-specific format conversion logic (keep matching logic)

- [ ] `lib/parsers/pi-mono-parser.js`
  - [ ] No changes needed (parser output will be normalized by eventNormalizer)

- [ ] `package.json`
  - [ ] No new dependencies needed

#### API Contract
- [ ] Document unified event schema in API docs
- [ ] Add API version header for gradual migration (optional)

### 4.2 Frontend Changes

#### Modified Files
- [ ] `views/session-vue.ejs`
  - [ ] Simplify `getToolGroups()` - remove format checks
  - [ ] Simplify `getToolStatus()` - use unified `status` field
  - [ ] Add `getToolDuration()` - calculate from `startTime`/`endTime`
  - [ ] Remove `tool.type === 'tool_use'` checks
  - [ ] Remove `_matched` flag checks
  - [ ] Use `tool.error` directly instead of `tool.isError`

- [ ] `views/time-analyze.ejs`
  - [ ] Remove embedded tool expansion logic (lines ~1088-1098, 1350-1360)
  - [ ] Use timeline events directly (already expanded by backend)
  - [ ] Simplify tool event markers (use unified schema)

- [ ] `views/time-analyze-v2.ejs`
  - [ ] Similar changes to time-analyze.ejs
  - [ ] Update Gantt chart generation to use unified schema

#### Removed Code
- [ ] All `tool.type === 'tool_use'` conditionals
- [ ] All `_matched` flag checks
- [ ] Format-specific tool expansion loops
- [ ] Duplicate status/error mapping logic

### 4.3 Testing Changes

#### New Tests
- [ ] `eventNormalizer.test.js`
  - [ ] Test Copilot format normalization
  - [ ] Test Claude format normalization
  - [ ] Test Pi-Mono format normalization
  - [ ] Test tool status computation
  - [ ] Test error handling
  - [ ] Test edge cases (missing fields, orphaned events)

#### Updated Tests
- [ ] `sessionService.test.js`
  - [ ] Update assertions to check for unified format
  - [ ] Add integration tests with normalizer

#### Manual Testing
- [ ] Load Copilot session, verify tools display correctly
- [ ] Load Claude session, verify tools display correctly
- [ ] Load Pi-Mono session, verify tools display correctly
- [ ] Test time-analyze view with all formats
- [ ] Test subagent tool attribution
- [ ] Test error states and edge cases

---

## 5. Migration Considerations

### 5.1 Backward Compatibility

**No Breaking Changes Required:**
- Current frontend code will continue to work during transition
- Unified format is a superset of existing formats
- Can add feature flag for gradual rollout

### 5.2 Feature Flags

```javascript
// In sessionService.js
class SessionService {
  constructor(sessionDir, options = {}) {
    this.useUnifiedFormat = options.useUnifiedFormat ?? true;
    this.normalizer = new EventNormalizer();
  }

  async getSessionEvents(sessionId) {
    // ... existing code ...

    if (this.useUnifiedFormat) {
      events = this.normalizer.normalizeEvents(events, session.source);
    }

    return events;
  }
}
```

### 5.3 Rollout Plan

**Phase 1: Backend (Week 1-2)**
1. Implement EventNormalizer module with tests
2. Integrate into SessionService with feature flag (default ON)
3. Run backend tests to ensure no regressions
4. Deploy to dev environment

**Phase 2: Frontend (Week 3)**
1. Update session-vue.ejs to use unified format
2. Test manually with all three formats
3. Fix any edge cases discovered
4. Deploy to staging

**Phase 3: Timeline Views (Week 4)**
1. Update time-analyze.ejs and time-analyze-v2.ejs
2. Test Gantt chart generation
3. Verify performance with large sessions
4. Deploy to production

**Phase 4: Cleanup (Week 5)**
1. Remove feature flag
2. Remove dead code (old format checks)
3. Update documentation
4. Add inline comments for future maintainers

### 5.4 Monitoring

**Metrics to Track:**
- API response time (should not increase)
- Frontend render time (should decrease slightly)
- Error rates (should not increase)
- User-reported bugs (should decrease over time)

**Rollback Strategy:**
- Keep feature flag for quick rollback
- Monitor logs for normalization errors
- Have old code ready to revert if needed

---

## 6. Benefits Summary

### 6.1 Code Quality
- ✅ **Reduced Complexity:** ~200 lines of frontend code removed
- ✅ **Single Source of Truth:** All format logic in one module
- ✅ **Easier Testing:** One set of tests instead of scattered checks
- ✅ **Better Maintainability:** Changes in one place, not three

### 6.2 Developer Experience
- ✅ **Simpler Frontend:** No format checks needed
- ✅ **Clear API Contract:** Well-documented unified schema
- ✅ **Faster Development:** Less time debugging format issues
- ✅ **Easier Onboarding:** New devs learn one format, not three

### 6.3 Future-Proofing
- ✅ **Easy to Extend:** Add new formats by updating normalizer only
- ✅ **API Versioning:** Can version schema independently of frontend
- ✅ **Tool Evolution:** Add new tool features without breaking frontends
- ✅ **Multi-Client Support:** Web, mobile, CLI can all use same API

---

## 7. Alternative Approaches Considered

### 7.1 Option A: Normalize in Parsers (REJECTED)

**Approach:** Make each parser output unified format directly.

**Pros:**
- Format handling closest to source
- Parser owns full transformation

**Cons:**
- ❌ Duplicates normalization logic across 3 parsers
- ❌ Harder to ensure consistency
- ❌ Parsers become more complex
- ❌ Testing burden multiplied by 3

### 7.2 Option C: Normalize in Frontend (REJECTED)

**Approach:** Keep backend as-is, do all normalization in frontend views.

**Pros:**
- No backend changes
- Frontend controls its own format

**Cons:**
- ❌ Duplicates logic across multiple views
- ❌ Each view must understand all formats
- ❌ API remains inconsistent
- ❌ Harder to add new clients (mobile, CLI)

### 7.3 Option D: GraphQL Schema (FUTURE)

**Approach:** Use GraphQL to define unified schema with resolvers.

**Pros:**
- ✅ Strongly typed schema
- ✅ Client-controlled queries
- ✅ Better for complex queries

**Cons:**
- ❌ Much larger implementation effort
- ❌ Overkill for current needs
- ❌ Learning curve for team

**Status:** Consider for future major refactoring if API complexity grows significantly.

---

## 8. Open Questions & Risks

### 8.1 Open Questions

1. **Tool Result Size:** Should we truncate large tool results (>10KB) in the API response?
   - **Recommendation:** Add `result_preview` field (first 1000 chars), keep full result available on demand

2. **Streaming:** How to handle streaming tool execution in real-time?
   - **Recommendation:** Out of scope for initial implementation, revisit if WebSocket support is added

3. **Tool Metadata:** What other metadata should be included?
   - **Recommendation:** Start minimal, add as needed based on user feedback

### 8.2 Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Performance regression | Medium | Low | Benchmark before/after, optimize normalizer |
| Breaking existing code | High | Low | Comprehensive tests, feature flag, gradual rollout |
| Incomplete normalization | Medium | Medium | Unit tests for all edge cases, manual testing |
| Schema evolution issues | Low | Medium | Version API, document schema clearly |

---

## 9. Success Criteria

### 9.1 Technical Metrics
- [ ] All tool events use unified schema (100% coverage)
- [ ] Zero frontend format checks remaining
- [ ] Test coverage >90% for normalizer module
- [ ] API response time <10% increase
- [ ] Frontend render time ≥10% decrease (due to simpler logic)

### 9.2 Code Metrics
- [ ] ≥150 lines of frontend code removed
- [ ] ≤300 lines of backend code added (normalizer)
- [ ] Net reduction in total LOC
- [ ] Cyclomatic complexity reduced in frontend

### 9.3 Quality Metrics
- [ ] Zero P0/P1 bugs introduced
- [ ] All existing features work as before
- [ ] New format handles all edge cases
- [ ] Documentation updated

---

## 10. Appendix

### 10.1 Example API Response (Before vs After)

**Before (Claude format):**
```json
{
  "type": "assistant",
  "data": {
    "message": "Let me read that file.",
    "tools": [{
      "type": "tool_use",
      "id": "xyz789",
      "name": "Read",
      "input": { "file_path": "/path/to/file" },
      "result": "File contents...",
      "_matched": true,
      "error": null
    }]
  }
}
```

**After (Unified format):**
```json
{
  "type": "assistant.message",
  "data": {
    "message": "Let me read that file.",
    "tools": [{
      "id": "xyz789",
      "name": "Read",
      "startTime": "2024-01-01T10:00:00Z",
      "endTime": "2024-01-01T10:00:05Z",
      "status": "completed",
      "input": { "file_path": "/path/to/file" },
      "result": "File contents...",
      "error": null,
      "metadata": {
        "source": "claude",
        "duration": 5000
      }
    }]
  }
}
```

### 10.2 Schema Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02 | Initial unified schema |
| 1.1 | TBD | Add `result_preview` field (future) |
| 2.0 | TBD | Add streaming support (future) |

### 10.3 References

- Current code: `src/services/sessionService.js` (lines 206-237, 458-649)
- Frontend format checks: `views/session-vue.ejs` (lines 1581-1605)
- Pi-Mono parser: `lib/parsers/pi-mono-parser.js` (lines 124-217)

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-22 | Claude | Initial design document |

---

**Status:** ✅ Ready for Review
**Priority:** P1 - High Impact, Low Risk
**Estimated Effort:** 3-4 weeks (1 developer)
