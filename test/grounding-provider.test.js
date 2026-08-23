const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { GroundingProvider, GROUNDING_RESULT_SCHEMA_VERSION } = require('../src/core/grounding-provider');
const { ProviderError } = require('../src/core/provider');

const NOW = Date.parse('2026-08-22T10:00:00.000Z');

function capture(overrides = {}) {
  const bytes = overrides.bytes || Buffer.from('bounded-png-fixture');
  return {
    task_id: overrides.task_id || 'task-1',
    revision: overrides.revision || 2,
    metadata: {
      schema_version: 'solat.computer-screen-capture.v1',
      media_type: 'image/png',
      hwnd: overrides.hwnd || 44,
      size_bytes: bytes.length,
      sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      captured_at: overrides.captured_at || '2026-08-22T09:59:50.000Z',
      ...overrides.metadata,
    },
    bytes,
  };
}

function transport(completeStructuredVision) {
  return {
    status: () => ({ provider: 'vllm_vision', model: 'Hcompany/Holo2-4B', configured: true, baseHost: '127.0.0.1:8000' }),
    completeStructuredVision,
  };
}

test('grounding provider binds a fresh capture to task revision, HWND, and hash', async () => {
  let calls = 0;
  const provider = new GroundingProvider({
    transport: transport(async () => {
      calls += 1;
      return { data: { status: 'completed' }, timing: { total_ms: 12 } };
    }),
    now: () => NOW,
  });
  const result = await provider.completeStructuredVision([], {}, capture(), {
    taskId: 'task-1', revision: 2, hwnd: 44,
  });

  assert.equal(calls, 1);
  assert.equal(result.grounding.schema_version, GROUNDING_RESULT_SCHEMA_VERSION);
  assert.equal(result.grounding.verified, true);
  assert.equal(result.grounding.hwnd, 44);
  assert.equal(result.grounding.revision, 2);
  assert.match(result.grounding.capture_sha256, /^sha256:[0-9a-f]{64}$/u);
});

test('grounding provider rejects stale, cross-task, cross-window, and tampered captures before transport', async () => {
  let calls = 0;
  const provider = new GroundingProvider({
    transport: transport(async () => { calls += 1; return { data: {} }; }),
    now: () => NOW,
  });
  const context = { taskId: 'task-1', revision: 2, hwnd: 44 };
  const invalid = [
    capture({ task_id: 'task-2' }),
    capture({ revision: 3 }),
    capture({ hwnd: 55 }),
    capture({ captured_at: '2026-08-22T09:00:00.000Z' }),
    capture({ metadata: { sha256: 'sha256:tampered' } }),
  ];
  for (const candidate of invalid) {
    await assert.rejects(
      provider.completeStructuredVision([], {}, candidate, context),
      error => ['stale_vision_input', 'invalid_vision_input'].includes(error.code),
    );
  }
  assert.equal(calls, 0);
});

test('grounding provider exposes bounded vision-specific provider failures', async () => {
  const provider = new GroundingProvider({
    transport: transport(async () => { throw new ProviderError('timeout', 'provider timed out'); }),
    now: () => NOW,
  });
  await assert.rejects(
    provider.completeStructuredVision([], {}, capture(), { taskId: 'task-1', revision: 2, hwnd: 44 }),
    error => error.code === 'vision_timeout' && /provider timed out/u.test(error.message),
  );
});
