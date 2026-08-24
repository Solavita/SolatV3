'use strict';

// Provider-neutral hand input contracts.  This module intentionally accepts
// landmarks only: it has no camera, image, filesystem, or model integration.

const LANDMARK_FRAME_SCHEMA = 'solat.hand-landmarks.v1';
const HAND_GESTURE_SCHEMA = 'solat.hand-gesture.v1';
const SPATIAL_EVENT_SCHEMA = 'solat.spatial-event.v1';
const HAND_SOURCE = 'hand';
const LANDMARK_COUNT = 21;
const MAX_HANDS = 2;
const MAX_EVENT_POINTS = 64;
const MAX_STRING_LENGTH = 160;
const MAX_COORDINATE = 100000;
const MAX_DISPLAY_ORIGIN = 1000000;
const MAX_DISPLAY_DIMENSION = 100000;
const MAX_TIMESTAMP_MS = 8640000000000000;

const HAND_GESTURES = Object.freeze([
  'point',
  'pinch',
  'grab',
  'drag',
  'release',
  'scale',
  'rotate',
]);
const HAND_PHASES = Object.freeze(['start', 'update', 'end', 'complete']);
const HANDEDNESS = new Set(['left', 'right', 'unknown']);

// Names commonly used by camera/provider payloads.  Rejecting these keys at
// the boundary makes accidental image retention a visible contract failure.
const FORBIDDEN_IMAGE_KEY = /(?:image|pixel|raw.?frame|frame.?data|frame.?bytes|jpeg|jpg|png|base64|blob|file.?path|data.?url)/iu;

