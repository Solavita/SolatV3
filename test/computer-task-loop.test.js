const test = require('node:test');
const assert = require('node:assert/strict');
const { ComputerTaskLoop, ComputerTaskLoopError, compactObservationForModel, uiaNeedsVision, validateVisualFallbackStep } = require('../src/core/computer-task-loop');
const { ModelRouter } = require('../src/core/model-router');

test('vision fallback is needed only when UI Automation has no meaningful content', () => {
  assert.equal(uiaNeedsVision({ selector: 'root', type: 'Pane', children: [{ type: 'Canvas' }] }), true);
  assert.equal(uiaNeedsVision({ selector: 'display', name: 'Display is 0', type: 'Text' }), false);
  assert.equal(uiaNeedsVision({ selector: 'password', name: 'Password', type: 'Edit' }), false);
});

test('computer observations sent to the planner omit geometry but preserve semantic state', () => {
  const compact = compactObservationForModel({
    source: 'verified_read_result',
    tool: 'computer_inspect',
    data: { tree: { windows: [{ hwnd: 42, title: 'Calculator', x: 10, y: 20, className: 'ApplicationFrame', elements: [{ name: 'Display is 0', selector: 'CalculatorResults', value: '0', width: 300, toggleState: 'off' }] }] } },
  });
  const serialized = JSON.stringify(compact);
  assert.match(serialized, /Display is 0/u);
  assert.match(serialized, /CalculatorResults/u);
  assert.doesNotMatch(serialized, /className|width|"x"|"y"/u);
});

test('browser workspace observations preserve opaque semantic targets but omit geometry', () => {
  const compact = compactObservationForModel({
    source: 'verified_read_result', tool: 'browser_workspace_observe',
    data: { schema_version: 'solat.browser-observation.v1', surface_id: 'surface-1', navigation_revision: 2, items: [{ target_id: 'e1', role: 'button', name: 'Continue', disabled: false, editable: false, bounds: { x: 10, y: 20, width: 100, height: 30 } }] },
  });
  const serialized = JSON.stringify(compact);
  assert.match(serialized, /surface-1|navigation_revision|target_id|Continue/u);
  assert.doesNotMatch(serialized, /"x"|"y"|"width"|"height"/u);
});

test('browser mutation is replaced by a current semantic observation before approval', async () => {
  const browserRegistry = {
    browser_workspace_observe: { side_effect_level: 'read', validate_arguments: value => typeof value.surface_id === 'string', validate_output: value => value?.schema_version === 'solat.browser-observation.v1' },
    browser_workspace_click: { side_effect_level: 'write', task_grant_eligible: false, validate_arguments: value => typeof value.surface_id === 'string' && Number.isInteger(value.navigation_revision) && typeof value.target_id === 'string' && value.verify === 'navigation', validate_output: value => value?.verified === true },
  };
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Click the observed result.', tool: 'browser_workspace_click', arguments: { surface_id: 'surface-1', navigation_revision: 1, target_id: 'e1', verify: 'navigation' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Click the current result.', tool: 'browser_workspace_click', arguments: { surface_id: 'surface-1', navigation_revision: 1, target_id: 'e1', verify: 'navigation' } } },
  ];
  const calls = [];
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return outputs.shift(); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call.name);
        if (call.name === 'browser_workspace_observe') return { model_result: { schema_version: 'solat.browser-observation.v1', status: 'ready', verified: true, surface_id: 'surface-1', navigation_revision: 1, items: [{ target_id: 'e1', role: 'link', name: 'Open' }] } };
        return { action: { status: 'confirmation_required', idempotency_key: 'browser-click', approval_token: 'once', arguments: call.arguments } };
      },
    },
    toolRegistry: browserRegistry, idFactory: () => 'browser-prerequisite',
  });
  const result = await loop.start({ ownerId: 'renderer:7', sessionId: 'thread-a', requestId: 'browser-request', goal: 'Open the result in the browser workspace.' });
  assert.equal(result.status, 'AWAITING_APPROVAL', JSON.stringify(result));
  assert.equal(result.pending_action.tool, 'browser_workspace_click');
  assert.deepEqual(calls, ['browser_workspace_observe', 'browser_workspace_click']);
});

function registry() {
  return {
    computer_list_windows: { side_effect_level: 'read', validate_arguments: value => Object.keys(value).length === 0, validate_output: value => value?.status === 'ready' },
    computer_inspect: { side_effect_level: 'read', validate_arguments: value => Number.isInteger(value.hwnd) && (value.interactive_only === undefined || typeof value.interactive_only === 'boolean'), validate_output: value => value?.status === 'ready' && Boolean(value.tree) },
    computer_invoke: { side_effect_level: 'write', validate_arguments: value => Number.isInteger(value.hwnd) && typeof value.selector === 'string', validate_output: value => value?.status === 'ready' && value.verified === true },
    computer_set_value: { side_effect_level: 'write', validate_arguments: value => Number.isInteger(value.hwnd) && typeof value.selector === 'string' && typeof value.value === 'string', validate_output: value => value?.status === 'ready' && value.verified === true },
    computer_open_website: { side_effect_level: 'write', validate_arguments: value => ['google', 'roblox'].includes(value?.site), validate_output: value => value?.status === 'ready' && value.verified === true },
  };
}

function routedComputerProvider(outputs, physicalCalls) {
  const status = model => () => ({ provider: 'qwencloud_text', model, configured: true, baseHost: 'dashscope.example' });
  return new ModelRouter({
    flashProvider: {
      status: status('qwen3.7-flash'),
      async completeStructured() {
        physicalCalls.push('flash');
        return { data: outputs.shift(), provider: 'qwencloud_text', model: 'qwen3.7-flash' };
      },
    },
    plusProvider: {
      status: status('qwen3.7-plus'),
      async complete() {
        physicalCalls.push('plus');
        return { content: 'Use verified observations one step at a time.', provider: 'qwencloud_text', model: 'qwen3.7-plus' };
      },
    },
    logger: null,
  });
}

