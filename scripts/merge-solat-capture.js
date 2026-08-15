#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function read(file) { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')); }

const basePath = arg('--base');
const patchPath = arg('--patch');
const corpusPath = arg('--cases');
const outputPath = arg('--output');
if (!basePath || !patchPath || !corpusPath || !outputPath) throw new Error('--base, --patch, --cases and --output are required.');

const base = read(basePath);
const patch = read(patchPath);
const corpus = read(corpusPath);
const patchRows = new Map((patch.rows || []).map(row => [row.id, row]));
const corpusRows = new Map((corpus.cases || []).map(row => [row.id, row]));
const replaced = [];
const rows = (base.rows || []).map(row => {
  const replacement = patchRows.get(row.id);
  if (!replacement) return row;
  const expected = corpusRows.get(row.id);
  const actualHistory = replacement.capture?.history || [];
  if (!expected || JSON.stringify(actualHistory) !== JSON.stringify(expected.history || [])) {
    throw new Error(`Exact history mismatch for ${row.id}; refusing to merge.`);
  }
  replaced.push(row.id);
  return replacement;
});
if (rows.length !== 100 || replaced.length !== patchRows.size) throw new Error(`Expected 100 rows and exact replacement count; rows=${rows.length}, replaced=${replaced.length}, patch=${patchRows.size}.`);
const ids = new Set(rows.map(row => row.id));
if (ids.size !== rows.length || [...corpusRows.keys()].some(id => !ids.has(id))) throw new Error('Merged capture does not cover the unchanged corpus exactly.');
const output = { ...base, schema_version: 'solat.provider-suite-capture.v1', kind: 'merged_from_exact_recaptures', merged_at: new Date().toISOString(), replaced_case_ids: replaced, case_count: rows.length, rows };
fs.writeFileSync(path.resolve(process.cwd(), outputPath), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ output: path.resolve(process.cwd(), outputPath), case_count: rows.length, replaced_case_ids: replaced }));
