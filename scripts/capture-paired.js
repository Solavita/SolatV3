#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { WebSearchService } = require('../src/core/web-search');
const { captureFromExternal, captureSolat, evaluationCase, indexExternalBaselines, safeHistory } = require('../src/core/three-way-evaluator');

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function readJson(filePath, fallback) {
  return filePath ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8')) : fallback;
}

function selectedCases(corpus, filter) {
  const all = Array.isArray(corpus?.cases) ? corpus.cases : [];
  if (!filter) return all;
  const wanted = new Set(filter.split(',').map(item => item.trim()).filter(Boolean));
  const rows = all.filter(item => wanted.has(item.id));
  if (rows.length !== wanted.size) throw new Error('One or more requested case ids do not exist in the corpus.');
  return rows;
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Refusing to call SOLAT without --execute.');
  const config = readConfig();
  const corpus = readJson(argument('--cases') || 'evaluations/conversation-search-corpus.json');
  const baseline = indexExternalBaselines(readJson(argument('--chatgpt-baselines'), { cases: [] }));
  const searchService = new WebSearchService({ provider: config.searchProvider, baseUrl: config.searchBaseUrl, apiKey: config.searchApiKey, timeoutMs: config.searchTimeoutMs, resultLimit: config.searchResultLimit, wikipediaFallback: config.searchWikipediaFallback, engines: config.searchEngines });
  const core = new ConversationCore({ config, searchService });
  const rows = [];
  for (const testCase of selectedCases(corpus, argument('--case-ids'))) {
    const external = baseline.get(testCase.id);
    const effectiveCase = evaluationCase(testCase, external);
    const captures = {
      chatgpt: captureFromExternal(external),
      solat: await captureSolat(core, effectiveCase),
    };
    rows.push({
      id: testCase.id,
      prompt: String(testCase.content || ''),
      evaluation_history: safeHistory(effectiveCase.history),
      captures,
      comparison: { status: 'NOT VERIFIED', manual_review_required: true, reason: captures.chatgpt.status === 'PASS' && captures.solat.status === 'PASS' ? 'semantic_quality_requires_manual_review' : 'capture_incomplete' },
    });
  }
  const captureCounts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
  for (const row of rows) for (const capture of Object.values(row.captures)) captureCounts[capture.status] += 1;
  const report = {
    schema_version: 'solat.paired-capture.v1',
    kind: 'solat_chatgpt_paired_capture',
    started_at: new Date().toISOString(),
    scope: 'ChatGPT baseline and SOLAT only; no raw DeepSeek capture; semantic score requires evidence-backed review',
    rows,
    capture_counts: captureCounts,
    comparison_counts: { PASS: 0, FAIL: 0, 'NOT VERIFIED': rows.length },
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destination = argument('--output');
  if (destination) {
    const absolute = path.resolve(process.cwd(), destination);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
  process.exitCode = rows.some(row => row.captures.chatgpt.status !== 'PASS' || row.captures.solat.status !== 'PASS') ? 1 : 0;
}

if (require.main === module) main().catch(error => { process.stderr.write(`Paired capture failed: ${String(error?.message || error)}\n`); process.exitCode = 1; });

module.exports = { selectedCases };
