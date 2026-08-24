const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');
const { ChromeControlManager, EXTENSION_ORIGIN } = require('../src/chrome-control-manager');

class Sender extends EventEmitter {
  constructor() { super(); this.events = []; }
  isDestroyed() { return false; }
  send(channel, value) { this.events.push([channel, value]); }
}

async function setup(t) {
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-chrome-control-'));
  let pairUrl;
  const manager = new ChromeControlManager({ userDataDir, port: 0, requestTimeoutMs: 1000, openChromeUrl: async value => { pairUrl = value; } });
  await manager.start(); await manager.pair();
  const parsed = new URL(pairUrl); const fragment = new URLSearchParams(parsed.hash.slice(1));
  const socket = new WebSocket(fragment.get('endpoint'), { origin: EXTENSION_ORIGIN });
  const commands = [];
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello', token: fragment.get('token') }));
  await new Promise((resolve, reject) => {
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ready') return resolve();
      if (message.type !== 'command') return;
      commands.push(message);
      let value;
      if (message.command === 'open') value = { tab_id: '7', url: message.url, title: 'Example', status: 'complete', revision: 1 };
      else if (message.command === 'status') value = { tab_id: '7', url: 'https://example.com/', title: 'Example', status: 'complete', revision: 1, privacy: 'standard' };
      else if (message.command === 'observe') value = { tab_id: '7', url: 'https://example.com/', title: 'Example', status: 'complete', revision: 1, privacy: 'standard', items: [{ target_id: 'opaque-a', role: 'button', name: 'Go' }] };
      else if (message.command === 'list_tabs') value = { tabs: [
        { tab_id: '7', url: 'https://example.com/', title: 'Example', status: 'complete', revision: 1, privacy: 'clear', active: true },
        { tab_id: '8', url: '', title: '', status: 'complete', revision: 2, privacy: 'shielded', active: false },
      ] };
      else if (message.command === 'switch_tab') value = message.tab_id === '8'
        ? { tab_id: '8', url: '', title: '', status: 'complete', revision: 2, privacy: 'shielded' }
        : { tab_id: '7', url: 'https://example.com/', title: 'Example', status: 'complete', revision: 1, privacy: 'clear', active: true };
      else if (message.command === 'close') value = { closed: true };
      else return reject(new Error(`Unexpected command ${message.command}`));
      socket.send(JSON.stringify({ type: 'response', request_id: message.request_id, ok: true, value }));
    });
  });
  t.after(async () => { socket.close(); await manager.dispose(); await fs.promises.rm(userDataDir, { recursive: true, force: true }); });
  return { manager, socket, commands, userDataDir, token: fragment.get('token') };
}

test('Chrome Control pairs explicitly without exposing its persistent secret in status', async t => {
  const { manager, userDataDir, token } = await setup(t);
  assert.deepEqual(manager.statusSummary(), { available: true, connected: true, full_control: true, extension_id: 'eokiajfkblbchdnjobacdbddjdllkeca' });
  assert.equal(JSON.stringify(manager.statusSummary()).includes(token), false);
  const persisted = (await fs.promises.readFile(path.join(userDataDir, 'chrome-control-secret'), 'utf8')).trim();
  assert.equal(persisted, token);
});

test('Full Chrome tab discovery uses opaque owner-session refs and hides private metadata', async t => {
  const { manager } = await setup(t); const sender = new Sender(); manager.registerOwner('renderer:1', sender);
  const listed = await manager.listTabsForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-a' } });
  assert.equal(listed.schema_version, 'solat.chrome-tab-list.v1');
  assert.equal(listed.full_control, true); assert.equal(listed.tabs.length, 2);
  assert.match(listed.tabs[0].tab_ref, /^chrome_tab_/u); assert.equal(JSON.stringify(listed).includes('"tab_id"'), false);
  assert.equal(listed.tabs[0].controllable, true); assert.equal(listed.tabs[0].url, 'https://example.com/');
  assert.equal(listed.tabs[1].privacy, 'shielded'); assert.equal(listed.tabs[1].controllable, false);
  assert.equal(Object.hasOwn(listed.tabs[1], 'url'), false); assert.equal(Object.hasOwn(listed.tabs[1], 'title'), false);
  await assert.rejects(() => manager.switchTabForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-b', tabRef: listed.tabs[0].tab_ref } }), error => error.code === 'browser_workspace_forbidden');
  const surface = await manager.switchTabForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', tabRef: listed.tabs[0].tab_ref } });
  assert.equal(surface.profile, 'chrome_full_control'); assert.equal(surface.verified, true);
  await assert.rejects(() => manager.switchTabForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', tabRef: listed.tabs[1].tab_ref } }), error => error.code === 'browser_sensitive_surface');
});

test('Chrome Control rejects every WebSocket origin except the audited extension', async t => {
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'solat-chrome-origin-'));
  const manager = new ChromeControlManager({ userDataDir, port: 0 }); await manager.start();
  t.after(async () => { await manager.dispose(); await fs.promises.rm(userDataDir, { recursive: true, force: true }); });
  const address = manager.server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const outcome = await new Promise(resolve => { socket.once('open', () => resolve('opened')); socket.once('error', () => resolve('rejected')); socket.once('unexpected-response', () => resolve('rejected')); });
  assert.equal(outcome, 'rejected'); assert.equal(manager.statusSummary().connected, false);
});

test('Chrome surfaces use opaque ids and enforce owner plus session isolation', async t => {
  const { manager } = await setup(t); const sender = new Sender(); manager.registerOwner('renderer:1', sender);
  const opened = await manager.openForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  assert.match(opened.surface_id, /^chrome_[0-9a-f-]{20,}$/u); assert.notEqual(opened.surface_id, 'chrome_7');
  await assert.rejects(() => manager.status({ ownerId: 'renderer:2', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } }), error => error.code === 'browser_workspace_forbidden');
  await assert.rejects(() => manager.status({ ownerId: 'renderer:1', request: { sessionId: 'thread-b', surfaceId: opened.surface_id } }), error => error.code === 'browser_workspace_forbidden');
  const observed = await manager.observe({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  assert.equal(observed.items[0].target_id, 'opaque-a'); assert.equal(observed.trust, 'untrusted_remote_page_data');
});

test('Chrome Control fails closed when extension reports a private page', async t => {
  const { manager, socket } = await setup(t); const sender = new Sender(); manager.registerOwner('renderer:1', sender);
  const opened = await manager.openForOwner({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', url: 'https://example.com/' } });
  socket.removeAllListeners('message');
  socket.on('message', raw => {
    const message = JSON.parse(String(raw)); if (message.type !== 'command') return;
    socket.send(JSON.stringify({ type: 'response', request_id: message.request_id, ok: true, value: { tab_id: '7', url: 'https://example.com/login', title: '', status: 'complete', revision: 2, privacy: 'shielded' } }));
  });
  await assert.rejects(() => manager.observe({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } }), error => error.code === 'browser_sensitive_surface');
  const status = await manager.status({ ownerId: 'renderer:1', request: { sessionId: 'thread-a', surfaceId: opened.surface_id } });
  assert.equal(status.privacy, 'shielded'); assert.equal(status.control, 'user'); assert.equal(status.title, '');
});
