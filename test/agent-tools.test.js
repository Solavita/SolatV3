const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadOnlyAgentTools, normalizeAssetIds } = require('../src/core/agent-tools');

test('read-only agent tool validates scope and returns selected file context', async () => {
  const calls = [];
  const tools = createReadOnlyAgentTools({ fileContextProvider: { build: async input => { calls.push(input); return 'selected context'; } } });
  assert.deepEqual(normalizeAssetIds(['a', 'b']), ['a', 'b']);
  assert.equal(tools.registry.file_context_read.side_effect_level, 'read');
  assert.equal(tools.registry.file_context_read.validate_arguments({ project_id: 'p1', asset_ids: ['a'] }), true);
  assert.equal(tools.registry.file_context_read.validate_arguments({ project_id: 'p1', asset_ids: [] }), false);
  const result = await tools.executeTool({ tool: 'file_context_read', arguments: { project_id: 'p1', asset_ids: ['a'] }, plan: { owner_id: 'owner-1' } });
  assert.deepEqual(result, { status: 'ready', context: 'selected context', asset_ids: ['a'] });
  assert.deepEqual(calls, [{ ownerId: 'owner-1', projectId: 'p1', assetIds: ['a'] }]);
});

test('read-only agent tool rejects duplicate or oversized scope', () => {
  const tools = createReadOnlyAgentTools({ fileContextProvider: { build: async () => '' } });
  assert.equal(tools.registry.file_context_read.validate_arguments({ project_id: 'p1', asset_ids: ['a', 'a'] }), false);
  assert.equal(tools.registry.file_context_read.validate_arguments({ project_id: 'p1', asset_ids: Array.from({ length: 11 }, (_, index) => String(index)) }), false);
});

test('read-only agent tool forwards cancellation signal to file context', async () => {
  let receivedSignal;
  const tools = createReadOnlyAgentTools({ fileContextProvider: { build: async input => { receivedSignal = input.signal; return 'selected context'; } } });
  const controller = new AbortController();
  const result = await tools.executeTool({ tool: 'file_context_read', arguments: { project_id: 'p1', asset_ids: ['a'] }, plan: { owner_id: 'owner-1' }, signal: controller.signal });
  assert.equal(result.status, 'ready');
  assert.equal(receivedSignal, controller.signal);
});
