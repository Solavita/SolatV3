const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationCore } = require('../src/core/conversation-core');
const {
  SPATIAL_ASSET_SCHEMA,
  SPATIAL_GHOST_SCHEMA,
  SPATIAL_INSERTION_SCHEMA,
  SPATIAL_INTERACTION_CONTEXT_SCHEMA,
  SPATIAL_TRANSFER_EVENT_SCHEMA,
  SpatialAssetRuntime,
  createSpatialAsset,
  latestSpatialReference,
} = require('../src/core/spatial-asset');

const original = (overrides = {}) => ({
  asset_id: 'asset-original-1',
  hash: `sha256:${'a'.repeat(64)}`,
  mime_type: 'image/png',
  width: 1200,
  height: 800,
  ...overrides,
});

const surface = (surfaceId, overrides = {}) => ({
  surface_id: surfaceId,
  kind: 'blue_workspace',
  revision: 1,
  ...overrides,
});

function harness() {
  let id = 0;
  let now = 1000;
  return {
    runtime: new SpatialAssetRuntime({ now: () => now++, idFactory: () => `id-${++id}` }),
    scope: { ownerId: 'renderer:1', sessionId: 'conversation-1' },
  };
}

test('SpatialAsset keeps a deeply immutable original identity and provenance', () => {
  const input = { spatial_asset_id: 'spatial-1', label: 'Reference', original: original(), provenance: { source_kind: 'upload' } };
  const asset = createSpatialAsset(input, { ownerId: 'renderer:1', sessionId: 'conversation-1', now: () => 1000 });
  assert.equal(asset.schema_version, SPATIAL_ASSET_SCHEMA);
  assert.equal(asset.immutable_original, true);
  assert.equal(asset.provenance.source_hash, input.original.hash);
  assert.equal(Object.isFrozen(asset), true);
  assert.equal(Object.isFrozen(asset.original), true);
  input.original.asset_id = 'tampered';
  assert.equal(asset.original.asset_id, 'asset-original-1');
  assert.throws(() => createSpatialAsset({ original: original({ hash: 'bad' }) }, { ownerId: 'o', sessionId: 's' }), /SHA-256/);
});

test('derived ghost follows pointer and transform without mutating the source asset', () => {
  const { runtime, scope } = harness();
  const asset = runtime.register({ spatial_asset_id: 'spatial-1', original: original() }, scope);
  const started = runtime.beginDrag({ ...scope, spatialAssetId: asset.spatial_asset_id, surface: surface('blue'), pointer: { x: 10, y: 20 }, transform: { scale: 1 }, inputSource: 'touch' });
  assert.equal(started.ghost.schema_version, SPATIAL_GHOST_SCHEMA);
  assert.equal(started.ghost.input_source, 'touch');
  assert.equal(started.ghost.render_role, 'derived_preview');
  assert.equal(started.ghost.source_preserved, true);
  const moved = runtime.moveGhost({ ...scope, ghostId: started.ghost.ghost_id, pointer: { x: 345.25, y: 499.5 }, transform: { scale: 1.5, rotation_deg: 15 } });
  assert.deepEqual(moved.ghost.pointer, { x: 345.25, y: 499.5, display_id: null });
  assert.deepEqual(moved.ghost.transform, { scale: 1.5, rotation_deg: 15 });
  assert.equal(asset.original.hash, `sha256:${'a'.repeat(64)}`);
  assert.equal(Object.isFrozen(moved.ghost), true);
  assert.equal(started.event.schema_version, SPATIAL_TRANSFER_EVENT_SCHEMA);
  assert.equal(started.event.input_source, 'touch');
  assert.throws(() => runtime.beginDrag({ ...scope, spatialAssetId: asset.spatial_asset_id, surface: surface('blue'), pointer: { x: 1, y: 2 }, inputSource: 'native-dnd' }), /not supported/);
});

