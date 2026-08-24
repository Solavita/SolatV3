'use strict';

const {
  HAND_GESTURE_SCHEMA,
  HAND_GESTURES,
  HAND_PHASES,
  HAND_SOURCE,
  LANDMARK_COUNT,
  LANDMARK_FRAME_SCHEMA,
  MAX_HANDS,
  deepFreeze,
  normalizeLandmarkFrame,
  normalizeSpatialEvent,
  privacyPolicy,
} = require('./hand-gesture-contracts');

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_DIP = 7;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

const FINGER_LAYOUT = Object.freeze([
  Object.freeze({ name: 'index', mcp: INDEX_MCP, pip: INDEX_PIP, dip: INDEX_DIP, tip: INDEX_TIP }),
  Object.freeze({ name: 'middle', mcp: MIDDLE_MCP, pip: MIDDLE_PIP, dip: 11, tip: MIDDLE_TIP }),
  Object.freeze({ name: 'ring', mcp: RING_MCP, pip: RING_PIP, dip: 15, tip: RING_TIP }),
  Object.freeze({ name: 'pinky', mcp: PINKY_MCP, pip: PINKY_PIP, dip: 19, tip: PINKY_TIP }),
]);

const DEFAULTS = Object.freeze({
  smoothingAlpha: 0.35,
  enterFrames: 2,
  exitFrames: 2,
  twoHandEnterFrames: 2,
  twoHandExitFrames: 2,
  pinchEnterRatio: 0.42,
  pinchExitRatio: 0.62,
  fingerExtendedRatio: 1.15,
  fingerCurledRatio: 1.10,
  grabCurlCount: 3,
  dragStartDistancePx: 12,
  transformScaleThreshold: 0.025,
  transformRotateThresholdDegrees: 3,
  maxFrameGapMs: 2000,
});

function invalid(message, code = 'invalid_hand_gesture') {
  return Object.assign(new Error(message), { code });
}

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw invalid(`${name} must be finite.`);
  return number;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function average(points) {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function normalizeAngleDegrees(value) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function ema(previous, next, alpha) {
  if (!previous) return { ...next };
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    z: previous.z + (next.z - previous.z) * alpha,
    visibility: previous.visibility + (next.visibility - previous.visibility) * alpha,
  };
}

function smoothHand(previous, hand, alpha) {
  return {
    hand_id: hand.hand_id,
    handedness: hand.handedness,
    score: previous ? previous.score + (hand.score - previous.score) * alpha : hand.score,
    landmarks: hand.landmarks.map((point, index) => ema(previous?.landmarks?.[index], point, alpha)),
  };
}

function palmScale(landmarks) {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  const scale = (distance(wrist, middleMcp) + distance(indexMcp, pinkyMcp)) / 2;
  return Math.max(scale, 0.000001);
}

function fingerMetrics(landmarks, layout, options = DEFAULTS) {
  const wrist = landmarks[WRIST];
  const pipDistance = distance(wrist, landmarks[layout.pip]);
  const tipDistance = distance(wrist, landmarks[layout.tip]);
  const ratio = tipDistance / Math.max(pipDistance, 0.000001);
  return {
    name: layout.name,
    ratio,
    extended: ratio >= options.fingerExtendedRatio,
    curled: ratio <= options.fingerCurledRatio,
  };
}

