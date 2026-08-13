const crypto = require('node:crypto');
const { DEFAULT_ALLOWED_HOSTS, isAllowedUrl } = require('./web-search');

const SMOKE_PROMPT = [
  'Use the web_search tool now. Find reliable approved sources for Ada Lovelace.',
  'Then give one short, source-backed sentence. Do not answer from memory before searching.',
].join(' ');

function safeReadiness(status = {}) {
  const search = status?.search || {};
  return Object.freeze({
    model: Object.freeze({
      provider: String(status?.provider || 'unknown'),
      model: String(status?.model || 'unknown'),
      configured: Boolean(status?.configured),
    }),
    search: Object.freeze({
      provider: String(search.provider || 'disabled'),
      configured: Boolean(search.configured),
      enabled: Boolean(search.enabled),
      source_scopes: Array.isArray(search.sourceScopes) ? search.sourceScopes.map(String) : [],
      result_limit: Number.isInteger(search.resultLimit) ? search.resultLimit : null,
    }),
  });
}

function safeSources(sources) {
  return (Array.isArray(sources) ? sources : []).slice(0, 10).flatMap(source => {
    try {
      const parsed = new URL(String(source?.url || ''));
      if (!isAllowedUrl(parsed.toString(), DEFAULT_ALLOWED_HOSTS)) return [];
      return [{ title: String(source?.title || parsed.hostname).slice(0, 240), url: parsed.toString(), host: parsed.hostname.toLowerCase() }];
    } catch { return []; }
  });
}

function createReport({ startedAt, finishedAt, readiness, response = null, error = null }) {
  const sources = safeSources(response?.sources);
  const evidence = Array.isArray(response?.searchEvidence) ? response.searchEvidence.map(item => ({
    status: String(item?.status || 'unknown'),
    source_scope: String(item?.source_scope || 'auto'),
    result_count: Number(item?.result_count) || 0,
    error_count: Number(item?.error_count) || 0,
    agreement_status: String(item?.quality?.agreement_status || 'not_assessed'),
  })) : [];
  const toolUsed = response?.mode === 'search_and_model' && evidence.length > 0;
  const outcome = error
    ? 'FAIL'
    : !readiness.model.configured || !readiness.search.configured || !readiness.search.enabled
      ? 'NOT VERIFIED'
      : toolUsed && sources.length > 0
        ? 'PASS'
        : 'NOT VERIFIED';
  const reason = error
    ? 'provider_or_tool_failure'
    : outcome === 'PASS'
      ? 'model_used_search_and_returned_visible_sources'
      : !readiness.model.configured
        ? 'model_not_configured'
        : !readiness.search.configured || !readiness.search.enabled
          ? 'search_not_configured'
          : 'model_did_not_return_search_grounded_evidence';
  return Object.freeze({
    schema_version: '1.0',
    kind: 'solat_live_search_smoke',
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    outcome,
    reason,
    readiness,
    request: { prompt: SMOKE_PROMPT, provider_request_count: response ? Math.max(1, Number(response.toolRounds || 0) + 1) : 0 },
    result: response ? {
      mode: String(response.mode || 'unknown'),
      provider: String(response.provider || 'unknown'),
      model: String(response.model || 'unknown'),
      tool_rounds: Number(response.toolRounds) || 0,
      web_search_status: String(response.webSearchStatus || 'unknown'),
      source_count: sources.length,
      sources,
      search_evidence: evidence,
      usage: response.usage && typeof response.usage === 'object' ? response.usage : null,
      usage_scope: 'final_provider_response_only',
      visible_response: String(response.assistant || '').slice(0, 4000),
    } : null,
    error: error ? { code: String(error.code || 'unknown_error'), message: String(error.message || 'The smoke run failed.').slice(0, 500) } : null,
  });
}

async function runLiveSearchSmoke(core, { now = () => new Date(), sessionId = `live-search-smoke-${crypto.randomUUID()}`, requestId = crypto.randomUUID() } = {}) {
  if (!core || typeof core.status !== 'function' || typeof core.send !== 'function') throw new TypeError('A SOLAT conversation core is required.');
  const startedAt = now().toISOString();
  const readiness = safeReadiness(core.status());
  if (!readiness.model.configured || !readiness.search.configured || !readiness.search.enabled) {
    return createReport({ startedAt, finishedAt: now().toISOString(), readiness });
  }
  try {
    const response = await core.send({ sessionId, requestId, content: SMOKE_PROMPT });
    return createReport({ startedAt, finishedAt: now().toISOString(), readiness, response });
  } catch (error) {
    return createReport({ startedAt, finishedAt: now().toISOString(), readiness, error });
  }
}

module.exports = { SMOKE_PROMPT, createReport, runLiveSearchSmoke, safeReadiness, safeSources };
