const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_CHROME_IMAGE_BYTES,
  createChromeSpatialAssetBridge,
  normalizeChromeImageTransfer,
} = require('../src/core/chrome-spatial-asset-bridge');

test('Chrome image transfer accepts bounded public provenance but rejects local and oversized input', () => {
  const safe = normalizeChromeImageTransfer({
    sessionId: 'thread-a', mimeType: 'image/webp', bytes: Uint8Array.from([1, 2]),
    sourceUrl: 'https://i.pinimg.com/reference.webp#fragment', label: 'Reference',
  });
  assert.equal(safe.sourceUrl, 'https://i.pinimg.com/reference.webp');
  assert.equal(safe.bytes.length, 2);
  assert.throws(() => normalizeChromeImageTransfer({ sessionId: 'thread-a', mimeType: 'image/png', bytes: [1], sourceUrl: 'http://127.0.0.1/private.png' }), error => error.code === 'unsafe_url');
  assert.throws(() => normalizeChromeImageTransfer({ sessionId: 'thread-a', mimeType: 'image/svg+xml', bytes: [1] }), error => error.code === 'invalid_chrome_image');
  assert.throws(() => normalizeChromeImageTransfer({ sessionId: 'thread-a', mimeType: 'image/png', bytes: Buffer.alloc(MAX_CHROME_IMAGE_BYTES + 1) }), error => error.code === 'invalid_chrome_image');
});

test('Chrome clipboard bytes are decoded, bounded and enter the existing Blue SpatialAsset bridge', async () => {
  let adopted;
  const resized = {
    getSize: () => ({ width: 4096, height: 2048 }),
    toPNG: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  };
  const original = {
    isEmpty: () => false,
    getSize: () => ({ width: 8192, height: 4096 }),
    resize: options => {
      assert.deepEqual(options, { width: 4096, height: 2048, quality: 'good' });
      return resized;
    },
  };
  const bridge = createChromeSpatialAssetBridge({
    nativeImage: { createFromBuffer: bytes => (assert.deepEqual(Buffer.from(bytes), Buffer.from([1, 2, 3])), original) },
    adoptSelection: async input => { adopted = input; return { spatial_asset_id: 'spatial-1', ghost_id: 'ghost-1' }; },
    now: () => 42,
  });
  const sender = { id: 8 };
  const result = await bridge({ ownerId: 'renderer:8', sender, request: {
    sessionId: 'thread-a', mimeType: 'image/jpeg', bytes: Uint8Array.from([1, 2, 3]),
    sourceUrl: 'https://i.pinimg.com/reference.jpg', label: 'Pinterest reference',
  } });
  assert.deepEqual(result, { spatial_asset_id: 'spatial-1', ghost_id: 'ghost-1' });
  assert.equal(adopted.ownerId, 'renderer:8');
  assert.equal(adopted.sessionId, 'thread-a');
  assert.equal(adopted.sender, sender);
  assert.deepEqual(adopted.surface, { surface_id: 'blue-workspace-main', kind: 'blue_workspace', tab_id: 'thread-a', revision: 0 });
  assert.equal(adopted.selection.source_kind, 'chrome_lane_selection');
  assert.equal(adopted.selection.page_url, 'https://i.pinimg.com/reference.jpg');
  assert.deepEqual(adopted.capture.width, 4096);
});
