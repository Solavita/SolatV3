const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const COMPUTER_RESULT_SCHEMA_VERSION = 'solat.computer-result.v1';
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const YOUTUBE_SEARCH_BASE_URL = 'https://www.youtube.com/results?search_query=';
const DENIED_PROCESSES = new Set(['lockapp', 'logonui', 'credentialuibroker', 'taskmgr', 'regedit']);
const SENSITIVE_TITLE_THAI = /(?:บัตร|รหัสผ่าน|ธนาคาร|ชำระเงิน)/iu;
const SENSITIVE_ELEMENT = /(?:password|passcode|credential|isPassword\s*[=:]\s*true|รหัสผ่าน|เลขบัตร|บัญชีธนาคาร)/iu;
const SENSITIVE_TITLE = /(?:password|passcode|credential|sign[ -]?in|login|bank|wallet|payment|บัตร|รหัสผ่าน|ธนาคาร)/iu;

class ComputerUseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ComputerUseError';
    this.code = code;
    this.details = details;
  }
}

function boundedText(value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ComputerUseError('invalid_arguments', `${field} is invalid.`);
  }
  return value.trim();
}

function validHwnd(value) {
  const hwnd = Number(value);
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new ComputerUseError('invalid_arguments', 'hwnd must be a positive integer.');
  return hwnd;
}

function isStaleElementError(error) {
  return error instanceof ComputerUseError && /stale_element|no longer accessible/iu.test(`${error.code || ''} ${error.message || ''}`);
}

function sanitizeWindow(window) {
  return {
    hwnd: Number(window.hwnd),
    process_id: Number(window.processId),
    process_name: String(window.processName || '').slice(0, 120),
    title: String(window.title || '').slice(0, 300),
    width: Number(window.width) || 0,
    height: Number(window.height) || 0,
    is_foreground: Boolean(window.isForeground),
  };
}

function isSensitiveWindow(window) {
  return DENIED_PROCESSES.has(String(window.process_name || '').toLowerCase())
    || SENSITIVE_TITLE.test(String(window.title || ''))
    || SENSITIVE_TITLE_THAI.test(String(window.title || ''));
}

function defaultRunner(executable, args, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
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
      if (next.length > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new ComputerUseError('output_limit', 'Computer tool output exceeded its safety limit.'));
      }
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => finish(new ComputerUseError(error.code === 'ENOENT' ? 'computer_use_unavailable' : 'computer_tool_error', error.message)));
    child.once('close', code => finish(null, { code, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') }));
    const abort = () => { child.kill(); finish(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { child.kill(); finish(new ComputerUseError('timeout', 'Computer action timed out.')); }, timeoutMs);
  });
}

// Launching is deliberately separate from UI Automation.  Only this fixed
// catalog may be started; the model never supplies an executable, path, URL,
// shell command, or arguments.
const LAUNCHABLE_APPS = Object.freeze({
  chrome: Object.freeze([
    () => process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    () => process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    () => process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ]),
  notepad: Object.freeze([
    () => process.env.WINDIR ? path.join(process.env.WINDIR, 'System32', 'notepad.exe') : '',
  ]),
});

function resolveLaunchableApp(appId) {
  const normalized = String(appId || '').trim().toLowerCase();
  const candidates = LAUNCHABLE_APPS[normalized];
  if (!candidates) throw new ComputerUseError('app_not_allowed', 'Only an explicitly allowlisted application can be launched.');
  for (const buildPath of candidates) {
    const candidate = buildPath();
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) {
        return { app_id: normalized, executable: path.resolve(candidate), process_name: path.basename(candidate, path.extname(candidate)) };
      }
    } catch { /* Candidate disappeared between checks. */ }
  }
  throw new ComputerUseError('app_unavailable', `The approved ${normalized} application is not installed in its expected location.`);
}

function defaultLaunchRunner(executable, { args = [], signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ComputerUseError('cancelled', 'Computer action was cancelled.'));
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value))) {
      return reject(new ComputerUseError('invalid_arguments', 'Application arguments are invalid.'));
    }
    const child = spawn(executable, args, { shell: false, windowsHide: false, stdio: 'ignore' });
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { child.kill(); finish(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
    child.once('error', error => finish(new ComputerUseError(error.code === 'ENOENT' ? 'app_unavailable' : 'computer_tool_error', error.message)));
    child.once('spawn', () => finish(null, { pid: Number(child.pid) || null }));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { child.kill(); finish(new ComputerUseError('timeout', 'Launching the approved application timed out.')); }, timeoutMs);
  });
}

