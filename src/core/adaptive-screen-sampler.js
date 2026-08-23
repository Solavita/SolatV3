const ADAPTIVE_SCREEN_SAMPLER_SCHEMA_VERSION = 'solat.adaptive-screen-sampler.v1';
const MIN_INTERVAL_MS = 500;
const MAX_FRAMES = 3;
const MAX_DURATION_MS = 2_000;

class AdaptiveScreenSamplerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdaptiveScreenSamplerError';
    this.code = code;
  }
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AdaptiveScreenSamplerError('invalid_arguments', `${field} must be a positive integer.`);
  }
  return number;
}

function finiteMilliseconds(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AdaptiveScreenSamplerError('invalid_arguments', `${field} must be a non-negative number.`);
  }
  return number;
}

function timestampMilliseconds(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new AdaptiveScreenSamplerError('invalid_sampler_config', 'now() must return a valid timestamp.');
  }
  return timestamp;
}

function defaultNow() {
  return Date.now();
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AdaptiveScreenSamplerError('cancelled', 'Adaptive screen sampling was cancelled.'));
      return;
    }

    let timer;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new AdaptiveScreenSamplerError('cancelled', 'Adaptive screen sampling was cancelled.'));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function cancellationError() {
  return new AdaptiveScreenSamplerError('cancelled', 'Adaptive screen sampling was cancelled.');
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw cancellationError();
}

function captureHash(capture, hwnd) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new AdaptiveScreenSamplerError('invalid_capture', 'screenCapture.capture() returned an invalid capture.');
  }
  const metadata = capture.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new AdaptiveScreenSamplerError('invalid_capture', 'The capture metadata is missing or invalid.');
  }
  if (Number(metadata.hwnd) !== hwnd) {
    throw new AdaptiveScreenSamplerError('target_mismatch', 'The capture was not taken from the requested HWND.');
  }
  const hash = typeof metadata.sha256 === 'string' ? metadata.sha256.trim() : '';
  if (!hash) {
    throw new AdaptiveScreenSamplerError('invalid_capture', 'The capture hash is missing.');
  }
  return hash;
}

function safeMetadata(metadata) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (['bytes', 'buffer', 'data', 'image', 'image_bytes', 'base64'].includes(key)) continue;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  return Object.freeze(safe);
}

function sanitizedCapture(capture) {
  return Object.freeze({
    ...capture,
    metadata: safeMetadata(capture.metadata),
  });
}

class AdaptiveScreenSampler {
  constructor({
    screenCapture,
    intervalMs = MIN_INTERVAL_MS,
    maxFrames = MAX_FRAMES,
    maxDurationMs = MAX_DURATION_MS,
    sleep = defaultSleep,
    now = defaultNow,
  } = {}) {
    if (!screenCapture || typeof screenCapture.capture !== 'function') {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', 'A screenCapture.capture function is required.');
    }
    if (typeof sleep !== 'function' || typeof now !== 'function') {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', 'sleep and now must be functions.');
    }

    const interval = finiteMilliseconds(intervalMs, 'intervalMs');
    const frames = positiveInteger(maxFrames, 'maxFrames');
    const duration = finiteMilliseconds(maxDurationMs, 'maxDurationMs');
    if (interval < MIN_INTERVAL_MS) {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', `intervalMs must be at least ${MIN_INTERVAL_MS}ms.`);
    }
    if (frames > MAX_FRAMES) {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', `maxFrames cannot exceed ${MAX_FRAMES}.`);
    }
    if (duration > MAX_DURATION_MS) {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', `maxDurationMs cannot exceed ${MAX_DURATION_MS}ms.`);
    }
    if (duration < interval && frames > 1) {
      throw new AdaptiveScreenSamplerError('invalid_sampler_config', 'maxDurationMs must cover at least one sampling interval.');
    }

    this.screenCapture = screenCapture;
    this.intervalMs = interval;
    this.maxFrames = frames;
    this.maxDurationMs = duration;
    this.sleep = sleep;
    this.now = now;
  }

  async sample({ hwnd: rawHwnd, signal } = {}) {
    const hwnd = positiveInteger(rawHwnd, 'hwnd');
    assertNotAborted(signal);
    const startedAt = timestampMilliseconds(this.now());
    let latestCapture = null;
    let previousHash = null;
    let framesSampled = 0;
    let changedFrames = 0;
    let stopReason = 'max_frames';

    while (framesSampled < this.maxFrames) {
      assertNotAborted(signal);
      const elapsedBeforeCapture = Math.max(0, timestampMilliseconds(this.now()) - startedAt);
      if (framesSampled > 0) {
        if (elapsedBeforeCapture + this.intervalMs > this.maxDurationMs) {
          stopReason = 'max_duration';
          break;
        }
        try {
          await this.sleep(this.intervalMs, signal);
        } catch (error) {
          if (signal?.aborted || error?.code === 'cancelled') throw cancellationError();
          throw error;
        }
        assertNotAborted(signal);
        if (Math.max(0, timestampMilliseconds(this.now()) - startedAt) > this.maxDurationMs) {
          stopReason = 'max_duration';
          break;
        }
      }

      let captured;
      try {
        captured = await this.screenCapture.capture({ hwnd, signal });
      } catch (error) {
        if (signal?.aborted || error?.code === 'cancelled') throw cancellationError();
        throw error;
      }
      const hash = captureHash(captured, hwnd);
      latestCapture = sanitizedCapture(captured);
      framesSampled += 1;
      if (previousHash !== null && previousHash !== hash) changedFrames += 1;
      if (previousHash !== null && previousHash === hash) {
        stopReason = 'stable_hash';
        break;
      }
      previousHash = hash;

      const elapsedAfterCapture = Math.max(0, timestampMilliseconds(this.now()) - startedAt);
      if (elapsedAfterCapture >= this.maxDurationMs && framesSampled < this.maxFrames) {
        stopReason = 'max_duration';
        break;
      }
    }

    if (!latestCapture) {
      throw new AdaptiveScreenSamplerError('no_capture', 'No screen capture was available within the sampling bound.');
    }

    const elapsedMs = Math.min(
      this.maxDurationMs,
      Math.max(0, timestampMilliseconds(this.now()) - startedAt),
    );
    return Object.freeze({
      capture: latestCapture,
      metadata: Object.freeze({
        schema_version: ADAPTIVE_SCREEN_SAMPLER_SCHEMA_VERSION,
        status: 'ready',
        operation: 'adaptive_window_snapshot',
        hwnd,
        selected_sha256: previousHash,
        frames_sampled: framesSampled,
        changed_frames: changedFrames,
        interval_ms: this.intervalMs,
        max_frames: this.maxFrames,
        max_duration_ms: this.maxDurationMs,
        elapsed_ms: elapsedMs,
        stop_reason: stopReason,
        image_bytes_omitted: true,
      }),
    });
  }
}

async function sampleAdaptiveScreenCapture(options) {
  const { screenCapture, ...samplerOptions } = options || {};
  return new AdaptiveScreenSampler({ screenCapture, ...samplerOptions }).sample(options);
}

module.exports = {
  ADAPTIVE_SCREEN_SAMPLER_SCHEMA_VERSION,
  AdaptiveScreenSampler,
  AdaptiveScreenSamplerError,
  MAX_DURATION_MS,
  MAX_FRAMES,
  MIN_INTERVAL_MS,
  sampleAdaptiveScreenCapture,
};
