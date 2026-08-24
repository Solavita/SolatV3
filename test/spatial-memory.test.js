const test = require('node:test');
const assert = require('node:assert/strict');
const { InteractionMemory, normalizeSpatialEvent } = require('../src/core/spatial-memory');

const base = (overrides = {}) => ({
  event_id: 'spatial-1',
  source: 'mouse',
  gesture: 'circle',
  started_at_ms: 1000,
  ended_at_ms: 1100,
  display: { id: '1', scale_factor: 1.25, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  points: [{ x: 10, y: 20, t_ms: 0 }, { x: 80, y: 100, t_ms: 100 }],
  ...overrides,
});

test('spatial event derives authoritative bounds and owner scope', () => {
  const event = normalizeSpatialEvent(base(), { ownerId: 'owner-a', sessionId: 'session-a', now: () => 1100 });
  assert.equal(event.schema_version, 'solat.spatial-event.v1');
  assert.deepEqual(event.bounds, { x: 10, y: 20, width: 70, height: 80 });
  assert.equal(event.owner_id, 'owner-a');
  assert.equal(event.session_id, 'session-a');
});

test('spatial event rejects unsupported gestures and off-display points', () => {
  assert.throws(() => normalizeSpatialEvent(base({ gesture: 'teleport' }), { ownerId: 'o', sessionId: 's' }), /not supported/);
  assert.throws(() => normalizeSpatialEvent(base({ points: [{ x: 5000, y: 2 }] }), { ownerId: 'o', sessionId: 's' }), /outside/);
  assert.throws(() => normalizeSpatialEvent(base({ points: [{ x: 1, y: 2, t_ms: 80 }, { x: 2, y: 3, t_ms: 20 }] }), { ownerId: 'o', sessionId: 's' }), /monotonic/);
});

test('spatial event rejects nonfinite and extreme geometry instead of clamping it', () => {
  assert.throws(() => normalizeSpatialEvent(base({ points: [{ x: Infinity, y: 2 }] }), { ownerId: 'o', sessionId: 's' }), /finite/);
  assert.throws(() => normalizeSpatialEvent(base({ points: [{ x: 100001, y: 2 }] }), { ownerId: 'o', sessionId: 's' }), /between/);
  assert.throws(() => normalizeSpatialEvent(base({ display: { id: '1', scale_factor: 1, bounds: { x: 0, y: 0, width: 100001, height: 1080 } } }), { ownerId: 'o', sessionId: 's' }), /between/);
  assert.throws(() => normalizeSpatialEvent(base({ display: { id: '1', scale_factor: 99, bounds: { x: 0, y: 0, width: 1920, height: 1080 } } }), { ownerId: 'o', sessionId: 's' }), /between/);
});

test('interaction memory bounds the number of retained sessions', () => {
  const memory = new InteractionMemory({ maxSessions: 2, now: () => 2000 });
  memory.record(base({ event_id: 'one' }), { ownerId: 'one', sessionId: 'one' });
  memory.record(base({ event_id: 'two' }), { ownerId: 'two', sessionId: 'two' });
  memory.record(base({ event_id: 'three' }), { ownerId: 'three', sessionId: 'three' });
  assert.equal(memory.sessions.size, 2);
  assert.equal(memory.contextFor({ ownerId: 'one', sessionId: 'one', text: 'อันนี้', atMs: 2100 }), null);
  assert.equal(memory.contextFor({ ownerId: 'three', sessionId: 'three', text: 'อันนี้', atMs: 2100 }).event_id, 'three');
});

test('interaction memory grounds Thai references and self-correction deterministically', () => {
  const memory = new InteractionMemory({ now: () => 3000 });
  memory.record(base({ event_id: 'first', ended_at_ms: 1050 }), { ownerId: 'owner-a', sessionId: 'session-a' });
  memory.record(base({ event_id: 'second', gesture: 'x', started_at_ms: 1200, ended_at_ms: 1300 }), { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'เอาอันนี้ออก', atMs: 1400 }).event_id, 'second');
  const corrected = memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'ไม่ใช่อันนี้ หมายถึงอันก่อน', atMs: 1500 });
  assert.equal(corrected.event_id, 'first');
  assert.equal(corrected.reference, 'previous');
});

test('interaction memory does not leak across owner/session or stale time', () => {
  const memory = new InteractionMemory({ referenceWindowMs: 500, now: () => 1000 });
  memory.record(base({ ended_at_ms: 1000 }), { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(memory.contextFor({ ownerId: 'owner-b', sessionId: 'session-a', text: 'อันนี้', atMs: 1100 }), null);
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-b', text: 'อันนี้', atMs: 1100 }), null);
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'อันนี้', atMs: 1700 }), null);
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'คำถามทั่วไป', atMs: 1100 }), null);
});

test('interaction memory keys scopes by owner and clear removes only the exact scope', () => {
  const memory = new InteractionMemory({ now: () => 2000 });
  memory.record(base({ event_id: 'owner-a-event' }), { ownerId: 'owner-a', sessionId: 'shared-session' });
  memory.record(base({ event_id: 'owner-b-event' }), { ownerId: 'owner-b', sessionId: 'shared-session' });
  assert.equal(memory.sessions.size, 2);
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'shared-session', text: 'อันนี้', atMs: 1200 }).event_id, 'owner-a-event');
  assert.equal(memory.contextFor({ ownerId: 'owner-b', sessionId: 'shared-session', text: 'อันนี้', atMs: 1200 }).event_id, 'owner-b-event');
  memory.clear({ ownerId: 'owner-a', sessionId: 'shared-session' });
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'shared-session', text: 'อันนี้', atMs: 1200 }), null);
  assert.equal(memory.contextFor({ ownerId: 'owner-b', sessionId: 'shared-session', text: 'อันนี้', atMs: 1200 }).event_id, 'owner-b-event');
});

test('spatial event and context deeply freeze isolated nested data', () => {
  const memory = new InteractionMemory({ now: () => 2000 });
  const event = memory.record(base({ event_id: 'immutable' }), { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.display), true);
  assert.equal(Object.isFrozen(event.display.bounds), true);
  assert.equal(Object.isFrozen(event.bounds), true);
  assert.equal(Object.isFrozen(event.points), true);
  assert.equal(Object.isFrozen(event.points[0]), true);
  const context = memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'อันนี้', atMs: 1200 });
  assert.notEqual(context.points, event.points);
  assert.notEqual(context.display, event.display);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.display.bounds), true);
  assert.equal(Object.isFrozen(context.points[0]), true);
  const originalX = event.points[0].x;
  try { context.points[0].x = 999; } catch {}
  assert.equal(event.points[0].x, originalX);
  assert.equal(context.points[0].x, originalX);
});

test('interaction memory does not ground a message timestamped before the event started', () => {
  const memory = new InteractionMemory({ now: () => 2000 });
  memory.record(base({ started_at_ms: 1500, ended_at_ms: 1600 }), { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(memory.contextFor({ ownerId: 'owner-a', sessionId: 'session-a', text: 'อันนี้', atMs: 1499 }), null);
});