test('computer task counts physical Plus and Flash attempts while reusing task-scoped advice', async () => {
  const physicalCalls = [];
  const outputs = [
    { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} },
    { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'More detail is required.', tool: 'none', arguments: {} },
  ];
  const loop = new ComputerTaskLoop({
    provider: routedComputerProvider(outputs, physicalCalls),
    bridge: {
      owns: () => true,
      async execute() { return { model_result: { status: 'ready', windows: [{ hwnd: 7, title: 'Chrome' }] } }; },
    },
    toolRegistry: registry(), idFactory: () => 'physical-count',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'request', goal: 'Open Chrome, inspect it, then switch to Notepad and report the result.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(result.provider_calls, 3);
  assert.deepEqual(physicalCalls, ['plus', 'flash', 'flash']);
  assert.doesNotMatch(JSON.stringify(result), /advisory|advice|entries|instruction_revision.*Map/iu);
});

test('computer task enforces the physical provider cap before the next adapter call', async () => {
  const physicalCalls = [];
  const outputs = [
    { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} },
    { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Stop.', tool: 'none', arguments: {} },
  ];
  const loop = new ComputerTaskLoop({
    provider: routedComputerProvider(outputs, physicalCalls),
    bridge: {
      owns: () => true,
      async execute() { return { model_result: { status: 'ready', windows: [{ hwnd: 7, title: 'Chrome' }] } }; },
    },
    toolRegistry: registry(), idFactory: () => 'physical-cap', limits: { maxProviderCalls: 2 },
  });
  await assert.rejects(
    loop.start({ ownerId: 'owner', requestId: 'request', goal: 'Open Chrome, inspect it, then switch to Notepad and report the result.' }),
    error => error.code === 'provider_budget_exceeded'
      && error.computer_task_terminal?.provider_calls === 2,
  );
  assert.deepEqual(physicalCalls, ['plus', 'flash']);
});

test('structured repair reuses cached Plus advice and counts every Flash attempt', async () => {
  const physicalCalls = [];
  const outputs = [
    { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Invalid.', tool: 'computer_shell', arguments: {} },
    { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Need a safe target.', tool: 'none', arguments: {} },
  ];
  const loop = new ComputerTaskLoop({
    provider: routedComputerProvider(outputs, physicalCalls),
    bridge: { owns: () => true, async execute() { throw new Error('An invalid model step must not execute.'); } },
    toolRegistry: registry(), idFactory: () => 'structured-repair',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'request', goal: 'Open Chrome, inspect it, then switch to Notepad and report the result.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(result.provider_calls, 3);
  assert.deepEqual(physicalCalls, ['plus', 'flash', 'flash']);
});

test('revising a computer task rotates its advisory cache', async () => {
  const physicalCalls = [];
  const outputs = [
    { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } },
    { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Need a new target.', tool: 'none', arguments: {} },
  ];
  const loop = new ComputerTaskLoop({
    provider: routedComputerProvider(outputs, physicalCalls),
    bridge: {
      owns: () => true,
      async execute() { return { action: { status: 'confirmation_required', idempotency_key: 'pending-key', approval_token: 'once' } }; },
      async cancelAction() {},
    },
    toolRegistry: registry(), idFactory: () => 'cache-revision',
  });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'one', goal: 'Open Chrome, then switch to Notepad and inspect it.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  const revised = await loop.revise({ ownerId: 'owner', sessionId: 'session', requestId: 'two', instruction: 'Open Chrome, then switch to Notepad and report it.' });
  assert.equal(revised.status, 'NEEDS_CLARIFICATION');
  assert.equal(revised.instruction_revision, 2);
  assert.equal(revised.provider_calls, 4);
  assert.deepEqual(physicalCalls, ['plus', 'flash', 'plus', 'flash']);
});

test('computer planner receives the full registered capability catalog', async () => {
  let plannerMessages;
  let providerCalls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured(messages) {
        plannerMessages = messages;
        providerCalls += 1;
        return { data: {
          schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Roblox.',
          tool: 'computer_open_website', arguments: { site: 'roblox' },
        } };
      },
    },
    bridge: {
      owns: () => true,
      async execute() {
        return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'catalog-1', approval_token: 'once', arguments: { site: 'roblox' } } };
      },
    },
    toolRegistry: registry(),
    toolDefinitions: [
      { type: 'function', function: { name: 'computer_list_windows', description: 'List visible windows.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
      { type: 'function', function: { name: 'computer_open_website', description: 'Open an allowlisted site.', parameters: { type: 'object', properties: { site: { type: 'string', enum: ['roblox'] } }, required: ['site'], additionalProperties: false } } },
    ],
    idFactory: () => 'catalog-task',
  });
  const result = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'catalog', goal: 'Open Roblox' });
  assert.equal(result.status, 'AWAITING_APPROVAL', result.summary);
  const systemPrompt = plannerMessages.find(message => message.role === 'system')?.content || '';
  assert.match(systemPrompt, /computer_list_windows/u);
  assert.match(systemPrompt, /List visible windows/u);
  assert.match(systemPrompt, /"roblox"/u);
});

test('deterministic Chrome search fast path uses no model round-trip', async () => {
  let providerCalls = 0;
  const fastRegistry = registry();
  fastRegistry.computer_search_web = {
    side_effect_level: 'write', task_grant_origin: true,
    validate_arguments: value => value?.query === 'Diana King',
    validate_output: value => value?.status === 'ready' && value?.operation === 'search_web' && value?.verified === true,
  };
  const bridge = {
    owns: name => name === 'computer_search_web',
    async execute({ call }) {
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'fast-search-1', approval_token: 'once', arguments: call.arguments } };
    },
  };
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { providerCalls += 1; throw new Error('model must not run'); } },
    bridge, toolRegistry: fastRegistry, idFactory: () => 'fast-search',
  });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'fast', goal: 'Open Chrome and search Diana King', workflowHint: { workflow: 'web_search', query: 'Diana King' } });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.pending_action.tool, 'computer_search_web');
  assert.equal(providerCalls, 0);
  const completed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'fast-search-1',
    verifiedObservation: { status: 'ready', operation: 'search_web', query: 'Diana King', verified: true, hwnd: 42 },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(providerCalls, 0);
});

test('a failed read observation emits a terminal failed event with its real cause', async () => {
  const events = [];
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        return { data: {
          schema_version: 'solat.computer-task-step.v1',
          status: 'action', summary: 'Read visible windows.',
          tool: 'computer_list_windows', arguments: {},
        } };
      },
    },
    bridge: {
      owns: () => true,
      async execute() {
        return { model_result: { status: 'failed', error: { code: 'window_stale', message: 'The target disappeared.' } }, action: null };
      },
    },
    toolRegistry: registry(), idFactory: () => 'read-failure',
  });
  const result = await loop.start({
    ownerId: 'owner', sessionId: 'session', requestId: 'read-failure', goal: 'Inspect the visible app.',
    eventSink: event => events.push(event),
  });
  assert.equal(result.status, 'FAILED');
  assert.match(result.summary, /window_stale.*target disappeared/iu);
  assert.equal(events.at(-1)?.type, 'failed');
  assert.equal(events.at(-1)?.status, 'FAILED');
});

