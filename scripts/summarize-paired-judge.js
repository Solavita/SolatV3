#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const DIMENSIONS = Object.freeze([
  'context_and_ambiguity', 'language_and_tone', 'task_fulfillment',
  'tool_and_scope_choice', 'grounding_and_sources', 'uncertainty_and_safety',
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8').replace(/^\uFEFF/u, ''));
}

function meanPercent(rows, provider, dimension) {
  const total = rows.reduce((sum, row) => sum + row[`${provider}_scores`][dimension], 0);
  return Number(((total / (rows.length * 4)) * 100).toFixed(2));
}

function main() {
  const judgePath = argument('--judge');
  const corpusPath = argument('--cases');
  const pairedPath = argument('--paired');
  const outputPath = argument('--output');
  if (!judgePath || !corpusPath || !pairedPath || !outputPath) throw new Error('--judge, --cases, --paired and --output are required.');
  const judge = readJson(judgePath);
  const corpus = readJson(corpusPath);
  const paired = readJson(pairedPath);
  const cases = Array.isArray(corpus.cases) ? corpus.cases : [];
  // Current judge output stores validated rows directly in `results`; retain
  // support for the older batched format so historical reports remain readable.
  const rows = Array.isArray(judge.results)
    ? judge.results
    : (Array.isArray(judge.batches) ? judge.batches : []).flatMap(batch => Array.isArray(batch.parsed) ? batch.parsed : []);
  const expectedIds = new Set(cases.map(item => item.id));
  const seen = new Set();
  const issues = [];
  for (const row of rows) {
    if (!expectedIds.has(row.id)) issues.push({ code: 'unknown_case_id', id: row.id });
    if (seen.has(row.id)) issues.push({ code: 'duplicate_case_id', id: row.id });
    seen.add(row.id);
    for (const provider of ['chatgpt', 'solat']) for (const dimension of DIMENSIONS) {
      const score = row?.[`${provider}_scores`]?.[dimension];
      if (!Number.isInteger(score) || score < 0 || score > 4) issues.push({ code: 'invalid_score', id: row.id, provider, dimension, score });
    }
  }
  for (const id of expectedIds) if (!seen.has(id)) issues.push({ code: 'missing_case_id', id });
  if (rows.length !== cases.length || paired.rows?.length !== cases.length) issues.push({ code: 'case_count_mismatch', judged: rows.length, corpus: cases.length, paired: paired.rows?.length });
  if (issues.length) throw new Error(`Judge validation failed: ${JSON.stringify(issues.slice(0, 20))}`);
  const dimensions = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, {
    chatgpt_percent: meanPercent(rows, 'chatgpt', dimension),
    solat_percent: meanPercent(rows, 'solat', dimension),
  }]));
  const categoryById = new Map(cases.map(item => [item.id, item.category]));
  const categories = {};
  for (const category of [...new Set(cases.map(item => item.category))]) {
    const selected = rows.filter(row => categoryById.get(row.id) === category);
    categories[category] = {
      cases: selected.length,
      chatgpt_percent: Number((DIMENSIONS.reduce((sum, dimension) => sum + meanPercent(selected, 'chatgpt', dimension), 0) / DIMENSIONS.length).toFixed(2)),
      solat_percent: Number((DIMENSIONS.reduce((sum, dimension) => sum + meanPercent(selected, 'solat', dimension), 0) / DIMENSIONS.length).toFixed(2)),
    };
  }
  const overall = provider => Number((DIMENSIONS.reduce((sum, dimension) => sum + meanPercent(rows, provider, dimension), 0) / DIMENSIONS.length).toFixed(2));
  const report = {
    schema_version: 'solat.paired-quality.preliminary.v2',
    status: 'IMPLEMENTED BUT NOT FULLY VERIFIED',
    evaluated_at: new Date().toISOString(),
    evaluated_pairs: rows.length,
    provider_capture: {
      chatgpt: { provider: 'chatgpt_web_ui', model: 'Instant', exact_model_version: 'NOT VERIFIED' },
      solat: { provider: paired.rows[0]?.captures?.solat?.provider || 'unknown', model: paired.rows[0]?.captures?.solat?.model || 'unknown' },
    },
    method: 'ChatGPT web judge preliminary; both answers scored independently on six dimensions, 0-4',
    overall_percent: { chatgpt: overall('chatgpt'), solat: overall('solat') },
    dimension_percent: dimensions,
    category_percent: categories,
    preference_counts: rows.reduce((out, row) => { out[row.preferred] = (out[row.preferred] || 0) + 1; return out; }, { chatgpt: 0, solat: 0, tie: 0 }),
    critical_failure_ids: rows.filter(row => row.critical_failure).map(row => row.id),
    human_review_required: true,
    limitations: [
      'The judge is ChatGPT web UI and is not an independent human reviewer.',
      'ChatGPT exact model version is not exposed by the UI; the visible selector was Instant.',
      'Ten original baseline cases lack required prior history and are scored on clarification/unknown handling only.',
      'A paired score is evidence for this fixed capture only, not a claim of GPT equivalence.',
    ],
    source_paths: { judge: path.resolve(judgePath), corpus: path.resolve(corpusPath), paired: path.resolve(pairedPath) },
    results: rows,
  };
  const absolute = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output: absolute, pairs: rows.length, overall_percent: report.overall_percent, dimension_percent: report.dimension_percent, preference_counts: report.preference_counts, critical_failure_ids: report.critical_failure_ids }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`Judge summary failed: ${String(error?.message || error)}\n`); process.exitCode = 1; }
}

module.exports = { DIMENSIONS, meanPercent };
