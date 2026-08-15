const crypto = require('node:crypto');
const { isAllowedUrl } = require('./web-search');

const MAX_VISIBLE_TEXT = 6000;
const SEMANTIC_RUBRIC_VERSION = 'solat.semantic-comparison-rubric.v1';
const SEMANTIC_DIMENSIONS = Object.freeze(['task_fulfillment', 'context_and_ambiguity', 'tool_and_scope_choice', 'grounding_and_sources', 'uncertainty_and_safety', 'language_and_tone']);
const SEMANTIC_WEIGHTS = Object.freeze({ task_fulfillment: 0.25, context_and_ambiguity: 0.2, tool_and_scope_choice: 0.15, grounding_and_sources: 0.2, uncertainty_and_safety: 0.1, language_and_tone: 0.1 });

function semanticReviewPacket() {
  return {
    schema_version: SEMANTIC_RUBRIC_VERSION,
    status: 'NOT VERIFIED',
    required_dimensions: ['task_fulfillment', 'context_and_ambiguity', 'tool_and_scope_choice', 'grounding_and_sources', 'uncertainty_and_safety', 'language_and_tone'],
    evidence_required: true,
    scoring_allowed: false,
    reason: 'manual_evidence_backed_rubric_required',
  };
}

function validateSemanticReview(review) {
  const dimensions = review && typeof review === 'object' ? review.dimensions : null;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return { status: 'NOT VERIFIED', reason: 'semantic_review_missing_dimensions', scoring_allowed: false };
  }
  const missing = [];
  let weighted = 0;
  for (const id of SEMANTIC_DIMENSIONS) {
    const item = dimensions[id];
    const score = Number(item?.score);
    const solatEvidence = safeText(item?.solat_evidence, 600);
    const referenceEvidence = safeText(item?.reference_evidence, 600);
    if (!Number.isInteger(score) || score < 0 || score > 4 || !solatEvidence || !referenceEvidence) {
      missing.push(id);
      continue;
    }
    weighted += score * SEMANTIC_WEIGHTS[id];
  }
  if (missing.length) return { status: 'NOT VERIFIED', reason: 'semantic_review_incomplete_or_unsubstantiated', missing_dimensions: missing, scoring_allowed: false };
  return {
    status: 'PASS', rubric_version: SEMANTIC_RUBRIC_VERSION, scoring_allowed: true,
    weighted_score_out_of_4: Number(weighted.toFixed(3)),
    note: 'Evidence-backed human review is complete. Interpret this score only with its case context and cited evidence.',
  };
}

function safeText(value, max = MAX_VISIBLE_TEXT) {
  return String(value || '').replace(/\u0000/gu, '').trim().slice(0, max);
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const output = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens']) {
    if (Number.isFinite(usage[key])) output[key] = Number(usage[key]);
  }
  return Object.keys(output).length ? output : null;
}

function safeSources(sources) {
  return (Array.isArray(sources) ? sources : []).slice(0, 10).flatMap(source => {
    const url = safeText(source?.url, 2000);
    if (!isAllowedUrl(url)) return [];
    try {
      const host = new URL(url).hostname.toLowerCase();
      return [{
        title: safeText(source?.title || host, 240), url, host,
        ...(Number.isFinite(source?.score) ? { score: Number(source.score) } : {}),
        ...(safeText(source?.source_family, 80) ? { source_family: safeText(source.source_family, 80) } : {}),
        ...(safeText(source?.authority_tier, 80) ? { authority_tier: safeText(source.authority_tier, 80) } : {}),
        ...(safeText(source?.selection_basis, 120) ? { selection_basis: safeText(source.selection_basis, 120) } : {}),
      }];
    } catch { return []; }
  });
}

function safeExternalSources(sources) {
  return (Array.isArray(sources) ? sources : []).slice(0, 10).flatMap(source => {
    const url = safeText(source?.url, 2000);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return [];
      return [{ title: safeText(source?.title || parsed.hostname, 240), url: parsed.toString(), host: parsed.hostname.toLowerCase() }];
    } catch { return []; }
  });
}

function safeError(error) {
  return { code: safeText(error?.code || 'unknown_error', 80), message: safeText(error?.message || 'Capture failed.', 500) };
}

function elapsedMs(startedAt, finishedAt) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null;
}