test('deterministic Notepad text workflow launches, inspects, writes and verifies with no model round-trip', async () => {
  let providerCalls = 0;
  const calls = [];
  const auth = { id: 'notepad-grant', task_id: 'computer_notepad-fast', instruction_revision: 1 };
  const fastRegistry = registry();
  fastRegistry.computer_launch_app = {
    side_effect_level: 'write', task_grant_origin: true,
    validate_arguments: value => value?.app_id === 'notepad',
    validate_output: value => value?.status === 'ready' && value?.operation === 'launch_app' && value?.verified === true,
  };
  fastRegistry.computer_set_value.task_grant_eligible = true;
  const bridge = {
    owns: () => true,
    issueTaskAuthorization() { return auth; },
    refreshTaskAuthorizationTargets() {},
    extendTaskAuthorization() {},
    async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      calls.push(call);
      if (call.name === 'computer_launch_app') {
        return { action: { status: 'confirmation_required', idempotency_key: 'notepad-open', approval_token: 'once', arguments: call.arguments } };
      }
      if (call.name === 'computer_list_windows') {
        return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Untitled - Notepad', process_id: 8, process_name: 'notepad' }] } };
      }
      if (call.name === 'computer_inspect') {
        assert.equal(call.arguments.interactive_only, false);
        return { model_result: { status: 'ready', operation: 'inspect', hwnd: 42, target: { hwnd: 42 }, tree: { windows: [{ elements: [{ type: 'Window', children: [{ type: 'Pane', children: [{ type: 'Document', name: 'Text editor', selector: 'doc-texteditor-real', value: 'EXISTING' }] }] }] }] } } };
      }
      assert.equal(taskAuthorization, auth);
      assert.equal(call.name, 'computer_set_value');
      assert.equal(call.arguments.value, 'EXISTING\nSOLAT COMPUTER TEST');
      return { model_result: { status: 'ready', operation: 'set_value', hwnd: 42, verified: true }, action: null };
    },
  };
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { providerCalls += 1; throw new Error('model must not run'); } },
    bridge, toolRegistry: fastRegistry, idFactory: () => 'notepad-fast',
  });
  const waiting = await loop.start({
    ownerId: 'owner', sessionId: 'session', requestId: 'notepad-fast', goal: 'Open Notepad and append SOLAT COMPUTER TEST.',
    workflowHint: { workflow: 'notepad_text', text: 'SOLAT COMPUTER TEST', mode: 'append' },
  });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.pending_action.tool, 'computer_launch_app');
  const completed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'notepad-open',
    verifiedObservation: { status: 'ready', operation: 'launch_app', hwnd: 42, launched: true, verified: true, target: { hwnd: 42, process_id: 8, process_name: 'notepad', window_title: 'Untitled - Notepad' } },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.provider_calls, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(calls.map(call => call.name), ['computer_launch_app', 'computer_list_windows', 'computer_inspect', 'computer_set_value']);
});

test('cross-app search uses one model step then deterministically returns to Notepad', async () => {
  let providerCalls = 0;
  const calls = [];
  const fastRegistry = registry();
  fastRegistry.computer_search_web = {
    side_effect_level: 'write', task_grant_origin: true,
    validate_arguments: value => value?.query === 'TypeScript',
    validate_output: value => value?.status === 'ready' && value?.operation === 'search_web' && value?.verified === true,
  };
  const auth = { id: 'cross-app-grant', task_id: 'computer_cross-app', instruction_revision: 1 };
  const bridge = {
    owns: () => true,
    issueTaskAuthorization() { return auth; },
    refreshTaskAuthorizationTargets() {},
    async revokeTaskAuthorization() { return true; },
    async execute({ call }) {
      calls.push(call);
      if (call.name === 'computer_search_web') {
        return { action: { status: 'confirmation_required', idempotency_key: 'cross-search', approval_token: 'once', arguments: call.arguments } };
      }
      if (call.name === 'computer_list_windows') {
        return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Notes - Notepad', process_id: 8, process_name: 'notepad' }] } };
      }
      if (call.name === 'computer_inspect') {
        assert.equal(call.arguments.interactive_only, false);
        return { model_result: { status: 'ready', operation: 'inspect', hwnd: 42, target: { hwnd: 42 }, tree: { elements: [{ type: 'Document', selector: 'editor', value: 'unchanged' }] } } };
      }
      throw new Error(`unexpected tool ${call.name}`);
    },
  };
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        providerCalls += 1;
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows first.', tool: 'computer_list_windows', arguments: {} } };
      },
    },
    bridge, toolRegistry: fastRegistry, idFactory: () => 'cross-app',
  });
  const waiting = await loop.start({
    ownerId: 'owner', sessionId: 'session', requestId: 'cross-app',
    goal: 'เปิด Chrome ค้นหา TypeScript แล้วกลับไปที่ Notepad โดยไม่แก้ข้อความเดิม',
    workflowHint: { workflow: 'web_search_return_notepad', query: 'TypeScript' },
  });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.pending_action.tool, 'computer_search_web');
  const completed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'cross-search',
    verifiedObservation: { status: 'ready', operation: 'search_web', query: 'TypeScript', verified: true, hwnd: 91, process_id: 9, process_name: 'chrome', window_title: 'TypeScript - Google Search' },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(providerCalls, 1);
  assert.deepEqual(calls.map(call => call.name), ['computer_list_windows', 'computer_search_web', 'computer_list_windows', 'computer_inspect']);
});

test('ambiguous Chrome versus Notepad comparison asks for the missing work instead of exposing a schema error', async () => {
  let providerCalls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        providerCalls += 1;
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: { visible_only: true } } };
      },
    },
    bridge: { owns: () => true, async execute() { throw new Error('no tool should run for invalid model arguments'); } },
    toolRegistry: registry(), idFactory: () => 'ambiguous-window',
  });
  const result = await loop.start({
    ownerId: 'owner', sessionId: 'session', requestId: 'ambiguous-window',
    goal: 'ดูหน้าต่างทั้งหมด เปรียบเทียบว่า Chrome หรือ Notepad เหมาะกับงานที่ค้างอยู่มากกว่า',
  });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.match(result.summary, /Chrome|Notepad/u);
  assert.equal(providerCalls, 1);
});

test('computer task loop lets the model inspect first then pauses a write for approval', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Read visible windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect the browser.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Physics.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'physics-link' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Refresh visible windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Verify Physics is open.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'Physics is open.', tool: 'none', arguments: {}, evidence_sequences: [3, 5] } },
  ];
  const calls = [];
  const bridge = {
    owns: () => true,
    async execute({ call }) {
      calls.push(call);
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Google Classroom' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 42 }, tree: { elements: [{ name: 'Physics', selector: 'physics-link' }] } } };
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'step-3', approval_token: 'once' } };
    },
  };
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: registry(), idFactory: () => 'task-1' });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'r1', goal: 'Open Physics in Classroom.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.observation_count, 2);
  assert.equal(waiting.pending_action.tool, 'computer_invoke');
  assert.deepEqual(calls.map(call => call.name), ['computer_list_windows', 'computer_inspect', 'computer_invoke']);
  const completed = await loop.continue({ ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'step-3', verifiedObservation: { status: 'ready', operation: 'invoke', verified: true } });
  assert.equal(completed.status, 'COMPLETED');
});

