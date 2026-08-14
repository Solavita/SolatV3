const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenAICompatibleProvider } = require('../src/core/provider');

function structuredProvider(content) {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs: 1000,
  }, async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content } }] };
    },
  }));
}

test('provider rejects duplicate tool call ids before any tool execution', async () => {
  let requestCount = 0;
  let executionCount = 0;
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs: 1000,
  }, async () => {
    requestCount += 1;
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              tool_calls: [
                { id: 'duplicate-id', function: { name: 'web_search', arguments: '{"query":"first"}' } },
                { id: 'duplicate-id', function: { name: 'web_search', arguments: '{"query":"second"}' } },
              ],
            },
          }],
        };
      },
    };
  });

  await assert.rejects(
    () => provider.completeWithTools([{ role: 'user', content: 'Find two sources.' }], {
      tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object' } } }],
      toolExecutor: async () => {
        executionCount += 1;
        return { status: 'ready' };
      },
    }),
    error => error.code === 'malformed_response' && /duplicate tool call ids/u.test(error.message),
  );

  assert.equal(requestCount, 1);
  assert.equal(executionCount, 0);
});

test('provider validates an actual structured schema while preserving legacy schema metadata', async () => {
  const schema = {
    type: 'object',
    required: ['emotion', 'confidence'],
    additionalProperties: false,
    properties: {
      emotion: { type: 'string' },
      confidence: { type: 'number' },
    },
  };

  const valid = await structuredProvider('{"emotion":"calm","confidence":0.8}')
    .completeStructured([{ role: 'user', content: 'Return JSON.' }], schema);
  assert.deepEqual(valid.data, { emotion: 'calm', confidence: 0.8 });

  await assert.rejects(
    () => structuredProvider('{"emotion":"calm"}').completeStructured([], schema),
    error => error.code === 'malformed_response' && error.details.path === '$.confidence',
  );
  await assert.rejects(
    () => structuredProvider('{"emotion":"calm","confidence":"high"}').completeStructured([], schema),
    error => error.code === 'malformed_response' && error.details.path === '$.confidence',
  );
  await assert.rejects(
    () => structuredProvider('{"emotion":"calm","confidence":0.8,"unexpected":true}').completeStructured([], schema),
    error => error.code === 'malformed_response' && error.details.path === '$.unexpected',
  );

  const legacy = await structuredProvider('{"primary_emotion":"calm"}')
    .completeStructured([], { schema_version: 'solat.creative-plan.v1' });
  assert.equal(legacy.data.primary_emotion, 'calm');
});
