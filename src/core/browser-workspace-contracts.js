const SURFACE_SCHEMA_VERSION = 'solat.browser-surface.v1';
const OBSERVATION_SCHEMA_VERSION = 'solat.browser-observation.v1';
const ACTION_SCHEMA_VERSION = 'solat.browser-action.v1';
const EVENT_SCHEMA_VERSION = 'solat.browser-workspace-event.v1';
const VISUAL_CAPTURE_SCHEMA_VERSION = 'solat.browser-visual-capture.v1';
const VISUAL_OBSERVATION_SCHEMA_VERSION = 'solat.browser-visual-observation.v1';
const TAB_LIST_SCHEMA_VERSION = 'solat.chrome-tab-list.v1';

class BrowserWorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserWorkspaceError';
    this.code = code;
  }
}

function boundedText(value, field, max = 256, { required = true } = {}) {
  const text = String(value ?? '').trim();
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new BrowserWorkspaceError('invalid_request', `${field} is invalid.`);
  }
  return text;
}

function privateIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function safeWebUrl(value) {
  const raw = boundedText(value, 'url', 2048);
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new BrowserWorkspaceError('invalid_url', 'The browser workspace URL is invalid.'); }
  const host = parsed.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !host) {
    throw new BrowserWorkspaceError('unsafe_url', 'Only credential-free public web URLs are allowed in the browser workspace.');
  }
  if (host.includes(':') || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]'
    || host === '0:0:0:0:0:0:0:1' || privateIpv4(host) || host.endsWith('.local')) {
    throw new BrowserWorkspaceError('unsafe_url', 'Local and private-network URLs are not allowed in the browser workspace.');
  }
  parsed.hash = '';
  return parsed.toString();
}

// Kept as a compatibility export for the V3 tool boundary. The browser now
// supports ordinary public HTTP pages as Chrome does, while still rejecting
// local/private targets and credentials embedded in the URL.
const safeHttpsUrl = safeWebUrl;

function normalizeBrowserInput(value) {
  const raw = boundedText(value, 'address_or_search', 2048);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/iu.test(raw);
  const looksLikeHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|$)/iu.test(raw);
  if (!hasScheme && !looksLikeHost) {
    return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
  }
  return safeWebUrl(hasScheme ? raw : `https://${raw}`);
}

function positiveInteger(value, field, { min = 0, max = 10000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new BrowserWorkspaceError('invalid_request', `${field} is invalid.`);
  }
  return number;
}

function normalizeBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserWorkspaceError('invalid_request', 'bounds is invalid.');
  }
  return Object.freeze({
    x: positiveInteger(value.x, 'bounds.x'),
    y: positiveInteger(value.y, 'bounds.y'),
    width: positiveInteger(value.width, 'bounds.width', { min: 320 }),
    height: positiveInteger(value.height, 'bounds.height', { min: 240 }),
  });
}

function normalizeOpenRequest(value = {}) {
  const mode = boundedText(value.mode || 'focused', 'mode', 16);
  if (!['peek', 'focused', 'expanded'].includes(mode)) throw new BrowserWorkspaceError('invalid_request', 'mode is invalid.');
  return Object.freeze({
    session_id: boundedText(value.sessionId, 'session_id', 256),
    url: safeHttpsUrl(value.url),
    mode,
    bounds: value.bounds === undefined ? null : normalizeBounds(value.bounds),
  });
}

function normalizeSurfaceRef(value = {}) {
  return Object.freeze({
    session_id: boundedText(value.sessionId, 'session_id', 256),
    surface_id: boundedText(value.surfaceId, 'surface_id', 160),
  });
}

function normalizeTabListRequest(value = {}) {
  return Object.freeze({ session_id: boundedText(value.sessionId, 'session_id', 256) });
}

function normalizeTabSwitchRequest(value = {}) {
  return Object.freeze({
    ...normalizeTabListRequest(value),
    tab_ref: boundedText(value.tabRef, 'tab_ref', 160),
  });
}

function normalizeTargetRef(value = {}) {
  return Object.freeze({
    ...normalizeSurfaceRef(value),
    navigation_revision: positiveInteger(value.navigationRevision, 'navigation_revision', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    target_id: boundedText(value.targetId, 'target_id', 160),
  });
}

function normalizeVisualRef(value = {}) {
  const normalized = {
    ...normalizeSurfaceRef(value),
    navigation_revision: positiveInteger(value.navigationRevision, 'navigation_revision', { min: 1, max: Number.MAX_SAFE_INTEGER }),
  };
  if (value.captureId !== undefined) normalized.capture_id = boundedText(value.captureId, 'capture_id', 160);
  if (value.captureSha256 !== undefined) {
    const hash = boundedText(value.captureSha256, 'capture_sha256', 71);
    if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) throw new BrowserWorkspaceError('invalid_request', 'capture_sha256 is invalid.');
    normalized.capture_sha256 = hash;
  }
  return Object.freeze(normalized);
}

function normalizeAction(value = {}) {
  const ref = normalizeTargetRef(value);
  const action = boundedText(value.action, 'action', 24);
  if (!['click', 'fill', 'scroll_into_view'].includes(action)) {
    throw new BrowserWorkspaceError('invalid_request', 'action is invalid.');
  }
  const normalized = { ...ref, action };
  if (action === 'fill') normalized.value = boundedText(value.value, 'value', 4000);
  else if (value.value !== undefined) throw new BrowserWorkspaceError('invalid_request', 'value is allowed only for fill.');
  if (action === 'click') {
    const verify = boundedText(value.verify, 'verify', 24);
    if (!['navigation', 'target_gone'].includes(verify)) throw new BrowserWorkspaceError('invalid_request', 'verify is invalid.');
    normalized.verify = verify;
  } else if (value.verify !== undefined) {
    throw new BrowserWorkspaceError('invalid_request', 'verify is allowed only for click.');
  }
  return Object.freeze(normalized);
}

module.exports = {
  ACTION_SCHEMA_VERSION,
  BrowserWorkspaceError,
  EVENT_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  SURFACE_SCHEMA_VERSION,
  VISUAL_CAPTURE_SCHEMA_VERSION,
  VISUAL_OBSERVATION_SCHEMA_VERSION,
  TAB_LIST_SCHEMA_VERSION,
  normalizeAction,
  normalizeBrowserInput,
  normalizeBounds,
  normalizeOpenRequest,
  normalizeSurfaceRef,
  normalizeTabListRequest,
  normalizeTabSwitchRequest,
  normalizeTargetRef,
  normalizeVisualRef,
  safeWebUrl,
  safeHttpsUrl,
};
