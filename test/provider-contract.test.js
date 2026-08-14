const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenAICompatibleProvider } = require('../src/core/provider');

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
