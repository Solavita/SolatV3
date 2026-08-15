const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ContractError, createAsset, deepFreeze } = require('./contracts');

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeToken(value, field) {
  if (typeof value !== 'string' || !value.trim() || !SAFE_TOKEN.test(value.trim())) throw new ContractError('invalid_asset_request', `${field} contains an unsafe identifier.`);
  return value.trim();
}

function safeFileName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'upload.bin';
  const base = path.basename(value.trim()).replace(/[^A-Za-z0-9._-]/g, '_');
  return base || 'upload.bin';
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw new ContractError('invalid_asset_request', 'Asset bytes must be a Buffer or byte array.');
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ContractError('asset_storage_error', 'Asset path escaped the storage root.');
}

class AssetStore {
  constructor({ rootDir, now = () => new Date(), idFactory = crypto.randomUUID, fsImpl = fs.promises } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new ContractError('invalid_asset_request', 'Asset storage root is required.');
    this.rootDir = path.resolve(rootDir);
    this.now = now;
    this.idFactory = idFactory;
    this.fs = fsImpl;
  }

  _assetDir({ ownerId, projectId, assetId }) {
    const owner = safeToken(ownerId, 'owner_id');
    const project = safeToken(projectId, 'project_id');
    const asset = safeToken(assetId, 'asset_id');
    const directory = path.join(this.rootDir, owner, project, asset);
    assertInside(this.rootDir, directory);
    return directory;
  }

  _derivedDir({ ownerId, projectId }) {
    const owner = safeToken(ownerId, 'owner_id'); const project = safeToken(projectId, 'project_id');
    const directory = path.join(this.rootDir, owner, project, '_derived');
    assertInside(this.rootDir, directory); return directory;
  }

  async storeDerived(record) {
    if (!record || record.schema_version !== 'solat.extraction.v1') throw new ContractError('invalid_derived_record', 'Derived extraction schema is invalid.');
    const owner = safeToken(record.owner_id, 'owner_id'); const project = safeToken(record.project_id, 'project_id'); const derived = safeToken(record.derived_id, 'derived_id');
    const directory = this._derivedDir({ ownerId: owner, projectId: project }); const target = path.join(directory, `${derived}.json`); const temp = path.join(directory, `.${derived}.${crypto.randomUUID()}.tmp`);
    assertInside(this.rootDir, target); assertInside(this.rootDir, temp);
    await this.fs.mkdir(directory, { recursive: true });
    try { await this.fs.writeFile(temp, JSON.stringify(record, null, 2), { flag: 'wx', encoding: 'utf8' }); await this.fs.rename(temp, target); }
    catch (error) { try { await this.fs.unlink(temp); } catch {} throw new ContractError(error?.code === 'EEXIST' ? 'derived_exists' : 'asset_storage_error', 'Derived extraction could not be persisted.'); }
    return record;
  }

  async readDerived({ ownerId, projectId, derivedId } = {}) {
    const owner = safeToken(ownerId, 'owner_id'); const project = safeToken(projectId, 'project_id'); const derived = safeToken(derivedId, 'derived_id');
    const target = path.join(this._derivedDir({ ownerId: owner, projectId: project }), `${derived}.json`); assertInside(this.rootDir, target);
    let record; try { record = JSON.parse(await this.fs.readFile(target, 'utf8')); } catch { throw new ContractError('derived_not_found', 'The extracted content is not available.'); }
    if (record.schema_version !== 'solat.extraction.v1' || record.owner_id !== owner || record.project_id !== project || record.derived_id !== derived || typeof record.original_hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(record.original_hash)) throw new ContractError('derived_integrity_error', 'The extracted content metadata is invalid.');
    if (record.status !== 'EXTRACTED' || typeof record.content_hash !== 'string') throw new ContractError('derived_integrity_error', 'The extracted content integrity metadata is missing.');
    const calculated = `sha256:${crypto.createHash('sha256').update(JSON.stringify(record.content)).digest('hex')}`;
    if (calculated !== record.content_hash) throw new ContractError('derived_integrity_error', 'The extracted content hash does not match its metadata.');
    const original = await this.readOriginal({ ownerId: owner, projectId: project, assetId: record.original_asset_id });
    if (original.asset.hash !== record.original_hash) throw new ContractError('derived_integrity_error', 'The extracted content is not linked to the current immutable original.');
    return deepFreeze(record);
  }

  async listDerived({ ownerId, projectId } = {}) {
    const directory = this._derivedDir({ ownerId, projectId }); let entries;
    try { entries = await this.fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return []; throw new ContractError('asset_storage_error', 'The derived index could not be read.'); }
    const records = []; for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.json')) { try { records.push(await this.readDerived({ ownerId, projectId, derivedId: entry.name.slice(0, -5) })); } catch {} }
    return records;
  }

  async deleteDerived({ ownerId, projectId, derivedId } = {}) {
    const owner = safeToken(ownerId, 'owner_id'); const project = safeToken(projectId, 'project_id'); const derived = safeToken(derivedId, 'derived_id');
    const target = path.join(this._derivedDir({ ownerId: owner, projectId: project }), `${derived}.json`); assertInside(this.rootDir, target);
    try { await this.fs.unlink(target); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw new ContractError('asset_storage_error', 'The derived extraction could not be deleted.'); }
  }

