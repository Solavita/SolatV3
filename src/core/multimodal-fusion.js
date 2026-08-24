const crypto = require('node:crypto');

const EVENT_SCHEMA = 'solat.multimodal-event.v1';
const CONTEXT_SCHEMA = 'solat.multimodal-context.v1';
const SNAPSHOT_SCHEMA = 'solat.multimodal-snapshot.v1';
const MAX_EVENTS = 256;
const MAX_SESSIONS = 128;
const MAX_AGE_MS = 120000;
const SOURCES = new Set(['voice', 'pointer', 'hand', 'screen', 'asset', 'system']);
const TYPES = new Set(['voice_final', 'spatial_point', 'screen_observed', 'asset_selected', 'asset_dragged', 'asset_inserted', 'surface_activated']);

function fusionError(code, message) { return Object.assign(new Error(message), { code }); }
function text(value, field, max = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) throw fusionError('invalid_multimodal_event', `${field} is invalid.`);
  return result;
}
function time(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 8640000000000000) throw fusionError('invalid_multimodal_event', `${field} is invalid.`);
  return result;
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}
function key(ownerId, sessionId) { return JSON.stringify([ownerId, sessionId]); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${canonical(value[name])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }

function safePayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = ['surface_id', 'surface_kind', 'navigation_revision', 'event_id', 'context_id', 'asset_id', 'spatial_asset_id', 'insertion_id', 'target_id', 'screen_hash', 'gesture', 'x', 'y', 'confidence'];
  const output = {};
  for (const name of allowed) {
    const value = source[name];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw fusionError('invalid_multimodal_event', `${name} is invalid.`);
      output[name] = Math.round(value * 10000) / 10000;
    } else output[name] = text(value, name, name === 'screen_hash' ? 80 : 160);
  }
  return freeze(output);
}

function normalizeEvent(input, { ownerId, sessionId, now = Date.now, idFactory = crypto.randomUUID } = {}) {
  if (!input || typeof input !== 'object') throw fusionError('invalid_multimodal_event', 'A multimodal event is required.');
  const source = String(input.source || '').trim().toLowerCase();
  const type = String(input.type || '').trim().toLowerCase();
  if (!SOURCES.has(source) || !TYPES.has(type)) throw fusionError('invalid_multimodal_event', 'The multimodal source or type is unsupported.');
  const occurredAtMs = time(input.occurred_at_ms ?? now(), 'occurred_at_ms');
  return freeze({
    schema_version: EVENT_SCHEMA,
    event_id: text(input.event_id || `fusion_${idFactory()}`, 'event_id'),
    owner_id: text(ownerId, 'ownerId'),
    session_id: text(sessionId, 'sessionId'),
    source,
    type,
    occurred_at_ms: occurredAtMs,
    payload: safePayload(input.payload),
  });
}

function referenceIntent(value) {
  const input = String(value || '').toLowerCase();
  if (/(?:รูป|ภาพ|อัน)?ที่?เพิ่ง(?:แปะ|ใส่|วาง)|last inserted|just (?:inserted|pasted|dropped)/iu.test(input)) return 'asset_inserted';
  if (/(?:อันก่อน|ก่อนหน้านี้|previous|the other one|not this)/iu.test(input)) return 'previous';
  if (/(?:หน้าจอ|บนจอ|screen|what you see)/iu.test(input)) return 'screen_observed';
  if (/(?:ตรงนี้|จุดนี้|ที่นี่|อันนี้|นี่|this|here|that one|selected)/iu.test(input)) return 'latest_interaction';
  return null;
}

class MultimodalFusion {
  constructor({ now = Date.now, idFactory = crypto.randomUUID, maxEvents = MAX_EVENTS, maxSessions = MAX_SESSIONS, maxAgeMs = MAX_AGE_MS } = {}) {
    this.now = now; this.idFactory = idFactory; this.maxEvents = maxEvents; this.maxSessions = maxSessions; this.maxAgeMs = maxAgeMs;
    this.sessions = new Map();
  }

  #scope(ownerId, sessionId, create = false) {
    const owner = text(ownerId, 'ownerId');
    const session = text(sessionId, 'sessionId');
    const scopeKey = key(owner, session);
    let state = this.sessions.get(scopeKey);
    if (!state && create) {
      if (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
      state = { ownerId: owner, sessionId: session, sequence: 0, events: [], undone: new Set() };
      this.sessions.set(scopeKey, state);
    }
    return state;
  }

