const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { registerSolatIpc, resolveOwnedExportPath } = require('../src/ipc-router');
const { MultimodalCoordinator } = require('../src/core/multimodal-coordinator');
const { MultimodalFusion } = require('../src/core/multimodal-fusion');
const { MultimodalPersistence } = require('../src/core/multimodal-persistence');

function makeIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

function makeServices(overrides = {}) {
  return {
    core: { status: () => ({ configured: true }), send: async () => ({ content: 'ok' }) },
    computerTaskLoop: { inspect: () => ({}), continue: async () => ({ status: 'RUNNING' }), cancel: async () => ({ status: 'CANCELLED' }) },
    agentService: {
      createPlan: async () => ({ plan: { plan_id: 'plan_1' } }),
      inspect: async () => null,
      approve: async () => ({ status: 'APPROVED' }),
      cancel: async () => ({ status: 'CANCELLED' }),
      run: async () => ({ plan: { status: 'SUCCEEDED' } }),
      collectInterrupted: async () => ({ schema_version: 'solat.agent-interrupted.v1', plans: [] }),
    },
    filesystemWorkspace: {},
    conversationPersistence: { save: async () => ({}), load: async () => ({}) },
    creativePersistence: { saveResult: async () => ({}), loadHistory: async () => ({}) },
    creativeWorkflow: { createDeck: async () => ({}) },
    assetStore: {},
    fileIntake: {},
    voiceService: {
      status: () => ({ schemaVersion: 'solat.voice-status.v1' }),
      startSTT: () => ({}), pushSTT: () => undefined, stopSTT: () => true, cancelSTT: () => true,
      speak: async () => ({ audio: Uint8Array.from([1]) }), cancelTTS: () => true,
    },
    spatialMemory: { contextFor: () => null, record: value => value },
    multimodalCoordinator: null,
    spatialAssetRuntime: null,
    handInputService: null,
    ...overrides,
  };
}

const noShell = async () => '';
const noFs = { stat: async () => ({ isFile: () => true }), readFile: async () => '' };

function register(overrides = {}) {
  const ipc = makeIpc();
  registerSolatIpc({
    ipcMain: ipc,
    services: makeServices(overrides.services || {}),
    exportRoot: overrides.exportRoot || path.join(os.tmpdir(), 'solat-exports'),
    shellOpenPath: overrides.shellOpenPath || noShell,
    spatialOverlay: overrides.spatialOverlay || null,
    browserWorkspace: overrides.browserWorkspace || null,
    chromeAssetImport: overrides.chromeAssetImport || null,
    chromeControl: overrides.chromeControl || null,
    chromeExtensionPath: overrides.chromeExtensionPath || null,
    revealChromeExtension: overrides.revealChromeExtension || null,
    handDisplayResolver: overrides.handDisplayResolver || null,
    multimodalOwnerId: overrides.multimodalOwnerId ?? null,
    fsImpl: overrides.fsImpl || noFs,
  });
  return ipc;
}

test('ipc router registers every solat channel exactly once', () => {
  const ipc = register();
  for (const channel of [
    'solat:status', 'solat:set-model-mode', 'solat:send', 'solat:agent-create', 'solat:agent-inspect', 'solat:agent-approve',
    'solat:agent-cancel', 'solat:agent-run', 'solat:agent-interrupted-plans',
    'solat:computer-task-continue', 'solat:computer-task-inspect', 'solat:computer-task-approve-and-continue', 'solat:computer-task-cancel',
    'solat:agent-read-artifact', 'solat:agent-export-artifact', 'solat:save-conversation', 'solat:load-conversation',
    'solat:create-deck', 'solat:load-creative-history', 'solat:store-original-asset', 'solat:export-html',
    'solat:open-export', 'solat:inspect-export',
    'solat:voice-status', 'solat:voice-start-stt', 'solat:voice-push-stt', 'solat:voice-stop-stt',
    'solat:voice-cancel-stt', 'solat:voice-speak', 'solat:voice-cancel-tts', 'solat:voice-dispose',
    'solat:spatial-open', 'solat:spatial-complete', 'solat:spatial-cancel',
    'solat:spatial-asset-register', 'solat:spatial-asset-select', 'solat:spatial-asset-begin', 'solat:spatial-asset-move',
    'solat:spatial-asset-switch', 'solat:spatial-asset-drop', 'solat:spatial-asset-cancel', 'solat:spatial-asset-memory',
    'solat:multimodal-undo',
    'solat:hand-status', 'solat:hand-start', 'solat:hand-frame', 'solat:hand-stop',
    'solat:browser-open', 'solat:browser-status', 'solat:browser-observe', 'solat:browser-navigate',
    'solat:browser-takeover', 'solat:browser-return-control', 'solat:browser-close', 'solat:browser-shell-command',
    'solat:chrome-asset-import', 'solat:chrome-control-status', 'solat:chrome-control-pair',
    'solat:chrome-control-reveal-extension', 'solat:chrome-control-adopt-active',
    'solat:chrome-control-tabs', 'solat:chrome-control-switch-tab',
  ]) {
    assert.ok(ipc.handlers.has(channel), `missing channel ${channel}`);
  }
});

