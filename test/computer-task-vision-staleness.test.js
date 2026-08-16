const test = require('node:test');
const assert = require('node:assert/strict');
const { ComputerTaskLoop } = require('../src/core/computer-task-loop');

function registry() {
  return {
    computer_list_windows: { side_effect_level: 'read', validate_arguments: value => Object.keys(value).length === 0, validate_output: value => value?.status === 'ready' },
    computer_inspect: { side_effect_level: 'read', validate_arguments: value => Number.isInteger(value.hwnd), validate_output: value => value?.status === 'ready' && Boolean(value.tree) },
    computer_invoke: { side_effect_level: 'write', validate_arguments: value => Number.isInteger(value.hwnd) && typeof value.selector === 'string', validate_output: value => value?.status === 'ready' && value.verified === true },
  };
}

function action(summary, tool, arguments_) {
  return { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary, tool, arguments: arguments_ } };
}

function terminal(status, summary) {
  return { data: { schema_version: 'solat.computer-task-step.v1', status, summary, tool: 'none', arguments: {}, ...(status === 'completed' ? { evidence_sequences: [4, 6] } : {}) } };
}

function harness({ afterRevision }) {
  const ordinary = [
    action('List windows.', 'computer_list_windows', {}),
    action('Inspect the target.', 'computer_inspect', { hwnd: 42 }),
    ...(Array.isArray(afterRevision) ? afterRevision : [afterRevision]),
  ];
  const vision = [action('Invoke the observed control.', 'computer_invoke', { hwnd: 42, selector: 'go' })];
  const calls = [];
  const provider = {
    async completeStructured() { calls.push('text'); return ordinary.shift(); },
    async completeStructuredVision(_messages, _schema, capture) {
      calls.push(`vision:${capture.revision}`);
      assert.equal(capture.metadata.hwnd, 42);
      return vision.length ? vision.shift() : ordinary.shift();
    },
  };
  const bridge = {
    owns: () => true,
    async execute({ call }) {
      if (call.name === 'computer_list_windows') return { model_result: { status: 'ready', windows: [{ hwnd: 42, process_id: 10, process_name: 'chrome', title: 'Page' }] } };
      if (call.name === 'computer_inspect') return { model_result: { status: 'ready', target: { hwnd: 42 }, tree: { selector: 'go' } } };
      return { action: { status: 'confirmation_required', idempotency_key: 'approved-action', approval_token: 'once' } };
    },
    async cancelAction() {},
  };
  const screenCapture = {
    async capture({ hwnd }) {
      return { metadata: { schema_version: 'solat.computer-screen-capture.v1', hwnd }, bytes: Buffer.from('ephemeral') };
    },
  };
  return {
    calls,
    loop: new ComputerTaskLoop({ provider, bridge, toolRegistry: registry(), screenCapture, idFactory: () => 'vision-stale' }),
  };
}

test('a newer owner instruction never sends the previous revision screenshot to the model', async () => {
  const { loop, calls } = harness({ afterRevision: terminal('needs_clarification', 'Need the new target.') });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'old', goal: 'Open it.' });
  assert.equal(waiting.status, 'AWAITING_APPROVAL');
  const revised = await loop.revise({ ownerId: 'owner', sessionId: 'session', requestId: 'new', instruction: 'Stop and choose another page.' });
  assert.equal(revised.status, 'NEEDS_CLARIFICATION');
  assert.deepEqual(calls, ['text', 'text', 'vision:1', 'text']);
});

test('approved mutation result clears the pre-action screenshot before replanning', async () => {
  const { loop, calls } = harness({ afterRevision: [
    action('Refresh windows after the action.', 'computer_list_windows', {}),
    action('Inspect the final target.', 'computer_inspect', { hwnd: 42 }),
    terminal('completed', 'The action is verified.'),
  ] });
  const waiting = await loop.start({ ownerId: 'owner', sessionId: 'session', requestId: 'old', goal: 'Open it.' });
  const completed = await loop.continue({
    ownerId: 'owner',
    sessionId: 'session',
    taskId: waiting.task_id,
    actionIdempotencyKey: 'approved-action',
    verifiedObservation: { status: 'ready', operation: 'invoke', verified: true },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.deepEqual(calls, ['text', 'text', 'vision:1', 'text', 'text', 'vision:2']);
});