function classifyHand(hand, options = DEFAULTS, activeKind = null) {
  const landmarks = hand.landmarks;
  const fingers = FINGER_LAYOUT.map(layout => fingerMetrics(landmarks, layout, options));
  const index = fingers[0];
  const otherFingers = fingers.slice(1);
  const scale = palmScale(landmarks);
  const pinchRatio = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / scale;
  const pinchThreshold = activeKind === 'pinch' ? options.pinchExitRatio : options.pinchEnterRatio;
  const pinch = pinchRatio <= pinchThreshold;
  const curledCount = fingers.filter(finger => finger.curled).length;
  const point = index.extended && otherFingers.filter(finger => finger.curled).length >= 2 && !pinch;
  const grab = !point && !pinch && curledCount >= options.grabCurlCount;
  let kind = 'none';
  if (pinch) kind = 'pinch';
  else if (point) kind = 'point';
  else if (grab) kind = 'grab';
  const palm = average([landmarks[WRIST], landmarks[INDEX_MCP], landmarks[MIDDLE_MCP], landmarks[RING_MCP], landmarks[PINKY_MCP]]);
  const anchor = kind === 'point'
    ? { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y }
    : kind === 'pinch'
      ? midpoint(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
      : palm;
  const averageVisibility = landmarks.reduce((sum, pointValue) => sum + pointValue.visibility, 0) / landmarks.length;
  const confidence = clamp(hand.score * averageVisibility * (kind === 'none' ? 0.5 : 1));
  return {
    hand,
    kind,
    fingers,
    pinchRatio,
    curledCount,
    palmScale: scale,
    anchor,
    palm,
    confidence,
  };
}

function toPixel(point, display) {
  return {
    x: point.x * display.bounds.width,
    y: point.y * display.bounds.height,
  };
}

function pairKey(first, second) {
  return [first.hand.hand_id, second.hand.hand_id].sort().join('|');
}

function twoHandMeasurement(first, second, display) {
  const firstPoint = toPixel(first.palm, display);
  const secondPoint = toPixel(second.palm, display);
  const center = midpoint(firstPoint, secondPoint);
  const distancePx = distance(firstPoint, secondPoint);
  const angleDegrees = Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x) * 180 / Math.PI;
  return { firstPoint, secondPoint, center, distancePx, angleDegrees };
}

function copyPublicState(active) {
  if (!active) return null;
  return {
    gesture: active.kind,
    hand_id: active.handId,
    started_at_ms: active.startedAtMs,
    dragged: Boolean(active.dragStarted),
  };
}

/**
 * Stateful landmark-to-gesture translator.
 *
 * The class never receives an image and never stores a source frame.  It keeps
 * at most two EMA-smoothed landmark sets so a provider adapter can be swapped
 * without changing the gesture or SpatialEvent contract.
 */
class HandGestureProcessor {
  constructor({
    ownerId = 'hand-owner',
    sessionId = 'hand-session',
    contextId = '',
    display = { id: 'hand-display', scale_factor: 1, bounds: { x: 0, y: 0, width: 1000, height: 1000 } },
    now = Date.now,
    ...options
  } = {}) {
    this.ownerId = String(ownerId || '').trim();
    this.sessionId = String(sessionId || '').trim();
    if (!this.ownerId || !this.sessionId) throw invalid('ownerId and sessionId are required.');
    this.contextId = String(contextId || '').trim().slice(0, 160);
    this.display = display;
    this.now = now;
    this.options = this._normalizeOptions(options);
    this.smoothedHands = new Map();
    this.active = null;
    this.pending = null;
    this.pendingNoneFrames = 0;
    this.twoHandPending = null;
    this.twoHand = null;
    this.lastTimestampMs = null;
    this.sequence = 0;
  }

