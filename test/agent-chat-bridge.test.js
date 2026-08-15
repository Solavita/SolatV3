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
