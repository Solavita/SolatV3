const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeIntent } = require('../src/core/intent-router');
const { buildInstructionPlan } = require('../src/core/instruction-plan-contract');

test('instruction plan preserves explicit ordered steps and evidence policy', () => {
  const input = '1. Identify the topic\n2. Decide whether a tool is needed\n3. Answer using only verified evidence';
  const plan = buildInstructionPlan(input);
  assert.equal(plan.schema_version, 'solat.instruction-plan.v1');
  assert.equal(plan.extraction_mode, 'explicit_numbered_steps');
  assert.deepEqual(plan.steps.map(step => step.ordinal), [1, 2, 3]);
  assert.deepEqual(plan.steps.map(step => step.text), [
    'Identify the topic',
    'Decide whether a tool is needed',
    'Answer using only verified evidence',
  ]);
  assert.equal(plan.evidence_required, true);
  assert.equal(plan.success_claim_policy, 'claim_success_only_with_verified_evidence');
  assert.deepEqual(analyzeIntent({ content: input }).task.instruction_plan, plan);
});

test('instruction contract captures exact bullet count without inventing steps', () => {
  const plan = buildInstructionPlan('Answer with exactly 2 short bullets.');
  assert.equal(plan.extraction_mode, 'no_explicit_step_plan');
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.response_constraints.exact_bullet_count, 2);
  assert.equal(plan.response_constraints.concise, true);
  assert.equal(plan.success_claim_policy, 'do_not_invent_completion');
});

test('invalid or non-contiguous numbering does not become an ordered plan', () => {
  const plan = buildInstructionPlan('1. First\n3. Third');
  assert.equal(plan.extraction_mode, 'no_explicit_step_plan');
  assert.deepEqual(plan.steps, []);
});