test('Chrome Control IPC derives ownership and keeps pairing and reveal behind explicit calls', async () => {
  const calls = [];
  const chromeControl = {
    registerOwner: (ownerId, sender) => calls.push(['owner', ownerId, sender.id]),
    statusSummary: () => ({ status: 'connected', connected: true }),
    pair: () => { calls.push(['pair']); return { status: 'pairing' }; },
    adoptActiveForOwner: scope => { calls.push(['adopt', scope.ownerId, scope.request.sessionId, scope.request.ownerId]); return { surface_id: 'chrome:7' }; },
    listTabsForOwner: scope => { calls.push(['tabs', scope.ownerId, scope.request.sessionId]); return { schema_version: 'solat.chrome-tab-list.v1', tabs: [] }; },
    switchTabForOwner: scope => { calls.push(['switch', scope.ownerId, scope.request.sessionId, scope.request.tabRef]); return { surface_id: 'chrome:8' }; },
  };
  const revealed = [];
  const ipc = register({ chromeControl, chromeExtensionPath: 'D:\\SOLAT_V3\\chrome-extension', revealChromeExtension: value => { revealed.push(value); return { revealed: true }; } });
  const event = { sender: { id: 44 } };
  assert.equal((await ipc.handlers.get('solat:chrome-control-status')(event, { ownerId: 'spoofed' })).value.connected, true);
  assert.equal(calls.some(call => call[0] === 'pair'), false, 'status must not pair as a side effect');
  await ipc.handlers.get('solat:chrome-control-pair')(event, {});
  await ipc.handlers.get('solat:chrome-control-reveal-extension')(event, {});
  const adopted = await ipc.handlers.get('solat:chrome-control-adopt-active')(event, { ownerId: 'spoofed', sessionId: 'thread-a' });
  await ipc.handlers.get('solat:chrome-control-tabs')(event, { ownerId: 'spoofed', sessionId: 'thread-a' });
  await ipc.handlers.get('solat:chrome-control-switch-tab')(event, { ownerId: 'spoofed', sessionId: 'thread-a', tabRef: 'opaque-tab' });
  assert.equal(adopted.value.surface_id, 'chrome:7');
  assert.deepEqual(revealed, ['D:\\SOLAT_V3\\chrome-extension']);
  assert.deepEqual(calls.find(call => call[0] === 'adopt'), ['adopt', 'renderer:44', 'thread-a', 'spoofed']);
  assert.deepEqual(calls.find(call => call[0] === 'tabs'), ['tabs', 'renderer:44', 'thread-a']);
  assert.deepEqual(calls.find(call => call[0] === 'switch'), ['switch', 'renderer:44', 'thread-a', 'opaque-tab']);
});

