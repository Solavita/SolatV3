const crypto = require('node:crypto');

const SPATIAL_EVENT_SCHEMA = 'solat.spatial-event.v1';
const SPATIAL_CONTEXT_SCHEMA = 'solat.spatial-context.v1';
const MAX_POINTS = 2048;
const MAX_EVENTS_PER_SESSION = 32;
const MAX_SESSIONS = 128;
const DEFAULT_REFERENCE_WINDOW_MS = 30000;
// Electron reports display geometry in CSS/DIP pixels.  These limits leave
// room for a large multi-monitor desktop while rejecting corrupted or
// attacker-controlled geometry before it reaches memory or the model.
const MAX_COORDINATE = 100000;
const MAX_DISPLAY_ORIGIN = 1000000;
const MAX_DISPLAY_DIMENSION = 100000;
const MAX_TIMESTAMP_MS = 8640000000000000;
const GESTURES = new Set(['circle', 'x', 'arrow', 'highlight', 'freehand', 'lasso', 'click', 'drag']);
const SOURCES = new Set(['mouse', 'touch', 'stylus']);

function invalid(message, code = 'invalid_spatial_event') {
  return Object.assign(new Error(message), { code });
}

function boundedString(value, name, max = 160) {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw invalid(`${name} is required and must be at most ${max} characters.`);
  return result;
}

function finiteNumber(value, name) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw invalid(`${name} must be a finite number.`);
  return result;
}

function boundedNumber(value, name, min, max) {
  const result = finiteNumber(value, name);
  if (result < min || result > max) throw invalid(`${name} must be between ${min} and ${max}.`);
  return result;
}

function timestamp(value, name) {
  return Math.round(boundedNumber(value, name, -MAX_TIMESTAMP_MS, MAX_TIMESTAMP_MS));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]));
}

function scopeKey(ownerId, sessionId) {
  // JSON encoding avoids collisions from user-controlled separators in IDs.
  return JSON.stringify([ownerId, sessionId]);
}

function normalizePoint(point, index) {
  if (!point || typeof point !== 'object') throw invalid(`Point ${index} is invalid.`);
  return {
    x: Math.round(boundedNumber(point.x, `points[${index}].x`, -MAX_COORDINATE, MAX_COORDINATE) * 100) / 100,
    y: Math.round(boundedNumber(point.y, `points[${index}].y`, -MAX_COORDINATE, MAX_COORDINATE) * 100) / 100,
    t_ms: Math.max(0, timestamp(point.t_ms ?? 0, `points[${index}].t_ms`)),
    pressure: boundedNumber(point.pressure ?? 0.5, `points[${index}].pressure`, 0, 1),
  };
}

function boundingBox(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function normalizeSpatialEvent(input, { ownerId, sessionId, now = Date.now } = {}) {
  if (!input || typeof input !== 'object') throw invalid('A spatial event is required.');
  const normalizedOwner = boundedString(ownerId, 'ownerId');
  const normalizedSession = boundedString(sessionId, 'sessionId');
  const source = String(input.source || 'mouse').trim().toLowerCase();
  const gesture = String(input.gesture || '').trim().toLowerCase();
  if (!SOURCES.has(source)) throw invalid('Spatial input source is not supported.');
  if (!GESTURES.has(gesture)) throw invalid('Spatial gesture is not supported.');
  if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > MAX_POINTS) {
    throw invalid(`Spatial points must contain between 1 and ${MAX_POINTS} entries.`);
  }
  const points = input.points.map(normalizePoint);
  const startedAtMs = timestamp(input.started_at_ms ?? now(), 'started_at_ms');
  const endedAtMs = timestamp(input.ended_at_ms ?? now(), 'ended_at_ms');
  if (endedAtMs < startedAtMs || endedAtMs - startedAtMs > 120000) throw invalid('Spatial event timing is invalid.');
  const durationMs = endedAtMs - startedAtMs;
  if (points.some((point, index) => point.t_ms > durationMs + 1000 || (index > 0 && point.t_ms < points[index - 1].t_ms))) {
    throw invalid('Spatial point timing must be monotonic and bounded by the event duration.');
  }
  const display = input.display && typeof input.display === 'object' ? {
    id: String(input.display.id ?? '').slice(0, 80),
    scale_factor: boundedNumber(input.display.scale_factor ?? 1, 'display.scale_factor', 0.25, 8),
    bounds: {
      x: boundedNumber(input.display.bounds?.x ?? 0, 'display.bounds.x', -MAX_DISPLAY_ORIGIN, MAX_DISPLAY_ORIGIN),
      y: boundedNumber(input.display.bounds?.y ?? 0, 'display.bounds.y', -MAX_DISPLAY_ORIGIN, MAX_DISPLAY_ORIGIN),
      width: boundedNumber(input.display.bounds?.width, 'display.bounds.width', 1, MAX_DISPLAY_DIMENSION),
      height: boundedNumber(input.display.bounds?.height, 'display.bounds.height', 1, MAX_DISPLAY_DIMENSION),
    },
  } : null;
  if (!display) throw invalid('Display metadata is required.');
  const bounds = boundingBox(points);
  const margin = 2;
  const maxX = display.bounds.width + margin;
  const maxY = display.bounds.height + margin;
  if (points.some(point => point.x < -margin || point.y < -margin || point.x > maxX || point.y > maxY)) {
    throw invalid('Spatial points fall outside the captured display.');
  }
  return deepFreeze({
    schema_version: SPATIAL_EVENT_SCHEMA,
    event_id: boundedString(input.event_id || crypto.randomUUID(), 'event_id'),
    owner_id: normalizedOwner,
    session_id: normalizedSession,
    context_id: String(input.context_id || '').trim().slice(0, 160),
    source,
    gesture,
    phase: 'complete',
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    duration_ms: durationMs,
    coordinate_space: 'display-local-css-px',
    display,
    bounds,
    points,
  });
}

