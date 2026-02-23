#!/usr/bin/env node
/**
 * Generate mock sessions for all sources (Copilot, Claude, Pi-Mono)
 * Used in CI to test multi-source support
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

async function generateClaudeSession() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const sessionId = 'claude-test-session-001';
  const sessionPath = path.join(claudeDir, sessionId);

  await fs.mkdir(sessionPath, { recursive: true });

  // Claude session events - correct format with uuid/parentUuid/sessionId
  const timestamp = new Date('2026-02-20T10:00:00Z').toISOString();
  const userUuid = randomUUID();
  const assistantUuid = randomUUID();
  const toolUuid = randomUUID();

  const events = [
    {
      type: 'user',
      uuid: userUuid,
      parentUuid: null,
      sessionId,
      timestamp,
      version: '1.0.0',
      cwd: '/home/test/project',
      gitBranch: 'main',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Read the README file' }]
      }
    },
    {
      type: 'assistant',
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId,
      timestamp: new Date('2026-02-20T10:00:05Z').toISOString(),
      message: {
        role: 'assistant',
        model: 'claude-opus-4.6',
        content: [{ type: 'text', text: 'I\'ll read the README file for you.' }]
      }
    },
    {
      type: 'tool-use',
      uuid: toolUuid,
      parentUuid: assistantUuid,
      sessionId,
      timestamp: new Date('2026-02-20T10:00:10Z').toISOString(),
      message: {
        type: 'tool_use',
        id: 'toolu_' + randomUUID(),
        name: 'read_file',
        input: { path: 'README.md' }
      }
    },
    {
      type: 'tool-result',
      uuid: randomUUID(),
      parentUuid: toolUuid,
      sessionId,
      timestamp: new Date('2026-02-20T10:00:12Z').toISOString(),
      message: {
        type: 'tool_result',
        tool_use_id: toolUuid,
        content: '# Test Project\n\nThis is a test README.'
      }
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

  // Pi-Mono session events - correct format with timestamp and session metadata
  const events = [
    {
      timestamp: new Date('2026-02-21T14:00:00Z').getTime(),
      type: 'message',
      role: 'user',
      content: 'Create a simple React button component',
      sessionId
    },
    {
      timestamp: new Date('2026-02-21T14:00:05Z').getTime(),
      type: 'message',
      role: 'assistant',
      content: 'I\'ll create a React button component for you.',
      sessionId
    },
    {
      timestamp: new Date('2026-02-21T14:00:10Z').getTime(),
      type: 'tool_call',
      tool: 'write_file',
      args: {
        path: 'Button.jsx',
        content: 'export const Button = ({ label }) => <button>{label}</button>;'
      },
      sessionId
    },
    {
      timestamp: new Date('2026-02-21T14:00:12Z').getTime(),
      type: 'tool_result',
      tool: 'write_file',
      result: { success: true, path: 'Button.jsx' },
      sessionId
    },
    {
      timestamp: new Date('2026-02-21T14:00:15Z').getTime(),
      type: 'message',
      role: 'assistant',
      content: 'Done! Created Button.jsx component.',
      sessionId
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
