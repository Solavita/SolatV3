const fs = require('fs');
const path = require('path');

const qualityPath = 'D:/SOLAT_WORKSPACE/tmp-20260814/solat-quality-report-final-20260815.json';
const pairedPath = 'D:/SOLAT_WORKSPACE/tmp-20260814/paired-only-100-complete-20260815.json';
const outputPath = 'D:/SOLAT_V3/reports/human-review-packet-20260815.json';

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
const quality = readJson(qualityPath);
const paired = readJson(pairedPath);
const pairedById = new Map((paired.rows || []).map((row) => [row.id, row]));
const categoryFromId = (id) => {
  const m = id.match(/^paired100_\d+_([^_]+)_/);
  return m ? m[1] : 'unknown';
};

const cases = (quality.results || []).map((result) => {
  const row = pairedById.get(result.id);
  const scores = result.scores || {};
  const evidence = String(result.brief_evidence || '');
  const tags = [];
  if ((scores.language_and_tone ?? 4) <= 1 || /mojibake|garbled|encoding-corrupt/i.test(evidence)) tags.push('encoding_corruption');
  if ((scores.context_and_ambiguity ?? 4) <= 1) tags.push('context_or_reference_loss');
  if ((scores.task_fulfillment ?? 4) <= 1) tags.push('task_fulfillment_gap');
  if ((scores.tool_and_scope_choice ?? 4) <= 1 || /unnecessary search|wrongly searches|invent.*search/i.test(evidence)) tags.push('tool_scope_misuse');
  if ((scores.grounding_and_sources ?? 4) <= 1) tags.push('grounding_or_evidence_gap');
  if ((scores.uncertainty_and_safety ?? 4) <= 1) tags.push('uncertainty_safety_gap');
  const total = Number(result.total_out_of_24 ?? 0);
  return {
    id: result.id,
    category: categoryFromId(result.id),
    prompt: row?.prompt ?? null,
    scores,
    total_out_of_24: total,
    quality_percent: Number((total / 24 * 100).toFixed(2)),
    preliminary_evidence: evidence,
    triage: total < 12 ? 'REVIEW_FIRST' : total < 19 ? 'REVIEW' : 'SPOT_CHECK',
    failure_tags: tags,
    reviewer_decision: 'PENDING',
    reviewer_notes: '',
    reviewed_at: null,
  };
});

const taxonomy = {};
for (const item of cases) {
  for (const tag of item.failure_tags) taxonomy[tag] = (taxonomy[tag] || 0) + 1;
}

const packet = {
  schema_version: 'solat.human-review-packet.v1',
  created_at: new Date().toISOString(),
  source_quality_report: qualityPath,
  source_paired_capture: pairedPath,
  scope: { total_pairs: 100, included_pairs: cases.length, raw_responses_excluded: true },
  purpose: 'Independent human review of preliminary GPT-judge quality findings; not a parity claim.',
  rubric: {
    dimensions: ['task_fulfillment', 'context_and_ambiguity', 'tool_and_scope_choice', 'grounding_and_sources', 'uncertainty_and_safety', 'language_and_tone'],
    scale: '0=failure, 1=major gap, 2=materially weaker, 3=minor gap, 4=at least as good as GPT',
    reviewer_instruction: 'Review the same prompt and both captured responses in the paired capture. Record evidence, then replace reviewer_decision PENDING with PASS/FAIL/UNCERTAIN and add notes. Do not infer missing content.',
  },
  taxonomy_counts: taxonomy,
  cases,
  limitations: [
    'Scores and preliminary_evidence originate from GPT-judge and are not independent human evidence.',
    'The captures contain encoding-corrupted output in several rows; reviewers should score usability as observed and record whether the corruption is reproducible.',
    'No paid provider or live provider call is performed by this packet generator.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(packet, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ outputPath, pairs: cases.length, taxonomy }, null, 2));
