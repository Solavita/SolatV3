const test = require('node:test');
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  ExportError,
  exportEditableHtml,
  inspectEditableHtml,
  renderEditableHtml,
} = require('../src/core/exporter');

function fixtureDocument() {
  return {
    document_version: '1.0',
    document_id: 'doc_export_1',
    project_id: 'prj_export_1',
    design_system_id: 'ds_export_1',
    revision: 2,
    canvas: { width: 10, height: 6, unit: 'in' },
    provenance: { source: 'owner-input', note: '<do not execute>' },
    user_locks: ['e_locked'],
    slides: [{
      slide_id: 'slide_1',
      role: 'opening',
      elements: [
        { element_id: 'e_title', type: 'text', content: '<script>alert("x")</script>', box: { x: 0.5, y: 0.5, w: 4, h: 0.8 }, locked: false },
        { element_id: 'e_locked', type: 'text', content: 'Owner locked copy', box: { x: 0.5, y: 1.5, w: 4, h: 0.8 }, locked: false },
        { element_id: 'e_image', type: 'original_image', asset_id: 'asset_original_1', alt: 'Original photo', box: { x: 5, y: 0.5, w: 4.5, h: 4 } },
        { element_id: 'e_source', type: 'citation', content: 'Trusted source', url: 'https://example.com/source?a=1&b=2', box: { x: 0.5, y: 5, w: 8, h: 0.5 } },
      ],
    }],
  };
}

function fixtureAssets() {
  return [{
    asset_id: 'asset_original_1',
    project_id: 'prj_export_1',
    owner_id: 'owner_export_1',
    asset_class: 'ORIGINAL_USER_ASSET',
    mime_type: 'image/png',
    size_bytes: 7,
    hash: 'sha256:abc',
    immutable_original: true,
    source: { kind: 'upload', file_name: 'photo.png', storage_ref: 'owner_export_1/prj_export_1/asset_original_1/original.bin' },
    transformations: [],
    retention: { state: 'active', deletion_requested_at: null },
  }];
}

test('editable HTML export is deterministic, escaped, editable, and preserves lock/asset/provenance metadata', () => {
  const input = { document: fixtureDocument(), designSystem: { tokens: { colour: { accent: '#123456' } } }, assets: fixtureAssets(), provenance: { workflow: 'creative-v1', creative_result_id: 'creative_export_1', provider: 'test-provider', model: 'test-model' } };
  const first = renderEditableHtml(input);
  const second = renderEditableHtml(input);
  assert.equal(first.html, second.html);
  assert.deepEqual(first.manifest, second.manifest);
  assert.match(first.html, /data-document-id="doc_export_1"/);
  assert.match(first.html, /class="solat-slide" data-slide-id="slide_1"/);
  assert.match(first.html, /data-element-id="e_title"/);
  assert.match(first.html, /contenteditable="true"/);
  assert.match(first.html, /contenteditable="false"[^>]*>/);
  assert.match(first.html, /data-asset-id="asset_original_1"/);
  assert.match(first.html, /solat-export-manifest/);
  assert.match(first.html, /\\u003cscript\\u003ealert/);
  assert.doesNotMatch(first.html, /<script>alert\("x"\)<\/script>/);
  assert.equal(first.manifest.asset_refs[0], 'asset_original_1');
  assert.equal(first.manifest.assets[0].immutable_original, true);
  assert.equal(first.manifest.locks[0], 'e_locked');
  assert.equal(first.manifest.provenance.export.workflow, 'creative-v1');
  assert.equal(first.manifest.editable_document.slides[0].elements[1].locked, false);
  const inspection = inspectEditableHtml({ html: first.html, manifest: first.manifest });
  assert.equal(inspection.status, 'PASS');
  assert.equal(inspection.slideCount, 1);
  assert.equal(inspection.elementCount, 4);
  assert.equal(inspection.editableCount, 3);
  assert.deepEqual(inspection.assetRefs, ['asset_original_1']);
});

test('editable HTML export refuses ungrounded assets and unsafe citation URLs', () => {
  assert.throws(() => renderEditableHtml({ document: fixtureDocument() }), error => error instanceof ExportError && error.code === 'asset_missing');
  const unsafe = fixtureDocument();
  unsafe.slides[0].elements[3].url = 'javascript:alert(1)';
  assert.throws(() => renderEditableHtml({ document: unsafe, assets: fixtureAssets() }), error => error instanceof ExportError && error.code === 'unsafe_reference');
});

test('editable HTML export writes immutable-by-revision files and rejects accidental overwrite', async () => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'solat-v2-export-'));
  try {
    const result = await exportEditableHtml({ document: fixtureDocument(), assets: fixtureAssets(), outputRoot: root });
    const expected = renderEditableHtml({ document: fixtureDocument(), assets: fixtureAssets() });
    assert.equal(await fsPromises.readFile(result.html_path, 'utf8'), expected.html);
    const manifest = JSON.parse(await fsPromises.readFile(result.manifest_path, 'utf8'));
    assert.equal(manifest.export_schema_version, '1.0');
    assert.equal(manifest.format, 'editable_html');
    assert.equal(manifest.revision, 2);
    await assert.rejects(() => exportEditableHtml({ document: fixtureDocument(), assets: fixtureAssets(), outputRoot: root }), error => error.code === 'export_exists');
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true });
  }
});
