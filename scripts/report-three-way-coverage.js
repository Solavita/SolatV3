#!/usr/bin/env node
// Read-only coverage report for Milestone 17.  It never calls a provider.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { captureFromExternal, indexExternalBaselines } = require('../src/core/three-way-evaluator');

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function captureFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^three-way-.*\.json$/u.test(entry.name))
    .flatMap(entry => {
      try {
        const absolute = path.join(directory, entry.name);
        const value = readJson(absolute);
        return value?.kind === 'solat_three_way_live_capture' ? [{ file: entry.name, value }] : [];
      } catch { return []; }
    });
}

function latestCaptureFor(id, reports) {
  const matches = reports.flatMap(report => (Array.isArray(report.value.rows) ? report.value.rows : [])
    .filter(row => row?.id === id)
    .map(row => ({
      file: report.file,
      started_at: String(report.value.started_at || ''),
      implementation: report.value.implementation || null,
      row,
    })));
  return matches.sort((left, right) => right.started_at.localeCompare(left.started_at))[0] || null;
}

function observedLatencyMs(capture) {
  const started = Date.parse(String(capture?.started_at || ''));
  const finished = Date.parse(String(capture?.finished_at || ''));
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null;
}

function currentRevision(root) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

function runtimeTreeMatches(root, captureRevision, currentRevisionValue) {
  if (!captureRevision || !currentRevisionValue || captureRevision === currentRevisionValue) return captureRevision === currentRevisionValue;
  try {
    execFileSync('git', ['diff', '--quiet', captureRevision, currentRevisionValue, '--', 'src', 'renderer', 'package.json', 'scripts'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function main() {
  const root = process.cwd();
  const corpus = readJson(path.resolve(root, argument('--cases') || 'evaluations/conversation-search-corpus.json'));
  const baselineFile = path.resolve(root, argument('--chatgpt-baselines') || 'artifacts/three-way-capture/chatgpt-baselines-captured-20260811.json');
  const artifactsDirectory = path.resolve(root, argument('--artifacts') || 'artifacts/three-way-capture');
  const revision = currentRevision(root);
  const baselines = indexExternalBaselines(readJson(baselineFile));
  const reports = captureFiles(artifactsDirectory);
  const rows = (Array.isArray(corpus.cases) ? corpus.cases : []).map(testCase => {
    const id = String(testCase?.id || '');
    const baseline = captureFromExternal(baselines.get(id));
    const capture = latestCaptureFor(id, reports);
    const captures = capture?.row?.captures || {};
    const complete = ['chatgpt', 'deepseek', 'solat'].every(name => captures[name]?.status === 'PASS');
    const captureRevision = String(capture?.implementation?.git_revision || '').trim() || null;
    const revisionMatch = runtimeTreeMatches(root, captureRevision, revision) ? 'PASS' : 'NOT VERIFIED';
    return {
      id,
      isolated_chatgpt_baseline: baseline.status,
      baseline_reason: baseline.reason || null,
      latest_capture_file: capture?.file || null,
      latest_capture_started_at: capture?.started_at || null,
      latest_capture_complete: complete ? 'PASS' : capture ? 'NOT VERIFIED' : 'NOT VERIFIED',
      evidence_for_current_revision: complete && revisionMatch === 'PASS' ? 'PASS' : 'NOT VERIFIED',
      revision_match: revisionMatch,
      freshness_reason: !capture ? 'capture_missing' : !complete ? 'capture_incomplete' : revisionMatch === 'PASS' && captureRevision !== revision ? 'docs_or_metadata_only_revision_drift' : revisionMatch === 'PASS' ? null : 'capture_revision_stale',
      capture_revision: captureRevision,
      comparison_status: capture?.row?.comparison?.status || 'NOT VERIFIED',
      latency_ms: {
        chatgpt: Number.isFinite(captures.chatgpt?.latency_ms) ? captures.chatgpt.latency_ms : null,
        deepseek: observedLatencyMs(captures.deepseek),
        solat: observedLatencyMs(captures.solat),
      },
    };
  });
  const counts = rows.reduce((result, row) => {
    result.total += 1;
    if (row.isolated_chatgpt_baseline === 'PASS') result.isolated_baselines += 1;
    if (row.latest_capture_complete === 'PASS') result.complete_captures += 1;
    if (row.evidence_for_current_revision === 'PASS') result.current_revision_captures += 1;
    if (row.comparison_status === 'NOT VERIFIED') result.manual_review_required += 1;
    if (row.latest_capture_complete === 'PASS' && row.revision_match !== 'PASS') result.stale_complete_captures += 1;
    return result;
  }, { total: 0, isolated_baselines: 0, complete_captures: 0, stale_complete_captures: 0, current_revision_captures: 0, manual_review_required: 0 });
  process.stdout.write(`${JSON.stringify({ schema_version: '1.0', kind: 'solat_three_way_coverage', generated_at: new Date().toISOString(), current_revision: revision, counts, rows }, null, 2)}\n`);
}

main();
