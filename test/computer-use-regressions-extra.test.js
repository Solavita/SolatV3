const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { ConversationCore, parseDirectComputerWorkflowRequest, requiresScreenDrivenComputerTask } = require('../src/core/conversation-core');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');

function extractObjectMethod(source, name) {
  const marker = `${name}(`;
  const start = source.indexOf(marker, source.indexOf('const AgentUI = {'));
  assert.notEqual(start, -1, `renderer method ${name} must exist`);
  const signatureEnd = source.indexOf(') {', start + marker.length);
  assert.notEqual(signatureEnd, -1, `renderer method ${name} must have a method body`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`renderer method ${name} is not balanced`);
}

function rendererAgentHarness() {
  const calls = { added: [], updated: [], removed: [], rendered: 0, statuses: [] };
  const thread = { id: 'thread-1', messages: [] };
  const State = {
    threads: [thread],
    activeId: thread.id,
    add(threadId, message) {
      const stored = { id: `message-${thread.messages.length + 1}`, ...message };
      assert.equal(threadId, thread.id);
      thread.messages.push(stored);
      calls.added.push(stored);
      return stored;
    },
    updateMessage(threadId, messageId, patch) {
      assert.equal(threadId, thread.id);
      const message = thread.messages.find(item => item.id === messageId);
      if (!message) return null;
      Object.assign(message, patch);
      calls.updated.push({ messageId, patch });
      return message;
    },
    removeMessage(threadId, messageId) {
      assert.equal(threadId, thread.id);
      const index = thread.messages.findIndex(item => item.id === messageId);
      if (index < 0) return false;
      thread.messages.splice(index, 1);
      calls.removed.push(messageId);
      return true;
    },
  };
  const context = vm.createContext({
    State,
    Chat: { render() { calls.rendered += 1; } },
    sessionFor: threadId => threadId === thread.id ? 'session-1' : null,
  });
  const method = name => vm.runInContext(`({${extractObjectMethod(rendererSource, name)}}).${name}`, context);
  const agent = {
    progressMessages: new Map(),
    activeTaskBySession: new Map(),
    latestRevisionByTask: new Map(),
    latestRequestBySession: new Map(),
    terminalTaskTombstones: new Map(),
    status(message) { calls.statuses.push(message); },
  };
  agent.rememberTerminalTask = method('rememberTerminalTask');
  agent.receiveComputerTaskEvent = method('receiveComputerTaskEvent');
  agent.reconcileComputerTaskResponse = method('reconcileComputerTaskResponse');
  return { agent, calls, thread };
}

function event(overrides = {}) {
  return {
    schema_version: 'solat.computer-task-event.v1',
    task_id: 'task-old',
    session_id: 'session-1',
    request_id: 'request-old',
    revision: 2,
    type: 'completed',
    status: 'COMPLETED',
    summary: 'Old task completed.',
    ...overrides,
  };
}

test('stale terminal renderer event retires only its matching task without touching newer chat state', () => {
  const { agent, calls } = rendererAgentHarness();
  agent.latestRequestBySession.set('session-1', 'request-new');
  agent.activeTaskBySession.set('session-1', 'task-old');

  agent.receiveComputerTaskEvent(event());

  assert.equal(agent.activeTaskBySession.has('session-1'), false);
  assert.equal(agent.terminalTaskTombstones.get('task-old').requestId, 'request-old');
  assert.equal(calls.added.length, 0);
  assert.equal(calls.updated.length, 0);
  assert.equal(calls.rendered, 0);
});

test('delayed progress cannot resurrect a renderer task after its terminal tombstone', () => {
  const { agent, calls } = rendererAgentHarness();
  agent.latestRequestBySession.set('session-1', 'request-old');
  agent.rememberTerminalTask('task-old', { revision: 2, requestId: 'request-old' });

  agent.receiveComputerTaskEvent(event({ type: 'planning', status: 'RUNNING', revision: 3 }));

  assert.equal(agent.activeTaskBySession.has('session-1'), false);
  assert.equal(calls.added.length, 0);
  assert.equal(calls.updated.length, 0);
});

