const assert = require('node:assert/strict');
const test = require('node:test');
const { browserWorkspaceEventToMultimodal, createBrowserSpatialAssetBridge } = require('../src/core/browser-spatial-asset-bridge');

test('verified browser observations become screen timeline evidence while lifecycle events remain surface context', () => {
  const surface = { surface_id: 'browser-1', navigation_revision: 4 };
  assert.deepEqual(browserWorkspaceEventToMultimodal({ type: 'screen_observed', surface, screen_hash: `sha256:${'a'.repeat(64)}` }, () => 1700), {
    source: 'screen', type: 'screen_observed', occurred_at_ms: 1700,
    payload: { surface_id: 'browser-1', surface_kind: 'browser_workspace', navigation_revision: 4, screen_hash: `sha256:${'a'.repeat(64)}` },
  });
  assert.equal(browserWorkspaceEventToMultimodal({ type: 'asset_selected', surface }, () => 1700), null);
  assert.equal(browserWorkspaceEventToMultimodal({ type: 'navigation', surface }, () => 1700).type, 'surface_activated');
});

test('browser selection persists one immutable original and begins one owner-scoped held ghost', async () => {
  const calls = [];
  const sender = { isDestroyed: () => false, send: (...args) => calls.push(['send', ...args]) };
  const services = {
    core: { workspace: {
      getProject: sessionId => (calls.push(['project', sessionId]), { project_id: 'project-1' }),
      linkProject: input => calls.push(['link', input]),
    } },
    assetStore: { storeOriginal: async input => {
      calls.push(['store', input]);
      return { asset_id: 'original-1', hash: `sha256:${'a'.repeat(64)}`, mime_type: 'image/png' };
    } },
    spatialAssetRuntime: {
      register: (input, scope) => (calls.push(['register', input, scope]), { spatial_asset_id: 'spatial-1', ...input }),
      select: input => calls.push(['select', input]),
      beginDrag: input => (calls.push(['begin', input]), { ghost: { ghost_id: 'ghost-1', spatial_asset_id: 'spatial-1' } }),
    },
  };
  const adopt = createBrowserSpatialAssetBridge({ services, now: () => 42 });
  const surface = { surface_id: 'browser-1', kind: 'browser_workspace', revision: 7 };
  const result = await adopt({
    ownerId: 'renderer:9', sessionId: 'session-1', sender, surface,
    selection: { label: 'Reference', tag: 'img', page_url: 'https://example.com/page', bounds: { x: 10, y: 20, width: 80, height: 40 } },
    capture: { media_type: 'image/png', bytes: Buffer.from([1, 2, 3]), width: 80, height: 40 },
  });

  assert.deepEqual(result, { spatial_asset_id: 'spatial-1', ghost_id: 'ghost-1' });
  const stored = calls.find(call => call[0] === 'store')[1];
  assert.equal(stored.ownerId, 'session-1');
  assert.equal(stored.fileName, 'browser-selection-42.png');
  assert.deepEqual(stored.bytes, Buffer.from([1, 2, 3]));
  assert.deepEqual(stored.sourceMetadata, {
    kind: 'browser_workspace_selection', page_url: 'https://example.com/page', element_tag: 'img', navigation_revision: 7,
  });
  assert.deepEqual(calls.find(call => call[0] === 'register')[2], { ownerId: 'renderer:9', sessionId: 'session-1' });
  assert.deepEqual(calls.find(call => call[0] === 'register')[1].provenance, {
    source_kind: 'browser_workspace_selection', source_url: 'https://example.com/page', element_tag: 'img', navigation_revision: 7,
  });
  assert.equal(calls.filter(call => call[0] === 'begin').length, 1);
  assert.deepEqual(calls.find(call => call[0] === 'begin')[1].pointer, { x: 50, y: 40, display_id: 'browser-workspace' });
  const event = calls.find(call => call[0] === 'send');
  assert.equal(event[1], 'solat:browser-asset-selected');
  assert.equal(event[2].schema_version, 'solat.browser-asset-selection.v1');
  assert.deepEqual(Buffer.from(event[2].preview_bytes), Buffer.from([1, 2, 3]));
});

test('browser selection rejects an empty or non-PNG capture before persistence', async () => {
  let stored = 0;
  const adopt = createBrowserSpatialAssetBridge({ services: {
    core: { workspace: { getProject: () => ({ project_id: 'project-1' }) } },
    assetStore: { storeOriginal: async () => { stored += 1; } },
    spatialAssetRuntime: { register: () => ({}) },
  } });
  await assert.rejects(() => adopt({ sessionId: 'session-1', capture: { media_type: 'image/jpeg', bytes: [1] } }), error => error.code === 'invalid_browser_asset_capture');
  await assert.rejects(() => adopt({ sessionId: 'session-1', capture: { media_type: 'image/png', bytes: [] } }), error => error.code === 'invalid_browser_asset_capture');
  assert.equal(stored, 0);
});
