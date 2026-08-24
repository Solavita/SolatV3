const test = require('node:test');
const assert = require('node:assert/strict');
const { MultimodalCoordinator } = require('../src/core/multimodal-coordinator');
const { MultimodalFusion } = require('../src/core/multimodal-fusion');

test('coordinator loads once, persists each event and restores interaction grounding after restart', async () => {
  let stored = null; let loads = 0; let saves = 0;
  const persistence = {
    async load() { loads += 1; return stored; },
    async save({ snapshot }) { saves += 1; stored = snapshot; },
    async remove() { stored = null; },
  };
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  const first = new MultimodalCoordinator({ fusion: new MultimodalFusion({ now: () => 1000 }), persistence });
  await first.record({ event_id: 'asset-1', source: 'asset', type: 'asset_inserted', occurred_at_ms: 900, payload: { spatial_asset_id: 'spatial-1' } }, scope);
  assert.equal((await first.contextFor({ ...scope, text: 'รูปที่เพิ่งแปะ', atMs: 1000 })).event_id, 'asset-1');
  assert.equal(loads, 1); assert.equal(saves, 1);
  const second = new MultimodalCoordinator({ fusion: new MultimodalFusion({ now: () => 1000 }), persistence });
  assert.equal((await second.contextFor({ ...scope, text: 'อันนี้', atMs: 1000 })).event_id, 'asset-1');
  assert.equal(loads, 2);
});

test('coordinator serializes concurrent saves so an older snapshot cannot overwrite a newer event', async () => {
  const stored = []; let releaseFirst;
  const firstSave = new Promise(resolve => { releaseFirst = resolve; });
  let saveCount = 0;
  const persistence = {
    async load() { return null; },
    async save({ snapshot }) { saveCount += 1; if (saveCount === 1) await firstSave; stored.push(snapshot); },
    async remove() {},
  };
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  const coordinator = new MultimodalCoordinator({ fusion: new MultimodalFusion({ now: () => 1000 }), persistence });
  const first = coordinator.record({ event_id: 'a', source: 'asset', type: 'asset_selected', occurred_at_ms: 900 }, scope);
  const second = coordinator.record({ event_id: 'b', source: 'asset', type: 'asset_inserted', occurred_at_ms: 901 }, scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saveCount, 1);
  releaseFirst(); await Promise.all([first, second]);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.at(-1).body.events.map(item => item.event.event_id), ['a', 'b']);
});

test('failed persistence rolls memory back so the same event can be retried safely', async () => {
  let fail = true; let stored = null;
  const persistence = {
    async load() { return stored; },
    async save({ snapshot }) { if (fail) throw Object.assign(new Error('disk failed'), { code: 'EIO' }); stored = snapshot; },
    async remove() {},
  };
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  const coordinator = new MultimodalCoordinator({ fusion: new MultimodalFusion({ now: () => 1000 }), persistence });
  const event = { event_id: 'retry-me', source: 'hand', type: 'spatial_point', occurred_at_ms: 999, payload: { x: 1, y: 2 } };
  await assert.rejects(() => coordinator.record(event, scope), /disk failed/);
  fail = false; await coordinator.record(event, scope);
  assert.equal((await coordinator.contextFor({ ...scope, text: 'ตรงนี้', atMs: 1000 })).event_id, 'retry-me');
});

test('corrupt persisted memory degrades to clarification instead of breaking normal context resolution', async () => {
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  const persistence = {
    async load() { return { schema_version: 'solat.multimodal-snapshot.v1', body: { owner_id: scope.ownerId, session_id: scope.sessionId }, sha256: 'bad' }; },
    async save() {}, async remove() {},
  };
  const coordinator = new MultimodalCoordinator({ persistence });
  assert.deepEqual(await coordinator.contextFor({ ...scope, text: 'อันนี้' }), {
    schema_version: 'solat.multimodal-context.v1', status: 'needs_clarification', reason: 'no_interaction_memory',
  });
  assert.deepEqual(coordinator.recoveryStatus(scope), { status: 'degraded', code: 'invalid_multimodal_snapshot' });
});

test('an evicted fusion scope reloads its durable snapshot instead of trusting stale loaded state', async () => {
  const saved = new Map();
  const persistence = {
    async load(scope) { return saved.get(scope.sessionId) || null; },
    async save({ sessionId, snapshot }) { saved.set(sessionId, snapshot); },
    async remove({ sessionId }) { saved.delete(sessionId); },
  };
  const fusion = new MultimodalFusion({ now: () => 1000, maxSessions: 1 });
  const coordinator = new MultimodalCoordinator({ fusion, persistence, maxLoadedScopes: 1 });
  for (const [sessionId, eventId] of [['a', 'event-a'], ['b', 'event-b']]) {
    await coordinator.record({ event_id: eventId, source: 'asset', type: 'asset_selected', occurred_at_ms: 999 }, { ownerId: 'renderer:7', sessionId });
  }
  assert.equal((await coordinator.contextFor({ ownerId: 'renderer:7', sessionId: 'a', text: 'อันนี้', atMs: 1000 })).event_id, 'event-a');
});
