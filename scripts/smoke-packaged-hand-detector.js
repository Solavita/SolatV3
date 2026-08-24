#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? String(process.argv[index + 1] || '').trim() : ''; };
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const cleanEnvironment = source => Object.fromEntries(Object.entries(source).filter(([key]) => !/(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)/iu.test(key)));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

class CdpClient {
  constructor(url) { this.url = url; this.socket = null; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out.')), 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed.')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); return message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }
  on(method, listener) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(listener); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.socket?.close(); } catch {} }
}

async function waitForPage(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      const page = targets.find(item => item.type === 'page' && /renderer[\\/]index\.html|SOLAT/iu.test(`${item.url} ${item.title}`));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await wait(250);
  }
  throw new Error('Packaged renderer was not available on the localhost test port.');
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.');
  return result.result?.value;
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: use --execute.');
  const executable = path.resolve(argument('--exe')); const output = path.resolve(argument('--output'));
  if (!argument('--exe') || !argument('--output') || path.basename(executable).toLowerCase() !== 'solat.exe') throw new Error('A packaged SOLAT.exe and output are required.');
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing report.');
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'solat-hand-detector-')); const port = await freePort();
  let child; let client; let runtime = null; let phase = 'baseline'; let baselineRequests = 0; let detectorRequests = 0;
  const baselineOrigins = new Set(); const detectorOrigins = new Set(); let processStopped = false; let profileRemoved = false;
  try {
    child = spawn(executable, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
      cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore', env: { ...cleanEnvironment(process.env), SOLAT_DEVTOOLS: '0', SOLAT_VOICE_ENABLED: 'false' },
    });
    const page = await waitForPage(port); client = new CdpClient(page.webSocketDebuggerUrl); await client.connect();
    client.on('Network.requestWillBeSent', ({ request }) => {
      if (!/^https?:/iu.test(String(request?.url || ''))) return;
      const origins = phase === 'detector' ? detectorOrigins : baselineOrigins;
      if (phase === 'detector') detectorRequests += 1; else baselineRequests += 1;
      try { origins.add(new URL(request.url).origin); } catch { origins.add('invalid-url'); }
    });
    await client.send('Network.enable'); await client.send('Runtime.enable');
    // Separate ordinary UI startup traffic (for example the existing Google
    // Fonts stylesheet) from requests initiated while the detector loads.
    await wait(1500); phase = 'detector';
    runtime = await evaluate(client, `(async () => {
      let cameraRequests = 0;
      const module = await import('./hand-tracking-runtime.mjs');
      const instance = new module.HandTrackingRuntime({
        bridge: {}, mediaDevices: { getUserMedia: async () => { cameraRequests += 1; throw new Error('camera must not be requested'); } },
        raf: () => 0, cancelRaf: () => {}, documentRef: document,
      });
      const detector = await instance.detectorFactory();
      const initialized = Boolean(detector && typeof detector.detectForVideo === 'function');
      detector?.close?.();
      return { initialized, camera_requests: cameraRequests };
    })()`);
    await wait(500);
  } finally {
    client?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch {} await wait(1800); }
    processStopped = !child || child.exitCode !== null || child.signalCode !== null;
    const resolved = path.resolve(profile); const prefix = `${path.resolve(os.tmpdir())}${path.sep}solat-hand-detector-`;
    if (!resolved.startsWith(prefix)) throw new Error('Unsafe detector profile cleanup path.');
    fs.rmSync(resolved, { recursive: true, force: true }); profileRemoved = !fs.existsSync(resolved);
  }
  const report = {
    schema_version: 'solat.packaged-hand-detector.v1',
    status: runtime?.initialized === true && runtime.camera_requests === 0 && detectorRequests === 0 && processStopped && profileRemoved ? 'PASS' : 'FAIL',
    package: { executable_sha256: sha256(executable), app_asar_sha256: sha256(appAsar) },
    runtime: {
      detector_initialized: runtime?.initialized === true, camera_requested: runtime?.camera_requests > 0,
      baseline_external_http_requests: baselineRequests, baseline_external_origins: [...baselineOrigins].sort(),
      detector_external_http_requests: detectorRequests, detector_external_origins: [...detectorOrigins].sort(), localhost_cdp_test_only: true,
    },
    cleanup: { main_process_stopped: processStopped, isolated_profile_removed: profileRemoved },
    limitations: [
      'Detector initialization only; no physical camera, landmarks, gestures, device switching, occlusion, lighting or subjective usability was tested.',
      'Network observation covered the packaged renderer during this bounded detector initialization probe only; ordinary UI startup traffic is reported separately from detector-phase traffic.',
    ],
  };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'packaged_detector_failed' })}\n`); process.exitCode = 1; });
