const assert = require('node:assert/strict');
const { test } = require('node:test');
const corpus = require('../evaluations/capability-regression-100.json');
const { runCapabilityCorpus } = require('../scripts/run-capability-100-local');

test('capability corpus runs production-boundary checks without hiding unsupported agent execution', async () => {
  const report = await runCapabilityCorpus({ corpus });
  assert.equal(report.case_count, 100);
  assert.equal(report.fail, 0);
  assert.equal(report.pass, 80);
  assert.equal(report.not_verified, 20);
  assert.deepEqual([...new Set(report.results.filter(item => item.status === 'NOT_VERIFIED').map(item => item.category))].sort(), ['agent_approval', 'agent_failure_control']);
});