function captureFromExternal(item) {
  const response = safeText(item?.response || item?.assistant);
  if (!response) return { status: 'NOT VERIFIED', reason: 'chatgpt_baseline_missing', response: null };
  const contextMode = safeText(item?.context_mode, 80);
  if (!['temporary_chat', 'matched_history'].includes(contextMode)) {
    return { status: 'NOT VERIFIED', reason: 'chatgpt_baseline_context_not_isolated', response: null };
  }
  return {
    status: 'PASS',
    provider: 'chatgpt_baseline',
    model: safeText(item?.model || 'owner-captured-chatgpt', 120),
    captured_at: safeText(item?.captured_at || '', 80) || null,
    // The signed-in browser capture does not expose a reliable request start
    // time, so preserve unknown latency instead of estimating or inventing it.
    latency_ms: Number.isFinite(item?.latency_ms) && item.latency_ms >= 0 ? Number(item.latency_ms) : null,
    context_mode: contextMode,
    response,
    // ChatGPT baseline provenance is recorded separately from SOLAT's source
    // allowlist: keeping it lets a reviewer see what the external baseline cited
    // without authorizing that source for SOLAT tool output.
    sources: safeExternalSources(item?.sources),
    source_trace: safeText(item?.source_trace || 'owner_captured_external_baseline', 240),
  };
}

function indexExternalBaselines(value) {
  const rows = Array.isArray(value?.cases) ? value.cases : Array.isArray(value) ? value : [];
  const indexed = new Map();
  for (const row of rows) {
    const id = safeText(row?.id, 160);
    if (!id) continue;
    const current = indexed.get(id);
    if (!current || baselinePriority(row) > baselinePriority(current)) indexed.set(id, row);
  }
  return indexed;
}

function baselinePriority(item) {
  const context = safeText(item?.context_mode, 80);
  const isolation = ['temporary_chat', 'matched_history'].includes(context) ? 2 : 0;
  const timestamp = Date.parse(safeText(item?.captured_at, 80));
  return isolation * 10 ** 15 + (Number.isFinite(timestamp) ? timestamp : 0);
}

function safeHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-8).flatMap(message => {
    // Conversation seed turns are evaluation input, not display copy. Preserve
    // significant leading/trailing whitespace byte-for-byte so matched-history
    // captures cannot silently diverge from the corpus. NUL is still removed
    // and the bounded length is retained as a safety limit.
    const content = String(message?.content ?? '').replace(/\u0000/gu, '').slice(0, 12000);
    return content.length ? [{ role: message?.role === 'assistant' ? 'assistant' : 'user', content }] : [];
  });
}

function evaluationCase(testCase, baseline) {
  // A matched-history external baseline can supply the exact visible turns that
  // preceded its capture. This keeps all three providers on one conversation,
  // while temporary chats and ordinary corpus rows retain corpus history.
  const externalHistory = safeHistory(baseline?.history);
  const seedInputs = safeHistory(baseline?.seed_inputs);
  const matchedHistory = safeText(baseline?.context_mode, 80) === 'matched_history';
  return { ...testCase, history: matchedHistory && seedInputs.length ? seedInputs : matchedHistory && externalHistory.length ? externalHistory : safeHistory(testCase?.history) };
}

async function captureDeepSeekBaseline(provider, testCase, now = () => new Date()) {
  const startedAt = now().toISOString();
  try {
    const result = await provider.complete([
      { role: 'system', content: 'Answer the user directly and accurately. Do not use tools or invent sources.' },
      ...safeHistory(testCase.history),
      { role: 'user', content: String(testCase.content || '') },
    ]);
    const finishedAt = now().toISOString();
    return {
      status: 'PASS', started_at: startedAt, finished_at: finishedAt, latency_ms: elapsedMs(startedAt, finishedAt),
      provider: safeText(result.provider, 120), model: safeText(result.model, 160),
      response: safeText(result.content), usage: safeUsage(result.usage), tool_rounds: 0,
      sources: [], source_trace: 'raw_deepseek_baseline_without_solat_router',
    };
  } catch (error) {
    const finishedAt = now().toISOString();
    return { status: 'FAIL', started_at: startedAt, finished_at: finishedAt, latency_ms: elapsedMs(startedAt, finishedAt), error: safeError(error) };
  }
}

