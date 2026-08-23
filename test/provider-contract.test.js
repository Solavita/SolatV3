const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenAICompatibleProvider, messagesWithVisionCapture } = require('../src/core/provider');

test('local Ollama uses the native chat contract and normalizes its response', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  const provider = new OpenAICompatibleProvider({
    provider: 'ollama_local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    model: 'qwen-local',
    timeoutMs: 1000,
    maxTokens: 192,
    keepAlive: '2m',
  }, async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: { role: 'assistant', content: 'LOCAL' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 2,
        };
      },
    };
  });

  const result = await provider.complete([
    { role: 'system', content: 'First policy.' },
    { role: 'user', content: 'Answer.' },
    { role: 'system', content: 'Final policy.' },
  ]);

  assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(capturedBody.think, false);
  assert.deepEqual(capturedBody.options, { num_predict: 192 });
  assert.equal(capturedBody.keep_alive, '2m');
  assert.deepEqual(capturedBody.messages.map(message => message.role), ['system', 'user']);
  assert.equal(result.content, 'LOCAL');
  assert.deepEqual(result.usage, { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
});

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

test('vision requests attach one validated bounded PNG to the structured request', async () => {
  let capturedBody = null;
  const provider = new OpenAICompatibleProvider({
    provider: 'vllm_vision', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'local', model: 'vision-model', timeoutMs: 1000,
  }, async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, async json() { return { choices: [{ message: { content: '{"action":"click"}' } }] }; } };
  });
  const capture = {
    metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/png' },
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };

  const result = await provider.completeStructuredVision(
    [{ role: 'system', content: 'Return a bounded action.' }],
    { type: 'object', required: ['action'], properties: { action: { type: 'string' } } },
    capture,
  );

  assert.equal(result.data.action, 'click');
  const visionMessage = capturedBody.messages.at(-1);
  assert.equal(visionMessage.role, 'user');
  assert.equal(visionMessage.content[0].type, 'text');
  assert.match(visionMessage.content[0].text, /untrusted data/u);
  assert.equal(visionMessage.content[1].type, 'image_url');
  assert.equal(visionMessage.content[1].image_url.url, 'data:image/png;base64,iVBORw==');
  assert.deepEqual(capturedBody.chat_template_kwargs, { thinking: false });
  assert.equal(capturedBody.stream, false);
});

test('QwenCloud vision uses the Qwen-VL image and structured-output options', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  const provider = new OpenAICompatibleProvider({
    provider: 'qwencloud_vision', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey: 'qwencloud-test-key', model: 'qwen3-vl-flash', timeoutMs: 1000,
  }, async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, async json() { return { choices: [{ message: { content: '{"status":"needs_clarification"}' } }] }; } };
  });
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const result = await provider.completeStructuredVision(
    [{ role: 'system', content: 'Return only the bounded grounding object.' }],
    { type: 'object', required: ['status'], properties: { status: { type: 'string' } } },
    { metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/png' }, bytes },
  );
  assert.equal(result.data.status, 'needs_clarification');
  assert.equal(capturedUrl, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.deepEqual(capturedBody.extra_body, { enable_thinking: false, vl_high_resolution_images: true });
  assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
  assert.equal(capturedBody.messages.at(-1).content[1].type, 'image_url');
  assert.match(capturedBody.messages.at(-1).content[1].image_url.url, /^data:image\/png;base64,/u);
});

test('Ollama vision converts a validated image message to native images without leaking a data URL into content', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  const provider = new OpenAICompatibleProvider({
    provider: 'ollama_vision', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama',
    model: 'smolvlm', timeoutMs: 1000, maxTokens: 96, keepAlive: '0s',
  }, async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, async json() { return { message: { role: 'assistant', content: '{"action":"click"}' }, prompt_eval_count: 4, eval_count: 2 }; } };
  });
  const capture = {
    metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/png' },
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
  const result = await provider.completeStructuredVision(
    [{ role: 'system', content: 'Ground one control.' }],
    { type: 'object', required: ['action'], properties: { action: { type: 'string' } } },
    capture,
  );

  assert.equal(result.data.action, 'click');
  assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(capturedBody.think, false);
  assert.equal(capturedBody.format.type, 'object');
  assert.deepEqual(capturedBody.format.required, ['action']);
  assert.equal(capturedBody.keep_alive, '0s');
  assert.deepEqual(capturedBody.options, { num_predict: 96 });
  assert.equal(capturedBody.messages.at(-1).content.includes('data:image'), false);
  assert.match(capturedBody.messages[0].content, /Ground one control/u);
  assert.deepEqual(capturedBody.messages.at(-1).images, ['iVBORw==']);
});

test('vision input fails closed before transport when capture validation fails', () => {
  assert.throws(
    () => messagesWithVisionCapture([], {
      metadata: { schema_version: 'wrong', media_type: 'image/png' },
      bytes: Buffer.from('not-a-validated-capture'),
    }),
    error => error.code === 'invalid_vision_input',
  );
  assert.throws(
    () => messagesWithVisionCapture([], {
      metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/jpeg' },
      bytes: Buffer.from('jpeg'),
    }),
    error => error.code === 'invalid_vision_input',
  );
});
