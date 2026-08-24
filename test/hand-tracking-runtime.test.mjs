import assert from 'node:assert/strict';
import test from 'node:test';
import { HandTrackingRuntime } from '../renderer/hand-tracking-runtime.mjs';

test('camera runtime sends landmarks only and releases every local resource on stop', async () => {
  const calls = []; const states = []; const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const video = { readyState: 2, srcObject: null, async play() {}, pause() {}, remove() { this.removed = true; } };
  let frameCallback = null;
  const runtime = new HandTrackingRuntime({
    bridge: {
      handStart: async value => calls.push(['start', value]),
      handFrame: async value => calls.push(['frame', value]),
      handStop: async value => calls.push(['stop', value]),
    },
    mediaDevices: { getUserMedia: async constraints => { calls.push(['media', constraints]); return stream; } },
    documentRef: { createElement: () => video, body: { appendChild() {} } },
    detectorFactory: async () => ({
      detectForVideo: () => ({ landmarks: [Array.from({ length: 21 }, (_, index) => ({ x: index / 20, y: index / 20, z: 0 }))], handednesses: [[{ categoryName: 'Left', score: 0.9 }]] }),
      close() { calls.push(['detector-closed']); },
    }),
    raf: callback => { frameCallback = callback; return 1; }, cancelRaf: () => {}, onState: state => states.push(state), now: () => 1_700_000_000_000,
  });
  await runtime.start('thread-a');
  await frameCallback(100);
  const sent = calls.find(call => call[0] === 'frame')[1];
  assert.equal(sent.frame.hands[0].landmarks.length, 21);
  assert.equal(sent.frame.timestamp_ms, 1_700_000_000_000);
  assert.equal(JSON.stringify(sent).includes('image'), false);
  assert.deepEqual(calls.find(call => call[0] === 'media')[1], { audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
  await runtime.stop();
  assert.equal(tracks[0].stopped, true);
  assert.equal(video.removed, true);
  assert.equal(runtime.detector, null);
  assert.equal(runtime.stream, null);
  assert.equal(states.at(-1), 'idle');
});

test('camera runtime coalesces concurrent starts and rolls back a detector failure', async () => {
  let mediaCalls = 0; const track = { stopped: false, stop() { this.stopped = true; } };
  const video = { readyState: 2, async play() {}, pause() {}, remove() { this.removed = true; } };
  const runtime = new HandTrackingRuntime({
    bridge: { handStart: async () => {}, handFrame: async () => {}, handStop: async () => {} },
    mediaDevices: { getUserMedia: async () => { mediaCalls += 1; return { getTracks: () => [track] }; } },
    documentRef: { createElement: () => video, body: { appendChild() {} } },
    detectorFactory: async () => { throw new Error('detector failed'); },
    raf: () => 1, cancelRaf: () => {},
  });
  const first = runtime.start('thread-a'); const second = runtime.start('thread-a');
  await assert.rejects(first, /detector failed/); await assert.rejects(second, /detector failed/);
  assert.equal(mediaCalls, 1); assert.equal(track.stopped, true); assert.equal(video.removed, true); assert.equal(runtime.active, false);
});

test('stop while microphone-free camera permission is pending invalidates and cleans the late stream', async () => {
  let resolveMedia; let starts = 0; const states = []; const track = { stopped: false, stop() { this.stopped = true; } };
  const runtime = new HandTrackingRuntime({
    bridge: { handStart: async () => { starts += 1; }, handFrame: async () => {}, handStop: async () => {} },
    mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveMedia = resolve; }) },
    documentRef: { createElement: () => { throw new Error('video should not be created'); }, body: { appendChild() {} } },
    detectorFactory: async () => { throw new Error('detector should not start'); },
    raf: () => 1, cancelRaf: () => {}, onState: state => states.push(state),
  });
  const starting = runtime.start('thread-a'); await Promise.resolve();
  await runtime.stop(); resolveMedia({ getTracks: () => [track] });
  await assert.rejects(starting, error => error.code === 'hand_start_cancelled');
  assert.equal(track.stopped, true); assert.equal(starts, 0); assert.equal(runtime.active, false); assert.equal(states.at(-1), 'idle');
});
