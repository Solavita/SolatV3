const GROUNDED_ANSWER_CONTRACT_VERSION = 'solat.grounded-answer-policy.v1';

const EVIDENCE_STATES = Object.freeze([
  'runtime_determined',
  'not_requested',
  'available',
  'partial',
  'insufficient',
  'unavailable',
]);

function createGroundedAnswerContract({ evidenceState = 'runtime_determined' } = {}) {
  if (!EVIDENCE_STATES.includes(evidenceState)) {
    const error = new Error(`Unsupported evidence state: ${evidenceState}`);
    error.code = 'invalid_grounded_answer_contract';
    throw error;
  }
  return Object.freeze({
    schema_version: GROUNDED_ANSWER_CONTRACT_VERSION,
    evidence_state: evidenceState,
    claim_classes: Object.freeze(['fact', 'inference', 'unknown']),
    fact_policy: 'claim_only_what_the_available_evidence_supports',
    inference_policy: 'label_inference_and_state_its_basis',
    unknown_policy: 'state_unknown_or_insufficient_instead_of_guessing',
    source_policy: 'never_invent_or_imply_unreturned_sources',
  });
}

function groundedAnswerInstruction() {
  return 'Separate supported facts from inference and from what is unknown. Never present an inference as a fact. State the basis for an inference. When evidence is missing, unavailable, conflicting, or insufficient, say what cannot be verified instead of guessing. Never invent or imply a source that was not returned.';
}

module.exports = {
  EVIDENCE_STATES,
  GROUNDED_ANSWER_CONTRACT_VERSION,
  createGroundedAnswerContract,
  groundedAnswerInstruction,
};
