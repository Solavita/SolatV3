const fs = require('node:fs');
const path = require('node:path');
const { deepFreeze } = require('./contracts');

const EXPORT_SCHEMA_VERSION = '1.0';
const SUPPORTED_UNITS = new Set(['in', 'px', 'cm', 'mm']);
const SUPPORTED_ELEMENT_TYPES = new Set([
  'text', 'original_image', 'generated_image', 'shape', 'line', 'icon', 'table', 'chart',
  'group', 'background', 'media_placeholder', 'citation',
]);
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|transparent|currentColor|rgb\([^;{}]+\)|rgba\([^;{}]+\)|hsl\([^;{}]+\)|hsla\([^;{}]+\))$/;

class ExportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value), null, 2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeJsonForHtml(value) {
  // JSON in a script element must not be allowed to close that element.
  return stableJson(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ExportError('export_invalid', `${field} is required.`, { field });
  return value.trim();
}

function safeToken(value, field) {
  const normalized = requiredText(value, field);
  if (!SAFE_TOKEN.test(normalized)) throw new ExportError('export_invalid', `${field} contains an unsafe identifier.`, { field });
  return normalized;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ExportError('export_invalid', `${field} must be a finite number.`, { field });
  return number;
}

function formatNumber(value, field) {
  const number = finiteNumber(value, field);
  return Number(number.toFixed(4)).toString();
}

function validateBox(box, field, canvas) {
  if (!box || typeof box !== 'object') throw new ExportError('export_invalid', `${field}.box is required.`, { field });
  const x = finiteNumber(box.x, `${field}.box.x`);
  const y = finiteNumber(box.y, `${field}.box.y`);
  const w = finiteNumber(box.w, `${field}.box.w`);
  const h = finiteNumber(box.h, `${field}.box.h`);
  if (w <= 0 || h <= 0) throw new ExportError('export_invalid', `${field}.box must have positive dimensions.`, { field });
  if (x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) {
    throw new ExportError('export_overflow', `${field}.box exceeds the document canvas.`, { field, canvas });
  }
  return { x, y, w, h };
}

function validateCanvas(canvas) {
  if (!canvas || typeof canvas !== 'object') throw new ExportError('export_invalid', 'A document canvas is required.');
  const width = finiteNumber(canvas.width, 'canvas.width');
  const height = finiteNumber(canvas.height, 'canvas.height');
  const unit = typeof canvas.unit === 'string' && canvas.unit.trim() ? canvas.unit.trim() : 'in';
  if (width <= 0 || height <= 0 || !SUPPORTED_UNITS.has(unit)) throw new ExportError('export_invalid', 'The document canvas is invalid.');
  return { width, height, unit };
}

function collectAssetRefs(document) {
  const refs = new Set();
  for (const [slideIndex, slide] of (document.slides || []).entries()) {
    for (const [elementIndex, element] of (slide.elements || []).entries()) {
      const field = `slides[${slideIndex}].elements[${elementIndex}]`;
      if (element.asset_id !== undefined && element.asset_id !== null) refs.add(requiredText(element.asset_id, `${field}.asset_id`));
      if (element.asset_ref !== undefined && element.asset_ref !== null) refs.add(requiredText(element.asset_ref, `${field}.asset_ref`));
    }
  }
  return [...refs].sort();
}

function collectAssetIds(document) {
  const ids = new Set();
  for (const slide of (document.slides || [])) {
    for (const element of (slide.elements || [])) {
      if (element.asset_id !== undefined && element.asset_id !== null) ids.add(requiredText(element.asset_id, 'element.asset_id'));
    }
  }
  return [...ids].sort();
}

function normalizeAssets(assets, requiredRefs) {
  if (assets === undefined || assets === null) assets = [];
  if (!Array.isArray(assets)) throw new ExportError('export_invalid', 'assets must be an array.');
  const normalized = assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') throw new ExportError('export_invalid', `assets[${index}] must be an object.`);
    const assetId = requiredText(asset.asset_id, `assets[${index}].asset_id`);
    return {
      asset_id: assetId,
      project_id: asset.project_id ?? null,
      owner_id: asset.owner_id ?? null,
      asset_class: asset.asset_class ?? null,
      mime_type: asset.mime_type ?? null,
      size_bytes: asset.size_bytes ?? null,
      hash: asset.hash ?? null,
      immutable_original: Boolean(asset.immutable_original),
      parent_asset_id: asset.parent_asset_id ?? null,
      source: clone(asset.source || {}),
      transformations: clone(asset.transformations || []),
      storage_ref: asset.source?.storage_ref ?? null,
      retention: clone(asset.retention || {}),
    };
  });
  const ids = new Set(normalized.map(asset => asset.asset_id));
  const missing = requiredRefs.filter(ref => !ids.has(ref));
  if (missing.length) throw new ExportError('asset_missing', 'The export cannot complete because referenced assets are missing.', { missing_asset_refs: missing });
  return normalized.sort((left, right) => left.asset_id.localeCompare(right.asset_id));
}

