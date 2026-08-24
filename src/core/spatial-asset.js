const crypto = require('node:crypto');

const SPATIAL_ASSET_SCHEMA = 'solat.spatial-asset.v1';
const SPATIAL_GHOST_SCHEMA = 'solat.spatial-ghost.v1';
const SPATIAL_TRANSFER_EVENT_SCHEMA = 'solat.spatial-transfer-event.v1';
const SPATIAL_INSERTION_SCHEMA = 'solat.spatial-insertion.v1';
const SPATIAL_INTERACTION_CONTEXT_SCHEMA = 'solat.spatial-interaction-context.v1';
const MAX_SESSIONS = 128;
const MAX_EVENTS_PER_SESSION = 128;
const MAX_COORDINATE = 100000;
const MAX_DIMENSION = 100000;
const MAX_TIMESTAMP_MS = 8640000000000000;
const SURFACE_KINDS = new Set(['blue_workspace', 'browser_workspace', 'application', 'document', 'canvas']);
const INPUT_SOURCES = new Set(['mouse', 'touch', 'hand']);

function spatialAssetError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedString(value, field, max = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw spatialAssetError('invalid_spatial_asset', `${field} is required and must be at most ${max} printable characters.`);
  }
  return result;
}

function optionalString(value, field, max = 160) {
  if (value === undefined || value === null || value === '') return null;
  return boundedString(value, field, max);
}

function boundedNumber(value, field, min, max) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw spatialAssetError('invalid_spatial_asset', `${field} must be between ${min} and ${max}.`);
  }
  return Math.round(result * 100) / 100;
}

function timestamp(value, field) {
  return Math.round(boundedNumber(value, field, 0, MAX_TIMESTAMP_MS));
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]));
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function scopeKey(ownerId, sessionId) {
  return JSON.stringify([ownerId, sessionId]);
}

function normalizeScope({ ownerId, sessionId } = {}) {
  return {
    ownerId: boundedString(ownerId, 'ownerId'),
    sessionId: boundedString(sessionId, 'sessionId'),
  };
}

function normalizeSurface(input, field = 'surface') {
  if (!input || typeof input !== 'object') throw spatialAssetError('invalid_spatial_asset', `${field} is required.`);
  const kind = String(input.kind || '').trim().toLowerCase();
  if (!SURFACE_KINDS.has(kind)) throw spatialAssetError('invalid_spatial_asset', `${field}.kind is not supported.`);
  return deepFreeze({
    surface_id: boundedString(input.surface_id, `${field}.surface_id`),
    kind,
    tab_id: optionalString(input.tab_id, `${field}.tab_id`, 120),
    revision: Math.round(boundedNumber(input.revision ?? 0, `${field}.revision`, 0, Number.MAX_SAFE_INTEGER)),
  });
}

function normalizePointer(input, field = 'pointer') {
  if (!input || typeof input !== 'object') throw spatialAssetError('invalid_spatial_asset', `${field} is required.`);
  return deepFreeze({
    x: boundedNumber(input.x, `${field}.x`, -MAX_COORDINATE, MAX_COORDINATE),
    y: boundedNumber(input.y, `${field}.y`, -MAX_COORDINATE, MAX_COORDINATE),
    display_id: optionalString(input.display_id, `${field}.display_id`, 80),
  });
}

function normalizeTransform(input = {}, field = 'transform') {
  return deepFreeze({
    scale: boundedNumber(input.scale ?? 1, `${field}.scale`, 0.05, 20),
    rotation_deg: boundedNumber(input.rotation_deg ?? 0, `${field}.rotation_deg`, -3600, 3600),
  });
}

function normalizeInputSource(value) {
  const source = String(value || 'mouse').trim().toLowerCase();
  if (!INPUT_SOURCES.has(source)) throw spatialAssetError('invalid_spatial_asset', 'inputSource is not supported.');
  return source;
}

function normalizeOriginal(input) {
  if (!input || typeof input !== 'object') throw spatialAssetError('invalid_spatial_asset', 'original is required.');
  const hash = boundedString(input.hash, 'original.hash', 80).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) throw spatialAssetError('invalid_spatial_asset', 'original.hash must be a SHA-256 digest.');
  return deepFreeze({
    asset_id: boundedString(input.asset_id, 'original.asset_id'),
    hash,
    mime_type: boundedString(input.mime_type, 'original.mime_type', 120).toLowerCase(),
    width: boundedNumber(input.width, 'original.width', 1, MAX_DIMENSION),
    height: boundedNumber(input.height, 'original.height', 1, MAX_DIMENSION),
  });
}

