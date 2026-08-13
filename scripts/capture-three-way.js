#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readConfig } = require('../src/core/config');
const { createProvider } = require('../src/core/provider');
const { ConversationCore } = require('../src/core/conversation-core');
const { WebSearchService } = require('../src/core/web-search');
const { runThreeWayCapture } = require('../src/core/three-way-evaluator');

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'));
}

function selectedCases(corpus, filter) {
  const all = Array.isArray(corpus?.cases) ? corpus.cases : [];
  if (!filter) return all;
  const wanted = new Set(filter.split(',').map(item => item.trim()).filter(Boolean));
  const rows = all.filter(item => wanted.has(item.id));
  if (rows.length !== wanted.size) throw new Error('One or more requested case ids do not exist in the corpus.');
  return rows;
}

function baselinesFromCapture(capture) {
  const rows = Array.isArray(capture?.rows) ? capture.rows : [];
  return {
    cases: rows.flatMap(row => {
      const item = row?.captures?.chatgpt;
      if (!row?.id || item?.status !== 'PASS' || !item?.response) return [];
      return [{
        id: String(row.id),
        model: item.model,
        captured_at: item.captured_at,
        context_mode: item.context_mode,
        response: item.response,
        sources: Array.isArray(item.sources) ? item.sources : [],
      }];
    }),
  };
}

function currentRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

async function main() {
  if (!process.argv.includes('--execute')) {
    throw new Error('Refusing to call a paid model without --execute. This capture sends one raw DeepSeek and one SOLAT request per selected case.');
  }
  const config = readConfig();
  const corpus = readJson(argument('--cases') || 'evaluations/conversation-search-corpus.json');
  const captureBaselinePath = argument('--chatgpt-capture');
  const chatgptBaselines = captureBaselinePath
    ? baselinesFromCapture(readJson(captureBaselinePath, { rows: [] }))
    : readJson(argument('--chatgpt-baselines'), { cases: [] });
  const searchService = new WebSearchService({ provider: config.searchProvider, baseUrl: config.searchBaseUrl, apiKey: config.searchApiKey, timeoutMs: config.searchTimeoutMs, resultLimit: config.searchResultLimit, wikipediaFallback: config.searchWikipediaFallback, engines: config.searchEngines });
  const report = await runThreeWayCapture({ cases: selectedCases(corpus, argument('--case-ids')), chatgptBaselines, deepseekProvider: createProvider(config), solatCore: new ConversationCore({ config, searchService }) });
  report.implementation = {
    git_revision: currentRevision(),
    search: searchService.status(),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destination = argument('--output');
  if (destination) {
    const absolute = path.resolve(process.cwd(), destination);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
  process.exitCode = report.capture_counts.FAIL > 0 ? 1 : 0;
}

main().catch(error => { process.stderr.write(`Three-way capture failed: ${String(error?.message || error)}\n`); process.exitCode = 1; });
