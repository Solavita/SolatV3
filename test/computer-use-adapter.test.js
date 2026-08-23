const test = require('node:test');
const assert = require('node:assert/strict');
const { WinAppComputerUseAdapter, ComputerUseError, isSensitiveUiaNode, containsSensitiveUiaNode, youtubeSearchQuery, youtubeResultScore } = require('../src/core/computer-use-adapter');

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

test('computer adapter reuses and activates an existing Chrome window without spawning another', async () => {
  let listCount = 0;
  let activations = 0;
  let launches = 0;
  const { runner } = runnerWith({
    'list-windows': () => {
      listCount += 1;
      return [{ hwnd: 90, processId: 4141, processName: 'chrome', title: 'Existing Chrome', isForeground: listCount > 1 }];
    },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async activator(hwnd) { assert.equal(hwnd, 90); activations += 1; },
    async launcher() { launches += 1; return { pid: 9999 }; },
  });
  const result = await adapter.launchApp({ appId: 'chrome' });
  assert.equal(result.hwnd, 90);
  assert.equal(result.reused, true);
  assert.equal(result.verified, true);
  assert.equal(activations, 1);
  assert.equal(launches, 0);
});

test('computer adapter verifies an existing app window that the launch brings to foreground', async () => {
  let listCount = 0;
  const { runner } = runnerWith({
    'list-windows': () => {
      listCount += 1;
      return [{
        hwnd: 92,
        processId: 5151,
        processName: 'notepad',
        title: 'Untitled - Notepad',
        isForeground: listCount > 1,
      }];
    },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'notepad', executable: 'C:\\Approved\\notepad.exe', process_name: 'notepad' }),
    async launcher() { return { pid: 9999 }; },
  });
  const result = await adapter.launchApp({ appId: 'notepad' });
  assert.equal(result.hwnd, 92);
  assert.equal(result.process_id, 5151);
  assert.equal(result.verified, true);
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
  assert.equal(opened.process_id, 8, 'authorization must bind to the verified Chrome window PID');
  assert.equal(opened.verified, true);
  assert.deepEqual(launchOptions.args, ['--profile-directory=Default', 'https://classroom.google.com/']);
  await assert.rejects(() => adapter.openWebsite({ site: 'arbitrary-site' }), error => error.code === 'website_not_allowed');
});

test('computer adapter opens allowlisted Instagram instead of a blank Chrome page', async () => {
  let launchOptions;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 79, processId: 10, processName: 'chrome', title: 'Instagram', isForeground: true }],
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchOptions = options; return { pid: 406 }; },
  });
  const result = await adapter.openWebsite({ site: 'instagram' });
  assert.equal(result.site, 'instagram');
  assert.equal(result.verified, true);
  assert.deepEqual(launchOptions.args, ['--profile-directory=Default', 'https://www.instagram.com/']);
});

test('computer adapter opens allowlisted Roblox and verifies the page title', async () => {
  let launchOptions;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 80, processId: 11, processName: 'chrome', title: 'Roblox', isForeground: true }],
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchOptions = options; return { pid: 407 }; },
  });
  const result = await adapter.openWebsite({ site: 'roblox' });
  assert.equal(result.site, 'roblox');
  assert.equal(result.verified, true);
  assert.deepEqual(launchOptions.args, ['--profile-directory=Default', 'https://www.roblox.com/']);
});

test('YouTube query planning removes relational by and ranks title plus artist in either order', () => {
  assert.equal(youtubeSearchQuery('Starboy by The Weeknd'), 'Starboy The Weeknd');
  assert.equal(youtubeSearchQuery('Stand by Me by Ben E. King'), 'Stand by Me Ben E. King');
  assert.ok(youtubeResultScore('The Weeknd - Starboy (Official Video)', 'Starboy by The Weeknd') > 0);
  assert.equal(youtubeResultScore('Starboy by an unrelated artist', 'Starboy by The Weeknd'), 0);
});