test('one owner approval lets later low-risk writes continue inside the same bounded task', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List the approved browser window.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect the approved browser window.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Use the observed safe control.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'search', verify_selector: 'results', verify_state: 'present' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Refresh the browser target.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Verify the final page.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'The bounded browser task completed.', tool: 'none', arguments: {}, evidence_sequences: [4, 6] } },
  ];
  let confirmations = 0;
  let autoWrites = 0;
  const authorizations = new Map();
  const bridge = {
    owns: () => true,
    issueTaskAuthorization(input) { const auth = { id: 'grant-1', task_id: input.taskId, instruction_revision: input.instructionRevision }; authorizations.set(auth.id, auth); return auth; },
    extendTaskAuthorization() {},
    async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Google', process_id: 8, process_name: 'chrome' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', hwnd: 42, target: { hwnd: 42 }, tree: { elements: [{ selector: 'search', name: 'Search' }, { selector: 'results', name: 'Results' }] } } };
      if (taskAuthorization && authorizations.has(taskAuthorization.id)) {
        autoWrites += 1;
        return { model_result: { status: 'ready', operation: 'invoke', hwnd: 42, verified: true }, action: null, approval_reused: true };
      }
      confirmations += 1;
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'first-write', approval_token: 'once', arguments: call.arguments } };
    },
  };
  const grantRegistry = registry();
  grantRegistry.computer_open_website.task_grant_origin = true;
  grantRegistry.computer_invoke.task_grant_eligible = true;
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: grantRegistry, idFactory: () => 'one-approval' });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'one-approval', goal: 'Open Chrome and search Google.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.pending_action.action.approval_scope, 'computer_task');
  const completed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'first-write',
    verifiedObservation: { status: 'ready', operation: 'open_website', site: 'google', hwnd: 42, process_id: 8, app_id: 'chrome', window_title: 'Google', verified: true },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(confirmations, 1);
  assert.equal(autoWrites, 1);
});

test('a failed automatically approved write keeps its real cause visible', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect the window.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Use the search control.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'search', verify_selector: 'search', verify_state: 'present' } } },
  ];
  const authorizations = new Map();
  const bridge = {
    owns: () => true,
    issueTaskAuthorization(input) { const auth = { id: 'grant-fail', task_id: input.taskId, instruction_revision: input.instructionRevision }; authorizations.set(auth.id, auth); return auth; },
    extendTaskAuthorization() {},
    async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Google', process_id: 8, process_name: 'chrome' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 42 }, tree: { elements: [{ selector: 'search', name: 'Search' }] } } };
      if (taskAuthorization && authorizations.has(taskAuthorization.id)) {
        return { model_result: { status: 'failed', tool: call.name, error: { code: 'computer_tool_failed', message: '{"error":{"code":"internal_error"}}' } }, action: null };
      }
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'first-write', approval_token: 'once', arguments: call.arguments } };
    },
  };
  const grantRegistry = registry();
  grantRegistry.computer_open_website.task_grant_origin = true;
  grantRegistry.computer_invoke.task_grant_eligible = true;
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: grantRegistry, idFactory: () => 'fail-visible' });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'fail-visible', goal: 'Open Google and search.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  const failed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'first-write',
    verifiedObservation: { status: 'ready', operation: 'open_website', site: 'google', hwnd: 42, process_id: 8, app_id: 'chrome', window_title: 'Google', verified: true },
  });
  assert.equal(failed.status, 'FAILED');
  assert.match(failed.summary, /computer_tool_failed/, 'the owner-visible failure must keep the real adapter cause');
});

test('approval scope is bound to the approved call and verified result, never to goal keywords', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect the approved window.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Use the observed safe control.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'search', verify_selector: 'results', verify_state: 'present' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Refresh the target.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Verify the final page.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'Done.', tool: 'none', arguments: {}, evidence_sequences: [4, 6] } },
  ];
  let issuedScope = null;
  const authorizations = new Map();
  const bridge = {
    owns: () => true,
    issueTaskAuthorization(input) { issuedScope = input.scope; const auth = { id: 'grant-scope', task_id: input.taskId, instruction_revision: input.instructionRevision }; authorizations.set(auth.id, auth); return auth; },
    extendTaskAuthorization() {}, async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Google', process_id: 8, process_name: 'chrome' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', hwnd: 42, target: { hwnd: 42 }, tree: { elements: [{ selector: 'search', name: 'Search' }, { selector: 'results', name: 'Results' }] } } };
      if (taskAuthorization && authorizations.has(taskAuthorization.id)) return { model_result: { status: 'ready', operation: 'invoke', hwnd: 42, verified: true }, action: null, approval_reused: true };
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'scope-write', approval_token: 'once', arguments: call.arguments } };
    },
  };
  const grantRegistry = registry();
  grantRegistry.computer_open_website.task_grant_origin = true;
  grantRegistry.computer_invoke.task_grant_eligible = true;
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: grantRegistry, idFactory: () => 'scope-task' });
  // The goal mentions other apps and sites; none of those keywords may
  // widen what the owner is actually approving.
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'scope', goal: 'Open Chrome, then also use Notepad, YouTube, and Classroom later.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  const granted = waiting.pending_action.action.granted_scope;
  assert.deepEqual(granted.allowed_sites, ['google']);
  assert.deepEqual(granted.allowed_apps, []);
  assert.deepEqual(granted.allowed_hwnds, []);
  assert.deepEqual(granted.allowed_targets, []);
  assert.ok(granted.allowed_tools.includes('computer_invoke'));
  const completed = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id, actionIdempotencyKey: 'scope-write',
    verifiedObservation: { status: 'ready', operation: 'open_website', site: 'google', hwnd: 42, process_id: 8, app_id: 'chrome', window_title: 'Google', verified: true },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.deepEqual(issuedScope.allowed_sites, ['google']);
  assert.deepEqual(issuedScope.allowed_apps, []);
  assert.deepEqual(issuedScope.allowed_hwnds, [42]);
  assert.ok(issuedScope.allowed_targets.some(target => target.hwnd === 42 && target.process_name === 'chrome'));
});

test('task authorization never auto-runs a freshly observed high-risk control', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect page.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Delete item.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'delete-item', verify_selector: 'gone', verify_state: 'gone' } } },
  ];
  let confirmations = 0;
  let authorization;
  const bridge = {
    owns: () => true,
    issueTaskAuthorization(input) { authorization = { id: 'grant-risk', task_id: input.taskId, instruction_revision: input.instructionRevision }; return authorization; },
    extendTaskAuthorization() {}, async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Chrome' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 42 }, tree: { elements: [{ selector: 'delete-item', name: 'Delete item', controlType: 'Button' }] } } };
      if (taskAuthorization) return { model_result: { status: 'ready', operation: call.name, verified: true }, action: null, approval_reused: true };
      confirmations += 1;
      return { action: { status: 'confirmation_required', idempotency_key: `confirm-${confirmations}`, approval_token: 'once', arguments: call.arguments } };
    },
  };
  const grantRegistry = registry();
  grantRegistry.computer_open_website.task_grant_eligible = true;
  grantRegistry.computer_invoke.task_grant_eligible = true;
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: grantRegistry, idFactory: () => 'risk-task' });
  const first = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'risk', goal: 'Open Chrome, inspect the page, then delete the item.' });
  const second = await loop.continue({ ownerId: 'owner', sessionId: 'session', taskId: first.task_id, actionIdempotencyKey: 'confirm-1', verifiedObservation: { status: 'ready', operation: 'open_website', site: 'google', hwnd: 42, verified: true } });
  assert.equal(second.status, 'AWAITING_APPROVAL');
  assert.equal(second.pending_action.tool, 'computer_invoke');
  assert.equal(confirmations, 2);
});

