#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateCorpus } = require('../src/core/conversation-evaluator');

const corpusPath = path.resolve(process.cwd(), process.argv[2] || 'evaluations/conversation-search-corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const report = { generated_at: new Date().toISOString(), ...evaluateCorpus(corpus) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.counts.FAIL ? 1 : 0;
