const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const PERSISTENCE_SCHEMA_VERSION = '1.0';
const MAX_MESSAGES = 200;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function requiredSession(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/]/.test(normalized)) throw Object.assign(new Error('A safe session id is required.'), { code: 'invalid_request' });
  return normalized;
}

function redact(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_SECRET]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]{12,}/gi, '$1[REDACTED_SECRET]')
    .replace(/((?:api[_ -]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED_SECRET]');
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  return {
    id: String(message.id || ''),
    ts: Number(message.ts) || 0,
    role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'assistant',
    content: redact(String(message.content || '')).slice(0, 20000),
    error: Boolean(message.error),
    responseMeta: message.responseMeta && typeof message.responseMeta === 'object' ? {
      provider: redact(String(message.responseMeta.provider || '')),
      model: redact(String(message.responseMeta.model || '')),
      mode: redact(String(message.responseMeta.mode || '')),
      webSearchStatus: redact(String(message.responseMeta.webSearchStatus || '')),
      searchRecoveryUsed: Boolean(message.responseMeta.searchRecoveryUsed),
      sources: Array.isArray(message.responseMeta.sources) ? message.responseMeta.sources.slice(0, 10).map(source => ({ title: redact(String(source?.title || '')), url: String(source?.url || '') })) : [],
      searchEvidence: Array.isArray(message.responseMeta.searchEvidence) ? message.responseMeta.searchEvidence.slice(-3).map(evidence => ({ status: redact(String(evidence?.status || '')), source_scope: redact(String(evidence?.source_scope || 'auto')), query: redact(String(evidence?.query || '')).slice(0, 500), ...(evidence?.provider_query ? { provider_query: redact(String(evidence.provider_query)).slice(0, 600) } : {}), allowed_hosts: Array.isArray(evidence?.allowed_hosts) ? evidence.allowed_hosts.slice(0, 20).map(host => redact(String(host))) : [], result_count: Number(evidence?.result_count) || 0, error_count: Number(evidence?.error_count) || 0, quality: { status: redact(String(evidence?.quality?.status || 'unknown')), ambiguity: redact(String(evidence?.quality?.ambiguity || 'none')), authority_level: redact(String(evidence?.quality?.authority_level || 'unknown')), corroboration: redact(String(evidence?.quality?.corroboration || 'none')), agreement_status: redact(String(evidence?.quality?.agreement_status || 'none')), dropped_unrelated_count: Number(evidence?.quality?.dropped_unrelated_count) || 0, matched_entities: Array.isArray(evidence?.quality?.matched_entities) ? evidence.quality.matched_entities.slice(0, 4).map(entity => redact(String(entity))) : [] } })) : [],
      searchSummary: {
        source_count: Number(message.responseMeta.searchSummary?.source_count) || 0,
        search_requested: Boolean(message.responseMeta.searchSummary?.search_requested),
        search_used: Boolean(message.responseMeta.searchSummary?.search_used),
        search_recovery_used: Boolean(message.responseMeta.searchSummary?.search_recovery_used),
        contextual_coverage_used: Boolean(message.responseMeta.searchSummary?.contextual_coverage_used),
        comparison_coverage_used: Boolean(message.responseMeta.searchSummary?.comparison_coverage_used),
        source_scopes: Array.isArray(message.responseMeta.searchSummary?.source_scopes) ? message.responseMeta.searchSummary.source_scopes.slice(0, 5).map(scope => redact(String(scope))) : [],
        source_hosts: Array.isArray(message.responseMeta.searchSummary?.source_hosts) ? message.responseMeta.searchSummary.source_hosts.slice(0, 10).map(host => redact(String(host))) : [],
        statuses: Array.isArray(message.responseMeta.searchSummary?.statuses) ? message.responseMeta.searchSummary.statuses.slice(0, 5).map(status => redact(String(status))) : [],
        requested_source_scopes: Array.isArray(message.responseMeta.searchSummary?.requested_source_scopes) ? message.responseMeta.searchSummary.requested_source_scopes.slice(0, 5).map(scope => redact(String(scope))) : [],
        source_scope_priority: Array.isArray(message.responseMeta.searchSummary?.source_scope_priority) ? message.responseMeta.searchSummary.source_scope_priority.slice(0, 5).map(scope => redact(String(scope))) : [],
        candidate_source_scopes: Array.isArray(message.responseMeta.searchSummary?.candidate_source_scopes) ? message.responseMeta.searchSummary.candidate_source_scopes.slice(0, 5).map(scope => redact(String(scope))) : [],
        candidate_source_scopes_used: Array.isArray(message.responseMeta.searchSummary?.candidate_source_scopes_used) ? message.responseMeta.searchSummary.candidate_source_scopes_used.slice(0, 5).map(scope => redact(String(scope))) : [],
        comparison_entities: Array.isArray(message.responseMeta.searchSummary?.comparison_entities) ? message.responseMeta.searchSummary.comparison_entities.slice(0, 4).map(entity => redact(String(entity))) : [],
        comparison_entities_with_evidence: Array.isArray(message.responseMeta.searchSummary?.comparison_entities_with_evidence) ? message.responseMeta.searchSummary.comparison_entities_with_evidence.slice(0, 4).map(entity => redact(String(entity))) : [],
        ...(Array.isArray(message.responseMeta.searchSummary?.requested_platforms) ? { requested_platforms: message.responseMeta.searchSummary.requested_platforms.slice(0, 5).map(platform => redact(String(platform))) } : {}),
        ...(Array.isArray(message.responseMeta.searchSummary?.requested_platforms_with_evidence) ? { requested_platforms_with_evidence: message.responseMeta.searchSummary.requested_platforms_with_evidence.slice(0, 5).map(platform => redact(String(platform))) } : {}),
        ...(typeof message.responseMeta.searchSummary?.requested_platform_status === 'string' ? { requested_platform_status: redact(String(message.responseMeta.searchSummary.requested_platform_status)) } : {}),
        authority_levels: Array.isArray(message.responseMeta.searchSummary?.authority_levels) ? message.responseMeta.searchSummary.authority_levels.slice(0, 5).map(level => redact(String(level))) : [],
        comparison_evidence_status: redact(String(message.responseMeta.searchSummary?.comparison_evidence_status || 'not_applicable')),
        requested_source_scope_status: redact(String(message.responseMeta.searchSummary?.requested_source_scope_status || 'not_applicable')),
        candidate_source_scope_status: redact(String(message.responseMeta.searchSummary?.candidate_source_scope_status || 'not_applicable')),
      },
    } : undefined,
  };
}

class ConversationPersistence {
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
      if (parsed.session_id !== normalized) throw Object.assign(new Error('Persisted conversation ownership does not match.'), { code: 'ownership_mismatch' });
      if (parsed.schema_version !== PERSISTENCE_SCHEMA_VERSION || !parsed.thread) throw Object.assign(new Error('Persisted conversation is malformed.'), { code: 'persistence_invalid' });
      return { ...parsed, thread: clone(parsed.thread) };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schema_version: PERSISTENCE_SCHEMA_VERSION, session_id: normalized, thread: null };
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
      throw Object.assign(new Error('Conversation persistence failed.'), { code: 'persistence_write_failed', cause: error });
    }
  }

  async save({ sessionId, thread } = {}) {
    const normalized = requiredSession(sessionId);
    if (!thread || typeof thread !== 'object') throw Object.assign(new Error('A conversation thread is required.'), { code: 'invalid_request' });
    const safeThread = {
      id: String(thread.id || ''),
      title: redact(String(thread.title || 'New conversation')).slice(0, 200),
      createdAt: Number(thread.createdAt) || 0,
      updatedAt: Number(thread.updatedAt) || 0,
      messages: Array.isArray(thread.messages) ? thread.messages.map(sanitizeMessage).filter(Boolean).slice(-MAX_MESSAGES) : [],
    };
    await this._write({ schema_version: PERSISTENCE_SCHEMA_VERSION, session_id: normalized, thread: safeThread });
    return { sessionId: normalized, thread: clone(safeThread) };
  }

  async load({ sessionId } = {}) {
    const record = await this._read(requiredSession(sessionId));
    return { sessionId: record.session_id, thread: clone(record.thread) };
  }
}

module.exports = { ConversationPersistence, PERSISTENCE_SCHEMA_VERSION, MAX_MESSAGES, sanitizeMessage };