  _normalizeOptions(options) {
    const merged = { ...DEFAULTS, ...options };
    const thresholdOptions = options.thresholds && typeof options.thresholds === 'object' ? options.thresholds : {};
    const pinchOptions = thresholdOptions.pinch && typeof thresholdOptions.pinch === 'object' ? thresholdOptions.pinch : {};
    const transformOptions = thresholdOptions.transform && typeof thresholdOptions.transform === 'object' ? thresholdOptions.transform : {};
    const positiveInteger = (value, name, minimum = 1, maximum = 30) => {
      const number = Number(value);
      if (!Number.isInteger(number) || number < minimum || number > maximum) throw invalid(`${name} must be an integer between ${minimum} and ${maximum}.`);
      return number;
    };
    const bounded = (value, name, min, max) => {
      const number = finite(value, name);
      if (number < min || number > max) throw invalid(`${name} must be between ${min} and ${max}.`);
      return number;
    };
    const configured = (key, fallback, ...aliases) => {
      for (const value of [options[key], ...aliases]) {
        if (value !== undefined) return value;
      }
      return fallback;
    };
    return {
      smoothingAlpha: bounded(configured('smoothingAlpha', merged.smoothingAlpha, options.smoothing), 'smoothingAlpha', 0.05, 1),
      enterFrames: positiveInteger(configured('enterFrames', merged.enterFrames, options.activationFrames), 'enterFrames'),
      exitFrames: positiveInteger(configured('exitFrames', merged.exitFrames, options.releaseFrames), 'exitFrames'),
      twoHandEnterFrames: positiveInteger(merged.twoHandEnterFrames, 'twoHandEnterFrames'),
      twoHandExitFrames: positiveInteger(merged.twoHandExitFrames, 'twoHandExitFrames'),
      pinchEnterRatio: bounded(configured('pinchEnterRatio', merged.pinchEnterRatio, pinchOptions.enter, options.pinchThreshold), 'pinchEnterRatio', 0.05, 1),
      pinchExitRatio: bounded(configured('pinchExitRatio', merged.pinchExitRatio, pinchOptions.exit), 'pinchExitRatio', 0.05, 1.5),
      fingerExtendedRatio: bounded(merged.fingerExtendedRatio, 'fingerExtendedRatio', 1, 3),
      fingerCurledRatio: bounded(merged.fingerCurledRatio, 'fingerCurledRatio', 0.5, 2),
      grabCurlCount: positiveInteger(merged.grabCurlCount, 'grabCurlCount', 1, 4),
      dragStartDistancePx: bounded(configured('dragStartDistancePx', merged.dragStartDistancePx, options.dragThresholdPx), 'dragStartDistancePx', 1, 1000),
      transformScaleThreshold: bounded(configured('transformScaleThreshold', merged.transformScaleThreshold, transformOptions.scale), 'transformScaleThreshold', 0.001, 1),
      transformRotateThresholdDegrees: bounded(configured('transformRotateThresholdDegrees', merged.transformRotateThresholdDegrees, transformOptions.rotateDegrees), 'transformRotateThresholdDegrees', 0.1, 90),
      maxFrameGapMs: bounded(merged.maxFrameGapMs, 'maxFrameGapMs', 1, 120000),
    };
  }

  _resetInteraction() {
    this.active = null;
    this.pending = null;
    this.pendingNoneFrames = 0;
    this.twoHandPending = null;
    this.twoHand = null;
  }

  reset() {
    this.smoothedHands.clear();
    this._resetInteraction();
    this.lastTimestampMs = null;
  }

  getPrivacyStatus() {
    return privacyPolicy({ retainedHands: this.smoothedHands.size });
  }

  privacyStatus() {
    return this.getPrivacyStatus();
  }

  _nextEventId(timestampMs, gesture) {
    this.sequence += 1;
    return `${this.sessionId}-hand-${gesture}-${timestampMs}-${this.sequence}`.slice(0, 120);
  }

  _event({ gesture, phase, timestampMs, startedAtMs, points, confidence, transform }) {
    const displayPoints = points.map(point => ({
      ...toPixel(point, this.display),
      t_ms: Math.max(0, timestampMs - startedAtMs),
      pressure: clamp(confidence ?? 0.5),
    }));
    let displayTransform = null;
    if (transform) {
      displayTransform = {
        ...transform,
        center: toPixel(transform.center, this.display),
      };
    }
    return normalizeSpatialEvent({
      schema_version: HAND_GESTURE_SCHEMA,
      event_id: this._nextEventId(timestampMs, gesture),
      owner_id: this.ownerId,
      session_id: this.sessionId,
      context_id: this.contextId,
      source: HAND_SOURCE,
      gesture,
      phase,
      started_at_ms: startedAtMs,
      ended_at_ms: timestampMs,
      display: this.display,
      points: displayPoints,
      confidence: clamp(confidence ?? 0.5),
      transform: displayTransform,
    }, { ownerId: this.ownerId, sessionId: this.sessionId, now: this.now });
  }

