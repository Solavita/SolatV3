#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { createProvider } = require('../src/core/provider');
const { ModelRouter } = require('../src/core/model-router');
const { WebSearchService } = require('../src/core/web-search');
const { captureFromExternal, captureSolat, evaluationCase, indexExternalBaselines } = require('../src/core/three-way-evaluator');
const { validateIsolatedChatGptBaselines, validatePairedCorpus } = require('./validate-paired-corpus');

function boundedHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-8).flatMap(message => {
    // Preserve exact seed text for paired-history parity. Trimming here makes
    // a capture look valid while changing the actual conversation context.
    const content = String(message?.content ?? '').replace(/\u0000/gu, '').slice(0, 12000);
    return content.length ? [{ role: message?.role === 'assistant' ? 'assistant' : 'user', content }] : [];
  });
}

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
  const baselineDocument = readJson(argument('--chatgpt-baselines'), { cases: [] });
  const mode = argument('--mode') || 'A';
  if (!['A', 'B', 'C'].includes(mode)) throw new Error('Mode must be A, B, or C.');
  const limitations = readJson(argument('--limitations'), null);
  const expectedCount = Array.isArray(corpus?.cases) ? corpus.cases.length : 0;
  const corpusPreflight = validatePairedCorpus(corpus, { expectedCount, limitations });
  const baselinePreflight = validateIsolatedChatGptBaselines(corpus, baselineDocument, { expectedCount, mode });
  if (!['PASS', 'PASS_WITH_DECLARED_LIMITATIONS'].includes(corpusPreflight.status)) throw new Error(`Corpus preflight failed: ${JSON.stringify(corpusPreflight.issue_counts)}`);
  if (baselinePreflight.status !== 'PASS') throw new Error(`ChatGPT zero-history preflight failed: ${JSON.stringify(baselinePreflight.issue_counts)}`);
  const baseline = indexExternalBaselines(baselineDocument);
  const searchService = new WebSearchService({ provider: config.searchProvider, baseUrl: config.searchBaseUrl, apiKey: config.searchApiKey, timeoutMs: config.searchTimeoutMs, resultLimit: config.searchResultLimit, wikipediaFallback: config.searchWikipediaFallback, engines: config.searchEngines });
  const provider = new ModelRouter({
    flashProvider: createProvider(config.flashModel), plusProvider: createProvider(config.plusModel), mode: config.modelMode,
  });
  const core = new ConversationCore({ config, provider, searchService });
  const rows = [];
  for (const testCase of selectedCases(corpus, argument('--case-ids'))) {
    const external = baseline.get(testCase.id);
    const effectiveCase = mode === 'C' ? { ...testCase, history: [] } : evaluationCase(testCase, external);
    const captures = {
      chatgpt: {
        ...captureFromExternal(external),
        isolation_id: String(external?.isolation_id || ''),
        history: boundedHistory(external?.seed_inputs || external?.history),
        history_count: boundedHistory(external?.seed_inputs || external?.history).length,
        seed_inputs: boundedHistory(external?.seed_inputs || external?.history),
        seed_transcript: boundedHistory(external?.transcript),
      },
      solat: await captureSolat(core, effectiveCase, undefined, { replayUserSeeds: mode === 'B' }),
    };
    rows.push({
      id: testCase.id,
      prompt: String(testCase.content || ''),
      evaluation_history: boundedHistory(effectiveCase.history),
      captures,
      comparison: { status: 'NOT VERIFIED', manual_review_required: true, reason: captures.chatgpt.status === 'PASS' && captures.solat.status === 'PASS' ? 'semantic_quality_requires_manual_review' : 'capture_incomplete' },
    });
  }
  const captureCounts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
  for (const row of rows) for (const capture of Object.values(row.captures)) captureCounts[capture.status] += 1;
  const report = {
    schema_version: 'solat.paired-capture.v1',
    kind: 'solat_chatgpt_paired_capture',
    evaluation_mode: mode,
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
