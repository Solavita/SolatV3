#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { evaluateCase } = require('../src/core/conversation-evaluator');

const benchmarkPath = path.resolve(process.cwd(), process.argv[2] || 'evaluations/model-foundation-benchmark-v1.json');
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
const iterations = Number.parseInt(process.env.SOLAT_LOCAL_BENCHMARK_ITERATIONS || '200', 10);
if (!Number.isInteger(iterations) || iterations < 2 || iterations > 5000) {
  throw new Error('SOLAT_LOCAL_BENCHMARK_ITERATIONS must be an integer from 2 to 5000.');
}

const contractCases = benchmark.cases.filter(item => item.evaluation?.mode === 'intent_contract');
const evaluateContracts = () => contractCases.map(item => evaluateCase({
  id: item.id,
  content: item.input,
  history: item.context,
  simulated_search: item.evaluation.simulated_search,
  expect: item.evaluation.expect,
}));

// Warm the module/JIT path before measuring. Only deterministic, local router
// contracts run here; no model, provider, network, or paid API is invoked.
for (let index = 0; index < 10; index += 1) evaluateContracts();
const expectedOrdering = contractCases.map(item => item.id);
const baseline = JSON.stringify(evaluateContracts());
const digest = crypto.createHash('sha256').update(baseline).digest('hex');
const heapBefore = process.memoryUsage().heapUsed;
const latenciesMs = [];
let mismatchCount = 0;
for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  const actual = JSON.stringify(evaluateContracts());
  latenciesMs.push(performance.now() - started);
  if (actual !== baseline) mismatchCount += 1;
}
const heapAfter = process.memoryUsage().heapUsed;
const sortedLatencies = [...latenciesMs].sort((left, right) => left - right);
const percentile = value => sortedLatencies[Math.min(sortedLatencies.length - 1, Math.ceil(sortedLatencies.length * value) - 1)];
const observedOrdering = JSON.parse(baseline).map(item => item.id);
const budgets = {
  p95_iteration_ms: 100,
  max_heap_growth_bytes: 64 * 1024 * 1024,
};
const metrics = {
  iterations,
  contract_cases_per_iteration: contractCases.length,
  total_case_evaluations: iterations * contractCases.length,
  median_iteration_ms: percentile(0.5),
  p95_iteration_ms: percentile(0.95),
  max_iteration_ms: sortedLatencies[sortedLatencies.length - 1],
  heap_growth_bytes: Math.max(0, heapAfter - heapBefore),
};
const checks = {
  repeated_output_is_deterministic: mismatchCount === 0,
  result_order_matches_benchmark: JSON.stringify(observedOrdering) === JSON.stringify(expectedOrdering),
  p95_within_local_budget: metrics.p95_iteration_ms <= budgets.p95_iteration_ms,
  heap_growth_within_local_budget: metrics.heap_growth_bytes <= budgets.max_heap_growth_bytes,
};
const report = {
  schema_version: 'solat.model-foundation-local-performance.v1',
  benchmark_schema_version: benchmark.schema_version,
  scope: 'local deterministic router/evaluator contracts only; no semantic or GPT parity score',
  deterministic_output_sha256: digest,
  mismatch_count: mismatchCount,
  ordering: observedOrdering,
  budgets,
  metrics,
  checks,
  status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === 'PASS' ? 0 : 1;
