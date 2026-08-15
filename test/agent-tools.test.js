const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentTools, createReadOnlyAgentTools, normalizeAssetIds } = require('../src/core/agent-tools');

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

test('agent filesystem registry declares real side effects and derives scope only from the plan', async () => {
  const calls = [];
  const fileWorkspace = {
    create: async value => { calls.push(['create', value]); return { schema_version: 'solat.filesystem-result.v1', status: 'ready', operation: 'create', relative_path: value.relativePath, sha256: `sha256:${'a'.repeat(64)}`, size_bytes: 4 }; },
    read: async value => { calls.push(['read', value]); return { schema_version: 'solat.filesystem-result.v1', status: 'ready', operation: 'read', relative_path: value.relativePath, sha256: `sha256:${'b'.repeat(64)}`, size_bytes: 4, content: 'data' }; },
    update: async value => { calls.push(['update', value]); return { schema_version: 'solat.filesystem-result.v1', status: 'ready', operation: 'update', relative_path: value.relativePath, sha256: `sha256:${'c'.repeat(64)}`, size_bytes: 4 }; },
    undo: async value => { calls.push(['undo', value]); return { schema_version: 'solat.filesystem-result.v1', status: 'ready', operation: 'undo', relative_path: value.relativePath, sha256: `sha256:${'d'.repeat(64)}`, size_bytes: 4 }; },
    exportFile: async value => { calls.push(['export', value]); return { schema_version: 'solat.filesystem-result.v1', status: 'ready', operation: 'export', relative_path: value.relativePath, sha256: `sha256:${'e'.repeat(64)}`, size_bytes: 4 }; },
  };
  const tools = createAgentTools({ fileContextProvider: { build: async () => 'context' }, fileWorkspace });
  assert.equal(tools.registry.filesystem_read.side_effect_level, 'read');
  for (const name of ['filesystem_create', 'filesystem_update', 'filesystem_undo', 'filesystem_export']) assert.equal(tools.registry[name].side_effect_level, 'write');
  assert.equal(tools.registry.filesystem_create.validate_arguments({ path: 'answer.md', content: 'data' }), true);
  assert.equal(tools.registry.filesystem_create.validate_arguments({ path: 'answer.md', content: 'data', ownerId: 'other' }), false);
  assert.equal(tools.registry.filesystem_update.validate_arguments({ path: 'answer.md', content: 'data', expected_sha256: `sha256:${'a'.repeat(64)}` }), true);
  assert.equal(tools.registry.filesystem_update.validate_arguments({ path: 'answer.md', content: 'data', expected_sha256: 'not-a-hash' }), false);
  assert.equal(tools.registry.filesystem_export.validate_arguments({ path: 'answer.md', export_name: 'answer.md', expected_sha256: `sha256:${'a'.repeat(64)}` }), true);

  const signal = new AbortController().signal;
  const plan = { owner_id: 'trusted-owner', session_id: 'trusted-session' };
  const created = await tools.executeTool({ tool: 'filesystem_create', arguments: { path: 'answer.md', content: 'data', ownerId: 'attacker' }, plan, signal });
  assert.equal(created.status, 'ready');
  assert.deepEqual(calls[0], ['create', { ownerId: 'trusted-owner', sessionId: 'trusted-session', relativePath: 'answer.md', signal, content: 'data' }]);
  assert.equal(tools.registry.filesystem_create.validate_output(created), true);
  assert.equal(tools.registry.filesystem_create.validate_output({ ...created, operation: 'read' }), false);
});

test('agent filesystem tools reject incomplete schemas and unknown tools visibly', async () => {
  const fileWorkspace = Object.fromEntries(['create', 'read', 'update', 'undo', 'exportFile'].map(method => [method, async () => ({ status: 'ready' })]));
  const tools = createAgentTools({ fileContextProvider: { build: async () => 'context' }, fileWorkspace });
  assert.equal(tools.registry.filesystem_read.validate_arguments({}), false);
  assert.equal(tools.registry.filesystem_update.validate_arguments({ path: 'a.txt', content: 'x' }), false);
  assert.equal(tools.registry.filesystem_undo.validate_arguments({ path: 'a.txt' }), false);
  assert.equal(tools.registry.filesystem_export.validate_arguments({ path: 'a.txt', export_name: 'a.txt' }), false);
  assert.deepEqual(await tools.executeTool({ tool: 'filesystem_delete', arguments: {}, plan: { owner_id: 'o', session_id: 's' } }), { status: 'failed', error: { code: 'unauthorized_tool', message: 'Tool is not registered.' } });
});