test('task authorization never auto-runs a structurally sensitive control without risk keywords', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect page.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Fill the form field.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'field-a', verify_selector: 'field-a', verify_state: 'present' } } },
  ];
  let confirmations = 0;
  const bridge = {
    owns: () => true,
    issueTaskAuthorization(input) { return { id: 'grant-struct', task_id: input.taskId, instruction_revision: input.instructionRevision }; },
    extendTaskAuthorization() {}, async revokeTaskAuthorization() { return true; },
    async execute({ call, taskAuthorization }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 42, title: 'Chrome' }] } };
      // The observed control carries no lexical risk keyword; its UIA
      // control type alone must deny approval reuse.
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 42 }, tree: { elements: [{ selector: 'field-a', name: 'Field A', controlType: 'SecureTextField' }] } } };
      if (taskAuthorization) return { model_result: { status: 'ready', operation: call.name, verified: true }, action: null, approval_reused: true };
      confirmations += 1;
      return { action: { status: 'confirmation_required', idempotency_key: `confirm-${confirmations}`, approval_token: 'once', arguments: call.arguments } };
    },
  };
  const grantRegistry = registry();
  grantRegistry.computer_open_website.task_grant_eligible = true;
  grantRegistry.computer_invoke.task_grant_eligible = true;
  const loop = new ComputerTaskLoop({ provider: { async completeStructured() { return outputs.shift(); } }, bridge, toolRegistry: grantRegistry, idFactory: () => 'struct-task' });
  const first = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'struct', goal: 'Open Chrome, inspect the page, then fill the form field.' });
  const second = await loop.continue({ ownerId: 'owner', sessionId: 'session', taskId: first.task_id, actionIdempotencyKey: 'confirm-1', verifiedObservation: { status: 'ready', operation: 'open_website', site: 'google', hwnd: 42, verified: true } });
  assert.equal(second.status, 'AWAITING_APPROVAL');
  assert.equal(second.pending_action.tool, 'computer_invoke');
  assert.equal(confirmations, 2);
});

test('computer task loop rejects untrusted tools, unverified continuation, and cross-owner reads', async () => {
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'bad', tool: 'computer_shell', arguments: {} } }; } },
    bridge: { owns: () => true, async execute() { throw new Error('must not run'); } }, toolRegistry: registry(), idFactory: () => 'task-2',
  });
  await assert.rejects(() => loop.start({ ownerId: 'owner', requestId: 'r2', goal: 'Do something.' }), error => error instanceof ComputerTaskLoopError && error.code === 'unauthorized_tool');

  const guardedSteps = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'list', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'inspect', tool: 'computer_inspect', arguments: { hwnd: 1 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'write', tool: 'computer_invoke', arguments: { hwnd: 1, selector: 'x' } } },
  ];
  const waitingLoop = new ComputerTaskLoop({
    provider: { async completeStructured() { return guardedSteps.shift(); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', windows: [{ hwnd: 1 }] } };
        if (call.name === 'computer_inspect') return { model_result: { status: 'ready', target: { hwnd: 1 }, tree: { elements: [{ selector: 'x' }] } } };
        return { action: { status: 'confirmation_required', idempotency_key: 'k', approval_token: 't' } };
      },
    }, toolRegistry: registry(), idFactory: () => 'task-3',
  });
  const waiting = await waitingLoop.start({ ownerId: 'renderer:1', sessionId: 'shared-session', requestId: 'r3', goal: 'Click.' });
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'renderer:2', sessionId: 'shared-session', taskId: waiting.task_id, actionIdempotencyKey: 'k', verifiedObservation: { status: 'ready' } }), error => error.code === 'ownership_mismatch');
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'renderer:1', sessionId: 'shared-session', taskId: waiting.task_id, actionIdempotencyKey: 'wrong', verifiedObservation: { status: 'ready' } }), error => error.code === 'action_mismatch');
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'renderer:1', sessionId: 'shared-session', taskId: waiting.task_id, actionIdempotencyKey: 'k', verifiedObservation: { status: 'failed' } }), error => error.code === 'unverified_observation');
});

test('computer task loop carries the trusted owner into every Agent bridge action', async () => {
  let bridgeInput = null;
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } }; } },
    bridge: {
      owns: () => true,
      async execute(input) { bridgeInput = input; return { action: { status: 'confirmation_required', idempotency_key: 'owner-action', approval_token: 'once' } }; },
    },
    toolRegistry: registry(), idFactory: () => 'owner-task',
  });
  const result = await loop.start({ ownerId: 'renderer:73', sessionId: 'shared-session', requestId: 'owner-request', goal: 'Open Google.' });
  assert.equal(result.status, 'AWAITING_APPROVAL');
  assert.equal(bridgeInput.ownerId, 'renderer:73');
  assert.equal(bridgeInput.sessionId, 'shared-session');
});

test('a newer owner instruction cancels the older pending approval before replanning', async () => {
  const cancelled = [];
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open a window.', tool: 'computer_open_website', arguments: { site: 'google' } } }; } },
    bridge: {
      owns: () => true,
      async execute({ call }) { return { action: { status: 'confirmation_required', idempotency_key: `key-${call.id}`, approval_token: 'once' } }; },
      async cancelAction({ sessionId, idempotencyKey }) { cancelled.push({ sessionId, idempotencyKey }); },
    },
    toolRegistry: registry(), idFactory: (() => { let value = 0; return () => `task-${++value}`; })(),
  });
  const first = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'old', goal: 'Open one thing.' });
  assert.equal(first.status, 'AWAITING_APPROVAL');
  const second = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'new', goal: 'Open another thing.' });
  assert.equal(second.status, 'AWAITING_APPROVAL');
  assert.deepEqual(cancelled, [{ sessionId: 'session', idempotencyKey: 'key-computer-step-computer_task-1-1' }]);
  await assert.rejects(() => loop.continue({ ownerId: 'owner', sessionId: 'session', taskId: first.task_id, actionIdempotencyKey: 'key-computer-step-computer_task-1-1', verifiedObservation: { status: 'ready' } }), error => error.code === 'invalid_state');
});

test('computer task loop refuses an unverified completion claim', async () => {
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'Done.', tool: 'none', arguments: {}, evidence_sequences: [1] } }; } },
    bridge: { owns: () => true, async execute() { throw new Error('must not run'); } },
    toolRegistry: registry(), idFactory: () => 'task-unverified',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-unverified', goal: 'Open the requested website.' });
  assert.equal(result.status, 'FAILED');
  assert.match(result.summary, /no meaningful current-screen or verified-action evidence/iu);
});

test('computer task loop makes one bounded schema repair retry for a malformed model response', async () => {
  let calls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        calls += 1;
        if (calls === 1) { const error = new Error('missing schema version'); error.code = 'malformed_response'; throw error; }
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Which window should I inspect?', tool: 'none', arguments: {} } };
      },
    },
    bridge: { owns: () => true, async execute() { throw new Error('must not run'); } }, toolRegistry: registry(), idFactory: () => 'task-repair',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-repair', goal: 'Inspect a window.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(calls, 2);
});

test('computer task loop repairs contradictory stale tool fields instead of silently normalizing them', async () => {
  let calls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        calls += 1;
        return {
          data: calls === 1 ? {
            schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification',
            summary: 'Choose a visible target first.', tool: 'computer_inspect', arguments: { hwnd: 99 },
          } : {
            schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification',
            summary: 'Choose a visible target first.', tool: 'none', arguments: {},
          },
        };
      },
    },
    bridge: { owns: () => true, async execute() { throw new Error('must not execute stale non-action fields'); } },
    toolRegistry: registry(), idFactory: () => 'task-normalize-non-action',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-normalize', goal: 'Choose a target.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(result.actions_started, 0);
  assert.equal(calls, 2);
});

