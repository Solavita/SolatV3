const fs = require('node:fs');
const crypto = require('node:crypto');
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function validateEvaluationManifest(manifest, { expectedTotal = 300 } = {}) {
  const issues = []; const refs = Array.isArray(manifest?.case_refs) ? manifest.case_refs : [];
  if (manifest?.total_cases !== expectedTotal) issues.push({ code: 'manifest_total_mismatch', expected: expectedTotal, actual: manifest?.total_cases });
  if (refs.length !== expectedTotal) issues.push({ code: 'ref_count_mismatch', expected: expectedTotal, actual: refs.length });
  const ids = new Set(); const sourceCounts = {}; const modeBySource = { A: 'A', B: 'B', C: 'C' };
  for (const ref of refs) {
    const id = String(ref?.id || ''); const source = String(ref?.source || ''); const mode = String(ref?.mode || '');
    if (!id) issues.push({ code: 'missing_ref_id' }); else if (ids.has(id)) issues.push({ code: 'duplicate_ref_id', id }); else ids.add(id);
    if (!modeBySource[source] || modeBySource[source] !== mode) issues.push({ code: 'source_mode_mismatch', id, source, mode });
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  for (const source of ['A', 'B', 'C']) if (sourceCounts[source] !== 100) issues.push({ code: 'source_count_mismatch', source, expected: 100, actual: sourceCounts[source] || 0 });
  if (manifest?.retry_policy?.allow_answer_cherry_picking !== false) issues.push({ code: 'cherry_picking_not_disabled' });
  if (manifest?.retry_policy?.max_attempts_per_case !== 1) issues.push({ code: 'retry_limit_not_one' });
  const sourceSuites = Array.isArray(manifest?.source_suites) ? manifest.source_suites : [];
  for (const suite of sourceSuites) {
    if (!fs.existsSync(suite.corpus_path)) { issues.push({ code: 'source_missing', source: suite.source }); continue; }
    const actualHash = hashFile(suite.corpus_path); if (actualHash !== suite.sha256) issues.push({ code: 'source_hash_mismatch', source: suite.source });
    const corpus = JSON.parse(fs.readFileSync(suite.corpus_path, 'utf8').replace(/^\uFEFF/, ''));
    const cases = Array.isArray(corpus.cases) ? corpus.cases : [];
    const refsForSource = refs.filter(ref => ref.source === suite.source).sort((a, b) => a.index - b.index);
    if (refsForSource.length !== cases.length) issues.push({ code: 'source_ref_length_mismatch', source: suite.source });
    for (const [index, testCase] of cases.entries()) {
      const ref = refsForSource[index];
      if (!ref || ref.id !== String(testCase.id) || ref.index !== index) issues.push({ code: 'source_case_ref_mismatch', source: suite.source, index, id: testCase.id });
    }
  }
  const issue_counts = issues.reduce((out, issue) => { out[issue.code] = (out[issue.code] || 0) + 1; return out; }, {});
  return { schema_version: 'solat.evaluation-manifest-preflight.v1', status: issues.length ? 'FAIL' : 'PASS', total_refs: refs.length, unique_ids: ids.size, source_counts: sourceCounts, issue_counts, issues };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const manifestFlag = args.indexOf('--manifest');
  const input = manifestFlag >= 0
    ? args[manifestFlag + 1]
    : (args.find((arg) => !arg.startsWith('--')) || 'D:/SOLAT_V3/evaluations/evaluation-manifest-300.json');
  if (!input || (manifestFlag >= 0 && !args[manifestFlag + 1])) {
    throw new Error('Missing value for --manifest');
  }
  const manifest = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '')); const report = validateEvaluationManifest(manifest);
  process.stdout.write(`${JSON.stringify({ ...report, input }, null, 2)}\n`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
module.exports = { validateEvaluationManifest };