function getColor(designSystem, pathParts, fallback) {
  let value = designSystem;
  for (const part of pathParts) value = value?.[part];
  return typeof value === 'string' && SAFE_COLOR.test(value.trim()) ? value.trim() : fallback;
}

function normalizedLocks(document, userLocks) {
  const locks = new Set(Array.isArray(document.user_locks) ? document.user_locks.map(String) : []);
  if (Array.isArray(userLocks)) userLocks.forEach(lock => locks.add(String(lock)));
  return [...locks].sort();
}

function textContent(element) {
  if (element.content === undefined || element.content === null) return element.label ?? element.title ?? '';
  if (typeof element.content === 'string' || typeof element.content === 'number') return String(element.content);
  return stableJson(element.content);
}

function sourceLink(element, field) {
  if (element[field] === undefined || element[field] === null || element[field] === '') return '';
  const value = requiredText(element[field], `${field}`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new ExportError('unsafe_reference', `${field} must be an absolute HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ExportError('unsafe_reference', `${field} must use HTTP(S).`);
  return value;
}

function elementStyle(box, unit) {
  return `left:${formatNumber(box.x, 'box.x')}${unit};top:${formatNumber(box.y, 'box.y')}${unit};width:${formatNumber(box.w, 'box.w')}${unit};height:${formatNumber(box.h, 'box.h')}${unit};`;
}

function renderElement(element, field, canvas, locks, depth = 0) {
  if (depth > 8) throw new ExportError('export_invalid', `${field} nesting is too deep.`);
  if (!element || typeof element !== 'object') throw new ExportError('export_invalid', `${field} must be an object.`);
  const type = requiredText(element.type, `${field}.type`);
  if (!SUPPORTED_ELEMENT_TYPES.has(type)) throw new ExportError('export_invalid', `Unsupported element type: ${type}.`, { field });
  const elementId = requiredText(element.element_id, `${field}.element_id`);
  const box = validateBox(element.box, field, canvas);
  const locked = Boolean(element.locked) || locks.includes(elementId);
  const editable = locked ? 'false' : 'true';
  const data = [`data-element-id="${escapeHtml(elementId)}"`, `data-element-type="${escapeHtml(type)}"`, `data-locked="${locked}"`, `contenteditable="${editable}"`];
  if (element.asset_id !== undefined && element.asset_id !== null) data.push(`data-asset-id="${escapeHtml(requiredText(element.asset_id, `${field}.asset_id`))}"`);
  if (element.asset_ref !== undefined && element.asset_ref !== null) data.push(`data-asset-ref="${escapeHtml(requiredText(element.asset_ref, `${field}.asset_ref`))}"`);
  if (element.provenance !== undefined) data.push(`data-provenance="${escapeHtml(escapeJsonForHtml(element.provenance))}"`);
  const base = `<div class="solat-element solat-element--${escapeHtml(type)}" ${data.join(' ')} style="${elementStyle(box, canvas.unit)}">`;
  if (type === 'group') {
    if (!Array.isArray(element.children)) throw new ExportError('export_invalid', `${field}.children must be an array.`);
    const children = element.children.map((child, index) => renderElement(child, `${field}.children[${index}]`, canvas, locks, depth + 1)).join('');
    return `${base}${children}</div>`;
  }
  if (type === 'original_image' || type === 'generated_image') {
    const assetRef = element.asset_id ?? element.asset_ref;
    if (assetRef === undefined || assetRef === null || !String(assetRef).trim()) throw new ExportError('asset_missing', `${field} requires an asset_id or asset_ref.`);
    const alt = escapeHtml(element.alt ?? element.label ?? `Asset ${assetRef}`);
    return `${base}<span class="solat-asset-placeholder" role="img" aria-label="${alt}">${escapeHtml(`[${assetRef}]`)}</span></div>`;
  }
  if (type === 'citation') {
    const url = sourceLink(element, 'url');
    const label = escapeHtml(textContent(element) || url || 'Source');
    return `${base}${url ? `<a href="${escapeHtml(url)}" rel="noreferrer noopener" target="_blank">${label}</a>` : label}</div>`;
  }
  const value = escapeHtml(textContent(element));
  return `${base}${value}</div>`;
}

function validateDocument(document) {
  if (!document || typeof document !== 'object') throw new ExportError('export_invalid', 'A creative document is required.');
  const documentId = safeToken(document.document_id, 'document_id');
  const projectId = safeToken(document.project_id, 'project_id');
  const revision = Number(document.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new ExportError('export_invalid', 'document.revision must be a positive integer.');
  if (!Array.isArray(document.slides) || document.slides.length === 0) throw new ExportError('export_invalid', 'A document must contain at least one slide.');
  return { documentId, projectId, revision, canvas: validateCanvas(document.canvas) };
}

function buildManifest({ document, designSystem, assets, provenance, userLocks, assetRefs, canvas }) {
  return {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    format: 'editable_html',
    document_id: document.document_id,
    project_id: document.project_id,
    document_version: document.document_version ?? null,
    revision: document.revision,
    design_system_id: document.design_system_id ?? null,
    canvas,
    asset_refs: assetRefs,
    assets,
    locks: normalizedLocks(document, userLocks),
    provenance: {
      document: clone(document.provenance || {}),
      export: clone(provenance || {}),
    },
    editable_document: clone(document),
    design_system: clone(designSystem || {}),
  };
}

function renderEditableHtml({ document, designSystem = {}, assets = [], provenance = {}, userLocks = [] } = {}) {
  const validated = validateDocument(document);
  const assetRefs = collectAssetRefs(document);
  const normalizedAssets = normalizeAssets(assets, assetRefs);
  const locks = normalizedLocks(document, userLocks);
  const manifest = buildManifest({ document, designSystem, assets: normalizedAssets, provenance, userLocks, assetRefs, canvas: validated.canvas });
  const background = getColor(designSystem, ['tokens', 'colour', 'background'], '#ffffff');
  const text = getColor(designSystem, ['tokens', 'colour', 'text'], '#1f2937');
  const accent = getColor(designSystem, ['tokens', 'colour', 'accent'], '#6d28d9');
  const slides = document.slides.map((slide, slideIndex) => {
    const slideId = safeToken(slide.slide_id, `slides[${slideIndex}].slide_id`);
    if (!Array.isArray(slide.elements) || slide.elements.length === 0) throw new ExportError('export_invalid', `slides[${slideIndex}].elements must contain at least one element.`);
    const role = escapeHtml(slide.role ?? 'content');
    const elements = slide.elements.map((element, elementIndex) => renderElement(element, `slides[${slideIndex}].elements[${elementIndex}]`, validated.canvas, locks)).join('');
    return `<section class="solat-slide" data-slide-id="${escapeHtml(slideId)}" data-role="${role}" style="width:${formatNumber(validated.canvas.width, 'canvas.width')}${validated.canvas.unit};height:${formatNumber(validated.canvas.height, 'canvas.height')}${validated.canvas.unit};"><div class="solat-slide__surface">${elements}</div></section>`;
  }).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SOLAT editable document ${escapeHtml(document.document_id)}</title>
  <style>
    :root { color-scheme: light; --solat-background: ${background}; --solat-text: ${text}; --solat-accent: ${accent}; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f3f4f6; color: var(--solat-text); font-family: Inter, system-ui, sans-serif; }
    .solat-export { display: grid; gap: 24px; justify-items: center; }
    .solat-slide { position: relative; overflow: hidden; background: var(--solat-background); box-shadow: 0 8px 30px rgba(15,23,42,.12); }
    .solat-slide__surface { position: absolute; inset: 0; }
    .solat-element { position: absolute; overflow: hidden; white-space: pre-wrap; outline: none; padding: 4px; }
    .solat-element[data-locked="true"] { cursor: not-allowed; }
    .solat-element[data-locked="false"]:focus { outline: 2px solid var(--solat-accent); outline-offset: -2px; }
    .solat-asset-placeholder { display: grid; width: 100%; height: 100%; place-items: center; border: 1px dashed var(--solat-accent); color: var(--solat-accent); font-size: .85em; }
    .solat-element--citation a { color: var(--solat-accent); }
  </style>
</head>
<body>
  <main class="solat-export" data-document-id="${escapeHtml(document.document_id)}" data-project-id="${escapeHtml(document.project_id)}" data-revision="${escapeHtml(document.revision)}">
    ${slides}
  </main>
  <script type="application/json" id="solat-export-manifest">${escapeJsonForHtml(manifest)}</script>
</body>
</html>
`;
  return deepFreeze({ html, manifest: deepFreeze(manifest) });
}

function inspectEditableHtml({ html, manifest } = {}) {
  const issues = [];
  if (typeof html !== 'string' || !html.trim()) issues.push({ code: 'html_missing', detail: 'The exported HTML is empty.' });
  if (!manifest || typeof manifest !== 'object') issues.push({ code: 'manifest_missing', detail: 'The export manifest is missing.' });
  const source = typeof html === 'string' ? html : '';
  const slideCount = (source.match(/class="solat-slide"/g) || []).length;
  const elementCount = (source.match(/class="solat-element /g) || []).length;
  const editableCount = (source.match(/contenteditable="true"/g) || []).length;
  const lockedCount = (source.match(/data-locked="true"/g) || []).length;
  if (!source.includes('class="solat-export"')) issues.push({ code: 'export_root_missing', detail: 'The editable export root is missing.' });
  if (!source.includes('id="solat-export-manifest"')) issues.push({ code: 'manifest_node_missing', detail: 'The embedded export manifest node is missing.' });
  const expectedSlides = Array.isArray(manifest?.editable_document?.slides) ? manifest.editable_document.slides.length : null;
  const expectedElements = expectedSlides === null ? null : manifest.editable_document.slides.reduce((sum, slide) => sum + (Array.isArray(slide.elements) ? slide.elements.length : 0), 0);
  if (expectedSlides !== null && expectedSlides !== slideCount) issues.push({ code: 'slide_count_mismatch', detail: `HTML has ${slideCount} slides but manifest has ${expectedSlides}.` });
  if (expectedElements !== null && expectedElements !== elementCount) issues.push({ code: 'element_count_mismatch', detail: `HTML has ${elementCount} elements but manifest has ${expectedElements}.` });
  const assetRefs = Array.isArray(manifest?.asset_refs) ? [...new Set(manifest.asset_refs.map(String))].sort() : [];
  const assets = Array.isArray(manifest?.assets) ? manifest.assets.map(asset => String(asset?.asset_id || '')).filter(Boolean).sort() : [];
  const missingAssets = assetRefs.filter(assetId => !assets.includes(assetId));
  if (missingAssets.length) issues.push({ code: 'asset_manifest_mismatch', detail: `Manifest is missing asset metadata for: ${missingAssets.join(', ')}` });
  const provenance = manifest?.provenance?.export || {};
  if (!provenance.creative_result_id || !provenance.provider || !provenance.model) issues.push({ code: 'provenance_missing', detail: 'Export provenance is incomplete.' });
  return deepFreeze({ status: issues.length ? 'FAIL' : 'PASS', issues, slideCount, elementCount, editableCount, lockedCount, assetRefs, provenance: clone(provenance) });
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ExportError('export_storage_error', 'Export path escaped the output root.');
}

async function exportEditableHtml({ document, designSystem = {}, assets = [], provenance = {}, userLocks = [], outputRoot, fsImpl = fs.promises } = {}) {
  if (typeof outputRoot !== 'string' || !outputRoot.trim()) throw new ExportError('export_invalid', 'outputRoot is required.');
  const root = path.resolve(outputRoot);
  const rendered = renderEditableHtml({ document, designSystem, assets, provenance, userLocks });
  const validated = validateDocument(document);
  const directory = path.join(root, `solat-${validated.projectId}-${validated.documentId}-r${validated.revision}`);
  const htmlPath = path.join(directory, 'index.html');
  const manifestPath = path.join(directory, 'manifest.json');
  assertInside(root, directory); assertInside(root, htmlPath); assertInside(root, manifestPath);
  await fsImpl.mkdir(root, { recursive: true });
  try {
    await fsImpl.mkdir(directory);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new ExportError('export_exists', 'An export already exists for this document revision.', { directory });
    throw new ExportError('export_storage_error', 'The export directory could not be created.');
  }
  try {
    await fsImpl.writeFile(htmlPath, rendered.html, { flag: 'wx', encoding: 'utf8' });
    await fsImpl.writeFile(manifestPath, stableJson(rendered.manifest), { flag: 'wx', encoding: 'utf8' });
  } catch (error) {
    await fsImpl.rm(directory, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ExportError) throw error;
    throw new ExportError('export_storage_error', 'The editable export could not be written.');
  }
  return deepFreeze({ ...rendered.manifest, output_dir: directory, html_path: htmlPath, manifest_path: manifestPath });
}

module.exports = {
  EXPORT_SCHEMA_VERSION,
  ExportError,
  collectAssetRefs,
  escapeHtml,
  exportEditableHtml,
  inspectEditableHtml,
  renderEditableHtml,
  stableJson,
};
