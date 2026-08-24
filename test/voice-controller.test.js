const test = require('node:test');
const assert = require('node:assert/strict');
const { VOICE_STATES, VoiceController } = require('../renderer/voice-controller');

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = {};
  }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  async close() { this.state = 'closed'; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  let listener = null;
  const calls = [];
  const logs = options.logs || [];
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
    ...(options.bridge || {}),
  };
  const track = options.track || { stopped: false, stop() { this.stopped = true; } };
  const states = [];
  const finals = [];
  class FakeAudio {
    async play() { queueMicrotask(() => this.onended?.()); }
    pause() {}
  }
  const controller = new VoiceController({
    bridge,
    mediaDevices: options.mediaDevices || { getUserMedia: async () => ({ getTracks: () => [track] }) },
    AudioContextClass: options.AudioContextClass || FakeAudioContext,
    AudioClass: FakeAudio,
    BlobClass: class {},
    urlApi: { createObjectURL: () => 'blob:voice', revokeObjectURL() {} },
    onState: state => states.push(state),
    debugLogger: entry => logs.push(entry),
    onFinalTranscript: options.onFinalTranscript || (async (text, id) => finals.push([text, id])),
  });
  return { bridge, calls, controller, emit: event => listener(event), finals, states, track, logs };
}

test('voice state contract exposes every required V1 state', () => {
  assert.deepEqual(VOICE_STATES, ['idle', 'listening', 'user_speaking', 'transcribing', 'thinking', 'acting', 'speaking', 'interrupted', 'error']);
});