function invalid(message, code = 'invalid_hand_contract') {
  return Object.assign(new Error(message), { code });
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

function boundedString(value, name, max = MAX_STRING_LENGTH, { required = true } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw invalid(`${name} is required.`);
  if (result.length > max) throw invalid(`${name} must be at most ${max} characters.`);
  return result;
}

function timestamp(value, name) {
  return Math.round(boundedNumber(value, name, -MAX_TIMESTAMP_MS, MAX_TIMESTAMP_MS));
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function assertNoImagePayload(value, path = 'input', seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw invalid(`${path} must not contain circular data.`);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_IMAGE_KEY.test(key)) {
      throw invalid(`${path}.${key} is not accepted; raw images and frame payloads are not persisted.`, 'image_payload_forbidden');
    }
    assertNoImagePayload(nested, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizeLandmark(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid(`landmarks[${index}] must be an object.`);
  }
  return {
    x: Math.round(boundedNumber(input.x, `landmarks[${index}].x`, 0, 1) * 1000000) / 1000000,
    y: Math.round(boundedNumber(input.y, `landmarks[${index}].y`, 0, 1) * 1000000) / 1000000,
    z: Math.round(boundedNumber(input.z ?? 0, `landmarks[${index}].z`, -2, 2) * 1000000) / 1000000,
    visibility: Math.round(boundedNumber(input.visibility ?? input.score ?? 1, `landmarks[${index}].visibility`, 0, 1) * 1000000) / 1000000,
  };
}

function normalizeHand(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(`hands[${index}] must be an object.`);
  const rawLandmarks = input.landmarks ?? input.points;
  if (!Array.isArray(rawLandmarks) || rawLandmarks.length !== LANDMARK_COUNT) {
    throw invalid(`hands[${index}].landmarks must contain exactly ${LANDMARK_COUNT} points.`);
  }
  const handedness = String(input.handedness ?? input.label ?? 'unknown').trim().toLowerCase();
  if (!HANDEDNESS.has(handedness)) throw invalid(`hands[${index}].handedness is not supported.`);
  return {
    hand_id: boundedString(input.hand_id ?? input.id ?? `hand-${index}`, `hands[${index}].hand_id`, 80),
    handedness,
    score: Math.round(boundedNumber(input.score ?? input.confidence ?? 1, `hands[${index}].score`, 0, 1) * 1000000) / 1000000,
    landmarks: rawLandmarks.map(normalizeLandmark),
  };
}

function normalizeLandmarkFrame(input, { now = Date.now } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('A hand landmark frame is required.');
  assertNoImagePayload(input);
  const handsInput = input.hands ?? input.hand_landmarks;
  if (!Array.isArray(handsInput) || handsInput.length > MAX_HANDS) {
    throw invalid(`hands must contain between 0 and ${MAX_HANDS} entries.`);
  }
  const hands = handsInput.map(normalizeHand);
  const ids = new Set();
  for (const hand of hands) {
    if (ids.has(hand.hand_id)) throw invalid(`Duplicate hand_id ${hand.hand_id}.`);
    ids.add(hand.hand_id);
  }
  const timestampMs = timestamp(input.timestamp_ms ?? input.timestamp ?? now(), 'timestamp_ms');
  const frameId = boundedString(input.frame_id ?? input.id ?? `frame-${timestampMs}`, 'frame_id', 100);
  const coordinateSpace = String(input.coordinate_space ?? 'normalized-0..1').trim().toLowerCase();
  if (coordinateSpace !== 'normalized-0..1') throw invalid('coordinate_space must be normalized-0..1.');
  return deepFreeze({
    schema_version: LANDMARK_FRAME_SCHEMA,
    frame_id: frameId,
    timestamp_ms: timestampMs,
    coordinate_space: coordinateSpace,
    hands,
  });
}

// Explicit aliases keep the contract usable by adapters that call the input
// a frame, landmarks frame, or hand frame; all aliases return the same
// immutable provider-neutral shape.
const normalizeHandFrame = normalizeLandmarkFrame;
const validateLandmarkFrame = normalizeLandmarkFrame;

function normalizeDisplay(input) {
  if (!input || typeof input !== 'object') throw invalid('Display metadata is required.');
  const boundsInput = input.bounds ?? input;
  return {
    id: String(input.id ?? '').trim().slice(0, 80),
    scale_factor: boundedNumber(input.scale_factor ?? input.scaleFactor ?? 1, 'display.scale_factor', 0.25, 8),
    bounds: {
      x: boundedNumber(boundsInput.x ?? 0, 'display.bounds.x', -MAX_DISPLAY_ORIGIN, MAX_DISPLAY_ORIGIN),
      y: boundedNumber(boundsInput.y ?? 0, 'display.bounds.y', -MAX_DISPLAY_ORIGIN, MAX_DISPLAY_ORIGIN),
      width: boundedNumber(boundsInput.width, 'display.bounds.width', 1, MAX_DISPLAY_DIMENSION),
      height: boundedNumber(boundsInput.height, 'display.bounds.height', 1, MAX_DISPLAY_DIMENSION),
    },
  };
}

function normalizeEventPoint(input, index, display) {
  if (!input || typeof input !== 'object') throw invalid(`points[${index}] is invalid.`);
  const margin = 2;
  return {
    x: Math.round(boundedNumber(input.x, `points[${index}].x`, -margin, display.bounds.width + margin) * 100) / 100,
    y: Math.round(boundedNumber(input.y, `points[${index}].y`, -margin, display.bounds.height + margin) * 100) / 100,
    t_ms: Math.max(0, timestamp(input.t_ms ?? 0, `points[${index}].t_ms`)),
    pressure: Math.round(boundedNumber(input.pressure ?? 0.5, `points[${index}].pressure`, 0, 1) * 1000000) / 1000000,
  };
}

function normalizeTransform(input, display) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object') throw invalid('transform must be an object.');
  const centerInput = input.center ?? {};
  return {
    center: {
      x: Math.round(boundedNumber(centerInput.x, 'transform.center.x', -2, display.bounds.width + 2) * 100) / 100,
      y: Math.round(boundedNumber(centerInput.y, 'transform.center.y', -2, display.bounds.height + 2) * 100) / 100,
    },
    scale: Math.round(boundedNumber(input.scale ?? 1, 'transform.scale', 0.05, 20) * 1000000) / 1000000,
    rotation_degrees: Math.round(boundedNumber(input.rotation_degrees ?? input.rotationDegrees ?? 0, 'transform.rotation_degrees', -360, 360) * 1000000) / 1000000,
    distance_px: Math.round(boundedNumber(input.distance_px ?? input.distancePx ?? 0, 'transform.distance_px', 0, MAX_COORDINATE) * 100) / 100,
  };
}

function normalizeSpatialEvent(input, { ownerId, sessionId, now = Date.now } = {}) {
  if (!input || typeof input !== 'object') throw invalid('A hand spatial event is required.');
  const normalizedOwner = boundedString(ownerId, 'ownerId');
  const normalizedSession = boundedString(sessionId, 'sessionId');
  const gesture = String(input.gesture || '').trim().toLowerCase();
  if (!HAND_GESTURES.includes(gesture)) throw invalid('Hand gesture is not supported.');
  const phase = String(input.phase ?? 'complete').trim().toLowerCase();
  if (!HAND_PHASES.includes(phase)) throw invalid('Hand gesture phase is not supported.');
  const source = String(input.source ?? HAND_SOURCE).trim().toLowerCase();
  if (source !== HAND_SOURCE) throw invalid('Hand spatial events must use source hand.');
  if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > MAX_EVENT_POINTS) {
    throw invalid(`Hand spatial points must contain between 1 and ${MAX_EVENT_POINTS} entries.`);
  }
  const display = normalizeDisplay(input.display);
  const points = input.points.map((point, index) => normalizeEventPoint(point, index, display));
  const startedAtMs = timestamp(input.started_at_ms ?? now(), 'started_at_ms');
  const endedAtMs = timestamp(input.ended_at_ms ?? now(), 'ended_at_ms');
  if (endedAtMs < startedAtMs || endedAtMs - startedAtMs > 120000) throw invalid('Hand event timing is invalid.');
  const durationMs = endedAtMs - startedAtMs;
  if (points.some((point, index) => point.t_ms > durationMs + 1000 || (index > 0 && point.t_ms < points[index - 1].t_ms))) {
    throw invalid('Hand event point timing must be monotonic and bounded by event duration.');
  }
  const bounds = {
    x: Math.min(...points.map(point => point.x)),
    y: Math.min(...points.map(point => point.y)),
    width: Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)),
    height: Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)),
  };
  const transform = normalizeTransform(input.transform, display);
  const confidence = Math.round(boundedNumber(input.confidence ?? 0.5, 'confidence', 0, 1) * 1000000) / 1000000;
  const event = {
    // This is deliberately the same versioned output family as V2 spatial
    // events.  The source/gesture values make the hand origin explicit.
    schema_version: SPATIAL_EVENT_SCHEMA,
    event_id: boundedString(input.event_id ?? `hand-event-${endedAtMs}`, 'event_id', 120),
    owner_id: normalizedOwner,
    session_id: normalizedSession,
    context_id: String(input.context_id || '').trim().slice(0, MAX_STRING_LENGTH),
    source,
    gesture,
    phase,
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    duration_ms: durationMs,
    coordinate_space: 'display-local-css-px',
    display,
    bounds,
    points,
    confidence,
  };
  if (transform) {
    event.transform = transform;
    // Top-level aliases keep the event convenient for consumers that only
    // understand the normalised SpatialEvent fields.
    event.scale = transform.scale;
    event.rotation_degrees = transform.rotation_degrees;
  }
  return deepFreeze(event);
}

