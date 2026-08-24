const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAICompatibleProvider } = require('../src/core/provider');
const { ConversationCore, requiresScreenDrivenComputerTask, hasGuiNavigationTarget } = require('../src/core/conversation-core');
const { VoiceController } = require('../renderer/voice-controller');

function router() {
  return {
    analyze() {
      return {
        primary_intent: 'general_chat', confidence: 0.4, candidate_intents: [],
        allowed_tools: [], safety_constraints: [], task: {}, disambiguation: {},
      };
    },
  };
}

function recordingProvider() {
  const calls = [];
  return {
    calls,
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async complete(messages, options = {}) { calls.push(['complete', options]); return { content: '4', provider: 'fake', model: 'fake' }; },
    async completeWithTools(messages, options = {}) { calls.push(['completeWithTools', options]); return { content: 'tool answer', provider: 'fake', model: 'fake', toolRounds: 0 }; },
    async completeStructured() { calls.push(['completeStructured']); throw new Error('structured planning must not be required for this turn'); },
  };
}

function computerBridge() {
  return {
    definitions: () => [
      { type: 'function', function: { name: 'computer_launch_app', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object' } } },
    ],
    owns: name => ['computer_launch_app', 'filesystem_create'].includes(name),
  };
}

async function until(condition, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for the voice controller condition.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// ---------------------------------------------------------------------------
// Intent / tool selection: Computer Use is one capability, not the default.
// ---------------------------------------------------------------------------

test('a no-tool question never receives Computer Use tools and answers plainly', async () => {
  const provider = recordingProvider();
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: computerBridge() }).send({
    sessionId: 'no-tool', content: '2+2 เท่าไร', agentMode: true,
  });
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0][0], 'complete', 'a turn without capability needs must use the plain completion path');
  assert.equal(provider.calls.some(([method]) => method === 'completeWithTools'), false, 'no tool definitions may be attached for a no-tool turn');
  assert.equal(result.assistant, '4');
  assert.equal(result.mode, 'model');
  assert.equal(result.inputSource, 'text');
});

test('web research requests are not dragged into Computer Use by GUI verbs alone', () => {
  assert.equal(requiresScreenDrivenComputerTask('ค้นหาข้อมูลเกี่ยวกับดวงอาทิตย์'), false);
  assert.equal(requiresScreenDrivenComputerTask('ช่วยอ่านบทความนี้ให้หน่อย'), false);
  assert.equal(requiresScreenDrivenComputerTask('ช่วยสรุปเนื้อหาจากวิกิพีเดีย'), false);
  assert.equal(requiresScreenDrivenComputerTask('เลื่อนดูฟีดแล้วบอกว่ามีอะไรใหม่'), false);
  assert.equal(hasGuiNavigationTarget('ค้นหาข้อมูลเกี่ยวกับดวงอาทิตย์'), false);
});

test('GUI requests with a real screen target still route to Computer Use', () => {
  assert.equal(requiresScreenDrivenComputerTask('เปิด Chrome แล้วค้นหา วิธีปลูกมะเขือเทศ'), true);
  assert.equal(requiresScreenDrivenComputerTask('คลิกปุ่มบันทึกในหน้าต่างโปรแกรม'), true);
  assert.equal(requiresScreenDrivenComputerTask('ช่วยดูหน้าจอแล้วบอกว่ามีอะไรแสดงอยู่'), true);
});

test('a screen-driven request starts the computer task loop when it is available', async () => {
  let started = null;
  const provider = recordingProvider();
  const loop = {
    hasActive: () => false,
    async start(input) {
      started = input;
      return {
        task_id: 'gui-task', status: 'AWAITING_APPROVAL', summary: 'Open Chrome and search.', planner_turns: 0,
        pending_action: { tool: 'computer_launch_app', action: { status: 'confirmation_required', idempotency_key: 'gui-1', approval_token: 'once', arguments: { app_id: 'chrome' } } },
      };
    },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: computerBridge(), computerTaskLoop: loop }).send({
    sessionId: 'gui-route', content: 'เปิด Chrome แล้วค้นหา วิธีปลูกมะเขือเทศ', agentMode: true,
  });
  assert.ok(started, 'the GUI request must enter the persistent computer task loop');
  assert.equal(result.provider, 'solat_computer_task');
  assert.equal(provider.calls.length, 0, 'the deterministic screen route must not call the model first');
});

test('an active computer task does not own the next unrelated intent', async () => {
  let interrupted = 0;
  const provider = recordingProvider();
  const loop = {
    hasActive: () => true,
    async interruptActive() { interrupted += 1; return { task_id: 'gui-task', status: 'INTERRUPTED' }; },
    async revise() { throw new Error('an unrelated turn must not revise the active computer task'); },
    async start() { throw new Error('an unrelated turn must not start a computer task'); },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: computerBridge(), computerTaskLoop: loop }).send({
    sessionId: 'sticky-reset', content: '2+2 เท่าไร', agentMode: true,
  });
  assert.equal(interrupted, 1, 'the stale computer task must be interrupted before the new intent runs');
  assert.equal(result.provider, 'fake');
  assert.equal(result.assistant, '4');
  assert.equal(provider.calls[0][0], 'complete');
});