test('Chrome Control rejects an unauthenticated IPC sender before pairing', async () => {
  let paired = false;
  const ipc = register({ chromeControl: {
    pair() { paired = true; },
    statusSummary: () => ({ connected: false }),
    adoptActiveForOwner: () => ({}),
  } });
  const result = await ipc.handlers.get('solat:chrome-control-pair')({ sender: {} }, {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'chrome_control_sender_unavailable');
  assert.equal(paired, false);
});

test('Chrome image import derives live renderer ownership and never trusts a request owner', async () => {
  let received;
  const ipc = register({ chromeAssetImport: async input => { received = input; return { spatial_asset_id: 'spatial-1' }; } });
  const sender = { id: 73, isDestroyed: () => false, send() {} };
  const response = await ipc.handlers.get('solat:chrome-asset-import')({ sender }, {
    ownerId: 'spoofed', sessionId: 'thread-a', bytes: Uint8Array.from([1]), mimeType: 'image/png',
  });
  assert.equal(response.ok, true);
  assert.equal(received.ownerId, 'renderer:73');
  assert.equal(received.request.ownerId, 'spoofed');
  assert.equal(received.sender, sender);
});

test('hand IPC derives owner and display in main, emits only semantic events, and cleans sender state', async () => {
  const calls = [];
  const handInputService = {
    status: scope => ({ status: 'idle', owner: scope.ownerId }),
    start: scope => { calls.push(['start', scope]); return { status: 'tracking' }; },
    frame: scope => ({ events: [{ schema_version: 'solat.spatial-event.v1', event_id: 'hand-1', source: 'hand', gesture: 'point', phase: 'move', points: [{ x: 10, y: 20 }], display: scope.display }] }),
    stop: scope => { calls.push(['stop', scope]); return { status: 'idle' }; },
    disposeOwner: ownerId => calls.push(['dispose', ownerId]),
  };
  const ipc = register({ services: { handInputService }, handDisplayResolver: () => ({ id: 'display-1', scale_factor: 1.25, bounds: { x: -1200, y: 0, width: 1200, height: 900 } }) });
  const sender = Object.assign(new EventEmitter(), { id: 77, isDestroyed: () => false, send: (...args) => calls.push(['send', ...args]) });
  const event = { sender };
  const started = await ipc.handlers.get('solat:hand-start')(event, { ownerId: 'spoofed', sessionId: 'thread-a', contextId: 'ctx' });
  assert.equal(started.ok, true);
  assert.equal(calls[0][1].ownerId, 'renderer:77');
  assert.equal(calls[0][1].display.bounds.x, -1200);
  const framed = await ipc.handlers.get('solat:hand-frame')(event, { sessionId: 'thread-a', frame: { schema_version: 'solat.hand-landmarks.v1' } });
  assert.equal(framed.ok, true);
  assert.deepEqual(calls.find(call => call[0] === 'send').slice(1), ['solat:hand-event', framed.value.events[0]]);
  assert.equal(JSON.stringify(framed).includes('image'), false);
  sender.emit('destroyed');
  assert.ok(calls.some(call => call[0] === 'dispose' && call[1] === 'renderer:77'));
});

test('browser workspace IPC derives ownership from the Electron sender and keeps shell commands separate', async () => {
  const calls = [];
  const browserWorkspace = {
    registerOwner(ownerId, sender) { calls.push(['register', ownerId, sender.id]); },
    openForOwner(value) { calls.push(['open', value.ownerId, value.request.sessionId]); return { surface_id: 'surface-1' }; },
    shellCommand(sender, request) { calls.push(['shell', sender.id, request.action]); return { status: 'ready' }; },
  };
  const ipc = register({ browserWorkspace });
  const sender = { id: 27, isDestroyed: () => false };
  const opened = await ipc.handlers.get('solat:browser-open')({ sender }, { ownerId: 'spoofed', sessionId: 'thread-a', url: 'https://example.com' });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls.slice(0, 2), [['register', 'renderer:27', 27], ['open', 'renderer:27', 'thread-a']]);
  const shell = { id: 91 };
  const command = await ipc.handlers.get('solat:browser-shell-command')({ sender: shell }, { action: 'takeover', ownerId: 'spoofed' });
  assert.equal(command.ok, true);
  assert.deepEqual(calls.at(-1), ['shell', 91, 'takeover']);
});

test('voice IPC keeps sessions bound to one renderer and emits only the provider event contract', async () => {
  let onEvent;
  const ipc = register({ services: { voiceService: {
    status: () => ({}),
    startSTT: request => { onEvent = request.onEvent; return { sessionId: request.sessionId }; },
    pushSTT: () => undefined, stopSTT: () => true, cancelSTT: () => true,
    speak: async () => ({ audio: Uint8Array.from([1]) }), cancelTTS: () => true,
  } } });
  const sent = [];
  const owner = { sender: { id: 7, isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) } };
  const other = { sender: { id: 8, isDestroyed: () => false, send() {} } };
  const started = await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-1', sampleRate: 48000 });
  assert.equal(started.ok, true);
  onEvent({ schema_version: 'solat.voice-provider-event.v1', type: 'partial', session_id: 'voice-1', transcript: 'hi' });
  assert.equal(sent[0][0], 'solat:voice-event');
  const blocked = await ipc.handlers.get('solat:voice-push-stt')(other, { sessionId: 'voice-1', bytes: Uint8Array.from([1]) });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'voice_session_forbidden');
});

