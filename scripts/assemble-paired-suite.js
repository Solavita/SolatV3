#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateIsolatedChatGptBaselines, validatePairedProviderCaptures } = require('./validate-paired-corpus');

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8').replace(/^\uFEFF/u, ''));
}

function main() {
  const mode = argument('--mode') || 'A';
  const casesPath = argument('--cases');
  const chatgptPath = argument('--chatgpt');
  const solatPath = argument('--solat');
  const outputPath = argument('--output');
  if (!casesPath || !chatgptPath || !solatPath || !outputPath) throw new Error('--cases, --chatgpt, --solat and --output are required.');
  const corpus = readJson(casesPath);
  const chatgpt = readJson(chatgptPath);
  const solat = readJson(solatPath);
  const expectedCount = Array.isArray(corpus.cases) ? corpus.cases.length : 0;
  const chatgptPreflight = validateIsolatedChatGptBaselines(corpus, chatgpt, { expectedCount, mode });
  if (chatgptPreflight.status !== 'PASS') throw new Error(`ChatGPT preflight failed: ${JSON.stringify(chatgptPreflight.issue_counts)}`);
  const chatgptById = new Map(chatgpt.cases.map(row => [row.id, row]));
  const solatById = new Map(solat.rows.map(row => [row.id, row.capture]));
  const rows = corpus.cases.map(testCase => ({
    id: testCase.id,
    prompt: String(testCase.content || ''),
    captures: {
      chatgpt: chatgptById.get(testCase.id),
      solat: solatById.get(testCase.id),
    },
    comparison: { status: 'NOT VERIFIED', manual_review_required: true, reason: 'semantic_quality_requires_evidence_backed_review' },
  }));
  const report = {
    schema_version: 'solat.paired-capture.v2', mode,
    assembled_at: new Date().toISOString(), corpus_path: path.resolve(process.cwd(), casesPath),
    source_reports: { chatgpt: path.resolve(process.cwd(), chatgptPath), solat: path.resolve(process.cwd(), solatPath) },
    rows,
  };
  const preflight = validatePairedProviderCaptures(corpus, report, { mode });
  if (preflight.status !== 'PASS') throw new Error(`Paired preflight failed: ${JSON.stringify(preflight.issue_counts)}`);
  report.preflight = preflight;
  const absolute = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output: absolute, mode, rows: rows.length, status: preflight.status })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`Paired assembly failed: ${String(error?.message || error)}\n`); process.exitCode = 1; }
}

module.exports = { argument };
