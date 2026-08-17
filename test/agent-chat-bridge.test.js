const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');

const definitions = [
  { type: 'function', function: { name: 'read_tool', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'write_tool', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } },
];

test('agent chat bridge runs reads and pauses writes with one-time approval metadata', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-agent-chat-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  const registry = {
    read_tool: { side_effect_level: 'read', validate_arguments: () => true, validate_output: result => result.status === 'ready' },
    write_tool: { side_effect_level: 'write', validate_arguments: args => typeof args.value === 'string', validate_output: result => result.status === 'ready' },
  };
  const service = new AgentService({ rootDir, toolRegistry: registry, executeTool: async ({ tool }) => ({ status: 'ready', tool }) });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: definitions });
  const read = await bridge.execute({ sessionId: 'owner', requestId: 'r1', call: { name: 'read_tool', arguments: {} } });
  assert.equal(read.model_result.status, 'ready');
  assert.equal(read.action, null);
  const write = await bridge.execute({ sessionId: 'owner', requestId: 'r2', call: { name: 'write_tool', arguments: { value: 'hello' } } });
  assert.equal(write.model_result.status, 'confirmation_required');
  assert.equal(write.action.status, 'confirmation_required');
  assert.ok(write.action.approval_token);
  assert.equal(JSON.stringify(write.model_result).includes(write.action.approval_token), false);
});

test('agent chat bridge grants the bounded YouTube workflow a longer step timeout only', async () => {
  const created = [];
  const service = {
    async createPlan(input) { created.push(input); return { approval_token: 'once' }; },
    async run() { return { plan: { status: 'PAUSED_APPROVAL', plan_id: 'plan-youtube' } }; },
  };
  const bridge = new AgentChatBridge({
    agentService: service,
    toolDefinitions: [{ type: 'function', function: { name: 'computer_play_youtube_music', parameters: { type: 'object' } } }],
  });
  await bridge.execute({ sessionId: 'owner', requestId: 'music', call: { name: 'computer_play_youtube_music', arguments: { query: 'Lllies' } } });
  assert.equal(created[0].limits.timeoutMs, 90_000);
});

test('one task authorization reuses approval only inside its bounded scope', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-task-grant-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  let executions = 0;
  const registry = {
    write_tool: { side_effect_level: 'write', validate_arguments: args => typeof args.value === 'string', validate_output: result => result.status === 'ready' },
  };
  const service = new AgentService({ rootDir, toolRegistry: registry, executeTool: async () => { executions += 1; return { status: 'ready', verified: true }; } });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: definitions });
  const authorization = bridge.issueTaskAuthorization({
    sessionId: 'owner', taskId: 'task-1', instructionRevision: 1,
    scope: { allowed_tools: ['write_tool'] }, maxWrites: 2,
  });
  const result = await bridge.execute({
    sessionId: 'owner', requestId: 'auto-1', taskAuthorization: authorization,
    call: { name: 'write_tool', arguments: { value: 'safe value' } },
  });
  assert.equal(result.approval_reused, true);
  assert.equal(result.model_result.status, 'ready');
  assert.equal(executions, 1);
  const crossSession = await bridge.execute({
    sessionId: 'other', requestId: 'auto-2', taskAuthorization: authorization,
    call: { name: 'write_tool', arguments: { value: 'safe value' } },
  });
  assert.equal(crossSession.model_result.status, 'confirmation_required');
  assert.equal(executions, 1);
});

test('task authorization fails closed when an approved HWND is reused by another process', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-target-grant-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  let currentTarget = { hwnd: 42, process_id: 1001, process_name: 'chrome', window_title: 'Diana King - Google Search' };
  const toolDefinitions = [{ type: 'function', function: { name: 'computer_invoke', parameters: { type: 'object' } } }];
  const registry = { computer_invoke: { side_effect_level: 'write', validate_arguments: () => true, validate_output: result => result.status === 'ready' } };
  const service = new AgentService({ rootDir, toolRegistry: registry, executeTool: async () => ({ status: 'ready', operation: 'invoke', verified: true }) });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions, targetResolver: async () => currentTarget });
  const authorization = bridge.issueTaskAuthorization({
    sessionId: 'owner', taskId: 'task-target', instructionRevision: 1,
    scope: { allowed_tools: ['computer_invoke'], allowed_hwnds: [42], allowed_targets: [currentTarget] },
  });
  const call = { name: 'computer_invoke', arguments: { hwnd: 42, selector: 'safe-link' } };
  const first = await bridge.execute({ sessionId: 'owner', requestId: 'target-1', call, taskAuthorization: authorization });
  assert.equal(first.approval_reused, true);
  currentTarget = { ...currentTarget, process_id: 2002 };
  await assert.rejects(
    () => bridge.execute({ sessionId: 'owner', requestId: 'target-2', call, taskAuthorization: authorization }),
    error => error.code === 'target_identity_changed',
  );
});

