const crypto = require('node:crypto');
const { ProviderError } = require('./provider');

const GROUNDING_RESULT_SCHEMA_VERSION = 'solat.grounding-result.v1';
const CAPTURE_SCHEMA_VERSION = 'solat.computer-screen-capture.v1';
const DEFAULT_MAX_CAPTURE_AGE_MS = 30_000;

function validContext(context) {
  const taskId = String(context?.taskId || '').trim();
  const revision = Number(context?.revision);
  const hwnd = Number(context?.hwnd);
  if (!taskId || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(hwnd) || hwnd < 1) {
    throw new ProviderError('invalid_vision_context', 'Vision grounding requires a current task, revision, and trusted HWND.');
  }
  return { taskId, revision, hwnd };
}

function validateGroundingCapture(capture, context, { nowMs, maxCaptureAgeMs }) {
  const metadata = capture?.metadata;
  const bytes = capture?.bytes;
  if (!metadata || metadata.schema_version !== CAPTURE_SCHEMA_VERSION || metadata.media_type !== 'image/png'
    || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
    throw new ProviderError('invalid_vision_input', 'A validated bounded PNG screen capture is required.');
  }
  if (capture.task_id !== context.taskId || Number(capture.revision) !== context.revision
    || Number(metadata.hwnd) !== context.hwnd) {
    throw new ProviderError('stale_vision_input', 'The screen capture does not belong to the current task revision and HWND.');
  }
  const capturedAt = Date.parse(metadata.captured_at);
  if (!Number.isFinite(capturedAt) || nowMs - capturedAt < 0 || nowMs - capturedAt > maxCaptureAgeMs) {
    throw new ProviderError('stale_vision_input', 'The screen capture is stale or has an invalid timestamp.');
  }
  const sha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  if (metadata.sha256 !== sha256 || Number(metadata.size_bytes) !== bytes.length) {
    throw new ProviderError('invalid_vision_input', 'The screen capture hash or byte length does not match its trusted metadata.');
  }
  return { metadata, bytes, sha256 };
}

class GroundingProvider {
  constructor({ transport, now = () => Date.now(), maxCaptureAgeMs = DEFAULT_MAX_CAPTURE_AGE_MS } = {}) {
    if (!transport || typeof transport.completeStructuredVision !== 'function' || typeof transport.status !== 'function') {
      throw new ProviderError('invalid_config', 'A vision-capable provider transport is required.');
    }
    this.transport = transport;
    this.now = now;
    this.maxCaptureAgeMs = maxCaptureAgeMs;
  }

  status() {
    return this.transport.status();
  }

  async completeStructuredVision(messages, schema, capture, rawContext) {
    const context = validContext(rawContext);
    const validated = validateGroundingCapture(capture, context, {
      nowMs: this.now(), maxCaptureAgeMs: this.maxCaptureAgeMs,
    });
    try {
      const result = await this.transport.completeStructuredVision(messages, schema, {
        metadata: validated.metadata,
        bytes: validated.bytes,
      });
      return {
        ...result,
        grounding: Object.freeze({
          schema_version: GROUNDING_RESULT_SCHEMA_VERSION,
          source: 'screen_capture',
          mode: 'uia_insufficient',
          verified: true,
          hwnd: context.hwnd,
          revision: context.revision,
          capture_sha256: validated.sha256,
        }),
      };
    } catch (error) {
      const code = error?.code === 'timeout'
        ? 'vision_timeout'
        : error?.code === 'malformed_response'
          ? 'vision_malformed_response'
          : 'vision_unavailable';
      throw new ProviderError(code, `Vision grounding failed: ${String(error?.message || 'provider unavailable').slice(0, 300)}`);
    }
  }
}

module.exports = {
  CAPTURE_SCHEMA_VERSION,
  DEFAULT_MAX_CAPTURE_AGE_MS,
  GROUNDING_RESULT_SCHEMA_VERSION,
  GroundingProvider,
  validateGroundingCapture,
};
