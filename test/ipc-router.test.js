const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { registerSolatIpc, resolveOwnedExportPath } = require('../src/ipc-router');

function makeIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

function makeServices(overrides = {}) {
  return {
    core: { status: () => ({ configured: true }), send: async () => ({ content: 'ok' }) },
    computerTaskLoop: { inspect: () => ({}), continue: async () => ({ status: 'RUNNING' }), cancel: async () => ({ status: 'CANCELLED' }) },
    agentService: {
      createPlan: async () => ({ plan: { plan_id: 'plan_1' } }),
      inspect: async () => null,
      approve: async () => ({ status: 'APPROVED' }),
      cancel: async () => ({ status: 'CANCELLED' }),
      run: async () => ({ plan: { status: 'SUCCEEDED' } }),
      collectInterrupted: async () => ({ schema_version: 'solat.agent-interrupted.v1', plans: [] }),
    },
    filesystemWorkspace: {},
    conversationPersistence: { save: async () => ({}), load: async () => ({}) },
    creativePersistence: { saveResult: async () => ({}), loadHistory: async () => ({}) },
    creativeWorkflow: { createDeck: async () => ({}) },
    assetStore: {},
    fileIntake: {},
    ...overrides,
  };
}

const noShell = async () => '';
const noFs = { stat: async () => ({ isFile: () => true }), readFile: async () => '' };

function register(overrides = {}) {
  const ipc = makeIpc();
  registerSolatIpc({
    ipcMain: ipc,
    services: makeServices(overrides.services || {}),
    exportRoot: overrides.exportRoot || path.join(os.tmpdir(), 'solat-exports'),
    shellOpenPath: overrides.shellOpenPath || noShell,
    fsImpl: overrides.fsImpl || noFs,
  });
  return ipc;
}

test('ipc router registers every solat channel exactly once', () => {
  const ipc = register();
  for (const channel of [
    'solat:status', 'solat:send', 'solat:agent-create', 'solat:agent-inspect', 'solat:agent-approve',
    'solat:agent-cancel', 'solat:agent-run', 'solat:agent-interrupted-plans',
    'solat:computer-task-continue', 'solat:computer-task-approve-and-continue', 'solat:computer-task-cancel',
    'solat:agent-read-artifact', 'solat:agent-export-artifact', 'solat:save-conversation', 'solat:load-conversation',
    'solat:create-deck', 'solat:load-creative-history', 'solat:store-original-asset', 'solat:export-html',
    'solat:open-export', 'solat:inspect-export',
  ]) {
    assert.ok(ipc.handlers.has(channel), `missing channel ${channel}`);
  }
});

test('agent channels require a session id and map service errors into the ok envelope', async () => {
  const ipc = register();
  const missingSession = await ipc.handlers.get('solat:agent-inspect')(null, { idempotencyKey: 'k' });
  assert.equal(missingSession.ok, false);
  assert.equal(missingSession.error.code, 'invalid_request');

  const ok = await ipc.handlers.get('solat:agent-create')(null, { sessionId: 's1', steps: [] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.plan.plan_id, 'plan_1');

  const failing = register({ services: { agentService: { inspect: async () => { throw Object.assign(new Error('Persisted agent plan is malformed.'), { code: 'persistence_invalid' }); } } } });
  const mapped = await failing.handlers.get('solat:agent-inspect')(null, { sessionId: 's1', idempotencyKey: 'k' });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.error.code, 'persistence_invalid');
});

test('computer-task-continue only feeds verified persisted evidence into the loop', async () => {
  const readyOutput = { status: 'ready', operation: 'open_website', verified: true };
  let continued = null;
  const ipc = register({
    services: {
      agentService: { inspect: async () => ({ status: 'SUCCEEDED', steps: [{ output: readyOutput }] }) },
      computerTaskLoop: { continue: async input => { continued = input; return { status: 'RUNNING' }; } },
    },
  });
  const result = await ipc.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(result.ok, true);
  assert.deepEqual(continued.verifiedObservation, readyOutput);
  assert.equal(continued.actionIdempotencyKey, 'k1');

  const unverified = register({ services: { agentService: { inspect: async () => ({ status: 'PAUSED_APPROVAL', steps: [] }) } } });
  const blocked = await unverified.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'unverified_observation');

  const failed = register({ services: { agentService: { inspect: async () => ({ status: 'FAILED', steps: [], failure: { code: 'computer_tool_failed', message: '{"error":{"code":"missing_selector"}}' } }) } } });
  const surfaced = await failed.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(surfaced.ok, false);
  assert.equal(surfaced.error.code, 'unverified_observation');
  assert.match(surfaced.error.message, /missing_selector/, 'the owner-visible error must keep the real adapter failure');
});

test('computer-task-approve-and-continue refuses approvals that do not match the pending action', async () => {
  let approved = 0;
  const ipc = register({
    services: {
      agentService: { approve: async () => { approved += 1; return { status: 'APPROVED' }; } },
      computerTaskLoop: { inspect: () => ({ status: 'AWAITING_APPROVAL', pending_action: { action: { idempotency_key: 'real-key' } } }) },
    },
  });
  const mismatch = await ipc.handlers.get('solat:computer-task-approve-and-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'other-key', approvalToken: 'token' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'action_mismatch');
  assert.equal(approved, 0);
});

test('interrupted plan report crosses the IPC boundary owner-scoped', async () => {
  const report = { schema_version: 'solat.agent-interrupted.v1', session_id: 's1', plans: [{ plan_id: 'plan_1', tool: 'computer_open_website', status_at_interrupt: 'PAUSED_APPROVAL' }] };
  const ipc = register({ services: { agentService: { collectInterrupted: async value => { assert.equal(value.ownerId, 's1'); return report; } } } });
  const result = await ipc.handlers.get('solat:agent-interrupted-plans')(null, { sessionId: 's1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, report);
});

test('export paths stay inside the owned export root and must be index.html', () => {
  const root = path.join(os.tmpdir(), 'solat-exports');
  const owned = path.join(root, 'deck-1', 'index.html');
  assert.equal(resolveOwnedExportPath(owned, root), path.resolve(owned));
  assert.throws(() => resolveOwnedExportPath('', root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(root, '..', 'elsewhere', 'index.html'), root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(root, 'deck-1', 'manifest.json'), root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(os.tmpdir(), 'evil', 'index.html'), root), error => error.code === 'invalid_export_path');
});

test('open-export only opens verified files through the injected shell', async () => {
  const root = path.join(os.tmpdir(), 'solat-exports');
  const htmlPath = path.join(root, 'deck-1', 'index.html');
  let opened = null;
  const ipc = register({
    exportRoot: root,
    shellOpenPath: async requested => { opened = requested; return ''; },
    fsImpl: { stat: async () => ({ isFile: () => true }), readFile: async () => '' },
  });
  const result = await ipc.handlers.get('solat:open-export')(null, { htmlPath });
  assert.equal(result.ok, true);
  assert.equal(opened, path.resolve(htmlPath));

  const blocked = await ipc.handlers.get('solat:open-export')(null, { htmlPath: path.join(root, '..', 'outside', 'index.html') });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'invalid_export_path');
});