test('read-only unknown-app goal lists and inspects the uniquely matched observed window before planning', async () => {
  const calls = [];
  let plannerCalls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        plannerCalls += 1;
        return {
          data: {
            schema_version: 'solat.computer-task-step.v1', status: 'completed',
            summary: 'The Calculator display reads 42.', tool: 'none', arguments: {}, evidence_sequences: [2],
          },
        };
      },
    },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call);
        if (call.name === 'computer_list_windows') {
          return { model_result: { status: 'ready', operation: 'list_windows', windows: [
            { hwnd: 7, title: 'Calculator', process_id: 17, process_name: 'CalculatorApp', is_foreground: true },
            { hwnd: 9, title: 'Clock', process_id: 19, process_name: 'ClockApp', is_foreground: false },
            { hwnd: 8, title: 'Untitled - Notepad', process_id: 18, process_name: 'Notepad' },
          ] } };
        }
        return { model_result: {
          status: 'ready', operation: 'inspect', hwnd: 7,
          target: { hwnd: 7, process_id: 17, process_name: 'CalculatorApp', window_title: 'Calculator' },
          tree: { elements: [{ type: 'Text', name: 'Display is 42', value: '42', selector: 'display' }] },
        } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-read-only-evidence-ladder',
  });
  const result = await loop.start({
    ownerId: 'owner', requestId: 'r-read-only',
    goal: 'ช่วยดูหน้าต่าง Calculator ที่เปิดอยู่ แล้วบอกตัวเลขที่แสดงตอนนี้ โดยไม่ต้องกดอะไร',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.match(result.summary, /42/u);
  assert.equal(plannerCalls, 0);
  assert.deepEqual(calls.map(call => call.name), ['computer_list_windows', 'computer_inspect']);
  assert.equal(calls[1].arguments.hwnd, 7);
});

test('read-only unknown-app ignores a duplicate shell tree with no semantic value', async () => {
  const calls = [];
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { throw new Error('deterministic read evidence should complete without a model'); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call);
        if (call.name === 'computer_list_windows') {
          return { model_result: { status: 'ready', operation: 'list_windows', windows: [
            { hwnd: 7, title: 'Calculator', process_id: 17, process_name: 'ApplicationFrameHost', is_foreground: true },
            { hwnd: 9, title: 'Calculator', process_id: 19, process_name: 'CalculatorApp', is_foreground: false },
          ] } };
        }
        if (call.arguments.hwnd === 7) {
          return { model_result: {
            status: 'ready', operation: 'inspect', hwnd: 7,
            target: { hwnd: 7, process_id: 17, process_name: 'ApplicationFrameHost', window_title: 'Calculator' },
            tree: { elements: [{ type: 'Window', name: 'Calculator', selector: 'shell' }] },
          } };
        }
        return { model_result: {
          status: 'ready', operation: 'inspect', hwnd: 9,
          target: { hwnd: 9, process_id: 19, process_name: 'CalculatorApp', window_title: 'Calculator' },
          tree: { elements: [{ type: 'Text', name: 'Display is 0', selector: 'CalculatorResults' }] },
        } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-read-only-shell-duplicate',
  });
  const result = await loop.start({
    ownerId: 'owner', requestId: 'r-read-only-shell',
    goal: 'ช่วยดูหน้าต่าง Calculator ที่เปิดอยู่ แล้วบอกตัวเลขที่แสดงตอนนี้ โดยไม่ต้องกดอะไร',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.match(result.summary, /Display is 0/u);
  assert.deepEqual(calls.map(call => call.name), ['computer_list_windows', 'computer_inspect', 'computer_inspect']);
});

test('computer task loop repairs invalid tool arguments before failing delivery', async () => {
  let calls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        calls += 1;
        if (calls === 1) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open it.', tool: 'computer_invoke', arguments: { hwnd: 'not-a-number', selector: '' } } };
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'I need a visible window id.', tool: 'none', arguments: {} } };
      },
    },
    bridge: { owns: () => true, async execute() { throw new Error('must not run invalid action'); } },
    toolRegistry: registry(), idFactory: () => 'task-argument-repair',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-argument-repair', goal: 'Open the requested page.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(calls, 2);
});

test('computer task loop converts value-verifying invoke on an editor into set_value', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Inspect Notepad.', tool: 'computer_inspect', arguments: { hwnd: 42 } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Type the text.', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'editor', verify_selector: 'editor', verify_state: 'value', verify_value: 'PACKAGED NORMAL' } } },
  ];
  const calls = [];
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return outputs.shift(); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call);
        if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', windows: [{ hwnd: 42, title: 'Untitled - Notepad' }] } };
        if (call.name === 'computer_inspect') return { model_result: { status: 'ready', target: { hwnd: 42 }, tree: { elements: [{ type: 'Document', name: 'Text editor', selector: 'editor' }] } } };
        return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'set-editor', approval_token: 'once' } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-editor-repair',
  });

  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'editor-repair', goal: 'Open Notepad and type PACKAGED NORMAL.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(waiting.pending_action.tool, 'computer_set_value');
  assert.deepEqual(calls[2].arguments, { hwnd: 42, selector: 'editor', value: 'PACKAGED NORMAL' });
  assert.deepEqual(calls.map(call => call.name), ['computer_list_windows', 'computer_inspect', 'computer_set_value']);
});

test('computer task loop replaces an invented window with a trusted read prerequisite', async () => {
  const outputs = [
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Guess a target.', tool: 'computer_invoke', arguments: { hwnd: 999, selector: 'invented' } } },
    { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'I need to inspect a visible window first.', tool: 'none', arguments: {} } },
  ];
  let executions = 0;
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { return outputs.shift(); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        executions += 1;
        assert.equal(call.name, 'computer_list_windows');
        return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 7, title: 'Observed window' }] } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-observed-target',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-observed-target', goal: 'Choose something on screen.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(executions, 1);
});

test('computer task loop inspects an observed window before an invented selector mutation', async () => {
  let calls = 0;
  const executed = [];
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        calls += 1;
        if (calls === 1) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List windows.', tool: 'computer_list_windows', arguments: {} } };
        if (calls === 2) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Click guessed control.', tool: 'computer_invoke', arguments: { hwnd: 7, selector: 'invented', verify_selector: 'done', verify_state: 'present' } } };
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'No verified control matched.', tool: 'none', arguments: {} } };
      },
    },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        executed.push(call.name);
        if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 7, title: 'Observed window' }] } };
        assert.equal(call.name, 'computer_inspect');
        return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 7 }, tree: { selector: 'real-control' } } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-inspect-prerequisite',
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-inspect-prerequisite', goal: 'Use the visible control.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.deepEqual(executed, ['computer_list_windows', 'computer_inspect']);
});

