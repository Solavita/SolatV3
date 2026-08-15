const crypto = require('node:crypto');
const path = require('node:path');
const { ContractError } = require('./contracts');

// Intake is deliberately kept outside AssetStore's legacy API. Existing callers may
// store already-validated internal assets; user uploads must pass this contract first.
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 5000;
const DEFAULT_DERIVED_RETENTION_MS = 24 * 60 * 60 * 1000;

const FILE_TYPES = Object.freeze({
  '.pdf': { mime: ['application/pdf'], kind: 'pdf' },
  '.docx': { mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], kind: 'zip-document' },
  '.xlsx': { mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], kind: 'zip-spreadsheet' },
  '.csv': { mime: ['text/csv', 'application/csv', 'text/plain'], kind: 'text-csv' },
  '.txt': { mime: ['text/plain'], kind: 'text' },
  '.json': { mime: ['application/json', 'text/json', 'text/plain'], kind: 'json' },
  '.png': { mime: ['image/png'], kind: 'png' },
  '.jpg': { mime: ['image/jpeg'], kind: 'jpeg' },
  '.jpeg': { mime: ['image/jpeg'], kind: 'jpeg' },
  '.gif': { mime: ['image/gif'], kind: 'gif' },
  '.webp': { mime: ['image/webp'], kind: 'webp' },
});

function intakeError(code, message, details = {}) {
  return new ContractError(code, message, details);
}

function normalizeFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName.trim()) throw intakeError('invalid_file_name', 'A file name is required.');
  const value = fileName.trim();
  // Reject traversal instead of silently normalizing it. This keeps provenance honest.
  if (value.includes('\0') || value.includes('/') || value.includes('\\') || value.split(/[.]/).includes('..')) {
    throw intakeError('path_traversal', 'File names must not contain path separators or traversal segments.');
  }
  if (value === '.' || value === '..' || value.endsWith('.') || value.length > 255) throw intakeError('invalid_file_name', 'The file name is not safe.');
  return value;
}

function normalizeMime(mimeType) {
  if (typeof mimeType !== 'string' || !mimeType.trim()) throw intakeError('invalid_mime', 'A declared MIME type is required.');
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw intakeError('invalid_file_bytes', 'File bytes must be a Buffer or byte array.');
}

function isUtf8Text(buffer) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0); } catch { return false; }
}

function hasPrefix(buffer, values) { return values.some(value => buffer.subarray(0, value.length).equals(Buffer.from(value))); }

function safeZipContainer(buffer, maxBytes) {
  if (buffer.length < 22) return false;
  const searchStart = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= searchStart; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) return false;
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) return false;
  if (centralOffset + centralSize > eocd || entries > 10000) return false;
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) return false;
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    expandedBytes += uncompressed;
    if (expandedBytes > maxBytes * 100 || (compressed === 0 && uncompressed > 0) || (compressed > 0 && uncompressed / compressed > 1000)) return false;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return cursor === centralOffset + centralSize;
}

function detectMagic(buffer, kind, maxBytes) {
  if (kind === 'pdf') {
    // A header alone is trivially forgeable; require a bounded PDF EOF marker
    // so obviously truncated uploads are rejected before storage.
    return hasPrefix(buffer, ['%PDF-']) && buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'));
  }
  if (kind === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (kind === 'jpeg') return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (kind === 'gif') return hasPrefix(buffer, ['GIF87a', 'GIF89a']);
  if (kind === 'webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (kind === 'zip-document' || kind === 'zip-spreadsheet') {
    // DOCX/XLSX are OOXML ZIP containers. Reject macro-bearing packages at intake.
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) && safeZipContainer(buffer, maxBytes) && !buffer.includes(Buffer.from('vbaProject.bin'));
  }
  return isUtf8Text(buffer);
}

function validateFileIntake({ fileName, mimeType, bytes, maxBytes = DEFAULT_MAX_FILE_BYTES } = {}) {
  const normalizedName = normalizeFileName(fileName);
  const extension = path.extname(normalizedName).toLowerCase();
  const definition = FILE_TYPES[extension];
  if (!definition) throw intakeError('unsupported_file_type', `Unsupported file extension: ${extension || '(none)'}.`);
  const normalizedMime = normalizeMime(mimeType);
  if (!definition.mime.includes(normalizedMime)) throw intakeError('mime_mismatch', 'The declared MIME type does not match the file extension.', { extension, mime_type: normalizedMime });
  const buffer = toBuffer(bytes);
  if (!buffer.length || buffer.length > maxBytes) throw intakeError('file_too_large', `File size must be between 1 and ${maxBytes} bytes.`, { size_bytes: buffer.length, max_bytes: maxBytes });
  if (!detectMagic(buffer, definition.kind, maxBytes)) throw intakeError('magic_mismatch', 'The file signature does not match the declared type.', { extension, mime_type: normalizedMime });
  if (definition.kind === 'json') {
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { throw intakeError('malformed_file', 'The JSON file is malformed.'); }
  }
  const hash = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
  return Object.freeze({ file_name: normalizedName, extension, mime_type: normalizedMime, size_bytes: buffer.length, hash, kind: definition.kind });
}

