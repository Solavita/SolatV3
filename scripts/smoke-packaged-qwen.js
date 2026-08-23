#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed.')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP request failed.'));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

function invoke(fn, ...args) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.');
  return result.result?.value;
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = await response.json();
      const page = targets.find(item => item.type === 'page' && /renderer[\\/]index\.html|SOLAT/iu.test(`${item.url} ${item.title}`));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Packaged SOLAT did not expose its renderer through CDP.');
}

async function stopChild(child) {
  if (!child) return;
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.exitCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill();
  await Promise.race([closed, sleep(3_000)]);
}

async function main() {
  const executableArgument = argument('--executable');
  const development = process.argv.includes('--development');
  if (!development && !executableArgument) throw new Error('Provide --executable for a packaged smoke test or use --development.');
  const executable = development ? require('electron') : path.resolve(ROOT, executableArgument);
  const output = path.resolve(ROOT, argument('--output', `reports/packaged-qwen-smoke-${Date.now()}.json`));
  const timeoutMs = Math.max(20_000, Number(argument('--timeout-ms', '90000')) || 90_000);
  const prompt = argument('--prompt', 'ทักทายฉันเป็นภาษาไทยหนึ่งประโยค');
  if (!fs.existsSync(executable)) throw new Error(`SOLAT executable not found: ${executable}`);
  const port = 9800 + Math.floor(Math.random() * 150);
  const profile = path.join(ROOT, 'reports', `.packaged-qwen-profile-${crypto.randomUUID()}`);
  const logs = [];
  let child = null;
  let client = null;
  const startedAt = Date.now();
  try {
    const launchArguments = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
    if (development) launchArguments.push('.');
    child = spawn(executable, launchArguments, {
      cwd: development ? ROOT : path.dirname(executable),
      env: { ...process.env, SOLAT_DEVTOOLS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = chunk => logs.push(...String(chunk).split(/\r?\n/u).filter(Boolean).slice(-80));
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const page = await waitForPage(port);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    const readyDeadline = Date.now() + 15_000;
    while (Date.now() < readyDeadline) {
      const ready = await evaluate(client, invoke(() => Boolean(window.solat?.setModelMode && document.querySelector('#composer'))));
      if (ready) break;
      await sleep(200);
    }
    await evaluate(client, invoke(() => document.querySelector('#newChatBtn')?.click()));
    await sleep(2_500);
    await evaluate(client, invoke(async () => window.solat.setModelMode('local')));
    await sleep(250);
    const submittedAt = Date.now();
    const submitted = await evaluate(client, invoke(value => {
      const input = document.querySelector('#input');
      const form = document.querySelector('#composer');
      if (!input || !form) return false;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      return true;
    }, prompt));
    if (!submitted) throw new Error('Packaged composer was unavailable.');
    const deadline = Date.now() + timeoutMs;
    let snapshot = null;
    while (Date.now() < deadline) {
      snapshot = await evaluate(client, invoke(async () => ({
        articles: [...document.querySelectorAll('#log article')].map(item => item.innerText.trim()),
        assistantArticles: [...document.querySelectorAll('#log article.msg.assistant')].map(item => item.innerText.trim()),
        thinking: document.querySelectorAll('[data-thinking="true"]').length,
        model: document.querySelector('#modelName')?.innerText?.trim() || '',
        runtime: await window.solat.status(),
        status: document.querySelector('#status')?.getAttribute('aria-description') || document.querySelector('#status')?.getAttribute('title') || '',
        deliveryFailure: document.querySelector('[data-delivery-failed="true"]')?.innerText?.trim() || '',
      })));
      if (snapshot.deliveryFailure || (snapshot.thinking === 0 && snapshot.assistantArticles.length >= 1)) break;
      await sleep(300);
    }
    const passed = Boolean(snapshot?.thinking === 0
      && snapshot?.runtime?.modelMode === 'local'
      && snapshot?.assistantArticles.length >= 1
      && !snapshot?.deliveryFailure);
    const report = {
      schema_version: 'solat.packaged-qwen-smoke.v1',
      status: passed ? 'PASS' : 'FAIL',
      target: development ? 'development' : 'packaged',
      executable,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      submitted_to_terminal_ms: Date.now() - submittedAt,
      model_label: snapshot?.model || null,
      runtime_model_mode: snapshot?.runtime?.modelMode || null,
      runtime_provider: snapshot?.runtime?.provider || null,
      runtime_model: snapshot?.runtime?.model || null,
      prompt,
      response: snapshot?.assistantArticles.at(-1) || null,
      delivery_failure: snapshot?.deliveryFailure || null,
      process_logs: logs.slice(-80),
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ output, status: report.status, submitted_to_terminal_ms: report.submitted_to_terminal_ms, model: report.model_label })}\n`);
    if (!passed) process.exitCode = 1;
  } finally {
    client?.close();
    await stopChild(child);
    await Promise.race([fs.promises.rm(profile, { recursive: true, force: true }).catch(() => {}), sleep(3_000)]);
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'packaged_qwen_smoke_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
