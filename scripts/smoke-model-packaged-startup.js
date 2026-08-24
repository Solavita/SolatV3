#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function credentialFreeEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)/iu.test(key)
    && !/^SOLAT_(?:MODEL|LOCAL_MODEL|QWEN|VISION_MODEL)/iu.test(key)));
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  if (process.platform !== 'win32') throw new Error('This packaged startup smoke is Windows-only.');
  const executable = path.resolve(argument('--exe'));
  const output = path.resolve(argument('--output'));
  if (!argument('--exe') || !argument('--output')) throw new Error('--exe and --output are required.');
  if (!fs.statSync(executable).isFile() || path.basename(executable).toLowerCase() !== 'solat.exe') throw new Error('A packaged SOLAT.exe is required.');
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing report.');
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  if (!fs.statSync(appAsar).isFile()) throw new Error('The package app.asar is missing.');
  const tempRoot = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'solat-qwen37-model-'));
  let child = null;
  let aliveAfterMs = false;
  let cleanupProcess = false;
  let cleanupProfile = false;
  try {
    child = spawn(executable, [`--user-data-dir=${profile}`], {
      cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore',
      env: { ...credentialFreeEnvironment(), SOLAT_DEVTOOLS: '0', SOLAT_VOICE_ENABLED: 'false' },
    });
    await wait(6000);
    aliveAfterMs = child.exitCode === null && child.signalCode === null;
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { child.kill(); } catch {}
      await wait(1500);
      cleanupProcess = child.exitCode !== null || child.signalCode !== null;
    }
    const profileFull = path.resolve(profile);
    const allowedPrefix = `${tempRoot}${path.sep}solat-qwen37-model-`;
    if (!profileFull.startsWith(allowedPrefix)) throw new Error('Unsafe runtime profile cleanup path.');
    fs.rmSync(profileFull, { recursive: true, force: true });
    cleanupProfile = !fs.existsSync(profileFull);
  }
  const report = {
    schema_version: 'solat.model-packaged-startup.v2',
    status: aliveAfterMs && cleanupProcess && cleanupProfile ? 'PASS' : 'FAIL',
    package: {
      executable_sha256: sha256(executable),
      app_asar_sha256: sha256(appAsar),
    },
    runtime: {
      observation_ms: 6000,
      main_process_alive_after_observation: aliveAfterMs,
      provider_request_initiated_by_harness: false,
      solat_provider_credential_environment_injected: false,
      isolated_profile: true,
    },
    cleanup: { main_process_stopped: cleanupProcess, isolated_profile_removed: cleanupProfile },
    limitations: [
      'Startup and process lifetime only; packaged provider responses and semantic quality are covered separately.',
      'SOLAT-consumed provider credential environment variables were removed before launch; the harness initiated no provider request.',
      'Network-zero evidence was not captured; source parity shows startup itself does not initiate a model request.',
    ],
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'packaged_startup_failed' })}\n`);
  process.exitCode = 1;
});
