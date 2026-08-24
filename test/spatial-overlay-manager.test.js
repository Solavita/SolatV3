const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SpatialOverlayManager } = require('../src/spatial-overlay-manager');

let nextWebContentsId = 90;
class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.webContents = Object.assign(new EventEmitter(), {
      id: nextWebContentsId++,
      sent: [],
      send(channel, payload) { this.sent.push([channel, payload]); },
    });
    FakeWindow.instances.push(this);
  }
  setAlwaysOnTop() {}
  isDestroyed() { return this.destroyed; }
  show() { this.visible = true; }
  focus() { this.focused = true; }
  async loadFile(file) { this.file = file; if (FakeWindow.failLoad) throw new Error('load failed'); this.webContents.emit('did-finish-load'); }
  close() { this.destroyed = true; this.emit('closed'); }
}
FakeWindow.instances = [];
FakeWindow.failLoad = false;

const owner = () => Object.assign(new EventEmitter(), {
  id: 7,
  sent: [],
  isDestroyed: () => false,
  send(channel, payload) { this.sent.push([channel, payload]); },
});

function create() {
  FakeWindow.instances.length = 0;
  FakeWindow.failLoad = false;
  let time = 1000;
  return new SpatialOverlayManager({
    BrowserWindow: FakeWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 2000, y: 300 }),
      getDisplayNearestPoint: () => ({ id: 2, scaleFactor: 1.5, bounds: { x: 1920, y: 0, width: 1600, height: 900 } }),
    },
    preloadPath: 'spatial-preload.js',
    htmlPath: 'spatial-overlay.html',
    now: () => time += 100,
  });
}

test('spatial overlay opens on the cursor display with isolated renderer settings', async () => {
  const manager = create();
  const result = await manager.open({ sender: owner(), ownerId: 's1', sessionId: 's1', gesture: 'circle' });
  const window = FakeWindow.instances[0];
  assert.equal(result.status, 'opened');
  assert.deepEqual({ x: window.options.x, y: window.options.y, width: window.options.width, height: window.options.height }, { x: 1920, y: 0, width: 1600, height: 900 });
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.visible, true);
  assert.equal(window.webContents.sent[0][0], 'solat:spatial-init');
  assert.equal(window.webContents.sent[0][1].gesture, 'circle');
});

test('spatial overlay never reveals or focuses an active capture for another renderer or session', async () => {
  const manager = create();
  const ownerSender = owner();
  const otherSender = Object.assign(owner(), { id: 8 });
  await manager.open({ sender: ownerSender, ownerId: 'renderer:7', sessionId: 'session-a' });
  const activeWindow = FakeWindow.instances[0];
  await assert.rejects(
    () => manager.open({ sender: otherSender, ownerId: 'renderer:8', sessionId: 'session-a' }),
    error => error.code === 'spatial_capture_forbidden',
  );
  await assert.rejects(
    () => manager.open({ sender: ownerSender, ownerId: 'renderer:7', sessionId: 'session-b' }),
    error => error.code === 'spatial_capture_forbidden',
  );
  const reopened = await manager.open({ sender: ownerSender, ownerId: 'renderer:7', sessionId: 'session-a' });
  assert.equal(reopened.status, 'already_open');
  assert.equal(activeWindow.focused, true);
  assert.ok(reopened.capture_id);
});

