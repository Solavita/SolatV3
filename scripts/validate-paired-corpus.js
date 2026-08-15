#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const MOJIBAKE_SIGNATURE = /(?:เน€|เธ[\u0080-\u00ff]|โ[\u0080-\u00ff])/u;
const CONTEXT_DEPENDENT = /\b(?:earlier|previous|same project|mentioned|first one|person i mentioned|this entity|this conversation)\b/iu;
const MOJIBAKE_SUPPLEMENT = /(?:Ã.|Â.|â€|เน€|โ€|เธ[\u0080-\u009f]|�)/u;

function validatePairedCorpus(corpus, { expectedCount = 100, limitations = null } = {}) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const issues = [];
  if (cases.length !== expectedCount) {
    issues.push({ code: 'case_count_mismatch', expected: expectedCount, actual: cases.length });
  }
  const ids = new Set();
  const categoryCounts = {};
  for (const [index, item] of cases.entries()) {
    const id = String(item?.id || '').trim();
    const content = String(item?.content || '');
    const history = Array.isArray(item?.history) ? item.history : [];
    const category = String(item?.category || 'missing');
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    if (!id) issues.push({ code: 'missing_case_id', index });
    else if (ids.has(id)) issues.push({ code: 'duplicate_case_id', id });
    else ids.add(id);
    if (!content.trim()) issues.push({ code: 'missing_case_content', id });
    if (MOJIBAKE_SIGNATURE.test(content) || MOJIBAKE_SUPPLEMENT.test(content)) issues.push({ code: 'mojibake_input', id });
    if (CONTEXT_DEPENDENT.test(content) && history.length === 0) {
      const declared = limitations?.declared_missing_history?.find(item => item?.id === id);
      if (!declared || declared.expected_behavior !== 'clarify_or_state_insufficient_context') issues.push({ code: 'context_required_but_missing', id });
    }
  }
  const issueCounts = issues.reduce((counts, issue) => {
    counts[issue.code] = (counts[issue.code] || 0) + 1;
    return counts;
  }, {});
  return Object.freeze({
    schema_version: 'solat.paired-corpus-preflight.v1',
    status: issues.length ? 'FAIL' : (limitations?.declared_missing_history?.length ? 'PASS_WITH_DECLARED_LIMITATIONS' : 'PASS'),
    case_count: cases.length,
    unique_case_count: ids.size,
    category_counts: categoryCounts,
    issue_counts: issueCounts,
    issues,
    declared_limitations: limitations?.declared_missing_history || [],
    policy: 'Do not alter or silently exclude baseline cases. Resolve corpus defects or record them as declared limitations before semantic scoring.',
  });
}