  _activate(candidate, timestampMs) {
    const point = candidate.anchor;
    this.active = {
      kind: candidate.kind,
      handId: candidate.hand.hand_id,
      startedAtMs: timestampMs,
      anchor: { ...point },
      lastPoint: { ...point },
      lastConfidence: candidate.confidence,
      dragStarted: false,
    };
    this.pending = null;
    this.pendingNoneFrames = 0;
    return this._event({
      gesture: candidate.kind,
      phase: 'start',
      timestampMs,
      startedAtMs: timestampMs,
      points: [point],
      confidence: candidate.confidence,
    });
  }

  _release(timestampMs) {
    if (!this.active) return null;
    const active = this.active;
    const point = active.lastPoint;
    this.active = null;
    this.pending = null;
    this.pendingNoneFrames = 0;
    return this._event({
      gesture: 'release',
      phase: 'end',
      timestampMs,
      startedAtMs: active.startedAtMs,
      points: [point],
      confidence: active.lastConfidence,
    });
  }

  _setPending(candidate) {
    if (!candidate) return;
    if (!this.pending || this.pending.kind !== candidate.kind || this.pending.handId !== candidate.hand.hand_id) {
      this.pending = { kind: candidate.kind, handId: candidate.hand.hand_id, count: 1, candidate };
      return;
    }
    this.pending.count += 1;
    this.pending.candidate = candidate;
  }

  _processOneHand(candidate, timestampMs) {
    const events = [];
    if (!candidate || candidate.kind === 'none') {
      this.pending = null;
      this.pendingNoneFrames += 1;
      if (this.active && this.pendingNoneFrames >= this.options.exitFrames) {
        const release = this._release(timestampMs);
        if (release) events.push(release);
      }
      return events;
    }
    this.pendingNoneFrames = 0;
    if (!this.active) {
      this._setPending(candidate);
      if (this.pending.count >= this.options.enterFrames) {
        const activeCandidate = this.pending.candidate;
        const start = this._activate(activeCandidate, timestampMs);
        if (start) events.push(start);
      }
      return events;
    }
    const active = this.active;
    const sameHand = active.handId === candidate.hand.hand_id;
    const compatibleTransition = (active.kind === 'grab' && candidate.kind === 'point')
      || (active.kind === 'drag' && candidate.kind === 'grab');
    if (!sameHand || candidate.kind !== active.kind && !compatibleTransition) {
      this._setPending(candidate);
      if (this.pending.count < this.options.exitFrames) {
        // Keep the old gesture alive through brief classifier jitter.
        candidate = { ...candidate, kind: active.kind, anchor: candidate.anchor };
      } else {
        const release = this._release(timestampMs);
        if (release) events.push(release);
        if (candidate.kind !== 'none') {
          const start = this._activate(candidate, timestampMs);
          if (start) events.push(start);
        }
        return events;
      }
    } else {
      this.pending = null;
    }
    const point = candidate.anchor;
    active.lastPoint = { ...point };
    active.lastConfidence = candidate.confidence;
    if (active.kind === 'grab' || active.kind === 'drag') {
      const movedPx = distance(toPixel(active.anchor, this.display), toPixel(point, this.display));
      if (!active.dragStarted && movedPx >= this.options.dragStartDistancePx) {
        active.kind = 'drag';
        active.dragStarted = true;
        events.push(this._event({
          gesture: 'drag',
          phase: 'start',
          timestampMs,
          startedAtMs: active.startedAtMs,
          points: [point],
          confidence: candidate.confidence,
        }));
      } else if (active.dragStarted) {
        events.push(this._event({
          gesture: 'drag',
          phase: 'update',
          timestampMs,
          startedAtMs: active.startedAtMs,
          points: [point],
          confidence: candidate.confidence,
        }));
      } else {
        events.push(this._event({
          gesture: 'grab',
          phase: 'update',
          timestampMs,
          startedAtMs: active.startedAtMs,
          points: [point],
          confidence: candidate.confidence,
        }));
      }
    } else {
      events.push(this._event({
        gesture: active.kind,
        phase: 'update',
        timestampMs,
        startedAtMs: active.startedAtMs,
        points: [point],
        confidence: candidate.confidence,
      }));
    }
    return events;
  }

