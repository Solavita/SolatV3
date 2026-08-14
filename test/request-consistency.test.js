const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildCompletionRequestBody, OpenAICompatibleProvider, ProviderError } = require('../src/core/provider');

const root = path.join(__dirname, '..');

function runHarness(iterations = 40) {
  const result = spawnSync(process.execPath, ['scripts/benchmark-request-consistency-local.js'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOLAT_REQUEST_CONSISTENCY_ITERATIONS: String(iterations) },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('production request builder preserves message and tool order deterministically', () => {
  const first = runHarness();
  const second = runHarness();
  assert.equal(first.schema_version, 'solat.request-consistency-local.v1');
  assert.equal(first.status, 'PASS');
  assert.equal(first.mismatch_count, 0);
  assert.deepEqual(first.message_order, ['system', 'user', 'assistant', 'user']);
  assert.deepEqual(first.tool_order, ['web_search', 'web_read_page']);
  assert.equal(first.baseline_request_sha256, second.baseline_request_sha256);
  assert.equal(first.correction_request_sha256, second.correction_request_sha256);
  assert.notEqual(first.baseline_request_sha256, first.correction_request_sha256);
  assert.equal(first.semantic_answer_consistency, 'NOT VERIFIED');
  assert.match(first.scope, /semantic answer consistency remains NOT VERIFIED/iu);
});

test('production request builder keeps provider-specific fields local and rejects invalid tools', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const deepSeek = buildCompletionRequestBody({ baseUrl: 'https://api.deepseek.com', model: 'm', thinkingMode: 'disabled' }, messages);
  assert.deepEqual(deepSeek, { model: 'm', messages, stream: false, thinking: { type: 'disabled' } });
  const compatible = buildCompletionRequestBody({ baseUrl: 'https://example.test/v1', model: 'm' }, messages);
  assert.deepEqual(compatible, { model: 'm', messages, stream: false });
  assert.throws(
    () => buildCompletionRequestBody({ model: 'm' }, messages, { tools: {} }),
    error => error instanceof ProviderError && error.code === 'invalid_tools',
  );
});

test('provider complete sends the same body produced by the deterministic request builder', async () => {
  const config = {
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'local-test-key',
    model: 'local-contract-model',
    thinkingMode: 'disabled',
    timeoutMs: 1000,
  };
  const messages = [{ role: 'system', content: 'versioned prompt' }, { role: 'user', content: 'hello' }];
  const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {}, additionalProperties: false } } }];
  let actualBody;
  const fetchImpl = async (_url, options) => {
    actualBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() { return { choices: [{ message: { role: 'assistant', content: 'ok' } }] }; },
    };
  };
  const provider = new OpenAICompatibleProvider(config, fetchImpl);
  await provider.complete(messages, { tools, toolChoice: 'auto' });
  assert.deepEqual(actualBody, buildCompletionRequestBody(config, messages, { tools, toolChoice: 'auto' }));
  assert.equal(Object.hasOwn(actualBody, 'apiKey'), false);
});
