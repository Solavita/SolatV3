#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateCase } = require('../src/core/conversation-evaluator');

const benchmarkPath = path.resolve(process.cwd(), process.argv[2] || 'evaluations/model-foundation-benchmark-v1.json');
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

function evaluateBenchmarkCase(item) {
  const evaluation = item.evaluation || {};
  if (evaluation.mode !== 'intent_contract') {
    return {
      ...item,
      actual_output: null,
      status: 'NOT VERIFIED',
      evidence: evaluation.mode === 'unit_test_evidence'
        ? [{ kind: 'separate_unit_test_required', pattern: evaluation.test_pattern }]
        : [],
    };
  }
  const result = evaluateCase({
    id: item.id,
    content: item.input,
    history: item.context,
    simulated_search: evaluation.simulated_search,
    expect: evaluation.expect,
  });
  return {
    ...item,
    actual_output: result,
    status: result.status,
    evidence: [{ kind: 'local_deterministic_contract', evaluator: 'src/core/conversation-evaluator.js' }],
  };
}

const results = benchmark.cases.map(evaluateBenchmarkCase);
const counts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
for (const result of results) counts[result.status] += 1;
const report = {
  schema_version: 'solat.model-foundation-report.v1',
  benchmark_schema_version: benchmark.schema_version,
  generated_at: new Date().toISOString(),
  scoring_note: 'Counts describe only declared local contracts. NOT VERIFIED cases are not treated as passes and no GPT parity score is computed.',
  counts,
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = counts.FAIL > 0 ? 1 : 0;
