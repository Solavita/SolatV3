const fs = require('node:fs');

const REQUIRED_CATEGORIES = new Set([
  'context_pronouns', 'thai_english_mixed', 'typo_spacing_romanization', 'corrections',
  'multi_step_constraints', 'tool_no_tool', 'grounding_unknown', 'failure_handling',
  'entity_resolution', 'consistency_followup',
]);
const ROLES = new Set(['user', 'assistant']);
const MARKER = /^FU100-\d{3}$/;
const MOJIBAKE = /(?:Ã.|Â.|â€|เน€|โ€|เธ[\u0080-\u009f]|�)/u;

function validateFollowupCorpus(corpus, { expectedCount = 100 } = {}) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const issues = [];
  if (cases.length !== expectedCount) issues.push({ code: 'case_count_mismatch', expected: expectedCount, actual: cases.length });
  const ids = new Set();
  const markers = new Map();
  const contentSeen = new Map();
  const categoryCounts = {};
  for (const [index, item] of cases.entries()) {
    const id = String(item?.id || '').trim();
    const category = String(item?.category || '').trim();
    const marker = String(item?.case_marker || '').trim();
    const history = Array.isArray(item?.history) ? item.history : [];
    const content = String(item?.content || '').trim();
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    if (!id) issues.push({ code: 'missing_case_id', index });
    else if (ids.has(id)) issues.push({ code: 'duplicate_case_id', id });
    else ids.add(id);
    if (!REQUIRED_CATEGORIES.has(category)) issues.push({ code: 'unexpected_category', id, category });
    if (!marker || !MARKER.test(marker)) issues.push({ code: 'invalid_case_marker', id, marker });
    else if (markers.has(marker)) issues.push({ code: 'duplicate_case_marker', id, marker });
    else markers.set(marker, id);
    if (!content) issues.push({ code: 'missing_followup_content', id });
    if (MOJIBAKE.test(content)) issues.push({ code: 'mojibake_followup_content', id });
    else if (contentSeen.has(content)) issues.push({ code: 'duplicate_followup_content', id, other_id: contentSeen.get(content) });
    else contentSeen.set(content, id);
    if (history.length === 0) issues.push({ code: 'empty_history', id });
    for (const [turnIndex, turn] of history.entries()) {
      if (!ROLES.has(turn?.role)) issues.push({ code: 'invalid_history_role', id, turn_index: turnIndex });
      if (!String(turn?.content || '').trim()) issues.push({ code: 'empty_history_content', id, turn_index: turnIndex });
      if (MOJIBAKE.test(String(turn?.content || ''))) issues.push({ code: 'mojibake_history_content', id, turn_index: turnIndex });
    }
    const serialized = JSON.stringify(item);
    if (marker && !history.some((turn) => String(turn?.content || '').includes(marker))) issues.push({ code: 'marker_missing_from_history', id, marker });
    if (marker && content.includes(marker)) issues.push({ code: 'marker_leaked_into_followup', id, marker });
    if (marker && (serialized.match(new RegExp(marker, 'g')) || []).length < 1) issues.push({ code: 'marker_missing_from_case', id, marker });
    if (!Array.isArray(item?.expected_behavior) || item.expected_behavior.length === 0) issues.push({ code: 'missing_expected_behavior', id });
    if (!Array.isArray(item?.forbidden_behavior) || item.forbidden_behavior.length === 0) issues.push({ code: 'missing_forbidden_behavior', id });
  }
  for (const category of REQUIRED_CATEGORIES) {
    if (categoryCounts[category] !== 10) issues.push({ code: 'category_count_mismatch', category, expected: 10, actual: categoryCounts[category] || 0 });
  }
  const issue_counts = issues.reduce((out, issue) => {
    out[issue.code] = (out[issue.code] || 0) + 1;
    return out;
  }, {});
  return {
    schema_version: 'solat.followup-corpus-preflight.v1',
    status: issues.length ? 'FAIL' : 'PASS',
    case_count: cases.length,
    unique_case_count: ids.size,
    unique_marker_count: markers.size,
    category_counts: categoryCounts,
    issue_counts,
    issues,
    policy: 'Supplemental corpus only; original baseline corpus is unchanged. A failed preflight blocks semantic scoring.',
  };
}

if (require.main === module) {
  const caseFlag = process.argv.indexOf('--cases');
  const input = (caseFlag >= 0 ? process.argv[caseFlag + 1] : '') || 'D:/SOLAT_V3/evaluations/followup-context-100.json';
  const corpus = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const report = validateFollowupCorpus(corpus);
  process.stdout.write(`${JSON.stringify({ ...report, input }, null, 2)}\n`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

module.exports = { validateFollowupCorpus };