function referencesSpatialTarget(text) {
  const value = String(text || '').toLowerCase();
  return /(?:อันนี้|ตรงนี้|จุดนี้|วงนี้|ที่นี่|นี่|this|here|that one|selected|circled|marked)/iu.test(value);
}

function requestsPreviousTarget(text) {
  const value = String(text || '').toLowerCase();
  return /(?:ไม่ใช่(?:อัน)?นี้|อันก่อน|ก่อนหน้านี้|เมื่อกี้อีกอัน|previous|not this|the other one)/iu.test(value);
}

class InteractionMemory {
  constructor({ maxEvents = MAX_EVENTS_PER_SESSION, maxSessions = MAX_SESSIONS, referenceWindowMs = DEFAULT_REFERENCE_WINDOW_MS, now = Date.now } = {}) {
    this.maxEvents = maxEvents;
    this.maxSessions = maxSessions;
    this.referenceWindowMs = referenceWindowMs;
    this.now = now;
    this.sessions = new Map();
  }

  record(input, scope) {
    const event = normalizeSpatialEvent(input, { ...scope, now: this.now });
    const key = scopeKey(event.owner_id, event.session_id);
    const events = this.sessions.get(key) || [];
    if (!this.sessions.has(key) && this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    events.push(event);
    if (events.length > this.maxEvents) events.splice(0, events.length - this.maxEvents);
    this.sessions.set(key, events);
    return event;
  }

  contextFor({ ownerId, sessionId, text, atMs = this.now() } = {}) {
    const normalizedOwner = boundedString(ownerId, 'ownerId');
    const normalizedSession = boundedString(sessionId, 'sessionId');
    const events = this.sessions.get(scopeKey(normalizedOwner, normalizedSession)) || [];
    if (!events.length || !referencesSpatialTarget(text)) return null;
    const usePrevious = requestsPreviousTarget(text);
    const target = events.at(usePrevious ? -2 : -1);
    const requestedAtMs = timestamp(atMs, 'atMs');
    if (!target || requestedAtMs - target.ended_at_ms > this.referenceWindowMs || requestedAtMs < target.started_at_ms) return null;
    return deepFreeze(deepClone({
      schema_version: SPATIAL_CONTEXT_SCHEMA,
      reference: usePrevious ? 'previous' : 'latest',
      event_id: target.event_id,
      context_id: target.context_id,
      source: target.source,
      gesture: target.gesture,
      occurred_at_ms: target.ended_at_ms,
      age_ms: Math.max(0, requestedAtMs - target.ended_at_ms),
      display: target.display,
      bounds: target.bounds,
      points: target.points,
    }));
  }

  clear({ ownerId, sessionId } = {}) {
    const normalizedOwner = boundedString(ownerId, 'ownerId');
    const normalizedSession = boundedString(sessionId, 'sessionId');
    this.sessions.delete(scopeKey(normalizedOwner, normalizedSession));
  }
}

module.exports = {
  DEFAULT_REFERENCE_WINDOW_MS,
  GESTURES,
  InteractionMemory,
  MAX_POINTS,
  MAX_SESSIONS,
  MAX_COORDINATE,
  MAX_DISPLAY_DIMENSION,
  MAX_DISPLAY_ORIGIN,
  SPATIAL_CONTEXT_SCHEMA,
  SPATIAL_EVENT_SCHEMA,
  normalizeSpatialEvent,
  referencesSpatialTarget,
  requestsPreviousTarget,
};
