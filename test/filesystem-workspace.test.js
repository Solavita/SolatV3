const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  FILESYSTEM_RESULT_SCHEMA_VERSION,
  FilesystemWorkspace,
  FilesystemWorkspaceError,
  contentHash,
  normalizeRelativePath,
} = require('../src/core/filesystem-workspace');

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solat-filesystem-'));
  let next = 0;
  const workspace = new FilesystemWorkspace({
    rootDir: path.join(root, 'workspaces'),
    exportRoot: path.join(root, 'exports'),
    idFactory: () => `id-${String(++next).padStart(4, '0')}`,
    ...options,
  });
  return { root, workspace };
}

function scope(relativePath = 'notes/item.md') {
  return { ownerId: 'owner-a', sessionId: 'session-a', relativePath };
}

test('filesystem workspace creates, reads, updates, undoes and exports without overwriting', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const created = await workspace.create({ ...scope(), content: '# First\n' });
  assert.equal(created.schema_version, FILESYSTEM_RESULT_SCHEMA_VERSION);
  assert.equal(created.operation, 'create');
  assert.equal(created.sha256, contentHash(Buffer.from('# First\n')));
  assert.equal(created.version, 1);
  await assert.rejects(() => workspace.create({ ...scope(), content: 'overwrite' }), error => error instanceof FilesystemWorkspaceError && error.code === 'file_exists');

  const read = await workspace.read(scope());
  assert.equal(read.content, '# First\n');
  assert.equal(read.sha256, created.sha256);

  const updated = await workspace.update({ ...scope(), content: '# Second\n', expectedSha256: read.sha256 });
  assert.equal(updated.operation, 'update');
  assert.equal(updated.previous_sha256, created.sha256);
  assert.equal((await workspace.read(scope())).content, '# Second\n');

  await assert.rejects(
    () => workspace.update({ ...scope(), content: '# Wrong\n', expectedSha256: created.sha256 }),
    error => error instanceof FilesystemWorkspaceError && error.code === 'hash_conflict',
  );
  assert.equal((await workspace.read(scope())).content, '# Second\n', 'a stale update must not change the file');

  const undone = await workspace.undo({ ...scope(), expectedSha256: updated.sha256 });
  assert.equal(undone.operation, 'undo');
  assert.equal(undone.sha256, created.sha256);
  assert.equal((await workspace.read(scope())).content, '# First\n');
  await assert.rejects(() => workspace.undo({ ...scope(), expectedSha256: created.sha256 }), error => error.code === 'undo_unavailable');

  const exported = await workspace.exportFile({ ...scope(), exportName: 'answer.md', expectedSha256: created.sha256 });
  assert.equal(exported.operation, 'export');
  assert.match(exported.export_id, /^export_[a-f0-9]{32}$/u);
  const exportedPath = path.join(workspace.exportScopePath(scope()), 'answer.md');
  assert.equal(await fs.readFile(exportedPath, 'utf8'), '# First\n');
  await assert.rejects(() => workspace.exportFile({ ...scope(), exportName: 'answer.md', expectedSha256: created.sha256 }), error => error.code === 'file_exists');
  await assert.rejects(() => workspace.exportFile({ ...scope(), exportName: 'answer.txt', expectedSha256: created.sha256 }), error => error.code === 'export_type_mismatch');

  const files = await fs.readdir(path.dirname(path.join(workspace.scopePath(scope()), 'notes/item.md')));
  assert.equal(files.some(name => name.endsWith('.tmp')), false, 'atomic operations must clean temporary files');
  const journalDir = path.join(workspace.scopePath(scope()), '.solat-journal');
  const journals = await fs.readdir(journalDir);
  assert.equal(journals.length, 4);
  const journalText = (await Promise.all(journals.map(name => fs.readFile(path.join(journalDir, name), 'utf8')))).join('\n');
  assert.doesNotMatch(journalText, /# First|# Second/u, 'operation journal must not persist file content');
});

test('filesystem workspace rejects traversal, absolute, UNC, ADS, reserved, internal and unsupported paths', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cases = [
    ['../escape.txt', 'path_traversal'],
    ['folder/../../escape.txt', 'path_traversal'],
    ['C:\\Windows\\win.ini', 'absolute_path_denied'],
    ['\\\\server\\share\\file.txt', 'absolute_path_denied'],
    ['/etc/passwd.txt', 'absolute_path_denied'],
    ['note.txt:secret', 'invalid_path'],
    ['CON.txt', 'reserved_path'],
    ['folder/NUL.md', 'reserved_path'],
    ['.solat-history/secret.txt', 'reserved_path'],
    ['script.js', 'unsupported_file_type'],
    ['folder//note.txt', 'path_traversal'],
    ['folder./note.txt', 'invalid_path'],
  ];
  for (const [relativePath, code] of cases) {
    await assert.rejects(
      () => workspace.create({ ...scope(relativePath), content: 'safe' }),
      error => error instanceof FilesystemWorkspaceError && error.code === code,
      `${relativePath} should fail with ${code}`,
    );
  }
  assert.equal(normalizeRelativePath('folder\\note.txt'), 'folder/note.txt');
});