function validateIsolatedChatGptBaselines(corpus, baselineDocument, { expectedCount = 100, mode = 'A' } = {}) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const baselines = Array.isArray(baselineDocument?.cases) ? baselineDocument.cases : [];
  const issues = [];
  const corpusById = new Map(cases.map(item => [String(item?.id || '').trim(), item]));
  const seenIds = new Set();
  const isolationIds = new Set();
  if (baselines.length !== expectedCount) {
    issues.push({ code: 'chatgpt_baseline_count_mismatch', expected: expectedCount, actual: baselines.length });
  }
  const expectedProtocol = mode === 'A' || mode === 'C' ? 'fresh_temporary_chat_per_case' : 'fresh_chat_with_exact_history_per_case';
  if (baselineDocument?.capture_protocol?.mode !== expectedProtocol) {
    issues.push({ code: 'chatgpt_capture_protocol_not_isolated' });
  }
  for (const [index, item] of baselines.entries()) {
    const id = String(item?.id || '').trim();
    const corpusCase = corpusById.get(id);
    const isolationId = String(item?.isolation_id || '').trim();
    if (!id || seenIds.has(id)) issues.push({ code: id ? 'duplicate_chatgpt_case_id' : 'missing_chatgpt_case_id', id, index });
    seenIds.add(id);
    if (!corpusCase) issues.push({ code: 'chatgpt_case_not_in_corpus', id });
    if (corpusCase && String(item?.content || '') !== String(corpusCase?.content || '')) {
      issues.push({ code: 'chatgpt_prompt_mismatch', id });
    }
    const history = Array.isArray(item?.history) ? item.history : null;
    if (mode === 'A' || mode === 'C') {
      if (item?.context_mode !== 'temporary_chat') issues.push({ code: 'chatgpt_context_not_temporary', id });
      if (!history || history.length !== 0 || item?.history_count !== 0) issues.push({ code: 'chatgpt_history_not_proven_empty', id });
    } else {
      if (item?.context_mode !== 'matched_history') issues.push({ code: 'chatgpt_context_not_matched_history', id });
      const seeds = Array.isArray(item?.seed_inputs) ? item.seed_inputs : null;
      const expectedSeeds = Array.isArray(corpusCase?.history) ? corpusCase.history : [];
      if (!seeds || JSON.stringify(seeds) !== JSON.stringify(expectedSeeds)) issues.push({ code: 'chatgpt_seed_inputs_not_exact_match', id });
      const transcript = Array.isArray(item?.transcript) ? item.transcript : null;
      if (!transcript || transcript.length !== expectedSeeds.length * 2) issues.push({ code: 'chatgpt_transcript_not_two_turn_per_seed', id });
      else {
        for (let turn = 0; turn < expectedSeeds.length; turn += 1) {
          const userTurn = transcript[turn * 2]; const assistantTurn = transcript[turn * 2 + 1];
          if (userTurn?.role !== 'user' || String(userTurn?.content || '') !== String(expectedSeeds[turn]?.content || '')) issues.push({ code: 'chatgpt_transcript_seed_mismatch', id });
          if (assistantTurn?.role !== 'assistant' || !String(assistantTurn?.content || '').trim()) issues.push({ code: 'chatgpt_transcript_assistant_missing', id });
        }
      }
    }
    if (!isolationId) issues.push({ code: 'chatgpt_isolation_id_missing', id });
    else if (isolationIds.has(isolationId)) issues.push({ code: 'chatgpt_isolation_id_reused', id, isolation_id: isolationId });
    else isolationIds.add(isolationId);
    if (!String(item?.response || '').trim()) issues.push({ code: 'chatgpt_response_missing', id });
    else if (MOJIBAKE_SIGNATURE.test(String(item.response))) issues.push({ code: 'chatgpt_response_mojibake', id });
  }
  for (const id of corpusById.keys()) {
    if (!seenIds.has(id)) issues.push({ code: 'chatgpt_baseline_missing', id });
  }
  const issueCounts = issues.reduce((counts, issue) => {
    counts[issue.code] = (counts[issue.code] || 0) + 1;
    return counts;
  }, {});
  return Object.freeze({
    schema_version: 'solat.chatgpt-isolation-preflight.v1',
    status: issues.length ? 'FAIL' : 'PASS',
    case_count: baselines.length,
    unique_case_count: seenIds.size,
    unique_isolation_count: isolationIds.size,
    issue_counts: issueCounts,
    issues,
    policy: 'Mode A/C require fresh temporary chats with explicit empty-history evidence; mode B requires fresh chats seeded only with exact user inputs and an alternating user/assistant transcript. Every case needs a unique isolation id.',
  });
}

