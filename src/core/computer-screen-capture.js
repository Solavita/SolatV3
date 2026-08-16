const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SCREEN_CAPTURE_SCHEMA_VERSION = 'solat.computer-screen-capture.v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 16_384;
const DEFAULT_MAX_PIXELS = 50_000_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class ScreenCaptureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ScreenCaptureError';
    this.code = code;
    this.details = details;
  }
}

function validHwnd(value) {
  const hwnd = Number(value);
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) {
    throw new ScreenCaptureError('invalid_arguments', 'hwnd must be a positive integer.');
  }
  return hwnd;
}

function defaultExecutable() {
  const alias = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winapp.exe')
    : '';
  return alias && fs.existsSync(alias) ? alias : 'winapp';
}

function defaultCaptureRunner(executable, args, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ScreenCaptureError('cancelled', 'Screen capture was cancelled.'));
      return;
    }
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      cwd,
      env: { ...process.env, WINAPP_CLI_TELEMETRY_OPTOUT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill();
        finish(new ScreenCaptureError('output_limit', 'Screen capture command output exceeded its safety limit.'));
      }
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => finish(new ScreenCaptureError(
      error.code === 'ENOENT' ? 'computer_use_unavailable' : 'screen_capture_failed',
      error.code === 'ENOENT' ? 'The Windows screen capture tool is unavailable.' : 'The screen capture command failed.',
    )));
    child.once('close', code => finish(null, {
      code,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
    }));
    const abort = () => {
      child.kill();
      finish(new ScreenCaptureError('cancelled', 'Screen capture was cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      child.kill();
      finish(new ScreenCaptureError('timeout', 'Screen capture timed out.'));
    }, timeoutMs);
  });
}

function parsePng(bytes, { maxBytes, maxDimension, maxPixels }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > maxBytes) {
    throw new ScreenCaptureError('invalid_screenshot', 'Screenshot size is outside the allowed range.');
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13
    || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ScreenCaptureError('invalid_screenshot', 'Screenshot is not a valid PNG image.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new ScreenCaptureError('invalid_screenshot_dimensions', 'Screenshot dimensions exceed the allowed range.', {
      width,
      height,
    });
  }
  return { width, height };
}

function reportedOutputPath(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new ScreenCaptureError('malformed_response', 'Screen capture command returned malformed JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ScreenCaptureError('malformed_response', 'Screen capture command returned an invalid result.');
  }
  for (const key of ['output', 'outputPath', 'output_path', 'path', 'file', 'filePath', 'file_path']) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key].trim();
  }
  return null;
}

function normalizeTrustedTarget(value, hwnd) {
  if (value === true) return Object.freeze({ hwnd });
  if (!value || typeof value !== 'object' || Number(value.hwnd) !== hwnd) {
    throw new ScreenCaptureError('untrusted_target', 'The window is not an approved Computer Use target.');
  }
  return Object.freeze({
    hwnd,
    process_name: typeof value.process_name === 'string' ? value.process_name.slice(0, 120) : undefined,
    title: typeof value.title === 'string' ? value.title.slice(0, 300) : undefined,
  });
}

function persistedScreenCapture(capture) {
  const metadata = capture?.metadata;
  if (!metadata || metadata.schema_version !== SCREEN_CAPTURE_SCHEMA_VERSION) {
    throw new ScreenCaptureError('invalid_capture', 'A validated screen capture is required.');
  }
  return Object.freeze({
    ...metadata,
    ephemeral_image_omitted: true,
  });
}

class WindowScreenCapture {
  constructor({
    assertTarget,
    captureRunner = defaultCaptureRunner,
    executable = defaultExecutable(),
    tempRoot = path.join(os.tmpdir(), 'solat-screen-capture'),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxDimension = DEFAULT_MAX_DIMENSION,
    maxPixels = DEFAULT_MAX_PIXELS,
    now = () => new Date(),
  } = {}) {
    if (typeof assertTarget !== 'function') {
      throw new ScreenCaptureError('invalid_capture_config', 'A trusted target validator is required.');
    }
    if (typeof captureRunner !== 'function') {
      throw new ScreenCaptureError('invalid_capture_config', 'A screen capture runner is required.');
    }
    const configuredRoot = String(tempRoot || '');
    if (!path.isAbsolute(configuredRoot)) {
      throw new ScreenCaptureError('invalid_capture_config', 'The screen capture temp root must be absolute.');
    }
    const root = path.resolve(configuredRoot);
    this.assertTarget = assertTarget;
    this.captureRunner = captureRunner;
    this.executable = executable;
    this.tempRoot = root;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.maxDimension = maxDimension;
    this.maxPixels = maxPixels;
    this.now = now;
  }

  async capture({ hwnd: rawHwnd, signal } = {}) {
    const hwnd = validHwnd(rawHwnd);
    if (signal?.aborted) throw new ScreenCaptureError('cancelled', 'Screen capture was cancelled.');
    const trusted = normalizeTrustedTarget(await this.assertTarget({ hwnd, signal }), hwnd);
    await fsPromises.mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    const rootStats = await fsPromises.lstat(this.tempRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new ScreenCaptureError('unsafe_temp_root', 'The screen capture temp root is not a trusted directory.');
    }
    const realRoot = await fsPromises.realpath(this.tempRoot);
    const captureDir = await fsPromises.mkdtemp(path.join(realRoot, 'capture-'));
    const outputPath = path.join(captureDir, 'window.png');
    try {
      const result = await this.captureRunner(this.executable, [
        'ui', 'screenshot', '-w', String(hwnd), '--output', outputPath, '--json',
      ], { signal, timeoutMs: this.timeoutMs, cwd: captureDir });
      if (!result || result.code !== 0) {
        throw new ScreenCaptureError('screen_capture_failed', 'The screen capture command failed.', {
          exit_code: Number.isInteger(result?.code) ? result.code : null,
        });
      }
      const reported = reportedOutputPath(result.stdout);
      if (reported && path.resolve(captureDir, reported) !== path.resolve(outputPath)) {
        throw new ScreenCaptureError('unexpected_capture_path', 'The screen capture tool reported an unexpected output path.');
      }
      const outputStats = await fsPromises.lstat(outputPath).catch(() => null);
      if (!outputStats || !outputStats.isFile() || outputStats.isSymbolicLink()) {
        throw new ScreenCaptureError('screen_capture_missing', 'The expected screenshot file was not created.');
      }
      if (outputStats.size <= 0 || outputStats.size > this.maxBytes) {
        throw new ScreenCaptureError('invalid_screenshot', 'Screenshot size is outside the allowed range.');
      }
      const bytes = await fsPromises.readFile(outputPath);
      const { width, height } = parsePng(bytes, {
        maxBytes: this.maxBytes,
        maxDimension: this.maxDimension,
        maxPixels: this.maxPixels,
      });
      const capturedAt = this.now();
      const metadata = Object.freeze({
        schema_version: SCREEN_CAPTURE_SCHEMA_VERSION,
        status: 'ready',
        operation: 'capture_window',
        hwnd,
        process_name: trusted.process_name,
        window_title: trusted.title,
        media_type: 'image/png',
        size_bytes: bytes.length,
        width,
        height,
        sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
        captured_at: capturedAt instanceof Date ? capturedAt.toISOString() : new Date(capturedAt).toISOString(),
      });
      return Object.freeze({ metadata, bytes: Buffer.from(bytes) });
    } finally {
      await fsPromises.rm(captureDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  SCREEN_CAPTURE_SCHEMA_VERSION,
  ScreenCaptureError,
  WindowScreenCapture,
  defaultCaptureRunner,
  persistedScreenCapture,
};
