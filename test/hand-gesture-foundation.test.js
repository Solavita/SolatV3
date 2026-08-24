const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HAND_GESTURE_SCHEMA,
  LANDMARK_FRAME_SCHEMA,
  MAX_HANDS,
  HandGestureProcessor,
  normalizeLandmarkFrame,
  normalizeSpatialEvent,
} = require('../src/core/hand-gesture-foundation');

const DISPLAY = { id: 'synthetic-display', scale_factor: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } };

function transformPoint(point, { x = 0, y = 0, angle = 0, scale = 1 } = {}) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x + (point.x * cosine - point.y * sine) * scale,
    y: y + (point.x * sine + point.y * cosine) * scale,
  };
}

function makeHand({ handId = 'hand-a', handedness = 'left', x = 0.35, y = 0.55, gesture = 'point', angle = 0, scale = 1 } = {}) {
  const base = [
    { x: 0, y: 0 }, // wrist
    { x: -0.08, y: 0.07 }, { x: -0.1, y: 0.12 }, { x: -0.11, y: 0.15 },
    { x: gesture === 'pinch' ? -0.025 : -0.16, y: gesture === 'pinch' ? -0.09 : 0.18 }, // thumb tip
    { x: -0.03, y: -0.08 }, { x: -0.03, y: -0.17 }, { x: -0.03, y: -0.23 },
    { x: gesture === 'point' ? -0.03 : -0.01, y: gesture === 'point' ? -0.34 : (gesture === 'pinch' ? -0.085 : 0.03) },
    { x: 0.03, y: 0.08 }, { x: 0.04, y: 0.1 }, { x: 0.03, y: 0.04 }, { x: 0.01, y: 0.02 },
    { x: 0.08, y: 0.09 }, { x: 0.1, y: 0.12 }, { x: 0.07, y: 0.05 }, { x: 0.04, y: 0.03 },
    { x: 0.13, y: 0.1 }, { x: 0.16, y: 0.12 }, { x: 0.1, y: 0.06 }, { x: 0.07, y: 0.03 },
  ];
  const landmarks = base.map(point => {
    const transformed = transformPoint(point, { x, y, angle, scale });
    return { ...transformed, z: 0, visibility: 1 };
  });
  return { hand_id: handId, handedness, score: 1, landmarks };
}

function frame(timestampMs, hands) {
  return {
    schema_version: LANDMARK_FRAME_SCHEMA,
    frame_id: `synthetic-${timestampMs}`,
    timestamp_ms: timestampMs,
    coordinate_space: 'normalized-0..1',
    hands,
  };
}

function processor(options = {}) {
  return new HandGestureProcessor({
    ownerId: 'owner-a',
    sessionId: 'session-a',
    display: DISPLAY,
    smoothingAlpha: 1,
    enterFrames: 1,
    exitFrames: 2,
    twoHandEnterFrames: 1,
    twoHandExitFrames: 2,
    ...options,
  });
}