function createSpatialAsset(input, { ownerId, sessionId, now = Date.now, idFactory = crypto.randomUUID } = {}) {
  if (!input || typeof input !== 'object') throw spatialAssetError('invalid_spatial_asset', 'A spatial asset is required.');
  const scope = normalizeScope({ ownerId, sessionId });
  const original = normalizeOriginal(input.original);
  const createdAtMs = timestamp(input.created_at_ms ?? now(), 'created_at_ms');
  return deepFreeze({
    schema_version: SPATIAL_ASSET_SCHEMA,
    spatial_asset_id: boundedString(input.spatial_asset_id || `spatial_${idFactory()}`, 'spatial_asset_id'),
    owner_id: scope.ownerId,
    session_id: scope.sessionId,
    project_id: optionalString(input.project_id, 'project_id'),
    label: optionalString(input.label, 'label', 240),
    original,
    created_at_ms: createdAtMs,
    immutable_original: true,
    provenance: deepFreeze({
      source_kind: boundedString(input.provenance?.source_kind || 'original_user_asset', 'provenance.source_kind', 80),
      source_asset_id: original.asset_id,
      source_hash: original.hash,
      source_url: optionalString(input.provenance?.source_url, 'provenance.source_url', 2048),
      element_tag: optionalString(input.provenance?.element_tag, 'provenance.element_tag', 40),
      navigation_revision: input.provenance?.navigation_revision === undefined ? null
        : Math.round(boundedNumber(input.provenance.navigation_revision, 'provenance.navigation_revision', 0, Number.MAX_SAFE_INTEGER)),
      imported_at_ms: createdAtMs,
    }),
  });
}

function latestSpatialReference(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;
  if (/(?:รูป|ภาพ|อัน)?ที่?เพิ่ง(?:แปะ|ใส่|วาง)|รูปล่าสุด|ภาพล่าสุด|last inserted|just (?:pasted|inserted|dropped)/iu.test(value)) return 'lastInserted';
  if (/(?:รูป|ภาพ|อัน)?ที่?เพิ่งลาก|อันที่ลาก|last dragged|just dragged/iu.test(value)) return 'lastDragged';
  if (/(?:รูป|ภาพ|อัน)?ที่?เพิ่งเลือก|อันที่เลือก|selected (?:image|asset)|last selected/iu.test(value)) return 'lastSelected';
  if (/(?:เป้าหมายนี้|พื้นที่นี้|ตรงที่จะวาง|active target|current target)/iu.test(value)) return 'activeTarget';
  return null;
}

class SpatialAssetRuntime {
  constructor({ now = Date.now, idFactory = crypto.randomUUID, maxSessions = MAX_SESSIONS, maxEvents = MAX_EVENTS_PER_SESSION } = {}) {
    this.now = now;
    this.idFactory = idFactory;
    this.maxSessions = maxSessions;
    this.maxEvents = maxEvents;
    this.sessions = new Map();
  }

  #state(scope, create = false) {
    const normalized = normalizeScope(scope);
    const key = scopeKey(normalized.ownerId, normalized.sessionId);
    let state = this.sessions.get(key);
    if (!state && create) {
      if (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
      state = { scope: normalized, assets: new Map(), ghosts: new Map(), insertions: new Map(), events: [], sequence: 0, memory: { lastSelected: null, lastDragged: null, lastInserted: null, activeTarget: null } };
      this.sessions.set(key, state);
    }
    return state;
  }

