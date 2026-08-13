const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const PERSISTENCE_SCHEMA_VERSION = '1.0';
const MAX_HISTORY = 50;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function requiredSession(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/]/.test(normalized)) throw Object.assign(new Error('A safe session id is required.'), { code: 'invalid_request' });
  return normalized;
}

function requiredCreativeId(creativeId) {
  const normalized = String(creativeId || '').trim();
  if (!normalized) throw Object.assign(new Error('A creative result id is required.'), { code: 'invalid_request' });
  return normalized;
}

class CreativePersistence {
  constructor({ rootDir, fsImpl = fs.promises, idFactory = crypto.randomUUID } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw Object.assign(new Error('A persistence root is required.'), { code: 'invalid_request' });
    this.rootDir = path.resolve(rootDir);
    this.fs = fsImpl;
    this.idFactory = idFactory;
  }

  _fileFor(sessionId) {
    const normalized = requiredSession(sessionId);
    const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
    return { sessionId: normalized, file: path.join(this.rootDir, `${digest}.json`) };
  }

  async _read(sessionId) {
    const { sessionId: normalized, file } = this._fileFor(sessionId);
    try {
      const parsed = JSON.parse(await this.fs.readFile(file, 'utf8'));
      if (parsed.session_id !== normalized) throw Object.assign(new Error('Persisted creative session ownership does not match.'), { code: 'ownership_mismatch' });
      if (parsed.schema_version !== PERSISTENCE_SCHEMA_VERSION || !Array.isArray(parsed.history)) throw Object.assign(new Error('Persisted creative history is malformed.'), { code: 'persistence_invalid' });
      return { ...parsed, history: parsed.history.map(clone) };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schema_version: PERSISTENCE_SCHEMA_VERSION, session_id: normalized, history: [] };
      throw error;
    }
  }

  async _write(record) {
    const { file } = this._fileFor(record.session_id);
    await this.fs.mkdir(this.rootDir, { recursive: true });
    const temp = `${file}.${this.idFactory()}.tmp`;
    try {
      await this.fs.writeFile(temp, JSON.stringify(record, null, 2), { flag: 'wx', encoding: 'utf8' });
      await this.fs.rename(temp, file);
    } catch (error) {
      await this.fs.rm(temp, { force: true }).catch(() => {});
      throw Object.assign(new Error('Creative workspace persistence failed.'), { code: 'persistence_write_failed', cause: error });
    }
  }

  async saveResult({ sessionId, result } = {}) {
    const normalized = requiredSession(sessionId);
    const creativeId = requiredCreativeId(result?.id);
    const record = await this._read(normalized);
    const existing = record.history.find(entry => entry.result?.id === creativeId);
    if (!existing) {
      record.history = [...record.history, { session_id: normalized, result: clone(result), exported: null, inspection: null }].slice(-MAX_HISTORY);
      await this._write(record);
    }
    return { sessionId: normalized, creativeId, history: clone(record.history) };
  }

  async loadHistory({ sessionId } = {}) {
    const record = await this._read(requiredSession(sessionId));
    return { sessionId: record.session_id, history: clone(record.history) };
  }

  async recordExport({ sessionId, creativeId, exported } = {}) {
    return this._updateEntry({ sessionId, creativeId, field: 'exported', value: exported });
  }

  async recordInspection({ sessionId, creativeId, inspection } = {}) {
    return this._updateEntry({ sessionId, creativeId, field: 'inspection', value: inspection });
  }

  async _updateEntry({ sessionId, creativeId, field, value } = {}) {
    const normalized = requiredSession(sessionId);
    const id = requiredCreativeId(creativeId);
    const record = await this._read(normalized);
    const index = record.history.findIndex(entry => entry.result?.id === id);
    if (index < 0) throw Object.assign(new Error('The creative result is not available in this session.'), { code: 'artifact_not_found' });
    record.history[index] = { ...record.history[index], [field]: clone(value) };
    await this._write(record);
    return { sessionId: normalized, creativeId: id, history: clone(record.history) };
  }
}

module.exports = { CreativePersistence, MAX_HISTORY, PERSISTENCE_SCHEMA_VERSION };