class WinAppComputerUseAdapter {
  constructor({ executable = (() => {
    const alias = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winapp.exe') : '';
    return alias && fs.existsSync(alias) ? alias : 'winapp';
  })(), runner = defaultRunner, launcher = defaultLaunchRunner, appResolver = resolveLaunchableApp, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.executable = executable;
    this.runner = runner;
    this.launcher = launcher;
    this.appResolver = appResolver;
    this.timeoutMs = timeoutMs;
  }

  async #run(args, options = {}) {
    const result = await this.runner(this.executable, ['ui', ...args, '--json'], { signal: options.signal, timeoutMs: this.timeoutMs });
    if (!result || result.code !== 0) {
      throw new ComputerUseError('computer_tool_failed', String(result?.stderr || result?.stdout || 'Computer tool failed.').trim().slice(0, 500));
    }
    try { return JSON.parse(result.stdout); }
    catch { throw new ComputerUseError('malformed_response', 'Computer tool returned malformed JSON.'); }
  }

  async listWindows({ signal } = {}) {
    const rows = await this.#run(['list-windows'], { signal });
    if (!Array.isArray(rows)) throw new ComputerUseError('malformed_response', 'Window list must be an array.');
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'list_windows',
      windows: rows.map(sanitizeWindow).filter(window => window.hwnd > 0 && !isSensitiveWindow(window)).slice(0, 100),
    };
  }

  async launchApp({ appId, signal } = {}) {
    const target = this.appResolver(appId);
    const launched = await this.launcher(target.executable, { args: [], signal, timeoutMs: this.timeoutMs });
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'launch_app',
      app_id: target.app_id,
      process_name: target.process_name,
      launched: true,
      process_id: Number(launched?.pid) || null,
    };
  }

  async #waitForChromeYoutube(signal, { titleMustNotMatch = null } = {}) {
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    while (Date.now() < deadline) {
      const windows = (await this.listWindows({ signal })).windows;
      const match = windows.find(window => String(window.process_name).toLowerCase() === 'chrome'
        && /youtube/iu.test(window.title)
        && (!titleMustNotMatch || !titleMustNotMatch.test(window.title)));
      if (match) return match;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new ComputerUseError('verification_failed', 'Chrome opened, but the YouTube page was not verified.');
  }

  async #selectYoutubeResult(hwnd, query, signal) {
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    while (Date.now() < deadline) {
      let inspected;
      try {
        inspected = await this.inspect({ hwnd, selector: 'RootWebArea', depth: 8, signal });
      } catch (error) {
        if (isStaleElementError(error)) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
        throw error;
      }
      const candidates = [];
      const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (value.type === 'Hyperlink' && typeof value.name === 'string' && typeof value.selector === 'string'
          && /^https:\/\/www\.youtube\.com\/watch\?v=/iu.test(String(value.value || ''))
          && value.isOffscreen !== true) candidates.push(value);
        Object.values(value).forEach(visit);
      };
      visit(inspected.tree);
      const selected = candidates[0];
      if (selected) {
        try {
          await this.#run(['invoke', selected.selector, '--window', String(validHwnd(hwnd))], { signal });
          return { query, name: selected.name.slice(0, 300), selector: selected.selector };
        } catch (error) {
          // UIA references can expire between inspect and invoke on dynamic web
          // pages. Re-inspect once through this bounded loop; never reuse the
          // stale selector or treat the failed invocation as success.
          if (!isStaleElementError(error)) throw error;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new ComputerUseError('youtube_result_not_found', `No playable YouTube result was found for “${query}”.`);
  }

  async #youtubePlaybackControl(hwnd, signal) {
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    while (Date.now() < deadline) {
      let inspected;
      try {
        inspected = await this.inspect({ hwnd, selector: 'RootWebArea', depth: 8, signal });
      } catch (error) {
        if (isStaleElementError(error)) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
        throw error;
      }
      const serializedTree = JSON.stringify(inspected.tree);
      if (/(?:video unavailable|this video is unavailable|live streaming unavailable|\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e19\u0e35\u0e49\u0e44\u0e21\u0e48\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19|\u0e01\u0e32\u0e23\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e25\u0e1f\u0e4c\u0e2a\u0e14\u0e44\u0e21\u0e48\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19)/iu.test(serializedTree)) {
        throw new ComputerUseError('youtube_media_unavailable', 'The approved YouTube music page is unavailable.');
      }
      const candidates = [];
      const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (typeof value.name === 'string' && typeof value.selector === 'string') candidates.push(value);
        Object.values(value).forEach(visit);
      };
      visit(inspected.tree);
      const pause = candidates.find(element => /^(?:pause|หยุดชั่วคราว)(?:\s|\(|$)/iu.test(element.name));
      if (pause) return { selector: pause.selector, state: 'playing' };
      const play = candidates.find(element => /^(?:play|เล่น)(?:\s|\(|$)/iu.test(element.name));
      if (play) {
        try {
          await this.#run(['invoke', play.selector, '--window', String(validHwnd(hwnd))], { signal });
        } catch (error) {
          if (!isStaleElementError(error)) throw error;
        }
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 350);
        const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new ComputerUseError('verification_failed', 'YouTube opened, but active music playback was not verified.');
  }

  async playYoutubeMusic({ query, signal } = {}) {
    const requestedQuery = boundedText(query, 'query', 160);
    const target = this.appResolver('chrome');
    const searchUrl = `${YOUTUBE_SEARCH_BASE_URL}${encodeURIComponent(requestedQuery)}`;
    const launched = await this.launcher(target.executable, {
      args: ['--profile-directory=Default', '--new-window', searchUrl],
      signal,
      timeoutMs: this.timeoutMs,
    });
    const window = await this.#waitForChromeYoutube(signal);
    const selectedResult = await this.#selectYoutubeResult(window.hwnd, requestedQuery, signal);
    const playback = await this.#youtubePlaybackControl(window.hwnd, signal);
    const finalWindow = (await this.listWindows({ signal })).windows.find(candidate => candidate.hwnd === window.hwnd) || window;
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'play_youtube_music',
      app_id: 'chrome',
      profile: 'Default',
      process_id: Number(launched?.pid) || window.process_id || null,
      hwnd: window.hwnd,
      page_title: finalWindow.title,
      query: requestedQuery,
      selected_result: selectedResult.name,
      playback: playback.state,
      verified: true,
    };
  }

  async #assertTarget(hwnd, signal) {
    const windows = (await this.listWindows({ signal })).windows;
    const target = windows.find(window => window.hwnd === validHwnd(hwnd));
    if (!target) throw new ComputerUseError('target_not_allowed', 'Target window is unknown, closed, or sensitive.');
    return target;
  }

  async #verify({ hwnd, selector, state, value, signal }) {
    const verificationState = String(state || 'present');
    if (!['present', 'gone', 'value'].includes(verificationState)) {
      throw new ComputerUseError('invalid_arguments', 'verification state must be present, gone, or value.');
    }
    const verificationSelector = boundedText(selector, 'verification selector', 300);
    const args = ['wait-for', verificationSelector, '--window', String(validHwnd(hwnd)), '--timeout', '5000'];
    if (verificationState === 'gone') args.push('--gone');
    if (verificationState === 'value') args.push('--value', boundedText(value, 'verification value', 4_000));
    const evidence = await this.#run(args, { signal });
    const expectedFound = verificationState !== 'gone';
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      || evidence.timedOut === true || evidence.found !== expectedFound) {
      throw new ComputerUseError('verification_failed', 'Computer action completed but the requested post-action state was not verified.');
    }
    return {
      selector: verificationSelector,
      state: verificationState,
      found: evidence.found,
      elapsed_ms: Number(evidence.elapsedMs) || 0,
    };
  }

  async verifyState({ hwnd, selector, state = 'present', value, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    return this.#verify({ hwnd: target.hwnd, selector, state, value, signal });
  }

  async inspect({ hwnd, selector, depth = 5, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const boundedDepth = Number(depth);
    if (!Number.isInteger(boundedDepth) || boundedDepth < 1 || boundedDepth > 8) throw new ComputerUseError('invalid_arguments', 'depth must be between 1 and 8.');
    const args = ['inspect'];
    if (selector) args.push(boundedText(selector, 'selector', 300));
    args.push('--window', String(target.hwnd), '--depth', String(boundedDepth), '--interactive');
    const tree = await this.#run(args, { signal });
    const serialized = JSON.stringify(tree);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES) throw new ComputerUseError('output_limit', 'UI tree exceeded its safety limit.');
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'inspect', target, tree };
  }

  async invoke({ hwnd, selector, verifySelector, verifyState, verifyValue, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    if (SENSITIVE_ELEMENT.test(JSON.stringify(before.tree))) throw new ComputerUseError('sensitive_target', 'Password or credential fields cannot be controlled.');
    await this.#run(['invoke', element, '--window', String(target.hwnd)], { signal });
    const verification = await this.#verify({ hwnd: target.hwnd, selector: verifySelector, state: verifyState, value: verifyValue, signal });
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'invoke', target, selector: element, verified: true, verification };
  }

  async setValue({ hwnd, selector, value, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const text = boundedText(value, 'value', 4_000);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    if (SENSITIVE_ELEMENT.test(JSON.stringify(before.tree))) throw new ComputerUseError('sensitive_target', 'Password or credential fields cannot be controlled.');
    await this.#run(['set-value', element, text, '--window', String(target.hwnd)], { signal });
    const verification = await this.#verify({ hwnd: target.hwnd, selector: element, state: 'value', value: text, signal });
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'set_value', target, selector: element, value_length: text.length, verified: true, verification };
  }
}

module.exports = { COMPUTER_RESULT_SCHEMA_VERSION, ComputerUseError, WinAppComputerUseAdapter, defaultRunner, defaultLaunchRunner, isSensitiveWindow, resolveLaunchableApp, YOUTUBE_SEARCH_BASE_URL };
