const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CartesiaSTTProvider,
  CartesiaTTSProvider,
  VoiceService,
} = require('../src/core/voice-service');

const configured = Object.freeze({
  enabled: true,
  provider: 'cartesia',
  apiKey: 'test-key',
  voiceId: 'voice-id',
  sttModel: 'ink-2',
  ttsModel: 'sonic-latest',
  language: 'auto',
  timeoutMs: 1000,
  turnEndTimeoutMs: 1200,
  ttsSampleRate: 44100,
});

class FakeSocket {
  constructor() {
    this.listeners = new Map();
    this.events = [];
    this.waiters = [];
    this.raw = [];
    this.commands = [];
    this.closed = false;
  }
  on(type, listener) { this.listeners.set(type, listener); }
  sendRaw(bytes) { this.raw.push(new Uint8Array(bytes)); }
  send(command) { this.commands.push(command); }
  close(props) { this.closed = true; this.closeProps = props; this.#wake(); }
  emit(event) { this.events.push(event); this.#wake(); }
  #wake() { while (this.waiters.length) this.waiters.shift()(); }
  async *stream() {
    while (!this.closed) {
      if (!this.events.length) await new Promise(resolve => this.waiters.push(resolve));
      while (this.events.length) yield this.events.shift();
    }
  }
}

function fakeClient(socket, ttsAudio = Uint8Array.from([82, 73, 70, 70])) {
  return {
    stt: { autoFinalize: { websocket: params => { socket.params = params; return socket; } } },
    tts: { generate: async (params, options) => {
      socket.ttsParams = params;
      socket.ttsSignal = options.signal;
      return { arrayBuffer: async () => ttsAudio.buffer.slice(0) };
    } },
  };
}

test('Cartesia STT streams chunks and emits partial/final events without treating partials as final', async () => {
  const socket = new FakeSocket();
  const events = [];
  const provider = new CartesiaSTTProvider({ config: configured, clientFactory: () => fakeClient(socket) });
  const started = provider.start({ sessionId: 'voice-1', sampleRate: 48000, encoding: 'pcm_f32le', onEvent: event => events.push(event) });
  assert.equal(started.model, 'ink-2');
  provider.push({ sessionId: 'voice-1', bytes: Uint8Array.from([1, 2, 3, 4]) });
  socket.emit({ type: 'message', message: { type: 'turn.update', transcript: 'สวัส' } });
  socket.emit({ type: 'message', message: { type: 'turn.end', transcript: '   ' } });
  socket.emit({ type: 'message', message: { type: 'turn.end', transcript: 'สวัสดี' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.raw.length, 1);
  assert.deepEqual(events.map(event => event.type), ['partial', 'final']);
  assert.equal(events[1].utterance_id, 'voice-1:1');
  assert.equal(provider.stop({ sessionId: 'voice-1' }), true);
  assert.deepEqual(socket.commands.at(-1), { type: 'close' });
  provider.cancel({ sessionId: 'voice-1' });
});

test('Cartesia STT fails visibly when credentials or audio chunks are invalid', () => {
  const provider = new CartesiaSTTProvider({ config: { ...configured, apiKey: '' }, clientFactory: () => { throw new Error('must not run'); } });
  assert.equal(provider.status().configured, false);
  assert.throws(() => provider.start({ sessionId: 's', sampleRate: 48000, onEvent() {} }), error => error.code === 'voice_not_configured');

  const socket = new FakeSocket();
  const ready = new CartesiaSTTProvider({ config: configured, clientFactory: () => fakeClient(socket) });
  ready.start({ sessionId: 's', sampleRate: 48000, onEvent() {} });
  assert.throws(() => ready.push({ sessionId: 's', bytes: new Uint8Array(0) }), error => error.code === 'invalid_audio_chunk');
  ready.dispose();
  assert.equal(socket.closed, true);
});

test('Cartesia TTS returns only audio bytes and cancellation aborts an in-flight request', async () => {
  const socket = new FakeSocket();
  let resolveResponse;
  const clientFactory = () => ({
    tts: { generate: (params, options) => {
      socket.ttsParams = params;
      socket.ttsSignal = options.signal;
      return new Promise(resolve => { resolveResponse = resolve; });
    } },
  });
  const provider = new CartesiaTTSProvider({ config: configured, clientFactory });
  const pending = provider.speak({ sessionId: 'voice-2', text: 'Visible answer only', language: 'th-TH' });
  assert.equal(provider.cancel({ sessionId: 'voice-2' }), true);
  resolveResponse({ arrayBuffer: async () => Uint8Array.from([1]).buffer });
  await assert.rejects(pending, error => error.code === 'tts_cancelled');
  assert.equal(socket.ttsSignal.aborted, true);
  assert.equal(socket.ttsParams.language, 'th');
  assert.equal(socket.ttsParams.transcript, 'Visible answer only');
});

test('Cartesia TTS honors an explicit configured language over the renderer locale', async () => {
  const socket = new FakeSocket();
  const provider = new CartesiaTTSProvider({
    config: { ...configured, language: 'th-TH' },
    clientFactory: () => fakeClient(socket),
  });
  const result = await provider.speak({ sessionId: 'voice-language', text: 'ข้อความภาษาไทย', language: 'en-US' });
  assert.equal(socket.ttsParams.language, 'th');
  assert.equal(result.audio.byteLength, 4);
});

test('Cartesia TTS rejects an oversized response before buffering it', async () => {
  let arrayBufferRead = false;
  const provider = new CartesiaTTSProvider({
    config: configured,
    clientFactory: () => ({
      tts: { generate: async () => ({
        headers: { get: name => name === 'content-length' ? String(17 * 1024 * 1024) : null },
        arrayBuffer: async () => { arrayBufferRead = true; return new ArrayBuffer(0); },
      }) },
    }),
  });
  await assert.rejects(
    provider.speak({ sessionId: 'voice-large', text: 'Visible answer', language: 'en' }),
    error => error.code === 'tts_audio_too_large',
  );
  assert.equal(arrayBufferRead, false);
});

test('VoiceService keeps STT and TTS behind swappable provider ports', async () => {
  const calls = [];
  const stt = { status: () => ({ configured: true }), start: value => calls.push(['start', value]), push: value => calls.push(['push', value]), stop: () => true, cancel: () => true, dispose: () => calls.push(['dispose-stt']) };
  const tts = { status: () => ({ configured: true }), speak: async value => ({ value }), cancel: () => true, dispose: () => calls.push(['dispose-tts']) };
  const service = new VoiceService({ sttProvider: stt, ttsProvider: tts });
  service.startSTT({ sessionId: 's' });
  service.pushSTT({ sessionId: 's', bytes: Uint8Array.from([1]) });
  assert.equal((await service.speak({ sessionId: 's', text: 'ok' })).value.text, 'ok');
  assert.equal(service.status().schemaVersion, 'solat.voice-status.v1');
  service.dispose();
  assert.deepEqual(calls.map(call => call[0]), ['start', 'push', 'dispose-stt', 'dispose-tts']);
});