test('renderer final response reconciles only with progress from the same request', () => {
  const { agent, calls, thread } = rendererAgentHarness();
  thread.messages.push(
    { id: 'progress-a', content: 'working', responseMeta: { mode: 'agent_progress', computerTaskId: 'task-a', computerTaskSessionId: 'session-1', computerTaskRequestId: 'request-a', computerTaskRevision: 4 } },
    { id: 'final-b', content: 'newer result', responseMeta: { mode: 'conversation' } },
  );

  const untouched = agent.reconcileComputerTaskResponse({ threadId: thread.id, sessionId: 'session-1', requestId: 'request-b', message: thread.messages[1] });
  assert.equal(untouched.id, 'final-b');
  assert.deepEqual(calls.removed, []);

  const finalA = { id: 'final-a', content: 'verified result', error: null, responseMeta: { mode: 'conversation' } };
  thread.messages.push(finalA);
  const merged = agent.reconcileComputerTaskResponse({ threadId: thread.id, sessionId: 'session-1', requestId: 'request-a', message: finalA });
  assert.equal(merged.id, 'progress-a');
  assert.equal(merged.content, 'verified result');
  assert.equal(merged.responseMeta.computerTaskRequestId, 'request-a');
  assert.deepEqual(calls.removed, ['final-a']);
  assert.equal(thread.messages.some(message => message.id === 'final-a'), false);
  assert.equal(thread.messages.some(message => message.id === 'final-b'), true);
});

test('multi-step Notepad request bypasses direct launch fast path and stays in the computer task loop', async () => {
  let bridgeCalls = 0;
  let plannerCalls = 0;
  let loopInput = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() { plannerCalls += 1; throw new Error('bounded planner must not handle a screen-driven workflow'); },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'computer_launch_app', parameters: { type: 'object' } } }],
    owns: () => true,
    async execute() { bridgeCalls += 1; throw new Error('direct launch must not truncate the typing step'); },
  };
  const computerTaskLoop = {
    async start(input) {
      loopInput = input;
      return { task_id: 'task-notepad', status: 'NEEDS_CLARIFICATION', planner_turns: 1, summary: 'Ready to continue the full Notepad workflow.' };
    },
  };
  const router = { analyze: () => ({ primary_intent: 'general_chat', confidence: 0.5, candidate_intents: [], allowed_tools: [], safety_constraints: [], task: {}, disambiguation: {} }) };
  const core = new ConversationCore({ config: {}, provider, router, agentBridge: bridge, computerTaskLoop });

  const result = await core.send({
    sessionId: 'notepad-session',
    requestId: 'notepad-request',
    content: 'เปิด Notepad แล้วพิมพ์คำว่า SOLAT regression test',
    agentMode: true,
  });

  assert.equal(bridgeCalls, 0);
  assert.equal(plannerCalls, 0);
  assert.equal(loopInput.requestId, 'notepad-request');
  assert.equal(loopInput.goal, 'เปิด Notepad แล้วพิมพ์คำว่า SOLAT regression test');
  assert.deepEqual(loopInput.workflowHint, { workflow: 'notepad_text', text: 'SOLAT regression test', mode: 'replace' });
  assert.equal(result.model, 'model guided computer use');
});

test('Notepad workflow parser preserves exact Thai text and append intent', () => {
  assert.deepEqual(
    parseDirectComputerWorkflowRequest('เปิด Notepad แล้วพิมพ์ต่อท้ายว่า SOLAT COMPUTER TEST'),
    { status: 'ready', workflow: 'notepad_text', text: 'SOLAT COMPUTER TEST', mode: 'append' },
  );
});

test('screen routing recognises read-only unknown-app inspection and ambiguous continuation', () => {
  assert.equal(requiresScreenDrivenComputerTask('ช่วยดูหน้าต่าง Calculator ที่เปิดอยู่ แล้วบอกตัวเลขที่แสดงตอนนี้ โดยไม่ต้องกดอะไร'), true);
  assert.equal(requiresScreenDrivenComputerTask('เปิดโปรแกรมนั้นแล้วทำต่อให้หน่อย'), true);
});

test('multi-app search preserves its return-to-Notepad workflow and exact query', () => {
  const request = 'เปิด Chrome ค้นหา TypeScript แล้วกลับไปที่ Notepad โดยไม่แก้ข้อความเดิม';
  assert.equal(requiresScreenDrivenComputerTask(request), true);
  assert.deepEqual(parseDirectComputerWorkflowRequest(request), {
    status: 'ready', workflow: 'web_search_return_notepad', query: 'TypeScript',
  });
});