test('computer task loop keeps an explicit YouTube workflow on the specialized verified tool', async () => {
  const calls = [];
  let plannerCalls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        plannerCalls += 1;
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'Lllies is playing and verified.', tool: 'none', arguments: {}, evidence_sequences: [1] } };
      },
    },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call);
        return { action: { status: 'confirmation_required', idempotency_key: 'youtube-specialized', approval_token: 'once' } };
      },
    },
    toolRegistry: {
      ...registry(),
      computer_play_youtube_music: {
        side_effect_level: 'write',
        validate_arguments: value => value?.query === 'Lllies',
        validate_output: value => value?.status === 'ready' && value?.playback === 'playing',
      },
    },
    idFactory: () => 'task-youtube-constraint',
  });
  const result = await loop.start({
    ownerId: 'owner', requestId: 'youtube-request', goal: 'Play Lllies on YouTube.',
    workflowHint: { workflow: 'youtube_music', query: 'Lllies' },
  });
  assert.equal(result.status, 'AWAITING_APPROVAL');
  assert.equal(result.pending_action.tool, 'computer_play_youtube_music');
  assert.equal(calls[0].name, 'computer_play_youtube_music');
  assert.deepEqual(calls[0].arguments, { query: 'Lllies' });
  const completed = await loop.continue({
    ownerId: 'owner', taskId: result.task_id, actionIdempotencyKey: 'youtube-specialized',
    verifiedObservation: { status: 'ready', operation: 'play_youtube_music', playback: 'playing', verified: true },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(calls.length, 1);
  assert.equal(plannerCalls, 0, 'verified specialized playback is terminal proof and must not trigger another model call');
});

test('computer task loop opens Instagram before model-guided own-profile navigation', async () => {
  const calls = [];
  const loop = new ComputerTaskLoop({
    provider: { async completeStructured() { throw new Error('model must not run before the bounded Instagram opener'); } },
    bridge: {
      owns: () => true,
      async execute({ call }) {
        calls.push(call);
        return { action: { status: 'confirmation_required', idempotency_key: 'instagram-open', approval_token: 'once' } };
      },
    },
    toolRegistry: {
      ...registry(),
      computer_open_website: {
        side_effect_level: 'write', task_grant_origin: true,
        validate_arguments: value => value?.site === 'instagram',
        validate_output: value => value?.status === 'ready' && value?.verified === true,
      },
    },
    idFactory: () => 'task-instagram-profile',
  });
  const result = await loop.start({
    ownerId: 'owner', requestId: 'instagram-request',
    goal: 'Open Chrome, open Instagram, and go to my profile.',
    workflowHint: { workflow: 'instagram_profile' },
  });
  assert.equal(result.status, 'AWAITING_APPROVAL');
  assert.equal(result.pending_action.tool, 'computer_open_website');
  assert.deepEqual(calls[0].arguments, { site: 'instagram' });
});

test('Instagram profile workflow stops at the real login screen without calling the model', async () => {
  let providerCalls = 0;
  let visionCalls = 0;
  let screenCaptures = 0;
  const calls = [];
  const instagramRegistry = {
    ...registry(),
    computer_open_website: {
      side_effect_level: 'write', task_grant_origin: true,
      validate_arguments: value => value?.site === 'instagram',
      validate_output: value => value?.status === 'ready' && value?.verified === true,
    },
  };
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() { providerCalls += 1; throw new Error('login pages must not reach the model'); },
      async completeStructuredVision() { visionCalls += 1; throw new Error('login pages must not reach vision'); },
    },
    bridge: {
      owns: name => Boolean(instagramRegistry[name]),
      async execute({ call }) {
        calls.push(call);
        if (call.name === 'computer_open_website') {
          return { action: { status: 'confirmation_required', idempotency_key: 'instagram-login-open', approval_token: 'once' } };
        }
        if (call.name === 'computer_list_windows') {
          return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 77, process_name: 'chrome', title: 'Instagram - Google Chrome' }] } };
        }
        if (call.name === 'computer_inspect') {
          return { model_result: { status: 'ready', operation: 'inspect', target: { hwnd: 77 }, tree: { name: 'Log into Instagram', children: [{ name: 'Password', selector: 'password' }] } } };
        }
        throw new Error(`unexpected tool ${call.name}`);
      },
    },
    toolRegistry: instagramRegistry,
    screenCapture: {
      async capture() { screenCaptures += 1; throw new Error('login pages must not capture the screen'); },
    },
    idFactory: () => 'task-instagram-login',
  });
  const waiting = await loop.start({
    ownerId: 'owner', sessionId: 'session', requestId: 'instagram-login',
    goal: 'Open Instagram and go to my profile.', workflowHint: { workflow: 'instagram_profile' },
  });
  const result = await loop.continue({
    ownerId: 'owner', sessionId: 'session', taskId: waiting.task_id,
    actionIdempotencyKey: 'instagram-login-open',
    verifiedObservation: { status: 'ready', operation: 'open_website', site: 'instagram', verified: true, hwnd: 77 },
  });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.match(result.summary, /sign in manually/iu);
  assert.equal(providerCalls, 0);
  assert.equal(visionCalls, 0);
  assert.equal(screenCaptures, 0);
  assert.deepEqual(calls.map(call => call.name), ['computer_open_website', 'computer_list_windows', 'computer_inspect']);
});

test('computer task loop stops a repeated read action instead of spinning', async () => {
  let executions = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured() {
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'List again.', tool: 'computer_list_windows', arguments: {} } };
      },
    },
    bridge: {
      owns: () => true,
      async execute() {
        executions += 1;
        return { model_result: { status: 'ready', operation: 'list_windows', windows: [{ hwnd: 1, title: 'Safe window' }] } };
      },
    },
    toolRegistry: registry(), idFactory: () => 'task-repeat', limits: { maxPlannerTurns: 8, maxRepeatedAction: 2 },
  });
  const result = await loop.start({ ownerId: 'owner', requestId: 'r-repeat', goal: 'Observe the window.' });
  assert.equal(result.status, 'FAILED');
  assert.match(result.summary, /same action repeated/iu);
  assert.equal(executions, 2);
});

test('computer task loop emits bounded progress and replans an awaiting task from a newer owner instruction', async () => {
  const events = [];
  const cancelled = [];
  const goals = [];
  let calls = 0;
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured(messages) {
        calls += 1;
        goals.push(messages.at(-1).content);
        if (/Goal: Instead, ask me which page to open\./iu.test(messages.at(-1).content)) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'The newer instruction needs a target.', tool: 'none', arguments: {} } };
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } } };
      },
    },
    bridge: {
      owns: () => true,
      async execute({ call }) { return { action: { status: 'confirmation_required', idempotency_key: `key-${call.id}`, approval_token: 'once' } }; },
      async cancelAction(input) { cancelled.push(input); },
    },
    toolRegistry: registry(), idFactory: () => 'event-task',
  });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'one', goal: 'Open Google.', eventSink: event => events.push(event) });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  assert.equal(loop.hasActive({ ownerId: 'owner', sessionId: 'session' }), true);
  const revised = await loop.revise({ ownerId: 'owner', sessionId: 'session', requestId: 'two', instruction: 'Instead, ask me which page to open.', eventSink: event => events.push(event) });
  assert.equal(revised.status, 'NEEDS_CLARIFICATION');
  assert.equal(revised.revision, 2);
  assert.equal(cancelled.length, 1);
  assert.match(goals.at(-1), /Goal: Instead, ask me which page to open\./iu);
  assert.doesNotMatch(goals.at(-1), /Goal: Open Google\./iu);
  assert.ok(events.some(event => event.type === 'replanned' && event.schema_version === 'solat.computer-task-event.v1'));
  assert.ok(events.some(event => event.type === 'approval_required'));
  assert.equal(events.every(event => event.owner_id === 'owner' && event.session_id === 'session'), true);
});

