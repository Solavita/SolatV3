const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');

function objectLiteral(name, nextName) {
  const startMarker = `  const ${name} = `;
  const endMarker = `\n\n  const ${nextName} =`;
  const start = rendererSource.indexOf(startMarker);
  const end = rendererSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} object was not found in renderer.js`);
  assert.notEqual(end, -1, `${nextName} boundary was not found in renderer.js`);
  return rendererSource.slice(start + startMarker.length, end).trim().replace(/;$/u, '');
}

function createHarness() {
  let nextId = 0;
  const busyStates = [];
  const statuses = [];
  const sessions = new Map([['thread-1', 'session-1']]);
  const thread = { id: 'thread-1', title: 'New conversation', messages: [] };
  const State = {
    threads: [thread], activeId: thread.id,
    get active() { return this.threads.find(item => item.id === this.activeId) || null; },
    add(threadId, message) {
      const target = this.threads.find(item => item.id === threadId);
      if (!target) return null;
      const stored = { id: `message-${++nextId}`, ts: nextId, ...message };
      target.messages.push(stored);
      return stored;
    },
    updateMessage(threadId, messageId, patch) {
      const message = this.threads.find(item => item.id === threadId)?.messages.find(item => item.id === messageId);
      if (!message) return null;
      Object.assign(message, patch);
      return message;
    },
    removeMessage(threadId, messageId) {
      const target = this.threads.find(item => item.id === threadId);
      const index = target?.messages.findIndex(item => item.id === messageId) ?? -1;
      if (index < 0) return null;
      return target.messages.splice(index, 1)[0];
    },
    rename(threadId, title) {
      const target = this.threads.find(item => item.id === threadId);
      if (target) target.title = title;
    },
    emit() {},
  };
  const Composer = {
    setBusy(value) { busyStates.push(Boolean(value)); },
  };
  const sandbox = {
    AgentUI: null,
    Chat: null,
    Composer,
    Music: { song: () => null },
    Overlay: { close() {} },
    Settings: { get: () => false },
    State,
    Toast: { show() {} },
    Voice: null,
    isSolatVoiceSceneActive: () => false,
    clearTimeout,
    console,
    errorText: error => String(error?.message || error),
    icon: () => ({}),
    make: () => ({}),
    performance,
    refreshStatus: async () => {},
    sessionFor: threadId => sessions.get(threadId),
    setStatus: (...args) => statuses.push(args),
    setTimeout,
    text: value => String(value ?? ''),
    titleFrom: value => String(value || 'New conversation'),
    uid: prefix => `${prefix}-${++nextId}`,
    window: { solat: {} },
    $: () => null,
    $$: () => [],
  };
  vm.createContext(sandbox);
  vm.runInContext(`Chat = ${objectLiteral('Chat', 'sessionIds')}`, sandbox);
  vm.runInContext(`AgentUI = ${objectLiteral('AgentUI', 'Music')}`, sandbox);
  sandbox.Chat.render = () => {};
  sandbox.AgentUI.render = () => {};
  sandbox.AgentUI.status = message => statuses.push([message]);
  return { ...sandbox, busyStates, statuses, thread };
}

function event(overrides = {}) {
  return {
    schema_version: 'solat.computer-task-event.v1',
    type: 'started', task_id: 'task-1', session_id: 'session-1', request_id: 'request-1',
    revision: 1, status: 'RUNNING', summary: 'Planning.', tool: null,
    ...overrides,
  };
}

test('matching task cancellation immediately clears chat busy/thinking state', () => {
  const { AgentUI, Chat, busyStates } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-1' });
  Chat.controller = { stopped: false, sequence: 1, threadId: 'thread-1', solatRequestId: 'request-1' };
  Chat.requestId = 1;

  AgentUI.receiveComputerTaskEvent(event({ type: 'started' }));
  AgentUI.receiveComputerTaskEvent(event({ type: 'cancelled', status: 'CANCELLED', revision: 2 }));

  assert.equal(Chat.controller, null);
  assert.equal(Chat.requestId, 2, 'the matching in-flight provider response must be retired');
  assert.equal(busyStates.at(-1), false, 'composer busy/thinking state must clear immediately');
  assert.equal(AgentUI.activeTaskBySession.has('session-1'), false);
});

test('late provider response after cancellation does not create a duplicate assistant bubble', async () => {
  const harness = createHarness();
  const { AgentUI, Chat, State, thread, window } = harness;
  let resolveProvider;
  window.solat.send = () => new Promise(resolve => { resolveProvider = resolve; });

  const pendingSend = Chat.send('Open Notepad and type hello');
  while (!resolveProvider) await new Promise(resolve => setImmediate(resolve));
  const requestId = Chat.controller.solatRequestId;
  AgentUI.receiveComputerTaskEvent(event({ request_id: requestId, type: 'started' }));
  AgentUI.receiveComputerTaskEvent(event({ request_id: requestId, type: 'cancelled', status: 'CANCELLED', revision: 2 }));
  const countBeforeLateResponse = thread.messages.length;

  resolveProvider({ assistant: 'late provider answer', provider: 'local', model: 'qwen', agentActions: [] });
  await pendingSend;

  assert.equal(thread.messages.length, countBeforeLateResponse);
  assert.equal(State.active.messages.some(message => message.content === 'late provider answer'), false);
  assert.equal(thread.messages.filter(message => message.role === 'assistant').length, 1, 'only the task progress/cancellation bubble remains');
});

test('terminal tombstone rejects delayed events from an already finished task', () => {
  const { AgentUI, thread } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-1' });
  AgentUI.receiveComputerTaskEvent(event({ type: 'started' }));
  AgentUI.receiveComputerTaskEvent(event({ type: 'completed', status: 'COMPLETED', revision: 4, summary: 'Done.' }));
  const snapshot = JSON.stringify(thread.messages);

  AgentUI.receiveComputerTaskEvent(event({ type: 'planning', revision: 3, summary: 'Old planning event.' }));
  AgentUI.receiveComputerTaskEvent(event({ type: 'action_verified', revision: 5, summary: 'Delayed action.' }));

  assert.equal(JSON.stringify(thread.messages), snapshot);
  assert.equal(AgentUI.terminalTaskTombstones.has('task-1'), true);
  assert.equal(AgentUI.activeTaskBySession.has('session-1'), false);
});

test('a newer request never accepts progress or terminal content from the older request', () => {
  const { AgentUI, thread } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-old' });
  AgentUI.receiveComputerTaskEvent(event({ request_id: 'request-old', type: 'started' }));
  const oldBubble = JSON.stringify(thread.messages);

  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-new' });
  AgentUI.receiveComputerTaskEvent(event({ request_id: 'request-old', type: 'planning', revision: 2, summary: 'Stale progress.' }));
  AgentUI.receiveComputerTaskEvent(event({ request_id: 'request-old', type: 'completed', status: 'COMPLETED', revision: 3, summary: 'Stale completion.' }));

  assert.equal(JSON.stringify(thread.messages), oldBubble, 'old-request events must not mutate chat content');
  assert.equal(AgentUI.latestRequestBySession.get('session-1'), 'request-new');
  assert.equal(AgentUI.activeTaskBySession.has('session-1'), false, 'the old terminal may retire only its matching old task');
});

test('provider response reconciles into its matching progress bubble without duplication', () => {
  const { AgentUI, State, thread } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-1' });
  AgentUI.receiveComputerTaskEvent(event({ type: 'started' }));
  const finalMessage = State.add(thread.id, {
    role: 'assistant', content: 'Verified final answer', responseMeta: { provider: 'local', mode: 'model' },
  });

  const reconciled = AgentUI.reconcileComputerTaskResponse({
    threadId: thread.id, sessionId: 'session-1', requestId: 'request-1', message: finalMessage,
  });

  assert.equal(thread.messages.filter(message => message.role === 'assistant').length, 1);
  assert.equal(reconciled.content, 'Verified final answer');
  assert.equal(reconciled.responseMeta.computerTaskId, 'task-1');
  assert.equal(thread.messages[0].id, reconciled.id, 'the durable progress bubble is updated rather than duplicated');
});

test('terminal approval result removes matching progress and blocks its delayed event', () => {
  const { AgentUI, State, thread } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-1' });
  const placeholder = State.add(thread.id, {
    role: 'assistant', content: 'Waiting for approval', responseMeta: { mode: 'agent_pending' },
  });
  AgentUI.receiveComputerTaskEvent(event({ type: 'started' }));
  assert.equal(thread.messages.length, 2);

  AgentUI.pending = {
    threadId: thread.id, sessionId: 'session-1', requestId: 'request-1',
    computerTaskId: 'task-1', messageId: placeholder.id,
  };
  AgentUI.addChatResult('Verified terminal result', false, null, null, 'COMPLETED');
  assert.equal(thread.messages.length, 1, 'the matching progress bubble must be removed');
  assert.equal(thread.messages[0].content, 'Verified terminal result');
  assert.equal(thread.messages[0].responseMeta.computerTaskRequestId, 'request-1');
  assert.equal(AgentUI.terminalTaskTombstones.has('task-1'), true);

  AgentUI.receiveComputerTaskEvent(event({ type: 'observation_ready', revision: 2, summary: 'Delayed read.' }));
  assert.equal(thread.messages.length, 1, 'a delayed event must not recreate progress after terminal truth');
});

test('a revised request on the same task gets a new progress bubble after its user message', () => {
  const { AgentUI, State, thread } = createHarness();
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-old' });
  AgentUI.receiveComputerTaskEvent(event({ request_id: 'request-old', type: 'started' }));
  const oldProgress = thread.messages[0];

  State.add(thread.id, { role: 'user', content: 'เปิดโปรแกรมนั้นแล้วทำต่อให้หน่อย' });
  AgentUI.beginRequest({ sessionId: 'session-1', requestId: 'request-new' });
  AgentUI.receiveComputerTaskEvent(event({
    request_id: 'request-new', type: 'replanned', revision: 2, summary: 'Replanning the newer request.',
  }));
  AgentUI.receiveComputerTaskEvent(event({
    request_id: 'request-new', type: 'needs_clarification', status: 'NEEDS_CLARIFICATION', revision: 3,
    summary: 'Please specify which program you mean.',
  }));

  assert.equal(oldProgress.content, 'Planning.', 'the older request bubble must remain unchanged');
  assert.deepEqual(thread.messages.map(message => message.role), ['assistant', 'user', 'assistant']);
  assert.equal(thread.messages.at(-1).content, 'Please specify which program you mean.');
  assert.equal(thread.messages.at(-1).responseMeta.computerTaskRequestId, 'request-new');
  assert.notEqual(thread.messages.at(-1).id, oldProgress.id);
});