test('hand landmark and SpatialEvent contracts are versioned and provider-neutral', () => {
  const normalized = normalizeLandmarkFrame(frame(10, [makeHand()]));
  assert.equal(normalized.schema_version, LANDMARK_FRAME_SCHEMA);
  assert.equal(normalized.hands.length, 1);
  assert.equal(normalized.hands[0].landmarks.length, 21);

  const event = normalizeSpatialEvent({
    gesture: 'point',
    phase: 'start',
    started_at_ms: 10,
    ended_at_ms: 10,
    display: DISPLAY,
    points: [{ x: 100, y: 120, t_ms: 0 }],
  }, { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(event.schema_version, 'solat.spatial-event.v1');
  assert.equal(event.source, 'hand');
  assert.equal(event.gesture, 'point');
  assert.equal(event.coordinate_space, 'display-local-css-px');
  assert.equal(event.owner_id, 'owner-a');
});

test('landmark boundary rejects image payloads, malformed hand count, and invalid points', () => {
  assert.throws(() => normalizeLandmarkFrame({ ...frame(1, [makeHand()]), imageData: 'should-not-cross-boundary' }), /raw images|not accepted/iu);
  assert.throws(() => normalizeLandmarkFrame(frame(2, [makeHand(), makeHand({ handId: 'hand-b', handedness: 'right' }), makeHand({ handId: 'hand-c' })])), /between 0 and 2/iu);
  assert.throws(() => normalizeLandmarkFrame(frame(3, [{ ...makeHand(), landmarks: makeHand().landmarks.slice(0, 20) }])), /exactly 21/iu);
  assert.equal(MAX_HANDS, 2);
});

test('synthetic point, pinch, grab, drag, and release produce SpatialEvents', () => {
  const pointProcessor = processor();
  const pointStart = pointProcessor.processFrame(frame(0, [makeHand({ gesture: 'point' })]));
  assert.equal(pointStart.events[0].gesture, 'point');
  assert.equal(pointStart.events[0].phase, 'start');
  assert.equal(pointStart.events[0].source, 'hand');

  const pinchProcessor = processor();
  const pinchStart = pinchProcessor.processFrame(frame(0, [makeHand({ gesture: 'pinch' })]));
  assert.equal(pinchStart.events[0].gesture, 'pinch');

  const grabProcessor = processor();
  const grabStart = grabProcessor.processFrame(frame(0, [makeHand({ gesture: 'grab' })]));
  assert.equal(grabStart.events[0].gesture, 'grab');
  const drag = grabProcessor.processFrame(frame(50, [makeHand({ gesture: 'grab', x: 0.5 })]));
  assert.equal(drag.events.at(-1).gesture, 'drag');
  assert.equal(drag.events.at(-1).phase, 'start');

  const releaseOne = grabProcessor.processFrame(frame(100, []));
  assert.equal(releaseOne.events.length, 0, 'release is hysteretic over one missing frame');
  const releaseTwo = grabProcessor.processFrame(frame(150, []));
  assert.equal(releaseTwo.events.at(-1).gesture, 'release');
  assert.equal(releaseTwo.events.at(-1).phase, 'end');
});

test('smoothing and hysteresis prevent a noisy pinch from flapping', () => {
  const handProcessor = processor({ smoothingAlpha: 0.25, exitFrames: 3 });
  const first = handProcessor.processFrame(frame(0, [makeHand({ gesture: 'pinch' })]));
  assert.equal(first.events.at(-1).gesture, 'pinch');
  // Point geometry is intentionally close to the pinch exit boundary for the
  // next two frames.  The active pinch must survive brief classifier jitter.
  const jitterOne = handProcessor.processFrame(frame(16, [makeHand({ gesture: 'point' })]));
  const jitterTwo = handProcessor.processFrame(frame(32, [makeHand({ gesture: 'point' })]));
  assert.equal(jitterOne.active_gesture, 'pinch');
  assert.equal(jitterTwo.active_gesture, 'pinch');
  const release = handProcessor.processFrame(frame(48, []));
  assert.equal(release.active_gesture, 'pinch');
  handProcessor.processFrame(frame(64, []));
  const releaseAfterHysteresis = handProcessor.processFrame(frame(80, []));
  assert.equal(releaseAfterHysteresis.active_gesture, null);
  assert.equal(releaseAfterHysteresis.events.at(-1).gesture, 'release');
});

test('two synthetic hands emit useful scale and rotate transforms', () => {
  const handProcessor = processor({ twoHandEnterFrames: 1, transformScaleThreshold: 0.01, transformRotateThresholdDegrees: 2 });
  const baseline = handProcessor.processFrame(frame(0, [
    makeHand({ handId: 'left', handedness: 'left', x: 0.30, y: 0.5 }),
    makeHand({ handId: 'right', handedness: 'right', x: 0.70, y: 0.5 }),
  ]));
  assert.equal(baseline.events.length, 0, 'baseline establishes transform origin');
  const transformed = handProcessor.processFrame(frame(50, [
    makeHand({ handId: 'left', handedness: 'left', x: 0.24, y: 0.56, angle: 0.1, scale: 1.05 }),
    makeHand({ handId: 'right', handedness: 'right', x: 0.76, y: 0.44, angle: 0.1, scale: 1.05 }),
  ]));
  const gestures = transformed.events.map(event => event.gesture);
  assert.ok(gestures.includes('scale'));
  assert.ok(gestures.includes('rotate'));
  const scale = transformed.events.find(event => event.gesture === 'scale');
  assert.ok(scale.transform.scale > 1);
  assert.ok(Math.abs(scale.transform.rotation_degrees) > 2);
  assert.equal(scale.points.length, 2);
  assert.equal(scale.schema_version, 'solat.spatial-event.v1');
});

test('privacy status is bounded and contains no image or frame persistence', () => {
  const handProcessor = processor();
  const result = handProcessor.processFrame(frame(0, [makeHand()]));
  assert.equal(result.privacy.raw_images_persisted, false);
  assert.equal(result.privacy.raw_frames_persisted, false);
  assert.equal(result.privacy.retained_hand_count, 1);
  assert.equal(result.privacy.retained_landmark_count, 21);
  assert.equal(handProcessor.rawFrames, undefined);
  assert.doesNotMatch(JSON.stringify(result), /imageData|pixels|base64|jpeg|png/iu);
  handProcessor.reset();
  assert.equal(handProcessor.getPrivacyStatus().retained_hand_count, 0);
});

test('processor rejects non-monotonic frame timestamps before changing state', () => {
  const handProcessor = processor();
  handProcessor.processFrame(frame(100, [makeHand()]));
  assert.throws(() => handProcessor.processFrame(frame(99, [makeHand()])), /monotonic/iu);
  assert.equal(handProcessor.lastTimestampMs, 100);
});
