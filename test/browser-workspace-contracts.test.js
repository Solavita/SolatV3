const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BrowserWorkspaceError, normalizeAction, normalizeBrowserInput, normalizeOpenRequest, normalizeVisualRef, safeHttpsUrl,
} = require('../src/core/browser-workspace-contracts');

test('browser workspace accepts bounded public HTTPS and strips fragments', () => {
  const request = normalizeOpenRequest({
    sessionId: 'thread-a', url: 'https://www.pinterest.com/search/pins/?q=design#private-fragment',
    mode: 'focused', bounds: { x: 20, y: 80, width: 900, height: 620 },
  });
  assert.equal(request.url, 'https://www.pinterest.com/search/pins/?q=design');
  assert.deepEqual(request.bounds, { x: 20, y: 80, width: 900, height: 620 });
  assert.equal(Object.isFrozen(request), true);
});

test('browser workspace accepts ordinary public HTTP and turns omnibox text into a Google search', () => {
  assert.equal(safeHttpsUrl('http://example.com/docs'), 'http://example.com/docs');
  assert.equal(normalizeBrowserInput('example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeBrowserInput('persona 3 blue UI'), 'https://www.google.com/search?q=persona%203%20blue%20UI');
});

test('browser workspace rejects local, credentialed and executable URLs', () => {
  for (const value of [
    'file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,hi',
    'https://localhost:8443/', 'https://127.0.0.1/', 'https://192.168.1.20/',
    'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
    'https://user:password@example.com/', 'https://printer.local/',
  ]) {
    assert.throws(() => safeHttpsUrl(value), error => error instanceof BrowserWorkspaceError && ['unsafe_url', 'invalid_url'].includes(error.code), value);
  }
});

test('browser actions bind an opaque target to one navigation revision', () => {
  assert.deepEqual(normalizeAction({
    sessionId: 'thread-a', surfaceId: 'surface-a', navigationRevision: 3,
    targetId: 'target-7', action: 'fill', value: 'bounded text',
  }), {
    session_id: 'thread-a', surface_id: 'surface-a', navigation_revision: 3,
    target_id: 'target-7', action: 'fill', value: 'bounded text',
  });
  assert.throws(() => normalizeAction({ sessionId: 'a', surfaceId: 'b', navigationRevision: 0, targetId: 'c', action: 'click', verify: 'navigation' }), /navigation_revision/u);
  assert.throws(() => normalizeAction({ sessionId: 'a', surfaceId: 'b', navigationRevision: 1, targetId: 'c', action: 'click', verify: 'navigation', value: 'hidden' }), /only for fill/u);
  assert.throws(() => normalizeAction({ sessionId: 'a', surfaceId: 'b', navigationRevision: 1, targetId: 'c', action: 'click', verify: 'maybe' }), /verify is invalid/u);
});

test('browser visual references bind a surface to one navigation revision', () => {
  assert.deepEqual(normalizeVisualRef({ sessionId: 'thread-a', surfaceId: 'surface-a', navigationRevision: 4 }), {
    session_id: 'thread-a', surface_id: 'surface-a', navigation_revision: 4,
  });
  assert.throws(() => normalizeVisualRef({ sessionId: 'thread-a', surfaceId: 'surface-a', navigationRevision: 0 }), /navigation_revision/u);
  assert.deepEqual(normalizeVisualRef({ sessionId: 'thread-a', surfaceId: 'surface-a', navigationRevision: 4, captureId: 'capture-1', captureSha256: `sha256:${'a'.repeat(64)}` }), {
    session_id: 'thread-a', surface_id: 'surface-a', navigation_revision: 4,
    capture_id: 'capture-1', capture_sha256: `sha256:${'a'.repeat(64)}`,
  });
  assert.throws(() => normalizeVisualRef({ sessionId: 'thread-a', surfaceId: 'surface-a', navigationRevision: 4, captureSha256: 'sha256:bad' }), /capture_sha256/u);
});
