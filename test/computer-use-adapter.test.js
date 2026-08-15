const test = require('node:test');
const assert = require('node:assert/strict');
const { WinAppComputerUseAdapter, ComputerUseError } = require('../src/core/computer-use-adapter');

function runnerWith(fixtures) {
  const calls = [];
  const runner = async (_executable, args) => {
    calls.push(args);
    const fixture = fixtures[args[1]];
    const value = typeof fixture === 'function' ? fixture(args, calls) : fixture;
    if (value instanceof Error) throw value;
    return { code: 0, stdout: JSON.stringify(value), stderr: '' };
  };
  return { calls, runner };
}

test('computer adapter lists safe windows and excludes sensitive targets', async () => {
  const { runner } = runnerWith({ 'list-windows': [
    { hwnd: 10, processId: 2, processName: 'notepad', title: 'notes', width: 500, height: 300 },
    { hwnd: 11, processId: 3, processName: 'LockApp', title: 'Windows Default Lock Screen' },
    { hwnd: 12, processId: 4, processName: 'browser', title: 'Bank login' },
    { hwnd: 13, processId: 5, processName: 'browser', title: 'เข้าสู่ระบบธนาคาร' },
  ] });
  const result = await new WinAppComputerUseAdapter({ runner }).listWindows();
  assert.deepEqual(result.windows.map(window => window.hwnd), [10]);
  assert.equal(result.schema_version, 'solat.computer-result.v1');
});

test('computer adapter launches only a resolved allowlisted app and reports the spawned process', async () => {
  const calls = [];
  const adapter = new WinAppComputerUseAdapter({
    appResolver(appId) {
      assert.equal(appId, 'chrome');
      return { app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' };
    },
    async launcher(executable) { calls.push(executable); return { pid: 4242 }; },
  });
  const result = await adapter.launchApp({ appId: 'chrome' });
  assert.equal(result.operation, 'launch_app');
  assert.equal(result.launched, true);
  assert.equal(result.process_id, 4242);
  assert.deepEqual(calls, ['C:\\Approved\\chrome.exe']);
});

test('computer adapter bypasses the Chrome profile picker and verifies YouTube music playback', async () => {
  let launchOptions;
  let inspectCount = 0;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }],
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { windows: [{ elements: [{ type: 'Hyperlink', name: 'Lilies - Dream Song', selector: 'lnk-lilies', value: 'https://www.youtube.com/watch?v=example', isOffscreen: false }] }] }
        : { windows: [{ elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchOptions = options; return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.operation, 'play_youtube_music');
  assert.equal(result.profile, 'Default');
  assert.equal(result.playback, 'playing');
  assert.equal(result.verified, true);
  assert.equal(result.query, 'Lllies');
  assert.equal(result.selected_result, 'Lilies - Dream Song');
  assert.deepEqual(launchOptions.args.slice(0, 2), ['--profile-directory=Default', '--new-window']);
  assert.match(launchOptions.args[2], /^https:\/\/www\.youtube\.com\/results\?search_query=Lllies$/);
});

test('computer adapter re-inspects a dynamic YouTube result after one stale element failure', async () => {
  let inspectCount = 0;
  let invokeCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      const tree = inspectCount <= 2
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: `result-${inspectCount}`, value: 'https://www.youtube.com/watch?v=example', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') {
      invokeCount += 1;
      if (invokeCount === 1) return { code: 1, stdout: '', stderr: '{"error":{"code":"stale_element","message":"Element is no longer accessible"}}' };
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(invokeCount, 2);
  assert.equal(result.selected_result, 'Lilies result');
  assert.equal(result.verified, true);
});

test('computer adapter retries a stale dynamic-page inspection before selecting a result', async () => {
  let inspectCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      if (inspectCount === 1) return { code: 1, stdout: '', stderr: '{"error":{"code":"stale_element","message":"Element is no longer accessible"}}' };
      const tree = inspectCount === 2
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: 'fresh-result', value: 'https://www.youtube.com/watch?v=example', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.ok(inspectCount >= 3);
  assert.equal(result.verified, true);
});

test('computer adapter binds mutations to a listed hwnd and semantic selector', async () => {
  const fixtures = {
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Editor', controlType: 'Edit' }] },
    'set-value': { success: true },
    'wait-for': { found: true, timedOut: false, elapsedMs: 12 },
  };
  const { runner, calls } = runnerWith(fixtures);
  const changed = await new WinAppComputerUseAdapter({ runner }).setValue({ hwnd: 10, selector: 'edit-editor', value: 'hello' });
  assert.equal(changed.status, 'ready');
  assert.equal(changed.verified, true);
  assert.deepEqual(changed.verification, { selector: 'edit-editor', state: 'value', found: true, elapsed_ms: 12 });
  assert.equal(Object.hasOwn(changed, 'result'), false);
  assert.equal(changed.value_length, 5);
  assert.ok(calls.some(args => args.includes('--window') && args.includes('10')));
});

test('computer adapter rejects unknown and credential targets', async () => {
  const safe = runnerWith({ 'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }] });
  await assert.rejects(() => new WinAppComputerUseAdapter({ runner: safe.runner }).invoke({ hwnd: 99, selector: 'button-ok' }), error => error instanceof ComputerUseError && error.code === 'target_not_allowed');
  const protectedRunner = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Password', isPassword: true }] },
  });
  await assert.rejects(() => new WinAppComputerUseAdapter({ runner: protectedRunner.runner }).setValue({ hwnd: 10, selector: 'password', value: 'secret' }), error => error.code === 'sensitive_target');
});

test('computer adapter exposes malformed CLI output as failure', async () => {
  const runner = async () => ({ code: 0, stdout: '{bad', stderr: '' });
  await assert.rejects(() => new WinAppComputerUseAdapter({ runner }).listWindows(), error => error.code === 'malformed_response');
});

test('computer adapter rejects a mutation whose post-action state is not verified', async () => {
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Editor', controlType: 'Edit' }] },
    'set-value': { success: true },
    'wait-for': { found: false, timedOut: true, elapsedMs: 5000 },
  });
  await assert.rejects(
    () => new WinAppComputerUseAdapter({ runner }).setValue({ hwnd: 10, selector: 'edit-editor', value: 'hello' }),
    error => error.code === 'verification_failed',
  );
});

test('computer adapter invokes only with explicit post-action verification', async () => {
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Save', controlType: 'Button' }] },
    invoke: { success: true },
    'wait-for': { found: true, timedOut: false },
  });
  const result = await new WinAppComputerUseAdapter({ runner }).invoke({
    hwnd: 10,
    selector: 'button-save',
    verifySelector: 'saved-indicator',
    verifyState: 'present',
  });
  assert.equal(result.verified, true);
  assert.equal(result.verification.selector, 'saved-indicator');
});
