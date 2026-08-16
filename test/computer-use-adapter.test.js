const test = require('node:test');
const assert = require('node:assert/strict');
const { WinAppComputerUseAdapter, ComputerUseError, isSensitiveUiaNode, containsSensitiveUiaNode } = require('../src/core/computer-use-adapter');

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
  let listCount = 0;
  const adapter = new WinAppComputerUseAdapter({
    runner: async (_executable, args) => {
      assert.equal(args[1], 'list-windows');
      listCount += 1;
      const rows = listCount === 1 ? [] : [{ hwnd: 91, processId: 4242, processName: 'chrome', title: 'New Tab', isForeground: true }];
      return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
    },
    appResolver(appId) {
      assert.equal(appId, 'chrome');
      return { app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' };
    },
    async launcher(executable, options) { calls.push([executable, options.args]); return { pid: 4242 }; },
  });
  const result = await adapter.launchApp({ appId: 'chrome' });
  assert.equal(result.operation, 'launch_app');
  assert.equal(result.launched, true);
  assert.equal(result.process_id, 4242);
  assert.equal(result.hwnd, 91);
  assert.equal(result.verified, true);
  assert.deepEqual(calls, [['C:\\Approved\\chrome.exe', ['--profile-directory=Default', '--new-window', 'about:blank']]]);
});

test('computer adapter opens only a fixed allowlisted website in Chrome Default profile', async () => {
  let launchOptions;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 77, processId: 8, processName: 'chrome', title: 'Google Classroom', isForeground: true }],
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchOptions = options; return { pid: 404 }; },
  });
  const opened = await adapter.openWebsite({ site: 'google_classroom' });
  assert.equal(opened.operation, 'open_website');
  assert.equal(opened.site, 'google_classroom');
  assert.equal(opened.verified, true);
  assert.deepEqual(launchOptions.args, ['--profile-directory=Default', '--new-window', 'https://classroom.google.com/']);
  await assert.rejects(() => adapter.openWebsite({ site: 'arbitrary-site' }), error => error.code === 'website_not_allowed');
});

test('computer adapter does not report a stale Chrome tab as the requested website', async () => {
  let listCount = 0;
  const { runner } = runnerWith({
    'list-windows': () => {
      listCount += 1;
      if (listCount === 1) return [{ hwnd: 10, processId: 8, processName: 'chrome', title: 'Gmail - Google Chrome', isForeground: true }];
      if (listCount === 2) return [{ hwnd: 10, processId: 8, processName: 'chrome', title: 'Google Search - Google Chrome', isForeground: true }];
      return [{ hwnd: 20, processId: 9, processName: 'chrome', title: 'Google Classroom', isForeground: true }];
    },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 404 }; },
  });
  const opened = await adapter.openWebsite({ site: 'google_classroom' });
  assert.equal(opened.hwnd, 20);
  assert.equal(opened.window_title, 'Google Classroom');
  assert.ok(listCount >= 3);
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

