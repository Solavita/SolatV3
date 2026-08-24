(() => {
  'use strict';
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
  const MAX_SOCKET_MESSAGE_CHARACTERS = 12 * 1024 * 1024;
  const MAX_COMMAND_CHARACTERS = 128 * 1024;
  const MAX_TAB_PAGE = 100;
  let socket = null;
  let authenticated = false;
  let reconnectTimer = null;
  const revisions = new Map();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const revision = tabId => revisions.get(tabId) || 1;
  const bump = tabId => revisions.set(tabId, revision(tabId) + 1);

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) {
      bump(tabId);
      // A page replacement must never inherit the SOLAT cursor while its
      // privacy state is still unknown. The completion handler below will
      // re-enable it only after a fresh public-page check.
      void setTabIndicator(tabId, false);
    }
    if (change.status === 'complete' && authenticated) void syncIndicatorForTab(tabId);
  });
  chrome.tabs.onRemoved.addListener(tabId => revisions.delete(tabId));

  chrome.tabs.onCreated.addListener(tab => {
    if (authenticated) void syncIndicatorForTab(tab.id);
  });

  async function configuration() {
    const value = await chrome.storage.local.get(['solatEndpoint', 'solatToken']);
    return value.solatEndpoint && value.solatToken ? value : null;
  }

  function send(value) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_SOCKET_MESSAGE_CHARACTERS) socket.send(serialized);
  }

  function validPairing(endpoint, token) {
    try {
      const url = new URL(String(endpoint || ''));
      return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && /^\/[a-z0-9/_-]*$/iu.test(url.pathname)
        && !url.username && !url.password && !url.search && !url.hash
        && /^[A-Za-z0-9_-]{32,128}$/u.test(String(token || ''));
    } catch { return false; }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void connect(), 1500);
  }

  async function connect() {
    const config = await configuration();
    if (!config) {
      authenticated = false;
      void disableIndicators();
      return;
    }
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    authenticated = false;
    void disableIndicators();
    const nextSocket = new WebSocket(config.solatEndpoint);
    socket = nextSocket;
    nextSocket.addEventListener('open', () => send({ type: 'hello', token: config.solatToken, extension_version: chrome.runtime.getManifest().version }));
    nextSocket.addEventListener('message', event => void onSocketMessage(event));
    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) return;
      socket = null;
      authenticated = false;
      void disableIndicators();
      scheduleReconnect();
    });
    nextSocket.addEventListener('error', () => nextSocket.close());
  }

  async function waitForTab(tabId, { complete = false, timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId);
      if (!complete || tab.status === 'complete') return tab;
      await sleep(100);
    }
    throw Object.assign(new Error('Chrome navigation timed out.'), { code: 'browser_navigation_timeout' });
  }

  async function content(tabId, message) {
    let response;
    try { response = await chrome.tabs.sendMessage(tabId, message); }
    catch { throw Object.assign(new Error('This Chrome page cannot be controlled.'), { code: 'chrome_page_unsupported' }); }
    if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'Chrome content action failed.'), { code: response?.error?.code || 'chrome_content_error' });
    return response.value;
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw Object.assign(new Error('No active Chrome tab is available.'), { code: 'chrome_tab_unavailable' });
    return tab;
  }

  async function normalTabs() {
    // `tabs.query({ currentWindow: true })` misses every other normal
    // window. Ask Chrome for all normal windows, then query the complete tab
    // set so this remains correct even if populate is disabled by a browser
    // implementation or test harness.
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    const normalWindowIds = new Set(windows.filter(window => window?.type === 'normal').map(window => window.id));
    if (!normalWindowIds.size) return [];
    const tabs = await chrome.tabs.query({});
    return tabs.filter(tab => normalWindowIds.has(tab.windowId)).map(tab => ({ ...tab, _solatWindowType: 'normal' }));
  }

  async function setTabIndicator(tabId, enabled) {
    if (!Number.isSafeInteger(Number(tabId)) || Number(tabId) <= 0) return;
    try {
      await chrome.tabs.sendMessage(Number(tabId), { command: 'control_indicator', enabled: Boolean(enabled) });
    } catch {}
  }

  async function isNormalTab(tab) {
    if (tab?._solatWindowType) return tab._solatWindowType === 'normal';
    try {
      const window = await chrome.windows.get(tab?.windowId);
      return window?.type === 'normal';
    } catch { return false; }
  }

  async function syncIndicatorForTab(tabId) {
    if (!authenticated) {
      await setTabIndicator(tabId, false);
      return;
    }
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return; }
    if (!(await isNormalTab(tab))) {
      await setTabIndicator(tabId, false);
      return;
    }
    const state = await safeTab(tab);
    // Authentication may have ended while the status request was in flight.
    await setTabIndicator(tabId, authenticated && state.privacy === 'clear');
  }

  async function syncIndicators() {
    let tabs;
    try { tabs = await normalTabs(); } catch { return; }
    await Promise.all(tabs.map(tab => syncIndicatorForTab(tab.id)));
  }

  async function disableIndicators() {
    let tabs;
    try { tabs = await normalTabs(); } catch { return; }
    await Promise.all(tabs.map(tab => setTabIndicator(tab.id, false)));
  }

  function publicTab(tab) {
    return {
      tab_id: String(tab.id), window_id: String(tab.windowId),
      url: String(tab.url || '').slice(0, 2048), title: String(tab.title || '').slice(0, 300),
      revision: revision(tab.id), status: tab.status || 'loading', active: Boolean(tab.active),
      index: Number.isSafeInteger(tab.index) ? tab.index : undefined,
    };
  }

  function shieldedTab(tab) {
    return {
      tab_id: String(tab.id), window_id: String(tab.windowId), revision: revision(tab.id),
      status: tab.status || 'loading', privacy: 'shielded', url: '', title: '', active: Boolean(tab.active),
    };
  }

  async function safeTab(tab) {
    if (tab?.incognito) {
      void setTabIndicator(tab?.id, false);
      return shieldedTab(tab);
    }
    if (!(await isNormalTab(tab))) {
      void setTabIndicator(tab?.id, false);
      return { ...shieldedTab(tab), privacy: 'unsupported' };
    }
    try {
      const state = await content(tab.id, { command: 'status' });
      if (state.privacy === 'shielded') {
        void setTabIndicator(tab.id, false);
        return shieldedTab(tab);
      }
      return { ...publicTab(tab), privacy: 'clear', title: state.title || publicTab(tab).title };
    } catch {
      void setTabIndicator(tab?.id, false);
      return { ...shieldedTab(tab), privacy: 'unsupported' };
    }
  }

  async function execute(command) {
    const name = String(command.command || '');
    if (name === 'active_tab') return safeTab(await activeTab());
    if (name === 'list_tabs') {
      const tabs = await normalTabs();
      const offset = Number.isSafeInteger(Number(command.offset)) ? Math.max(0, Number(command.offset)) : 0;
      const requestedLimit = Number.isSafeInteger(Number(command.limit)) ? Number(command.limit) : MAX_TAB_PAGE;
      const limit = Math.max(1, Math.min(MAX_TAB_PAGE, requestedLimit));
      const page = tabs.slice(offset, offset + limit);
      const nextOffset = offset + page.length < tabs.length ? offset + page.length : null;
      return {
        tabs: await Promise.all(page.map(safeTab)),
        total_count: tabs.length,
        next_offset: nextOffset,
      };
    }
    if (name === 'open') {
      const tab = await chrome.tabs.create({ url: command.url, active: true });
      revisions.set(tab.id, 1);
      return safeTab(await waitForTab(tab.id, { complete: true }));
    }
    const tabId = Number(command.tab_id);
    if (!Number.isSafeInteger(tabId) || tabId <= 0) throw Object.assign(new Error('Chrome tab id is invalid.'), { code: 'chrome_tab_unavailable' });
    if (name === 'close') { await chrome.tabs.remove(tabId); return { closed: true, tab_id: String(tabId) }; }
    if (name === 'switch_tab') {
      // Privacy is checked while the tab is still inactive. Activating first
      // would expose an authentication/payment/CAPTCHA surface to SOLAT and
      // would also briefly move the owner's focus to a forbidden tab.
      const checked = await safeTab(await chrome.tabs.get(tabId));
      if (checked.privacy !== 'clear') throw Object.assign(new Error('Private or unsupported Chrome tabs stay under human control.'), { code: 'browser_sensitive_surface' });
      const selected = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(selected.windowId, { focused: true });
      const activated = await safeTab(await chrome.tabs.get(tabId));
      if (activated.privacy !== 'clear') throw Object.assign(new Error('Chrome became private before control was established.'), { code: 'browser_sensitive_surface' });
      return activated;
    }
    if (name === 'navigate') {
      await chrome.tabs.update(tabId, { url: command.url, active: true });
      return safeTab(await waitForTab(tabId, { complete: true }));
    }
    const tab = await waitForTab(tabId);
    if (name === 'status') {
      const state = await content(tabId, { command: 'status' });
      return state.privacy === 'shielded'
        ? shieldedTab(tab)
        : { ...publicTab(tab), privacy: 'clear', title: state.title || publicTab(tab).title };
    }
    if (name === 'observe') {
      const observed = await content(tabId, { command: 'observe', revision: revision(tabId) });
      return observed.privacy === 'shielded' ? { ...shieldedTab(tab), items: [] } : { ...publicTab(tab), ...observed };
    }
    if (name === 'click') {
      const before = revision(tabId);
      let result;
      try { result = await content(tabId, { command: 'click', revision: command.revision, target_id: command.target_id }); }
      catch (error) {
        if (command.verify !== 'navigation') throw error;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && revision(tabId) === before) await sleep(100);
        if (revision(tabId) === before) throw error;
        result = { clicked: true, document_replaced: true };
      }
      if (command.verify === 'navigation') {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && revision(tabId) === before) await sleep(100);
        if (revision(tabId) === before) throw Object.assign(new Error('Click did not produce verified navigation.'), { code: 'verification_failed' });
      } else if (!result.target_gone) {
        throw Object.assign(new Error('Clicked target did not disappear.'), { code: 'verification_failed' });
      }
      return { ...result, revision: revision(tabId) };
    }
    if (name === 'fill') return content(tabId, { command: 'fill', revision: command.revision, target_id: command.target_id, value: command.value });
    if (name === 'scroll') return content(tabId, { command: 'scroll', revision: command.revision, target_id: command.target_id });
    if (name === 'asset') return content(tabId, { command: 'asset', revision: command.revision, target_id: command.target_id });
    if (name === 'screenshot') {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      const captureRevision = revision(tabId);
      const state = await content(tabId, { command: 'status' });
      if (state.privacy === 'shielded') throw Object.assign(new Error('Private authentication surface.'), { code: 'browser_sensitive_surface' });
      const data_url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const current = await activeTab();
      const finalState = current.id === tabId ? await content(tabId, { command: 'status' }) : { privacy: 'shielded' };
      if (current.id !== tabId || revision(tabId) !== captureRevision || finalState.privacy === 'shielded') {
        throw Object.assign(new Error('Chrome changed during capture; screenshot was discarded.'), { code: 'browser_capture_changed' });
      }
      if (data_url.length > Math.ceil(MAX_SCREENSHOT_BYTES * 4 / 3) + 128) throw Object.assign(new Error('Chrome screenshot exceeded 8 MB.'), { code: 'capture_too_large' });
      return { ...publicTab(await chrome.tabs.get(tabId)), data_url };
    }
    throw Object.assign(new Error('Unsupported Chrome command.'), { code: 'invalid_request' });
  }

  async function onSocketMessage(event) {
    let message;
    const raw = String(event.data || '');
    if (raw.length > MAX_COMMAND_CHARACTERS) { socket?.close(1009, 'Command too large'); return; }
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'ready') { authenticated = true; void syncIndicators(); return; }
    if (!authenticated || message.type !== 'command' || !message.request_id) return;
    try {
      const value = await execute(message);
      send({ type: 'response', request_id: message.request_id, ok: true, value });
    } catch (error) {
      send({ type: 'response', request_id: message.request_id, ok: false, error: { code: error?.code || 'chrome_control_error', message: String(error?.message || 'Chrome command failed.').slice(0, 300) } });
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    return btoa(binary);
  }

  async function readBoundedImage(response) {
    if (!response.body) throw new Error('Chrome image response has no readable body.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error('Chrome image exceeded 8 MB.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async function sendSelectedAsset(input, sender) {
    if (!authenticated || !sender?.tab?.id) return;
    const status = await content(sender.tab.id, { command: 'status' });
    if (status.privacy === 'shielded') return;
    const url = new URL(String(input.url || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const response = await fetch(url.href, { credentials: 'include', redirect: 'follow' });
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || (Number.isFinite(length) && length > MAX_IMAGE_BYTES)) throw new Error('Chrome image download failed or exceeded 8 MB.');
    const bytes = await readBoundedImage(response);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Chrome image exceeded 8 MB.');
    const mimeType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)) throw new Error('Chrome asset is not a supported raster image.');
    const finalUrl = new URL(response.url);
    if (!['http:', 'https:'].includes(finalUrl.protocol)) throw new Error('Chrome image redirected to an unsupported URL.');
    const finalStatus = await content(sender.tab.id, { command: 'status' });
    if (finalStatus.privacy === 'shielded') return;
    send({
      type: 'asset_selected', tab_id: String(sender.tab.id), revision: revision(sender.tab.id),
      mime_type: mimeType,
      data_base64: bytesToBase64(bytes), url: response.url, page_url: String(input.page_url || '').slice(0, 2048),
      label: String(input.label || 'Chrome image').slice(0, 240),
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'pair') {
      if (!validPairing(message.endpoint, message.token)) {
        sendResponse({ ok: false, error: 'SOLAT pairing payload is invalid.' });
        return false;
      }
      chrome.storage.local.set({ solatEndpoint: message.endpoint, solatToken: message.token }).then(async () => {
        if (socket) socket.close();
        socket = null;
        await connect();
        sendResponse({ ok: true });
      }).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'status') {
      Promise.all([configuration(), Promise.resolve(authenticated)]).then(([config, connected]) => sendResponse({ configured: Boolean(config), connected }));
      return true;
    }
    if (message?.type === 'solat_asset_selected') {
      void sendSelectedAsset(message, sender).catch(() => {});
      return false;
    }
    if (message?.type === 'solat_privacy_state' && sender?.tab?.id) {
      if (message.privacy === 'shielded' || message.privacy === 'unsupported') void setTabIndicator(sender.tab.id, false);
      else if (message.privacy === 'clear' && authenticated) void setTabIndicator(sender.tab.id, true);
      return false;
    }
    return false;
  });

  chrome.alarms.create('solat-keepalive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(() => {
    if (authenticated) send({ type: 'ping', at: Date.now() });
    else void connect();
  });
  void connect();
})();
