const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCapabilityCorpus } = require('../scripts/validate-capability-100');

test('capability regression corpus is exactly 100 unique local cases', () => {
  const report = validateCapabilityCorpus(require('../evaluations/capability-regression-100.json'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.case_count, 100);
  assert.equal(report.unique_case_count, 100);
  assert.equal(report.unique_marker_count, 100);
  assert.deepEqual(report.issues, []);
  for (const count of Object.values(report.category_counts)) assert.equal(count, 10);
});

test('capability preflight rejects duplicate markers and missing safety contracts', () => {
  const report = validateCapabilityCorpus({ cases: [
    { id: 'a', category: 'file_intake_safety', content: 'x', fixture: { marker: 'CAP100-000', session_id: 's' }, expected_behavior: [], forbidden_behavior: [] },
    { id: 'b', category: 'file_intake_safety', content: 'y', fixture: { marker: 'CAP100-000', session_id: 's' }, expected_behavior: ['x'], forbidden_behavior: ['y'] },
  ] }, { expectedCount: 2 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.issue_counts.duplicate_marker, 1);
  assert.equal(report.issue_counts.missing_expected_behavior, 1);
  assert.equal(report.issue_counts.missing_forbidden_behavior, 1);
});