function validatePairedProviderCaptures(corpus, captureDocument, { mode = 'A', providers = ['chatgpt', 'solat'] } = {}) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const rows = Array.isArray(captureDocument?.rows) ? captureDocument.rows : [];
  const byId = new Map(cases.map(item => [String(item?.id || '').trim(), item]));
  const issues = []; const seen = new Set(); const isolation = new Set();
  if (rows.length !== cases.length) issues.push({ code: 'capture_case_count_mismatch', expected: cases.length, actual: rows.length });
  for (const row of rows) {
    const id = String(row?.id || '').trim(); const expected = byId.get(id);
    if (!expected) { issues.push({ code: 'capture_case_not_in_corpus', id }); continue; }
    if (seen.has(id)) issues.push({ code: 'duplicate_capture_case_id', id }); else seen.add(id);
    const prompt = String(row?.prompt ?? row?.content ?? '');
    if (prompt !== String(expected.content || '')) issues.push({ code: 'prompt_mismatch', id });
    if (MOJIBAKE_SIGNATURE.test(prompt) || MOJIBAKE_SUPPLEMENT.test(prompt)) issues.push({ code: 'mojibake_prompt', id });
    for (const provider of providers) {
      const entry = row?.captures?.[provider] || row?.[provider];
      if (!entry) { issues.push({ code: 'provider_capture_missing', id, provider }); continue; }
      const isolationId = String(entry.isolation_id || '').trim();
      if (!isolationId) issues.push({ code: 'isolation_id_missing', id, provider });
      else if (isolation.has(isolationId)) issues.push({ code: 'isolation_id_reused', id, provider, isolation_id: isolationId });
      else isolation.add(isolationId);
      const history = Array.isArray(entry.history) ? entry.history : null;
      if (entry.history_count !== (history ? history.length : -1)) issues.push({ code: 'history_count_mismatch', id, provider });
      if (mode === 'A' || mode === 'C') {
        if (entry.context_mode !== 'temporary_chat') issues.push({ code: 'temporary_chat_required', id, provider });
        if (!Array.isArray(history) || history.length !== 0) issues.push({ code: 'baseline_history_not_empty', id, provider });
      } else {
        if (!Array.isArray(history)) issues.push({ code: 'matched_history_missing', id, provider });
        else if (JSON.stringify(history) !== JSON.stringify(expected.history || [])) issues.push({ code: 'matched_history_mismatch', id, provider });
        const transcript = Array.isArray(entry.seed_transcript) ? entry.seed_transcript : null;
        const expectedSeeds = Array.isArray(expected.history) ? expected.history : [];
        if (!transcript || transcript.length !== expectedSeeds.length * 2) issues.push({ code: 'seed_transcript_missing', id, provider });
        else for (let seedIndex = 0; seedIndex < expectedSeeds.length; seedIndex += 1) {
          const userTurn = transcript[seedIndex * 2]; const assistantTurn = transcript[seedIndex * 2 + 1];
          if (userTurn?.role !== 'user' || String(userTurn?.content || '') !== String(expectedSeeds[seedIndex]?.content || '')) issues.push({ code: 'seed_transcript_user_mismatch', id, provider });
          if (assistantTurn?.role !== 'assistant' || !String(assistantTurn?.content || '').trim()) issues.push({ code: 'seed_transcript_assistant_missing', id, provider });
        }
      }
      if (!String(entry.response || '').trim()) issues.push({ code: 'response_missing', id, provider });
      if (MOJIBAKE_SIGNATURE.test(String(entry.response || '')) || MOJIBAKE_SUPPLEMENT.test(String(entry.response || ''))) issues.push({ code: 'response_mojibake', id, provider });
    }
  }
  for (const item of cases) if (!seen.has(String(item?.id || '').trim())) issues.push({ code: 'capture_case_missing', id: item.id });
  const issueCounts = issues.reduce((counts, issue) => { counts[issue.code] = (counts[issue.code] || 0) + 1; return counts; }, {});
  return Object.freeze({ schema_version: 'solat.provider-pair-preflight.v1', mode, status: issues.length ? 'FAIL' : 'PASS', corpus_cases: cases.length, capture_rows: rows.length, unique_isolation_count: isolation.size, issue_counts: issueCounts, issues });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

if (require.main === module) {
  const input = path.resolve(argument('--cases') || 'D:/SOLAT_WORKSPACE/tmp-20260814/paired-100-corpus.json');
  const corpus = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const limitationsPath = argument('--limitations');
  const limitations = limitationsPath ? JSON.parse(fs.readFileSync(path.resolve(limitationsPath), 'utf8').replace(/^\uFEFF/, '')) : null;
  const corpusReport = validatePairedCorpus(corpus, { limitations });
  const baselinePath = argument('--chatgpt-baselines');
  const chatgptReport = baselinePath
    ? validateIsolatedChatGptBaselines(corpus, JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf8')))
    : null;
  const capturePath = argument('--capture');
  const captureReport = capturePath
    ? validatePairedProviderCaptures(corpus, JSON.parse(fs.readFileSync(path.resolve(capturePath), 'utf8').replace(/^\uFEFF/, '')), { mode: argument('--mode') || 'A' })
    : null;
  const corpusPass = corpusReport.status === 'PASS' || corpusReport.status === 'PASS_WITH_DECLARED_LIMITATIONS';
  const status = corpusPass && (!chatgptReport || chatgptReport.status === 'PASS') && (!captureReport || captureReport.status === 'PASS') ? corpusReport.status : 'FAIL';
  process.stdout.write(`${JSON.stringify({ schema_version: 'solat.paired-preflight.v2', status, input, corpus: corpusReport, chatgpt: chatgptReport, capture: captureReport }, null, 2)}\n`);
  process.exitCode = status === 'FAIL' ? 1 : 0;
}

module.exports = { validateIsolatedChatGptBaselines, validatePairedCorpus, validatePairedProviderCaptures };
