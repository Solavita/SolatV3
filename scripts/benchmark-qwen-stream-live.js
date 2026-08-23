#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const MODEL = 'hf.co/empero-ai/Qwen3.8-2B-GGUF:Q4_K_M';
const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';

function parseArgs(argv) {
  const args = { execute: false, output: path.resolve('reports', 'qwen2-stream-runtime-metrics-final-20260822.json') };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--execute') args.execute = true;
    else if (argv[index] === '--output') args.output = path.resolve(argv[++index]);
  }
  return args;
}

function escapePowerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function startOllamaMemoryMonitor() {
  const marker = path.join(os.tmpdir(), `solat-qwen-memory-${randomUUID()}.marker`);
  fs.writeFileSync(marker, 'running', 'utf8');
  const quotedMarker = escapePowerShellLiteral(marker);
  const script = [
    '$maxWorking=0L; $maxPeak=0L; $samples=0;',
    `$marker='${quotedMarker}';`,
    'while (Test-Path -LiteralPath $marker) {',
    "  $items=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'ollama|llama' });",
    '  $working=0L; $peak=0L;',
    '  foreach ($item in $items) { $working += [int64]$item.WorkingSet64; $peak += [int64]$item.PeakWorkingSet64 };',
    '  if ($working -gt $maxWorking) { $maxWorking=$working };',
    '  if ($peak -gt $maxPeak) { $maxPeak=$peak };',
    '  $samples += 1; Start-Sleep -Milliseconds 100;',
    '};',
    '[pscustomobject]@{peak_working_set_bytes=$maxWorking; peak_process_reported_bytes=$maxPeak; samples=$samples} | ConvertTo-Json -Compress;',
  ].join(' ');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return async () => {
    fs.rmSync(marker, { force: true });
    const code = await new Promise(resolve => child.once('close', resolve));
    if (code !== 0) throw new Error(`Memory monitor failed: ${stderr.trim() || `exit ${code}`}`);
    return JSON.parse(stdout.trim());
  };
}

async function runStreamingRequest() {
  const systemTotal = os.totalmem();
  const systemUsedBaseline = systemTotal - os.freemem();
  let systemUsedPeak = systemUsedBaseline;
  const sampleSystem = setInterval(() => {
    systemUsedPeak = Math.max(systemUsedPeak, systemTotal - os.freemem());
  }, 50);
  const stopMonitor = startOllamaMemoryMonitor();
  const started = performance.now();
  let headersAt = null;
  let firstTokenAt = null;
  let finalPayload = null;
  let answer = '';
  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        think: false,
        keep_alive: '1m',
        messages: [
          { role: 'system', content: 'You are SOLAT local controller benchmark mode. Reply concisely and do not claim external actions.' },
          { role: 'user', content: 'List exactly five short, safe steps for opening a browser and searching for SOLAT. Do not execute them.' },
        ],
        options: { temperature: 0, num_predict: 128 },
      }),
    });
    headersAt = performance.now();
    if (!response.ok || !response.body) throw new Error(`Ollama HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        const content = String(payload.message?.content || '');
        if (content && firstTokenAt === null) firstTokenAt = performance.now();
        answer += content;
        if (payload.done) finalPayload = payload;
      }
    }
    if (buffered.trim()) {
      const payload = JSON.parse(buffered);
      const content = String(payload.message?.content || '');
      if (content && firstTokenAt === null) firstTokenAt = performance.now();
      answer += content;
      if (payload.done) finalPayload = payload;
    }
  } finally {
    clearInterval(sampleSystem);
  }
  const finished = performance.now();
  const processMemory = await stopMonitor();
  const evalCount = Number(finalPayload?.eval_count) || 0;
  const evalDurationNs = Number(finalPayload?.eval_duration) || 0;
  const tokensPerSecond = evalDurationNs > 0 ? evalCount / (evalDurationNs / 1e9) : 0;
  return {
    status: answer.trim() && firstTokenAt !== null && finalPayload?.done ? 'PASS' : 'FAIL',
    model: MODEL,
    backend: 'Ollama native /api/chat streaming',
    prompt_tokens: Number(finalPayload?.prompt_eval_count) || 0,
    completion_tokens: evalCount,
    response_headers_ms: Math.round(headersAt - started),
    ttft_ms: firstTokenAt === null ? null : Math.round(firstTokenAt - started),
    total_ms: Math.round(finished - started),
    tokens_per_second: Number(tokensPerSecond.toFixed(2)),
    peak_ollama_working_set_bytes: processMemory.peak_working_set_bytes,
    peak_ollama_process_reported_bytes: processMemory.peak_process_reported_bytes,
    memory_samples: processMemory.samples,
    system_used_baseline_bytes: systemUsedBaseline,
    system_used_peak_bytes: systemUsedPeak,
    system_used_peak_delta_bytes: Math.max(0, systemUsedPeak - systemUsedBaseline),
    answer: answer.trim(),
    limitation: 'Windows working-set and system-memory samples include Ollama support processes and concurrent machine activity; they are runtime observations, not isolated laboratory measurements.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.execute) throw new Error('Refusing to run a real local model without --execute.');
  const metrics = await runStreamingRequest();
  const report = {
    schema_version: 'solat.qwen-stream-runtime-metrics.v1',
    executed: true,
    captured_at: new Date().toISOString(),
    ...metrics,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  spawnSync('ollama', ['stop', MODEL], { windowsHide: true, stdio: 'ignore' });
  console.log(JSON.stringify({ output: args.output, status: report.status, ttft_ms: report.ttft_ms, tokens_per_second: report.tokens_per_second, total_ms: report.total_ms, peak_ollama_working_set_bytes: report.peak_ollama_working_set_bytes, system_used_peak_delta_bytes: report.system_used_peak_delta_bytes }, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`Qwen streaming benchmark failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
});