test('filesystem workspace enforces byte, UTF-8 and JSON contracts', async t => {
  const { root, workspace } = await fixture({ maxBytes: 12 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => workspace.create({ ...scope('large.txt'), content: '0123456789abc' }), error => error.code === 'file_too_large');
  await assert.rejects(() => workspace.create({ ...scope('unicode.txt'), content: '\ud800' }), error => error.code === 'invalid_utf8');
  await assert.rejects(() => workspace.create({ ...scope('bad.json'), content: '{no}' }), error => error.code === 'malformed_json');
  const json = await workspace.create({ ...scope('good.json'), content: '{"ok":true}' });
  assert.equal(json.size_bytes, 11);
});

test('filesystem workspace isolates files and exports by owner and session', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await workspace.create({ ownerId: 'owner-a', sessionId: 'session-a', relativePath: 'same.txt', content: 'A' });
  await workspace.create({ ownerId: 'owner-a', sessionId: 'session-b', relativePath: 'same.txt', content: 'B' });
  await workspace.create({ ownerId: 'owner-b', sessionId: 'session-a', relativePath: 'same.txt', content: 'C' });
  assert.equal((await workspace.read({ ownerId: 'owner-a', sessionId: 'session-a', relativePath: 'same.txt' })).content, 'A');
  assert.equal((await workspace.read({ ownerId: 'owner-a', sessionId: 'session-b', relativePath: 'same.txt' })).content, 'B');
  assert.equal((await workspace.read({ ownerId: 'owner-b', sessionId: 'session-a', relativePath: 'same.txt' })).content, 'C');
  assert.notEqual(workspace.scopePath({ ownerId: 'owner-a', sessionId: 'session-a' }), workspace.scopePath({ ownerId: 'owner-a', sessionId: 'session-b' }));
  assert.doesNotMatch(workspace.scopePath({ ownerId: 'private-owner', sessionId: 'private-session' }), /private-owner|private-session/u);
});

test('filesystem workspace maintains deterministic multi-version undo order', async t => {
  const fixed = new Date('2026-08-15T00:00:00.000Z');
  const { root, workspace } = await fixture({ now: () => fixed });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const one = await workspace.create({ ...scope('versions.txt'), content: 'one' });
  const two = await workspace.update({ ...scope('versions.txt'), content: 'two', expectedSha256: one.sha256 });
  const three = await workspace.update({ ...scope('versions.txt'), content: 'three', expectedSha256: two.sha256 });
  const undoThree = await workspace.undo({ ...scope('versions.txt'), expectedSha256: three.sha256 });
  assert.equal((await workspace.read(scope('versions.txt'))).content, 'two');
  const undoTwo = await workspace.undo({ ...scope('versions.txt'), expectedSha256: undoThree.sha256 });
  assert.equal(undoTwo.sha256, one.sha256);
  assert.equal((await workspace.read(scope('versions.txt'))).content, 'one');
});

test('filesystem workspace rejects a symlink or junction escape', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await workspace.create({ ...scope('safe/seed.txt'), content: 'seed' });
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'stolen.txt'), 'outside');
  const link = path.join(workspace.scopePath(scope()), 'linked');
  try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`Symlinks are unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => workspace.read({ ...scope('linked/stolen.txt') }), error => error.code === 'symlink_denied');
  await assert.rejects(() => workspace.create({ ...scope('linked/new.txt'), content: 'blocked' }), error => error.code === 'symlink_denied');
  assert.equal(await fs.readFile(path.join(outside, 'stolen.txt'), 'utf8'), 'outside');
});

test('filesystem workspace rejects a symlink at an owner/session scope boundary', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scopePath = workspace.scopePath(scope('boundary.txt'));
  const sessionDir = path.dirname(scopePath);
  const ownerDir = path.dirname(sessionDir);
  const outside = path.join(root, 'outside-boundary');
  await fs.mkdir(ownerDir, { recursive: true });
  await fs.mkdir(outside);
  try { await fs.symlink(outside, sessionDir, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`Symlinks are unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => workspace.create({ ...scope('boundary.txt'), content: 'blocked' }), error => error.code === 'unsafe_workspace');
  assert.deepEqual(await fs.readdir(outside), []);
});

test('filesystem workspace honors cancellation before any operation', async t => {
  const { root, workspace } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => workspace.create({ ...scope(), content: 'never', signal: controller.signal }), error => error.code === 'operation_cancelled');
  await assert.rejects(() => fs.stat(path.join(workspace.scopePath(scope()), 'notes/item.md')), error => error.code === 'ENOENT');
});

test('content hash is deterministic and uses the declared SHA-256 format', () => {
  const expected = crypto.createHash('sha256').update('hello').digest('hex');
  assert.equal(contentHash(Buffer.from('hello')), `sha256:${expected}`);
});