for (const lifecycleEvent of ['destroyed', 'closed']) {
  test(`voice IPC releases and disposes sender sessions when the sender is ${lifecycleEvent}`, async () => {
    const cancelled = [];
    const voiceService = {
      status: () => ({}),
      startSTT: request => ({ sessionId: request.sessionId }),
      pushSTT: () => undefined,
      stopSTT: () => true,
      cancelSTT: request => { cancelled.push(['stt', request.sessionId]); return true; },
      speak: async request => ({ sessionId: request.sessionId, audio: Uint8Array.from([1]) }),
      cancelTTS: request => { cancelled.push(['tts', request.sessionId]); return true; },
    };
    const ipc = register({ services: { voiceService } });
    const sender = Object.assign(new EventEmitter(), { id: 17, isDestroyed: () => false, send() {} });
    const otherSender = Object.assign(new EventEmitter(), { id: 18, isDestroyed: () => false, send() {} });
    const owner = { sender };
    const other = { sender: otherSender };

    assert.equal((await ipc.handlers.get('solat:voice-start-stt')(owner, { sessionId: 'voice-stt' })).ok, true);
    assert.equal((await ipc.handlers.get('solat:voice-speak')(owner, { sessionId: 'voice-tts', text: 'hello' })).ok, true);
    assert.equal((await ipc.handlers.get('solat:voice-start-stt')(other, { sessionId: 'voice-other' })).ok, true);
    assert.equal(sender.listenerCount('destroyed'), 1, 'one sender watcher must cover every claimed session');
    assert.equal(sender.listenerCount('closed'), 1, 'one sender watcher must cover every claimed session');

    sender.emit(lifecycleEvent);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(cancelled.filter(([, sessionId]) => sessionId !== 'voice-other').sort(), [
      ['stt', 'voice-stt'], ['stt', 'voice-tts'], ['tts', 'voice-stt'], ['tts', 'voice-tts'],
    ].sort());
    assert.equal(cancelled.some(([, sessionId]) => sessionId === 'voice-other'), false, 'another sender session must remain untouched');
    assert.equal((await ipc.handlers.get('solat:voice-start-stt')(other, { sessionId: 'voice-stt' })).ok, true, 'released ownership must be claimable by another live sender');
    const stillBlocked = await ipc.handlers.get('solat:voice-push-stt')(owner, { sessionId: 'voice-other', bytes: Uint8Array.from([1]) });
    assert.equal(stillBlocked.ok, false);
    assert.equal(stillBlocked.error.code, 'voice_session_forbidden');
  });
}

test('model mode IPC validates through the main-process router', async () => {
  let selected = null;
  const ipc = register({ services: { core: { status: () => ({}), provider: { setMode(mode) { selected = mode; return { modelMode: mode }; } } } } });
  const result = await ipc.handlers.get('solat:set-model-mode')(null, 'auto');
  assert.equal(result.ok, true);
  assert.equal(result.value.modelMode, 'auto');
  assert.equal(selected, 'auto');
});

test('spatial IPC records only token-validated overlay output and attaches owner-scoped context to chat', async () => {
  let sentRequest = null;
  let recorded = null;
  const context = { schema_version: 'solat.spatial-context.v1', event_id: 'event-1', gesture: 'circle' };
  const spatialMemory = {
    contextFor: input => { assert.equal(input.ownerId, 'renderer:1'); return context; },
    record: (event, scope) => { recorded = { event, scope }; return { schema_version: 'solat.spatial-event.v1', event_id: 'event-1', gesture: 'circle', bounds: {}, context_id: '' }; },
  };
  let notified = false;
  let openedInput = null;
  const spatialOverlay = {
    open: async input => { openedInput = input; return { status: 'opened', sessionId: input.sessionId }; },
    complete: async () => ({ event: { gesture: 'circle', points: [{ x: 1, y: 1 }] }, scope: { ownerId: 'renderer:1', sessionId: 'session-1' }, commit: () => { notified = true; } }),
    cancel: async () => ({ status: 'cancelled' }),
  };
  const ipc = register({
    spatialOverlay,
    services: {
      spatialMemory,
      core: { status: () => ({}), send: async input => { sentRequest = input; return { content: 'ok' }; } },
    },
  });
  const opened = await ipc.handlers.get('solat:spatial-open')({ sender: { id: 1 } }, { sessionId: 'session-1', gesture: 'circle' });
  assert.equal(opened.ok, true);
  assert.equal(openedInput.ownerId, 'renderer:1', 'the renderer principal must come from event.sender.id');
  const completed = await ipc.handlers.get('solat:spatial-complete')({ sender: { id: 2 } }, {});
  assert.equal(completed.ok, true);
  assert.equal(recorded.scope.ownerId, 'renderer:1');
  assert.equal(notified, true);
  await ipc.handlers.get('solat:send')({ sender: { id: 1, isDestroyed: () => false } }, { sessionId: 'session-1', content: 'เอาอันนี้ออก' });
  assert.equal(sentRequest.spatialContext, context);
});

