const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenAIAgentsRuntime,
  providerMessagesFromRequest,
} = require('../src/core/openai-agents-runtime');
const { ConversationCore } = require('../src/core/conversation-core');

function fakeStatus() {
  return { configured: true, provider: 'fake-qwen', model: 'fake-model' };
}

test('Agents runtime streams a plain V1 chat response through the existing provider', async () => {
  const seen = [];
  const deltas = [];
  const provider = {
    status: fakeStatus,
    async complete(messages, options = {}) {
      seen.push({ messages, options });
      if (typeof options.onDelta === 'function') {
        await options.onDelta('สวัสดี');
        await options.onDelta('ครับ');
      }
      return { content: 'สวัสดีครับ', provider: 'fake-qwen', model: 'fake-model' };
    },
  };
  const runtime = new OpenAIAgentsRuntime({ provider });
  const result = await runtime.run({
    messages: [
      { role: 'system', content: 'Keep the current conversation context.' },
      { role: 'user', content: 'ทักทายฉัน' },
    ],
    onDelta: delta => deltas.push(delta),
    groupId: 'owner/session-a',
  });

  assert.equal(result.content, 'สวัสดีครับ');
  assert.equal(result.provider, 'fake-qwen');
  assert.equal(result.toolRounds, 0);
  assert.equal(deltas.join(''), 'สวัสดีครับ');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.stream, true);
  assert.equal(seen[0].messages.some(message => message.role === 'user' && message.content === 'ทักทายฉัน'), true);
  assert.deepEqual(runtime.status(), {
    schema_version: 'solat.openai-agents-runtime.v1',
    framework: '@openai/agents',
    enabled: true,
    tracing: 'disabled',
  });
});

test('Agents runtime executes only attached tools and returns the bounded final answer', async () => {
  const requests = [];
  const executed = [];
  const provider = {
    status: fakeStatus,
    async complete(messages, options = {}) {
      requests.push({ messages, options });
      const toolResult = messages.find(message => message.role === 'tool');
      if (!toolResult) {
        return {
          content: '',
          provider: 'fake-qwen',
          model: 'fake-model',
          toolCalls: [{ id: 'search-1', name: 'web_search', arguments: { query: 'SOLAT' } }],
        };
      }
      return { content: 'พบข้อมูล SOLAT แล้ว', provider: 'fake-qwen', model: 'fake-model' };
    },
  };
  const runtime = new OpenAIAgentsRuntime({ provider });
  const result = await runtime.run({
    messages: [{ role: 'user', content: 'ค้นหา SOLAT' }],
    toolDefinitions: [{
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search approved web sources.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    }],
    toolExecutor: async call => {
      executed.push(call);
      return { status: 'ready', results: [{ title: 'SOLAT' }] };
    },
    maxTurns: 3,
    maxToolCalls: 1,
  });

  assert.equal(result.content, 'พบข้อมูล SOLAT แล้ว');
  assert.equal(result.toolRounds, 1);
  assert.equal(executed.length, 1);
  assert.deepEqual(executed[0].arguments, { query: 'SOLAT' });
  assert.equal(requests[0].options.tools[0].function.name, 'web_search');
  assert.equal(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'search-1'), true);
});

test('Agents adapter preserves assistant tool calls and matching results as provider messages', () => {
  const messages = providerMessagesFromRequest({
    systemInstructions: 'system policy',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ค้นหา' }] },
      { type: 'function_call', callId: 'call-7', name: 'web_search', arguments: '{"query":"SOLAT"}' },
      { type: 'function_call_result', callId: 'call-7', name: 'web_search', output: '{"status":"ready"}' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'เสร็จแล้ว' }] },
    ],
  });

  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(messages[2].tool_calls[0].id, 'call-7');
  assert.equal(messages[3].tool_call_id, 'call-7');
  assert.equal(messages[4].content, 'เสร็จแล้ว');
});

test('ConversationCore sends typed and voice turns through one Agents runtime while isolating owners', async () => {
  const runs = [];
  const agentsRuntime = {
    status: () => ({ framework: '@openai/agents', enabled: true, tracing: 'disabled' }),
    async run(input) {
      runs.push(input);
      return { content: `answer-${runs.length}`, provider: 'fake-qwen', model: 'fake-model', toolRounds: 0 };
    },
  };
  const provider = {
    status: fakeStatus,
    async complete() { throw new Error('ConversationCore must use the Agents runtime.'); },
  };
  const router = { analyze: () => ({ primary_intent: 'general_chat', confidence: 1, candidate_intents: [], allowed_tools: [], safety_constraints: [], task: {}, disambiguation: {} }) };
  const core = new ConversationCore({ config: {}, provider, router, agentsRuntime });

  await core.send({ ownerId: 'owner-a', sessionId: 'shared', content: 'typed one', inputSource: 'typed' });
  const voice = await core.send({ ownerId: 'owner-a', sessionId: 'shared', content: 'voice two', inputSource: 'voice' });
  await core.send({ ownerId: 'owner-b', sessionId: 'shared', content: 'isolated', inputSource: 'typed' });

  assert.equal(voice.inputSource, 'voice');
  assert.equal(runs[1].messages.some(message => message.role === 'assistant' && message.content === 'answer-1'), true);
  assert.equal(runs[2].messages.some(message => message.content === 'typed one' || message.content === 'answer-1'), false);
  assert.notEqual(runs[1].groupId, runs[2].groupId);
});

test('ConversationCore attaches only the capability selected for the current Agents turn', async () => {
  const runs = [];
  const agentsRuntime = {
    status: () => ({ framework: '@openai/agents', enabled: true, tracing: 'disabled' }),
    async run(input) {
      runs.push(input);
      return { content: 'ผลการค้นหา', provider: 'fake-qwen', model: 'fake-model', toolRounds: 0 };
    },
  };
  const provider = {
    status: fakeStatus,
    async completeWithTools() { throw new Error('ConversationCore must use the Agents runtime tool loop.'); },
  };
  const router = { analyze: () => ({ primary_intent: 'web_search', confidence: 1, candidate_intents: [], allowed_tools: ['web_search'], safety_constraints: [], task: {}, disambiguation: {} }) };
  const searchService = {
    status: () => ({ enabled: true }),
    toolDefinition: () => ({ type: 'function', function: { name: 'web_search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } }),
    async execute() { return { status: 'ready', sources: [] }; },
  };
  const core = new ConversationCore({ config: {}, provider, router, searchService, agentsRuntime });

  await core.send({ ownerId: 'owner-a', sessionId: 'search', content: 'ค้นหา SOLAT' });

  assert.deepEqual(runs[0].toolDefinitions.map(definition => definition.function.name), ['web_search']);
  assert.equal(typeof runs[0].toolExecutor, 'function');
});