  _twoHandCandidate(candidates) {
    const available = candidates
      .filter(candidate => candidate.kind !== 'none')
      .sort((first, second) => first.hand.hand_id.localeCompare(second.hand.hand_id));
    if (available.length < 2) return null;
    return available.slice(0, 2);
  }

  _processTwoHands(pair, timestampMs) {
    const events = [];
    if (!pair) {
      this.twoHandPending = null;
      if (!this.twoHand) return events;
      this.twoHand.missingFrames += 1;
      if (this.twoHand.missingFrames >= this.options.twoHandExitFrames) this.twoHand = null;
      return events;
    }
    const key = pairKey(pair[0], pair[1]);
    if (!this.twoHand && (!this.twoHandPending || this.twoHandPending.key !== key)) {
      this.twoHandPending = { key, count: 1, pair };
    } else if (!this.twoHand) {
      this.twoHandPending.count += 1;
      this.twoHandPending.pair = pair;
    }
    if (!this.twoHand && this.twoHandPending.count >= this.options.twoHandEnterFrames) {
      const measurement = twoHandMeasurement(pair[0], pair[1], this.display);
      this.twoHand = {
        key,
        startedAtMs: timestampMs,
        baselineDistancePx: Math.max(measurement.distancePx, 0.000001),
        baselineAngleDegrees: measurement.angleDegrees,
        missingFrames: 0,
        emitted: false,
      };
      this.twoHandPending = null;
      // A two-hand transform owns the interaction stream.  Discard any
      // one-hand candidate at this boundary so it cannot be revived after
      // one hand disappears.
      this.active = null;
      this.pending = null;
      this.pendingNoneFrames = 0;
      // A two-hand mode owns the interaction stream.  Do not emit one-hand
      // gestures from the same frame.
      return events;
    }
    if (!this.twoHand) return events;
    if (this.twoHand.key !== key) {
      this.twoHand.missingFrames += 1;
      if (this.twoHand.missingFrames >= this.options.twoHandExitFrames) this.twoHand = null;
      return events;
    }
    this.twoHand.missingFrames = 0;
    const measurement = twoHandMeasurement(pair[0], pair[1], this.display);
    const scale = measurement.distancePx / this.twoHand.baselineDistancePx;
    const rotationDegrees = normalizeAngleDegrees(measurement.angleDegrees - this.twoHand.baselineAngleDegrees);
    const points = [
      { x: pair[0].palm.x, y: pair[0].palm.y },
      { x: pair[1].palm.x, y: pair[1].palm.y },
    ];
    const transform = {
      center: { x: (pair[0].palm.x + pair[1].palm.x) / 2, y: (pair[0].palm.y + pair[1].palm.y) / 2 },
      scale,
      rotation_degrees: rotationDegrees,
      distance_px: measurement.distancePx,
    };
    const confidence = Math.min(pair[0].confidence, pair[1].confidence);
    const phase = this.twoHand.emitted ? 'update' : 'start';
    if (Math.abs(scale - 1) >= this.options.transformScaleThreshold) {
      events.push(this._event({
        gesture: 'scale', phase, timestampMs, startedAtMs: this.twoHand.startedAtMs, points, confidence, transform,
      }));
    }
    if (Math.abs(rotationDegrees) >= this.options.transformRotateThresholdDegrees) {
      events.push(this._event({
        gesture: 'rotate', phase, timestampMs, startedAtMs: this.twoHand.startedAtMs, points, confidence, transform,
      }));
    }
    if (events.length) this.twoHand.emitted = true;
    return events;
  }

