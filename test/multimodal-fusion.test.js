const test = require('node:test');
const assert = require('node:assert/strict');
const { MultimodalFusion, normalizeEvent } = require('../src/core/multimodal-fusion');

function event(id, type, source, at, payload = {}) { return { event_id: id, type, source, occurred_at_ms: at, payload }; }

test('fusion resolves Thai recent references across voice pointer screen and asset events by event time', () => {
  let now = 10_000;
  const fusion = new MultimodalFusion({ now: () => now, idFactory: () => 'fixed' });
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  fusion.record(event('voice-1', 'voice_final', 'voice', 8_000, { context_id: 'voice-turn' }), scope);
  fusion.record(event('asset-1', 'asset_inserted', 'asset', 9_000, { spatial_asset_id: 'spatial-1', insertion_id: 'insert-1', surface_id: 'blue' }), scope);
  fusion.record(event('point-1', 'spatial_point', 'pointer', 8_500, { event_id: 'spatial-event', x: 10, y: 20, surface_id: 'blue' }), scope);
  assert.equal(fusion.contextFor({ ...scope, text: 'แก้รูปที่เพิ่งแปะ', atMs: now }).event_id, 'asset-1');
  assert.equal(fusion.contextFor({ ...scope, text: 'แก้อันนี้', atMs: now }).event_id, 'asset-1');
  assert.equal(fusion.contextFor({ ...scope, text: 'ใช้อันก่อน', atMs: now }).event_id, 'point-1');
});

test('fusion deduplicates events, isolates owners and fails unresolved references visibly', () => {
  const fusion = new MultimodalFusion({ now: () => 20_000 });
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  fusion.record(event('point-1', 'spatial_point', 'hand', 19_000, { x: 1, y: 2 }), scope);
  assert.throws(() => fusion.record(event('point-1', 'spatial_point', 'hand', 19_001), scope), error => error.code === 'duplicate_multimodal_event');
  assert.equal(fusion.contextFor({ ownerId: 'renderer:8', sessionId: 'thread-a', text: 'อันนี้', atMs: 20_000 }).status, 'needs_clarification');
  assert.equal(fusion.contextFor({ ...scope, text: 'ข้อความธรรมดา', atMs: 20_000 }), null);
});

test('undo changes only interaction memory and snapshot restore verifies integrity and scope', () => {
  let now = 30_000;
  const fusion = new MultimodalFusion({ now: () => now });
  const scope = { ownerId: 'renderer:7', sessionId: 'thread-a' };
  fusion.record(event('selected-1', 'asset_selected', 'asset', 28_000, { spatial_asset_id: 'spatial-1' }), scope);
  fusion.record(event('inserted-1', 'asset_inserted', 'asset', 29_000, { spatial_asset_id: 'spatial-2' }), scope);
  assert.equal(fusion.undo(scope).event_id, 'inserted-1');
  assert.equal(fusion.contextFor({ ...scope, text: 'อันนี้', atMs: now }).event_id, 'selected-1');
  const snapshot = fusion.snapshot(scope);
  const restored = new MultimodalFusion({ now: () => now });
  assert.equal(restored.restore(snapshot, scope).event_id, 'selected-1');
  const tampered = JSON.parse(JSON.stringify(snapshot)); tampered.body.sequence = 99;
  assert.throws(() => restored.restore(tampered, scope), error => error.code === 'invalid_multimodal_snapshot');
  assert.throws(() => restored.restore(snapshot, { ownerId: 'renderer:8', sessionId: 'thread-a' }), error => error.code === 'multimodal_scope_mismatch');
});

test('fusion persists only bounded semantic metadata, never raw audio screen or credentials', () => {
  assert.deepEqual(normalizeEvent({
    event_id: 'screen-1', source: 'screen', type: 'screen_observed', occurred_at_ms: 100,
    payload: { surface_id: 'browser-1', screen_hash: 'sha256:abc', raw_pcm: 'secret', image_bytes: 'secret', cookie: 'secret', token: 'secret' },
  }, { ownerId: 'renderer:7', sessionId: 'thread-a', now: () => 100 }).payload, { surface_id: 'browser-1', screen_hash: 'sha256:abc' });
});