test('chat resolves persisted multimodal context owner-scoped and undo cannot trust a spoofed owner', async () => {
  const calls = [];
  let sentRequest;
  const expected = { schema_version: 'solat.multimodal-context.v1', status: 'resolved', event_id: 'asset-1', source: 'asset', type: 'asset_inserted' };
  const multimodalCoordinator = {
    async contextFor(input) { calls.push(['context', input]); return expected; },
    async undo(input) { calls.push(['undo', input]); return { status: 'undone', event_id: 'asset-1' }; },
  };
  const ipc = register({ services: {
    multimodalCoordinator,
    core: { status: () => ({}), send: async input => { sentRequest = input; return { content: 'ok' }; } },
  } });
  const event = { sender: { id: 51, isDestroyed: () => false } };
  const sent = await ipc.handlers.get('solat:send')(event, { ownerId: 'spoofed', sessionId: 'thread-a', content: 'แก้รูปที่เพิ่งแปะ' });
  assert.equal(sent.ok, true);
  assert.equal(sentRequest.multimodalContext, expected);
  assert.equal(calls[0][1].ownerId, 'renderer:51');
  const undone = await ipc.handlers.get('solat:multimodal-undo')(event, { ownerId: 'spoofed', sessionId: 'thread-a' });
  assert.equal(undone.ok, true);
  assert.equal(calls[1][1].ownerId, 'renderer:51');
});

test('production multimodal memory keeps a stable profile owner when Electron changes sender id after restart', async () => {
  const calls = [];
  const multimodalCoordinator = {
    async contextFor(input) { calls.push(['context', input]); return null; },
    async undo(input) { calls.push(['undo', input]); return { status: 'undone', event_id: 'event-1' }; },
  };
  const sentOwners = [];
  const ipc = register({
    multimodalOwnerId: 'local-desktop-profile:v1',
    services: {
      multimodalCoordinator,
      core: { status: () => ({}), send: async input => { sentOwners.push(input.ownerId); return { content: 'ok' }; } },
    },
  });
  await ipc.handlers.get('solat:send')(
    { sender: { id: 101, isDestroyed: () => false } },
    { ownerId: 'spoofed', sessionId: 'thread-a', content: 'อันนี้' },
  );
  await ipc.handlers.get('solat:multimodal-undo')(
    { sender: { id: 202, isDestroyed: () => false } },
    { ownerId: 'spoofed-again', sessionId: 'thread-a' },
  );
  assert.deepEqual(calls.map(([, input]) => input.ownerId), ['local-desktop-profile:v1', 'local-desktop-profile:v1']);
  assert.deepEqual(sentOwners, ['renderer:101'], 'live chat/tool authority must remain bound to the current sender');
});

test('a semantic hand reference is recovered through IPC after coordinator and Electron sender restart', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-mm-ipc-restart-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const persistentCoordinator = () => new MultimodalCoordinator({
    fusion: new MultimodalFusion(),
    persistence: new MultimodalPersistence({ rootDir: root }),
  });
  const occurredAtMs = Date.now();
  const first = register({
    multimodalOwnerId: 'local-desktop-profile:v1',
    handDisplayResolver: () => ({ id: 'display-1', scale_factor: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }),
    services: {
      multimodalCoordinator: persistentCoordinator(),
      handInputService: {
        frame: () => ({ events: [{ event_id: 'restart-hand-1', context_id: 'ctx-1', gesture: 'point', ended_at_ms: occurredAtMs, points: [{ x: 120, y: 240 }], confidence: 0.91 }] }),
      },
    },
  });
  const recorded = await first.handlers.get('solat:hand-frame')(
    { sender: { id: 301, isDestroyed: () => false, send() {} } },
    { sessionId: 'restart-thread', frame: {} },
  );
  assert.equal(recorded.ok, true);

  let recoveredContext = null;
  const second = register({
    multimodalOwnerId: 'local-desktop-profile:v1',
    services: {
      multimodalCoordinator: persistentCoordinator(),
      core: { status: () => ({}), send: async input => { recoveredContext = input.multimodalContext; return { content: 'ok' }; } },
    },
  });
  const sent = await second.handlers.get('solat:send')(
    { sender: { id: 777, isDestroyed: () => false } },
    { sessionId: 'restart-thread', content: 'อันนี้' },
  );
  assert.equal(sent.ok, true);
  assert.equal(recoveredContext?.status, 'resolved');
  assert.equal(recoveredContext?.event_id, 'hand:restart-hand-1');
  assert.equal(recoveredContext?.source, 'hand');
});

