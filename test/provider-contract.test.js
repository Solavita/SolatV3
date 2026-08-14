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

test('provider rejects unknown tools and schema-invalid arguments before execution', async () => {
  const responses = [
    { id: 'unknown', name: 'delete_everything', arguments: '{}' },
    { id: 'missing', name: 'web_search', arguments: '{}' },
    { id: 'empty', name: 'web_search', arguments: '{"query":""}' },
    { id: 'enum', name: 'web_search', arguments: '{"query":"SOLAT","source_scope":"filesystem"}' },
    { id: 'range', name: 'web_search', arguments: '{"query":"SOLAT","limit":99}' },
    { id: 'extra', name: 'web_search', arguments: '{"query":"SOLAT","secret":"read it"}' },
  ];
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      source_scope: { type: 'string', enum: ['auto', 'encyclopedic'] },
    },
    required: ['query'],
    additionalProperties: false,
  };

  for (const response of responses) {
    let executions = 0;
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
    }, async () => ({ ok: true, async json() {
      return { choices: [{ message: { tool_calls: [{ id: response.id, function: { name: response.name, arguments: response.arguments } }] } }] };
    } }));

    await assert.rejects(
      () => provider.completeWithTools([{ role: 'user', content: 'Search safely.' }], {
        tools: [{ type: 'function', function: { name: 'web_search', parameters: schema } }],
        toolExecutor: async () => { executions += 1; return { status: 'ready' }; },
      }),
      error => error.code === 'malformed_response' && error.details.tool_call_id === response.id,
    );
    assert.equal(executions, 0, `${response.id} must not reach the executor`);
  }
});

test('provider accepts a bounded tool call that matches its declared schema', async () => {
  let requestCount = 0;
  const executed = [];
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
  }, async () => {
    requestCount += 1;
    const message = requestCount === 1
      ? { tool_calls: [{ id: 'valid', function: { name: 'web_search', arguments: '{"query":"SOLAT","limit":3,"source_scope":"auto"}' } }] }
      : { content: 'Grounded response.' };
    return { ok: true, async json() { return { choices: [{ message }] }; } };
  });
  const result = await provider.completeWithTools([{ role: 'user', content: 'Search.' }], {
    tools: [{ type: 'function', function: { name: 'web_search', parameters: {
      type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 }, source_scope: { type: 'string', enum: ['auto'] } }, required: ['query'], additionalProperties: false,
    } } }],
    toolExecutor: async call => { executed.push(call); return { status: 'ready' }; },
  });
  assert.equal(result.content, 'Grounded response.');
  assert.deepEqual(executed[0].arguments, { query: 'SOLAT', limit: 3, source_scope: 'auto' });
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