  #requireState(scope) {
    const state = this.#state(scope, false);
    if (!state) throw spatialAssetError('spatial_scope_not_found', 'The spatial asset session is not available.');
    return state;
  }

  #asset(state, assetId) {
    const asset = state.assets.get(boundedString(assetId, 'spatialAssetId'));
    if (!asset) throw spatialAssetError('spatial_asset_not_found', 'The spatial asset is not available in this owner/session.');
    return asset;
  }

  #ghost(state, ghostId) {
    const ghost = state.ghosts.get(boundedString(ghostId, 'ghostId'));
    if (!ghost) throw spatialAssetError('spatial_ghost_not_found', 'The spatial ghost is not active in this owner/session.');
    return ghost;
  }

  #event(state, type, details = {}) {
    state.sequence += 1;
    const event = deepFreeze({
      schema_version: SPATIAL_TRANSFER_EVENT_SCHEMA,
      event_id: `transfer_${this.idFactory()}`,
      owner_id: state.scope.ownerId,
      session_id: state.scope.sessionId,
      sequence: state.sequence,
      type,
      occurred_at_ms: timestamp(this.now(), 'occurred_at_ms'),
      ...deepClone(details),
    });
    state.events.push(event);
    if (state.events.length > this.maxEvents) state.events.splice(0, state.events.length - this.maxEvents);
    return event;
  }

  register(input, scope) {
    const state = this.#state(scope, true);
    const asset = createSpatialAsset(input, { ...state.scope, now: this.now, idFactory: this.idFactory });
    if (state.assets.has(asset.spatial_asset_id)) throw spatialAssetError('spatial_asset_exists', 'The spatial asset is already registered.');
    state.assets.set(asset.spatial_asset_id, asset);
    return asset;
  }

  select({ ownerId, sessionId, spatialAssetId, surface } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const asset = this.#asset(state, spatialAssetId);
    const selectedSurface = normalizeSurface(surface);
    const event = this.#event(state, 'selected', { spatial_asset_id: asset.spatial_asset_id, surface: selectedSurface });
    state.memory.lastSelected = deepFreeze({ kind: 'asset', asset, surface: selectedSurface, event_id: event.event_id });
    state.memory.activeTarget = deepFreeze({ kind: 'surface', surface: selectedSurface, event_id: event.event_id });
    return event;
  }

  beginDrag({ ownerId, sessionId, spatialAssetId, surface, pointer, transform, inputSource } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const asset = this.#asset(state, spatialAssetId);
    const sourceSurface = normalizeSurface(surface);
    const initialPointer = normalizePointer(pointer);
    const ghostId = `ghost_${this.idFactory()}`;
    const startedAtMs = timestamp(this.now(), 'started_at_ms');
    const draftGhost = deepFreeze({
      schema_version: SPATIAL_GHOST_SCHEMA,
      ghost_id: ghostId,
      owner_id: state.scope.ownerId,
      session_id: state.scope.sessionId,
      spatial_asset_id: asset.spatial_asset_id,
      input_source: normalizeInputSource(inputSource),
      original: asset.original,
      status: 'held',
      render_role: 'derived_preview',
      source_preserved: true,
      source_surface: sourceSurface,
      current_surface: sourceSurface,
      pointer: initialPointer,
      transform: normalizeTransform(transform),
      started_at_ms: startedAtMs,
      updated_at_ms: startedAtMs,
      transfer_event_ids: [],
    });
    const event = this.#event(state, 'drag_started', { ghost_id: ghostId, spatial_asset_id: asset.spatial_asset_id, input_source: draftGhost.input_source, source_surface: sourceSurface, pointer: initialPointer });
    const ghost = deepFreeze({ ...draftGhost, transfer_event_ids: [event.event_id] });
    state.ghosts.set(ghostId, ghost);
    state.memory.lastSelected = deepFreeze({ kind: 'asset', asset, surface: sourceSurface, event_id: event.event_id });
    state.memory.lastDragged = deepFreeze({ kind: 'ghost', ghost, event_id: event.event_id });
    state.memory.activeTarget = deepFreeze({ kind: 'surface', surface: sourceSurface, event_id: event.event_id });
    return deepFreeze({ ghost, event });
  }

  moveGhost({ ownerId, sessionId, ghostId, pointer, transform } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const current = this.#ghost(state, ghostId);
    const draft = { ...current, pointer: normalizePointer(pointer), transform: transform ? normalizeTransform(transform) : current.transform, updated_at_ms: timestamp(this.now(), 'updated_at_ms') };
    const event = this.#event(state, 'drag_moved', { ghost_id: current.ghost_id, spatial_asset_id: current.spatial_asset_id, input_source: current.input_source, surface: current.current_surface, pointer: draft.pointer, transform: draft.transform });
    const moved = deepFreeze({ ...draft, transfer_event_ids: [...current.transfer_event_ids, event.event_id] });
    state.ghosts.set(current.ghost_id, moved);
    state.memory.lastDragged = deepFreeze({ kind: 'ghost', ghost: moved, event_id: event.event_id });
    return deepFreeze({ ghost: moved, event });
  }

  switchSurface({ ownerId, sessionId, ghostId, targetSurface, pointer } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const current = this.#ghost(state, ghostId);
    const target = normalizeSurface(targetSurface, 'targetSurface');
    const draft = { ...current, current_surface: target, pointer: pointer ? normalizePointer(pointer) : current.pointer, updated_at_ms: timestamp(this.now(), 'updated_at_ms') };
    const event = this.#event(state, 'surface_switched', {
      ghost_id: current.ghost_id,
      spatial_asset_id: current.spatial_asset_id,
      input_source: current.input_source,
      from_surface: current.current_surface,
      target_surface: target,
      pointer: draft.pointer,
      cross_surface: current.current_surface.surface_id !== target.surface_id || current.current_surface.tab_id !== target.tab_id,
    });
    const next = deepFreeze({ ...draft, transfer_event_ids: [...current.transfer_event_ids, event.event_id] });
    state.ghosts.set(current.ghost_id, next);
    state.memory.lastDragged = deepFreeze({ kind: 'ghost', ghost: next, event_id: event.event_id });
    state.memory.activeTarget = deepFreeze({ kind: 'surface', surface: target, event_id: event.event_id });
    return deepFreeze({ ghost: next, event });
  }

  drop({ ownerId, sessionId, ghostId, targetSurface, pointer, transform } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const ghost = this.#ghost(state, ghostId);
    const asset = this.#asset(state, ghost.spatial_asset_id);
    const target = targetSurface ? normalizeSurface(targetSurface, 'targetSurface') : ghost.current_surface;
    if (target.surface_id !== ghost.current_surface.surface_id || target.tab_id !== ghost.current_surface.tab_id || target.revision !== ghost.current_surface.revision) {
      throw spatialAssetError('stale_spatial_target', 'Switch the held ghost to the current target surface before dropping it.');
    }
    const finalPointer = pointer ? normalizePointer(pointer) : ghost.pointer;
    const finalTransform = transform ? normalizeTransform(transform) : ghost.transform;
    const event = this.#event(state, 'dropped', {
      ghost_id: ghost.ghost_id,
      spatial_asset_id: asset.spatial_asset_id,
      input_source: ghost.input_source,
      source_surface: ghost.source_surface,
      target_surface: target,
      pointer: finalPointer,
      transform: finalTransform,
      cross_surface: ghost.source_surface.surface_id !== target.surface_id || ghost.source_surface.tab_id !== target.tab_id,
    });
    const insertion = deepFreeze({
      schema_version: SPATIAL_INSERTION_SCHEMA,
      insertion_id: `insertion_${this.idFactory()}`,
      owner_id: state.scope.ownerId,
      session_id: state.scope.sessionId,
      spatial_asset_id: asset.spatial_asset_id,
      target_surface: target,
      placement: deepFreeze({ pointer: finalPointer, transform: finalTransform }),
      inserted_at_ms: event.occurred_at_ms,
      provenance: deepFreeze({
        operation: 'insert_reference',
        source_asset_id: asset.original.asset_id,
        source_hash: asset.original.hash,
        source_surface: ghost.source_surface,
        target_surface: target,
        transfer_event_ids: [...ghost.transfer_event_ids, event.event_id],
        original_preserved: true,
        ghost_was_derived_preview: true,
      }),
    });
    state.ghosts.delete(ghost.ghost_id);
    state.insertions.set(insertion.insertion_id, insertion);
    state.memory.lastDragged = deepFreeze({ kind: 'asset', asset, surface: target, event_id: event.event_id });
    state.memory.lastInserted = deepFreeze({ kind: 'insertion', insertion, asset, event_id: event.event_id });
    state.memory.activeTarget = deepFreeze({ kind: 'surface', surface: target, event_id: event.event_id });
    return deepFreeze({ insertion, event });
  }

  cancel({ ownerId, sessionId, ghostId } = {}) {
    const state = this.#requireState({ ownerId, sessionId });
    const ghost = this.#ghost(state, ghostId);
    state.ghosts.delete(ghost.ghost_id);
    return this.#event(state, 'drag_cancelled', { ghost_id: ghost.ghost_id, spatial_asset_id: ghost.spatial_asset_id, surface: ghost.current_surface });
  }

  memory({ ownerId, sessionId } = {}) {
    const state = this.#state({ ownerId, sessionId }, false);
    if (!state) return deepFreeze({ lastSelected: null, lastDragged: null, lastInserted: null, activeTarget: null });
    return deepFreeze(deepClone(state.memory));
  }

  resolveReference({ ownerId, sessionId, text } = {}) {
    const slot = latestSpatialReference(text);
    if (!slot) return null;
    const state = this.#state({ ownerId, sessionId }, false);
    const value = state?.memory?.[slot];
    if (!value) return null;
    return deepFreeze({
      schema_version: SPATIAL_INTERACTION_CONTEXT_SCHEMA,
      reference: slot,
      resolved_at_ms: timestamp(this.now(), 'resolved_at_ms'),
      value: deepClone(value),
    });
  }

  events({ ownerId, sessionId } = {}) {
    const state = this.#state({ ownerId, sessionId }, false);
    return deepFreeze(deepClone(state?.events || []));
  }

  clear({ ownerId, sessionId } = {}) {
    const scope = normalizeScope({ ownerId, sessionId });
    this.sessions.delete(scopeKey(scope.ownerId, scope.sessionId));
  }
}

module.exports = {
  MAX_EVENTS_PER_SESSION,
  MAX_SESSIONS,
  INPUT_SOURCES,
  SPATIAL_ASSET_SCHEMA,
  SPATIAL_GHOST_SCHEMA,
  SPATIAL_INSERTION_SCHEMA,
  SPATIAL_INTERACTION_CONTEXT_SCHEMA,
  SPATIAL_TRANSFER_EVENT_SCHEMA,
  SURFACE_KINDS,
  SpatialAssetRuntime,
  createSpatialAsset,
  latestSpatialReference,
  normalizePointer,
  normalizeSurface,
  normalizeTransform,
};
