const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function runLocalBenchmark() {
  const result = spawnSync(process.execPath, ['scripts/benchmark-model-foundation-local.js'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOLAT_LOCAL_BENCHMARK_ITERATIONS: '200' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('router/evaluator ordering and output remain deterministic across repeated local runs', () => {
  const first = runLocalBenchmark();
  const second = runLocalBenchmark();
  assert.equal(first.schema_version, 'solat.model-foundation-local-performance.v1');
  assert.equal(first.status, 'PASS');
  assert.equal(first.mismatch_count, 0);
  assert.deepEqual(first.checks, {
    repeated_output_is_deterministic: true,
    result_order_matches_benchmark: true,
    p95_within_local_budget: true,
    heap_growth_within_local_budget: true,
  });
  assert.equal(first.deterministic_output_sha256, second.deterministic_output_sha256);
  assert.deepEqual(first.ordering, second.ordering);
  assert.match(first.scope, /no semantic or GPT parity score/iu);
});

test('local performance report enforces bounded latency and memory growth', () => {
  const report = runLocalBenchmark();
  assert.equal(report.metrics.iterations, 200);
  assert.equal(report.metrics.total_case_evaluations, report.metrics.iterations * report.metrics.contract_cases_per_iteration);
  assert.ok(report.metrics.p95_iteration_ms <= report.budgets.p95_iteration_ms);
  assert.ok(report.metrics.heap_growth_bytes <= report.budgets.max_heap_growth_bytes);
  assert.ok(report.budgets.max_heap_growth_bytes <= 64 * 1024 * 1024);
});
