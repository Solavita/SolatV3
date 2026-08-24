const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MultimodalFusion } = require('../src/core/multimodal-fusion');
const { MultimodalPersistence } = require('../src/core/multimodal-persistence');

test('multimodal snapshot survives an atomic save/load and restores only into the same scope', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-fusion-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  const fusion = new MultimodalFusion({ now: () => 1000 });
  fusion.record({ event_id: 'insert-1', source: 'asset', type: 'asset_inserted', occurred_at_ms: 900, payload: { spatial_asset_id: 'asset-1' } }, scope);
  const persistence = new MultimodalPersistence({ rootDir: root });
  const saved = await persistence.save({ ...scope, snapshot: fusion.snapshot(scope) });
  assert.equal(saved.status, 'saved');
  const loaded = await persistence.load(scope);
  const restored = new MultimodalFusion({ now: () => 1000 });
  assert.equal(restored.restore(loaded, scope).event_id, 'insert-1');
  await assert.rejects(() => persistence.save({ ownerId: 'renderer:8', sessionId: 'thread-a', snapshot: loaded }), error => error.code === 'invalid_multimodal_snapshot');
  await persistence.remove(scope);
  assert.equal(await persistence.load(scope), null);
});
