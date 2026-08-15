#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { captureSolat } = require('../src/core/three-way-evaluator');
const { WebSearchService } = require('../src/core/web-search');

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function readCorpus(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8').replace(/^\uFEFF/u, ''));
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Refusing to call SOLAT without --execute.');
  const mode = argument('--mode') || 'A';
  if (!['A', 'B', 'C'].includes(mode)) throw new Error('Mode must be A, B, or C.');
  const input = argument('--cases');
  const destination = argument('--output');
  const requestedConcurrency = Number(argument('--concurrency') || 1);
  const concurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0
    ? Math.min(requestedConcurrency, 8)
    : 1;
  const requestedIds = new Set((argument('--case-ids') || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!input || !destination) throw new Error('--cases and --output are required.');
  const corpus = readCorpus(input);
  const allCases = Array.isArray(corpus.cases) ? corpus.cases : [];
  const cases = requestedIds.size ? allCases.filter(testCase => requestedIds.has(String(testCase.id))) : allCases;
  if (requestedIds.size && cases.length !== requestedIds.size) throw new Error('One or more --case-ids were not found in the corpus.');
  const config = readConfig();
  if (!config.apiKey) throw new Error('Model provider is not configured.');
  const searchService = new WebSearchService({
    provider: config.searchProvider,
    baseUrl: config.searchBaseUrl,
    apiKey: config.searchApiKey,
    timeoutMs: config.searchTimeoutMs,
    resultLimit: config.searchResultLimit,
    wikipediaFallback: config.searchWikipediaFallback,
    engines: config.searchEngines,
  });
  const core = new ConversationCore({ config, searchService });
  const startedAt = new Date().toISOString();
  const rows = new Array(cases.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= cases.length) return;
      const testCase = cases[index];
      const effectiveCase = mode === 'C' ? { ...testCase, history: [] } : testCase;
      let capture;
      try {
        capture = await captureSolat(core, effectiveCase, undefined, { replayUserSeeds: mode === 'B' });
      } catch (error) {
        capture = { status: 'FAIL', error: { code: error?.code || 'capture_failed', message: String(error?.message || error) } };
      }
      rows[index] = { id: testCase.id, prompt: String(testCase.content || ''), index, capture };
      process.stderr.write(`[${mode}] ${index + 1}/${cases.length} ${testCase.id} ${capture.status}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length || 1) }, () => worker()));
  const counts = rows.reduce((out, row) => {
    out[row.capture.status] = (out[row.capture.status] || 0) + 1;
    return out;
  }, { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 });
  const report = {
    schema_version: 'solat.provider-suite-capture.v1', provider: config.provider, model: config.model,
    mode, concurrency, corpus_path: path.resolve(process.cwd(), input), started_at: startedAt,
    finished_at: new Date().toISOString(), run_id: crypto.randomUUID(), case_count: rows.length, counts, rows,
  };
  const absolute = path.resolve(process.cwd(), destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output: absolute, mode, case_count: rows.length, counts })}\n`);
  process.exitCode = counts.FAIL || counts['NOT VERIFIED'] ? 1 : 0;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`SOLAT suite capture failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});

module.exports = { argument, readCorpus };