test('revising a computer task replaces the old goal and workflow instead of carrying stale YouTube state', async () => {
  const prompts = [];
  const loop = new ComputerTaskLoop({
    provider: {
      async completeStructured(messages) {
        prompts.push(messages.at(-1).content);
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Need a visible result.', tool: 'none', arguments: {} } };
      },
    },
    bridge: {
      owns: () => true,
      async execute({ call }) { return { action: { status: 'confirmation_required', idempotency_key: 'old-song', approval_token: 'once', arguments: call.arguments } }; },
      async cancelAction() {},
    },
    toolRegistry: {
      ...registry(),
      computer_play_youtube_music: {
        side_effect_level: 'write',
        validate_arguments: value => typeof value?.query === 'string' && Boolean(value.query.trim()),
        validate_output: value => value?.status === 'ready' && value?.verified === true,
      },
    }, idFactory: () => 'replace-workflow',
  });
  loop.provider.completeStructured = async messages => {
    prompts.push(messages.at(-1).content);
    if (prompts.length === 1) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Play Lllies.', tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } } };
    return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Need a visible result.', tool: 'none', arguments: {} } };
  };
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'old', goal: 'Play Lllies on YouTube.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  const revised = await loop.revise({ ownerId: 'owner', sessionId: 'session', requestId: 'new', instruction: 'Play New Song on YouTube.', workflowHint: { workflow: 'youtube_music', query: 'New Song' } });
  assert.equal(revised.status, 'AWAITING_APPROVAL');
  assert.equal(revised.pending_action.action.arguments.query, 'New Song');
  assert.doesNotMatch(JSON.stringify(revised), /Lllies/);
});

test('browser visual fallback captures only after an empty semantic observation and uses surface binding', async () => {
  const calls = [];
  const provider = {
    async completeStructured() {
      calls.push('text');
      return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Observe the browser surface.', tool: 'browser_workspace_observe', arguments: { surface_id: 'surface-1' } } };
    },
    async completeStructuredVision(_messages, _schema, capture, context) {
      calls.push('vision');
      assert.equal(capture.browser_visual, true);
      assert.equal(capture.metadata.surface_id, 'surface-1');
      assert.equal(context.surfaceId, 'surface-1');
      assert.equal(context.navigationRevision, 1);
      return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'The canvas needs a semantic target.', tool: 'none', arguments: {} } };
    },
  };
  const browserRegistry = {
    browser_workspace_observe: { side_effect_level: 'read', validate_arguments: value => Object.keys(value).length === 1 && value.surface_id === 'surface-1', validate_output: value => value?.status === 'ready' && Array.isArray(value.items) },
    browser_workspace_visual_observe: { side_effect_level: 'read', validate_arguments: value => value?.surface_id === 'surface-1' && value.navigation_revision === 1, validate_output: value => value?.status === 'ready' && value.verified === true },
  };
  const bridge = {
    owns: () => true,
    async execute({ call }) {
      assert.equal(call.name, 'browser_workspace_observe');
      return { model_result: {
        schema_version: 'solat.browser-observation.v1', status: 'ready', verified: true,
        surface_id: 'surface-1', navigation_revision: 1, observation_revision: 2,
        item_count: 0, items: [], semantic_empty: true, canvas_only: true, visual_fallback_required: true,
      } };
    },
  };
  let visualRequests = 0;
  const browserWorkspacePort = {
    visualObserve(value) {
      visualRequests += 1;
      assert.deepEqual(value, { ownerId: 'owner', request: { sessionId: 'session', surfaceId: 'surface-1', navigationRevision: 1 } });
      return { schema_version: 'solat.browser-visual-observation.v1', status: 'ready', verified: true, surface_id: 'surface-1', navigation_revision: 1, observation_revision: 3, capture_id: 'capture-1', sha256: `sha256:${'b'.repeat(64)}` };
    },
    getVisualCapture() {
      const bytes = Buffer.from('bounded-browser-png');
      return { metadata: {
        schema_version: 'solat.browser-visual-capture.v1', media_type: 'image/png',
        surface_id: 'surface-1', session_id: 'session', navigation_revision: 1, capture_id: 'capture-1',
        size_bytes: bytes.length, sha256: `sha256:${require('node:crypto').createHash('sha256').update(bytes).digest('hex')}`,
        captured_at: new Date().toISOString(),
      }, bytes };
    },
  };
  const loop = new ComputerTaskLoop({
    provider, bridge, toolRegistry: browserRegistry, browserWorkspacePort,
    idFactory: () => 'browser-visual-fallback',
  });
  const result = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'browser-visual', goal: 'Inspect the canvas browser surface.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(visualRequests, 1);
  assert.deepEqual(calls, ['text', 'vision']);
});

test('browser visual fallback does not run for meaningful semantic DOM', async () => {
  let visionCalls = 0;
  const provider = {
    async completeStructured() {
      return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Observe the browser surface.', tool: 'browser_workspace_observe', arguments: { surface_id: 'surface-1' } } };
    },
    async completeStructuredVision() { visionCalls += 1; throw new Error('visual provider must not run'); },
  };
  const bridge = {
    owns: () => true,
    async execute() { return { model_result: { schema_version: 'solat.browser-observation.v1', status: 'ready', verified: true, surface_id: 'surface-1', navigation_revision: 1, observation_revision: 1, item_count: 1, items: [{ target_id: 'e1', role: 'button', name: 'Continue' }] } }; },
  };
  const browserWorkspacePort = { visualObserve() { throw new Error('visual fallback must not run'); }, getVisualCapture() { throw new Error('visual fallback must not run'); } };
  const steps = [{ data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'Need more context.', tool: 'none', arguments: {} } }];
  provider.completeStructured = async () => steps.shift();
  const loop = new ComputerTaskLoop({ provider, bridge, toolRegistry: { browser_workspace_observe: { side_effect_level: 'read', validate_arguments: value => value?.surface_id === 'surface-1', validate_output: value => value?.status === 'ready' } }, browserWorkspacePort, idFactory: () => 'browser-visual-not-needed' });
  const result = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'browser-visual-none', goal: 'Read the browser surface.' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(visionCalls, 0);
});

test('browser visual evidence cannot issue raw desktop actions', () => {
  assert.throws(() => validateVisualFallbackStep({ status: 'action', tool: 'computer_invoke', arguments: { hwnd: 42, selector: 'button' } }, { metadata: { surface_id: 'surface-1' } }), error => error.code === 'visual_action_not_allowed');
});