test('SpatialAsset IPC derives owner scope and reads immutable original identity server-side', async () => {
  const calls = [];
  const spatialAssetRuntime = {
    register: (input, scope) => { calls.push(['register', input, scope]); return { schema_version: 'solat.spatial-asset.v1', spatial_asset_id: 'spatial-1' }; },
    beginDrag: input => { calls.push(['begin', input]); return { ghost: { ghost_id: 'ghost-1' } }; },
    switchSurface: input => { calls.push(['switch', input]); return { ghost: { ghost_id: 'ghost-1' } }; },
    drop: input => { calls.push(['drop', input]); return { insertion: { insertion_id: 'insert-1' } }; },
    memory: input => { calls.push(['memory', input]); return { lastInserted: null }; },
  };
  const sent = [];
  const ipc = register({ services: {
    spatialAssetRuntime,
    core: { status: () => ({}), workspace: { getProject: sessionId => ({ project_id: `project-${sessionId}` }), linkProject: () => ({}) }, send: async () => ({}) },
    assetStore: { readOriginal: async input => {
      calls.push(['read', input]);
      return { asset: { asset_id: 'asset-real', hash: `sha256:${'a'.repeat(64)}`, mime_type: 'image/png' } };
    } },
    fileIntake: { intake: async () => ({ status: 'ready', extraction: null, asset: { asset_id: 'asset-real', project_id: 'project-session-1', hash: `sha256:${'a'.repeat(64)}`, size_bytes: 10 } }) },
  } });
  const event = { sender: { id: 44, isDestroyed: () => false, send: (channel, value) => sent.push([channel, value]) } };
  const stored = await ipc.handlers.get('solat:store-original-asset')(event, { sessionId: 'session-1', fileName: 'image.png', mimeType: 'image/png', bytes: Uint8Array.from([1]) });
  assert.equal(stored.ok, true);
  assert.equal(typeof stored.value.spatialCapability, 'string');
  const registered = await ipc.handlers.get('solat:spatial-asset-register')(event, {
    ownerId: 'spoofed', sessionId: 'session-1', assetId: 'asset-real', spatialCapability: stored.value.spatialCapability, hash: `sha256:${'b'.repeat(64)}`, width: 640, height: 480,
  });
  assert.equal(registered.ok, true);
  assert.deepEqual(calls[0], ['read', { ownerId: 'session-1', projectId: 'project-session-1', assetId: 'asset-real' }]);
  assert.equal(calls[1][1].original.hash, `sha256:${'a'.repeat(64)}`, 'renderer hash must not replace stored original provenance');
  assert.equal(calls[1][2].ownerId, 'renderer:44');
  await ipc.handlers.get('solat:spatial-asset-begin')(event, { ownerId: 'spoofed', sessionId: 'session-1', spatialAssetId: 'spatial-1', surface: {}, pointer: {} });
  await ipc.handlers.get('solat:spatial-asset-switch')(event, { ownerId: 'spoofed', sessionId: 'session-1', ghostId: 'ghost-1', targetSurface: {} });
  await ipc.handlers.get('solat:spatial-asset-drop')(event, { ownerId: 'spoofed', sessionId: 'session-1', ghostId: 'ghost-1', targetSurface: {} });
  assert.equal(calls.filter(call => ['begin', 'switch', 'drop'].includes(call[0])).every(call => call[1].ownerId === 'renderer:44'), true);
  assert.equal(sent.every(([channel]) => channel === 'solat:spatial-asset-event'), true);
});