test('computer adapter performs one bounded verified Google search batch', async () => {
  let launchOptions;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 78, processId: 9, processName: 'chrome', title: 'Diana King - Google Search', isForeground: true }],
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchOptions = options; return { pid: 405 }; },
  });
  const result = await adapter.searchWeb({ query: 'Diana King' });
  assert.equal(result.operation, 'search_web');
  assert.equal(result.verified, true);
  assert.equal(result.hwnd, 78);
  assert.equal(result.process_id, 9, 'search evidence must use the verified HWND process rather than the launcher PID');
  assert.deepEqual(launchOptions.args, ['--profile-directory=Default', 'https://www.google.com/search?q=Diana%20King']);
});

test('computer search never reports a stale Gmail window as verified results', async () => {
  let listCount = 0;
  const { runner } = runnerWith({
    'list-windows': () => {
      listCount += 1;
      if (listCount < 3) return [{ hwnd: 10, processId: 8, processName: 'chrome', title: 'Inbox - Google Chrome', isForeground: true }];
      return [
        { hwnd: 10, processId: 8, processName: 'chrome', title: 'Inbox - Google Chrome', isForeground: false },
        { hwnd: 20, processId: 9, processName: 'chrome', title: 'Diana King - Google Search', isForeground: true },
      ];
    },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner, timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 405 }; },
  });
  const result = await adapter.searchWeb({ query: 'Diana King' });
  assert.equal(result.hwnd, 20);
  assert.match(result.window_title, /Diana King/iu);
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
        ? { windows: [{ elements: [{ type: 'Hyperlink', name: 'Lilies - Dream Song', selector: 'lnk-lilies', isOffscreen: false }] }] }
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
  assert.equal(result.process_id, 8, 'YouTube evidence must bind to the verified Chrome window PID');
  assert.deepEqual(launchOptions.args.slice(0, 1), ['--profile-directory=Default']);
  assert.match(launchOptions.args[1], /^https:\/\/www\.youtube\.com\/results\?search_query=Lllies$/);
});

test('YouTube playback never invokes a display-only document whose title starts with Play', async () => {
  let inspection = 0;
  const invoked = [];
  const clicked = [];
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'L-L-Lies - YouTube', isForeground: true }]), stderr: '' };
    if (verb === 'inspect') {
      inspection += 1;
      if (inspection === 1) return { code: 0, stdout: JSON.stringify({ elements: [{ type: 'Hyperlink', name: 'L-L-Lies', selector: 'result', isInvokable: true }] }), stderr: '' };
      if (inspection === 2) return { code: 0, stdout: JSON.stringify({ elements: [
        { type: 'Document', name: 'Play L-L-Lies - YouTube', selector: 'doc-root', isInvokable: false },
        { type: 'Button', name: 'เล่นซ้ำ แป้นพิมพ์ลัด k', selector: 'btn-replay', isInvokable: true },
      ] }), stderr: '' };
      return { code: 0, stdout: JSON.stringify({ elements: [{ type: 'Button', name: 'Pause (k)', selector: 'btn-pause', isInvokable: true }] }), stderr: '' };
    }
    if (verb === 'invoke') { invoked.push(args[2]); return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' }; }
    if (verb === 'click') { clicked.push(args[2]); return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' }; }
    if (verb === 'wait-for') return { code: 0, stdout: JSON.stringify({ found: true, timedOut: false, elapsedMs: 1 }), stderr: '' };
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner, timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.verified, true);
  assert.equal(invoked.includes('doc-root'), false);
  assert.equal(clicked.includes('doc-root'), false);
  assert.ok(clicked.includes('btn-replay'));
});