function assertUploadBatch(files, { maxFiles = DEFAULT_MAX_FILES } = {}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > maxFiles) throw intakeError('invalid_upload_batch', `Upload must contain between 1 and ${maxFiles} files.`);
  return files;
}

function checkExtractionBudget({ startedAt, timeoutMs, signal }) {
  if (signal?.aborted) throw intakeError('extraction_cancelled', 'File extraction was cancelled.');
  if (Date.now() - startedAt > timeoutMs) throw intakeError('extraction_timeout', 'File extraction exceeded its time limit.');
}

function decodeText(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw intakeError('malformed_file', 'The text file is not valid UTF-8.'); }
}

function extractText(buffer, options) {
  const text = decodeText(buffer);
  const lines = text.split(/\r?\n/);
  const citations = [];
  for (let index = 0; index < lines.length; index += 1) {
    checkExtractionBudget(options);
    if (lines[index].trim()) citations.push({ line: index + 1, text: lines[index] });
  }
  return { content: text, citations };
}

function extractJson(buffer, options) {
  const value = JSON.parse(decodeText(buffer));
  const citations = Object.keys(value && typeof value === 'object' ? value : {}).map(key => ({ path: `$.${key}` }));
  checkExtractionBudget(options);
  return { content: value, citations };
}

function extractCsv(buffer, options) {
  const text = decodeText(buffer);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 4095) === 0) checkExtractionBudget(options);
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw intakeError('malformed_file', 'The CSV file has an unterminated quoted field.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  const records = rows.map(values => Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, values[index] ?? ''])));
  return { content: records, citations: rows.map((_, index) => ({ row: index + 2 })) };
}

class FileIntakeService {
  constructor({ assetStore, maxBytes = DEFAULT_MAX_FILE_BYTES, maxFiles = DEFAULT_MAX_FILES, extractionTimeoutMs = DEFAULT_EXTRACTION_TIMEOUT_MS, derivedRetentionMs = DEFAULT_DERIVED_RETENTION_MS, now = () => new Date(), idFactory = crypto.randomUUID } = {}) {
    if (!assetStore || typeof assetStore.storeOriginal !== 'function') throw intakeError('invalid_intake_config', 'An AssetStore is required.');
    this.assetStore = assetStore; this.maxBytes = maxBytes; this.maxFiles = maxFiles; this.extractionTimeoutMs = extractionTimeoutMs; this.derivedRetentionMs = derivedRetentionMs; this.now = now; this.idFactory = idFactory; this.derived = new Map();
  }

  async intake({ ownerId, projectId, fileName, mimeType, bytes } = {}) {
    const metadata = validateFileIntake({ fileName, mimeType, bytes, maxBytes: this.maxBytes });
    const existing = typeof this.assetStore.findOriginalByHash === 'function' ? await this.assetStore.findOriginalByHash({ ownerId, projectId, hash: metadata.hash }) : null;
    if (existing) {
      const sameIdentity = existing.source?.file_name === metadata.file_name && existing.mime_type === metadata.mime_type;
      if (!sameIdentity) throw intakeError('duplicate_conflict', 'The same bytes already exist with different file metadata.', { existing_asset_id: existing.asset_id, hash: metadata.hash });
      return Object.freeze({ status: 'duplicate', asset: existing, intake: metadata, extraction: { status: 'NOT_VERIFIED', reason: 'No extraction/indexing pipeline is configured.' } });
    }
    const asset = await this.assetStore.storeOriginal({
      ownerId, projectId, fileName: metadata.file_name, mimeType: metadata.mime_type, bytes,
      sourceMetadata: { intake: { status: 'validated', schema_version: 'solat.file-intake.v1', extension: metadata.extension, kind: metadata.kind, validated_at: new Date().toISOString(), extraction: { status: 'NOT_VERIFIED', reason: 'No extraction/indexing pipeline is configured.' } } },
    });
    return Object.freeze({ status: 'stored', asset, intake: metadata, extraction: { status: 'NOT_VERIFIED', reason: 'No extraction/indexing pipeline is configured.' } });
  }

  async intakeBatch({ ownerId, projectId, files } = {}) {
    const entries = assertUploadBatch(files, { maxFiles: this.maxFiles });
    // Validate all entries first so an invalid later file cannot create a misleading partial success.
    const validated = entries.map(file => ({ file, metadata: validateFileIntake({ ...file, maxBytes: this.maxBytes }) }));
    const results = [];
    for (const { file } of validated) results.push(await this.intake({ ownerId, projectId, ...file }));
    return Object.freeze({ status: 'completed', count: results.length, results });
  }

