#!/usr/bin/env node
/**
 * Generate mock sessions for all sources (Copilot, Claude, Pi-Mono)
 * Used in CI to test multi-source support
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function generateClaudeSession() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const sessionId = 'claude-test-session-001';
  const sessionPath = path.join(claudeDir, sessionId);

  await fs.mkdir(sessionPath, { recursive: true });

  // Claude session events (simplified)
  const events = [
    {
      type: 'session.start',
      timestamp: new Date('2026-02-20T10:00:00Z').toISOString(),
      sessionId
    },
    {
      type: 'assistant.message',
      timestamp: new Date('2026-02-20T10:00:05Z').toISOString(),
      content: 'Hello from Claude Code! Let me help you with that.'
    },
    {
      type: 'tool.execution_start',
      timestamp: new Date('2026-02-20T10:00:10Z').toISOString(),
      tool: 'read_file',
      arguments: { path: 'src/index.js' }
    },
    {
      type: 'tool.execution_complete',
      timestamp: new Date('2026-02-20T10:00:12Z').toISOString(),
      result: { content: 'console.log("Hello World");' }
    },
    {
      type: 'session.end',
      timestamp: new Date('2026-02-20T10:05:00Z').toISOString()
    }
  ];

  const eventsFile = path.join(sessionPath, 'events.jsonl');
  await fs.writeFile(
    eventsFile,
    events.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  console.log(`✅ Created Claude session: ${sessionId}`);
}

async function generatePiSession() {
  const piDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const sessionId = 'pi-test-session-001';
  const sessionPath = path.join(piDir, sessionId);

  await fs.mkdir(sessionPath, { recursive: true });

  // Pi-Mono session events (simplified)
  const events = [
    {
      type: 'session.start',
      timestamp: new Date('2026-02-21T14:00:00Z').toISOString(),
      sessionId
    },
    {
      type: 'user.message',
      timestamp: new Date('2026-02-21T14:00:05Z').toISOString(),
      content: 'Build a React component'
    },
    {
      type: 'assistant.message',
      timestamp: new Date('2026-02-21T14:00:10Z').toISOString(),
      content: 'I\'ll create a React component for you.'
    },
    {
      type: 'tool.execution_start',
      timestamp: new Date('2026-02-21T14:00:15Z').toISOString(),
      tool: 'create_file',
      arguments: { path: 'Button.jsx', content: 'export const Button = () => <button>Click</button>;' }
    },
    {
      type: 'tool.execution_complete',
      timestamp: new Date('2026-02-21T14:00:18Z').toISOString(),
      result: { success: true }
    },
    {
      type: 'session.end',
      timestamp: new Date('2026-02-21T14:10:00Z').toISOString()
    }
  ];

  const eventsFile = path.join(sessionPath, 'events.jsonl');
  await fs.writeFile(
    eventsFile,
    events.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  console.log(`✅ Created Pi session: ${sessionId}`);
}

async function main() {
  try {
    await generateClaudeSession();
    await generatePiSession();
    console.log('✅ All mock sessions generated');
  } catch (err) {
    console.error('❌ Failed to generate sessions:', err);
    process.exit(1);
  }
}

main();
