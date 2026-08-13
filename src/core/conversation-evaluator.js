const { analyzeIntent } = require('./intent-router');
const { isAllowedUrl } = require('./web-search');

function check(condition, label, details = {}) {
  return { status: condition ? 'PASS' : 'FAIL', label, details };
}

function evaluateCase(testCase) {
  const expectation = testCase.expect || {};
  if (expectation.manual_review_required) {
    return { id: testCase.id, status: 'NOT VERIFIED', checks: [{ status: 'NOT VERIFIED', label: 'live_semantic_parity_requires_external_baseline' }], limitation: 'A deterministic evaluator cannot establish semantic parity with a live ChatGPT answer.' };
  }
  const hints = analyzeIntent({ content: testCase.content, history: testCase.history || [] });
  const checks = [];
  if (expectation.top_intent) checks.push(check(hints.top_intent === expectation.top_intent, 'top_intent', { expected: expectation.top_intent, actual: hints.top_intent }));
  if (typeof expectation.web_search === 'boolean') checks.push(check(hints.allowed_tools.includes('web_search') === expectation.web_search, 'web_search_availability'));
  if (typeof expectation.model_first === 'boolean') checks.push(check(hints.routing.mode.startsWith('model_first') === expectation.model_first && hints.routing.hard_gate === false, 'model_first_without_hard_gate'));
  if (Number.isInteger(expectation.prior_turn_count)) checks.push(check(hints.conversational_context.prior_turn_count === expectation.prior_turn_count, 'follow_up_context'));
  if (typeof expectation.likely_ambiguous === 'boolean') checks.push(check(hints.disambiguation.likely_ambiguous === expectation.likely_ambiguous, 'ambiguity_signal'));
  if (typeof expectation.comparison === 'boolean') checks.push(check(hints.disambiguation.comparison === expectation.comparison, 'comparison_signal'));
  if (Number.isInteger(expectation.entity_count)) checks.push(check(hints.disambiguation.candidate_entities.length === expectation.entity_count, 'comparison_entity_count'));
  if (Array.isArray(expectation.query_variants)) checks.push(check(JSON.stringify(hints.task.search_query_variants.map(item => item.query)) === JSON.stringify(expectation.query_variants), 'bounded_query_variants'));
  if (expectation.source_scope) checks.push(check(hints.task.source_scope_candidates.includes(expectation.source_scope), 'source_scope_candidate'));
  if (Array.isArray(expectation.source_scopes)) checks.push(check(JSON.stringify(hints.task.source_scope_candidates) === JSON.stringify(expectation.source_scopes), 'source_scope_candidates'));
  if (Array.isArray(expectation.source_scope_priority)) checks.push(check(JSON.stringify(hints.task.source_scope_priority) === JSON.stringify(expectation.source_scope_priority), 'source_scope_priority'));
  if (Array.isArray(expectation.requested_source_scopes)) checks.push(check(JSON.stringify(hints.task.requested_source_scopes) === JSON.stringify(expectation.requested_source_scopes), 'requested_source_scopes'));
  if (expectation.reference_resolution) checks.push(check(hints.reference_resolution.status === expectation.reference_resolution, 'reference_resolution'));
  if (expectation.context_entity) checks.push(check(hints.task.context_entity_candidates.includes(expectation.context_entity), 'context_entity_candidate'));
  if (Number.isInteger(expectation.reference_ordinal)) checks.push(check(hints.reference_resolution.ordinal === expectation.reference_ordinal, 'reference_ordinal'));
  if (expectation.query_variant) checks.push(check(hints.task.search_query_variants.some(item => item.query === expectation.query_variant), 'context_query_variant'));
  if (expectation.context_qualifier) checks.push(check(hints.task.context_qualifiers.includes(expectation.context_qualifier), 'context_qualifier'));
  if (testCase.simulated_search) {
    const status = String(testCase.simulated_search.status || 'unknown');
    const safeSources = (testCase.simulated_search.sources || []).filter(source => isAllowedUrl(source?.url));
    if (expectation.truthful_search_status) checks.push(check(status === expectation.truthful_search_status, 'truthful_search_status'));
    if (Number.isInteger(expectation.citation_count)) checks.push(check(safeSources.length === expectation.citation_count, 'approved_citation_disclosure', { visible: safeSources.length }));
  }
  return { id: testCase.id, status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', checks, intent: { top_intent: hints.top_intent, allowed_tools: hints.allowed_tools, source_scope_candidates: hints.task.source_scope_candidates, requested_source_scopes: hints.task.requested_source_scopes } };
}

function evaluateCorpus(corpus) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const results = cases.map(evaluateCase);
  const counts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
  for (const result of results) counts[result.status] += 1;
  return { schema_version: '1.0', kind: 'solat_deterministic_conversation_evaluation', corpus_name: String(corpus?.name || 'unnamed'), results, counts };
}

module.exports = { evaluateCase, evaluateCorpus };
