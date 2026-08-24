const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const { registerSolatIpc } = require('../src/ipc-router');
const { InteractionMemory } = require('../src/core/spatial-memory');

function makeIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

function makeSender(id) {
  const sender = new EventEmitter();
  sender.id = id;
  sender.isDestroyed = () => false;
  sender.sent = [];
  sender.send = (channel, payload) => sender.sent.push([channel, payload]);
  return sender;
}

function register({ voiceService, spatialMemory, core }) {
  const ipc = makeIpc();
  registerSolatIpc({
    ipcMain: ipc,
    services: {
      core: core || { status: () => ({}), send: async () => ({ assistant: 'ok' }), provider: { setMode() {} } },
      computerTaskLoop: {}, agentService: {}, filesystemWorkspace: {},
      conversationPersistence: {}, creativePersistence: {}, creativeWorkflow: {},
      assetStore: {}, fileIntake: {}, voiceService, spatialMemory,
    },
    exportRoot: path.join(os.tmpdir(), 'solat-voice-spatial-test'),
    shellOpenPath: async () => '',
    fsImpl: { stat: async () => ({ isFile: () => true }), readFile: async () => '' },
  });
  return ipc;
}

function spatialEvent(eventId, startedAtMs, endedAtMs) {
  return {
    event_id: eventId,
    context_id: `ctx-${eventId}`,
    source: 'mouse',
    gesture: 'click',
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    display: { id: 'display-1', scale_factor: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } },
    points: [{ x: 100, y: 100, t_ms: 0, pressure: 0.5 }],
  };
}

test('main process timestamps final STT and grounds spatial context at that timestamp only', async () => {
  const memory = new InteractionMemory({ now: () => 2000 });
  const finalHandlers = new Map();
  const voiceService = {
    status: () => ({}),
    startSTT: request => { finalHandlers.set(request.sessionId, request.onEvent); return { sessionId: request.sessionId }; },
    pushSTT: () => undefined,
    stopSTT: () => true,
    cancelSTT: () => true,
    speak: async () => ({ audio: Uint8Array.from([1]) }),
    cancelTTS: () => true,
  };
  const sentRequests = [];
  const core = {
    status: () => ({}),
    provider: { setMode() {} },
    send: async request => { sentRequests.push(request); return { assistant: 'ok' }; },
  };
  const ipc = register({ voiceService, spatialMemory: memory, core });
  const sender = makeSender(7);
  const owner = { sender };
  let now = 1000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-during' });
    finalHandlers.get('voice-during')({
      schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: 'voice-during',
      utterance_id: 'utterance-during', transcript: 'เอาอันนี้',
    });
  } finally {
    Date.now = originalNow;
  }
  const forwarded = sender.sent.find(([, payload]) => payload.type === 'final')?.[1];
  assert.equal(forwarded.received_at_ms, 1000, 'final timestamp must come from the main-process receive boundary');

  // The annotation ended while the user was speaking. It is eligible when
  // the voice request is grounded at the verified final timestamp.
  memory.record(spatialEvent('during', 800, 900), { ownerId: 'renderer:7', sessionId: 'conversation-1' });
  const during = await ipc.handlers.get('solat:send')(owner, {
    sessionId: 'conversation-1', content: 'เอาอันนี้',
    voiceSessionId: 'voice-during', voiceUtteranceId: 'utterance-during', voiceFinalAtMs: forwarded.received_at_ms,
  });
  assert.equal(during.ok, true);
  assert.equal(sentRequests[0].spatialContext.event_id, 'during');
  assert.equal(sentRequests[0].spatialContext.age_ms, 100);

  // A second annotation happened after the final STT event. Reusing the same
  // verified timestamp must not receive future-event grace.
  now = 1000;
  Date.now = () => now;
  try {
    await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-after' });
    finalHandlers.get('voice-after')({
      schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: 'voice-after',
      utterance_id: 'utterance-after', transcript: 'เอาอันนี้',
    });
  } finally {
    Date.now = originalNow;
  }
  const afterForwarded = sender.sent.find(([, payload]) => payload.type === 'final' && payload.session_id === 'voice-after')?.[1];
  memory.record(spatialEvent('after', 1100, 1150), { ownerId: 'renderer:7', sessionId: 'conversation-1' });
  const after = await ipc.handlers.get('solat:send')(owner, {
    sessionId: 'conversation-1', content: 'เอาอันนี้',
    voiceSessionId: 'voice-after', voiceUtteranceId: 'utterance-after', voiceFinalAtMs: afterForwarded.received_at_ms,
  });
  assert.equal(after.ok, true);
  assert.equal(sentRequests[1].spatialContext, null, 'an annotation after final STT must not ground the voice request');
});