test('YouTube playback rejects a stale Pause control while the player is still unstarted', async () => {
  let started = false;
  let inspection = 0;
  const invoked = [];
  const clicked = [];
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') {
      return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'L-L-Lies - YouTube', isForeground: true }]), stderr: '' };
    }
    if (verb === 'inspect') {
      inspection += 1;
      if (inspection === 1) {
        return { code: 0, stdout: JSON.stringify({ elements: [{ type: 'Hyperlink', name: 'L-L-Lies', selector: 'result', isOffscreen: false }] }), stderr: '' };
      }
      const tree = started
        ? { automationId: 'movie_player', className: 'html5-video-player playing-mode', selector: 'movie_player', children: [
          { type: 'Button', name: 'Pause (k)', selector: 'btn-pause', isEnabled: true, isOffscreen: false, isInvokable: true },
        ] }
        : { automationId: 'movie_player', className: 'html5-video-player playing-mode unstarted-mode', selector: 'movie_player', children: [
          { type: 'Button', name: 'Play', selector: 'btn-play', isEnabled: true, isOffscreen: false, isInvokable: true },
          { type: 'Button', name: 'Pause (k)', selector: 'btn-pause-stale', isEnabled: true, isOffscreen: false, isInvokable: true },
        ] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') {
      invoked.push(args[2]);
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    if (verb === 'click') {
      clicked.push(args[2]);
      if (args[2] === 'btn-play') started = true;
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner, timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.verified, true);
  assert.deepEqual(invoked, ['result']);
  assert.deepEqual(clicked, ['btn-play']);
});

test('YouTube playback clicks the inspected player once when a blocked player exposes only stale Pause', async () => {
  let started = false;
  let inspection = 0;
  const clicked = [];
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') {
      return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'L-L-Lies - YouTube', isForeground: true }]), stderr: '' };
    }
    if (verb === 'inspect') {
      inspection += 1;
      if (inspection === 1) {
        return { code: 0, stdout: JSON.stringify({ elements: [{ type: 'Hyperlink', name: 'L-L-Lies', selector: 'result', isOffscreen: false }] }), stderr: '' };
      }
      const tree = started
        ? { automationId: 'movie_player', className: 'html5-video-player playing-mode', selector: 'movie_player', children: [
          { type: 'Button', name: 'Pause (k)', selector: 'btn-pause', isEnabled: true, isOffscreen: false, isInvokable: true },
        ] }
        : { automationId: 'movie_player', className: 'html5-video-player paused-mode', selector: 'movie_player', children: [
          { type: 'Button', name: 'Pause (k)', selector: 'btn-pause-stale', isEnabled: true, isOffscreen: false, isInvokable: true },
        ] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    if (verb === 'click') {
      clicked.push(args[2]);
      if (args[2] === 'movie_player') started = true;
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner, timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.verified, true);
  assert.deepEqual(clicked, ['movie_player']);
});

test('computer adapter turns WinApp AppNotFound JSON into a concise stale-target error', async () => {
  const adapter = new WinAppComputerUseAdapter({
    runner: async (_executable, args) => {
      if (args[1] === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }]), stderr: '' };
      return { code: 1, stdout: JSON.stringify({ error: { code: 500, message: 'AppNotFoundException: HWND 44 was not found' } }), stderr: '' };
    },
  });
  await assert.rejects(
    () => adapter.inspect({ hwnd: 44 }),
    error => error instanceof ComputerUseError && error.code === 'target_not_allowed'
      && /closed or changed/iu.test(error.message) && !/AppNotFoundException/iu.test(error.message),
  );
});

test('YouTube workflow reacquires one replacement Chrome window after the original HWND disappears', async () => {
  let listCount = 0;
  let replacementInspects = 0;
  const adapter = new WinAppComputerUseAdapter({
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
    runner: async (_executable, args) => {
      const operation = args[1];
      if (operation === 'list-windows') {
        listCount += 1;
        const rows = listCount === 1 ? [] : listCount === 2
          ? [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }]
          : [{ hwnd: 55, processId: 9, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }];
        return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
      }
      const hwnd = Number(args[args.indexOf('--window') + 1]);
      if (operation === 'inspect' && hwnd === 44) {
        return { code: 1, stdout: JSON.stringify({ error: { message: 'AppNotFoundException: HWND 44 was not found' } }), stderr: '' };
      }
      if (operation === 'inspect' && hwnd === 55) {
        replacementInspects += 1;
        const tree = replacementInspects === 1
          ? { elements: [{ type: 'Hyperlink', name: 'Lllies official audio', selector: 'replacement-result', isOffscreen: false }] }
          : { elements: [{ name: 'Pause (k)', selector: 'pause' }] };
        return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
      }
      if (operation === 'invoke') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
      throw new Error(`Unexpected operation ${operation}`);
    },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.hwnd, 55);
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.equal(result.playback, 'playing');
});

