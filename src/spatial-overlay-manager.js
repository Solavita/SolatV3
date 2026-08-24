const crypto = require('node:crypto');
const path = require('node:path');

function spatialError(code, message) {
  return Object.assign(new Error(message), { code });
}

class SpatialOverlayManager {
  constructor({ BrowserWindow, screen, preloadPath, htmlPath, now = Date.now,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, captureTimeoutMs = 120000 } = {}) {
    if (!BrowserWindow || !screen) throw new TypeError('BrowserWindow and screen are required.');
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.preloadPath = preloadPath;
    this.htmlPath = htmlPath;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.captureTimeoutMs = captureTimeoutMs;
    this.active = null;
  }

  async open({ sender, ownerId, sessionId, contextId = '', gesture = 'lasso' } = {}) {
    if (!sender || sender.isDestroyed?.()) throw spatialError('spatial_sender_unavailable', 'The SOLAT window is unavailable.');
    const normalizedOwner = String(ownerId || '').trim();
    const normalizedSession = String(sessionId || '').trim();
    if (!normalizedOwner || !normalizedSession || normalizedOwner.length > 160 || normalizedSession.length > 160) {
      throw spatialError('spatial_scope_invalid', 'A spatial owner and session are required and bounded.');
    }
    if (this.active?.window && !this.active.window.isDestroyed()) {
      const sameSender = sender.id !== undefined && sender.id === this.active.ownerSender?.id;
      if (!sameSender || normalizedSession !== this.active.sessionId) {
        throw spatialError('spatial_capture_forbidden', 'Another renderer owns the active spatial capture.');
      }
      this.active.window.focus();
      return { status: 'already_open', capture_id: this.active.captureId };
    }
    const display = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    if (!display?.bounds) throw spatialError('spatial_display_unavailable', 'No display is available for spatial input.');
    const captureId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const bounds = { ...display.bounds };
    const window = new this.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        preload: this.preloadPath,
      },
    });
    window.setAlwaysOnTop(true, 'floating');
    const active = {
      captureId,
      token,
      window,
      ownerSender: sender,
      ownerId: normalizedOwner,
      sessionId: normalizedSession,
      contextId: String(contextId || '').trim().slice(0, 160),
      gesture: String(gesture || 'lasso').trim().toLowerCase(),
      startedAtMs: this.now(),
      display: {
        id: String(display.id ?? ''),
        scale_factor: Number(display.scaleFactor || 1),
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      },
    };
    this.active = active;
    active.timeout = this.setTimeoutFn(() => {
      if (this.active?.captureId !== captureId) return;
      this.#close(active);
      if (!sender.isDestroyed?.()) sender.send('solat:spatial-event', {
        schema_version: 'solat.spatial-overlay-result.v1', status: 'cancelled', event_id: captureId, reason: 'capture_timeout',
      });
    }, this.captureTimeoutMs);
    active.timeout?.unref?.();
    const ownerClosed = () => {
      if (this.active?.captureId !== captureId) return;
      this.#close(active);
    };
    active.ownerClosed = ownerClosed;
    if (typeof sender.once === 'function') {
      sender.once('destroyed', ownerClosed);
      sender.once('closed', ownerClosed);
    }
    const displayChanged = (_event, changedDisplay) => {
      if (this.active?.captureId !== captureId || String(changedDisplay?.id) !== String(display.id)) return;
      this.#close(active);
      if (!sender.isDestroyed?.()) sender.send('solat:spatial-event', {
        schema_version: 'solat.spatial-overlay-result.v1', status: 'cancelled', event_id: captureId, reason: 'display_changed',
      });
    };
    active.displayChanged = displayChanged;
    if (typeof this.screen.on === 'function') {
      this.screen.on('display-metrics-changed', displayChanged);
      this.screen.on('display-removed', displayChanged);
    }
    window.on('closed', () => {
      if (this.active?.captureId !== captureId) return;
      this.active = null;
      this.#removeOwnerListeners(active);
      if (!sender.isDestroyed?.()) sender.send('solat:spatial-event', {
        schema_version: 'solat.spatial-overlay-result.v1', status: 'cancelled', event_id: captureId, reason: 'overlay_closed',
      });
    });
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.webContents.send('solat:spatial-init', {
        schema_version: 'solat.spatial-overlay-init.v1',
        capture_id: captureId,
        token,
        gesture: active.gesture,
        coordinate_space: 'display-local-css-px',
        origin: 'top-left',
        display: active.display,
      });
      window.show();
      window.focus();
    });
    try {
      await window.loadFile(this.htmlPath);
    } catch (error) {
      this.#close(active);
      throw spatialError('spatial_overlay_load_failed', `Spatial overlay could not load: ${error?.message || 'unknown error'}`);
    }
    return { status: 'opened', capture_id: captureId, display: active.display };
  }

  async complete({ sender, request } = {}) {
    const active = this.#ownedCapture(sender, request);
    const gesture = String(request?.event?.gesture || active.gesture).trim().toLowerCase();
    const event = {
      event_id: active.captureId,
      context_id: active.contextId,
      source: String(request?.event?.source || 'mouse').trim().toLowerCase(),
      gesture,
      started_at_ms: active.startedAtMs,
      ended_at_ms: this.now(),
      display: active.display,
      points: request?.event?.points,
    };
    const scope = { ownerId: active.ownerId, sessionId: active.sessionId };
    return {
      event,
      scope,
      commit: value => {
        this.#close(active);
        const ownerSender = active.ownerSender;
        if (!ownerSender || ownerSender.isDestroyed?.()) return;
        ownerSender.send('solat:spatial-event', {
          schema_version: value.schema_version,
          event_id: value.event_id,
          gesture: value.gesture,
          bounds: value.bounds,
          context_id: value.context_id,
        });
      },
    };
  }

  async cancel({ sender, request } = {}) {
    const active = this.#ownedCapture(sender, request);
    const ownerSender = active.ownerSender;
    this.#close(active);
    if (ownerSender && !ownerSender.isDestroyed?.()) ownerSender.send('solat:spatial-event', {
      schema_version: 'solat.spatial-overlay-result.v1',
      status: 'cancelled',
      event_id: active.captureId,
    });
    return { status: 'cancelled', capture_id: active.captureId };
  }

  dispose() {
    if (this.active) this.#close(this.active);
  }

  #ownedCapture(sender, request) {
    const active = this.active;
    if (!active || !active.window || active.window.isDestroyed()) throw spatialError('spatial_capture_missing', 'No spatial capture is active.');
    if (!sender || sender.id === undefined || sender.id !== active.window.webContents.id) throw spatialError('spatial_capture_forbidden', 'This window does not own the spatial capture.');
    if (String(request?.captureId || '') !== active.captureId || String(request?.token || '') !== active.token) {
      throw spatialError('spatial_capture_forbidden', 'The spatial capture token is invalid.');
    }
    return active;
  }

  #close(active) {
    if (this.active?.captureId === active.captureId) this.active = null;
    this.#removeOwnerListeners(active);
    if (active.window && !active.window.isDestroyed()) active.window.close();
  }

  #removeOwnerListeners(active) {
    if (active.timeout) {
      this.clearTimeoutFn(active.timeout);
      active.timeout = null;
    }
    const sender = active.ownerSender;
    const listener = active.ownerClosed;
    if (sender && listener && typeof sender.removeListener === 'function') {
      sender.removeListener('destroyed', listener);
      sender.removeListener('closed', listener);
    }
    if (active.displayChanged && typeof this.screen.removeListener === 'function') {
      this.screen.removeListener('display-metrics-changed', active.displayChanged);
      this.screen.removeListener('display-removed', active.displayChanged);
    }
  }
}

function createSpatialOverlayManager({ BrowserWindow, screen, appRoot, now } = {}) {
  return new SpatialOverlayManager({
    BrowserWindow,
    screen,
    preloadPath: path.join(appRoot, 'src', 'spatial-preload.js'),
    htmlPath: path.join(appRoot, 'renderer', 'spatial-overlay.html'),
    now,
  });
}

module.exports = { SpatialOverlayManager, createSpatialOverlayManager };
