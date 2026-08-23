const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AdaptiveScreenSampler,
  AdaptiveScreenSamplerError,
} = require('../src/core/adaptive-screen-sampler');

function capture(hwnd, hash, marker) {
  return {
    metadata: {
      schema_version: 'solat.computer-screen-capture.v1',
      hwnd,
      sha256: hash,
      marker,
      bytes: Buffer.from(`metadata-${marker}`),
    },
    bytes: Buffer.from(`image-${marker}`),
  };
}

function harness(sequence, options = {}) {
  let nowMs = 0;
  let index = 0;
  const calls = [];
  const sleeps = [];
  const screenCapture = {
    async capture({ hwnd, signal }) {
      calls.push({ hwnd, signal });
      const next = sequence[index++];
      if (!next) throw new Error('unexpected capture');
      return capture(hwnd, next.hash, next.marker);
    },
  };
  const sampler = new AdaptiveScreenSampler({
    screenCapture,
    now: () => nowMs,
    sleep: async delayMs => {
      sleeps.push(delayMs);
      nowMs += delayMs;
    },
    ...options,
  });
  return { sampler, calls, sleeps };
}

test('stops after two duplicate hashes and returns the stable latest capture', async () => {
  const { sampler, calls, sleeps } = harness([
    { hash: 'sha256:a', marker: 'first' },
    { hash: 'sha256:a', marker: 'stable' },
  ]);

  const result = await sampler.sample({ hwnd: 4242 });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.hwnd), [4242, 4242]);
  assert.deepEqual(sleeps, [500]);
  assert.equal(result.capture.bytes.toString(), 'image-stable');
  assert.equal(result.metadata.stop_reason, 'stable_hash');
  assert.equal(result.metadata.frames_sampled, 2);
  assert.equal(result.metadata.changed_frames, 0);
  assert.equal(result.metadata.image_bytes_omitted, true);
  assert.equal(Object.hasOwn(result.metadata, 'bytes'), false);
  assert.equal(JSON.stringify(result.metadata).includes('image-stable'), false);
});

test('returns the newest changed capture when the screen keeps changing', async () => {
  const { sampler, sleeps } = harness([
    { hash: 'sha256:a', marker: 'first' },
    { hash: 'sha256:b', marker: 'second' },
    { hash: 'sha256:c', marker: 'latest' },
  ]);

  const result = await sampler.sample({ hwnd: 7 });

  assert.equal(result.capture.bytes.toString(), 'image-latest');
  assert.equal(result.metadata.selected_sha256, 'sha256:c');
  assert.equal(result.metadata.frames_sampled, 3);
  assert.equal(result.metadata.changed_frames, 2);
  assert.equal(result.metadata.stop_reason, 'max_frames');
  assert.deepEqual(sleeps, [500, 500]);
});

test('returns the latest frame that becomes stable after a change', async () => {
  const { sampler } = harness([
    { hash: 'sha256:a', marker: 'before' },
    { hash: 'sha256:b', marker: 'changed' },
    { hash: 'sha256:b', marker: 'stable-latest' },
  ]);

  const result = await sampler.sample({ hwnd: 9 });

  assert.equal(result.capture.bytes.toString(), 'image-stable-latest');
  assert.equal(result.metadata.stop_reason, 'stable_hash');
  assert.equal(result.metadata.frames_sampled, 3);
  assert.equal(result.metadata.changed_frames, 1);
});

test('never samples more than three frames even when every hash changes', async () => {
  const { sampler, calls } = harness([
    { hash: 'sha256:a', marker: 'one' },
    { hash: 'sha256:b', marker: 'two' },
    { hash: 'sha256:c', marker: 'three' },
    { hash: 'sha256:d', marker: 'must-not-run' },
  ]);

  const result = await sampler.sample({ hwnd: 11 });

  assert.equal(calls.length, 3);
  assert.equal(result.capture.bytes.toString(), 'image-three');
  assert.equal(result.metadata.max_frames, 3);
  assert.equal(result.metadata.stop_reason, 'max_frames');
});

test('supports cancellation while waiting for the next bounded frame', async () => {
  const controller = new AbortController();
  let captureCalls = 0;
  const sampler = new AdaptiveScreenSampler({
    screenCapture: {
      async capture({ hwnd }) {
        captureCalls += 1;
        return capture(hwnd, 'sha256:first', 'first');
      },
    },
    sleep: (_delayMs, signal) => new Promise((resolve, reject) => {
      const abort = () => reject(new AdaptiveScreenSamplerError('cancelled', 'cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    }),
  });
  const pending = sampler.sample({ hwnd: 12, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, error => error.code === 'cancelled');
  assert.equal(captureCalls, 1);
});

test('rejects unsafe sampling limits instead of silently exceeding them', () => {
  assert.throws(() => new AdaptiveScreenSampler({
    screenCapture: { capture: async () => capture(1, 'sha256:a', 'x') },
    intervalMs: 499,
  }), error => error.code === 'invalid_sampler_config');
  assert.throws(() => new AdaptiveScreenSampler({
    screenCapture: { capture: async () => capture(1, 'sha256:a', 'x') },
    maxFrames: 4,
  }), error => error.code === 'invalid_sampler_config');
});
