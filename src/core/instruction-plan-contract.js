const INSTRUCTION_PLAN_SCHEMA_VERSION = 'solat.instruction-plan.v1';
const MAX_EXPLICIT_STEPS = 12;

function normalizeStep(value) {
  return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, 500);
}

function extractNumberedSteps(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s+([^\n]+)/gu)];
  if (!matches.length) return [];
  const steps = matches.slice(0, MAX_EXPLICIT_STEPS).map(match => ({
    ordinal: Number(match[1]),
    text: normalizeStep(match[2]),
    source: 'explicit_numbered_instruction',
  }));
  if (steps.some((step, index) => step.ordinal !== index + 1 || !step.text)) return [];
  return steps;
}

function buildInstructionPlan(value) {
  const original = String(value || '');
  const steps = extractNumberedSteps(original);
  const lower = original.toLocaleLowerCase();
  const bulletCount = lower.match(/(?:exactly|จำนวน|ทั้งหมด)\s*(\d{1,2})\s*(?:short\s*)?(?:bullet|bullets|ข้อ)/iu);
  const evidenceRequired = /(?:verified evidence|evidence|proof|หลักฐาน|ตรวจสอบผลจริง)/iu.test(original);
  return Object.freeze({
    schema_version: INSTRUCTION_PLAN_SCHEMA_VERSION,
    extraction_mode: steps.length ? 'explicit_numbered_steps' : 'no_explicit_step_plan',
    steps,
    response_constraints: {
      exact_bullet_count: bulletCount ? Math.min(Number(bulletCount[1]), 20) : null,
      concise: /(?:short|brief|concise|สั้น|กระชับ)/iu.test(original),
    },
    evidence_required: evidenceRequired,
    success_claim_policy: evidenceRequired ? 'claim_success_only_with_verified_evidence' : 'do_not_invent_completion',
  });
}

module.exports = {
  INSTRUCTION_PLAN_SCHEMA_VERSION,
  MAX_EXPLICIT_STEPS,
  buildInstructionPlan,
  extractNumberedSteps,
};
