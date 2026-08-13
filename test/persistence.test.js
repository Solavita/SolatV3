const test = require('node:test');
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CreativePersistence } = require('../src/core/creative-persistence');

test('creative persistence restores revision/export/inspection metadata by session', async () => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'solat-v2-creative-history-'));
  try {
    const persistence = new CreativePersistence({ rootDir: root, idFactory: () => 'tmp' });
    const original = { id: 'creative-original', status: 'READY_FOR_EDIT', revisionOf: null, artifacts: { document: { slides: [{ elements: [{ element_id: 'e1' }] }] } } };
    const revision = { id: 'creative-revision', status: 'READY_FOR_EDIT', revisionOf: 'creative-original', artifacts: { document: { slides: [{ elements: [{ element_id: 'e2' }] }] } } };
    await persistence.saveResult({ sessionId: 'session-a', result: original });
    await persistence.saveResult({ sessionId: 'session-a', result: revision });
    await persistence.recordExport({ sessionId: 'session-a', creativeId: 'creative-revision', exported: { htmlPath: 'index.html', revision: 1 } });
    await persistence.recordInspection({ sessionId: 'session-a', creativeId: 'creative-revision', inspection: { status: 'PASS', slideCount: 1, elementCount: 1, assetRefs: [] } });
    const restored = await persistence.loadHistory({ sessionId: 'session-a' });
    assert.equal(restored.history.length, 2);
    assert.equal(restored.history[1].result.revisionOf, 'creative-original');
    assert.equal(restored.history[1].exported.htmlPath, 'index.html');
    assert.equal(restored.history[1].inspection.status, 'PASS');
    await assert.rejects(() => persistence.loadHistory({ sessionId: '../session-a' }), error => error.code === 'invalid_request');
    const other = await persistence.loadHistory({ sessionId: 'session-b' });
    assert.deepEqual(other.history, []);
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true });
  }
});