  async extract({ ownerId, projectId, assetId, timeoutMs = this.extractionTimeoutMs, signal } = {}) {
    const original = await this.assetStore.readOriginal({ ownerId, projectId, assetId });
    const startedAt = Date.now();
    const kind = original.asset.source?.intake?.kind || FILE_TYPES[path.extname(original.asset.source?.file_name || '').toLowerCase()]?.kind;
    const unsupported = new Set(['pdf', 'zip-document', 'zip-spreadsheet', 'png', 'jpeg', 'gif', 'webp']);
    if (unsupported.has(kind)) return Object.freeze({ status: 'NOT_VERIFIED', reason: `No local parser is configured for ${kind}.`, original_asset_id: original.asset.asset_id, original_hash: original.asset.hash });
    try { checkExtractionBudget({ startedAt, timeoutMs, signal }); }
    catch (error) { return Object.freeze({ status: 'FAILED', code: error.code, reason: error.message, original_asset_id: original.asset.asset_id, original_hash: original.asset.hash }); }
    let extracted;
    try {
      if (kind === 'text') extracted = extractText(original.bytes, { startedAt, timeoutMs, signal });
      else if (kind === 'json') extracted = extractJson(original.bytes, { startedAt, timeoutMs, signal });
      else if (kind === 'text-csv') extracted = extractCsv(original.bytes, { startedAt, timeoutMs, signal });
      else return Object.freeze({ status: 'NOT_VERIFIED', reason: 'No local parser is configured for this file type.', original_asset_id: original.asset.asset_id, original_hash: original.asset.hash });
    } catch (error) {
      if (error instanceof ContractError) return Object.freeze({ status: 'FAILED', code: error.code, reason: error.message, original_asset_id: original.asset.asset_id, original_hash: original.asset.hash });
      return Object.freeze({ status: 'FAILED', code: 'extraction_failed', reason: 'The file could not be extracted.', original_asset_id: original.asset.asset_id, original_hash: original.asset.hash });
    }
    const now = new Date(this.now());
    const record = Object.freeze({ schema_version: 'solat.extraction.v1', derived_id: `derived_${this.idFactory()}`, owner_id: original.asset.owner_id, project_id: original.asset.project_id, original_asset_id: original.asset.asset_id, original_hash: original.asset.hash, status: 'EXTRACTED', format: kind, content: extracted.content, content_hash: `sha256:${crypto.createHash('sha256').update(JSON.stringify(extracted.content)).digest('hex')}`, citations: extracted.citations, created_at: now.toISOString(), expires_at: new Date(now.getTime() + this.derivedRetentionMs).toISOString() });
    if (typeof this.assetStore.storeDerived === 'function') await this.assetStore.storeDerived(record);
    this.derived.set(`${record.owner_id}:${record.project_id}:${record.derived_id}`, record);
    return record;
  }

  async getDerived({ ownerId, projectId, derivedId, originalAssetId } = {}) {
    const key = `${String(ownerId || '').trim()}:${String(projectId || '').trim()}:${String(derivedId || '').trim()}`;
    let record = this.derived.get(key);
    if (!record && typeof this.assetStore.readDerived === 'function') { try { record = await this.assetStore.readDerived({ ownerId, projectId, derivedId }); this.derived.set(key, record); } catch {} }
    if (!record) throw intakeError('derived_not_found', 'The extracted content is not available.');
    if (record.owner_id !== String(ownerId).trim() || record.project_id !== String(projectId).trim()) throw intakeError('asset_access_denied', 'The extracted content is outside this owner and project scope.');
    if (originalAssetId && record.original_asset_id !== String(originalAssetId).trim()) throw intakeError('derived_not_found', 'The extracted content is not linked to the requested original file.');
    return record;
  }

  async listDerived({ ownerId, projectId, originalAssetId } = {}) {
    const owner = String(ownerId || '').trim(); const project = String(projectId || '').trim();
    if (typeof this.assetStore.listDerived === 'function') { const records = await this.assetStore.listDerived({ ownerId: owner, projectId: project }); for (const record of records) this.derived.set(`${owner}:${project}:${record.derived_id}`, record); }
    return [...this.derived.values()].filter(record => record.owner_id === owner && record.project_id === project && (!originalAssetId || record.original_asset_id === String(originalAssetId).trim()));
  }

  async cleanupDerived({ ownerId, projectId, now = this.now() } = {}) {
    if (ownerId && projectId && typeof this.assetStore.listDerived === 'function') {
      for (const record of await this.assetStore.listDerived({ ownerId, projectId })) this.derived.set(`${record.owner_id}:${record.project_id}:${record.derived_id}`, record);
    }
    const timestamp = new Date(now).getTime(); let removed = 0;
    for (const [key, record] of this.derived.entries()) if (new Date(record.expires_at).getTime() <= timestamp) { if (typeof this.assetStore.deleteDerived === 'function') await this.assetStore.deleteDerived({ ownerId: record.owner_id, projectId: record.project_id, derivedId: record.derived_id }); this.derived.delete(key); removed += 1; }
    return { removed, originals_deleted: 0 };
  }
}

module.exports = { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILES, DEFAULT_DERIVED_RETENTION_MS, DEFAULT_EXTRACTION_TIMEOUT_MS, FILE_TYPES, FileIntakeService, assertUploadBatch, normalizeFileName, validateFileIntake };