test('only one final transcript enters the brain while partials and duplicate finals stay UI-only', async () => {
  const h = harness();
  await h.controller.enter('conversation-1');
  const sessionId = h.calls.find(call => call[0] === 'start')[1].sessionId;
  h.emit({ schema_version: 'solat.voice-provider-event.v1', type: 'partial', session_id: sessionId, transcript: 'partial' });
  h.emit({ schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: sessionId, utterance_id: 'u1', transcript: 'คำตอบสุดท้าย' });
  h.emit({ schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: sessionId, utterance_id: 'u1', transcript: 'คำตอบสุดท้าย' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.finals, [['คำตอบสุดท้าย', 'u1']]);
  assert.ok(h.states.includes('transcribing'));
  assert.equal(h.states.at(-1), 'thinking');
  await h.controller.exit();
});

test('final transcript carries the main-process receive timestamp and voice session metadata', async () => {
  let finalArgs = null;
  const h = harness({ onFinalTranscript: async (...args) => { finalArgs = args; } });
  await h.controller.enter('conversation-spatial-voice');
  const sessionId = h.calls.find(call => call[0] === 'start')[1].sessionId;
  h.emit({
    schema_version: 'solat.voice-provider-event.v1',
    type: 'final',
    session_id: sessionId,
    utterance_id: 'u-spatial-1',
    transcript: 'เอาอันนี้',
    received_at_ms: 1234567890,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finalArgs[0], 'เอาอันนี้');
  assert.equal(finalArgs[1], 'u-spatial-1');
  assert.deepEqual(finalArgs[2], {
    voiceSessionId: sessionId,
    utteranceId: 'u-spatial-1',
    receivedAtMs: 1234567890,
  });
  await h.controller.exit();
});

test('barge-in cancels current speech before opening a fresh listening session', async () => {
  const h = harness();
  await h.controller.enter('conversation-2');
  h.controller.setState('speaking');
  const interrupted = await h.controller.interrupt();
  assert.equal(interrupted, true);
  assert.ok(h.states.includes('interrupted'));
  assert.equal(h.states.at(-1), 'listening');
  assert.equal(h.calls.filter(call => call[0] === 'cancel-tts').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'start').length, 2);
  await h.controller.exit();
});

test('assistant TTS completes then resumes listening and exit disposes microphone resources', async () => {
  const h = harness();
  await h.controller.enter('conversation-3');
  assert.equal(await h.controller.speak('User-visible assistant answer', 'en'), true);
  assert.ok(h.states.includes('speaking'));
  assert.equal(h.states.at(-1), 'listening');
  assert.equal(h.calls.find(call => call[0] === 'speak')[1].text, 'User-visible assistant answer');
  await h.controller.exit();
  assert.equal(h.track.stopped, true);
  assert.equal(h.controller.state, 'idle');
});

test('missing voice credentials fail visibly without opening the microphone', async () => {
  let requestedMic = false;
  const controller = new VoiceController({
    bridge: { voiceStatus: async () => ({ stt: { configured: false }, tts: { configured: false } }), voiceStartSTT() {} },
    mediaDevices: { getUserMedia: async () => { requestedMic = true; } },
    AudioContextClass: FakeAudioContext,
  });
  await assert.rejects(controller.enter('conversation-4'), error => error.code === 'voice_not_configured');
  assert.equal(requestedMic, false);
  assert.equal(controller.active, false);
});

test('a busy final callback declines dispatch and immediately opens a fresh listening session', async () => {
  const h = harness({ onFinalTranscript: async () => false });
  await h.controller.enter('conversation-busy');
  const firstSession = h.calls.find(call => call[0] === 'start')[1].sessionId;

  h.emit({
    schema_version: 'solat.voice-provider-event.v1',
    type: 'final',
    session_id: firstSession,
    utterance_id: 'busy-final-1',
    transcript: 'อย่าทิ้งข้อความนี้',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.calls.filter(call => call[0] === 'start').length, 2, 'declined final must resume listening instead of sticking in thinking');
  assert.equal(h.controller.dispatching, false);
  assert.equal(h.controller.state, 'listening');
  await h.controller.exit();
});

test('re-entry waits for the older exit before creating a fresh microphone session', async () => {
  const cancelGate = deferred();
  const h = harness({
    bridge: {
      voiceCancelSTT: async value => {
        h.calls.push(['cancel-stt', value]);
        await cancelGate.promise;
      },
    },
  });
  await h.controller.enter('conversation-reenter');

  const exiting = h.controller.exit();
  const reentering = h.controller.enter('conversation-reenter');
  await new Promise(resolve => setImmediate(resolve));
  const startsBeforeRelease = h.calls.filter(call => call[0] === 'start');
  assert.equal(startsBeforeRelease.length, 1, 're-entry must wait until the older microphone lifecycle is fully released');

  cancelGate.resolve();
  await Promise.all([exiting, reentering]);

  const startsAfterRelease = h.calls.filter(call => call[0] === 'start');
  assert.equal(startsAfterRelease.length, 2);
  const freshSessionId = startsAfterRelease[1][1].sessionId;
  assert.equal(h.controller.active, true);
  assert.equal(h.controller.state, 'listening');
  assert.equal(h.controller.voiceSessionId, freshSessionId);
  assert.equal(h.track.stopped, true, 'the older microphone track must be stopped before re-entry');
  assert.equal(h.calls.some(call => call[0] === 'dispose' && call[1].sessionId === freshSessionId), false);
  await h.controller.exit();
});

test('concurrent echo-triggered interrupts coalesce into one cancel and one fresh STT session', async () => {
  const cancelGate = deferred();
  const h = harness({
    bridge: {
      voiceCancelTTS: async value => {
        h.calls.push(['cancel-tts', value]);
        await cancelGate.promise;
      },
    },
  });
  await h.controller.enter('conversation-echo');
  h.controller.setState('speaking');

  const first = h.controller.interrupt();
  const second = h.controller.interrupt();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call[0] === 'cancel-tts').length, 1, 'overlapping loud frames must share one interrupt operation');

  cancelGate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'start').length, 2);
  assert.equal(h.controller.state, 'listening');
  await h.controller.exit();
});

test('microphone initialization failure rolls back active state, track, and event subscription', async () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  class FailingAudioContext {
    constructor() { throw Object.assign(new Error('audio context failed'), { code: 'audio_context_failed' }); }
  }
  const h = harness({
    track,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    AudioContextClass: FailingAudioContext,
  });

  await assert.rejects(h.controller.enter('conversation-init-failure'), /audio context failed/);
  assert.equal(h.controller.active, false);
  assert.equal(track.stopped, true);
  assert.equal(h.controller.stream, null);
  assert.equal(h.controller.unsubscribe, null);
});

