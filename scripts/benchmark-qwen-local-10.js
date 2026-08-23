#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const MODEL = 'hf.co/empero-ai/Qwen3.8-2B-GGUF:Q4_K_M';
const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';

function pickTen(corpus) {
  const selected = new Map();
  for (const item of corpus.cases || []) if (!selected.has(item.category)) selected.set(item.category, item);
  return [...selected.values()].slice(0, 10);
}

async function runCase(item) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        model: MODEL, stream: false, think: false,
        messages: [
          { role: 'system', content: 'You are SOLAT local-model test mode. Answer the user request directly and concisely. Never claim a file, tool, message, or external action succeeded unless verified evidence is supplied. State limits truthfully.' },
          { role: 'user', content: item.content },
        ],
        options: { temperature: 0.2, num_predict: 256 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    const content = String(payload.message?.content || '').trim();
    const evalCount = Number(payload.eval_count) || 0;
    const evalSeconds = (Number(payload.eval_duration) || 0) / 1_000_000_000;
    return {
      id: item.id, category: item.category,
      status: content && !/<think>/iu.test(content) ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started, eval_count: evalCount,
      eval_duration_ms: Math.round(evalSeconds * 1000),
      tokens_per_second: evalSeconds > 0 ? Number((evalCount / evalSeconds).toFixed(2)) : 0,
      answer: content,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const corpus = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'evaluations', 'capability-regression-100.json'), 'utf8'));
  const cases = pickTen(corpus);
  if (cases.length !== 10) throw new Error('Expected ten distinct capability categories.');
  const results = [];
  for (const [index, item] of cases.entries()) {
    const result = await runCase(item);
    results.push(result);
    process.stderr.write(`[qwen-local] ${index + 1}/10 ${item.category} ${result.status} ${result.tokens_per_second} tok/s\n`);
  }
  const speeds = results.map(item => item.tokens_per_second).filter(value => value > 0);
  const report = {
    schema_version: 'solat.qwen-local-10-benchmark.v1', model: MODEL, quantization: 'Q4_K_M',
    case_count: results.length, pass: results.filter(item => item.status === 'PASS').length,
    fail: results.filter(item => item.status === 'FAIL').length,
    average_tokens_per_second: Number((speeds.reduce((sum, value) => sum + value, 0) / speeds.length).toFixed(2)),
    min_tokens_per_second: Math.min(...speeds), max_tokens_per_second: Math.max(...speeds),
    results,
    limitation: 'PASS means a non-empty response without exposed <think> text. Semantic correctness still requires human or evidence-backed review.',
  };
  const output = path.resolve(__dirname, '..', 'reports', 'qwen2-local-10-benchmark-20260822.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
  console.log(JSON.stringify({ output, model: report.model, case_count: report.case_count, pass: report.pass, fail: report.fail, average_tokens_per_second: report.average_tokens_per_second, min_tokens_per_second: report.min_tokens_per_second, max_tokens_per_second: report.max_tokens_per_second }, null, 2));
  if (report.fail) process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`Qwen local benchmark failed: ${String(error.message || error)}\n`); process.exitCode = 1; });
