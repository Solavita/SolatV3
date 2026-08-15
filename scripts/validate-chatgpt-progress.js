#!/usr/bin/env node

// Validate a partial ChatGPT browser capture without treating a partial file as
// a complete baseline. This is intentionally read-only: it never edits corpus
// or progress data and never retries a provider request.
const fs = require('node:fs');
const path = require('node:path');

const MOJIBAKE = /(?:เน€เธโฌ|เน€เธ[\u0080-\u00ff]|เน[\u0080-\u00ff]|๏ฟฝ)/u;

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || fallback).trim() : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateProgress(corpus, progress, { expectedCount = 100, mode = 'B' } = {}) {
  const corpusCases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const captured = Array.isArray(progress?.cases) ? progress.cases : [];
  const byId = new Map(corpusCases.map((item) => [String(item?.id || '').trim(), item]));
  const seen = new Set();
  const isolation = new Set();
  const issues = [];
  const completed = [];
  const incomplete = [];

  if (progress?.mode !== mode) issues.push({ code: 'mode_mismatch', expected: mode, actual: progress?.mode || null });
  if (progress?.capture_protocol?.mode !== 'fresh_chat_with_exact_history_per_case') {
    issues.push({ code: 'capture_protocol_not_isolated', actual: progress?.capture_protocol?.mode || null });
  }
  if (captured.length > expectedCount) issues.push({ code: 'progress_exceeds_expected_count', expected: expectedCount, actual: captured.length });

  for (const [index, item] of captured.entries()) {
    const id = String(item?.id || '').trim();
    const rowIssues = [];
    const expected = byId.get(id);
    if (!id) rowIssues.push({ code: 'missing_case_id', index });
    else if (seen.has(id)) rowIssues.push({ code: 'duplicate_case_id', id });
    else seen.add(id);
    if (!expected) rowIssues.push({ code: 'case_not_in_corpus', id });
    if (expected && String(item?.content || '') !== String(expected?.content || '')) rowIssues.push({ code: 'prompt_mismatch', id });
    if (item?.context_mode !== 'matched_history') rowIssues.push({ code: 'context_mode_mismatch', id });
    const expectedSeeds = Array.isArray(expected?.history) ? expected.history : [];
    if (!Array.isArray(item?.seed_inputs) || !sameJson(item.seed_inputs, expectedSeeds)) rowIssues.push({ code: 'seed_inputs_not_exact', id });
    const transcript = Array.isArray(item?.transcript) ? item.transcript : null;
    if (!transcript || transcript.length !== expectedSeeds.length * 2) rowIssues.push({ code: 'transcript_incomplete', id });
    else {
      for (let turn = 0; turn < expectedSeeds.length; turn += 1) {
        const userTurn = transcript[turn * 2];
        const assistantTurn = transcript[turn * 2 + 1];
        if (userTurn?.role !== 'user' || String(userTurn?.content || '') !== String(expectedSeeds[turn]?.content || '')) rowIssues.push({ code: 'transcript_user_mismatch', id, turn });
        if (assistantTurn?.role !== 'assistant' || !String(assistantTurn?.content || '').trim()) rowIssues.push({ code: 'transcript_assistant_missing', id, turn });
      }
    }
    const isolationId = String(item?.isolation_id || '').trim();
    if (!isolationId) rowIssues.push({ code: 'isolation_id_missing', id });
    else if (isolation.has(isolationId)) rowIssues.push({ code: 'isolation_id_reused', id, isolation_id: isolationId });
    else isolation.add(isolationId);
    if (!String(item?.response || '').trim()) rowIssues.push({ code: 'response_missing', id });
    else if (MOJIBAKE.test(String(item.response))) rowIssues.push({ code: 'response_mojibake', id });
    if (String(item?.status || '').toUpperCase() !== 'PASS') rowIssues.push({ code: 'capture_status_not_pass', id, status: item?.status || null, error: item?.error || null });

    if (rowIssues.length) {
      issues.push(...rowIssues);
      incomplete.push({ id, index, status: item?.status || null, issues: rowIssues });
    } else completed.push({ id, index, isolation_id: isolationId });
  }

  const missing = corpusCases.map((item) => String(item?.id || '').trim()).filter((id) => !seen.has(id));
  const issueCounts = issues.reduce((out, issue) => { out[issue.code] = (out[issue.code] || 0) + 1; return out; }, {});
  return {
    schema_version: 'solat.chatgpt-progress-preflight.v1',
    status: missing.length || incomplete.length || issues.some((issue) => issue.code === 'capture_protocol_not_isolated') ? 'INCOMPLETE' : 'PASS',
    mode,
    expected_count: expectedCount,
    corpus_count: corpusCases.length,
    captured_count: captured.length,
    completed_count: completed.length,
    incomplete_count: incomplete.length,
    missing_count: missing.length,
    completed,
    incomplete,
    missing_ids: missing,
    issue_counts: issueCounts,
    issues,
    policy: 'Partial browser captures are resumable only for missing/invalid IDs; never treat this report as a complete baseline, alter corpus rows, reuse an isolation id, or bypass provider rate limits.',
  };
}

if (require.main === module) {
  const corpusPath = arg('--cases', 'evaluations/followup-context-100.json');
  const progressPath = arg('--progress');
  if (!progressPath) throw new Error('--progress is required');
  const outputPath = arg('--output');
  const report = validateProgress(readJson(corpusPath), readJson(progressPath), { expectedCount: Number(arg('--expected-count', '100')), mode: arg('--mode', 'B') });
  const rendered = JSON.stringify({ input: { cases: path.resolve(corpusPath), progress: path.resolve(progressPath) }, ...report }, null, 2);
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), `${rendered}\n`, 'utf8');
  process.stdout.write(`${rendered}\n`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

module.exports = { validateProgress };
