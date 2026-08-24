const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function persistenceError(code, message) { return Object.assign(new Error(message), { code }); }
function id(value, field) {
  const result = String(value || '').trim();
  if (!result || result.length > 160 || /[\u0000-\u001f\u007f]/u.test(result)) throw persistenceError('invalid_multimodal_scope', `${field} is invalid.`);
  return result;
}
function filename(ownerId, sessionId) { return `${crypto.createHash('sha256').update(JSON.stringify([ownerId, sessionId])).digest('hex')}.json`; }

class MultimodalPersistence {
  constructor({ rootDir, fsImpl = fs.promises } = {}) {
    if (!rootDir) throw new TypeError('A multimodal persistence root is required.');
    this.rootDir = path.resolve(rootDir);
    this.fs = fsImpl;
  }

  async save({ ownerId, sessionId, snapshot } = {}) {
    const owner = id(ownerId, 'ownerId'); const session = id(sessionId, 'sessionId');
    if (snapshot?.schema_version !== 'solat.multimodal-snapshot.v1' || snapshot.body?.owner_id !== owner || snapshot.body?.session_id !== session) {
      throw persistenceError('invalid_multimodal_snapshot', 'The snapshot does not match the requested owner/session.');
    }
    const data = JSON.stringify(snapshot);
    if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) throw persistenceError('multimodal_snapshot_too_large', 'The multimodal snapshot exceeds the persistence limit.');
    await this.fs.mkdir(this.rootDir, { recursive: true });
    const target = path.join(this.rootDir, filename(owner, session));
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await this.fs.writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try { await this.fs.rename(temporary, target); }
    catch (error) { await this.fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
    return Object.freeze({ status: 'saved', bytes: Buffer.byteLength(data), sha256: snapshot.sha256 });
  }

  async load({ ownerId, sessionId } = {}) {
    const owner = id(ownerId, 'ownerId'); const session = id(sessionId, 'sessionId');
    const target = path.join(this.rootDir, filename(owner, session));
    let data;
    try { data = await this.fs.readFile(target, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) throw persistenceError('multimodal_snapshot_too_large', 'The stored multimodal snapshot exceeds the persistence limit.');
    let snapshot;
    try { snapshot = JSON.parse(data); }
    catch { throw persistenceError('invalid_multimodal_snapshot', 'The stored multimodal snapshot is malformed.'); }
    if (snapshot?.body?.owner_id !== owner || snapshot?.body?.session_id !== session) throw persistenceError('multimodal_scope_mismatch', 'The stored multimodal snapshot belongs to another owner/session.');
    return snapshot;
  }

  async remove({ ownerId, sessionId } = {}) {
    const owner = id(ownerId, 'ownerId'); const session = id(sessionId, 'sessionId');
    await this.fs.rm(path.join(this.rootDir, filename(owner, session)), { force: true });
    return true;
  }
}

module.exports = { MAX_SNAPSHOT_BYTES, MultimodalPersistence };
