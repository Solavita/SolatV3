const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { createAgentTools } = require('../src/core/agent-tools');
const { FilesystemWorkspace } = require('../src/core/filesystem-workspace');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { composeAgentTools } = require('../src/core/agent-tool-composer');

function contextProvider() { return { async build() { return 'selected file context'; } }; }

test('chat Agent file create remains absent until approval then produces verified file evidence', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-agent-e2e-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const workspace = new FilesystemWorkspace({ rootDir: path.join(root, 'workspace'), exportRoot: path.join(root, 'exports') });
  const tools = createAgentTools({ fileContextProvider: contextProvider(), fileWorkspace: workspace });
  const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
  const pending = await bridge.execute({ sessionId: 'owner-1', requestId: 'request-1', call: { name: 'filesystem_create', arguments: { path: 'note.md', content: '# Hello' } } });
  assert.equal(pending.model_result.status, 'confirmation_required');
  await assert.rejects(() => workspace.read({ ownerId: 'owner-1', sessionId: 'owner-1', relativePath: 'note.md' }), error => error.code === 'ENOENT' || error.code === 'file_not_found');
  await service.approve({ ownerId: 'owner-1', sessionId: 'owner-1', idempotencyKey: pending.action.idempotency_key, approvalToken: pending.action.approval_token });
  const completed = await service.run({ ownerId: 'owner-1', sessionId: 'owner-1', idempotencyKey: pending.action.idempotency_key });
  assert.equal(completed.plan.status, 'SUCCEEDED');
  const file = await workspace.read({ ownerId: 'owner-1', sessionId: 'owner-1', relativePath: 'note.md' });
  assert.equal(file.content, '# Hello');
  assert.match(file.sha256, /^sha256:[a-f0-9]{64}$/u);
});

test('chat Agent computer mutation does not reach adapter before approval', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-computer-e2e-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  let mutationCalls = 0;
  const computer = createComputerAgentTools({ adapter: {
    async listWindows() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'list_windows', windows: [] }; },
    async inspect() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'inspect', tree: {} }; },
    async invoke() { mutationCalls += 1; return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'invoke', verified: true }; },
    async setValue() { mutationCalls += 1; return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'set_value', verified: true }; },
  } });
  const tools = composeAgentTools(computer);
  const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
  const pending = await bridge.execute({ sessionId: 'owner-2', requestId: 'request-2', call: { name: 'computer_invoke', arguments: { hwnd: 123, selector: 'button-save', verify_selector: 'saved-indicator', verify_state: 'present' } } });
  assert.equal(mutationCalls, 0);
  await service.approve({ ownerId: 'owner-2', sessionId: 'owner-2', idempotencyKey: pending.action.idempotency_key, approvalToken: pending.action.approval_token });
  const completed = await service.run({ ownerId: 'owner-2', sessionId: 'owner-2', idempotencyKey: pending.action.idempotency_key });
  assert.equal(completed.plan.status, 'SUCCEEDED');
  assert.equal(mutationCalls, 1);
});

test('a superseded pending chat action is cancelled durably and cannot run later', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-agent-supersede-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  let writes = 0;
  const computer = createComputerAgentTools({ adapter: {
    async listWindows() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'list_windows', windows: [] }; },
    async inspect() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'inspect', tree: {} }; },
    async invoke() { writes += 1; return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'invoke', verified: true }; },
    async setValue() { writes += 1; return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'set_value', verified: true }; },
  } });
  const tools = composeAgentTools(computer);
  const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
  const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
  const pending = await bridge.execute({ sessionId: 'owner-3', requestId: 'old-instruction', call: {
    name: 'computer_invoke', arguments: { hwnd: 123, selector: 'old-button', verify_selector: 'done', verify_state: 'present' },
  } });
  const cancelled = await bridge.cancelAction({ sessionId: 'owner-3', idempotencyKey: pending.action.idempotency_key });
  assert.equal(cancelled.status, 'CANCELLED');
  const lateRun = await service.run({ ownerId: 'owner-3', sessionId: 'owner-3', idempotencyKey: pending.action.idempotency_key });
  assert.equal(lateRun.plan.status, 'CANCELLED');
  assert.equal(writes, 0);
});