test('computer adapter chooses the matching YouTube result instead of the first unrelated card', async () => {
  const invoked = [];
  let inspectCount = 0;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }],
    inspect() {
      inspectCount += 1;
      if (inspectCount === 1) return { windows: [{ elements: [
        { type: 'Hyperlink', name: 'Loft music mix', selector: 'wrong-result', value: 'https://www.youtube.com/watch?v=wrong', isOffscreen: false },
        { type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false },
      ] }] };
      return { windows: [{ elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => { if (args[1] === 'invoke') invoked.push(args[2]); return runner(executable, args, options); },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.equal(invoked[0], 'right-result');
});

test('computer adapter matches a compact query to a punctuated YouTube title', async () => {
  const invoked = [];
  let inspectCount = 0;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }],
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { elements: [{ type: 'Hyperlink', name: 'Diana King - L-L-Lies (Video)', selector: 'punctuated-result', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => { if (args[1] === 'invoke') invoked.push(args[2]); return runner(executable, args, options); },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Diana King - L-L-Lies (Video)');
  assert.deepEqual(invoked, ['punctuated-result']);
  assert.equal(result.playback, 'playing');
});

test('computer adapter falls back to a guarded semantic click when YouTube ignores InvokePattern', async () => {
  let inspectCount = 0;
  const { calls, runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      if (inspectCount === 1) return { elements: [{ type: 'Hyperlink', name: 'L-L-Lies', selector: 'result', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] };
      if (inspectCount <= 3) return { elements: [{ name: 'Play (k)', selector: `play-${inspectCount}` }] };
      return { elements: [{ name: 'Pause (k)', selector: 'pause' }] };
    },
    invoke: { success: true },
    click: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.playback, 'playing');
  assert.ok(calls.some(args => args[1] === 'click' && args[2] === 'play-3'));
});

test('computer adapter accepts a matching semantic Chrome link when UIA omits its href', async () => {
  let inspectCount = 0;
  const invoked = [];
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { elements: [
          { controlType: 'Hyperlink', name: 'Loft music mix', selector: 'wrong-link', isOffscreen: false },
          { controlType: 'Hyperlink', name: 'Lllies official audio', selector: 'right-link', isOffscreen: false },
        ] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => { if (args[1] === 'invoke') invoked.push(args[2]); return runner(executable, args, options); },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.deepEqual(invoked, ['right-link']);
});

test('computer adapter accepts a matching YouTube watch URL when UIA omits the link role', async () => {
  let inspectCount = 0;
  const invoked = [];
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { elements: [{ name: 'Lllies official audio', selector: 'result-url', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => { if (args[1] === 'invoke') invoked.push(args[2]); return runner(executable, args, options); },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.deepEqual(invoked, ['result-url']);
});

test('computer adapter accepts a semantic YouTube result card when Chromium reports a button', async () => {
  let inspectCount = 0;
  const invoked = [];
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { elements: [{ type: 'Button', name: 'Lllies official audio', selector: 'video-result-1', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => { if (args[1] === 'invoke') invoked.push(args[2]); return runner(executable, args, options); },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.deepEqual(invoked, ['video-result-1']);
});

test('computer adapter binds a music workflow to the foreground matching YouTube window', async () => {
  const inspectedHandles = [];
  let inspection = 0;
  const { runner } = runnerWith({
    'list-windows': [
      { hwnd: 11, processId: 8, processName: 'chrome', title: 'Loft music - YouTube', isForeground: false },
      { hwnd: 22, processId: 9, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true },
    ],
    focus: { success: true },
    inspect(args) {
      inspection += 1;
      inspectedHandles.push(args[args.indexOf('--window') + 1]);
      return inspection === 1
        ? { elements: [{ type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.hwnd, 22);
  assert.ok(inspectedHandles.every(hwnd => hwnd === '22'));
});

test('computer adapter prefers the requested YouTube title over a stale foreground tab', async () => {
  const inspectedHandles = [];
  let inspection = 0;
  const { runner } = runnerWith({
    'list-windows': [
      { hwnd: 11, processId: 8, processName: 'chrome', title: 'Loft music - YouTube', isForeground: true },
      { hwnd: 22, processId: 9, processName: 'chrome', title: 'Lllies - YouTube', isForeground: false },
    ],
    focus: { success: true },
    inspect(args) {
      inspection += 1;
      inspectedHandles.push(args[args.indexOf('--window') + 1]);
      return inspection === 1
        ? { elements: [{ type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.hwnd, 22);
  assert.ok(inspectedHandles.every(hwnd => hwnd === '22'));
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

test('computer adapter retries a transient media-control element_not_found result', async () => {
  let inspectCount = 0;
  let invokeCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      const tree = inspectCount === 1
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: 'fresh-result', value: 'https://www.youtube.com/watch?v=example', isOffscreen: false }] }
        : invokeCount >= 3
          ? { elements: [{ name: 'Pause (k)', selector: 'btn-pause-current' }] }
          : { elements: [{ name: 'Play (k)', selector: 'btn-play-current' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') {
      invokeCount += 1;
      if (invokeCount === 2) return { code: 1, stdout: '', stderr: '{"error":{"code":"element_not_found","message":"No element found matching btn-play-current"}}' };
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
  assert.equal(result.playback, 'playing');
  assert.equal(result.verified, true);
  assert.ok(invokeCount >= 3);
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

test('computer adapter focuses a trusted background window before semantic inspection', async () => {
  let listed = 0;
  const { runner, calls } = runnerWith({
    'list-windows': () => {
      listed += 1;
      return [{ hwnd: 10, processId: 2, processName: 'chrome', title: 'Google', isForeground: listed > 1 }];
    },
    focus: { success: true },
    inspect: { windows: [{ elements: [{ name: 'Search', controlType: 'Edit', selector: 'edit-search' }] }] },
  });
  const result = await new WinAppComputerUseAdapter({ runner }).inspect({ hwnd: 10 });
  assert.equal(result.status, 'ready');
  assert.ok(calls.some(args => args[1] === 'focus' && args.includes('10')));
  assert.equal(result.target.is_foreground, true);
});

test('computer adapter submits an inspected field with Enter and verifies the resulting title', async () => {
  let listCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') {
      listCount += 1;
      const title = listCount >= 3 ? 'Diana King - Google Search' : 'New Tab - Google Chrome';
      return { code: 0, stdout: JSON.stringify([{ hwnd: 10, processId: 2, processName: 'chrome', title }]), stderr: '' };
    }
    if (verb === 'inspect') return { code: 0, stdout: JSON.stringify({ elements: [{ name: 'Search', controlType: 'Edit' }] }), stderr: '' };
    if (verb === 'send-keys') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    throw new Error(`unexpected verb ${verb}`);
  };
  const result = await new WinAppComputerUseAdapter({ runner }).pressEnter({ hwnd: 10, selector: 'edit-search', verifyTitleContains: 'Diana King' });
  assert.equal(result.operation, 'press_enter');
  assert.equal(result.verified, true);
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

test('computer adapter denies structurally sensitive controls even when names stay benign', async () => {
  assert.equal(isSensitiveUiaNode({ name: 'Field A', controlType: 'Edit' }), false);
  assert.equal(isSensitiveUiaNode({ name: 'Field A', controlType: 'Edit', isPassword: true }), true);
  assert.equal(isSensitiveUiaNode({ name: 'Field A', controlType: 'SecureTextField' }), true);
  assert.equal(isSensitiveUiaNode({ name: 'Field A', className: 'PasswordBox' }), true);
  assert.equal(containsSensitiveUiaNode({ windows: [{ elements: [{ name: 'Field A', controlType: 'Edit' }] }] }), false);
  assert.equal(containsSensitiveUiaNode({ windows: [{ elements: [{ name: 'Field A', controlType: 'Edit' }, { name: 'Code', className: 'PasswordBox' }] }] }), true);
  // The serialized tree contains no lexical credential keyword; only the
  // structural control-type signal proves the field is a secret input.
  const { runner, calls } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Field A', controlType: 'SecureTextField', selector: 'edit-a' }] },
    'set-value': { success: true },
    'wait-for': { found: true, timedOut: false },
  });
  await assert.rejects(
    () => new WinAppComputerUseAdapter({ runner }).setValue({ hwnd: 10, selector: 'edit-a', value: '1234' }),
    error => error.code === 'sensitive_target',
  );
  assert.equal(calls.some(args => args[1] === 'set-value'), false);
});

test('computer adapter denies one-time-code fields at the execution boundary', async () => {
  const { runner, calls } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes' }],
    inspect: { elements: [{ name: 'Enter OTP', controlType: 'Edit', selector: 'edit-code' }] },
    'set-value': { success: true },
    'wait-for': { found: true, timedOut: false },
  });
  await assert.rejects(
    () => new WinAppComputerUseAdapter({ runner }).setValue({ hwnd: 10, selector: 'edit-code', value: '123456' }),
    error => error.code === 'sensitive_target',
  );
  assert.equal(calls.some(args => args[1] === 'set-value'), false);
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
