const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES, REPORT_SCHEMA_VERSION, consistencyStatus, evaluateData, reviewExistingReport } = require('../scripts/evaluate-model-foundation-live');

test('live semantic evaluator checks classifications, support, evidence and extra claims', () => {
  const testCase = CASES.find(item => item.id === 'fact_vs_inference');
  const valid = evaluateData(testCase, {
    case_id: testCase.id,
    final_status: 'partial',
    verdicts: [
      { claim_id: 'c1', classification: 'fact', supported: true, evidence_ids: ['E1'], rationale: 'direct' },
      { claim_id: 'c2', classification: 'inference', supported: true, evidence_ids: ['E1'], rationale: 'possible cause' },
      { claim_id: 'c3', classification: 'unknown', supported: false, evidence_ids: [], rationale: 'absent' },
    ],
  });
  assert.equal(valid.status, 'PASS');
  const invalid = evaluateData(testCase, {
    case_id: testCase.id,
    final_status: 'answered',
    verdicts: [{ claim_id: 'c3', classification: 'fact', supported: true, evidence_ids: ['E9'], rationale: 'invented' }],
  });
  assert.equal(invalid.status, 'FAIL');
});

test('consistency evaluator requires every run to pass with identical semantic verdicts', () => {
  const row = { evaluation: { status: 'PASS', normalized_verdicts: { c1: { classification: 'fact', supported: true, evidence_ids: ['E1'] } } } };
  assert.deepEqual(consistencyStatus([row, row, row]), { status: 'PASS', stable: true, distinct_signatures: 1 });
  assert.equal(consistencyStatus([row, { evaluation: { status: 'PASS', normalized_verdicts: { c1: { classification: 'unknown', supported: false, evidence_ids: [] } } } }]).status, 'FAIL');
});

test('stored provider output can be reviewed without making another request', () => {
  const cases = CASES.map(testCase => {
    const verdicts = Object.entries(testCase.expected).map(([claim_id, expected]) => ({
      claim_id,
      ...expected,
      rationale: 'stored provider rationale',
    }));
    const run = {
      data: {
        case_id: testCase.id,
        final_status: testCase.allowedFinalStatuses ? testCase.allowedFinalStatuses[0] : 'partial',
        verdicts,
      },
      evaluation: { status: 'FAIL' },
    };
    return { case_id: testCase.id, status: 'FAIL', runs: Array.from({ length: testCase.repeats || 1 }, () => structuredClone(run)) };
  });
  const reviewed = reviewExistingReport({
    schema_version: REPORT_SCHEMA_VERSION,
    request_count: 6,
    retry_count: 0,
    cases,
  });
  assert.equal(reviewed.status, 'PASS');
  assert.deepEqual(reviewed.counts, { PASS: 4, FAIL: 0 });
  assert.equal(reviewed.request_count, 6);
});