async function captureSolat(core, testCase, now = () => new Date(), { replayUserSeeds = false } = {}) {
  const startedAt = now().toISOString();
  try {
    const sessionId = `three-way-${testCase.id}-${crypto.randomUUID()}`;
    const evaluationHistory = safeHistory(testCase.history);
    const seedTranscript = [];
    if (replayUserSeeds && evaluationHistory.length) {
      for (const seed of evaluationHistory) {
        if (seed.role !== 'user') continue;
        const seedResult = await core.send({ sessionId, requestId: crypto.randomUUID(), content: seed.content });
        seedTranscript.push({ role: 'user', content: seed.content }, { role: 'assistant', content: safeText(seedResult?.assistant) });
      }
    } else if (Array.isArray(testCase.history) && core.sessions instanceof Map) {
      // Evaluation-only seeding is retained for A/C and compatibility; B uses replayUserSeeds.
      core.sessions.set(sessionId, evaluationHistory);
    }
    const result = await core.send({
      sessionId,
      requestId: crypto.randomUUID(),
      content: String(testCase.content || ''),
    });
    const finishedAt = now().toISOString();
    return {
      status: 'PASS', started_at: startedAt, finished_at: finishedAt, latency_ms: elapsedMs(startedAt, finishedAt),
      provider: safeText(result.provider, 120), model: safeText(result.model, 160),
      isolation_id: sessionId,
      context_mode: evaluationHistory.length ? 'matched_history' : 'temporary_chat',
      history: evaluationHistory,
      history_count: evaluationHistory.length,
      seed_transcript: seedTranscript,
      seed_request_count: seedTranscript.filter(turn => turn.role === 'user').length,
      response: safeText(result.assistant), usage: safeUsage(result.usage),
      mode: safeText(result.mode, 80), tool_rounds: Number(result.toolRounds) || 0,
      comparison_recovery_used: Boolean(result.comparisonRecoveryUsed),
      page_read_used: Boolean(result.pageReadUsed),
      page_reads: (Array.isArray(result.pageReads) ? result.pageReads : []).slice(0, 4).map(page => ({ status: safeText(page?.status, 40), tool: safeText(page?.tool, 40), url: safeText(page?.url, 600), truncated: Boolean(page?.truncated), error_code: safeText(page?.error?.code, 80) || null })),
      web_search_status: safeText(result.webSearchStatus, 80), sources: safeSources(result.sources),
      search_evidence: (Array.isArray(result.searchEvidence) ? result.searchEvidence : []).slice(0, 8).map(item => ({
        status: safeText(item?.status, 80), source_scope: safeText(item?.source_scope, 80),
        ...(safeText(item?.provider_query, 600) ? { provider_query: safeText(item.provider_query, 600) } : {}),
        result_count: Number(item?.result_count) || 0, error_count: Number(item?.error_count) || 0,
        quality: {
          status: safeText(item?.quality?.status || 'unknown', 80),
          ambiguity: safeText(item?.quality?.ambiguity || 'none', 120),
          ...(safeText(item?.quality?.authority_level, 80) ? { authority_level: safeText(item.quality.authority_level, 80) } : {}),
          agreement_status: safeText(item?.quality?.agreement_status || 'not_assessed', 40),
        },
      })),
      search_summary: result.searchSummary && typeof result.searchSummary === 'object' ? {
        source_count: Number(result.searchSummary.source_count) || 0,
        search_requested: Boolean(result.searchSummary.search_requested),
        search_used: Boolean(result.searchSummary.search_used),
        search_recovery_used: Boolean(result.searchSummary.search_recovery_used),
        contextual_coverage_used: Boolean(result.searchSummary.contextual_coverage_used),
        comparison_coverage_used: Boolean(result.searchSummary.comparison_coverage_used),
        source_scopes: Array.isArray(result.searchSummary.source_scopes) ? result.searchSummary.source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
        source_hosts: Array.isArray(result.searchSummary.source_hosts) ? result.searchSummary.source_hosts.slice(0, 10).map(host => safeText(host, 160)) : [],
        requested_source_scopes: Array.isArray(result.searchSummary.requested_source_scopes) ? result.searchSummary.requested_source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
        source_scope_priority: Array.isArray(result.searchSummary.source_scope_priority) ? result.searchSummary.source_scope_priority.slice(0, 5).map(scope => safeText(scope, 80)) : [],
        candidate_source_scopes: Array.isArray(result.searchSummary.candidate_source_scopes) ? result.searchSummary.candidate_source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
        candidate_source_scopes_used: Array.isArray(result.searchSummary.candidate_source_scopes_used) ? result.searchSummary.candidate_source_scopes_used.slice(0, 5).map(scope => safeText(scope, 80)) : [],
        ...(Array.isArray(result.searchSummary.requested_platforms) ? { requested_platforms: result.searchSummary.requested_platforms.slice(0, 5).map(platform => safeText(platform, 80)) } : {}),
        ...(Array.isArray(result.searchSummary.requested_platforms_with_evidence) ? { requested_platforms_with_evidence: result.searchSummary.requested_platforms_with_evidence.slice(0, 5).map(platform => safeText(platform, 80)) } : {}),
        ...(typeof result.searchSummary.requested_platform_status === 'string' ? { requested_platform_status: safeText(result.searchSummary.requested_platform_status, 40) } : {}),
        candidate_source_scope_status: safeText(result.searchSummary.candidate_source_scope_status || 'not_applicable', 40),
        requested_source_scope_status: safeText(result.searchSummary.requested_source_scope_status || 'not_applicable', 40),
        comparison_evidence_status: safeText(result.searchSummary.comparison_evidence_status || 'not_applicable', 40),
        authority_levels: Array.isArray(result.searchSummary.authority_levels) ? result.searchSummary.authority_levels.slice(0, 5).map(level => safeText(level, 80)) : [],
      } : null,
      source_trace: 'solat_router_provider_and_model_selected_tools',
    };
  } catch (error) {
    const finishedAt = now().toISOString();
    return { status: 'FAIL', started_at: startedAt, finished_at: finishedAt, latency_ms: elapsedMs(startedAt, finishedAt), error: safeError(error) };
  }
}

