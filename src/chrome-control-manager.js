const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const {
  ACTION_SCHEMA_VERSION, BrowserWorkspaceError, EVENT_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION, SURFACE_SCHEMA_VERSION,
  VISUAL_CAPTURE_SCHEMA_VERSION, VISUAL_OBSERVATION_SCHEMA_VERSION,
  TAB_LIST_SCHEMA_VERSION, normalizeAction, normalizeOpenRequest, normalizeSurfaceRef,
  normalizeTabListRequest, normalizeTabSwitchRequest, normalizeVisualRef, safeWebUrl,
} = require('./core/browser-workspace-contracts');

const EXTENSION_ID = 'eokiajfkblbchdnjobacdbddjdllkeca';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const DEFAULT_PORT = 43187;
const MAX_MESSAGE_BYTES = 12 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 120;
const MAX_TAB_RESULTS = 1000;
const TAB_PAGE_SIZE = 100;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(code, message) { return new BrowserWorkspaceError(code, message); }
function cleanId(value, field = 'id', max = 256) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) throw fail('invalid_request', `${field} is invalid.`);
  return text;
}
function redactUrl(value) {
  try {
    const parsed = new URL(safeWebUrl(value));
    for (const key of parsed.searchParams.keys()) if (/(?:token|secret|password|code|auth|key)/iu.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    return parsed.toString();
  } catch { return ''; }
}
function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw fail('browser_visual_invalid_capture', 'Chrome returned an invalid PNG capture.');
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16_777_216) throw fail('browser_visual_invalid_capture', 'Chrome capture dimensions exceed the bounded contract.');
  return { width, height };
}

class ChromeControlManager {
  constructor({ userDataPath, userDataDir, extensionId = EXTENSION_ID, extensionPath = null,
    revealExtension = null, port = DEFAULT_PORT, host = '127.0.0.1', requestTimeoutMs = 10_000,
    WebSocketServerClass = WebSocketServer, openChromeUrl = null, now = Date.now,
    idFactory = crypto.randomUUID, onEvent = null, onAssetSelected = null } = {}) {
    userDataPath = userDataPath || userDataDir;
    if (!userDataPath) throw new TypeError('Chrome Control requires a user-data path.');
    if (extensionId !== EXTENSION_ID) throw new TypeError('Chrome Control extension identity does not match the audited extension.');
    if (host !== '127.0.0.1') throw new TypeError('Chrome Control may listen only on 127.0.0.1.');
    this.userDataPath = path.resolve(userDataPath); this.port = port; this.host = host;
    this.requestTimeoutMs = requestTimeoutMs; this.WebSocketServerClass = WebSocketServerClass;
    this.openChromeUrl = typeof openChromeUrl === 'function' ? openChromeUrl : null;
    this.extensionPath = extensionPath ? path.resolve(extensionPath) : null;
    this.revealExtensionCallback = typeof revealExtension === 'function' ? revealExtension : null;
    this.now = now; this.idFactory = idFactory; this.onEvent = onEvent; this.onAssetSelected = onAssetSelected;
    this.server = null; this.socket = null; this.secret = null; this.pending = new Map();
    this.owners = new Map(); this.surfaces = new Map(); this.tabs = new Map(); this.actualPort = null;
    this.tabRefs = new Map(); this.tabAuthorities = new Map();
  }