// ---------------------------------------------------------------------------
// Unified input boundary: voice turns are internal input, not typed chat.
// ---------------------------------------------------------------------------

test('voice turns keep their input source through the conversation core', async () => {
  const provider = recordingProvider();
  const core = new ConversationCore({ config: {}, provider, router: router(), agentBridge: computerBridge() });
  const voice = await core.send({ sessionId: 'voice-source', content: 'เปิดเพลงหน่อย', agentMode: true, inputSource: 'voice' });
  assert.equal(voice.inputSource, 'voice');
  const bogus = await core.send({ sessionId: 'voice-source', content: '2+2', agentMode: true, inputSource: 'gui' });
  assert.equal(bogus.inputSource, 'text', 'unknown input sources must fall back to text');
});

test('streaming deltas from a plain turn reach the assistant delta observer', async () => {
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async complete(messages, options = {}) {
      options.onDelta?.('สวัสดี ');
      options.onDelta?.('ครับ');
      return { content: 'สวัสดี ครับ', provider: 'fake', model: 'fake', timing: { streaming: true } };
    },
    async completeWithTools() { throw new Error('not used'); },
  };
  const deltas = [];
  await new ConversationCore({ config: {}, provider, router: router(), agentBridge: computerBridge() }).send({
    sessionId: 'delta-turn', content: 'ทักทายหน่อย', agentMode: true, onAssistantDelta: delta => deltas.push(delta),
  });
  assert.deepEqual(deltas, ['สวัสดี ', 'ครับ']);
});

// ---------------------------------------------------------------------------
// Provider streaming: plain final answers stream, tool rounds never do.
// ---------------------------------------------------------------------------

function sseResponse(events) {
  const encoder = new TextEncoder();
  const parts = events.map(event => encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  parts.push(encoder.encode('data: [DONE]\n\n'));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* stream() { for (const part of parts) yield part; })(),
    async json() { throw new Error('A streaming response must not be read as JSON.'); },
  };
}

const STREAM_CONFIG = { provider: 'qwen_cloud', baseUrl: 'http://qwen.local/v1', apiKey: 'test-key', model: 'qwen-flash', timeoutMs: 5000 };

test('streaming plain completion emits ordered deltas and assembles the final content', async () => {
  let capturedBody = null;
  const provider = new OpenAICompatibleProvider(STREAM_CONFIG, async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return sseResponse([{ choices: [{ delta: { content: 'สวัสดี ' } }] }, { choices: [{ delta: { content: 'ครับ' } }] }]);
  });
  const deltas = [];
  const result = await provider.complete([{ role: 'user', content: 'ทักทาย' }], { stream: true, onDelta: delta => deltas.push(delta) });
  assert.deepEqual(deltas, ['สวัสดี ', 'ครับ']);
  assert.equal(result.content, 'สวัสดี ครับ');
  assert.equal(result.message.content, 'สวัสดี ครับ');
  assert.equal(result.timing.streaming, true);
  assert.equal(capturedBody.stream, true, 'the provider request must ask for a stream');
});

test('streaming is refused for tool rounds and structured output', async () => {
  const bodies = [];
  const provider = new OpenAICompatibleProvider(STREAM_CONFIG, async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return { choices: [{ message: { content: 'plain' } }] }; } };
  });
  const deltas = [];
  const withTools = await provider.complete([{ role: 'user', content: 'x' }], { stream: true, onDelta: delta => deltas.push(delta), tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object' } } }] });
  assert.equal(withTools.content, 'plain');
  const structured = await provider.complete([{ role: 'user', content: 'x' }], { stream: true, onDelta: delta => deltas.push(delta), responseFormat: 'json_object' });
  assert.equal(structured.content, 'plain');
  assert.deepEqual(deltas, [], 'no speculative text may escape from tool or structured turns');
  for (const body of bodies) assert.equal(body.stream, false, 'tool and structured requests must stay buffered');
});

test('completeWithTools streams only the final synthesis, never tool-round prose', async () => {
  let call = 0;
  const provider = new OpenAICompatibleProvider(STREAM_CONFIG, async () => {
    call += 1;
    if (call === 1) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() {
          return { choices: [{ message: { content: 'thinking about tools', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"sun"}' } }] } }] };
        },
      };
    }
    return sseResponse([{ choices: [{ delta: { content: 'ดวงอาทิตย์' } }] }, { choices: [{ delta: { content: 'เป็นดาวฤกษ์' } }] }]);
  });
  const deltas = [];
  const result = await provider.completeWithTools(
    [{ role: 'user', content: 'ดวงอาทิตย์คืออะไร' }],
    {
      tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }],
      toolExecutor: async () => ({ status: 'ready', results: [] }),
      onDelta: delta => deltas.push(delta),
      // One tool round, then the forced tool-less final synthesis — the only
      // turn inside the loop that is allowed to stream.
      maxToolRounds: 1,
    },
  );
  assert.equal(result.content, 'ดวงอาทิตย์เป็นดาวฤกษ์');
  assert.equal(result.forcedFinalResponse, true);
  assert.deepEqual(deltas, ['ดวงอาทิตย์', 'เป็นดาวฤกษ์']);
  assert.ok(!deltas.includes('thinking about tools'), 'tool-round prose must never reach the speech observer');
});