function languageHint(response) {
  const text = safeText(response, MAX_VISIBLE_TEXT);
  if (!text) return 'missing';
  const thaiCount = (text.match(/[\u0e00-\u0e7f]/gu) || []).length;
  const latinCount = (text.match(/[A-Za-z]/gu) || []).length;
  if (!thaiCount) return 'non_th';
  if (!latinCount) return 'th';
  return thaiCount / (thaiCount + latinCount) >= 0.45 ? 'th' : 'mixed';
}

function uncertaintySignal(response) {
  const text = safeText(response, MAX_VISIBLE_TEXT).toLocaleLowerCase();
  if (!text) return { marker_count: 0, markers: [] };
  const markers = [];
  for (const [label, pattern] of [
    ['insufficient_or_unknown', /\b(?:cannot|can't|unable|unknown|insufficient|unclear|not enough|no results)\b|ไม่พบ|ไม่สามารถ|ไม่แน่ใจ|ไม่เพียงพอ/iu],
    ['limitation_disclosed', /\b(?:limitation|caveat|verify|verification|source scope)\b|ข้อจำกัด|ตรวจสอบ|แหล่งข้อมูล/iu],
  ]) if (pattern.test(text)) markers.push(label);
  return { marker_count: markers.length, markers };
}

function captureObservation(capture) {
  const searchSummary = capture?.search_summary || {};
  const response = safeText(capture?.response);
  const sourceHosts = [...new Set((Array.isArray(capture?.sources) ? capture.sources : []).map(source => safeText(source?.host, 160)).filter(Boolean))];
  const authorityLevels = Array.isArray(searchSummary.authority_levels) ? searchSummary.authority_levels.map(level => safeText(level, 80)).filter(Boolean) : [];
  return {
    status: safeText(capture?.status || 'NOT VERIFIED', 40),
    response_present: Boolean(response),
    response_chars: response.length,
    response_preview: response.slice(0, 700),
    language_hint: languageHint(response),
    latency_ms: Number.isFinite(capture?.latency_ms) ? capture.latency_ms : null,
    mode: safeText(capture?.mode || 'direct', 80),
    tool_rounds: Number(capture?.tool_rounds) || 0,
    comparison_recovery_used: Boolean(capture?.comparison_recovery_used),
    page_read_used: Boolean(capture?.page_read_used),
    page_read_count: Array.isArray(capture?.page_reads) ? capture.page_reads.length : 0,
    web_search_status: safeText(capture?.web_search_status || 'not_applicable', 80),
    search_used: Boolean(searchSummary.search_used),
    search_recovery_used: Boolean(searchSummary.search_recovery_used),
    contextual_coverage_used: Boolean(searchSummary.contextual_coverage_used),
    comparison_coverage_used: Boolean(searchSummary.comparison_coverage_used),
    source_count: Number(searchSummary.source_count) || (Array.isArray(capture?.sources) ? capture.sources.length : 0),
    source_hosts: sourceHosts,
    source_preview: (Array.isArray(capture?.sources) ? capture.sources : []).slice(0, 5).map(source => ({
      title: safeText(source?.title, 240),
      url: safeText(source?.url, 600),
      host: safeText(source?.host, 160),
      ...(Number.isFinite(source?.score) ? { score: Number(source.score) } : {}),
      ...(safeText(source?.source_family, 80) ? { source_family: safeText(source.source_family, 80) } : {}),
      ...(safeText(source?.authority_tier, 80) ? { authority_tier: safeText(source.authority_tier, 80) } : {}),
      ...(safeText(source?.selection_basis, 120) ? { selection_basis: safeText(source.selection_basis, 120) } : {}),
    })),
    authority_levels: authorityLevels,
    source_scopes: Array.isArray(searchSummary.source_scopes) ? searchSummary.source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
    requested_source_scopes: Array.isArray(searchSummary.requested_source_scopes) ? searchSummary.requested_source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
    source_scope_priority: Array.isArray(searchSummary.source_scope_priority) ? searchSummary.source_scope_priority.slice(0, 5).map(scope => safeText(scope, 80)) : [],
    requested_source_scope_status: safeText(searchSummary.requested_source_scope_status || 'not_applicable', 40),
    candidate_source_scope_status: safeText(searchSummary.candidate_source_scope_status || 'not_applicable', 40),
    candidate_source_scopes: Array.isArray(searchSummary.candidate_source_scopes) ? searchSummary.candidate_source_scopes.slice(0, 5).map(scope => safeText(scope, 80)) : [],
    candidate_source_scopes_used: Array.isArray(searchSummary.candidate_source_scopes_used) ? searchSummary.candidate_source_scopes_used.slice(0, 5).map(scope => safeText(scope, 80)) : [],
    search_evidence_preview: (Array.isArray(capture?.search_evidence) ? capture.search_evidence : []).slice(0, 8).map(run => ({
      status: safeText(run?.status, 40),
      source_scope: safeText(run?.source_scope, 40),
      ...(safeText(run?.provider_query, 600) ? { provider_query: safeText(run.provider_query, 600) } : {}),
      result_count: Number(run?.result_count) || 0,
      authority_level: safeText(run?.quality?.authority_level, 80) || null,
      agreement_status: safeText(run?.quality?.agreement_status, 40) || 'not_assessed',
    })),
    uncertainty: uncertaintySignal(capture?.response),
  };
}

function structuralPair(left, right) {
  const leftScopes = Array.isArray(left?.source_scopes) ? left.source_scopes : [];
  const rightScopes = Array.isArray(right?.source_scopes) ? right.source_scopes : [];
  const overlap = leftScopes.filter(scope => rightScopes.includes(scope));
  return {
    response_presence: { left: Boolean(left?.response_present), right: Boolean(right?.response_present), equal: Boolean(left?.response_present) === Boolean(right?.response_present) },
    status: { left: safeText(left?.status || 'NOT VERIFIED', 40), right: safeText(right?.status || 'NOT VERIFIED', 40) },
    tool_rounds: { left: Number(left?.tool_rounds) || 0, right: Number(right?.tool_rounds) || 0, delta: (Number(right?.tool_rounds) || 0) - (Number(left?.tool_rounds) || 0) },
    source_count: { left: Number(left?.source_count) || 0, right: Number(right?.source_count) || 0, delta: (Number(right?.source_count) || 0) - (Number(left?.source_count) || 0) },
    source_scope_overlap: overlap,
    page_read_count: { left: Number(left?.page_read_count) || 0, right: Number(right?.page_read_count) || 0, delta: (Number(right?.page_read_count) || 0) - (Number(left?.page_read_count) || 0) },
  };
}

function comparisonObservations(captures, testCase = {}) {
  const observed = Object.fromEntries(Object.entries(captures || {}).map(([name, capture]) => [name, captureObservation(capture)]));
  const historyTurns = Array.isArray(testCase?.history) ? testCase.history.length : 0;
  return {
    schema_version: 'solat.comparison-observations.v1',
    manual_review_required: true,
    input_history_turns: historyTurns,
    structural_comparison: {
      schema_version: 'solat.structural-comparison.v1',
      semantic_score: null,
      chatgpt_vs_deepseek: structuralPair(observed.chatgpt, observed.deepseek),
      chatgpt_vs_solat: structuralPair(observed.chatgpt, observed.solat),
      deepseek_vs_solat: structuralPair(observed.deepseek, observed.solat),
    },
    dimensions: {
      task_fulfillment: { review_prompt: 'Compare whether each answer completed the exact user task; response length is only a locating signal.', observed },
      context_and_ambiguity: { review_prompt: 'Check whether follow-up context and ambiguous names were resolved consistently; do not infer quality from presence alone.', observed: { input_history_turns: historyTurns, ...observed } },
      tool_and_scope_choice: { review_prompt: 'Compare requested, candidate, attempted, and completed scopes. An attempted empty scope is not completed evidence.', observed },
      grounding_and_sources: { review_prompt: 'Compare source count, host classes, authority levels, agreement_status, and whether claims are bounded by returned evidence. Never treat multi-host or not_assessed as proof that claims agree.', observed },
      uncertainty_and_safety: { review_prompt: 'Check whether limitations and uncertainty were disclosed when evidence was missing or weak.', observed },
      language_and_tone: { review_prompt: 'Review language match, clarity, respectfulness, and tone manually; language_hint is only a triage signal.', observed },
    },
  };
}

function comparisonBoundary(captures, testCase = {}) {
  const observations = comparisonObservations(captures, testCase);
  if (captures.chatgpt.status !== 'PASS') {
    return { status: 'NOT VERIFIED', reason: 'chatgpt_baseline_missing', manual_review_required: true, rubric: semanticReviewPacket(), observations };
  }
  if (captures.deepseek.status !== 'PASS' || captures.solat.status !== 'PASS') {
    return { status: 'NOT VERIFIED', reason: 'provider_capture_incomplete', manual_review_required: true, rubric: semanticReviewPacket(), observations };
  }
  return {
    status: 'NOT VERIFIED',
    reason: 'semantic_quality_requires_manual_review',
    manual_review_required: true,
    rubric: semanticReviewPacket(),
    observations,
    note: 'All three visible answers were captured. This report intentionally does not manufacture a semantic-parity score.',
  };
}

async function runThreeWayCapture({ cases, chatgptBaselines, deepseekProvider, solatCore, now = () => new Date() } = {}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('At least one evaluation case is required.');
  if (!deepseekProvider || typeof deepseekProvider.complete !== 'function') throw new TypeError('A raw DeepSeek provider is required.');
  if (!solatCore || typeof solatCore.send !== 'function') throw new TypeError('A SOLAT conversation core is required.');
  const baselines = indexExternalBaselines(chatgptBaselines);
  const startedAt = now().toISOString();
  const rows = [];
  for (const testCase of cases) {
    const id = safeText(testCase?.id, 160);
    if (!id || !safeText(testCase?.content, 12000)) throw new TypeError('Each evaluation case needs an id and content.');
    const baseline = baselines.get(id);
    const effectiveCase = evaluationCase(testCase, baseline);
    const captures = {
      chatgpt: captureFromExternal(baseline),
      deepseek: await captureDeepSeekBaseline(deepseekProvider, effectiveCase, now),
      solat: await captureSolat(solatCore, effectiveCase, now),
    };
    rows.push({ id, prompt: safeText(testCase.content, 12000), evaluation_history: safeHistory(effectiveCase.history), captures, comparison: comparisonBoundary(captures, effectiveCase) });
  }
  const captureCounts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
  for (const row of rows) for (const capture of Object.values(row.captures)) captureCounts[capture.status] += 1;
  return {
    schema_version: '1.0', kind: 'solat_three_way_live_capture',
    started_at: startedAt, finished_at: now().toISOString(),
    scope: 'visible response, source/tool trace, latency metadata, and manual semantic review boundary',
    rows, capture_counts: captureCounts,
    comparison_counts: rows.reduce((counts, row) => ({ ...counts, [row.comparison.status]: counts[row.comparison.status] + 1 }), { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 }),
  };
}

module.exports = { baselinePriority, captureDeepSeekBaseline, captureFromExternal, captureSolat, comparisonBoundary, elapsedMs, evaluationCase, indexExternalBaselines, languageHint, runThreeWayCapture, safeExternalSources, safeSources, safeUsage, semanticReviewPacket, validateSemanticReview, SEMANTIC_DIMENSIONS, SEMANTIC_RUBRIC_VERSION };
