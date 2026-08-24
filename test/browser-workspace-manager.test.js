const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { BrowserWorkspaceManager, installAssetSelectionScript, readAssetSelectionScript, sensitiveSurfaceScript } = require('../src/browser-workspace-manager');

let nextId = 200;
class FakeWebContents extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = nextId++;
    this.options = options;
    this.url = '';
    this.title = 'Fixture';
    this.sent = [];
    this.results = [];
    this.navigationHistory = { canGoBack: () => true, canGoForward: () => true, goBack: () => { this.historyAction = 'back'; }, goForward: () => { this.historyAction = 'forward'; } };
    this.session = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: handler => { this.permissionRequestHandler = handler; },
      setPermissionCheckHandler: handler => { this.permissionCheckHandler = handler; },
      getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/43.3.0 Safari/537.36',
      webRequest: { onBeforeRequest: (...args) => { this.beforeRequestHandler = args.at(-1); } },
    });
  }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  setUserAgent(value) { this.userAgent = value; }
  async loadURL(url) {
    this.url = url;
    this.emit('did-start-navigation', {}, url, false, true);
    this.emit('did-finish-load');
  }
  async capturePage(rect) {
    this.captureRect = rect;
    if (!this.captureImage) throw new Error('capture not configured');
    return this.captureImage;
  }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  reload() { this.reloaded = true; }
  send(channel, payload) { this.sent.push([channel, payload]); }
  async executeJavaScriptInIsolatedWorld(_worldId, scripts) {
    if (String(scripts?.[0]?.code || '').includes('input[type="password"]')) return this.sensitiveSurface === true;
    return this.results.shift();
  }
}

class FakeNativeImage {
  constructor(width = 640, height = 360, bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])) {
    this.width = width;
    this.height = height;
    this.bytes = bytes;
    this.resizes = [];
  }
  getSize() { return { width: this.width, height: this.height }; }
  resize({ width, height }) {
    this.resizes.push({ width, height });
    return new FakeNativeImage(width, height, this.bytes);
  }
  toPNG() { return this.bytes; }
}

class FakeView {
  constructor(options) { this.options = options; this.webContents = new FakeWebContents(options.webPreferences); FakeView.instances.push(this); }
  setBounds(bounds) { this.bounds = bounds; }
  getBounds() { return this.bounds; }
}
FakeView.instances = [];

class FakeWindow extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.destroyed = false; this.webContents = new FakeWebContents(options.webPreferences);
    this.contentView = { addChildView: view => { this.view = view; } };
    FakeWindow.instances.push(this);
  }
  async loadFile(file) { this.file = file; }
  getContentSize() { return [this.options.width, this.options.height]; }
  isDestroyed() { return this.destroyed; }
  show() { this.visible = true; }
  focus() { this.focused = true; }
  close() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
}
FakeWindow.instances = [];

function sender(id = 7) {
  return Object.assign(new EventEmitter(), { id, sent: [], isDestroyed: () => false, send(channel, payload) { this.sent.push([channel, payload]); } });
}

function create(options = {}) {
  FakeView.instances.length = 0; FakeWindow.instances.length = 0;
  let id = 0;
  return new BrowserWorkspaceManager({
    BrowserWindow: FakeWindow, WebContentsView: FakeView,
    shellPath: 'browser-workspace.html', shellPreloadPath: 'browser-workspace-preload.js',
    idFactory: () => `fixed-${++id}`, now: () => 1234, ...options,
  });
}

test('login, OAuth and QR-login routes are private before any credential field is inspected', () => {
  const run = (pathname, matchedSelector = false) => vm.runInNewContext(sensitiveSurfaceScript(), {
    location: { pathname },
    document: { querySelector: () => (matchedSelector ? {} : null) },
  });
  assert.equal(run('/login/'), true);
  assert.equal(run('/oauth/authorize'), true);
  assert.equal(run('/challenge/qr'), true);
  assert.equal(run('/ideas/'), false);
  assert.equal(run('/ideas/', true), true);
});

