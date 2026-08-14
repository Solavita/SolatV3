const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const benchmarkPath = path.join(root, 'evaluations', 'model-foundation-benchmark-v1.json');

test('model foundation benchmark covers the required 25 reproducible categories', () => {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  const required = [
    'instruction_following', 'multi_step_instruction', 'thai_conversation',
    'english_conversation', 'mixed_thai_english', 'typo_handling',
    'spacing_variation', 'romanization', 'ambiguous_references',
    'follow_up_context', 'correction_handling', 'long_context',
    'fact_vs_inference', 'unknown_handling', 'insufficient_evidence_refusal',
    'hallucination_guard', 'tool_selection', 'tool_argument_construction',
    'malformed_tool_response', 'timeout', 'retry_limit', 'duplicate_request',
    'answer_consistency', 'prompt_injection_resistance', 'output_schema_validity',
  ];
  assert.equal(benchmark.schema_version, 'solat.model-foundation-benchmark.v1');
  assert.deepEqual(benchmark.cases.map(item => item.category), required);
  for (const item of benchmark.cases) {
    assert.ok(item.id);
    assert.equal(typeof item.input, 'string');
    assert.ok(Array.isArray(item.context));
    assert.ok(item.expected_behavior.length > 0);
    assert.ok(item.forbidden_behavior.length > 0);
    assert.equal(item.actual_output, null);
    assert.equal(item.status, 'NOT VERIFIED');
    assert.ok(Array.isArray(item.evidence));
    assert.ok(item.limitation);
    assert.ok(['intent_contract', 'manual_model_trace', 'unit_test_evidence'].includes(item.evaluation.mode));
  }
  assert.doesNotMatch(JSON.stringify(benchmark), /GPT\s*(?:score|parity)\s*[:=]\s*\d/iu);
});

test('model foundation evaluator records local passes and keeps semantic cases NOT VERIFIED', () => {
  const result = spawnSync(process.execPath, ['scripts/evaluate-model-foundation.js'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 'solat.model-foundation-report.v1');
  assert.deepEqual(report.counts, { PASS: 19, FAIL: 0, 'NOT VERIFIED': 6 });
  assert.equal(report.results.length, 25);
  assert.ok(report.results.filter(item => item.status === 'PASS').every(item => item.actual_output));
  assert.ok(report.results.filter(item => item.status === 'FAIL').every(item => item.actual_output));
  assert.ok(report.results.filter(item => item.status === 'NOT VERIFIED').every(item => item.actual_output === null));
  assert.equal(report.results.find(item => item.id === 'thai_conversation').status, 'PASS');
  assert.equal(report.results.find(item => item.id === 'instruction_following').status, 'PASS');
  assert.equal(report.results.find(item => item.id === 'multi_step_instruction').status, 'PASS');
  assert.equal(report.results.find(item => item.id === 'romanization').status, 'PASS');
  for (const id of ['malformed_tool_response', 'timeout', 'retry_limit', 'duplicate_request', 'prompt_injection_resistance', 'output_schema_validity']) {
    const item = report.results.find(resultItem => resultItem.id === id);
    assert.equal(item.status, 'PASS');
    assert.ok(item.actual_output);
    assert.equal(item.evidence[0].kind, 'local_production_contract');
  }
  assert.match(report.scoring_note, /no GPT parity score/iu);
});
