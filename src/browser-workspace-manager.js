const crypto = require('node:crypto');
const path = require('node:path');
const {
  ACTION_SCHEMA_VERSION, BrowserWorkspaceError, EVENT_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION, SURFACE_SCHEMA_VERSION,
  VISUAL_CAPTURE_SCHEMA_VERSION, VISUAL_OBSERVATION_SCHEMA_VERSION,
  normalizeAction, normalizeBrowserInput, normalizeOpenRequest, normalizeSurfaceRef, normalizeVisualRef, safeHttpsUrl,
} = require('./core/browser-workspace-contracts');

const OBSERVE_WORLD_ID = 1004;
const OBSERVE_LIMIT = 120;
const VISUAL_MAX_BYTES = 8 * 1024 * 1024;
const VISUAL_MAX_DIMENSION = 1920;
const VISUAL_MAX_PIXELS = 3_686_400;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SHELL_HEIGHT = 82;

function sensitiveSurfaceScript() {
  return `(() => {
    const path = String(location.pathname || '').toLowerCase();
    const authRoute = /(?:^|\\/)(?:login|log-in|signin|sign-in|oauth|auth|challenge|verify|verification)(?:\\/|$)/u.test(path);
    const privateInput = document.querySelector('input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"]');
    const authForm = document.querySelector('form[action*="login" i],form[action*="signin" i],[aria-label*="login" i],[aria-label*="sign in" i]');
    return Boolean(authRoute || privateInput || authForm);
  })()`;
}

function isGoogleAuthUrl(value) {
  try {
    const parsed = new URL(safeHttpsUrl(value));
    return parsed.protocol === 'https:' && (parsed.hostname === 'accounts.google.com'
      || parsed.hostname.endsWith('.accounts.google.com'));
  } catch { return false; }
}