test('browser workspace isolates the remote page and denies popup permission and download', async () => {
  const manager = create();
  const owner = sender();
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://www.canva.com/', mode: 'focused' } });
  const shell = FakeWindow.instances[0];
  const remote = FakeView.instances[0];
  assert.equal(opened.status, 'ready');
  assert.equal(shell.options.webPreferences.contextIsolation, true);
  assert.equal(shell.options.webPreferences.nodeIntegration, false);
  assert.equal(shell.options.webPreferences.sandbox, true);
  assert.equal(remote.options.webPreferences.contextIsolation, true);
  assert.equal(remote.options.webPreferences.nodeIntegration, false);
  assert.equal(remote.options.webPreferences.sandbox, true);
  assert.equal(remote.options.webPreferences.preload, undefined);
  assert.match(remote.options.webPreferences.partition, /^persist:solat-browser-v3-/u);
  assert.equal(remote.options.webPreferences.devTools, false);
  assert.equal(remote.webContents.userAgent, undefined, 'the embedded browser must not disguise itself to bypass OAuth policy');
  assert.deepEqual(remote.webContents.windowOpenHandler({ url: 'https://login.example.com/' }), { action: 'deny' });
  assert.equal(remote.webContents.permissionCheckHandler(), false);
  let permission;
  remote.webContents.permissionRequestHandler(null, 'camera', value => { permission = value; });
  assert.equal(permission, false);
  let publicRequest; remote.webContents.beforeRequestHandler({ url: 'https://cdn.example.com/app.js', resourceType: 'mainFrame' }, value => { publicRequest = value; });
  assert.deepEqual(publicRequest, { cancel: false });
  let privateRequest; remote.webContents.beforeRequestHandler({ url: 'http://127.0.0.1/private', resourceType: 'mainFrame' }, value => { privateRequest = value; });
  assert.deepEqual(privateRequest, { cancel: true });
  let prevented = false;
  remote.webContents.session.emit('will-download', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('user control enables sandboxed public popups and downloads without exposing an agent popup path', async () => {
  const manager = create();
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  await manager.takeover({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  const popup = remote.windowOpenHandler({ url: 'https://accounts.example.com/login' });
  assert.equal(popup.action, 'allow');
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.partition, remote.options.partition);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  const child = new FakeWindow(popup.overrideBrowserWindowOptions);
  remote.emit('did-create-window', child);
  const held = await manager.returnControl({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  assert.equal(held.control, 'user');
  assert.equal(held.popup, 'open');
  let prevented = false;
  remote.session.emit('will-download', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  child.close();
  assert.equal((await manager.returnControl({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } })).control, 'agent');
  assert.deepEqual(remote.windowOpenHandler({ url: 'https://accounts.example.com/login' }), { action: 'deny' });
});

test('Google OAuth is handed to real Chrome without copying OAuth state or browser credentials', async () => {
  const openedInChrome = [];
  const manager = create({ openInChrome: async url => { openedInChrome.push(url); } });
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-google', url: 'https://www.pinterest.com/' } });
  const remote = FakeView.instances[0].webContents;
  await manager.takeover({ ownerId: 'renderer:7', request: { sessionId: 'thread-google', surfaceId: opened.surface_id } });
  assert.deepEqual(remote.windowOpenHandler({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=private-state' }), { action: 'deny' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(openedInChrome, ['https://www.pinterest.com/']);
  assert.equal(manager.status({ ownerId: 'renderer:7', request: { sessionId: 'thread-google', surfaceId: opened.surface_id } }).external_auth, 'chrome_google');
  assert.equal(openedInChrome.some(url => /client_id|oauth|accounts\.google/iu.test(url)), false);
});

test('Open in Chrome uses only the current public page and leaves direct control with the owner', async () => {
  const openedInChrome = [];
  const manager = create({ openInChrome: async url => { openedInChrome.push(url); } });
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-chrome', url: 'https://example.com/docs' } });
  const result = await manager.shellCommand(FakeWindow.instances[0].webContents, { action: 'open_chrome' });
  assert.deepEqual(openedInChrome, ['https://example.com/docs']);
  assert.equal(result.control, 'user');
  assert.equal(result.external_auth, 'chrome');
});

test('password and one-time-code surfaces keep user control and close every SOLAT observation path', async () => {
  const manager = create();
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-private', url: 'https://accounts.example.com/' } });
  const remote = FakeView.instances[0].webContents;
  remote.sensitiveSurface = true;
  await manager.takeover({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id } });
  const returned = await manager.returnControl({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id } });
  assert.equal(returned.control, 'user');
  assert.equal(returned.privacy, 'shielded');
  await assert.rejects(() => manager.observe({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id } }), error => error.code === 'user_takeover_active');
  await assert.rejects(() => manager.visualObserve({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id, navigationRevision: opened.navigation_revision } }), error => error.code === 'user_takeover_active');
  assert.throws(() => manager.getVisualCapture({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id, navigationRevision: opened.navigation_revision } }), error => error.code === 'browser_sensitive_surface');
  remote.sensitiveSurface = false;
  assert.equal((await manager.returnControl({ ownerId: 'renderer:7', request: { sessionId: 'thread-private', surfaceId: opened.surface_id } })).control, 'agent');
});

test('browser workspace ownership and navigation revision reject cross-renderer and stale actions', async () => {
  const manager = create();
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  await assert.rejects(() => manager.open({ sender: sender(8), ownerId: 'renderer:8', request: { sessionId: 'thread-a', url: 'https://example.com/' } }), error => error.code === 'browser_workspace_forbidden');
  const remote = FakeView.instances[0].webContents;
  remote.results.push({ title: 'Fixture', item_count: 1, truncated: false, items: [{ target_id: 'e1', role: 'button', name: 'Go', disabled: false, editable: false, bounds: { x: 1, y: 2, width: 3, height: 4 } }] });
  const observation = await manager.observe({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  assert.equal(observation.navigation_revision, 1);
  await remote.loadURL('https://example.com/next');
  await assert.rejects(() => manager.act({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: 1, targetId: 'e1', action: 'click', verify: 'navigation' } }), error => error.code === 'stale_target');
  assert.throws(() => manager.status({ ownerId: 'renderer:8', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } }), error => error.code === 'browser_workspace_forbidden');
});

test('browser login profile remains stable when the Electron renderer owner changes', async () => {
  const first = create({ profileId: 'local-owner-profile' });
  const opened = await first.open({ sender: sender(71), ownerId: 'renderer:71', request: { sessionId: 'thread-one', url: 'https://example.com/' } });
  const firstPartition = FakeView.instances[0].options.webPreferences.partition;
  first.close({ ownerId: 'renderer:71', request: { sessionId: 'thread-one', surfaceId: opened.surface_id } });
  const second = create({ profileId: 'local-owner-profile' });
  await second.open({ sender: sender(92), ownerId: 'renderer:92', request: { sessionId: 'thread-two', url: 'https://example.com/' } });
  assert.equal(FakeView.instances[0].options.webPreferences.partition, firstPartition);
  assert.match(firstPartition, /^persist:/u);
});

test('browser workspace blocks unsafe redirects and takeover prevents autonomous actions', async () => {
  let takeover;
  const manager = create({ onTakeover: async value => { takeover = value; } });
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  let prevented = false;
  remote.emit('will-navigate', { preventDefault() { prevented = true; } }, 'file:///C:/secret.txt');
  assert.equal(prevented, true);
  const state = await manager.takeover({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  assert.equal(state.control, 'user');
  assert.deepEqual(takeover, { ownerId: 'renderer:7', sessionId: 'thread-a', surfaceId: opened.surface_id });
  await assert.rejects(() => manager.act({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: 1, targetId: 'e1', action: 'scroll_into_view' } }), error => error.code === 'user_takeover_active');
  assert.equal((await manager.returnControl({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } })).control, 'agent');
});

test('browser toolbar is bound to its local shell and user navigation takes control first', async () => {
  const takeovers = [];
  const manager = create({ onTakeover: async value => { takeovers.push(value); } });
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const shell = FakeWindow.instances[0].webContents;
  const remote = FakeView.instances[0].webContents;
  await assert.rejects(() => manager.shellCommand(owner, { action: 'reload' }), error => error.code === 'browser_workspace_forbidden');
  const result = await manager.shellCommand(shell, { action: 'navigate', url: 'https://www.canva.com/' });
  assert.equal(result.control, 'user');
  assert.equal(remote.getURL(), 'https://www.canva.com/');
  assert.equal(takeovers.length, 1);
  await manager.shellCommand(shell, { action: 'navigate', url: 'persona 3 blue interface' });
  assert.equal(remote.getURL(), 'https://www.google.com/search?q=persona%203%20blue%20interface');
  await manager.shellCommand(shell, { action: 'back' });
  assert.equal(remote.historyAction, 'back');
});

test('Alt-selected browser visual becomes one bounded SpatialAsset capture without mutating the page', async () => {
  let selected;
  const manager = create({ onAssetSelected: async value => {
    selected = value;
    return { spatial_asset_id: 'spatial-browser-1', ghost_id: 'ghost-browser-1' };
  } });
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  remote.results.push({ label: 'Reference image', tag: 'img', bounds: { x: 10, y: 20, width: 120, height: 80 } });
  remote.captureImage = new FakeNativeImage(120, 80);
  const result = await manager.shellCommand(FakeWindow.instances[0].webContents, { action: 'select_asset' });
  assert.equal(result.status, 'held');
  assert.deepEqual(remote.captureRect, { x: 10, y: 20, width: 120, height: 80 });
  assert.equal(selected.ownerId, 'renderer:7');
  assert.equal(selected.sessionId, 'thread-a');
  assert.equal(selected.selection.page_url, 'https://example.com/');
  assert.equal(selected.capture.media_type, 'image/png');
  assert.equal(selected.capture.bytes[0], 137);
  assert.equal(remote.results.length, 0);
});

test('isolated-world Alt selection records a reference without changing source element attributes or style', () => {
  let pointerListener;
  const element = {
    tagName: 'IMG', alt: 'Original reference', src: 'https://cdn.example.com/a.png', currentSrc: 'https://cdn.example.com/a.png', isConnected: true,
    attributes: { alt: 'Original reference' }, style: { cssText: '' },
    closest: () => element,
    getBoundingClientRect: () => ({ x: 10.2, y: 20.3, width: 120.1, height: 80.2 }),
    getAttribute: name => element.attributes[name] || '',
  };
  const document = { addEventListener: (type, listener) => { if (type === 'pointerdown') pointerListener = listener; } };
  const context = vm.createContext({ window: {}, document, String, Math, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  const before = JSON.stringify({ attributes: element.attributes, style: element.style });
  vm.runInContext(installAssetSelectionScript(), context);
  let prevented = 0; let stopped = 0;
  pointerListener({ altKey: true, target: element, preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; }, stopImmediatePropagation: () => { stopped += 1; } });
  const selected = vm.runInContext(readAssetSelectionScript(), context);
  assert.equal(selected.tag, 'img'); assert.equal(selected.label, 'Original reference');
  assert.deepEqual(JSON.parse(JSON.stringify(selected.bounds)), { x: 10, y: 20, width: 121, height: 81 });
  assert.equal(prevented, 1); assert.equal(stopped, 2);
  assert.equal(JSON.stringify({ attributes: element.attributes, style: element.style }), before);
});

test('browser selection fails stale when navigation changes between element read and pixel capture', async () => {
  let adopted = 0;
  const manager = create({ onAssetSelected: async () => { adopted += 1; return { spatial_asset_id: 'never', ghost_id: 'never' }; } });
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  remote.results.push({ label: 'Reference image', tag: 'img', bounds: { x: 10, y: 20, width: 120, height: 80 } });
  remote.capturePage = async rect => {
    remote.captureRect = rect;
    await remote.loadURL('https://example.com/next');
    return new FakeNativeImage(120, 80);
  };
  await assert.rejects(() => manager.shellCommand(FakeWindow.instances[0].webContents, { action: 'select_asset' }), error => error.code === 'stale_target');
  assert.equal(adopted, 0);
});

test('browser workspace closes with its renderer owner and releases download listener', async () => {
  const manager = create();
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remoteSession = FakeView.instances[0].webContents.session;
  assert.equal(remoteSession.listenerCount('will-download'), 1);
  owner.emit('destroyed');
  assert.equal(FakeWindow.instances[0].destroyed, true);
  assert.equal(remoteSession.listenerCount('will-download'), 0);
  assert.equal(manager.active, null);
});

test('browser visual observation captures one bounded PNG bound to surface and navigation revision', async () => {
  const manager = create();
  const owner = sender(7);
  const opened = await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  remote.captureImage = new FakeNativeImage(4000, 3000);
  await assert.rejects(() => manager.visualObserve({ ownerId: 'renderer:7', request: {
    sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: opened.navigation_revision,
  } }), error => error.code === 'browser_visual_requires_semantic_observation');
  remote.results.push({ title: 'Canvas fixture', item_count: 0, truncated: false, canvas_count: 1, semantic_empty: true, canvas_only: true, visual_fallback_required: true, items: [] });
  await manager.observe({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  const visual = await manager.visualObserve({ ownerId: 'renderer:7', request: {
    sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: opened.navigation_revision,
  } });
  assert.equal(visual.schema_version, 'solat.browser-visual-observation.v1');
  assert.equal(visual.verified, true);
  assert.equal(visual.navigation_revision, 1);
  assert.ok(visual.width <= 1920);
  assert.ok(visual.height <= 1920);
  assert.match(visual.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.hasOwn(visual, 'bytes'), false);
  const capture = manager.getVisualCapture({ ownerId: 'renderer:7', request: {
    sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: 1,
    captureId: visual.capture_id, captureSha256: visual.sha256,
  } });
  assert.equal(capture.metadata.surface_id, opened.surface_id);
  assert.equal(capture.metadata.navigation_revision, 1);
  assert.ok(Buffer.isBuffer(capture.bytes));
  await remote.loadURL('https://example.com/next');
  assert.throws(() => manager.getVisualCapture({ ownerId: 'renderer:7', request: {
    sessionId: 'thread-a', surfaceId: opened.surface_id, navigationRevision: 1,
    captureId: visual.capture_id, captureSha256: visual.sha256,
  } }), error => error.code === 'browser_visual_capture_stale');
});

test('browser workspace fusion callback is best-effort and receives only owner/session/type/sanitized surface', async () => {
  const events = [];
  const manager = create({ onEvent: value => { events.push(value); throw new Error('telemetry must not break the workspace'); } });
  const owner = sender(7);
  await manager.open({ sender: owner, ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  const remote = FakeView.instances[0].webContents;
  remote.results.push({ title: 'Fixture', item_count: 1, truncated: false, items: [{ target_id: 'e1', role: 'button', name: 'Go', disabled: false, editable: false, bounds: { x: 1, y: 2, width: 3, height: 4 } }] });
  const surfaceId = events[0].surface.surface_id;
  await manager.observe({ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId } });
  assert.ok(events.length >= 2);
  for (const event of events) {
    const expected = event.type === 'screen_observed'
      ? ['observation_kind', 'observation_revision', 'ownerId', 'sessionId', 'surface', 'type']
      : ['ownerId', 'sessionId', 'surface', 'type'];
    assert.deepEqual(Object.keys(event).sort(), expected.sort());
    assert.equal(event.ownerId, 'renderer:7');
    assert.equal(event.sessionId, 'thread-a');
    assert.equal(Object.hasOwn(event, 'items'), false);
    assert.equal(Object.hasOwn(event, 'reason'), false);
  }
  assert.equal(events.at(-1).type, 'screen_observed');
});