const createSpatialEvent = normalizeSpatialEvent;
const makeSpatialEvent = normalizeSpatialEvent;

function privacyPolicy({ retainedHands = 0 } = {}) {
  const hands = Math.max(0, Math.min(MAX_HANDS, Number(retainedHands) || 0));
  return deepFreeze({
    schema_version: 'solat.hand-privacy.v1',
    raw_images_persisted: false,
    raw_frames_persisted: false,
    provider_payload_persisted: false,
    retained_hand_count: hands,
    retained_landmark_count: hands * LANDMARK_COUNT,
    max_hands: MAX_HANDS,
    max_landmarks_per_hand: LANDMARK_COUNT,
  });
}

module.exports = {
  HAND_EVENT_SCHEMA: HAND_GESTURE_SCHEMA,
  HAND_GESTURE_SCHEMA,
  HAND_GESTURE_CONTRACT_VERSION: HAND_GESTURE_SCHEMA,
  HAND_GESTURES,
  HAND_PHASES,
  HAND_SOURCE,
  LANDMARK_COUNT,
  HAND_LANDMARK_SCHEMA: LANDMARK_FRAME_SCHEMA,
  LANDMARK_FRAME_SCHEMA,
  MAX_DISPLAY_DIMENSION,
  MAX_DISPLAY_ORIGIN,
  MAX_EVENT_POINTS,
  MAX_HANDS,
  SPATIAL_EVENT_SCHEMA,
  assertNoImagePayload,
  createPrivacySafeFrame: normalizeLandmarkFrame,
  createSpatialEvent,
  deepClone: clone,
  deepFreeze,
  normalizeDisplay,
  normalizeHandLandmarkFrame: normalizeLandmarkFrame,
  normalizeHandFrame,
  normalizeLandmarkFrame,
  normalizeSpatialEvent,
  makeSpatialEvent,
  privacyPolicy,
  validateLandmarkFrame,
};