function error(code, message) { return new BrowserWorkspaceError(code, message); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function boundedVisualSize(size, maxDimension = VISUAL_MAX_DIMENSION, maxPixels = VISUAL_MAX_PIXELS) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw error('browser_visual_invalid_capture', 'The browser visual capture returned an invalid image size.');
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function boundedCapturePage(webContents, {
  rect = undefined,
  maxBytes = VISUAL_MAX_BYTES,
  maxDimension = VISUAL_MAX_DIMENSION,
  maxPixels = VISUAL_MAX_PIXELS,
} = {}) {
  if (!webContents || typeof webContents.capturePage !== 'function') {
    throw error('browser_visual_unavailable', 'The browser surface does not support bounded visual capture.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > VISUAL_MAX_BYTES) {
    throw error('browser_visual_invalid_capture', 'The browser visual byte limit is invalid.');
  }
  let image;
  try { image = await webContents.capturePage(rect); }
  catch (cause) { throw Object.assign(error('browser_visual_capture_failed', 'The browser surface could not be captured.'), { cause }); }
  if (!image || typeof image.getSize !== 'function' || typeof image.toPNG !== 'function') {
    throw error('browser_visual_invalid_capture', 'The browser visual capture returned no image.');
  }
  let size = boundedVisualSize(image.getSize(), maxDimension, maxPixels);
  const original = image.getSize();
  if (size.width !== Number(original.width) || size.height !== Number(original.height)) {
    if (typeof image.resize !== 'function') throw error('browser_visual_invalid_capture', 'The browser visual image cannot be bounded safely.');
    image = image.resize({ width: size.width, height: size.height, quality: 'good' });
  }
  let bytes;
  try { bytes = Buffer.from(image.toPNG()); }
  catch (cause) { throw Object.assign(error('browser_visual_invalid_capture', 'The browser visual image could not be encoded as PNG.'), { cause }); }
  // PNG compression can still exceed the transport cap. Downsample a bounded
  // number of times; never return an unbounded image or silently truncate it.
  for (let attempt = 0; bytes.length > maxBytes && attempt < 4; attempt += 1) {
    size = { width: Math.max(1, Math.floor(size.width * 0.75)), height: Math.max(1, Math.floor(size.height * 0.75)) };
    if (typeof image.resize !== 'function') break;
    image = image.resize({ width: size.width, height: size.height, quality: 'good' });
    try { bytes = Buffer.from(image.toPNG()); }
    catch (cause) { throw Object.assign(error('browser_visual_invalid_capture', 'The browser visual image could not be encoded as PNG.'), { cause }); }
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || bytes.length > maxBytes) {
    throw error('browser_visual_invalid_capture', 'The browser visual PNG exceeded the bounded capture contract.');
  }
  const finalSize = typeof image.getSize === 'function' ? image.getSize() : size;
  const final = boundedVisualSize(finalSize, maxDimension, maxPixels);
  if (Number(finalSize.width) !== final.width || Number(finalSize.height) !== final.height) {
    throw error('browser_visual_invalid_capture', 'The browser visual image remained outside the bounded dimensions.');
  }
  return Object.freeze({ media_type: 'image/png', bytes, width: final.width, height: final.height });
}

function observeScript() {
  return `(() => {
    const max = ${OBSERVE_LIMIT};
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex],[contenteditable="true"]'));
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const name = element => String(element.getAttribute('aria-label') || element.innerText || element.getAttribute('placeholder') || element.getAttribute('alt') || element.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
    const role = element => String(element.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox'}[element.tagName] || element.tagName.toLowerCase())).slice(0, 40);
    const sensitive = element => {
      const text = [element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label'), element.getAttribute('placeholder')].join(' ');
      return element.type === 'password' || /(?:password|passcode|otp|one.?time|pin|card|cvv|cvc|security.?code|credential|รหัส|บัตร)/iu.test(text);
    };
    const map = new Map();
    const items = [];
    for (const element of candidates) {
      if (items.length >= max || !visible(element) || sensitive(element)) continue;
      const rect = element.getBoundingClientRect();
      const id = 'e' + (items.length + 1);
      map.set(id, element);
      items.push({ target_id:id, role:role(element), name:name(element), disabled:Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), editable:Boolean(element.matches('input:not([type="password"]),textarea,select,[contenteditable="true"]')), bounds:{ x:Math.round(rect.x), y:Math.round(rect.y), width:Math.round(rect.width), height:Math.round(rect.height) } });
    }
    globalThis.__solatBrowserTargets = map;
    const canvasCount = document.querySelectorAll('canvas').length;
    return {
      title:String(document.title || '').slice(0,300), item_count:items.length,
      truncated:candidates.length > items.length, canvas_count:Math.min(canvasCount, 32),
      semantic_empty:items.length === 0, canvas_only:items.length === 0 && canvasCount > 0,
      visual_fallback_required:items.length === 0 || (items.length < 2 && canvasCount > 0), items,
    };
  })()`;
}

function targetScript(targetId, operation) {
  return `(() => {
    const element = globalThis.__solatBrowserTargets?.get(${JSON.stringify(targetId)});
    if (!element || !element.isConnected) return { ok:false, code:'stale_target' };
    const rect = element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
    if (!visible || element.disabled || element.getAttribute('aria-disabled') === 'true') return { ok:false, code:'target_unavailable' };
    ${operation}
  })()`;
}

function installAssetSelectionScript() {
  return `(() => {
    if (globalThis.__solatAssetSelectionInstalled) return true;
    globalThis.__solatAssetSelectionInstalled = true;
    globalThis.__solatSelectedVisualAsset = null;
    document.addEventListener('pointerdown', event => {
      if (!event.altKey) return;
      const element = event.target?.closest?.('img,svg,canvas,video');
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      globalThis.__solatSelectedVisualAsset = element;
    }, true);
    return true;
  })()`;
}

function readAssetSelectionScript() {
  return `(() => {
    const element = globalThis.__solatSelectedVisualAsset;
    if (!element || !element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width < 8 || rect.height < 8 || style.display === 'none' || style.visibility === 'hidden') return null;
    return {
      label:String(element.getAttribute('alt') || element.getAttribute('aria-label') || element.getAttribute('title') || element.tagName || 'browser image').replace(/\\s+/g,' ').trim().slice(0,240),
      tag:String(element.tagName || '').toLowerCase().slice(0,20),
      bounds:{ x:Math.floor(rect.x), y:Math.floor(rect.y), width:Math.ceil(rect.width), height:Math.ceil(rect.height) }
    };
  })()`;
}

class BrowserWorkspaceManager {
  constructor({ BrowserWindow, WebContentsView, shellPath, shellPreloadPath, profileId = 'local-desktop-profile:v1', openInChrome = null, now = Date.now, idFactory = crypto.randomUUID, onTakeover = null, onEvent = null, onAssetSelected = null } = {}) {
    if (!BrowserWindow || !WebContentsView || !shellPath || !shellPreloadPath) throw new TypeError('Browser workspace Electron dependencies are required.');
    this.BrowserWindow = BrowserWindow;
    this.WebContentsView = WebContentsView;
    this.shellPath = shellPath;
    this.shellPreloadPath = shellPreloadPath;
    this.profileId = String(profileId || 'local-desktop-profile:v1').trim();
    this.openInChrome = typeof openInChrome === 'function' ? openInChrome : null;
    this.now = now;
    this.idFactory = idFactory;
    this.onTakeover = onTakeover;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.onAssetSelected = typeof onAssetSelected === 'function' ? onAssetSelected : null;
    this.active = null;
    this.owners = new Map();
  }

  registerOwner(ownerId, sender) {
    const owner = String(ownerId || '').trim();
    if (!owner || !sender || sender.isDestroyed?.()) throw error('browser_sender_unavailable', 'The SOLAT window is unavailable.');
    const current = this.owners.get(owner);
    if (current && current !== sender && !current.isDestroyed?.()) throw error('browser_workspace_forbidden', 'The browser owner principal is already registered.');
    this.owners.set(owner, sender);
    if (!current) {
      const release = () => { if (this.owners.get(owner) === sender) this.owners.delete(owner); };
      sender.once?.('destroyed', release);
      sender.once?.('closed', release);
    }
    return true;
  }

  openForOwner({ ownerId, request } = {}) {
    const sender = this.owners.get(String(ownerId || '').trim());
    if (!sender || sender.isDestroyed?.()) throw error('browser_sender_unavailable', 'No active SOLAT renderer owns this browser task.');
    return this.open({ sender, ownerId, request });
  }

  async open({ sender, ownerId, request } = {}) {
    if (!sender || sender.isDestroyed?.()) throw error('browser_sender_unavailable', 'The SOLAT window is unavailable.');
    const input = normalizeOpenRequest(request);
    const owner = String(ownerId || '').trim();
    if (!owner) throw error('invalid_request', 'owner_id is invalid.');
    if (this.active) {
      if (this.active.ownerId !== owner || this.active.sessionId !== input.session_id) throw error('browser_workspace_forbidden', 'Another renderer owns the active browser workspace.');
      if (this.active.mode === 'user') throw error('user_takeover_active', 'Return control before SOLAT navigates the browser workspace.');
      this.active.window.focus();
      if (safeHttpsUrl(this.active.remote.webContents.getURL() || input.url) !== input.url) await this.navigate({ ownerId: owner, request: { sessionId: input.session_id, surfaceId: this.active.surfaceId, url: input.url } });
      return this.#view(this.active);
    }

    const surfaceId = `browser_${this.idFactory()}`;
    const window = new this.BrowserWindow({
      width: input.bounds?.width || 1120,
      height: input.bounds ? input.bounds.height + SHELL_HEIGHT : 800,
      minWidth: 680,
      minHeight: 520,
      title: 'SOLAT Browser Workspace',
      backgroundColor: '#071225',
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.shellPreloadPath,
      },
    });
    // A persistent OS-user profile keeps ordinary cookies/login state between
    // launches. It is deliberately not keyed by the ephemeral renderer id.
    const partition = `persist:solat-browser-v3-${crypto.createHash('sha256').update(this.profileId).digest('hex').slice(0, 16)}`;
    const remote = new this.WebContentsView({
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false, devTools: false,
        backgroundThrottling: false, spellcheck: true, partition,
      },
    });
    const active = {
      surfaceId, ownerId: owner, sessionId: input.session_id, ownerSender: sender,
      window, remote, navigationRevision: 0, observationRevision: 0,
      status: 'loading', mode: 'agent', layout: input.mode, title: '', url: input.url,
      createdAtMs: this.now(), closed: false, visualCapture: null, lastSemanticObservation: null,
      privacyShield: false, externalAuth: 'none', partition, children: new Set(),
    };
    this.active = active;
    window.contentView.addChildView(remote);
    const resize = () => {
      if (window.isDestroyed()) return;
      const [width, height] = window.getContentSize();
      remote.setBounds({ x: 0, y: SHELL_HEIGHT, width: Math.max(0, width), height: Math.max(0, height - SHELL_HEIGHT) });
    };
    active.resize = resize;
    window.on('resize', resize);
    window.on('closed', () => this.#finalize(active, 'closed'));
    const ownerClosed = () => this.#close(active, 'owner_closed');
    active.ownerClosed = ownerClosed;
    sender.once?.('destroyed', ownerClosed);
    sender.once?.('closed', ownerClosed);

    const wc = remote.webContents;
    const guardNavigation = (event, url, child = null) => {
      if (isGoogleAuthUrl(url)) {
        event.preventDefault();
        void this.#handoffGoogleAuth(active, url).finally(() => {
          if (child && !child.isDestroyed?.()) child.close?.();
        });
        return;
      }
      try { safeHttpsUrl(url); }
      catch { event.preventDefault(); this.#emit(active, 'blocked', { reason: 'unsafe_navigation' }); }
    };
    const popupHandler = details => {
      if (active.mode !== 'user') return { action: 'deny' };
      try { safeHttpsUrl(details?.url); }
      catch { this.#emit(active, 'blocked', { reason: 'unsafe_popup' }); return { action: 'deny' }; }
      if (isGoogleAuthUrl(details?.url)) {
        void this.#handoffGoogleAuth(active, details.url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window, show: true, width: 1040, height: 760,
          backgroundColor: '#071225',
          webPreferences: {
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            webSecurity: true, allowRunningInsecureContent: false, devTools: false,
            backgroundThrottling: false, spellcheck: true, partition,
          },
        },
      };
    };
    wc.setWindowOpenHandler(popupHandler);
    wc.on('did-create-window', child => {
      active.children.add(child);
      child.once?.('closed', () => active.children.delete(child));
      const childContents = child.webContents;
      childContents?.setWindowOpenHandler?.(popupHandler);
      childContents?.on?.('will-navigate', (event, url) => guardNavigation(event, url, child));
      childContents?.on?.('will-redirect', (event, url) => guardNavigation(event, url, child));
    });
    wc.on('will-navigate', guardNavigation);
    wc.on('will-redirect', guardNavigation);
    wc.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    const denyUnsafeRequest = (details, callback) => {
      if (details?.resourceType !== 'mainFrame') return callback({ cancel: false });
      try { safeHttpsUrl(details?.url); callback({ cancel: false }); }
      catch { callback({ cancel: true }); }
    };
    active.webRequest = wc.session.webRequest;
    active.denyUnsafeRequest = denyUnsafeRequest;
    wc.session.webRequest?.onBeforeRequest?.({ urls: ['http://*/*', 'https://*/*'] }, denyUnsafeRequest);
    const denyDownload = event => {
      if (active.mode === 'user') {
        this.#emit(active, 'download_started');
        return;
      }
      event.preventDefault();
      this.#emit(active, 'blocked', { reason: 'download_requires_user_control' });
    };
    active.denyDownload = denyDownload;
    wc.session.on('will-download', denyDownload);
    wc.on('did-start-navigation', (_event, url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return;
      active.navigationRevision += 1;
      active.observationRevision = 0;
      active.visualCapture = null;
      active.lastSemanticObservation = null;
      active.privacyShield = false;
      active.externalAuth = 'none';
      active.status = 'loading';
      active.url = this.#safeVisibleUrl(url);
      this.#emit(active, 'navigation');
    });
    wc.on('did-finish-load', () => {
      active.status = 'ready';
      active.title = String(wc.getTitle() || '').slice(0, 300);
      active.url = this.#safeVisibleUrl(wc.getURL());
      void wc.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: installAssetSelectionScript() }], false).catch(() => {});
      void this.#refreshPrivacy(active).finally(() => this.#emit(active, 'ready'));
    });
    wc.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      active.status = 'error';
      active.url = this.#safeVisibleUrl(url);
      this.#emit(active, 'error', { error_code: 'navigation_failed' });
    });
    wc.on('render-process-gone', () => this.#close(active, 'renderer_gone'));
    wc.on('before-input-event', () => {
      if (active.mode === 'agent') void this.takeover({ ownerId: owner, request: { sessionId: active.sessionId, surfaceId } });
      // Never inspect the key event. The isolated probe returns one boolean and
      // exists only to close SOLAT's observation/capture/action gates.
      void this.#refreshPrivacy(active);
    });

    try {
      await window.loadFile(this.shellPath);
      resize();
      await wc.loadURL(input.url);
      if (!window.isDestroyed()) { window.show(); window.focus(); }
    } catch (cause) {
      this.#close(active, 'open_failed');
      throw Object.assign(error('browser_workspace_open_failed', 'The browser workspace could not open.'), { cause });
    }
    return this.#view(active);
  }

  status({ ownerId, request } = {}) {
    const active = this.#owned(ownerId, normalizeSurfaceRef(request));
    return this.#view(active);
  }

  async navigate({ ownerId, request } = {}) {
    const ref = normalizeSurfaceRef(request);
    const active = this.#owned(ownerId, ref);
    if (active.mode !== 'agent') throw error('user_takeover_active', 'Return control before SOLAT navigates the browser workspace.');
    if (await this.#refreshPrivacy(active)) throw error('browser_sensitive_surface', 'Private input is active. SOLAT cannot navigate or inspect this page.');
    const url = safeHttpsUrl(request?.url);
    await active.remote.webContents.loadURL(url);
    return this.#view(active);
  }

  async observe({ ownerId, request } = {}) {
    const ref = normalizeSurfaceRef(request);
    const active = this.#owned(ownerId, ref);
    if (active.mode !== 'agent') throw error('user_takeover_active', 'Return control before SOLAT observes the browser workspace.');
    if (active.status !== 'ready') throw error('browser_workspace_not_ready', 'The browser workspace is not ready to observe.');
    if (await this.#refreshPrivacy(active)) throw error('browser_sensitive_surface', 'Private input is active. SOLAT cannot observe this page. Finish signing in and leave the sensitive form first.');
    const result = await active.remote.webContents.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: observeScript() }], false);
    if (!result || !Array.isArray(result.items)) throw error('browser_observation_failed', 'The browser workspace returned an invalid observation.');
    active.observationRevision += 1;
    active.title = String(result.title || active.title).slice(0, 300);
    const observation = Object.freeze({
      schema_version: OBSERVATION_SCHEMA_VERSION,
      status: 'ready',
      verified: true,
      surface_id: active.surfaceId,
      session_id: active.sessionId,
      navigation_revision: active.navigationRevision,
      observation_revision: active.observationRevision,
      title: active.title,
      item_count: Math.min(Number(result.item_count) || 0, OBSERVE_LIMIT),
      truncated: Boolean(result.truncated),
      canvas_count: Math.min(Number(result.canvas_count) || 0, 32),
      semantic_empty: Boolean(result.semantic_empty) || !result.items.length,
      canvas_only: Boolean(result.canvas_only),
      visual_fallback_required: Boolean(result.visual_fallback_required) || !result.items.length,
      items: clone(result.items.slice(0, OBSERVE_LIMIT)),
      observed_at_ms: this.now(),
      trust: 'untrusted_remote_page_data',
    });
    active.lastSemanticObservation = Object.freeze({
      navigationRevision: active.navigationRevision,
      observationRevision: active.observationRevision,
      visualFallbackRequired: observation.visual_fallback_required === true,
    });
    this.#emit(active, 'screen_observed', { observation_kind: 'semantic', observation_revision: active.observationRevision });
    return observation;
  }

  async visualObserve({ ownerId, request } = {}) {
    const ref = normalizeVisualRef(request);
    const active = this.#owned(ownerId, ref);
    if (active.mode !== 'agent') throw error('user_takeover_active', 'Return control before SOLAT captures the browser workspace.');
    if (active.status !== 'ready') throw error('browser_workspace_not_ready', 'The browser workspace is not ready for visual capture.');
    if (await this.#refreshPrivacy(active)) throw error('browser_sensitive_surface', 'Private input is active. SOLAT cannot capture this page.');
    if (!active.lastSemanticObservation
      || active.lastSemanticObservation.navigationRevision !== active.navigationRevision
      || active.lastSemanticObservation.visualFallbackRequired !== true) {
      throw error('browser_visual_requires_semantic_observation', 'Capture the current semantic browser observation first; visual fallback is allowed only for an empty or canvas-only surface.');
    }
    const captured = await boundedCapturePage(active.remote.webContents);
    const capturedAt = this.now();
    const capturedAtIso = capturedAt instanceof Date ? capturedAt.toISOString() : new Date(capturedAt).toISOString();
    const sha256 = `sha256:${crypto.createHash('sha256').update(captured.bytes).digest('hex')}`;
    const captureId = `browser_visual_${this.idFactory()}`;
    const metadata = Object.freeze({
      schema_version: VISUAL_CAPTURE_SCHEMA_VERSION,
      status: 'ready', operation: 'capture_browser_surface',
      surface_id: active.surfaceId, session_id: active.sessionId,
      navigation_revision: active.navigationRevision,
      capture_id: captureId, media_type: 'image/png',
      size_bytes: captured.bytes.length, width: captured.width, height: captured.height,
      sha256, captured_at: capturedAtIso,
    });
    active.visualCapture = Object.freeze({ metadata, bytes: Buffer.from(captured.bytes) });
    active.observationRevision += 1;
    this.#emit(active, 'screen_observed', { observation_kind: 'visual', observation_revision: active.observationRevision, screen_hash: sha256 });
    return Object.freeze({
      schema_version: VISUAL_OBSERVATION_SCHEMA_VERSION,
      status: 'ready', verified: true,
      surface_id: active.surfaceId, session_id: active.sessionId,
      navigation_revision: active.navigationRevision,
      observation_revision: active.observationRevision,
      capture_id: captureId, media_type: metadata.media_type,
      size_bytes: metadata.size_bytes, width: metadata.width, height: metadata.height,
      sha256, observed_at_ms: this.now(),
      fallback_reason: 'semantic_dom_empty_or_canvas',
      trust: 'ephemeral_bounded_browser_surface_capture',
    });
  }

  getVisualCapture({ ownerId, request } = {}) {
    const ref = normalizeVisualRef(request);
    const active = this.#owned(ownerId, ref);
    if (active.mode !== 'agent' || active.privacyShield) throw error('browser_sensitive_surface', 'Private input is active. Browser pixels are unavailable to SOLAT.');
    const capture = active.visualCapture;
    if (!ref.capture_id || !ref.capture_sha256) {
      throw error('browser_visual_capture_unbound', 'A browser visual capture id and hash are required to retrieve pixels.');
    }
    if (!capture || capture.metadata.surface_id !== active.surfaceId
      || capture.metadata.session_id !== active.sessionId
      || capture.metadata.navigation_revision !== ref.navigation_revision
      || capture.metadata.capture_id !== ref.capture_id
      || capture.metadata.sha256 !== ref.capture_sha256) {
      throw error('browser_visual_capture_stale', 'The browser visual capture is missing or belongs to an older surface revision.');
    }
    return Object.freeze({ metadata: capture.metadata, bytes: Buffer.from(capture.bytes) });
  }

  async act({ ownerId, request } = {}) {
    const action = normalizeAction(request);
    const active = this.#owned(ownerId, action);
    if (active.mode !== 'agent') throw error('user_takeover_active', 'Return control before SOLAT acts in the browser workspace.');
    if (await this.#refreshPrivacy(active)) throw error('browser_sensitive_surface', 'Private input is active. SOLAT cannot inspect or act on this page.');
    if (action.navigation_revision !== active.navigationRevision) throw error('stale_target', 'The browser target belongs to an older navigation.');
    const wc = active.remote.webContents;
    const beforeRevision = active.navigationRevision;
    let result;
    if (action.action === 'fill') {
      result = await wc.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: targetScript(action.target_id, `
        if (!element.matches('input:not([type="password"]),textarea,[contenteditable="true"]')) return { ok:false, code:'target_not_editable' };
        element.focus();
        if (element.isContentEditable) element.textContent = ${JSON.stringify(action.value)};
        else element.value = ${JSON.stringify(action.value)};
        element.dispatchEvent(new Event('input', { bubbles:true }));
        element.dispatchEvent(new Event('change', { bubbles:true }));
        return { ok:(element.isContentEditable ? element.textContent : element.value) === ${JSON.stringify(action.value)}, code:'value_mismatch' };
      `) }], true);
    } else if (action.action === 'scroll_into_view') {
      result = await wc.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: targetScript(action.target_id, `
        element.scrollIntoView({ block:'center', inline:'center' });
        const after = element.getBoundingClientRect();
        return { ok:after.top >= 0 && after.left >= 0 && after.bottom <= innerHeight && after.right <= innerWidth, code:'scroll_not_verified' };
      `) }], true);
    } else {
      result = await wc.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: targetScript(action.target_id, `element.click(); return { ok:true };`) }], true);
      if (result?.ok && action.verify === 'navigation') {
        await new Promise(resolve => setTimeout(resolve, 250));
        result.ok = active.navigationRevision > beforeRevision;
        result.code = result.ok ? undefined : 'navigation_not_verified';
      } else if (result?.ok && action.verify === 'target_gone') {
        await new Promise(resolve => setTimeout(resolve, 50));
        const verify = await wc.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: `(() => { const e=globalThis.__solatBrowserTargets?.get(${JSON.stringify(action.target_id)}); return !e || !e.isConnected || e.getClientRects().length === 0; })()` }], false);
        result.ok = verify === true;
        result.code = result.ok ? undefined : 'target_still_present';
      }
    }
    if (!result?.ok) throw error(result?.code || 'browser_action_unverified', 'The browser action did not satisfy its verified postcondition.');
    active.visualCapture = null;
    return Object.freeze({
      schema_version: ACTION_SCHEMA_VERSION, status: 'ready', verified: true,
      operation: action.action, surface_id: active.surfaceId, session_id: active.sessionId,
      navigation_revision: active.navigationRevision, target_id: action.target_id, completed_at_ms: this.now(),
    });
  }

  async takeover({ ownerId, request } = {}) {
    const active = this.#owned(ownerId, normalizeSurfaceRef(request));
    if (active.mode === 'user') return this.#view(active);
    active.mode = 'user';
    await this.onTakeover?.({ ownerId: active.ownerId, sessionId: active.sessionId, surfaceId: active.surfaceId });
    this.#emit(active, 'takeover');
    return this.#view(active);
  }

  async returnControl({ ownerId, request } = {}) {
    const active = this.#owned(ownerId, normalizeSurfaceRef(request));
    if (active.children?.size) {
      active.mode = 'user';
      this.#emit(active, 'popup_active');
      return this.#view(active);
    }
    if (await this.#refreshPrivacy(active)) {
      active.mode = 'user';
      this.#emit(active, 'privacy_shielded');
      return this.#view(active);
    }
    active.externalAuth = 'none';
    active.mode = 'agent';
    this.#emit(active, 'control_returned');
    return this.#view(active);
  }

  async shellCommand(sender, request = {}) {
    const active = this.active;
    if (!active || active.closed || active.window?.webContents !== sender) {
      throw error('browser_workspace_forbidden', 'This toolbar does not own the active browser workspace.');
    }
    const action = String(request.action || '').trim();
    const ref = { sessionId: active.sessionId, surfaceId: active.surfaceId };
    if (action === 'close') return this.close({ ownerId: active.ownerId, request: ref });
    if (action === 'takeover') return this.takeover({ ownerId: active.ownerId, request: ref });
    if (action === 'return_control') return this.returnControl({ ownerId: active.ownerId, request: ref });
    if (!['back', 'forward', 'reload', 'navigate', 'select_asset', 'open_chrome'].includes(action)) {
      throw error('invalid_request', 'The browser toolbar command is invalid.');
    }
    if (active.mode !== 'user') await this.takeover({ ownerId: active.ownerId, request: ref });
    if (action === 'select_asset') return this.#captureSelectedAsset(active);
    if (action === 'open_chrome') {
      await this.#openCurrentInChrome(active, 'manual');
      return this.#view(active);
    }
    const wc = active.remote.webContents;
    const history = wc.navigationHistory;
    if (action === 'navigate') await wc.loadURL(normalizeBrowserInput(request.url));
    else if (action === 'reload') wc.reload();
    else if (action === 'back') {
      if (history?.canGoBack?.()) history.goBack();
      else if (wc.canGoBack?.()) wc.goBack();
    } else if (action === 'forward') {
      if (history?.canGoForward?.()) history.goForward();
      else if (wc.canGoForward?.()) wc.goForward();
    }
    return this.#view(active);
  }

  async #captureSelectedAsset(active) {
    if (!this.onAssetSelected) throw error('browser_asset_unavailable', 'Browser asset selection is unavailable.');
    if (await this.#refreshPrivacy(active)) throw error('browser_sensitive_surface', 'Private input is active. SOLAT cannot capture an image from this page.');
    const selectedRevision = active.navigationRevision;
    const selectedUrl = active.url;
    const selected = await active.remote.webContents.executeJavaScriptInIsolatedWorld(OBSERVE_WORLD_ID, [{ code: readAssetSelectionScript() }], false);
    if (active.navigationRevision !== selectedRevision || active.url !== selectedUrl) throw error('stale_target', 'The selected browser image belongs to an older navigation. Select it again.');
    if (!selected?.bounds) throw error('browser_asset_not_selected', 'Alt-click an image or visual object on the page first.');
    const bounds = selected.bounds;
    const viewBounds = active.remote.getBounds?.() || active.remote.bounds;
    const x = Number(bounds.x); const y = Number(bounds.y); const width = Number(bounds.width); const height = Number(bounds.height);
    if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 8 || height < 8
      || !viewBounds || x + width > viewBounds.width || y + height > viewBounds.height) {
      throw error('browser_asset_invalid_selection', 'The selected browser object is outside the current visible surface.');
    }
    const captured = await boundedCapturePage(active.remote.webContents, { rect: { x, y, width, height } });
    if (active.navigationRevision !== selectedRevision || active.url !== selectedUrl) throw error('stale_target', 'The browser navigated while the selected image was captured. Select it again.');
    const surface = { surface_id: active.surfaceId, kind: 'browser_workspace', tab_id: `nav-${selectedRevision}`, revision: selectedRevision };
    const result = await this.onAssetSelected({
      ownerId: active.ownerId, sessionId: active.sessionId, sender: active.ownerSender,
      surface, selection: { label: String(selected.label || 'browser image').slice(0, 240), tag: String(selected.tag || '').slice(0, 20), bounds: { x, y, width, height }, page_url: this.#safeVisibleUrl(selectedUrl) },
      capture: captured,
    });
    if (!result?.spatial_asset_id || !result?.ghost_id) throw error('browser_asset_failed', 'The selected browser object did not become a SpatialAsset.');
    this.#emit(active, 'asset_selected');
    return Object.freeze({ schema_version: 'solat.browser-asset-selection.v1', status: 'held', surface_id: active.surfaceId, spatial_asset_id: result.spatial_asset_id, ghost_id: result.ghost_id });
  }

  async #openCurrentInChrome(active, reason) {
    if (!this.openInChrome) throw error('browser_external_auth_unavailable', 'Google sign-in needs an installed Chrome browser.');
    const publicUrl = safeHttpsUrl(active.remote.webContents.getURL() || active.url);
    active.mode = 'user';
    active.externalAuth = reason === 'google_oauth' ? 'chrome_google' : 'chrome';
    active.visualCapture = null;
    active.lastSemanticObservation = null;
    await this.openInChrome(publicUrl);
    this.#emit(active, 'opened_in_chrome');
  }

  async #handoffGoogleAuth(active, oauthUrl) {
    if (!isGoogleAuthUrl(oauthUrl)) return;
    try {
      // Open the current site page, not the OAuth URL. That lets Chrome create
      // its own first-party Pinterest/session state before the owner clicks
      // Continue with Google again, and avoids moving OAuth state or cookies.
      await this.#openCurrentInChrome(active, 'google_oauth');
    } catch {
      active.externalAuth = 'unavailable';
      this.#emit(active, 'blocked', { reason: 'google_auth_requires_chrome' });
    }
  }

  close({ ownerId, request } = {}) {
    const active = this.#owned(ownerId, normalizeSurfaceRef(request));
    this.#close(active, 'closed_by_owner');
    return { schema_version: SURFACE_SCHEMA_VERSION, status: 'closed', surface_id: active.surfaceId };
  }

  dispose() { if (this.active) this.#close(this.active, 'disposed'); }

  async #refreshPrivacy(active) {
    if (!active || active.closed || active.status !== 'ready') return Boolean(active?.privacyShield);
    let shielded = true;
    try {
      shielded = await active.remote.webContents.executeJavaScriptInIsolatedWorld(
        OBSERVE_WORLD_ID, [{ code: sensitiveSurfaceScript() }], false,
      ) === true;
    } catch {
      // If the renderer cannot prove that the surface is non-sensitive, fail
      // closed. A navigation/load retry can establish a fresh state later.
      shielded = true;
    }
    const changed = active.privacyShield !== shielded;
    active.privacyShield = shielded;
    if (shielded) {
      active.visualCapture = null;
      active.lastSemanticObservation = null;
    }
    if (changed) this.#emit(active, shielded ? 'privacy_shielded' : 'privacy_cleared');
    return shielded;
  }

  #owned(ownerId, ref) {
    const active = this.active;
    if (!active || active.closed || active.surfaceId !== ref.surface_id) throw error('browser_workspace_missing', 'The browser workspace is not active.');
    if (active.ownerId !== String(ownerId || '').trim() || active.sessionId !== ref.session_id) throw error('browser_workspace_forbidden', 'The browser workspace belongs to another renderer or session.');
    return active;
  }

  #view(active) {
    return Object.freeze({
      schema_version: SURFACE_SCHEMA_VERSION, status: active.status,
      verified: active.status === 'ready' && !active.privacyShield,
      surface_id: active.surfaceId, session_id: active.sessionId,
      navigation_revision: active.navigationRevision, observation_revision: active.observationRevision,
      url: this.#safeVisibleUrl(active.url), title: active.title,
      control: active.mode, privacy: active.privacyShield ? 'shielded' : 'standard',
      popup: active.children?.size ? 'open' : 'none', profile: 'persistent',
      external_auth: active.externalAuth,
      layout: active.layout, created_at_ms: active.createdAtMs,
    });
  }

  #safeVisibleUrl(value) {
    try {
      const parsed = new URL(safeHttpsUrl(value));
      for (const key of [...parsed.searchParams.keys()]) if (/(?:token|secret|password|code|auth|key)/iu.test(key)) parsed.searchParams.set(key, '[REDACTED]');
      return parsed.toString();
    } catch { return ''; }
  }

  #emit(active, type, extra = {}) {
    const payload = { schema_version: EVENT_SCHEMA_VERSION, type, surface: this.#view(active), ...extra };
    try {
      this.onEvent?.({
        ownerId: active.ownerId,
        sessionId: active.sessionId,
        type,
        surface: this.#view(active),
        ...extra,
      });
    } catch {
      // Fusion telemetry is best-effort and must never change browser task
      // truth or make a verified operation report success.
    }
    if (!active.ownerSender?.isDestroyed?.()) active.ownerSender.send('solat:browser-workspace-event', payload);
    if (!active.window?.isDestroyed?.()) active.window.webContents.send('solat:browser-shell-state', payload);
  }

  #close(active, reason) {
    if (!active || active.closed) return;
    active.closed = true;
    this.#emit(active, 'closed', { reason });
    if (this.active?.surfaceId === active.surfaceId) this.active = null;
    active.ownerSender?.removeListener?.('destroyed', active.ownerClosed);
    active.ownerSender?.removeListener?.('closed', active.ownerClosed);
    active.remote?.webContents?.session?.removeListener?.('will-download', active.denyDownload);
    active.webRequest?.onBeforeRequest?.(null);
    for (const child of active.children || []) if (!child.isDestroyed?.()) child.close?.();
    active.children?.clear?.();
    if (active.window && !active.window.isDestroyed()) active.window.close();
  }

  #finalize(active, reason) {
    if (active.closed) return;
    active.closed = true;
    if (this.active?.surfaceId === active.surfaceId) this.active = null;
    active.ownerSender?.removeListener?.('destroyed', active.ownerClosed);
    active.ownerSender?.removeListener?.('closed', active.ownerClosed);
    active.remote?.webContents?.session?.removeListener?.('will-download', active.denyDownload);
    active.webRequest?.onBeforeRequest?.(null);
    for (const child of active.children || []) if (!child.isDestroyed?.()) child.close?.();
    active.children?.clear?.();
    try {
      this.onEvent?.({ ownerId: active.ownerId, sessionId: active.sessionId, type: 'closed', surface: this.#view(active) });
    } catch {
      // Best-effort only; renderer lifecycle cleanup remains authoritative.
    }
    if (!active.ownerSender?.isDestroyed?.()) active.ownerSender.send('solat:browser-workspace-event', {
      schema_version: EVENT_SCHEMA_VERSION, type: 'closed', reason, surface_id: active.surfaceId,
    });
  }
}

function createBrowserWorkspaceManager({ BrowserWindow, WebContentsView, appRoot, profileId, openInChrome, onTakeover, onEvent, onAssetSelected } = {}) {
  return new BrowserWorkspaceManager({
    BrowserWindow, WebContentsView, profileId, openInChrome, onTakeover, onEvent, onAssetSelected,
    shellPath: path.join(appRoot, 'renderer', 'browser-workspace.html'),
    shellPreloadPath: path.join(appRoot, 'src', 'browser-workspace-preload.js'),
  });
}

module.exports = {
  BrowserWorkspaceManager,
  VISUAL_MAX_BYTES,
  VISUAL_MAX_DIMENSION,
  VISUAL_MAX_PIXELS,
  boundedCapturePage,
  createBrowserWorkspaceManager,
  installAssetSelectionScript,
  readAssetSelectionScript,
  sensitiveSurfaceScript,
};