  _result(frame, events) {
    const result = {
      schema_version: HAND_GESTURE_SCHEMA,
      frame_schema_version: LANDMARK_FRAME_SCHEMA,
      frame_id: frame.frame_id,
      timestamp_ms: frame.timestamp_ms,
      events: deepFreeze(events.slice()),
      active_gesture: this.twoHand ? 'two-hand' : this.active?.kind ?? null,
      active: copyPublicState(this.active),
      privacy: this.getPrivacyStatus(),
    };
    return deepFreeze(result);
  }

  processFrame(input) {
    const frame = normalizeLandmarkFrame(input, { now: this.now });
    if (this.lastTimestampMs !== null && frame.timestamp_ms < this.lastTimestampMs) {
      throw invalid('Hand frame timestamps must be monotonic.', 'non_monotonic_hand_frame');
    }
    if (this.lastTimestampMs !== null && frame.timestamp_ms - this.lastTimestampMs > this.options.maxFrameGapMs) {
      this._resetInteraction();
    }
    this.lastTimestampMs = frame.timestamp_ms;
    const alpha = this.options.smoothingAlpha;
    const seen = new Set();
    for (const hand of frame.hands) {
      const smoothed = smoothHand(this.smoothedHands.get(hand.hand_id), hand, alpha);
      this.smoothedHands.set(hand.hand_id, smoothed);
      seen.add(hand.hand_id);
    }
    // Retain only the bounded current hand set.  There is deliberately no
    // frame history and no raw-image slot here.
    for (const handId of this.smoothedHands.keys()) {
      if (!seen.has(handId)) this.smoothedHands.delete(handId);
    }
    const candidates = [...this.smoothedHands.values()]
      .map(hand => classifyHand(hand, this.options, this.active?.kind))
      .sort((first, second) => second.confidence - first.confidence || first.hand.hand_id.localeCompare(second.hand.hand_id));
    const pair = this._twoHandCandidate(candidates);
    const events = this._processTwoHands(pair, frame.timestamp_ms);
    if (!this.twoHand && !this.twoHandPending) {
      const primary = candidates[0] || null;
      events.push(...this._processOneHand(primary, frame.timestamp_ms));
    } else if (this.twoHand || this.twoHandPending) {
      // While a two-hand candidate is stabilising, suppress one-hand starts.
      if (this.twoHand && !pair) events.push(...this._processOneHand(candidates[0] || null, frame.timestamp_ms));
    }
    return this._result(frame, events);
  }

  process(input) {
    return this.processFrame(input);
  }

  ingest(input) {
    return this.processFrame(input);
  }

  consume(input) {
    const result = this.processFrame(input);
    return result.events.at(-1) || null;
  }
}

function createHandGestureProcessor(options) {
  return new HandGestureProcessor(options);
}

module.exports = {
  DEFAULT_HAND_GESTURE_OPTIONS: DEFAULTS,
  FINGER_LAYOUT,
  HAND_GESTURE_SCHEMA,
  HAND_GESTURES,
  HAND_PHASES,
  HAND_SOURCE,
  HandGestureEngine: HandGestureProcessor,
  HandGestureFoundation: HandGestureProcessor,
  HandGestureProcessor,
  LANDMARK_COUNT,
  LANDMARK_FRAME_SCHEMA,
  MAX_HANDS,
  classifyHand,
  createHandGestureProcessor,
  createHandGestureEngine: createHandGestureProcessor,
  normalizeLandmarkFrame,
  normalizeSpatialEvent,
  privacyPolicy,
};