  async storeOriginal({ ownerId, projectId, fileName, mimeType, bytes, permission = 'owner_only', sourceMetadata = {} } = {}) {
    const buffer = toBuffer(bytes);
    if (!buffer.length || buffer.length > MAX_ASSET_BYTES) throw new ContractError('invalid_asset_request', `Asset size must be between 1 and ${MAX_ASSET_BYTES} bytes.`);
    const normalizedOwner = safeToken(ownerId, 'owner_id');
    const normalizedProject = safeToken(projectId, 'project_id');
    const hash = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
    const asset = createAsset({
      projectId: normalizedProject,
      ownerId: normalizedOwner,
      assetClass: 'ORIGINAL_USER_ASSET',
      mimeType: typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : 'application/octet-stream',
      sizeBytes: buffer.length,
      hash,
      source: { kind: 'upload', file_name: safeFileName(fileName), ...(sourceMetadata && typeof sourceMetadata === 'object' ? clone(sourceMetadata) : {}) },
      permissions: { read: permission },
      now: this.now(),
      idFactory: this.idFactory,
    });
    const directory = this._assetDir({ ownerId: normalizedOwner, projectId: normalizedProject, assetId: asset.asset_id });
    const dataPath = path.join(directory, 'original.bin');
    const manifestPath = path.join(directory, 'manifest.json');
    await this.fs.mkdir(directory, { recursive: true });
    assertInside(this.rootDir, dataPath); assertInside(this.rootDir, manifestPath);
    try {
      await this.fs.writeFile(dataPath, buffer, { flag: 'wx' });
      const stored = deepFreeze({ ...asset, source: { ...asset.source, storage_ref: path.relative(this.rootDir, dataPath).replaceAll('\\', '/') } });
      await this.fs.writeFile(manifestPath, JSON.stringify(stored, null, 2), { flag: 'wx', encoding: 'utf8' });
      return stored;
    } catch (error) {
      if (error?.code === 'EEXIST') throw new ContractError('asset_exists', 'An original asset already exists at this storage location.');
      throw new ContractError('asset_storage_error', 'The original asset could not be stored.');
    }
  }

  async findOriginalByHash({ ownerId, projectId, hash } = {}) {
    const normalizedOwner = safeToken(ownerId, 'owner_id');
    const normalizedProject = safeToken(projectId, 'project_id');
    if (typeof hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(hash)) throw new ContractError('invalid_asset_request', 'A valid SHA-256 asset hash is required.');
    const projectRoot = path.join(this.rootDir, normalizedOwner, normalizedProject);
    let entries;
    try { entries = await this.fs.readdir(projectRoot, { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return null; throw new ContractError('asset_storage_error', 'The asset index could not be read.'); }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_TOKEN.test(entry.name)) continue;
      try {
        const manifest = JSON.parse(await this.fs.readFile(path.join(projectRoot, entry.name, 'manifest.json'), 'utf8'));
        if (manifest.owner_id === normalizedOwner && manifest.project_id === normalizedProject && manifest.asset_class === 'ORIGINAL_USER_ASSET' && manifest.hash === hash) return deepFreeze(manifest);
      } catch { /* Ignore incomplete/stale directories; readOriginal remains authoritative. */ }
    }
    return null;
  }

  async readOriginal({ ownerId, projectId, assetId } = {}) {
    const normalizedOwner = safeToken(ownerId, 'owner_id');
    const normalizedProject = safeToken(projectId, 'project_id');
    const normalizedAsset = safeToken(assetId, 'asset_id');
    const directory = this._assetDir({ ownerId: normalizedOwner, projectId: normalizedProject, assetId: normalizedAsset });
    const manifestPath = path.join(directory, 'manifest.json');
    const dataPath = path.join(directory, 'original.bin');
    assertInside(this.rootDir, manifestPath); assertInside(this.rootDir, dataPath);
    let manifest;
    try {
      manifest = JSON.parse(await this.fs.readFile(manifestPath, 'utf8'));
    } catch {
      throw new ContractError('asset_not_found', 'The asset manifest could not be read.');
    }
    if (manifest.owner_id !== normalizedOwner || manifest.project_id !== normalizedProject || manifest.asset_class !== 'ORIGINAL_USER_ASSET') throw new ContractError('asset_access_denied', 'The asset does not belong to this owner and project.');
    let bytes;
    try { bytes = await this.fs.readFile(dataPath); } catch { throw new ContractError('asset_not_found', 'The original asset bytes could not be read.'); }
    const hash = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    if (hash !== manifest.hash || bytes.length !== manifest.size_bytes) throw new ContractError('asset_integrity_error', 'The original asset hash or size does not match its manifest.');
    return { asset: deepFreeze(manifest), bytes: Buffer.from(bytes) };
  }

  async requestDeletion({ ownerId, projectId, assetId } = {}) {
    const current = await this.readOriginal({ ownerId, projectId, assetId });
    const next = deepFreeze({ ...clone(current.asset), retention: { state: 'deletion_requested', deletion_requested_at: new Date(this.now()).toISOString() } });
    const manifestPath = path.join(this._assetDir({ ownerId: next.owner_id, projectId: next.project_id, assetId: next.asset_id }), 'manifest.json');
    assertInside(this.rootDir, manifestPath);
    await this.fs.writeFile(manifestPath, JSON.stringify(next, null, 2), { encoding: 'utf8' });
    return next;
  }
}

module.exports = { AssetStore, MAX_ASSET_BYTES, safeFileName, safeToken };