test('held ghost switches tabs and drops across surfaces with complete provenance', () => {
  const { runtime, scope } = harness();
  runtime.register({ spatial_asset_id: 'spatial-1', original: original() }, scope);
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'spatial-1', surface: surface('browser', { kind: 'browser_workspace', tab_id: 'pinterest' }), pointer: { x: 20, y: 30 } });
  const switched = runtime.switchSurface({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('workspace', { tab_id: 'deck' }), pointer: { x: 400, y: 300 } });
  assert.equal(switched.event.type, 'surface_switched');
  assert.equal(switched.event.cross_surface, true);
  assert.equal(switched.ghost.status, 'held');
  const dropped = runtime.drop({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('workspace', { tab_id: 'deck' }) });
  assert.equal(dropped.insertion.schema_version, SPATIAL_INSERTION_SCHEMA);
  assert.equal(dropped.insertion.provenance.original_preserved, true);
  assert.equal(dropped.insertion.provenance.ghost_was_derived_preview, true);
  assert.equal(dropped.insertion.provenance.source_asset_id, 'asset-original-1');
  assert.equal(dropped.insertion.provenance.source_surface.tab_id, 'pinterest');
  assert.equal(dropped.insertion.provenance.target_surface.tab_id, 'deck');
  assert.deepEqual(dropped.insertion.provenance.transfer_event_ids, runtime.events(scope).map(event => event.event_id));
  assert.throws(() => runtime.moveGhost({ ...scope, ghostId: ghost.ghost_id, pointer: { x: 1, y: 1 } }), error => error.code === 'spatial_ghost_not_found');
});

test('drop rejects a target that was not explicitly bound while holding', () => {
  const { runtime, scope } = harness();
  runtime.register({ spatial_asset_id: 'spatial-1', original: original() }, scope);
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'spatial-1', surface: surface('one'), pointer: { x: 1, y: 2 } });
  assert.throws(() => runtime.drop({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('two') }), error => error.code === 'stale_spatial_target');
  assert.equal(runtime.events(scope).at(-1).type, 'drag_started');
});

test('runtime isolates owner and session for assets, ghosts, memory, events, and clear', () => {
  const { runtime, scope } = harness();
  runtime.register({ spatial_asset_id: 'spatial-1', original: original() }, scope);
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'spatial-1', surface: surface('blue'), pointer: { x: 1, y: 2 } });
  assert.throws(() => runtime.moveGhost({ ownerId: 'renderer:2', sessionId: scope.sessionId, ghostId: ghost.ghost_id, pointer: { x: 2, y: 3 } }), error => error.code === 'spatial_scope_not_found');
  assert.equal(runtime.events({ ownerId: 'renderer:2', sessionId: scope.sessionId }).length, 0);
  assert.equal(runtime.memory({ ownerId: 'renderer:2', sessionId: scope.sessionId }).lastDragged, null);
  runtime.clear(scope);
  assert.equal(runtime.events(scope).length, 0);
});

test('interaction memory tracks all four slots and grounds Thai latest insertion', () => {
  const { runtime, scope } = harness();
  runtime.register({ spatial_asset_id: 'spatial-1', label: 'poster', original: original() }, scope);
  runtime.select({ ...scope, spatialAssetId: 'spatial-1', surface: surface('browser', { kind: 'browser_workspace' }) });
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'spatial-1', surface: surface('browser', { kind: 'browser_workspace' }), pointer: { x: 1, y: 2 } });
  runtime.switchSurface({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('blue'), pointer: { x: 20, y: 30 } });
  const { insertion } = runtime.drop({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('blue') });
  const memory = runtime.memory(scope);
  assert.equal(memory.lastSelected.asset.spatial_asset_id, 'spatial-1');
  assert.equal(memory.lastDragged.asset.spatial_asset_id, 'spatial-1');
  assert.equal(memory.lastInserted.insertion.insertion_id, insertion.insertion_id);
  assert.equal(memory.activeTarget.surface.surface_id, 'blue');
  const context = runtime.resolveReference({ ...scope, text: 'ช่วยขยายรูปที่เพิ่งแปะให้ใหญ่ขึ้น' });
  assert.equal(context.schema_version, SPATIAL_INTERACTION_CONTEXT_SCHEMA);
  assert.equal(context.reference, 'lastInserted');
  assert.equal(context.value.insertion.insertion_id, insertion.insertion_id);
  assert.equal(runtime.resolveReference({ ownerId: 'renderer:2', sessionId: scope.sessionId, text: 'รูปที่เพิ่งแปะ' }), null);
  assert.equal(runtime.resolveReference({ ...scope, text: 'สวัสดี' }), null);
});