  hasScope({ ownerId, sessionId } = {}) {
    return Boolean(this.#scope(ownerId, sessionId, false));
  }

  record(input, scope = {}) {
    const state = this.#scope(scope.ownerId, scope.sessionId, true);
    const event = normalizeEvent(input, { ...scope, now: this.now, idFactory: this.idFactory });
    if (state.events.some(item => item.event.event_id === event.event_id)) throw fusionError('duplicate_multimodal_event', 'The multimodal event was already recorded.');
    state.sequence += 1;
    state.events.push(freeze({ sequence: state.sequence, received_at_ms: time(this.now(), 'received_at_ms'), event }));
    if (state.events.length > this.maxEvents) {
      const removed = state.events.splice(0, state.events.length - this.maxEvents);
      for (const item of removed) state.undone.delete(item.event.event_id);
    }
    return event;
  }

  undo({ ownerId, sessionId, eventId = null } = {}) {
    const state = this.#scope(ownerId, sessionId, false);
    if (!state) throw fusionError('multimodal_context_missing', 'No multimodal interaction is available to undo.');
    const candidate = eventId
      ? state.events.find(item => item.event.event_id === eventId)
      : [...state.events].reverse().find(item => !state.undone.has(item.event.event_id));
    if (!candidate || state.undone.has(candidate.event.event_id)) throw fusionError('multimodal_undo_unavailable', 'The multimodal interaction cannot be undone.');
    state.undone.add(candidate.event.event_id);
    return freeze({ status: 'undone', event_id: candidate.event.event_id, sequence: candidate.sequence });
  }

  contextFor({ ownerId, sessionId, text: requestText, atMs = this.now() } = {}) {
    const intent = referenceIntent(requestText);
    if (!intent) return null;
    const state = this.#scope(ownerId, sessionId, false);
    if (!state) return freeze({ schema_version: CONTEXT_SCHEMA, status: 'needs_clarification', reason: 'no_interaction_memory' });
    const requestedAtMs = time(atMs, 'atMs');
    const usable = state.events.filter(item => !state.undone.has(item.event.event_id)
      && item.event.occurred_at_ms <= requestedAtMs
      && requestedAtMs - item.event.occurred_at_ms <= this.maxAgeMs)
      .sort((a, b) => a.event.occurred_at_ms - b.event.occurred_at_ms || a.sequence - b.sequence);
    let candidates = usable;
    if (intent === 'asset_inserted') candidates = usable.filter(item => item.event.type === 'asset_inserted');
    else if (intent === 'screen_observed') candidates = usable.filter(item => item.event.type === 'screen_observed');
    else if (intent === 'latest_interaction') candidates = usable.filter(item => item.event.type !== 'voice_final');
    const offset = intent === 'previous' ? -2 : -1;
    const selected = candidates.at(offset);
    if (!selected) return freeze({ schema_version: CONTEXT_SCHEMA, status: 'needs_clarification', reason: 'reference_unresolved' });
    return freeze({
      schema_version: CONTEXT_SCHEMA,
      status: 'resolved',
      reference: intent,
      event_id: selected.event.event_id,
      source: selected.event.source,
      type: selected.event.type,
      occurred_at_ms: selected.event.occurred_at_ms,
      age_ms: requestedAtMs - selected.event.occurred_at_ms,
      payload: clone(selected.event.payload),
      ordering: 'occurred_at_then_receive_sequence',
    });
  }

  snapshot({ ownerId, sessionId } = {}) {
    const state = this.#scope(ownerId, sessionId, false);
    if (!state) throw fusionError('multimodal_context_missing', 'No multimodal session is available.');
    const body = { owner_id: state.ownerId, session_id: state.sessionId, sequence: state.sequence, events: clone(state.events), undone_event_ids: [...state.undone] };
    return freeze({ schema_version: SNAPSHOT_SCHEMA, body, sha256: digest(body) });
  }

  restore(snapshot, { ownerId, sessionId } = {}) {
    if (snapshot?.schema_version !== SNAPSHOT_SCHEMA || !snapshot.body || digest(snapshot.body) !== snapshot.sha256) throw fusionError('invalid_multimodal_snapshot', 'The multimodal snapshot integrity check failed.');
    const owner = text(ownerId, 'ownerId'); const session = text(sessionId, 'sessionId');
    if (snapshot.body.owner_id !== owner || snapshot.body.session_id !== session) throw fusionError('multimodal_scope_mismatch', 'The multimodal snapshot belongs to another owner or session.');
    if (!Array.isArray(snapshot.body.events) || snapshot.body.events.length > this.maxEvents || !Array.isArray(snapshot.body.undone_event_ids)) throw fusionError('invalid_multimodal_snapshot', 'The multimodal snapshot is malformed.');
    const restored = { ownerId: owner, sessionId: session, sequence: Number(snapshot.body.sequence) || 0, events: [], undone: new Set(snapshot.body.undone_event_ids.map(value => text(value, 'undone_event_id'))) };
    for (const item of snapshot.body.events) {
      const event = normalizeEvent(item.event, { ownerId: owner, sessionId: session, now: this.now, idFactory: this.idFactory });
      restored.events.push(freeze({ sequence: time(item.sequence, 'sequence'), received_at_ms: time(item.received_at_ms, 'received_at_ms'), event }));
    }
    this.sessions.set(key(owner, session), restored);
    return this.contextFor({ ownerId: owner, sessionId: session, text: 'อันนี้', atMs: this.now() });
  }

  clear({ ownerId, sessionId } = {}) { this.sessions.delete(key(text(ownerId, 'ownerId'), text(sessionId, 'sessionId'))); }
}

module.exports = { CONTEXT_SCHEMA, EVENT_SCHEMA, MAX_AGE_MS, MAX_EVENTS, MultimodalFusion, SNAPSHOT_SCHEMA, normalizeEvent, referenceIntent };
