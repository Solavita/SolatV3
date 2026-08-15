const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvaluationManifest } = require('../scripts/validate-evaluation-manifest-300');

test('300-case manifest covers unchanged A/B/C corpora with hashes and modes', () => {
  const report = validateEvaluationManifest(require('../evaluations/evaluation-manifest-300.json'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.total_refs, 300);
  assert.equal(report.unique_ids, 300);
  assert.deepEqual(report.source_counts, { A: 100, B: 100, C: 100 });
  assert.deepEqual(report.issues, []);
});

test('manifest rejects source tampering, duplicate IDs, or answer cherry-picking', () => {
  const manifest = {
    total_cases: 2,
    case_refs: [{ id: 'x', source: 'A', mode: 'B', index: 0 }, { id: 'x', source: 'A', mode: 'B', index: 1 }],
    source_suites: [],
    retry_policy: { allow_answer_cherry_picking: true, max_attempts_per_case: 2 },
  };
  const report = validateEvaluationManifest(manifest, { expectedTotal: 2 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.issue_counts.duplicate_ref_id, 1);
  assert.equal(report.issue_counts.source_mode_mismatch, 2);
  assert.equal(report.issue_counts.cherry_picking_not_disabled, 1);
  assert.equal(report.issue_counts.retry_limit_not_one, 1);
});