// ---------------------------------------------------------------------------
// Voice controller: ordered sentence-chunk speech with barge-in discard.
// ---------------------------------------------------------------------------

class FakeAudioContext {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.destination = {}; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  async close() { this.state = 'closed'; }
}

function voiceHarness() {
  const calls = [];
  let listener = null;
  const bridge = {
    voiceStatus: async () => ({ stt: { configured: true }, tts: { configured: true } }),
    voiceStartSTT: async value => { calls.push(['start', value]); },
    voicePushSTT: async value => { calls.push(['push', value]); },
    voiceStopSTT: async value => { calls.push(['stop', value]); },
    voiceCancelSTT: async value => { calls.push(['cancel-stt', value]); },
    voiceSpeak: async value => { calls.push(['speak', value]); return { mimeType: 'audio/wav', audio: Uint8Array.from([1, 2, 3]) }; },
    voiceCancelTTS: async value => { calls.push(['cancel-tts', value]); },
    voiceDispose: async value => { calls.push(['dispose', value]); },
    onVoiceEvent: callback => { listener = callback; return () => { listener = null; }; },
  };
  const states = [];
  class FakeAudio {
    async play() { queueMicrotask(() => this.onended?.()); }
    pause() {}
  }
  const controller = new VoiceController({
    bridge,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stopped: false, stop() { this.stopped = true; } }] }) },
    AudioContextClass: FakeAudioContext,
    AudioClass: FakeAudio,
    BlobClass: class {},
    urlApi: { createObjectURL: () => 'blob:voice', revokeObjectURL() {} },
    onState: state => states.push(state),
    onFinalTranscript: async () => true,
  });
  return { bridge, calls, controller, emit: event => listener(event), states };
}

test('streamed speech chunks play in order and resume listening after the stream ends', async () => {
  const h = voiceHarness();
  await h.controller.enter('conversation-stream');
  assert.equal(h.controller.beginSpeechStream('request-1', 'th'), true);
  assert.equal(h.controller.queueSpeechChunk('request-1', 'ประโยคแรก.'), true);
  assert.equal(h.controller.queueSpeechChunk('request-1', 'ประโยคที่สอง.'), true);
  h.controller.endSpeechStream('request-1');
  await until(() => h.controller.state === 'listening');
  const spoken = h.calls.filter(entry => entry[0] === 'speak').map(entry => entry[1].text);
  assert.deepEqual(spoken, ['ประโยคแรก.', 'ประโยคที่สอง.'], 'chunks must be spoken in order');
  await h.controller.exit();
});

test('chunks for the wrong request never enter the speech queue', async () => {
  const h = voiceHarness();
  await h.controller.enter('conversation-wrong');
  h.controller.beginSpeechStream('request-live', 'th');
  assert.equal(h.controller.queueSpeechChunk('request-stale', 'ข้อความเก่า'), false);
  assert.equal(h.controller.queueSpeechChunk('', 'ไม่มี request'), false);
  h.controller.endSpeechStream('request-live');
  await until(() => h.controller.state === 'listening');
  assert.equal(h.calls.filter(entry => entry[0] === 'speak').length, 0);
  await h.controller.exit();
});

test('barge-in drops remaining speech chunks and rejects the abandoned stream', async () => {
  const h = voiceHarness();
  await h.controller.enter('conversation-barge');
  h.controller.beginSpeechStream('request-old', 'th');
  h.controller.queueSpeechChunk('request-old', 'ท่อนแรก.');
  h.controller.queueSpeechChunk('request-old', 'ท่อนที่สอง.');
  h.controller.queueSpeechChunk('request-old', 'ท่อนที่สาม.');
  await until(() => h.controller.state === 'speaking');
  assert.equal(await h.controller.interrupt(), true);
  assert.equal(h.controller.queueSpeechChunk('request-old', 'ท่อนที่มาช้า.'), false, 'an interrupted stream must not accept late chunks');
  await until(() => h.controller.state === 'listening');
  const spoken = h.calls.filter(entry => entry[0] === 'speak').map(entry => entry[1].text);
  assert.ok(!spoken.includes('ท่อนที่มาช้า.'));
  assert.equal(h.calls.filter(entry => entry[0] === 'cancel-tts').length, 1);
  await h.controller.exit();
});
