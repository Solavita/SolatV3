#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateCase } = require('../src/core/conversation-evaluator');
const { runLocalFoundationContract } = require('./model-foundation-local-contracts');
const { CASES: LIVE_CASES, consistencyStatus, evaluateData } = require('./evaluate-model-foundation-live');

function argumentValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

const argv = process.argv.slice(2);
const valueFlags = new Set(['--live-report', '--output']);
const positional = argv.find((value, index) => !value.startsWith('--') && !valueFlags.has(argv[index - 1]));
const benchmarkPath = path.resolve(process.cwd(), positional || 'evaluations/model-foundation-benchmark-v1.json');
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

function validatedLiveCases(report) {
  if (report?.schema_version !== 'solat.model-foundation-live-report.v1' || report?.retry_count !== 0 || report?.request_count !== 6) {
    throw new Error('Live report failed schema, retry, or request-cap validation.');
  }
  const expectedIds = new Set(LIVE_CASES.map(item => item.id));
  const cases = new Map();
  for (const item of report.cases || []) {
    const testCase = LIVE_CASES.find(candidate => candidate.id === item.case_id);
    const expectedRuns = testCase?.repeats || 1;
    if (!expectedIds.has(item.case_id) || cases.has(item.case_id) || !Array.isArray(item.runs) || item.runs.length !== expectedRuns) {
      throw new Error('Live report contains an unknown, duplicate, or incomplete case.');
    }
    const runs = item.runs.map(run => ({ ...run, evaluation: evaluateData(testCase, run.data) }));
    const consistency = item.case_id === 'answer_consistency' ? consistencyStatus(runs) : null;
    cases.set(item.case_id, {
      ...item,
      runs,
      status: consistency ? consistency.status : runs[0].evaluation.status,
      ...(consistency ? { consistency } : {}),
    });
  }
  if (cases.size !== expectedIds.size) throw new Error('Live report does not contain all semantic cases.');
  return cases;
}

async function evaluateBenchmarkCase(item, liveCases = null) {
  const evaluation = item.evaluation || {};
  if (evaluation.mode === 'manual_model_trace' && liveCases?.has(item.id)) {
    const liveCase = liveCases.get(item.id);
    return {
      ...item,
      actual_output: liveCase.runs.map(run => ({
        timestamp: run.timestamp,
        latency_ms: run.latency_ms,
        provider: run.provider,
        model: run.model,
        usage: run.usage || null,
        response: run.data,
        evaluation: run.evaluation,
      })),
      status: liveCase.status,
      evidence: [{
        kind: 'live_provider_trace',
        report_schema: 'solat.model-foundation-live-report.v1',
        request_count: liveCase.runs.length,
        retry_count: 0,
      }],
      limitation: `${item.limitation} This result is model-specific and time-bound; it does not establish GPT parity.`,
    };
  }
  if (evaluation.mode === 'unit_test_evidence') {
    try {
      const actualOutput = await runLocalFoundationContract(evaluation.contract_id);
      return {
        ...item,
        actual_output: actualOutput,
        status: 'PASS',
        evidence: [{
          kind: 'local_production_contract',
          contract_id: evaluation.contract_id,
          registry: 'scripts/model-foundation-local-contracts.js',
        }],
      };
    } catch (error) {
      return {
        ...item,
        actual_output: { error: { code: error?.code || 'contract_failed', message: error?.message || 'Local contract failed.' } },
        status: 'FAIL',
        evidence: [{
          kind: 'local_production_contract',
          contract_id: evaluation.contract_id,
          registry: 'scripts/model-foundation-local-contracts.js',
        }],
      };
    }
  }
  if (evaluation.mode !== 'intent_contract') {
    return {
      ...item,
      actual_output: null,
      status: 'NOT VERIFIED',
      evidence: [],
    };
  }
  const result = evaluateCase({
    id: item.id,
    content: item.input,
    history: item.context,
    simulated_search: evaluation.simulated_search,
    expect: evaluation.expect,
  });
  return {
    ...item,
    actual_output: result,
    status: result.status,
    evidence: [{ kind: 'local_deterministic_contract', evaluator: 'src/core/conversation-evaluator.js' }],
  };
}

async function main() {
  const liveReportPath = argumentValue(argv, '--live-report');
  const liveCases = liveReportPath
    ? validatedLiveCases(JSON.parse(fs.readFileSync(path.resolve(liveReportPath), 'utf8')))
    : null;
  const results = await Promise.all(benchmark.cases.map(item => evaluateBenchmarkCase(item, liveCases)));
  const counts = { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0 };
  for (const result of results) counts[result.status] += 1;
  const report = {
    schema_version: 'solat.model-foundation-report.v1',
    benchmark_schema_version: benchmark.schema_version,
    generated_at: new Date().toISOString(),
    scoring_note: liveCases
      ? 'Counts combine local contracts with an explicitly supplied bounded live-provider report. No GPT parity score is computed.'
      : 'Counts describe only executed local contracts. NOT VERIFIED cases are not treated as passes and no GPT parity score is computed.',
    counts,
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = argumentValue(argv, '--output');
  if (outputPath) {
    const absolute = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { argumentValue, evaluateBenchmarkCase, validatedLiveCases };