test('generic window discovery never expands a task authorization', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-window-discovery-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  let currentTarget = { hwnd: 73, process_id: 9001, process_name: 'chrome', window_title: 'Diana King - Google Search' };
  const toolDefinitions = [{ type: 'function', function: { name: 'computer_invoke', parameters: { type: 'object' } } }];
  const registry = { computer_invoke: { side_effect_level: 'write', validate_arguments: () => true, validate_output: result => result.status === 'ready' } };
  const service = new AgentService({ rootDir, toolRegistry: registry, executeTool: async () => ({ status: 'ready', operation: 'invoke', verified: true }) });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions, targetResolver: async () => currentTarget });
  const authorization = bridge.issueTaskAuthorization({
    sessionId: 'owner', taskId: 'task-discovery', instructionRevision: 1,
    scope: { allowed_tools: ['computer_invoke'], allowed_apps: ['chrome'] },
  });

  bridge.refreshTaskAuthorizationTargets({
    authorization, sessionId: 'owner',
    targets: [currentTarget, { hwnd: 99, process_id: 9002, process_name: 'notepad', window_title: 'Notes' }],
  });
  const chromeWindow = await bridge.execute({
    sessionId: 'owner', requestId: 'allowed-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 73, selector: 'wikipedia-link' } },
  });
  assert.equal(chromeWindow.model_result.status, 'confirmation_required');

  currentTarget = { hwnd: 99, process_id: 9002, process_name: 'notepad', window_title: 'Notes' };
  const blocked = await bridge.execute({
    sessionId: 'owner', requestId: 'blocked-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 99, selector: 'safe-button' } },
  });
  assert.equal(blocked.model_result.status, 'confirmation_required');
});

test('one approval covers same-process windows discovered during the task but never sensitive ones', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-one-approval-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  const approved = { hwnd: 73, process_id: 9001, process_name: 'chrome', title: 'Google' };
  const sibling = { hwnd: 74, process_id: 9001, process_name: 'chrome', title: 'Google - Google Chrome' };
  const bank = { hwnd: 75, process_id: 9001, process_name: 'chrome', title: 'Bank login' };
  const other = { hwnd: 99, process_id: 9002, process_name: 'notepad', title: 'Notes' };
  const identities = new Map([[73, approved], [74, sibling], [75, bank], [99, other]]);
  const toolDefinitions = [{ type: 'function', function: { name: 'computer_invoke', parameters: { type: 'object' } } }];
  const registry = { computer_invoke: { side_effect_level: 'write', validate_arguments: () => true, validate_output: result => result.status === 'ready' } };
  const service = new AgentService({ rootDir, toolRegistry: registry, executeTool: async () => ({ status: 'ready', operation: 'invoke', verified: true }) });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions, targetResolver: async ({ hwnd }) => identities.get(Number(hwnd)) });
  const authorization = bridge.issueTaskAuthorization({
    sessionId: 'owner', taskId: 'task-one-approval', instructionRevision: 1,
    scope: { allowed_tools: ['computer_invoke'], allowed_targets: [approved] },
  });
  bridge.refreshTaskAuthorizationTargets({ authorization, sessionId: 'owner', targets: [approved, sibling, bank, other] });
  const sameProcess = await bridge.execute({
    sessionId: 'owner', requestId: 'sibling-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 74, selector: 'search-box' } },
  });
  assert.equal(sameProcess.approval_reused, true);
  // A benign retitle (page finished loading) must not void the one approval.
  identities.set(74, { ...sibling, title: 'SOLAT - Google Search' });
  const retitled = await bridge.execute({
    sessionId: 'owner', requestId: 'retitled-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 74, selector: 'search-box' } },
  });
  assert.equal(retitled.approval_reused, true);
  // ...but the same HWND navigated to a sensitive page fails closed.
  identities.set(74, { ...sibling, title: 'Bank login' });
  await assert.rejects(
    () => bridge.execute({
      sessionId: 'owner', requestId: 'navigated-sensitive', taskAuthorization: authorization,
      call: { name: 'computer_invoke', arguments: { hwnd: 74, selector: 'search-box' } },
    }),
    error => error.code === 'sensitive_target',
  );
  identities.set(74, sibling);
  const sensitive = await bridge.execute({
    sessionId: 'owner', requestId: 'bank-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 75, selector: 'safe-button' } },
  });
  assert.equal(sensitive.model_result.status, 'confirmation_required');
  const crossProcess = await bridge.execute({
    sessionId: 'owner', requestId: 'other-window', taskAuthorization: authorization,
    call: { name: 'computer_invoke', arguments: { hwnd: 99, selector: 'safe-button' } },
  });
  assert.equal(crossProcess.model_result.status, 'confirmation_required');
});
