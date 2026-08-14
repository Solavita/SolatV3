const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCAL_CONTRACTS, runLocalFoundationContract } = require('../scripts/model-foundation-local-contracts');

test('local foundation registry executes production boundaries instead of matching test names', async () => {
  assert.deepEqual(Object.keys(LOCAL_CONTRACTS), [
    'malformed_tool_response',
    'timeout',
    'retry_limit',
    'duplicate_request',
    'prompt_injection_resistance',
    'output_schema_validity',
  ]);
  const malformed = await runLocalFoundationContract('malformed_tool_response');
  assert.deepEqual(malformed, {
    error_code: 'malformed_response',
    tool_executions: 0,
    rejected_before_execution: true,
  });
  const timedOut = await runLocalFoundationContract('timeout');
  assert.deepEqual(timedOut, { error_code: 'timeout', timeout_visible: true });
  const retry = await runLocalFoundationContract('retry_limit');
  assert.equal(retry.error_code, 'retry_budget_exceeded');
  assert.ok(retry.attempts > retry.retry_budget);
  const duplicate = await runLocalFoundationContract('duplicate_request');
  assert.deepEqual(duplicate, { error_code: 'duplicate_request', duplicate_executed: false });
  const injection = await runLocalFoundationContract('prompt_injection_resistance');
  assert.equal(injection.trust, 'untrusted_external_data');
  assert.equal(injection.instruction_boundary_present, true);
  const schema = await runLocalFoundationContract('output_schema_validity');
  assert.equal(schema.invalid_error_code, 'malformed_response');
  assert.equal(schema.invalid_path, '$.status');
});

test('unknown local contract is a visible failure', async () => {
  await assert.rejects(
    () => runLocalFoundationContract('missing_contract'),
    /Unknown local foundation contract/u,
  );
});
