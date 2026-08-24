const crypto = require('node:crypto');
const { ProviderError } = require('./provider');

const GROUNDING_RESULT_SCHEMA_VERSION = 'solat.grounding-result.v1';
const CAPTURE_SCHEMA_VERSION = 'solat.computer-screen-capture.v1';
const BROWSER_CAPTURE_SCHEMA_VERSION = 'solat.browser-visual-capture.v1';
const DEFAULT_MAX_CAPTURE_AGE_MS = 30_000;

function validContext(context) {
  const taskId = String(context?.taskId || '').trim();
  const revision = Number(context?.revision);
  const hwnd = Number(context?.hwnd);
  const surfaceId = String(context?.surfaceId || '').trim();
  const navigationRevision = Number(context?.navigationRevision);
  if (!taskId || !Number.isSafeInteger(revision) || revision < 1) {
    throw new ProviderError('invalid_vision_context', 'Vision grounding requires a current task and revision.');
  }
  if (surfaceId) {
    if (!Number.isSafeInteger(navigationRevision) || navigationRevision < 1) {
      throw new ProviderError('invalid_vision_context', 'Browser visual grounding requires a surface and navigation revision.');
    }
    return { taskId, revision, surfaceId, navigationRevision, hwnd: null };
  }
  if (!Number.isSafeInteger(hwnd) || hwnd < 1) {
    throw new ProviderError('invalid_vision_context', 'Vision grounding requires a trusted HWND or browser surface.');
  }
  return { taskId, revision, hwnd };
}

function validateGroundingCapture(capture, context, { nowMs, maxCaptureAgeMs }) {
  const metadata = capture?.metadata;
  const bytes = capture?.bytes;
  const browserCapture = metadata?.schema_version === BROWSER_CAPTURE_SCHEMA_VERSION;
  const expectedSchema = browserCapture ? BROWSER_CAPTURE_SCHEMA_VERSION : CAPTURE_SCHEMA_VERSION;
  if (!metadata || metadata.schema_version !== expectedSchema || metadata.media_type !== 'image/png'
    || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
    throw new ProviderError('invalid_vision_input', 'A validated bounded PNG screen capture is required.');
  }
  const identityMatches = browserCapture
    ? (capture.surface_id || metadata.surface_id) === context.surfaceId
      && metadata.surface_id === context.surfaceId
      && Number(metadata.navigation_revision) === context.navigationRevision
    : Number(metadata.hwnd) === context.hwnd;
  if (capture.task_id !== context.taskId || Number(capture.revision) !== context.revision || !identityMatches) {
    throw new ProviderError('stale_vision_input', 'The visual capture does not belong to the current task revision and target surface.');
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
          mode: validated.metadata.schema_version === BROWSER_CAPTURE_SCHEMA_VERSION ? 'browser_visual_fallback' : 'uia_insufficient',
          verified: true,
          revision: context.revision,
          capture_sha256: validated.sha256,
          ...(context.hwnd ? { hwnd: context.hwnd } : {
            surface_id: context.surfaceId,
            navigation_revision: context.navigationRevision,
          }),
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
  BROWSER_CAPTURE_SCHEMA_VERSION,
  DEFAULT_MAX_CAPTURE_AGE_MS,
  GROUNDING_RESULT_SCHEMA_VERSION,
  GroundingProvider,
  validateGroundingCapture,
};
