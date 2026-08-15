const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FILESYSTEM_RESULT_SCHEMA_VERSION = 'solat.filesystem-result.v1';
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const SAFE_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.html']);
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

class FilesystemWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FilesystemWorkspaceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FilesystemWorkspaceError(code, message, details);
}

function requiredIdentity(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 256 || normalized.includes('\0')) fail('invalid_scope', `${field} is invalid.`);
  return normalized;
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function contentHash(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('path_escape', 'The requested path escaped its SOLAT workspace.');
}

function normalizeRelativePath(value, { allowInternal = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) fail('invalid_path', 'A relative file path is required.');
  const input = value.trim();
  if (input.includes('\0') || input.length > 240) fail('invalid_path', 'The file path is invalid.');
  if (/^(?:[a-z]:|\\\\|\/\/|\\[?.]\\)/iu.test(input) || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    fail('absolute_path_denied', 'Only relative paths inside the SOLAT workspace are allowed.');
  }
  const segments = input.replaceAll('\\', '/').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail('path_traversal', 'Path traversal and empty path segments are not allowed.');
  for (const segment of segments) {
    if (segment.length > 120 || segment.includes(':') || /[<>"|?*]/u.test(segment) || /[. ]$/u.test(segment)) fail('invalid_path', 'The file path contains a Windows-unsafe segment.');
    if (RESERVED_WINDOWS_NAMES.test(segment)) fail('reserved_path', 'The file path contains a reserved Windows name.');
    if (!allowInternal && /^\.solat-/iu.test(segment)) fail('reserved_path', 'SOLAT internal workspace paths are not available to tools.');
  }
  const extension = path.extname(segments.at(-1)).toLowerCase();
  if (!SAFE_EXTENSIONS.has(extension)) fail('unsupported_file_type', `Unsupported editable file extension: ${extension || '(none)'}.`);
  return segments.join('/');
}

function validateContent(relativePath, content, maxBytes) {
  if (typeof content !== 'string') fail('invalid_content', 'Editable file content must be a UTF-8 string.');
  const buffer = Buffer.from(content, 'utf8');
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail('invalid_utf8', 'Editable file content must be valid UTF-8.'); }
  if (decoded !== content) fail('invalid_utf8', 'Editable file content contains an invalid Unicode sequence.');
  if (buffer.length > maxBytes) fail('file_too_large', `Editable files are limited to ${maxBytes} bytes.`, { max_bytes: maxBytes, size_bytes: buffer.length });
  if (path.extname(relativePath).toLowerCase() === '.json') {
    try { JSON.parse(content); } catch { fail('malformed_json', 'JSON output must contain valid JSON.'); }
  }
  return buffer;
}

function checkSignal(signal) {
  if (signal?.aborted) fail('operation_cancelled', 'The filesystem operation was cancelled.');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FilesystemWorkspace {
  constructor({ rootDir, exportRoot, maxBytes = DEFAULT_MAX_FILE_BYTES, fsImpl = fs.promises, now = () => new Date(), idFactory = crypto.randomUUID } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) fail('invalid_config', 'A filesystem workspace root is required.');
    if (typeof exportRoot !== 'string' || !exportRoot.trim()) fail('invalid_config', 'A filesystem export root is required.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('invalid_config', 'maxBytes must be a positive safe integer.');
    this.rootDir = path.resolve(rootDir);
    this.exportRoot = path.resolve(exportRoot);
    this.maxBytes = maxBytes;
    this.fs = fsImpl;
    this.now = now;
    this.idFactory = idFactory;
    this.sequence = 0;
  }

  scopePath({ ownerId, sessionId = ownerId } = {}) {
    const owner = requiredIdentity(ownerId, 'owner_id');
    const session = requiredIdentity(sessionId, 'session_id');
    const scope = path.join(this.rootDir, digest(owner), digest(session), 'workspace');
    assertInside(this.rootDir, scope);
    return scope;
  }

  exportScopePath({ ownerId, sessionId = ownerId } = {}) {
    const owner = requiredIdentity(ownerId, 'owner_id');
    const session = requiredIdentity(sessionId, 'session_id');
    const scope = path.join(this.exportRoot, digest(owner), digest(session));
    assertInside(this.exportRoot, scope);
    return scope;
  }

  async create({ ownerId, sessionId = ownerId, relativePath, content, signal } = {}) {
    checkSignal(signal);
    const context = await this.#context({ ownerId, sessionId, relativePath });
    const bytes = validateContent(context.relativePath, content, this.maxBytes);
    await this.#ensureParent(context.scope, context.target);
    await this.#assertMissing(context.target);
    await this.#publishNew(context.scope, context.target, bytes);
    checkSignal(signal);
    const result = this.#result('create', context.relativePath, bytes, { version: 1 });
    await this.#journal(context.scope, result);
    return result;
  }

  async read({ ownerId, sessionId = ownerId, relativePath, signal } = {}) {
    checkSignal(signal);
    const context = await this.#context({ ownerId, sessionId, relativePath });
    const bytes = await this.#readRegular(context.scope, context.target);
    if (bytes.length > this.maxBytes) fail('file_too_large', 'The editable file exceeds the configured read limit.');
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('invalid_utf8', 'The workspace file is not valid UTF-8.'); }
    checkSignal(signal);
    return this.#result('read', context.relativePath, bytes, { content });
  }

  async update({ ownerId, sessionId = ownerId, relativePath, content, expectedSha256, signal } = {}) {
    checkSignal(signal);
    const context = await this.#context({ ownerId, sessionId, relativePath });
    const current = await this.#readRegular(context.scope, context.target);
    this.#assertExpectedHash(current, expectedSha256);
    const next = validateContent(context.relativePath, content, this.maxBytes);
    const previousHash = contentHash(current);
    await this.#snapshot(context.scope, context.relativePath, current);
    await this.#replace(context.scope, context.target, next);
    checkSignal(signal);
    const result = this.#result('update', context.relativePath, next, { previous_sha256: previousHash });
    await this.#journal(context.scope, result);
    return result;
  }

  async undo({ ownerId, sessionId = ownerId, relativePath, expectedSha256, signal } = {}) {
    checkSignal(signal);
    const context = await this.#context({ ownerId, sessionId, relativePath });
    const current = await this.#readRegular(context.scope, context.target);
    this.#assertExpectedHash(current, expectedSha256);
    const historyDir = this.#historyDir(context.scope, context.relativePath);
    await this.#assertNoSymlinks(context.scope, historyDir, true);
    let entries;
    try { entries = await this.fs.readdir(historyDir, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') fail('undo_unavailable', 'No previous file version is available.'); throw error; }
    const candidate = entries.filter(entry => entry.isFile() && entry.name.endsWith('.bak')).map(entry => entry.name).sort().at(-1);
    if (!candidate) fail('undo_unavailable', 'No previous file version is available.');
    const snapshotPath = path.join(historyDir, candidate);
    const previous = await this.#readRegular(context.scope, snapshotPath);
    await this.#replace(context.scope, context.target, previous);
    await this.fs.unlink(snapshotPath);
    checkSignal(signal);
    const result = this.#result('undo', context.relativePath, previous, { previous_sha256: contentHash(current) });
    await this.#journal(context.scope, result);
    return result;
  }

  async exportFile({ ownerId, sessionId = ownerId, relativePath, exportName, expectedSha256, signal } = {}) {
    checkSignal(signal);
    const context = await this.#context({ ownerId, sessionId, relativePath });
    const bytes = await this.#readRegular(context.scope, context.target);
    this.#assertExpectedHash(bytes, expectedSha256);
    const normalizedExport = normalizeRelativePath(exportName);
    if (normalizedExport.includes('/')) fail('invalid_export_name', 'An export name must not contain directories.');
    if (path.extname(normalizedExport).toLowerCase() !== path.extname(context.relativePath).toLowerCase()) fail('export_type_mismatch', 'The export extension must match the workspace file.');
    const exportScope = this.exportScopePath({ ownerId, sessionId });
    const target = path.join(exportScope, normalizedExport);
    assertInside(exportScope, target);
    await this.#ensureScopeTree(this.exportRoot, exportScope);
    await this.#ensureParent(exportScope, target);
    await this.#assertMissing(target);
    await this.#publishNew(exportScope, target, bytes);
    checkSignal(signal);
    const result = this.#result('export', context.relativePath, bytes, { export_name: normalizedExport, export_id: `export_${digest(`${requiredIdentity(ownerId, 'owner_id')}:${requiredIdentity(sessionId, 'session_id')}:${normalizedExport}:${contentHash(bytes)}`).slice(0, 32)}` });
    await this.#journal(context.scope, result);
    return result;
  }

  async #context({ ownerId, sessionId, relativePath }) {
    const scope = this.scopePath({ ownerId, sessionId });
    const normalized = normalizeRelativePath(relativePath);
    const target = path.join(scope, ...normalized.split('/'));
    assertInside(scope, target);
    await this.#ensureScope(scope);
    await this.#assertNoSymlinks(scope, target, true);
    return { scope, target, relativePath: normalized };
  }

  async #ensureScope(scope) {
    await this.#ensureScopeTree(this.rootDir, scope);
  }

  async #ensureScopeTree(base, scope) {
    await this.fs.mkdir(base, { recursive: true });
    const baseStat = await this.fs.lstat(base);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) fail('unsafe_workspace', 'The SOLAT workspace root is not a safe directory.');
    const relative = path.relative(base, scope);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('path_escape', 'The requested scope escaped its SOLAT storage root.');
    let cursor = base;
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      try { await this.fs.mkdir(cursor); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      const stat = await this.fs.lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_workspace', 'The SOLAT workspace contains an unsafe directory boundary.');
    }
  }

  async #ensureParent(scope, target) {
    const parent = path.dirname(target);
    await this.#assertNoSymlinks(scope, parent, true);
    await this.fs.mkdir(parent, { recursive: true });
    await this.#assertNoSymlinks(scope, parent, false);
  }

  async #assertNoSymlinks(scope, target, allowMissing) {
    assertInside(path.dirname(scope), target);
    const relative = path.relative(scope, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('path_escape', 'The requested path escaped its SOLAT workspace.');
    let cursor = scope;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      let stat;
      try { stat = await this.fs.lstat(cursor); }
      catch (error) {
        if (allowMissing && error?.code === 'ENOENT') return;
        throw error;
      }
      if (stat.isSymbolicLink()) fail('symlink_denied', 'Symbolic links are not allowed in the SOLAT workspace.');
    }
  }

  async #readRegular(scope, target) {
    await this.#assertNoSymlinks(scope, target, false);
    let stat;
    try { stat = await this.fs.lstat(target); }
    catch (error) { if (error?.code === 'ENOENT') fail('file_not_found', 'The requested workspace file was not found.'); throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) fail('unsafe_file', 'The requested workspace path is not a regular file.');
    return this.fs.readFile(target);
  }

  async #assertMissing(target) {
    try { await this.fs.lstat(target); fail('file_exists', 'The destination already exists and will not be overwritten.'); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  }

  #assertExpectedHash(bytes, expected) {
    if (typeof expected !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(expected)) fail('invalid_hash', 'A valid expected SHA-256 hash is required.');
    const actual = contentHash(bytes);
    if (actual !== expected) fail('hash_conflict', 'The file changed after it was read; the write was not applied.', { expected_sha256: expected, actual_sha256: actual });
  }

  async #publishNew(scope, target, bytes) {
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${this.idFactory()}.tmp`);
    assertInside(scope, temp);
    try {
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await this.fs.link(temp, target);
      await this.fs.unlink(temp).catch(() => {});
    } catch (error) {
      await this.fs.rm(temp, { force: true }).catch(() => {});
      if (error?.code === 'EEXIST') fail('file_exists', 'The destination already exists and will not be overwritten.');
      throw error;
    }
  }

  async #replace(scope, target, bytes) {
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${this.idFactory()}.tmp`);
    assertInside(scope, temp);
    try {
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await this.#assertNoSymlinks(scope, target, false);
      await this.fs.rename(temp, target);
    } catch (error) {
      await this.fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  #historyDir(scope, relativePath) {
    const directory = path.join(scope, '.solat-history', digest(relativePath));
    assertInside(scope, directory);
    return directory;
  }

  async #snapshot(scope, relativePath, bytes) {
    const directory = this.#historyDir(scope, relativePath);
    await this.#ensureParent(scope, path.join(directory, 'snapshot.bak'));
    const stamp = String(new Date(this.now()).getTime()).padStart(16, '0');
    const sequence = String(++this.sequence).padStart(12, '0');
    const target = path.join(directory, `${stamp}-${sequence}-${this.idFactory()}-${contentHash(bytes).slice(7)}.bak`);
    await this.#publishNew(scope, target, bytes);
    return target;
  }

  async #journal(scope, result) {
    const directory = path.join(scope, '.solat-journal');
    await this.#ensureParent(scope, path.join(directory, 'entry.json'));
    const stamp = String(new Date(this.now()).getTime()).padStart(16, '0');
    const sequence = String(++this.sequence).padStart(12, '0');
    const target = path.join(directory, `${stamp}-${sequence}-${this.idFactory()}.json`);
    const record = Buffer.from(JSON.stringify({ ...clone(result), content: undefined, recorded_at: new Date(this.now()).toISOString() }, null, 2), 'utf8');
    await this.#publishNew(scope, target, record);
  }

  #result(operation, relativePath, bytes, extra = {}) {
    const hash = contentHash(bytes);
    return Object.freeze({
      schema_version: FILESYSTEM_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation,
      relative_path: relativePath,
      sha256: hash,
      size_bytes: bytes.length,
      artifact_id: `file_${digest(`${relativePath}:${hash}`).slice(0, 32)}`,
      ...extra,
    });
  }
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  FILESYSTEM_RESULT_SCHEMA_VERSION,
  FilesystemWorkspace,
  FilesystemWorkspaceError,
  SAFE_EXTENSIONS,
  contentHash,
  normalizeRelativePath,
};