test('a suspended AudioContext resumes before microphone streaming starts', async () => {
  class SuspendedAudioContext extends FakeAudioContext {
    constructor() {
      super();
      this.state = 'suspended';
      this.resumeCalls = 0;
    }
    async resume() {
      this.resumeCalls += 1;
      this.state = 'running';
    }
  }
  const h = harness({ AudioContextClass: SuspendedAudioContext });

  await h.controller.enter('conversation-suspended-context');
  assert.equal(h.controller.audioContext.resumeCalls, 1);
  assert.equal(h.controller.audioContext.state, 'running');
  assert.equal(h.controller.state, 'listening');
  await h.controller.exit();
});

test('exit during pending microphone initialization cannot leak or revive voice resources', async () => {
  const microphoneGate = deferred();
  const track = { stopped: false, stop() { this.stopped = true; } };
  let audioContext = null;
  class TrackedAudioContext extends FakeAudioContext {
    constructor() {
      super();
      audioContext = this;
    }
  }
  const h = harness({
    track,
    mediaDevices: { getUserMedia: async () => microphoneGate.promise },
    AudioContextClass: TrackedAudioContext,
  });

  const entering = h.controller.enter('conversation-exit-during-mic');
  await new Promise(resolve => setImmediate(resolve));
  await h.controller.exit();
  microphoneGate.resolve({ getTracks: () => [track] });

  assert.equal(await entering, false);
  assert.equal(track.stopped, true);
  assert.equal(audioContext.state, 'closed');
  assert.equal(h.calls.filter(call => call[0] === 'start').length, 0);
  assert.equal(h.controller.active, false);
  assert.equal(h.controller.state, 'idle');
  assert.equal(h.controller.stream, null);
  assert.equal(h.controller.audioContext, null);
  assert.equal(h.controller.unsubscribe, null);
});

test('exit during pending STT start cancels the late session without returning to listening', async () => {
  const startGate = deferred();
  const h = harness({
    bridge: {
      voiceStartSTT: async value => {
        h.calls.push(['start', value]);
        await startGate.promise;
      },
    },
  });

  const entering = h.controller.enter('conversation-exit-during-start');
  while (!h.calls.some(call => call[0] === 'start')) await new Promise(resolve => setImmediate(resolve));
  await h.controller.exit();
  startGate.resolve();

  assert.equal(await entering, false);
  const sessionId = h.calls.find(call => call[0] === 'start')[1].sessionId;
  assert.equal(h.calls.some(call => call[0] === 'cancel-stt' && call[1].sessionId === sessionId), true);
  assert.equal(h.calls.some(call => call[0] === 'dispose' && call[1].sessionId === sessionId), true);
  assert.equal(h.states.includes('listening'), false);
  assert.equal(h.controller.active, false);
  assert.equal(h.controller.state, 'idle');
  assert.equal(h.controller.voiceSessionId, '');
});

test('silent microphone frames stay local and usage logs report only sent speech audio', async () => {
  const h = harness();
  await h.controller.enter('conversation-vad');
  const processor = h.controller.processor;
  const silent = new Float32Array(4096);
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => silent } });
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => silent } });
  await h.controller.pushChain;
  assert.equal(h.calls.filter(call => call[0] === 'push').length, 0, 'silence must not be sent to STT');

  const speech = new Float32Array(4096).fill(0.12);
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => speech } });
  for (let index = 0; index < 6; index += 1) processor.onaudioprocess({ inputBuffer: { getChannelData: () => silent } });
  await h.controller.pushChain;
  assert.ok(h.calls.filter(call => call[0] === 'push').length > 0, 'speech plus a bounded tail should reach STT');
  await h.controller.exit();
  const stop = h.logs.find(entry => entry.event === 'stt-stop');
  assert.ok(stop);
  assert.ok(stop.audioBytesSent > 0);
  assert.ok(stop.audioMsSent <= 600);
});

test('one assistant response gets one TTS generation per request context', async () => {
  const h = harness();
  await h.controller.enter('conversation-tts-dedupe');
  assert.equal(await h.controller.speak('Same visible answer', 'en', 'request-1'), true);
  assert.equal(await h.controller.speak('Same visible answer', 'en', 'request-1'), false);
  assert.equal(h.calls.filter(call => call[0] === 'speak').length, 1);
  assert.equal(h.logs.filter(entry => entry.event === 'tts-request').length, 1);
  assert.equal(h.logs.filter(entry => entry.event === 'tts-duplicate-suppressed').length, 1);
  assert.equal(h.logs.find(entry => entry.event === 'tts-request').textLength, 'Same visible answer'.length);
  await h.controller.exit();
});
