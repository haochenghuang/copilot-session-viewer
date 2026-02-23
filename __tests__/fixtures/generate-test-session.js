#!/usr/bin/env node

/**
 * Generate mock session data for CI testing
 * Creates multiple minimal but valid session directories for testing
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Session directory (use env var or default)
const SESSION_DIR = process.env.SESSION_DIR || path.join(process.env.HOME || '/tmp', '.copilot', 'session-state');

// Generate 5 test sessions to ensure homepage has content
const NUM_SESSIONS = 5;

for (let i = 0; i < NUM_SESSIONS; i++) {
  const SESSION_ID = `test-session-ci-${i}-${randomUUID().slice(0, 8)}`;
  const sessionPath = path.join(SESSION_DIR, SESSION_ID);
  
  // Create session directory
  fs.mkdirSync(sessionPath, { recursive: true });
  
  const baseTime = Date.now() - (i * 10 * 60 * 1000); // Stagger sessions by 10 min
  
  // Generate mock events.jsonl
  const events = [
    {
      type: 'session.start',
      timestamp: baseTime,
      data: {
        copilotVersion: '0.0.409',
        producer: 'copilot-agent',
        selectedModel: 'claude-sonnet-4.5',
        startTime: new Date(baseTime).toISOString()
      }
    },
    {
      type: 'user.message',
      timestamp: baseTime + 5000,
      data: {
        content: `Test message ${i}: Can you help me with a coding task?`,
        message: `Test message ${i}: Can you help me with a coding task?`
      }
    },
    {
      type: 'assistant.turn_start',
      timestamp: baseTime + 6000,
      data: {}
    },
    {
      type: 'assistant.message',
      timestamp: baseTime + 10000,
      data: {
        content: 'Of course! I\'d be happy to help you with your coding task.',
        message: 'Of course! I\'d be happy to help you with your coding task.'
      }
    },
    {
      type: 'assistant.turn_complete',
      timestamp: baseTime + 20000,
      data: {}
    },
    {
      type: 'session.end',
      timestamp: baseTime + 30000,
      data: {
        endTime: new Date(baseTime + 30000).toISOString()
      }
    }
  ];
  
  // Write events.jsonl
  const eventsContent = events.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(sessionPath, 'events.jsonl'), eventsContent);
  
  // Generate workspace.yaml
  const workspace = `cwd: /tmp/test-workspace-${i}
prompt: Test session ${i} for CI
model: claude-sonnet-4.5
startTime: ${new Date(baseTime).toISOString()}
endTime: ${new Date(baseTime + 30000).toISOString()}
`;
  
  fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'), workspace);
  
  console.log(`✅ Mock session created: ${SESSION_ID}`);
}

console.log(`📂 Location: ${SESSION_DIR}`);
console.log(`📊 Total sessions created: ${NUM_SESSIONS}`);
