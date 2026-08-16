const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ScreenCaptureError,
  WindowScreenCapture,
  persistedScreenCapture,
} = require('../src/core/computer-screen-capture');

function pngHeader(width = 800, height = 600, padding = 8) {
  const bytes = Buffer.alloc(24 + padding);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function tempRoot(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `solat-screen-${name}-`));
}

test('captures an exact trusted HWND and returns ephemeral validated PNG bytes', async t => {
  const root = await tempRoot('valid');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = pngHeader();
  const calls = [];
  const capture = new WindowScreenCapture({
    tempRoot: root,
    now: () => new Date('2026-08-16T09:00:00.000Z'),
    async assertTarget(target) {
      calls.push(['assert', target.hwnd]);
      return { hwnd: target.hwnd, process_name: 'chrome', title: 'YouTube' };
    },
    async captureRunner(executable, args, options) {
      calls.push(['capture', executable, args, options.cwd]);
      const outputPath = args[args.indexOf('--output') + 1];
      assert.equal(path.dirname(outputPath), options.cwd);
      await fs.writeFile(outputPath, bytes);
      return { code: 0, stdout: JSON.stringify({ outputPath }), stderr: '' };
    },
  });

  const result = await capture.capture({ hwnd: 4242 });
  assert.deepEqual(calls[0], ['assert', 4242]);
  assert.deepEqual(calls[1][2].slice(0, 4), ['ui', 'screenshot', '-w', '4242']);
  assert.equal(calls[1][2].includes('--capture-screen'), false);
  assert.equal(result.metadata.hwnd, 4242);
  assert.equal(result.metadata.width, 800);
  assert.equal(result.metadata.height, 600);
  assert.equal(result.metadata.size_bytes, bytes.length);
  assert.equal(result.metadata.sha256, `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`);
  assert.equal(result.metadata.captured_at, '2026-08-16T09:00:00.000Z');
  assert.deepEqual(result.bytes, bytes);
  await assert.rejects(() => fs.access(calls[1][3]), error => error.code === 'ENOENT');

  const persisted = persistedScreenCapture(result);
  assert.equal(persisted.ephemeral_image_omitted, true);
  assert.equal(Object.hasOwn(persisted, 'bytes'), false);
  assert.equal(JSON.stringify(persisted).includes(calls[1][3]), false);
});

test('refuses an untrusted target before invoking the capture runner', async () => {
  let runnerCalls = 0;
  const capture = new WindowScreenCapture({
    async assertTarget() { return { hwnd: 99 }; },
    async captureRunner() { runnerCalls += 1; },
  });
  await assert.rejects(() => capture.capture({ hwnd: 42 }), error => (
    error instanceof ScreenCaptureError && error.code === 'untrusted_target'
  ));
  assert.equal(runnerCalls, 0);
});

test('rejects output reported outside the controlled exact path and cleans temporary files', async t => {
  const root = await tempRoot('path');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let captureDir;
  const capture = new WindowScreenCapture({
    tempRoot: root,
    async assertTarget({ hwnd }) { return { hwnd }; },
    async captureRunner(_executable, args, options) {
      captureDir = options.cwd;
      await fs.writeFile(args[args.indexOf('--output') + 1], pngHeader());
      return { code: 0, stdout: JSON.stringify({ path: path.join(root, 'other.png') }), stderr: '' };
    },
  });
  await assert.rejects(() => capture.capture({ hwnd: 42 }), error => (
    error instanceof ScreenCaptureError && error.code === 'unexpected_capture_path'
  ));
  await assert.rejects(() => fs.access(captureDir), error => error.code === 'ENOENT');
});

test('rejects malformed PNG, excessive dimensions, and oversized output', async t => {
  const root = await tempRoot('invalid');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixtures = [
    { bytes: Buffer.from('not png'), code: 'invalid_screenshot' },
    { bytes: pngHeader(20_000, 10), code: 'invalid_screenshot_dimensions' },
    { bytes: Buffer.alloc(65), code: 'invalid_screenshot', maxBytes: 64 },
  ];
  for (const fixture of fixtures) {
    const capture = new WindowScreenCapture({
      tempRoot: root,
      maxBytes: fixture.maxBytes,
      async assertTarget({ hwnd }) { return { hwnd }; },
      async captureRunner(_executable, args) {
        await fs.writeFile(args[args.indexOf('--output') + 1], fixture.bytes);
        return { code: 0, stdout: '{}', stderr: '' };
      },
    });
    await assert.rejects(() => capture.capture({ hwnd: 42 }), error => error.code === fixture.code);
  }

});

test('cleans its temporary directory when the runner fails', async t => {
  const root = await tempRoot('failure');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let captureDir;
  const capture = new WindowScreenCapture({
    tempRoot: root,
    async assertTarget({ hwnd }) { return { hwnd }; },
    async captureRunner(_executable, _args, options) {
      captureDir = options.cwd;
      throw new ScreenCaptureError('timeout', 'Screen capture timed out.');
    },
  });
  await assert.rejects(() => capture.capture({ hwnd: 42 }), error => error.code === 'timeout');
  await assert.rejects(() => fs.access(captureDir), error => error.code === 'ENOENT');
});

test('redacted persisted view never accepts an unvalidated arbitrary object', () => {
  assert.throws(() => persistedScreenCapture({ metadata: { bytes: Buffer.from('secret') } }), error => (
    error instanceof ScreenCaptureError && error.code === 'invalid_capture'
  ));
});

test('requires an absolute controlled temp root', () => {
  assert.throws(() => new WindowScreenCapture({
    tempRoot: 'relative-captures',
    async assertTarget({ hwnd }) { return { hwnd }; },
  }), error => error instanceof ScreenCaptureError && error.code === 'invalid_capture_config');
});
