const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFollowupCorpus } = require('../scripts/validate-followup-corpus');

test('supplemental follow-up corpus is exactly 100 cases with bound history', () => {
  const corpus = require('../evaluations/followup-context-100.json');
  const report = validateFollowupCorpus(corpus);
  assert.equal(report.status, 'PASS');
  assert.equal(report.case_count, 100);
  assert.equal(report.unique_case_count, 100);
  assert.equal(report.unique_marker_count, 100);
  assert.deepEqual(report.issues, []);
  for (const count of Object.values(report.category_counts)) assert.equal(count, 10);
});

test('follow-up preflight rejects empty history and cross-case marker reuse', () => {
  const corpus = {
    cases: [{
      id: 'x', category: 'context_pronouns', case_marker: 'FU100-000', history: [], content: 'FU100-000 follow-up',
      expected_behavior: ['resolve'], forbidden_behavior: ['leak'],
    }, {
      id: 'y', category: 'context_pronouns', case_marker: 'FU100-000',
      history: [{ role: 'system', content: 'FU100-000' }], content: 'FU100-000 follow-up',
      expected_behavior: ['resolve'], forbidden_behavior: ['leak'],
    }],
  };
  const report = validateFollowupCorpus(corpus, { expectedCount: 2 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.issue_counts.empty_history, 1);
  assert.equal(report.issue_counts.duplicate_case_marker, 1);
  assert.equal(report.issue_counts.invalid_history_role, 1);
  assert.equal(report.issue_counts.duplicate_followup_content, 1);
});

test('follow-up preflight rejects mojibake and marker leakage into the prompt', () => {
  const corpus = { cases: [{
    id: 'x', category: 'context_pronouns', case_marker: 'FU100-000',
    history: [{ role: 'user', content: 'FU100-000 context' }],
    content: 'FU100-000 leaked prompt เน€เธ', expected_behavior: ['resolve'], forbidden_behavior: ['leak'],
  }] };
  const report = validateFollowupCorpus(corpus, { expectedCount: 1 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.issue_counts.marker_leaked_into_followup, 1);
  assert.equal(report.issue_counts.mojibake_followup_content, 1);
});
