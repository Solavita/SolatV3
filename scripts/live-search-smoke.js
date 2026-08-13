#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { WebSearchService } = require('../src/core/web-search');
const { runLiveSearchSmoke } = require('../src/core/live-search-smoke');

function outputPath(argv) {
  const index = argv.indexOf('--output');
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

async function main() {
  const config = readConfig();
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
  const report = await runLiveSearchSmoke(core);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destination = outputPath(process.argv.slice(2));
  if (destination) {
    const absolute = path.resolve(process.cwd(), destination);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
  process.exitCode = report.outcome === 'FAIL' ? 1 : 0;
}

main().catch(error => {
  process.stderr.write(`Live search smoke harness failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