test('Thai and English reference classification is deterministic', () => {
  assert.equal(latestSpatialReference('รูปที่เพิ่งแปะ'), 'lastInserted');
  assert.equal(latestSpatialReference('เอาอันที่เพิ่งลากกลับมา'), 'lastDragged');
  assert.equal(latestSpatialReference('ขยายรูปที่เพิ่งเลือก'), 'lastSelected');
  assert.equal(latestSpatialReference('use the active target'), 'activeTarget');
  assert.equal(latestSpatialReference('unrelated request'), null);
});

test('event and session retention are bounded without leaking evicted state', () => {
  let id = 0;
  const runtime = new SpatialAssetRuntime({ now: () => 1000 + id, idFactory: () => `id-${++id}`, maxSessions: 2, maxEvents: 2 });
  for (const ownerId of ['one', 'two', 'three']) runtime.register({ spatial_asset_id: `asset-${ownerId}`, original: original({ asset_id: `original-${ownerId}` }) }, { ownerId, sessionId: 's' });
  assert.equal(runtime.sessions.size, 2);
  assert.equal(runtime.events({ ownerId: 'one', sessionId: 's' }).length, 0);
  const scope = { ownerId: 'three', sessionId: 's' };
  runtime.select({ ...scope, spatialAssetId: 'asset-three', surface: surface('blue') });
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'asset-three', surface: surface('blue'), pointer: { x: 1, y: 1 } });
  runtime.moveGhost({ ...scope, ghostId: ghost.ghost_id, pointer: { x: 2, y: 2 } });
  const events = runtime.events(scope);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.type), ['drag_started', 'drag_moved']);
  assert.ok(events[1].sequence > events[0].sequence);
});

test('insertion provenance retains the complete transfer chain when the audit event window is bounded', () => {
  let id = 0;
  const runtime = new SpatialAssetRuntime({ now: () => 1000 + id, idFactory: () => `id-${++id}`, maxEvents: 2 });
  const scope = { ownerId: 'owner', sessionId: 'session' };
  runtime.register({ spatial_asset_id: 'spatial', original: original() }, scope);
  const { ghost } = runtime.beginDrag({ ...scope, spatialAssetId: 'spatial', surface: surface('one'), pointer: { x: 1, y: 1 }, inputSource: 'hand' });
  runtime.moveGhost({ ...scope, ghostId: ghost.ghost_id, pointer: { x: 2, y: 2 } });
  runtime.moveGhost({ ...scope, ghostId: ghost.ghost_id, pointer: { x: 3, y: 3 } });
  const { insertion } = runtime.drop({ ...scope, ghostId: ghost.ghost_id, targetSurface: surface('one') });
  assert.equal(runtime.events(scope).length, 2);
  assert.equal(insertion.provenance.transfer_event_ids.length, 4);
  assert.equal(new Set(insertion.provenance.transfer_event_ids).size, 4);
});

test('normal conversation path receives bounded latest-insertion grounding without granting screen authority', async () => {
  let messages = [];
  const provider = {
    status: () => ({ provider: 'test', model: 'test', configured: true }),
    async complete(input) { messages = input; return { content: 'ok', provider: 'test', model: 'test' }; },
  };
  const context = {
    schema_version: SPATIAL_INTERACTION_CONTEXT_SCHEMA,
    reference: 'lastInserted',
    resolved_at_ms: 2000,
    value: {
      event_id: 'drop-1',
      asset: { spatial_asset_id: 'spatial-1', original: original() },
      insertion: { insertion_id: 'insert-1', spatial_asset_id: 'spatial-1', target_surface: surface('blue'), placement: { pointer: { x: 2, y: 3 }, transform: { scale: 1, rotation_deg: 0 } }, provenance: { source_asset_id: 'asset-original-1', source_hash: `sha256:${'a'.repeat(64)}` } },
    },
  };
  const result = await new ConversationCore({ config: {}, provider }).send({ sessionId: 'session-1', content: 'ขยายรูปที่เพิ่งแปะ', spatialAssetContext: context });
  const instruction = messages.find(message => /SpatialAsset context:/u.test(message.content));
  assert.ok(instruction);
  assert.match(instruction.content, /not as permission, current screen truth/u);
  assert.match(instruction.content, /Preserve the immutable original/u);
  assert.match(instruction.content, /"insertion_id":"insert-1"/u);
  assert.equal(result.spatialAssetContext.reference, 'lastInserted');
  assert.equal(result.spatialAssetContext.insertion_id, 'insert-1');
});
