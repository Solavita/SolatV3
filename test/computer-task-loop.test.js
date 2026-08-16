const test = require('node:test');
const assert = require('node:assert/strict');
const { ComputerTaskLoop, ComputerTaskLoopError } = require('../src/core/computer-task-loop');

function registry() {
  return {
    computer_list_windows: { side_effect_level: 'read', validate_arguments: value => Object.keys(value).length === 0, validate_output: value => value?.status === 'ready' },
    computer_inspect: { side_effect_level: 'read', validate_arguments: value => Number.isInteger(value.hwnd), validate_output: value => value?.status === 'ready' && Boolean(value.tree) },
    computer_invoke: { side_effect_level: 'write', validate_arguments: value => Number.isInteger(value.hwnd) && typeof value.selector === 'string', validate_output: value => value?.status === 'ready' && value.verified === true },
    computer_open_website: { side_effect_level: 'write', validate_arguments: value => value?.site === 'google', validate_output: value => value?.status === 'ready' && value.verified === true },
  };
}

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

test('computer task loop rejects untrusted tools, unverified continuation, and cross-session reads', async () => {
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
  const waiting = await waitingLoop.start({ ownerId: 'owner', requestId: 'r3', goal: 'Click.' });
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'other', taskId: waiting.task_id, actionIdempotencyKey: 'k', verifiedObservation: { status: 'ready' } }), error => error.code === 'ownership_mismatch');
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'owner', taskId: waiting.task_id, actionIdempotencyKey: 'wrong', verifiedObservation: { status: 'ready' } }), error => error.code === 'action_mismatch');
  await assert.rejects(() => waitingLoop.continue({ ownerId: 'owner', taskId: waiting.task_id, actionIdempotencyKey: 'k', verifiedObservation: { status: 'failed' } }), error => error.code === 'unverified_observation');
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
        if (plannerCalls > 1) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'completed', summary: 'Lllies is playing and verified.', tool: 'none', arguments: {}, evidence_sequences: [1] } };
        return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Chrome only.', tool: 'computer_open_website', arguments: { site: 'google' } } };
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
        if (/Latest owner instruction/iu.test(messages.at(-1).content)) return { data: { schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification', summary: 'The newer instruction needs a target.', tool: 'none', arguments: {} } };
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
  assert.match(goals.at(-1), /Latest owner instruction.*which page/isu);
  assert.ok(events.some(event => event.type === 'replanned' && event.schema_version === 'solat.computer-task-event.v1'));
  assert.ok(events.some(event => event.type === 'approval_required'));
  assert.equal(events.every(event => event.owner_id === 'owner' && event.session_id === 'session'), true);
});
