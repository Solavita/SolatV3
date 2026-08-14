const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVIDENCE_STATES,
  GROUNDED_ANSWER_CONTRACT_VERSION,
  createGroundedAnswerContract,
  groundedAnswerInstruction,
} = require('../src/core/grounded-answer-contract');

test('grounded-answer policy is versioned and separates fact, inference, and unknown', () => {
  const contract = createGroundedAnswerContract({ evidenceState: 'partial' });
  assert.equal(contract.schema_version, GROUNDED_ANSWER_CONTRACT_VERSION);
  assert.equal(contract.evidence_state, 'partial');
  assert.deepEqual(contract.claim_classes, ['fact', 'inference', 'unknown']);
  assert.equal(contract.fact_policy, 'claim_only_what_the_available_evidence_supports');
  assert.equal(contract.inference_policy, 'label_inference_and_state_its_basis');
  assert.equal(contract.unknown_policy, 'state_unknown_or_insufficient_instead_of_guessing');
  assert.match(groundedAnswerInstruction(), /Never present an inference as a fact/u);
  assert.match(groundedAnswerInstruction(), /say what cannot be verified instead of guessing/u);
});

test('grounded-answer policy accepts only declared evidence states', () => {
  for (const evidenceState of EVIDENCE_STATES) {
    assert.equal(createGroundedAnswerContract({ evidenceState }).evidence_state, evidenceState);
  }
  assert.throws(
    () => createGroundedAnswerContract({ evidenceState: 'probably_enough' }),
    error => error.code === 'invalid_grounded_answer_contract',
  );
});