test('SpatialAsset registration capability cannot cross renderer ownership', async () => {
  const ipc = register({ services: {
    spatialAssetRuntime: { register: () => ({}) },
    core: { status: () => ({}), workspace: { getProject: () => ({ project_id: 'project-1' }), linkProject: () => ({}) }, send: async () => ({}) },
    fileIntake: { intake: async () => ({ status: 'ready', extraction: null, asset: { asset_id: 'asset-1', project_id: 'project-1', hash: `sha256:${'a'.repeat(64)}`, size_bytes: 1 } }) },
    assetStore: { readOriginal: async () => ({ asset: { asset_id: 'asset-1', hash: `sha256:${'a'.repeat(64)}`, mime_type: 'image/png' } }) },
  } });
  const owner = { sender: { id: 1, isDestroyed: () => false, send() {} } };
  const attacker = { sender: { id: 2, isDestroyed: () => false, send() {} } };
  const stored = await ipc.handlers.get('solat:store-original-asset')(owner, { sessionId: 'shared', bytes: Uint8Array.from([1]) });
  const blocked = await ipc.handlers.get('solat:spatial-asset-register')(attacker, { sessionId: 'shared', assetId: 'asset-1', spatialCapability: stored.value.spatialCapability, width: 1, height: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'spatial_asset_forbidden');
});

test('chat attaches owner-scoped Thai latest SpatialAsset reference to the normal core path', async () => {
  let sentRequest = null;
  const expected = { schema_version: 'solat.spatial-interaction-context.v1', reference: 'lastInserted', value: { insertion: { insertion_id: 'insert-1' } } };
  const ipc = register({ services: {
    spatialAssetRuntime: { resolveReference: input => {
      assert.deepEqual(input, { ownerId: 'renderer:9', sessionId: 'session-1', text: 'ขยายรูปที่เพิ่งแปะ' });
      return expected;
    } },
    core: { status: () => ({}), send: async input => { sentRequest = input; return { content: 'ok' }; } },
  } });
  const result = await ipc.handlers.get('solat:send')({ sender: { id: 9, isDestroyed: () => false } }, { sessionId: 'session-1', content: 'ขยายรูปที่เพิ่งแปะ' });
  assert.equal(result.ok, true);
  assert.equal(sentRequest.spatialAssetContext, expected);
});

test('agent channels require a session id and map service errors into the ok envelope', async () => {
  const ipc = register();
  const missingSession = await ipc.handlers.get('solat:agent-inspect')(null, { idempotencyKey: 'k' });
  assert.equal(missingSession.ok, false);
  assert.equal(missingSession.error.code, 'invalid_request');

  const ok = await ipc.handlers.get('solat:agent-create')(null, { sessionId: 's1', steps: [] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.plan.plan_id, 'plan_1');

  const failing = register({ services: { agentService: { inspect: async () => { throw Object.assign(new Error('Persisted agent plan is malformed.'), { code: 'persistence_invalid' }); } } } });
  const mapped = await failing.handlers.get('solat:agent-inspect')(null, { sessionId: 's1', idempotencyKey: 'k' });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.error.code, 'persistence_invalid');
});

test('chat, Agent, and Computer Task IPC derive owner from sender rather than request spoof data', async () => {
  const chats = [];
  const plans = [];
  const inspected = [];
  const ipc = register({ services: {
    core: {
      status: () => ({}),
      send: async input => { chats.push(input); return { content: 'ok' }; },
    },
    agentService: {
      createPlan: async input => { plans.push(input); return { plan: { plan_id: 'plan-owner' } }; },
      inspect: async () => ({ status: 'SUCCEEDED', steps: [{ output: { status: 'ready' } }] }),
    },
    computerTaskLoop: {
      inspect: input => { inspected.push(input); return { status: 'NEEDS_CLARIFICATION' }; },
    },
  } });
  const first = { sender: { id: 31, isDestroyed: () => false } };
  const second = { sender: { id: 32, isDestroyed: () => false } };
  const spoof = { ownerId: 'renderer:attacker', sessionId: 'shared-session', content: 'hello' };

  await ipc.handlers.get('solat:send')(first, spoof);
  await ipc.handlers.get('solat:send')(second, spoof);
  assert.deepEqual(chats.map(({ ownerId, sessionId }) => ({ ownerId, sessionId })), [
    { ownerId: 'renderer:31', sessionId: 'shared-session' },
    { ownerId: 'renderer:32', sessionId: 'shared-session' },
  ]);

  await ipc.handlers.get('solat:agent-create')(first, { ...spoof, steps: [] });
  await ipc.handlers.get('solat:agent-create')(second, { ...spoof, steps: [] });
  assert.deepEqual(plans.map(({ ownerId, sessionId }) => ({ ownerId, sessionId })), [
    { ownerId: 'renderer:31', sessionId: 'shared-session' },
    { ownerId: 'renderer:32', sessionId: 'shared-session' },
  ]);

  await ipc.handlers.get('solat:computer-task-inspect')(first, { ...spoof, taskId: 'task-1' });
  await ipc.handlers.get('solat:computer-task-inspect')(second, { ...spoof, taskId: 'task-1' });
  assert.deepEqual(inspected.map(({ ownerId, sessionId }) => ({ ownerId, sessionId })), [
    { ownerId: 'renderer:31', sessionId: 'shared-session' },
    { ownerId: 'renderer:32', sessionId: 'shared-session' },
  ]);
});

test('computer-task-continue only feeds verified persisted evidence into the loop', async () => {
  const readyOutput = { status: 'ready', operation: 'open_website', verified: true };
  let continued = null;
  const ipc = register({
    services: {
      agentService: { inspect: async () => ({ status: 'SUCCEEDED', steps: [{ output: readyOutput }] }) },
      computerTaskLoop: { continue: async input => { continued = input; return { status: 'RUNNING' }; } },
    },
  });
  const result = await ipc.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(result.ok, true);
  assert.deepEqual(continued.verifiedObservation, readyOutput);
  assert.equal(continued.actionIdempotencyKey, 'k1');

  const unverified = register({ services: { agentService: { inspect: async () => ({ status: 'PAUSED_APPROVAL', steps: [] }) } } });
  const blocked = await unverified.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'unverified_observation');

  const failed = register({ services: { agentService: { inspect: async () => ({ status: 'FAILED', steps: [], failure: { code: 'computer_tool_failed', message: '{"error":{"code":"missing_selector"}}' } }) } } });
  const surfaced = await failed.handlers.get('solat:computer-task-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'k1' });
  assert.equal(surfaced.ok, false);
  assert.equal(surfaced.error.code, 'unverified_observation');
  assert.match(surfaced.error.message, /missing_selector/, 'the owner-visible error must keep the real adapter failure');
});

test('computer-task-inspect reads the owner-scoped durable task without mutating it', async () => {
  let inspected = null;
  const terminal = { status: 'NEEDS_CLARIFICATION', summary: 'Sign in manually.' };
  const ipc = register({
    services: {
      computerTaskLoop: {
        inspect(input) { inspected = input; return terminal; },
      },
    },
  });
  const result = await ipc.handlers.get('solat:computer-task-inspect')(null, { sessionId: 's1', taskId: 't1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, terminal);
  assert.deepEqual(inspected, { ownerId: 's1', sessionId: 's1', taskId: 't1' });
});

test('computer-task-approve-and-continue refuses approvals that do not match the pending action', async () => {
  let approved = 0;
  const ipc = register({
    services: {
      agentService: { approve: async () => { approved += 1; return { status: 'APPROVED' }; } },
      computerTaskLoop: { inspect: () => ({ status: 'AWAITING_APPROVAL', pending_action: { action: { idempotency_key: 'real-key' } } }) },
    },
  });
  const mismatch = await ipc.handlers.get('solat:computer-task-approve-and-continue')(null, { sessionId: 's1', taskId: 't1', idempotencyKey: 'other-key', approvalToken: 'token' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'action_mismatch');
  assert.equal(approved, 0);
});

test('interrupted plan report crosses the IPC boundary owner-scoped', async () => {
  const report = { schema_version: 'solat.agent-interrupted.v1', session_id: 's1', plans: [{ plan_id: 'plan_1', tool: 'computer_open_website', status_at_interrupt: 'PAUSED_APPROVAL' }] };
  const ipc = register({ services: { agentService: { collectInterrupted: async value => { assert.equal(value.ownerId, 's1'); return report; } } } });
  const result = await ipc.handlers.get('solat:agent-interrupted-plans')(null, { sessionId: 's1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, report);
});

test('export paths stay inside the owned export root and must be index.html', () => {
  const root = path.join(os.tmpdir(), 'solat-exports');
  const owned = path.join(root, 'deck-1', 'index.html');
  assert.equal(resolveOwnedExportPath(owned, root), path.resolve(owned));
  assert.throws(() => resolveOwnedExportPath('', root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(root, '..', 'elsewhere', 'index.html'), root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(root, 'deck-1', 'manifest.json'), root), error => error.code === 'invalid_export_path');
  assert.throws(() => resolveOwnedExportPath(path.join(os.tmpdir(), 'evil', 'index.html'), root), error => error.code === 'invalid_export_path');
});

test('open-export only opens verified files through the injected shell', async () => {
  const root = path.join(os.tmpdir(), 'solat-exports');
  const htmlPath = path.join(root, 'deck-1', 'index.html');
  let opened = null;
  const ipc = register({
    exportRoot: root,
    shellOpenPath: async requested => { opened = requested; return ''; },
    fsImpl: { stat: async () => ({ isFile: () => true }), readFile: async () => '' },
  });
  const result = await ipc.handlers.get('solat:open-export')(null, { htmlPath });
  assert.equal(result.ok, true);
  assert.equal(opened, path.resolve(htmlPath));

  const blocked = await ipc.handlers.get('solat:open-export')(null, { htmlPath: path.join(root, '..', 'outside', 'index.html') });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'invalid_export_path');
});
