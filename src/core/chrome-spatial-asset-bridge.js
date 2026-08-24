const { safeWebUrl } = require('./browser-workspace-contracts');

const MAX_CHROME_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CHROME_IMAGE_DIMENSION = 4096;
const MAX_CHROME_IMAGE_PIXELS = 16_777_216;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function bridgeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeChromeImageTransfer(input = {}) {
  const sessionId = String(input.sessionId || '').trim();
  const mimeType = String(input.mimeType || '').trim().toLowerCase();
  const label = String(input.label || 'Chrome image').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 240) || 'Chrome image';
  const bytes = Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : Buffer.from(input.bytes || []);
  if (!sessionId || sessionId.length > 256) throw bridgeError('invalid_request', 'A bounded session id is required.');
  if (!IMAGE_TYPES.has(mimeType)) throw bridgeError('invalid_chrome_image', 'Chrome transfer must be a PNG, JPEG, WebP or GIF image.');
  if (!bytes.length || bytes.length > MAX_CHROME_IMAGE_BYTES) throw bridgeError('invalid_chrome_image', 'Chrome image is empty or exceeds 8 MB.');
  let sourceUrl = null;
  if (String(input.sourceUrl || '').trim()) sourceUrl = safeWebUrl(input.sourceUrl);
  return Object.freeze({ sessionId, mimeType, label, bytes, sourceUrl });
}

function createChromeSpatialAssetBridge({ nativeImage, adoptSelection, now = Date.now } = {}) {
  if (!nativeImage?.createFromBuffer || typeof adoptSelection !== 'function') {
    throw new TypeError('Chrome SpatialAsset bridge dependencies are required.');
  }
  return async function importChromeImage({ ownerId, sender, request } = {}) {
    const input = normalizeChromeImageTransfer(request);
    let image = nativeImage.createFromBuffer(input.bytes);
    if (!image || image.isEmpty?.()) throw bridgeError('invalid_chrome_image', 'Chrome image could not be decoded.');
    const size = image.getSize?.() || {};
    const width = Number(size.width); const height = Number(size.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw bridgeError('invalid_chrome_image', 'Chrome image dimensions are invalid.');
    }
    const scale = Math.min(1, MAX_CHROME_IMAGE_DIMENSION / Math.max(width, height), Math.sqrt(MAX_CHROME_IMAGE_PIXELS / (width * height)));
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), quality: 'good' });
    const finalSize = image.getSize();
    const png = Buffer.from(image.toPNG());
    if (!png.length || png.length > MAX_CHROME_IMAGE_BYTES) throw bridgeError('invalid_chrome_image', 'Decoded Chrome image exceeds the bounded transfer limit.');
    const surface = { surface_id: 'blue-workspace-main', kind: 'blue_workspace', tab_id: input.sessionId, revision: 0 };
    return adoptSelection({
      ownerId, sessionId: input.sessionId, sender, surface,
      selection: {
        label: input.label,
        tag: 'img',
        // Chrome does not expose trusted DOM geometry to SOLAT. The pixels and
        // provenance are real, while the Blue pointer starts at a neutral
        // bounded coordinate and is immediately moved by the owner.
        bounds: { x: 0, y: 0, width: 2, height: 2 },
        page_url: input.sourceUrl,
        source_kind: 'chrome_lane_selection',
        imported_at_ms: Math.round(now()),
      },
      capture: { media_type: 'image/png', bytes: png, width: finalSize.width, height: finalSize.height },
    });
  };
}

module.exports = {
  IMAGE_TYPES,
  MAX_CHROME_IMAGE_BYTES,
  createChromeSpatialAssetBridge,
  normalizeChromeImageTransfer,
};