test('spatial overlay token binds completion to its isolated renderer and owner session', async () => {
  const manager = create();
  const ownerSender = owner();
  await manager.open({ sender: ownerSender, ownerId: 'owner-a', sessionId: 'session-a', contextId: 'voice-1', gesture: 'lasso' });
  const window = FakeWindow.instances[0];
  const init = window.webContents.sent[0][1];
  await assert.rejects(() => manager.complete({ sender: { id: 999 }, request: { captureId: init.capture_id, token: init.token } }), /does not own/);
  await assert.rejects(() => manager.complete({ sender: window.webContents, request: { captureId: init.capture_id, token: 'wrong' } }), /token is invalid/);
  const captured = await manager.complete({
    sender: window.webContents,
    request: { captureId: init.capture_id, token: init.token, event: { source: 'mouse', gesture: 'lasso', points: [{ x: 10, y: 20, t_ms: 0 }] } },
  });
  assert.deepEqual(captured.scope, { ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(captured.event.context_id, 'voice-1');
  assert.equal(captured.event.display.scale_factor, 1.5);
  assert.equal(window.destroyed, false, 'overlay stays open until core validation commits the event');
  captured.commit({ schema_version: 'solat.spatial-event.v1', event_id: 'e1', gesture: 'lasso', bounds: { x: 10, y: 20, width: 0, height: 0 }, context_id: 'voice-1' });
  assert.equal(window.destroyed, true);
  assert.equal(ownerSender.sent[0][0], 'solat:spatial-event');
});

test('spatial overlay cancel notifies the owning renderer and clears active capture', async () => {
  const manager = create();
  const ownerSender = owner();
  await manager.open({ sender: ownerSender, ownerId: 's1', sessionId: 's1' });
  const window = FakeWindow.instances[0];
  const init = window.webContents.sent[0][1];
  const result = await manager.cancel({ sender: window.webContents, request: { captureId: init.capture_id, token: init.token } });
  assert.equal(result.status, 'cancelled');
  assert.equal(ownerSender.sent[0][1].status, 'cancelled');
  assert.equal(manager.active, null);
});

test('spatial overlay closes when its owner renderer is destroyed', async () => {
  const manager = create();
  const ownerSender = owner();
  await manager.open({ sender: ownerSender, ownerId: 's1', sessionId: 's1' });
  const window = FakeWindow.instances[0];
  assert.equal(ownerSender.listenerCount('destroyed'), 1);
  ownerSender.emit('destroyed');
  assert.equal(window.destroyed, true);
  assert.equal(manager.active, null);
  assert.equal(ownerSender.listenerCount('closed'), 0);
});

test('unexpected spatial overlay close resets the owner control', async () => {
  const manager = create();
  const ownerSender = owner();
  await manager.open({ sender: ownerSender, ownerId: 's1', sessionId: 's1' });
  FakeWindow.instances[0].close();
  assert.equal(manager.active, null);
  assert.equal(ownerSender.sent[0][1].status, 'cancelled');
  assert.equal(ownerSender.sent[0][1].reason, 'overlay_closed');
});

test('spatial overlay load failure clears the active capture visibly', async () => {
  const manager = create();
  FakeWindow.failLoad = true;
  await assert.rejects(() => manager.open({ sender: owner(), ownerId: 's1', sessionId: 's1' }), error => error.code === 'spatial_overlay_load_failed');
  assert.equal(manager.active, null);
  assert.equal(FakeWindow.instances[0].destroyed, true);
});

test('spatial overlay times out, notifies its owner, and releases listeners', async () => {
  let timeoutCallback;
  const cleared = [];
  FakeWindow.instances.length = 0;
  FakeWindow.failLoad = false;
  const screen = Object.assign(new EventEmitter(), {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }),
  });
  const manager = new SpatialOverlayManager({
    BrowserWindow: FakeWindow,
    screen,
    preloadPath: 'spatial-preload.js',
    htmlPath: 'spatial-overlay.html',
    setTimeoutFn(callback, delay) { assert.equal(delay, 120000); timeoutCallback = callback; return { id: 1 }; },
    clearTimeoutFn(handle) { cleared.push(handle.id); },
  });
  const ownerSender = owner();
  await manager.open({ sender: ownerSender, ownerId: 'owner-a', sessionId: 'session-a' });
  timeoutCallback();
  assert.equal(manager.active, null);
  assert.equal(FakeWindow.instances[0].destroyed, true);
  assert.equal(ownerSender.sent[0][1].reason, 'capture_timeout');
  assert.deepEqual(cleared, [1]);
  assert.equal(screen.listenerCount('display-removed'), 0);
  assert.equal(ownerSender.listenerCount('destroyed'), 0);
});