  async start() {
    if (this.server) return this.connectionStatus();
    this.secret = await this.#loadSecret();
    this.server = new this.WebSocketServerClass({ host: this.host, port: this.port, maxPayload: MAX_MESSAGE_BYTES,
      verifyClient: info => info?.origin === EXTENSION_ORIGIN });
    this.server.on('connection', (socket, request) => this.#accept(socket, request));
    this.server.on('error', () => {});
    try {
      await new Promise((resolve, reject) => {
        if (this.server.address()) return resolve();
        const done = () => { cleanup(); resolve(); }; const bad = error => { cleanup(); reject(error); };
        const cleanup = () => { this.server.off('listening', done); this.server.off('error', bad); };
        this.server.once('listening', done); this.server.once('error', bad);
      });
    } catch (error) {
      const failedServer = this.server;
      this.server = null; this.actualPort = null;
      try { failedServer?.close?.(); } catch {}
      throw error;
    }
    this.actualPort = this.server.address().port;
    return this.connectionStatus();
  }

  async dispose() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(fail('chrome_control_disconnected', 'Chrome Control stopped.')); }
    this.pending.clear(); this.socket?.close?.(); this.socket = null;
    if (this.server) await new Promise(resolve => this.server.close(() => resolve()));
    this.server = null; this.secret = null;
  }

  connectionStatus() { return Object.freeze({ available: Boolean(this.server), connected: this.#connected(), full_control: true, extension_id: EXTENSION_ID }); }
  statusSummary() { return this.connectionStatus(); }

  async revealExtension() {
    if (!this.extensionPath || !this.revealExtensionCallback) throw fail('chrome_control_extension_unavailable', 'The Chrome extension folder is unavailable.');
    await this.revealExtensionCallback(this.extensionPath);
    return Object.freeze({ status: 'revealed', extension_id: EXTENSION_ID });
  }

  async pair() {
    if (!this.server) await this.start();
    if (!this.openChromeUrl) throw fail('chrome_control_pair_unavailable', 'Chrome pairing is unavailable.');
    const pairUrl = `chrome-extension://${EXTENSION_ID}/popup.html#endpoint=${encodeURIComponent(`ws://${this.host}:${this.actualPort}`)}&token=${encodeURIComponent(this.secret.toString('base64url'))}`;
    await this.openChromeUrl(pairUrl);
    return Object.freeze({ status: 'pairing', extension_id: EXTENSION_ID });
  }

  registerOwner(ownerId, sender) {
    const owner = cleanId(ownerId, 'owner_id');
    if (!sender || sender.isDestroyed?.()) throw fail('browser_sender_unavailable', 'The SOLAT window is unavailable.');
    const current = this.owners.get(owner);
    if (current && current !== sender && !current.isDestroyed?.()) throw fail('browser_workspace_forbidden', 'The browser owner principal is already registered.');
    this.owners.set(owner, sender);
    if (!current) {
      const release = () => {
        if (this.owners.get(owner) === sender) this.owners.delete(owner);
        for (const state of [...this.surfaces.values()]) if (state.ownerId === owner) this.#forget(state, 'owner_closed');
        for (const [tabRef, authority] of this.tabAuthorities) if (authority.ownerId === owner) {
          this.tabAuthorities.delete(tabRef);
          for (const [key, value] of this.tabRefs) if (value === tabRef) this.tabRefs.delete(key);
        }
      };
      sender.once?.('destroyed', release); sender.once?.('closed', release);
    }
    return true;
  }

  async openForOwner({ ownerId, request } = {}) {
    const sender = this.#sender(ownerId); const input = normalizeOpenRequest(request);
    this.#requireConnected();
    const tab = await this.#command('open', { url: input.url });
    return this.#adopt({ ownerId, sender, sessionId: input.session_id, layout: input.mode, tab });
  }

  async adoptActiveForOwner({ ownerId, request } = {}) {
    const sender = this.#sender(ownerId); const sessionId = cleanId(request?.sessionId, 'session_id');
    this.#requireConnected(); const tab = await this.#command('active_tab'); safeWebUrl(tab.url);
    return this.#adopt({ ownerId, sender, sessionId, layout: request?.mode || 'focused', tab });
  }

  async listTabsForOwner({ ownerId, request } = {}) {
    this.#sender(ownerId);
    const input = normalizeTabListRequest(request);
    this.#requireConnected();
    const rawTabs = [];
    let offset = 0;
    let totalCount = 0;
    while (rawTabs.length < MAX_TAB_RESULTS) {
      const result = await this.#command('list_tabs', { offset, limit: TAB_PAGE_SIZE });
      const page = Array.isArray(result?.tabs) ? result.tabs.slice(0, TAB_PAGE_SIZE) : [];
      rawTabs.push(...page);
      totalCount = Number.isSafeInteger(result?.total_count) && result.total_count >= 0
        ? result.total_count
        : Math.max(totalCount, rawTabs.length);
      if (!Number.isSafeInteger(result?.next_offset) || result.next_offset <= offset || page.length === 0) break;
      offset = result.next_offset;
    }
    const tabs = [];
    for (const tab of rawTabs.slice(0, MAX_TAB_RESULTS)) {
      let tabId;
      try { tabId = cleanId(tab?.tab_id, 'tab_id', 32); } catch { continue; }
      const tabRef = this.#tabRef(String(ownerId || '').trim(), input.session_id, tabId);
      const privacy = tab?.privacy === 'clear' ? 'standard' : tab?.privacy === 'shielded' ? 'shielded' : 'unsupported';
      let publicUrl = '';
      if (privacy === 'standard') {
        try { publicUrl = safeWebUrl(tab?.url); } catch { publicUrl = ''; }
      }
      const controllable = privacy === 'standard' && Boolean(publicUrl);
      tabs.push(Object.freeze({
        tab_ref: tabRef,
        status: tab?.status === 'loading' ? 'loading' : 'ready',
        privacy,
        controllable,
        active: Boolean(tab?.active),
        ...(controllable ? { url: redactUrl(publicUrl), title: String(tab?.title || '').slice(0, 300) } : {}),
      }));
    }
    return Object.freeze({
      schema_version: TAB_LIST_SCHEMA_VERSION,
      status: 'ready',
      verified: true,
      session_id: input.session_id,
      full_control: true,
      tab_count: tabs.length,
      total_count: Math.max(totalCount, tabs.length),
      truncated: totalCount > tabs.length,
      tabs: Object.freeze(tabs),
      observed_at_ms: this.now(),
      trust: 'untrusted_chrome_tab_metadata',
    });
  }

  async switchTabForOwner({ ownerId, request } = {}) {
    const sender = this.#sender(ownerId);
    const input = normalizeTabSwitchRequest(request);
    const authority = this.tabAuthorities.get(input.tab_ref);
    if (!authority || authority.ownerId !== String(ownerId || '').trim() || authority.sessionId !== input.session_id) {
      throw fail('browser_workspace_forbidden', 'The Chrome tab reference belongs to another renderer or session.');
    }
    this.#requireConnected();
    const tab = await this.#command('switch_tab', { tab_id: authority.tabId });
    if (tab?.privacy !== 'clear') throw fail('browser_sensitive_surface', 'Private or unsupported Chrome tabs stay under human control.');
    safeWebUrl(tab?.url);
    return this.#adopt({ ownerId, sender, sessionId: input.session_id, layout: request?.mode || 'focused', tab });
  }

  async status({ ownerId, request } = {}) {
    const state = this.#owned(ownerId, normalizeSurfaceRef(request)); await this.#refresh(state); return this.#view(state);
  }

  async navigate({ ownerId, request } = {}) {
    const state = this.#owned(ownerId, normalizeSurfaceRef(request)); this.#agentOnly(state);
    await this.#refresh(state); this.#privateGuard(state); const url = safeWebUrl(request?.url);
    const tab = await this.#command('navigate', { tab_id: state.tabId, url }); this.#update(state, tab); this.#emit(state, 'navigation');
    return this.#view(state);
  }

  async observe({ ownerId, request } = {}) {
    const state = this.#owned(ownerId, normalizeSurfaceRef(request)); this.#agentOnly(state); await this.#refresh(state); this.#privateGuard(state);
    const result = await this.#command('observe', { tab_id: state.tabId });
    if (result.privacy === 'shielded') { state.privacyShield = true; state.mode = 'user'; throw fail('browser_sensitive_surface', 'Private input is active. SOLAT cannot observe this page.'); }
    this.#update(state, result); state.observationRevision += 1;
    const items = Array.isArray(result.items) ? result.items.slice(0, MAX_ITEMS).map(item => ({
      target_id: cleanId(item.target_id, 'target_id', 160), role: String(item.role || '').slice(0, 40), name: String(item.name || '').slice(0, 300),
      disabled: Boolean(item.disabled), editable: Boolean(item.editable), ...(item.bounds ? { bounds: item.bounds } : {}),
    })) : [];
    const observation = Object.freeze({ schema_version: OBSERVATION_SCHEMA_VERSION, status: 'ready', verified: true,
      surface_id: state.surfaceId, session_id: state.sessionId, navigation_revision: state.navigationRevision,
      observation_revision: state.observationRevision, title: state.title, item_count: items.length,
      truncated: Boolean(result.truncated), canvas_count: Math.min(Number(result.canvas_count) || 0, 32),
      semantic_empty: Boolean(result.semantic_empty) || !items.length, canvas_only: Boolean(result.canvas_only),
      visual_fallback_required: Boolean(result.visual_fallback_required) || !items.length, items, observed_at_ms: this.now(), trust: 'untrusted_remote_page_data' });
    state.lastSemanticObservation = { navigationRevision: state.navigationRevision, visualFallbackRequired: observation.visual_fallback_required };
    this.#emit(state, 'screen_observed', { observation_kind: 'semantic', observation_revision: state.observationRevision });
    return observation;
  }

  async act({ ownerId, request } = {}) {
    const action = normalizeAction(request); const state = this.#owned(ownerId, action); this.#agentOnly(state); await this.#refresh(state); this.#privateGuard(state);
    if (action.navigation_revision !== state.navigationRevision) throw fail('stale_target', 'The Chrome target belongs to an older navigation.');
    const command = action.action === 'scroll_into_view' ? 'scroll' : action.action;
    const value = await this.#command(command, { tab_id: state.tabId, revision: action.navigation_revision, target_id: action.target_id,
      ...(action.value !== undefined ? { value: action.value } : {}), ...(action.verify ? { verify: action.verify } : {}) });
    if (value?.revision) state.navigationRevision = Number(value.revision); state.visualCapture = null;
    return Object.freeze({ schema_version: ACTION_SCHEMA_VERSION, status: 'ready', verified: true, operation: action.action,
      surface_id: state.surfaceId, session_id: state.sessionId, navigation_revision: state.navigationRevision,
      target_id: action.target_id, completed_at_ms: this.now() });
  }

  async visualObserve({ ownerId, request } = {}) {
    const ref = normalizeVisualRef(request); const state = this.#owned(ownerId, ref); this.#agentOnly(state); await this.#refresh(state); this.#privateGuard(state);
    if (ref.navigation_revision !== state.navigationRevision) throw fail('stale_target', 'The visual request belongs to an older navigation.');
    if (!state.lastSemanticObservation || state.lastSemanticObservation.navigationRevision !== state.navigationRevision || !state.lastSemanticObservation.visualFallbackRequired) {
      throw fail('browser_visual_requires_semantic_observation', 'Capture the current semantic observation before visual fallback.');
    }
    const result = await this.#command('screenshot', { tab_id: state.tabId });
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(String(result.data_url || ''));
    if (!match) throw fail('browser_visual_invalid_capture', 'Chrome returned an invalid capture.');
    const bytes = Buffer.from(match[1], 'base64'); if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) throw fail('browser_visual_invalid_capture', 'Chrome capture exceeds 8 MB.');
    const size = pngSize(bytes); const sha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`; const captureId = `chrome_visual_${this.idFactory()}`;
    const metadata = Object.freeze({ schema_version: VISUAL_CAPTURE_SCHEMA_VERSION, status: 'ready', operation: 'capture_browser_surface',
      surface_id: state.surfaceId, session_id: state.sessionId, navigation_revision: state.navigationRevision, capture_id: captureId,
      media_type: 'image/png', size_bytes: bytes.length, ...size, sha256, captured_at: new Date(this.now()).toISOString() });
    state.visualCapture = Object.freeze({ metadata, bytes }); state.observationRevision += 1;
    return Object.freeze({ schema_version: VISUAL_OBSERVATION_SCHEMA_VERSION, status: 'ready', verified: true,
      surface_id: state.surfaceId, session_id: state.sessionId, navigation_revision: state.navigationRevision,
      observation_revision: state.observationRevision, capture_id: captureId, media_type: 'image/png', size_bytes: bytes.length,
      ...size, sha256, observed_at_ms: this.now(), fallback_reason: 'semantic_dom_empty_or_canvas', trust: 'ephemeral_bounded_chrome_surface_capture' });
  }

  getVisualCapture({ ownerId, request } = {}) {
    const ref = normalizeVisualRef(request); const state = this.#owned(ownerId, ref); this.#privateGuard(state);
    const capture = state.visualCapture;
    if (!ref.capture_id || !ref.capture_sha256 || !capture || capture.metadata.navigation_revision !== ref.navigation_revision
      || capture.metadata.capture_id !== ref.capture_id || capture.metadata.sha256 !== ref.capture_sha256) throw fail('browser_visual_capture_stale', 'The Chrome capture is missing or stale.');
    return Object.freeze({ metadata: capture.metadata, bytes: Buffer.from(capture.bytes) });
  }

  async takeover({ ownerId, request } = {}) { const state = this.#owned(ownerId, normalizeSurfaceRef(request)); state.mode = 'user'; this.#emit(state, 'takeover'); return this.#view(state); }
  async returnControl({ ownerId, request } = {}) { const state = this.#owned(ownerId, normalizeSurfaceRef(request)); await this.#refresh(state); if (!state.privacyShield) state.mode = 'agent'; this.#emit(state, state.privacyShield ? 'privacy_shielded' : 'control_returned'); return this.#view(state); }
  async close({ ownerId, request } = {}) { const state = this.#owned(ownerId, normalizeSurfaceRef(request)); await this.#command('close', { tab_id: state.tabId }); state.status = 'closed'; this.#forget(state, 'closed'); return this.#view(state); }

  #connected() { return this.socket?.readyState === 1 && this.socket.__solatAuthenticated === true; }
  #requireConnected() { if (!this.#connected()) throw fail('chrome_control_unavailable', 'Pair the SOLAT Chrome extension before using Chrome Control.'); }
  #sender(ownerId) { const owner = cleanId(ownerId, 'owner_id'); const sender = this.owners.get(owner); if (!sender || sender.isDestroyed?.()) throw fail('browser_sender_unavailable', 'No active SOLAT renderer owns this Chrome task.'); return sender; }
  #agentOnly(state) { if (state.mode !== 'agent') throw fail('user_takeover_active', 'Return control before SOLAT controls Chrome.'); }
  #privateGuard(state) { if (state.privacyShield) throw fail('browser_sensitive_surface', 'Private input is active. SOLAT cannot inspect, capture, or act on this Chrome page.'); }
  #owned(ownerId, ref) { const state = this.surfaces.get(ref.surface_id); if (!state || state.closed) throw fail('browser_workspace_missing', 'The Chrome surface is not active.'); if (state.ownerId !== String(ownerId || '').trim() || state.sessionId !== ref.session_id) throw fail('browser_workspace_forbidden', 'The Chrome surface belongs to another renderer or session.'); return state; }
  #adopt({ ownerId, sender, sessionId, layout, tab }) {
    const url = safeWebUrl(tab.url); const old = this.tabs.get(String(tab.tab_id));
    if (old && !old.closed && (old.ownerId !== String(ownerId || '').trim() || old.sessionId !== sessionId)) {
      throw fail('browser_workspace_forbidden', 'The Chrome tab is already attached to another conversation.');
    }
    if (old && !old.closed) this.#forget(old, 'replaced');
    const state = { surfaceId: `chrome_${this.idFactory()}`, tabId: cleanId(tab.tab_id, 'tab_id', 32), ownerId: cleanId(ownerId, 'owner_id'), sessionId,
      ownerSender: sender, layout, url, title: String(tab.title || '').slice(0, 300), status: tab.status === 'complete' ? 'ready' : 'loading', mode: 'agent',
      privacyShield: false, navigationRevision: Math.max(1, Number(tab.revision) || 1), observationRevision: 0, createdAtMs: this.now(), closed: false,
      visualCapture: null, lastSemanticObservation: null };
    this.surfaces.set(state.surfaceId, state); this.tabs.set(state.tabId, state); this.#emit(state, 'ready'); return this.#view(state);
  }
  async #refresh(state) {
    this.#requireConnected(); const result = await this.#command('status', { tab_id: state.tabId }); this.#update(state, result);
    state.privacyShield = result.privacy === 'shielded'; if (state.privacyShield) { state.mode = 'user'; state.visualCapture = null; state.title = ''; }
    return state;
  }
  #update(state, tab) { const revision = Math.max(1, Number(tab.revision) || state.navigationRevision); if (revision !== state.navigationRevision) { state.observationRevision = 0; state.visualCapture = null; state.lastSemanticObservation = null; } state.navigationRevision = revision; state.url = safeWebUrl(tab.url || state.url); state.title = String(tab.title || state.title).slice(0, 300); state.status = tab.status === 'loading' ? 'loading' : 'ready'; }
  #view(state) { return Object.freeze({ schema_version: SURFACE_SCHEMA_VERSION, status: state.status, verified: state.status === 'ready' && !state.privacyShield,
    surface_id: state.surfaceId, session_id: state.sessionId, navigation_revision: state.navigationRevision, observation_revision: state.observationRevision,
    url: redactUrl(state.url), title: state.privacyShield ? '' : state.title, control: state.mode, privacy: state.privacyShield ? 'shielded' : 'standard', popup: 'none',
    profile: 'chrome_full_control', external_auth: state.privacyShield ? 'human_required' : 'none', layout: state.layout, created_at_ms: state.createdAtMs }); }
  #emit(state, type, extra = {}) { const surface = this.#view(state); try { this.onEvent?.({ ownerId: state.ownerId, sessionId: state.sessionId, type, surface, ...extra }); } catch {} if (!state.ownerSender?.isDestroyed?.()) state.ownerSender.send?.('solat:browser-workspace-event', { schema_version: EVENT_SCHEMA_VERSION, type, surface, ...extra }); }
  #forget(state, reason) { if (state.closed && !this.surfaces.has(state.surfaceId)) return; state.closed = true; state.status = 'closed'; this.surfaces.delete(state.surfaceId); if (this.tabs.get(state.tabId) === state) this.tabs.delete(state.tabId); this.#emit(state, 'closed', { reason }); }

  #tabRef(ownerId, sessionId, tabId) {
    const key = `${ownerId}\u0000${sessionId}\u0000${tabId}`;
    let tabRef = this.tabRefs.get(key);
    if (!tabRef) {
      tabRef = `chrome_tab_${this.idFactory()}`;
      this.tabRefs.set(key, tabRef);
      this.tabAuthorities.set(tabRef, { ownerId, sessionId, tabId });
      while (this.tabRefs.size > 1000) {
        const [oldKey, oldRef] = this.tabRefs.entries().next().value;
        this.tabRefs.delete(oldKey); this.tabAuthorities.delete(oldRef);
      }
    }
    return tabRef;
  }

  async #loadSecret() {
    await fs.promises.mkdir(this.userDataPath, { recursive: true }); const filename = path.join(this.userDataPath, 'chrome-control-secret');
    try { const value = Buffer.from((await fs.promises.readFile(filename, 'utf8')).trim(), 'base64url'); if (value.length === 32) return value; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const value = crypto.randomBytes(32); const temp = `${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.promises.writeFile(temp, value.toString('base64url'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { await fs.promises.rename(temp, filename); } catch (error) { await fs.promises.rm(temp, { force: true }); if (error?.code !== 'EEXIST') throw error; }
    return value;
  }
  #accept(socket, request) {
    if (request?.headers?.origin !== EXTENSION_ORIGIN) { socket.close(1008, 'origin'); return; }
    let authenticated = false; const authTimer = setTimeout(() => socket.close(1008, 'authentication'), 3000);
    socket.on('message', data => {
      if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES) { socket.close(1009, 'size'); return; }
      let message; try { message = JSON.parse(String(data)); } catch { socket.close(1007, 'json'); return; }
      if (!authenticated) {
        const candidate = Buffer.from(String(message?.token || ''), 'base64url');
        if (message?.type !== 'hello' || candidate.length !== this.secret.length || !crypto.timingSafeEqual(candidate, this.secret)) { socket.close(1008, 'authentication'); return; }
        authenticated = true; socket.__solatAuthenticated = true; clearTimeout(authTimer); this.socket?.close?.(1000, 'replaced'); this.socket = socket; socket.send(JSON.stringify({ type: 'ready' })); return;
      }
      if (message?.type === 'response') this.#response(message);
      else if (message?.type === 'asset_selected') void this.#asset(message);
    });
    socket.on('close', () => { clearTimeout(authTimer); if (this.socket === socket) { this.socket = null; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(fail('chrome_control_disconnected', 'Chrome Control disconnected.')); } this.pending.clear(); } });
  }
  #command(command, fields = {}) {
    this.#requireConnected(); const requestId = this.idFactory();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(requestId); reject(fail('chrome_control_timeout', 'Chrome Control did not respond in time.')); }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer }); try { this.socket.send(JSON.stringify({ type: 'command', request_id: requestId, command, ...fields })); } catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(Object.assign(fail('chrome_control_disconnected', 'Chrome Control send failed.'), { cause: error })); } });
  }
  #response(message) { const pending = this.pending.get(String(message.request_id || '')); if (!pending) return; this.pending.delete(String(message.request_id)); clearTimeout(pending.timer); if (message.ok) pending.resolve(message.value); else pending.reject(fail(String(message.error?.code || 'chrome_control_error').slice(0, 80), String(message.error?.message || 'Chrome Control failed.').slice(0, 300))); }
  async #asset(message) {
    const state = this.tabs.get(String(message.tab_id || '')); if (!state || state.closed || !this.onAssetSelected) return;
    // The extension checks privacy immediately before sending, and the main
    // process independently re-checks it so a navigation race cannot import
    // bytes from a page that has just become private.
    try { await this.#refresh(state); } catch { return; }
    if (state.privacyShield || Number(message.revision) !== state.navigationRevision) return;
    let bytes; try { bytes = Buffer.from(String(message.data_base64 || ''), 'base64'); if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) return; safeWebUrl(message.url); safeWebUrl(message.page_url); } catch { return; }
    try { await this.onAssetSelected({ ownerId: state.ownerId, sender: state.ownerSender, request: { sessionId: state.sessionId, mimeType: String(message.mime_type || ''), label: String(message.label || 'Chrome image').slice(0, 240), bytes, sourceUrl: message.url, pageUrl: message.page_url } }); } catch {}
  }
}

function createChromeControlManager(options) { return new ChromeControlManager(options); }

module.exports = { ChromeControlManager, createChromeControlManager, DEFAULT_PORT, EXTENSION_ID, EXTENSION_ORIGIN, MAX_MESSAGE_BYTES };
