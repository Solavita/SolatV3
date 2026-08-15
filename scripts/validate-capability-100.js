const fs = require('node:fs');
const REQUIRED = new Set([
  'file_intake_safety', 'file_duplicate_isolation', 'file_status_provenance',
  'agent_registry_permissions', 'agent_approval', 'agent_failure_control',
  'audit_idempotency', 'prompt_injection_evidence', 'structured_output_validation',
  'context_encoding_preflight',
]);
const MOJIBAKE = /(?:Ã.|Â.|â€|เน€|โ€|เธ[\u0080-\u009f]|�)/u;

function validateCapabilityCorpus(corpus, { expectedCount = 100 } = {}) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const issues = []; const ids = new Set(); const markers = new Set(); const categoryCounts = {};
  if (cases.length !== expectedCount) issues.push({ code: 'case_count_mismatch', expected: expectedCount, actual: cases.length });
  for (const [index, item] of cases.entries()) {
    const id = String(item?.id || '').trim(); const category = String(item?.category || '').trim();
    const content = String(item?.content || ''); const marker = String(item?.fixture?.marker || '').trim();
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    if (!id) issues.push({ code: 'missing_id', index }); else if (ids.has(id)) issues.push({ code: 'duplicate_id', id }); else ids.add(id);
    if (!REQUIRED.has(category)) issues.push({ code: 'unexpected_category', id, category });
    if (!/^CAP100-\d{3}$/.test(marker)) issues.push({ code: 'invalid_marker', id }); else if (markers.has(marker)) issues.push({ code: 'duplicate_marker', id, marker }); else markers.add(marker);
    if (!content.trim()) issues.push({ code: 'missing_content', id });
    if (MOJIBAKE.test(content)) issues.push({ code: 'mojibake_content', id });
    if (!item.fixture?.session_id) issues.push({ code: 'missing_session_id', id });
    if (!Array.isArray(item.expected_behavior) || !item.expected_behavior.length) issues.push({ code: 'missing_expected_behavior', id });
    if (!Array.isArray(item.forbidden_behavior) || !item.forbidden_behavior.length) issues.push({ code: 'missing_forbidden_behavior', id });
  }
  for (const category of REQUIRED) if (categoryCounts[category] !== 10) issues.push({ code: 'category_count_mismatch', category, expected: 10, actual: categoryCounts[category] || 0 });
  const issue_counts = issues.reduce((out, issue) => { out[issue.code] = (out[issue.code] || 0) + 1; return out; }, {});
  return { schema_version: 'solat.capability-corpus-preflight.v1', status: issues.length ? 'FAIL' : 'PASS', case_count: cases.length, unique_case_count: ids.size, unique_marker_count: markers.size, category_counts: categoryCounts, issue_counts, issues, policy: 'Supplemental capability corpus; no provider calls and no baseline mutation.' };
}
if (require.main === module) {
  const flag = process.argv.indexOf('--cases'); const input = (flag >= 0 ? process.argv[flag + 1] : '') || 'D:/SOLAT_V3/evaluations/capability-regression-100.json';
  const corpus = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '')); const report = validateCapabilityCorpus(corpus);
  process.stdout.write(`${JSON.stringify({ ...report, input }, null, 2)}\n`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
module.exports = { validateCapabilityCorpus };