test('verified voice finals mark the turn as voice input and stream deltas back to the sender', async () => {
  const finalHandlers = new Map();
  const voiceService = {
    status: () => ({}),
    startSTT: request => { finalHandlers.set(request.sessionId, request.onEvent); return {}; },
    pushSTT: () => undefined, stopSTT: () => true, cancelSTT: () => true,
    speak: async () => ({ audio: Uint8Array.from([1]) }), cancelTTS: () => true,
  };
  const sentRequests = [];
  const core = {
    status: () => ({}),
    provider: { setMode() {} },
    send: async request => {
      sentRequests.push(request);
      if (typeof request.onAssistantDelta === 'function') {
        request.onAssistantDelta('สวัสดี ');
        request.onAssistantDelta('ครับ');
      }
      return { assistant: 'ok' };
    },
  };
  const ipc = register({ voiceService, spatialMemory: null, core });
  const sender = makeSender(21);
  const owner = { sender };
  await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-src' });
  finalHandlers.get('voice-src')({
    schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: 'voice-src',
    utterance_id: 'utterance-src', transcript: 'สวัสดีครับ',
  });
  const forwarded = sender.sent.find(([, payload]) => payload.type === 'final')?.[1];

  const verified = await ipc.handlers.get('solat:send')(owner, {
    requestId: 'request-voice-1',
    sessionId: 'conversation-v', content: 'สวัสดีครับ',
    voiceSessionId: 'voice-src', voiceUtteranceId: 'utterance-src', voiceFinalAtMs: forwarded.received_at_ms,
    streamResponse: true,
  });
  assert.equal(verified.ok, true);
  assert.equal(sentRequests[0].inputSource, 'voice', 'a main-verified final must enter the core as a voice turn');
  const deltas = sender.sent.filter(([channel]) => channel === 'solat:assistant-delta').map(([, payload]) => payload);
  assert.deepEqual(deltas.map(delta => delta.delta), ['สวัสดี ', 'ครับ']);
  assert.ok(deltas.every(delta => delta.requestId === 'request-voice-1' && delta.schema_version === 'solat.assistant-delta.v1'));

  const unverified = await ipc.handlers.get('solat:send')(owner, {
    requestId: 'request-typed-1',
    sessionId: 'conversation-v', content: 'พิมพ์เอง',
    voiceSessionId: 'voice-src', voiceUtteranceId: 'utterance-src', voiceFinalAtMs: forwarded.received_at_ms,
    streamResponse: true,
  });
  assert.equal(unverified.ok, true);
  assert.equal(sentRequests[1].inputSource, 'text', 'a replayed or unverified final must not claim the voice input source');
  assert.equal(typeof sentRequests[1].onAssistantDelta, 'function', 'typed turns may still stream when voice mode requests it');
});

test('final timestamp cannot be replayed from another renderer or with a changed transcript', async () => {
  const contexts = [];
  const finalHandlers = new Map();
  const voiceService = {
    status: () => ({}),
    startSTT: request => { finalHandlers.set(request.sessionId, request.onEvent); return {}; },
    pushSTT: () => undefined, stopSTT: () => true, cancelSTT: () => true,
    speak: async () => ({ audio: Uint8Array.from([1]) }), cancelTTS: () => true,
  };
  const spatialMemory = { contextFor: input => { contexts.push(input); return null; }, record: value => value };
  const core = { status: () => ({}), provider: { setMode() {} }, send: async () => ({ assistant: 'ok' }) };
  const ipc = register({ voiceService, spatialMemory, core });
  const owner = { sender: makeSender(11) };
  const other = { sender: makeSender(12) };
  const originalNow = Date.now;
  Date.now = () => 5555;
  try {
    await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-owner' });
    finalHandlers.get('voice-owner')({
      schema_version: 'solat.voice-provider-event.v1', type: 'final', session_id: 'voice-owner',
      utterance_id: 'utterance-owner', transcript: 'อันนี้',
    });
  } finally {
    Date.now = originalNow;
  }
  const forged = await ipc.handlers.get('solat:send')(other, {
    sessionId: 'conversation-2', content: 'อันนี้', voiceSessionId: 'voice-owner',
    voiceUtteranceId: 'utterance-owner', voiceFinalAtMs: 5555,
  });
  assert.equal(forged.ok, true);
  assert.equal(contexts[0].atMs, undefined, 'another renderer must not consume the owner timestamp');

  const changed = await ipc.handlers.get('solat:send')(owner, {
    sessionId: 'conversation-2', content: 'อันอื่น', voiceSessionId: 'voice-owner',
    voiceUtteranceId: 'utterance-owner', voiceFinalAtMs: 5555,
  });
  assert.equal(changed.ok, true);
  assert.equal(contexts[1].atMs, undefined, 'a changed transcript must not consume the final timestamp');
});
