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

test('restart-interrupted plans are reported once, owner-scoped, and marked cancelled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solat-agent-interrupted-'));
  const registry = {
    write_tool: { side_effect_level: 'write' },
    read_tool: { side_effect_level: 'read', validate_output: result => result.status === 'ready' },
  };
  const make = () => new AgentService({ rootDir: root, toolRegistry: registry, executeTool: async () => ({ status: 'ready' }) });
  const first = make();
  // PLANNED: created but never run before the restart.
  await first.createPlan({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'planned', steps: [{ tool: 'write_tool' }], approvalRequired: true });
  // PAUSED_APPROVAL: run reached the approval gate before the restart.
  await first.createPlan({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'paused', steps: [{ tool: 'write_tool' }], approvalRequired: true });
  await first.run({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'paused' });
  // Terminal plans must never be reported as interrupted.
  await first.createPlan({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'done', steps: [{ tool: 'read_tool' }], approvalRequired: false });
  await first.run({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'done' });
  // Another session's plan must not leak into this report.
  await first.createPlan({ ownerId: 'owner-other', sessionId: 'owner-other', idempotencyKey: 'foreign', steps: [{ tool: 'write_tool' }], approvalRequired: true });

  // A fresh service instance models the process restart: no in-memory loop.
  const second = make();
  const report = await second.collectInterrupted({ ownerId: 'owner-r', sessionId: 'session-r' });
  assert.equal(report.schema_version, 'solat.agent-interrupted.v1');
  assert.equal(report.session_id, 'session-r');
  assert.deepEqual(report.plans.map(plan => plan.idempotency_key).sort(), ['paused', 'planned']);
  const paused = report.plans.find(plan => plan.idempotency_key === 'paused');
  assert.equal(paused.status_at_interrupt, 'PAUSED_APPROVAL');
  assert.equal(paused.tool, 'write_tool');
  const planned = report.plans.find(plan => plan.idempotency_key === 'planned');
  assert.equal(planned.status_at_interrupt, 'PLANNED');

  // The report is one-shot: interrupted plans are durably marked cancelled.
  const again = await second.collectInterrupted({ ownerId: 'owner-r', sessionId: 'session-r' });
  assert.equal(again.plans.length, 0);
  const cancelled = await second.inspect({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'paused' });
  assert.equal(cancelled.status, 'CANCELLED');
  const succeeded = await second.inspect({ ownerId: 'owner-r', sessionId: 'session-r', idempotencyKey: 'done' });
  assert.equal(succeeded.status, 'SUCCEEDED');
  const foreign = await second.inspect({ ownerId: 'owner-other', sessionId: 'owner-other', idempotencyKey: 'foreign' });
  assert.equal(foreign.status, 'PLANNED');
});

test('collectInterrupted is empty when no durable plans exist yet', async () => {
  const service = new AgentService({
    rootDir: await fs.mkdtemp(path.join(os.tmpdir(), 'solat-agent-empty-')),
    toolRegistry: { read: { side_effect_level: 'read' } },
    executeTool: async () => ({ status: 'ready' }),
  });
  await fs.rm(service.rootDir, { recursive: true, force: true });
  const report = await service.collectInterrupted({ ownerId: 'owner-empty', sessionId: 'owner-empty' });
  assert.deepEqual(report.plans, []);
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
