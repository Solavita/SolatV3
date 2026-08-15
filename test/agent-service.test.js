const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentContractError, AgentOrchestrator } = require('../src/core/agent-orchestrator');
const { AgentService, AGENT_STORAGE_SCHEMA_VERSION } = require('../src/core/agent-service');
const { createReadOnlyAgentTools } = require('../src/core/agent-tools');

test('agent service persists scoped plan/audit and resumes only with approval token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solat-agent-'));
  const registry = { read: { side_effect_level: 'read', validate_output: result => result.status === 'ready' } };
  const make = () => new AgentService({ rootDir: root, toolRegistry: registry, executeTool: async ({ signal }) => {
    assert.equal(signal.aborted, false);
    return { status: 'ready', value: 'local' };
  } });
  const first = make();
  const created = await first.createPlan({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted', steps: [{ tool: 'read' }], approvalRequired: false });
  assert.equal(created.plan.approval_token, undefined);
  assert.match(created.approval_token, /^[a-f0-9]{48}$/u);
  const second = make();
  const inspected = await second.inspect({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted' });
  assert.equal(inspected.status, 'PLANNED');
  const duplicate = await second.createPlan({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted', steps: [{ tool: 'read' }], approvalRequired: false });
  assert.equal(duplicate.plan.plan_id, inspected.plan_id);
  assert.equal(duplicate.approval_token, undefined);
  await assert.rejects(() => second.approve({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted', approvalToken: 'wrong' }), error => error instanceof AgentContractError && error.code === 'approval_invalid');
  await second.approve({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted', approvalToken: created.approval_token });
  const run = await second.run({ ownerId: 'owner-a', sessionId: 'session-a', idempotencyKey: 'persisted' });
  assert.equal(run.plan.status, 'SUCCEEDED');
  assert.ok(run.audit.some(entry => entry.event === 'plan_succeeded'));
  const files = await fs.readdir(root);
  assert.equal(files.length, 1);
  const record = JSON.parse(await fs.readFile(path.join(root, files[0]), 'utf8'));
  assert.equal(record.schema_version, AGENT_STORAGE_SCHEMA_VERSION);
  assert.equal(record.plan.owner_id, 'owner-a');
  assert.equal(record.plan.session_id, 'session-a');
  assert.equal(JSON.stringify(record).includes(created.approval_token), false, 'raw approval token must not be persisted');
});

test('agent timeout aborts the per-attempt signal', async () => {
  let timedSignal;
  const orchestrator = new AgentOrchestrator({
    toolRegistry: { slow: { side_effect_level: 'read' } },
    executeTool: async ({ signal }) => { timedSignal = signal; await new Promise(resolve => setTimeout(resolve, 30)); return { status: 'ready' }; },
  });
  const plan = orchestrator.createPlan({ ownerId: 'owner-timeout', sessionId: 'session-timeout', idempotencyKey: 'timeout', approvalRequired: false, limits: { timeoutMs: 5 }, steps: [{ tool: 'slow' }] });
  const result = await orchestrator.run({ ownerId: 'owner-timeout', sessionId: 'session-timeout', idempotencyKey: 'timeout' });
  assert.equal(result.plan.status, 'FAILED');
  assert.equal(result.plan.failure.code, 'timeout');
  assert.equal(timedSignal.aborted, true);
  assert.equal(plan.approval_token_hash.length, 64);
});

test('trusted file-context tool propagates orchestrator timeout without success', async () => {
  let aborted = false;
  const tools = createReadOnlyAgentTools({ fileContextProvider: {
    build: async ({ signal }) => await new Promise((resolve, reject) => {
      const onAbort = () => { aborted = true; reject(new Error('aborted')); };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
  } });
  const service = new AgentService({
    rootDir: await fs.mkdtemp(path.join(os.tmpdir(), 'solat-agent-timeout-')),
    toolRegistry: tools.registry,
    executeTool: tools.executeTool,
  });
  await service.createPlan({ ownerId: 'owner-file-timeout', sessionId: 'session-file-timeout', idempotencyKey: 'file-timeout', approvalRequired: false, limits: { timeoutMs: 5 }, steps: [{ tool: 'file_context_read', arguments: { project_id: 'p1', asset_ids: ['a1'] } }] });
  const result = await service.run({ ownerId: 'owner-file-timeout', sessionId: 'session-file-timeout', idempotencyKey: 'file-timeout' });
  assert.equal(result.plan.status, 'FAILED');
  assert.equal(result.plan.failure.code, 'timeout');
  assert.equal(aborted, true);
});
