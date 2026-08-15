const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const sources = [
  { source: 'A', mode: 'A', corpus: 'D:/SOLAT_WORKSPACE/tmp-20260814/paired-100-corpus.json', report_paths: ['D:/SOLAT_WORKSPACE/tmp-20260814/paired-only-100-complete-20260815.json', 'D:/SOLAT_WORKSPACE/tmp-20260814/chatgpt-baselines-100-complete-20260815.json'] },
  { source: 'B', mode: 'B', corpus: 'D:/SOLAT_V3/evaluations/followup-context-100.json', report_paths: ['D:/SOLAT_V3/reports/human-review-packet-20260815.json'] },
  { source: 'C', mode: 'C', corpus: 'D:/SOLAT_V3/evaluations/capability-regression-100.json', report_paths: ['D:/SOLAT_V3/reports/quality-iteration-20260815.json'] },
];
const dimensions = ['task_fulfillment', 'context_and_ambiguity', 'tool_and_scope_choice', 'grounding_and_sources', 'uncertainty_and_safety', 'language_and_tone'];
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries = [];
const sourceMeta = sources.map((item) => {
  const bytes = fs.readFileSync(item.corpus);
  const corpus = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const cases = Array.isArray(corpus.cases) ? corpus.cases : [];
  for (const [index, testCase] of cases.entries()) entries.push({ id: String(testCase.id), source: item.source, mode: item.mode, index });
  return { source: item.source, mode: item.mode, corpus_path: item.corpus, sha256: hashFile(item.corpus), case_count: cases.length, report_paths: item.report_paths };
});
const output = 'D:/SOLAT_V3/evaluations/evaluation-manifest-300.json';
const manifest = {
  schema_version: 'solat.evaluation-manifest.v1',
  generated_at: new Date().toISOString(),
  suite: 'SOLAT foundation supplemental paired evaluation',
  total_cases: entries.length,
  source_suites: sourceMeta,
  case_refs: entries,
  dimensions,
  score_gate: { each_dimension_percent_gt: 80, overall_percent_gt: 80, no_category_below_percent: 80 },
  retry_policy: { max_attempts_per_case: 1, allow_answer_cherry_picking: false, duplicate_requests_are_failures: true, provider_retry: 'disabled_in_manifest_generation' },
  evidence_policy: 'Capture completeness is separate from semantic quality. GPT-judge is preliminary; human review remains required.',
  report_paths: ['D:/SOLAT_V3/reports/human-review-packet-20260815.json', 'D:/SOLAT_WORKSPACE/tmp-20260814/solat-quality-report-final-20260815.json'],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output, total_cases: entries.length, sourceMeta }, null, 2));