test('computer adapter chooses the matching YouTube result instead of the first unrelated card', async () => {
  const invoked = [];
  let inspectCount = 0;
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }],
    inspect() {
      inspectCount += 1;
      if (inspectCount === 1) return { windows: [{ elements: [
        { type: 'Hyperlink', name: 'Loft music mix', selector: 'wrong-result', isOffscreen: false },
        { type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', isOffscreen: false },
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
        ? { elements: [{ type: 'Hyperlink', name: 'Diana King - L-L-Lies (Video)', selector: 'punctuated-result', isOffscreen: false }] }
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
  let clickCount = 0;
  const { calls, runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      if (inspectCount === 1) return { elements: [{ type: 'Hyperlink', name: 'L-L-Lies', selector: 'result', isOffscreen: false }] };
      if (clickCount === 0) return { elements: [{ name: 'Play (k)', selector: `play-${inspectCount}` }] };
      return { elements: [{ name: 'Pause (k)', selector: 'pause' }] };
    },
    invoke: { success: true },
    click() { clickCount += 1; return { success: true }; },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.playback, 'playing');
  assert.ok(calls.some(args => args[1] === 'click' && /^play-/u.test(args[2])));
});

test('computer adapter clicks a fresh YouTube result when successful InvokePattern does not navigate', async () => {
  let inspectCount = 0;
  const { calls, runner } = runnerWith({
    'list-windows': [{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: true }],
    inspect() {
      inspectCount += 1;
      if (inspectCount <= 2) {
        return { elements: [{ type: 'Hyperlink', name: 'Diana King - L-L-Lies', selector: `result-${inspectCount}`, isOffscreen: false }] };
      }
      return { elements: [{ name: 'Pause (k)', selector: 'pause-current' }] };
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
  assert.ok(calls.some(args => args[1] === 'click' && args[2] === 'result-2'));
});

test('computer adapter re-inspects after Chrome loses foreground before a YouTube click', async () => {
  let inspectCount = 0;
  let clickCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube', isForeground: inspectCount > 0 }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      const tree = inspectCount <= 2
        ? { elements: [{ type: 'Hyperlink', name: 'Diana King - L-L-Lies', selector: `result-${inspectCount}`, value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'pause-current' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'click') {
      clickCount += 1;
      if (clickCount === 1) return { code: 1, stdout: '', stderr: 'Target window is not in the foreground — refusing to click.' };
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    if (verb === 'invoke') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    throw new Error(`unexpected verb ${verb}`);
  };
  const adapter = new WinAppComputerUseAdapter({
    runner,
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher() { return { pid: 99 }; },
    async activator() { return { activated: true }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.verified, true);
  assert.ok(inspectCount >= 3);
  assert.ok(clickCount >= 2);
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
  let listCount = 0;
  const invoked = [];
  const clicked = [];
  const launchedUrls = [];
  const { runner } = runnerWith({
    'list-windows'() {
      listCount += 1;
      return [{ hwnd: 44, processId: 8, processName: 'chrome', title: listCount <= 2 ? 'Lllies - YouTube' : 'L-L-Lies - YouTube', isForeground: true }];
    },
    inspect() {
      inspectCount += 1;
      return inspectCount === 1
        ? { elements: [{ name: 'Lllies official audio', selector: 'result-url', value: 'https://www.youtube.com/watch?v=right', isOffscreen: false }] }
        : { elements: [{ name: 'Pause (k)', selector: 'btn-pause' }] };
    },
    invoke: { success: true },
    click: { success: true },
  });
  const adapter = new WinAppComputerUseAdapter({
    runner: async (executable, args, options) => {
      if (args[1] === 'invoke') invoked.push(args[2]);
      if (args[1] === 'click') clicked.push(args[2]);
      return runner(executable, args, options);
    },
    timeoutMs: 100,
    appResolver: () => ({ app_id: 'chrome', executable: 'C:\\Approved\\chrome.exe', process_name: 'chrome' }),
    async launcher(_executable, options) { launchedUrls.push(options.args.at(-1)); return { pid: 99 }; },
  });
  const result = await adapter.playYoutubeMusic({ query: 'Lllies' });
  assert.equal(result.selected_result, 'Lllies official audio');
  assert.deepEqual(invoked, []);
  assert.deepEqual(clicked, ['result-url']);
  assert.equal(result.hwnd, 44);
  assert.equal(launchedUrls.length, 1, 'A direct result URL must not create a second Chrome tab.');
  assert.match(launchedUrls[0], /results\?search_query=Lllies$/u);
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
        ? { elements: [{ type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', isOffscreen: false }] }
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
        ? { elements: [{ type: 'Hyperlink', name: 'Lllies official audio', selector: 'right-result', isOffscreen: false }] }
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
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: `result-${inspectCount}`, isOffscreen: false }] }
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
  let clickCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 44, processId: 8, processName: 'chrome', title: 'Lllies - YouTube' }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      const tree = inspectCount === 1
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: 'fresh-result', isOffscreen: false }] }
        : clickCount >= 2
          ? { elements: [{ name: 'Pause (k)', selector: 'btn-pause-current' }] }
          : { elements: [{ name: 'Play (k)', selector: 'btn-play-current' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'invoke') {
      invokeCount += 1;
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    if (verb === 'click') {
      clickCount += 1;
      if (clickCount === 1) return { code: 1, stdout: '', stderr: '{"error":{"code":"500","message":"Element could not be re-resolved just before the click - it moved or was removed; gesture not sent."}}' };
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
  assert.equal(invokeCount, 1);
  assert.equal(clickCount, 2);
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
        ? { elements: [{ type: 'Hyperlink', name: 'Lilies result', selector: 'fresh-result', isOffscreen: false }] }
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

test('computer adapter can include non-interactive semantic controls for a trusted workflow', async () => {
  const { runner, calls } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'Untitled - Notepad' }],
    inspect: { windows: [{ elements: [{ type: 'Document', name: 'Text editor', selector: 'doc-texteditor-real' }] }] },
  });
  const result = await new WinAppComputerUseAdapter({ runner }).inspect({ hwnd: 10, depth: 8, interactiveOnly: false });
  assert.equal(result.tree.windows[0].elements[0].selector, 'doc-texteditor-real');
  const inspectCall = calls.find(args => args.includes('inspect'));
  assert.equal(inspectCall.includes('--interactive'), false);
});

test('computer adapter activates a trusted background window before semantic inspection', async () => {
  let listed = 0;
  const { runner, calls } = runnerWith({
    'list-windows': () => {
      listed += 1;
      return [{ hwnd: 10, processId: 2, processName: 'chrome', title: 'Google', isForeground: listed > 1 }];
    },
    inspect: { windows: [{ elements: [{ name: 'Search', controlType: 'Edit', selector: 'edit-search' }] }] },
  });
  const activations = [];
  const adapter = new WinAppComputerUseAdapter({
    runner,
    activator: async hwnd => { activations.push(hwnd); return { activated: true, hwnd }; },
  });
  const result = await adapter.inspect({ hwnd: 10 });
  assert.equal(result.status, 'ready');
  assert.deepEqual(activations, [10]);
  assert.equal(calls.some(args => args[1] === 'focus'), false, 'window activation must not reuse the element-focus CLI verb');
  assert.equal(result.target.is_foreground, true);
});

test('computer adapter surfaces a failed window activation instead of inspecting blind', async () => {
  const { runner } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'chrome', title: 'Google', isForeground: false }],
  });
  const adapter = new WinAppComputerUseAdapter({
    runner,
    activator: async () => { throw new ComputerUseError('activation_failed', 'Window activation failed (1).'); },
  });
  await assert.rejects(() => adapter.inspect({ hwnd: 10 }), error => error instanceof ComputerUseError && error.code === 'activation_failed');
});

test('computer adapter falls back to a bounded click when the element has no invoke pattern', async () => {
  const verbs = [];
  const runner = async (_executable, args) => {
    verbs.push(args[1]);
    if (args[1] === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 10, processId: 2, processName: 'chrome', title: 'Google', isForeground: true }]), stderr: '' };
    if (args[1] === 'inspect') return { code: 0, stdout: JSON.stringify({ elements: [{ name: 'Search', selector: 'cmb-search', type: 'ComboBox' }] }), stderr: '' };
    if (args[1] === 'invoke') return { code: 1, stdout: '', stderr: '{"error":{"code":"internal_error","message":"Element cmb-search (ComboBox) does not support any invoke pattern. No invokable ancestor was found either — this element is display-only and cannot be activated."}}' };
    if (args[1] === 'click') return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    if (args[1] === 'wait-for') return { code: 0, stdout: JSON.stringify({ found: true, timedOut: false, elapsedMs: 5 }), stderr: '' };
    throw new Error(`unexpected verb ${args[1]}`);
  };
  const result = await new WinAppComputerUseAdapter({ runner }).invoke({ hwnd: 10, selector: 'cmb-search', verifySelector: 'cmb-search', verifyState: 'present' });
  assert.equal(result.status, 'ready');
  assert.equal(result.verified, true);
  assert.deepEqual(verbs, ['list-windows', 'list-windows', 'inspect', 'invoke', 'click', 'wait-for']);
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

test('computer adapter sends an allowlisted app hotkey and verifies the resulting toggle state', async () => {
  let inspectCount = 0;
  const runner = async (_executable, args) => {
    const verb = args[1];
    if (verb === 'list-windows') return { code: 0, stdout: JSON.stringify([{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes', isForeground: true }]), stderr: '' };
    if (verb === 'inspect') {
      inspectCount += 1;
      const tree = inspectCount === 1
        ? { elements: [{ name: 'Text editor', selector: 'editor', controlType: 'Edit' }] }
        : { elements: [{ name: 'Bold', selector: 'bold-button', controlType: 'Button', toggleState: 'on' }] };
      return { code: 0, stdout: JSON.stringify(tree), stderr: '' };
    }
    if (verb === 'send-keys') {
      assert.deepEqual(args.slice(1), ['send-keys', 'ctrl+vk=0x42', '--window', '10', '--target', 'editor', '--via', 'send-input', '--json']);
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    throw new Error(`unexpected verb ${verb}`);
  };
  const result = await new WinAppComputerUseAdapter({ runner }).pressHotkey({
    hwnd: 10,
    selector: 'editor',
    chord: 'ctrl+b',
    verifySelector: 'bold-button',
    verifyProperty: 'toggle_state',
    verifyValue: 'on',
  });
  assert.equal(result.operation, 'press_hotkey');
  assert.equal(result.verified, true);
  assert.equal(result.verification.actual, 'on');
});

test('computer adapter rejects global or unverified hotkeys', async () => {
  const { runner, calls } = runnerWith({
    'list-windows': [{ hwnd: 10, processId: 2, processName: 'notepad', title: 'notes', isForeground: true }],
  });
  await assert.rejects(
    () => new WinAppComputerUseAdapter({ runner }).pressHotkey({ hwnd: 10, selector: 'editor', chord: 'alt+tab', verifySelector: 'editor', verifyProperty: 'present' }),
    error => error.code === 'hotkey_not_allowed',
  );
  assert.equal(calls.some(args => args[1] === 'send-keys'), false);
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
