const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const COMPUTER_RESULT_SCHEMA_VERSION = 'solat.computer-result.v1';
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const YOUTUBE_SEARCH_BASE_URL = 'https://www.youtube.com/results?search_query=';
const GOOGLE_SEARCH_BASE_URL = 'https://www.google.com/search?q=';
const SAFE_WEBSITES = Object.freeze({
  google: 'https://www.google.com/',
  google_classroom: 'https://classroom.google.com/',
  instagram: 'https://www.instagram.com/',
  youtube: 'https://www.youtube.com/',
  roblox: 'https://www.roblox.com/',
});
const WEBSITE_TITLE_HINTS = Object.freeze({
  google: /\bgoogle\b/iu,
  google_classroom: /\b(?:google\s+classroom|classroom)\b/iu,
  instagram: /\binstagram\b/iu,
  youtube: /\byoutube\b/iu,
  roblox: /\broblox\b/iu,
});
const DENIED_PROCESSES = new Set(['lockapp', 'logonui', 'credentialuibroker', 'taskmgr', 'regedit']);
const SENSITIVE_TITLE_THAI = /(?:บัตร|รหัสผ่าน|ธนาคาร|ชำระเงิน)/iu;
// One-time codes, PIN and card verification values are credential inputs at
// the execution boundary too; word boundaries keep "pin"/"otp" from matching
// unrelated words such as "pinterest" in serialized UI trees.
const SENSITIVE_ELEMENT = /(?:password|passcode|credential|isPassword\s*[=:]\s*true|\botp\b|\b2fa\b|\bpin\b|\bcvv\b|security\s*code|รหัสผ่าน|เลขบัตร|บัญชีธนาคาร|โอทีพี)/iu;
const SENSITIVE_TITLE = /(?:password|passcode|credential|sign[ -]?in|login|bank|wallet|payment|บัตร|รหัสผ่าน|ธนาคาร)/iu;
// Structural sensitivity must not depend on human-readable keywords alone: a
// masked field can carry a benign name ("Field 7") while its UIA property or
// control type still proves it is a secret input. The execution boundary
// therefore walks parsed nodes in addition to the lexical check.
const SENSITIVE_PASSWORD_PROPERTIES = Object.freeze(['isPassword', 'IsPassword', 'is_password']);
const SENSITIVE_CONTROL_TYPE = /(?:password|credential|secure)/iu;
const SAFE_APP_HOTKEYS = new Set(['ctrl+a', 'ctrl+b', 'ctrl+f', 'ctrl+i', 'ctrl+l', 'ctrl+shift+x']);
const WINAPP_HOTKEY_TOKENS = Object.freeze({
  'ctrl+a': 'ctrl+vk=0x41',
  'ctrl+b': 'ctrl+vk=0x42',
  'ctrl+f': 'ctrl+vk=0x46',
  'ctrl+i': 'ctrl+vk=0x49',
  'ctrl+l': 'ctrl+vk=0x4C',
  'ctrl+shift+x': 'ctrl+shift+vk=0x58',
});

function findUiaNode(tree, selector) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findUiaNode(item, selector);
      if (found) return found;
    }
    return null;
  }
  if (String(tree.selector || '') === selector) return tree;
  for (const value of Object.values(tree)) {
    if (!value || typeof value !== 'object') continue;
    const found = findUiaNode(value, selector);
    if (found) return found;
  }
  return null;
}

function isSensitiveUiaNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  for (const key of SENSITIVE_PASSWORD_PROPERTIES) {
    if (node[key] === true || node[key] === 'true') return true;
  }
  const controlType = String(node.type || node.controlType || node.control_type || node.role || '');
  const className = String(node.class || node.className || node.class_name || '');
  return SENSITIVE_CONTROL_TYPE.test(controlType) || SENSITIVE_CONTROL_TYPE.test(className);
}

function containsSensitiveUiaNode(tree) {
  if (!tree || typeof tree !== 'object') return false;
  if (Array.isArray(tree)) return tree.some(item => containsSensitiveUiaNode(item));
  if (isSensitiveUiaNode(tree)) return true;
  return Object.values(tree).some(value => value && typeof value === 'object' && containsSensitiveUiaNode(value));
}

function assertNotSensitiveTree(tree) {
  if (SENSITIVE_ELEMENT.test(JSON.stringify(tree)) || containsSensitiveUiaNode(tree)) {
    throw new ComputerUseError('sensitive_target', 'Password or credential fields cannot be controlled.');
  }
}

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
  // Chromium/UIA can replace a media control between inspection and invoke.
  // WinApp reports that replacement as either stale_element or a transient
  // element_not_found. Chrome can also lose foreground between an inspection
  // and its guarded click. All three require a fresh bounded inspection;
  // none is evidence that the action completed.
  return error instanceof ComputerUseError
    && /stale_element|no longer accessible|element_not_found|no element found|could not be re-resolved|moved or was removed|not in the foreground|bring it to the foreground/iu.test(`${error.code || ''} ${error.message || ''}`);
}

function isStaleWindowError(error) {
  return error instanceof ComputerUseError
    && /appnotfoundexception|target_not_allowed|window (?:is )?(?:unknown|closed|not found)|target window closed or changed/iu.test(`${error.code || ''} ${error.message || ''}`);
}

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function normalizeYoutubeText(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function youtubeSearchQuery(value) {
  const query = String(value || '').trim();
  const byMatch = query.match(/^(.+)\s+by\s+(.+)$/iu);
  return (byMatch ? `${byMatch[1]} ${byMatch[2]}` : query).replace(/\s+/gu, ' ').trim();
}

function levenshtein(left, right) {
  const a = String(left || ''); const b = String(right || '');
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let index = 1; index <= a.length; index += 1) {
    let diagonal = row[0]; row[0] = index;
    for (let column = 1; column <= b.length; column += 1) {
      const previous = row[column];
      row[column] = Math.min(row[column] + 1, row[column - 1] + 1, diagonal + (a[index - 1] === b[column - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[b.length];
}

function youtubeResultScore(name, query) {
  const normalizedName = normalizeYoutubeText(name);
  const normalizedQuery = normalizeYoutubeText(youtubeSearchQuery(query));
  if (!normalizedName || !normalizedQuery) return 0;
  if (normalizedName.includes(normalizedQuery)) return 10_000 + normalizedQuery.length;
  // YouTube often renders stylised titles with punctuation between letters
  // (for example "L-L-Lies"), while users type the compact form ("Lllies").
  // Punctuation and spacing are presentation differences, not a new title.
  const compactName = normalizedName.replace(/\s+/gu, '');
  const compactQuery = normalizedQuery.replace(/\s+/gu, '');
  if (compactQuery.length >= 3 && compactName.includes(compactQuery)) {
    return 9_000 + compactQuery.length;
  }
  const queryTokens = [...new Set(normalizedQuery.split(/\s+/u).filter(token => token.length > 1))];
  const nameTokens = new Set(normalizedName.split(/\s+/u));
  const coveredTokens = queryTokens.filter(token => nameTokens.has(token)
    || [...nameTokens].some(nameToken => token.length >= 4 && levenshtein(nameToken, token) <= 1));
  if (queryTokens.length >= 2 && coveredTokens.length === queryTokens.length) {
    return 8_000 + coveredTokens.reduce((total, token) => total + token.length, 0);
  }
  const allowedDistance = Math.max(1, Math.floor(normalizedQuery.length * 0.2));
  const nearest = normalizedName.split(/\s+/u).reduce((best, word) => Math.min(best, levenshtein(word, normalizedQuery)), Number.POSITIVE_INFINITY);
  return nearest <= allowedDistance ? 1_000 - nearest : 0;
}

function isYoutubeSearchResultsTitle(title, query) {
  const normalizedQuery = normalizeYoutubeText(youtubeSearchQuery(query));
  const normalizedTitle = normalizeYoutubeText(title)
    .replace(/\s+google chrome$/u, '')
    .replace(/\s+youtube$/u, '')
    .replace(/^\d+\s+/u, '')
    .trim();
  return Boolean(normalizedQuery) && normalizedTitle === normalizedQuery;
}

function isYoutubePlaybackControl(value, state) {
  if (!value || typeof value !== 'object' || value.isInvokable === false
    || value.isEnabled === false || value.isOffscreen === true) return false;
  const type = String(value.type || value.controlType || value.control_type || value.role || '').trim();
  // A YouTube document title can begin with “Play …”. It is display-only and
  // must never be mistaken for the media control. Older WinApp fixtures omit
  // type, so an absent type remains compatible while an explicit type must be
  // a button.
  if (type && !/(?:^|\b)button(?:$|\b)/iu.test(type)) return false;
  const name = String(value.name || '');
  if (state === 'pause') return /^(?:pause|หยุดชั่วคราว)(?:\s|\(|$)/iu.test(name);
  return /^(?:play|replay|เล่น(?:ซ้ำ)?)(?:\s|\(|$)/iu.test(name);
}

function isYoutubePlayerBlocked(tree) {
  let blocked = false;
  const visit = value => {
    if (blocked || !value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    const identity = `${value.automationId || ''} ${value.selector || ''}`;
    const className = String(value.className || '');
    if (/movie_player/iu.test(identity)
      && /(?:^|\s)(?:unstarted|paused)-mode(?:\s|$)/iu.test(className)) blocked = true;
    Object.values(value).forEach(visit);
  };
  visit(tree);
  return blocked;
}

function isYoutubePlayerPlaying(tree) {
  let playing = false;
  const visit = value => {
    if (playing || !value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    const identity = `${value.automationId || ''} ${value.selector || ''}`;
    const className = String(value.className || '');
    if (/movie_player/iu.test(identity)
      && /(?:^|\s)playing-mode(?:\s|$)/iu.test(className)
      && !/(?:^|\s)(?:unstarted|paused)-mode(?:\s|$)/iu.test(className)) playing = true;
    Object.values(value).forEach(visit);
  };
  visit(tree);
  return playing;
}

function isYoutubeResultLink(value) {
  const type = String(value?.type || value?.controlType || value?.control_type || value?.role || '').trim();
  const url = String(value?.value || value?.url || value?.href || '').trim();
  // Chrome UIA frequently exposes a result as a semantic Hyperlink without
  // its href.  A matching, visible link is sufficient; a non-link card or
  // arbitrary button is never promoted into a click target.
  const youtubeWatchUrl = /(?:^https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=/iu.test(url);
  if (youtubeWatchUrl) return true;
  return /(?:^|\b)(?:hyperlink|link)(?:$|\b)/iu.test(type);
}

function isYoutubeResultCandidate(value) {
  if (isYoutubeResultLink(value)) return true;
  const type = String(value?.type || value?.controlType || value?.control_type || value?.role || '').trim();
  const selector = String(value?.selector || '').trim();
  // Some Chromium UIA versions expose video cards as buttons/static nodes
  // with no href. Keep this narrow: only semantic result selectors qualify.
  return /(?:button|static|text)/iu.test(type)
    && /(?:result|video|watch|link|title)/iu.test(selector);
}

function trustedYoutubePlaybackUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLocaleLowerCase();
    if (!['youtube.com', 'www.youtube.com'].includes(hostname)) return null;
    if (url.protocol !== 'https:' || url.pathname !== '/watch' || !url.searchParams.get('v')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function sanitizeWindow(window) {
  return {
    hwnd: Number(window.hwnd),
    process_id: Number(window.processId),
    process_name: String(window.processName || '').slice(0, 120),
    title: String(window.title || '').slice(0, 300),
    width: Number(window.width) || 0,
    height: Number(window.height) || 0,
    is_foreground: typeof window.isForeground === 'boolean' ? window.isForeground : null,
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

// The installed winapp CLI can set element focus but cannot activate a
// backgrounded window, and backgrounded Chromium hides its page tree from
// UIA until the window is foreground. Activation therefore goes through a
// tiny injected OS-level boundary, testable like every other runner here.
function defaultWindowActivator(hwnd, { signal } = {}) {
  const target = Number(hwnd);
  const script = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);' -Name Win32 -Namespace SolatActivate; [SolatActivate.Win32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [SolatActivate.Win32]::SetForegroundWindow([IntPtr]${target}) | Out-Null; [SolatActivate.Win32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)`;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ComputerUseError('cancelled', 'Computer action was cancelled.'));
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let timer;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve({ activated: true, hwnd: target });
    };
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-500); });
    child.once('error', error => finish(new ComputerUseError('activation_failed', error.message)));
    child.once('close', code => finish(code === 0 ? null : new ComputerUseError('activation_failed', `Window activation failed (${code}). ${stderr}`.trim())));
    const abort = () => { child.kill(); finish(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { child.kill(); finish(new ComputerUseError('timeout', 'Window activation timed out.')); }, DEFAULT_TIMEOUT_MS);
  });
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
  })(), runner = defaultRunner, launcher = defaultLaunchRunner, appResolver = resolveLaunchableApp, activator = defaultWindowActivator, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.executable = executable;
    this.runner = runner;
    this.launcher = launcher;
    this.appResolver = appResolver;
    this.activator = activator;
    this.timeoutMs = timeoutMs;
  }

  async #run(args, options = {}) {
    const result = await this.runner(this.executable, ['ui', ...args, '--json'], { signal: options.signal, timeoutMs: this.timeoutMs });
    if (!result || result.code !== 0) {
      const raw = String(result?.stderr || result?.stdout || 'Computer tool failed.').trim();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = String(parsed?.error?.message || parsed?.message || raw);
      } catch { /* A plain-text CLI error remains plain text. */ }
      if (/AppNotFoundException|app(?:lication)?\s+(?:was\s+)?not\s+found|window\s+(?:was\s+)?not\s+found/iu.test(detail)) {
        throw new ComputerUseError('target_not_allowed', 'The target window closed or changed before the computer action could run.');
      }
      throw new ComputerUseError('computer_tool_failed', detail.slice(0, 500));
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
    const before = (await this.listWindows({ signal })).windows;
    const existing = before
      .filter(window => String(window.process_name).toLowerCase() === String(target.process_name).toLowerCase())
      .sort((left, right) => Number(right.is_foreground === true) - Number(left.is_foreground === true))[0];
    if (target.app_id === 'chrome' && existing) {
      if (existing.is_foreground !== true) await this.activator(existing.hwnd, { signal });
      const verified = (await this.listWindows({ signal })).windows.find(window => window.hwnd === existing.hwnd);
      if (!verified) throw new ComputerUseError('verification_failed', 'The existing Chrome window could not be verified after activation.');
      return {
        schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
        status: 'ready', operation: 'launch_app', app_id: target.app_id,
        process_name: target.process_name, launched: true, reused: true,
        process_id: verified.process_id, hwnd: verified.hwnd,
        window_title: verified.title, verified: true,
      };
    }
    const previousHwnds = new Set(before
      .filter(window => String(window.process_name).toLowerCase() === String(target.process_name).toLowerCase())
      .map(window => window.hwnd));
    const previousForegroundHwnds = new Set(before
      .filter(window => String(window.process_name).toLowerCase() === String(target.process_name).toLowerCase()
        && window.is_foreground === true)
      .map(window => window.hwnd));
    const args = target.app_id === 'chrome'
      ? ['--profile-directory=Default', '--new-window', 'about:blank']
      : [];
    const launched = await this.launcher(target.executable, { args, signal, timeoutMs: this.timeoutMs });
    const window = await this.#waitForApplicationWindow(signal, {
      processName: target.process_name,
      processId: Number(launched?.pid) || null,
      previousHwnds,
      previousForegroundHwnds,
    });
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'launch_app',
      app_id: target.app_id,
      process_name: target.process_name,
      launched: true,
      process_id: window.process_id || Number(launched?.pid) || null,
      hwnd: window.hwnd,
      window_title: window.title,
      verified: true,
    };
  }

  async #waitForApplicationWindow(signal, {
    processName,
    processId = null,
    previousHwnds = new Set(),
    previousForegroundHwnds = new Set(),
  } = {}) {
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    const normalizedProcess = String(processName || '').trim().toLowerCase();
    while (Date.now() < deadline) {
      const windows = (await this.listWindows({ signal })).windows;
      const ranked = windows
        .filter(window => String(window.process_name).toLowerCase() === normalizedProcess)
        .map(window => ({
          window,
          score: (previousHwnds.has(window.hwnd) ? 0 : 1_000)
            + (processId && window.process_id === processId ? 100 : 0)
            + (window.is_foreground && !previousForegroundHwnds.has(window.hwnd) ? 10 : 0),
        }))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0]?.window;
      const reusedAndActivated = best?.is_foreground === true && !previousForegroundHwnds.has(best.hwnd);
      if (best && (!previousHwnds.has(best.hwnd) || best.process_id === processId || reusedAndActivated)) {
        return best;
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 250);
        const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new ComputerUseError('verification_failed', 'The approved application launched, but no matching visible window was verified.');
  }

  async #chromeWindowBaseline(signal) {
    const windows = (await this.listWindows({ signal })).windows;
    return new Set(windows
      .filter(window => String(window.process_name).toLowerCase() === 'chrome')
      .map(window => window.hwnd));
  }

  async #waitForChromeWindow(signal, { site = null, previousHwnds = new Set() } = {}) {
    const titleHint = site ? WEBSITE_TITLE_HINTS[site] : null;
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    while (Date.now() < deadline) {
      const windows = (await this.listWindows({ signal })).windows;
      const candidates = windows.filter(window => String(window.process_name).toLowerCase() === 'chrome');
      // A Chrome process alone is not proof that the requested page opened:
      // stale tabs are common.  Require the expected site title once it is
      // observable, then prefer a new HWND and foreground state as tie-breaks.
      const matching = titleHint ? candidates.filter(window => titleHint.test(window.title)) : candidates;
      const ranked = matching.map(window => ({
        window,
        score: (previousHwnds.has(window.hwnd) ? 0 : 100) + (window.is_foreground ? 1 : 0),
      })).sort((left, right) => right.score - left.score);
      if (ranked.length) return ranked[0].window;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 250);
        const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new ComputerUseError('verification_failed', 'Chrome did not open a visible window.');
  }

  async #waitForChromeSearch(signal, { query, previousHwnds = new Set() } = {}) {
    const normalizedQuery = String(query || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    while (Date.now() < deadline) {
      const windows = (await this.listWindows({ signal })).windows;
      const matches = windows.filter(window => {
        if (String(window.process_name).toLowerCase() !== 'chrome') return false;
        const title = String(window.title || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return normalizedQuery && title.includes(normalizedQuery) && /google/iu.test(title);
      });
      const match = matches.sort((left, right) => (previousHwnds.has(left.hwnd) ? 1 : -1) - (previousHwnds.has(right.hwnd) ? 1 : -1))[0];
      if (match) return match;
      await waitWithAbort(250, signal);
    }
    throw new ComputerUseError('verification_failed', 'Chrome opened, but the requested Google results page was not verified.');
  }

  async openWebsite({ site, signal } = {}) {
    const normalizedSite = String(site || '').trim().toLowerCase();
    const url = SAFE_WEBSITES[normalizedSite];
    if (!url) throw new ComputerUseError('website_not_allowed', 'Only an explicitly allowlisted website can be opened.');
    const target = this.appResolver('chrome');
    const previousHwnds = await this.#chromeWindowBaseline(signal);
    const launched = await this.launcher(target.executable, {
      args: previousHwnds.size
        ? ['--profile-directory=Default', url]
        : ['--profile-directory=Default', '--new-window', url],
      signal,
      timeoutMs: this.timeoutMs,
    });
    const window = await this.#waitForChromeWindow(signal, { site: normalizedSite, previousHwnds });
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'open_website',
      site: normalizedSite,
      url,
      app_id: 'chrome',
      // Chrome may hand the requested window to an existing browser process
      // and let the short-lived launcher process exit. Bind authorization to
      // the PID observed for the verified HWND, not the launcher PID.
      process_id: window.process_id || Number(launched?.pid) || null,
      hwnd: window.hwnd,
      window_title: window.title,
      verified: true,
    };
  }

  async searchWeb({ query, signal } = {}) {
    const requestedQuery = boundedText(query, 'query', 300);
    const target = this.appResolver('chrome');
    const previousHwnds = await this.#chromeWindowBaseline(signal);
    const url = `${GOOGLE_SEARCH_BASE_URL}${encodeURIComponent(requestedQuery)}`;
    const launched = await this.launcher(target.executable, {
      args: previousHwnds.size
        ? ['--profile-directory=Default', url]
        : ['--profile-directory=Default', '--new-window', url],
      signal, timeoutMs: this.timeoutMs,
    });
    const window = await this.#waitForChromeSearch(signal, { query: requestedQuery, previousHwnds });
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'search_web',
      query: requestedQuery, url, app_id: 'chrome', process_id: window.process_id || Number(launched?.pid) || null,
      hwnd: window.hwnd, window_title: window.title, verified: true,
    };
  }

  async #waitForChromeYoutube(signal, {
    titleMustNotMatch = null,
    query = '',
    previousHwnds = new Set(),
    excludeSearchResults = false,
    maxWaitMs = Math.max(this.timeoutMs, 15_000),
  } = {}) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const windows = (await this.listWindows({ signal })).windows;
      const matches = windows.filter(window => String(window.process_name).toLowerCase() === 'chrome'
        && /youtube/iu.test(window.title)
        && (!titleMustNotMatch || !titleMustNotMatch.test(window.title))
        && (!excludeSearchResults || !isYoutubeSearchResultsTitle(window.title, query)));
      // More than one YouTube window is normal.  Never blindly reuse the
      // first row from UI Automation: favor the newly foregrounded window and
      // then its title's similarity to the requested track.
      const match = matches.map(window => ({
        window,
        // A foreground stale YouTube tab must not beat the newly opened
        // result page whose title contains the requested track. Foreground
        // is only a tie-breaker after semantic title similarity.
        score: (youtubeResultScore(window.title, query) * 1_000)
          + (previousHwnds.has(window.hwnd) ? 0 : 100)
          + (window.is_foreground ? 1 : 0),
      })).sort((left, right) => right.score - left.score)[0]?.window;
      if (match) return match;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        const abort = () => { clearTimeout(timer); reject(new ComputerUseError('cancelled', 'Computer action was cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new ComputerUseError('verification_failed', 'Chrome opened, but the YouTube page was not verified.');
  }

  async #selectYoutubeResult(hwnd, query, signal, { allowDirectUrl = true } = {}) {
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
        if (isYoutubeResultCandidate(value) && typeof value.name === 'string' && typeof value.selector === 'string'
          && value.isOffscreen !== true) candidates.push(value);
        Object.values(value).forEach(visit);
      };
      visit(inspected.tree);
      // Search pages may place ads, mixes, or recommendations before the
      // requested track. Pick only a title that matches the user's query.
      const selected = candidates
        .map(candidate => ({ candidate, score: youtubeResultScore(candidate.name, query) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score)[0]?.candidate;
      if (selected) {
        const directUrl = trustedYoutubePlaybackUrl(selected.value ?? selected.url ?? selected.href);
        if (directUrl && allowDirectUrl) {
          // The result already belongs to the verified search tab. Clicking
          // it keeps the workflow in that tab; launching the extracted URL
          // through chrome.exe creates an unnecessary second tab.
          try {
            await this.#run(['click', selected.selector, '--window', String(validHwnd(hwnd))], { signal });
            return { query, name: selected.name.slice(0, 300), selector: selected.selector, requires_reacquire: false };
          } catch (error) {
            if (!isStaleElementError(error)) throw error;
          }
        }
        try {
          await this.#run(['invoke', selected.selector, '--window', String(validHwnd(hwnd))], { signal });

          // Chromium can report a successful InvokePattern without navigating
          // dynamic YouTube result cards. Verify that the page actually left
          // the search results before trusting the invocation. If it did not,
          // refresh the semantic selector and use one guarded click.
          await waitWithAbort(500, signal);
          const currentWindow = (await this.listWindows({ signal })).windows.find(candidate => candidate.hwnd === hwnd);
          if (currentWindow && !isYoutubeSearchResultsTitle(currentWindow.title, query)
            && youtubeResultScore(currentWindow.title, query) > 0) {
            return { query, name: selected.name.slice(0, 300), selector: selected.selector, requires_reacquire: false };
          }

          const afterInvoke = await this.inspect({ hwnd, selector: 'RootWebArea', depth: 8, signal });
          const afterCandidates = [];
          const visitAfter = value => {
            if (Array.isArray(value)) return value.forEach(visitAfter);
            if (!value || typeof value !== 'object') return;
            if (typeof value.name === 'string' && typeof value.selector === 'string') afterCandidates.push(value);
            Object.values(value).forEach(visitAfter);
          };
          visitAfter(afterInvoke.tree);
          if (afterCandidates.some(candidate => isYoutubePlaybackControl(candidate, 'pause') || isYoutubePlaybackControl(candidate, 'play'))) {
            return { query, name: selected.name.slice(0, 300), selector: selected.selector, requires_reacquire: false };
          }
          const freshSelected = afterCandidates
            .filter(candidate => isYoutubeResultCandidate(candidate) && candidate.isOffscreen !== true)
            .map(candidate => ({ candidate, score: youtubeResultScore(candidate.name, query) }))
            .filter(item => item.score > 0)
            .sort((left, right) => right.score - left.score)[0]?.candidate;
          if (freshSelected) {
            await this.#run(['click', freshSelected.selector, '--window', String(validHwnd(hwnd))], { signal });
            // Chrome normally navigates the existing HWND. Playback
            // verification will reacquire only if that HWND actually expires.
            return { query, name: freshSelected.name.slice(0, 300), selector: freshSelected.selector, requires_reacquire: false };
          }
        } catch (error) {
          // UIA references can expire between inspect and invoke on dynamic web
          // pages. Re-inspect once through this bounded loop; never reuse the
          // stale selector or treat the failed invocation as success.
          if (!isStaleElementError(error)) throw error;
        }
      }
      await waitWithAbort(300, signal);
    }
    throw new ComputerUseError('youtube_result_not_found', `No playable YouTube result was found for “${query}”.`);
  }

  async #youtubePlaybackControl(hwnd, signal) {
    const deadline = Date.now() + Math.max(this.timeoutMs, 15_000);
    const startedAt = Date.now();
    let attemptedBlockedPlayerResume = false;
    while (Date.now() < deadline) {
      let inspected;
      try {
        inspected = await this.inspect({ hwnd, selector: 'movie_player', depth: 3, signal });
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
      const pause = candidates.find(element => isYoutubePlaybackControl(element, 'pause'));
      const play = candidates.find(element => isYoutubePlaybackControl(element, 'play'));
      const playerBlocked = isYoutubePlayerBlocked(inspected.tree);
      const playerPlaying = isYoutubePlayerPlaying(inspected.tree);
      console.info('[solat:youtube-playback]', {
        hwnd, elapsed_ms: Date.now() - startedAt, pause: Boolean(pause),
        playing_mode: playerPlaying,
        blocked_mode: playerBlocked,
        play: Boolean(play),
      });
      // YouTube can expose a stale bottom-control "Pause" while the large
      // Play overlay and `unstarted-mode` are still active. That contradictory
      // tree is paused, not verified playback.
      if (!playerBlocked && !play && (pause || playerPlaying)) {
        // A single Pause label can be a transient autoplay frame. Require
        // three fresh player observations across a bounded stability window.
        // YouTube hides controls while playing, so the player's semantic
        // playing-mode is authoritative even when the Pause button vanishes.
        let stablePlayback = true;
        for (let sample = 0; sample < 3; sample += 1) {
          await waitWithAbort(1_000, signal);
          let confirmation;
          try {
            confirmation = await this.inspect({ hwnd, selector: 'movie_player', depth: 3, signal });
          } catch (error) {
            if (isStaleElementError(error)) { stablePlayback = false; break; }
            throw error;
          }
          const confirmationCandidates = [];
          const visitConfirmation = value => {
            if (Array.isArray(value)) return value.forEach(visitConfirmation);
            if (!value || typeof value !== 'object') return;
            if (typeof value.name === 'string' && typeof value.selector === 'string') confirmationCandidates.push(value);
            Object.values(value).forEach(visitConfirmation);
          };
          visitConfirmation(confirmation.tree);
          const confirmationPause = confirmationCandidates.some(element => isYoutubePlaybackControl(element, 'pause'));
          const confirmationPlay = confirmationCandidates.some(element => isYoutubePlaybackControl(element, 'play'));
          if (isYoutubePlayerBlocked(confirmation.tree) || confirmationPlay
            || (!confirmationPause && !isYoutubePlayerPlaying(confirmation.tree))) {
            stablePlayback = false;
            break;
          }
        }
        if (stablePlayback) {
          console.info('[solat:youtube-playback]', { hwnd, elapsed_ms: Date.now() - startedAt, verified: true, samples: 4 });
          return { selector: pause?.selector || 'movie_player', state: 'playing', stable_for_ms: 3_000, samples: 4 };
        }
      }
      if (play) {
        console.info('[solat:youtube-playback]', { hwnd, elapsed_ms: Date.now() - startedAt, clicking_play: true });
        try {
          // Chromium advertises InvokePattern for YouTube media controls but
          // can acknowledge it without a persistent playback change. A
          // bounded semantic click is the actual user-equivalent action.
          await this.#run(['click', play.selector, '--window', String(validHwnd(hwnd))], { signal });
        } catch (error) {
          if (!isStaleElementError(error)) throw error;
        }
      } else if (playerBlocked && pause && !attemptedBlockedPlayerResume) {
        // Chromium can expose a stale Pause control while omitting the large
        // Play overlay from UIA. A single click on the already-inspected player
        // is the bounded equivalent of pressing that overlay; verification
        // below must still prove four stable playing observations.
        attemptedBlockedPlayerResume = true;
        console.info('[solat:youtube-playback]', { hwnd, elapsed_ms: Date.now() - startedAt, clicking_blocked_player: true });
        try {
          await this.#run(['click', 'movie_player', '--window', String(validHwnd(hwnd))], { signal });
        } catch (error) {
          if (!isStaleElementError(error)) throw error;
        }
      }
      await waitWithAbort(350, signal);
    }
    throw new ComputerUseError('verification_failed', 'YouTube opened, but active music playback was not verified.');
  }

  async playYoutubeMusic({ query, signal } = {}) {
    const requestedQuery = boundedText(query, 'query', 160);
    const searchQuery = youtubeSearchQuery(requestedQuery);
    const target = this.appResolver('chrome');
    const searchUrl = `${YOUTUBE_SEARCH_BASE_URL}${encodeURIComponent(searchQuery)}`;
    const previousHwnds = await this.#chromeWindowBaseline(signal);
    const launched = await this.launcher(target.executable, {
      args: previousHwnds.size
        ? ['--profile-directory=Default', searchUrl]
        : ['--profile-directory=Default', '--new-window', searchUrl],
      signal,
      timeoutMs: this.timeoutMs,
    });
    let window = await this.#waitForChromeYoutube(signal, { query: searchQuery, previousHwnds });
    let selectedResult;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        selectedResult = await this.#selectYoutubeResult(window.hwnd, searchQuery, signal);
        break;
      } catch (error) {
        const retryableSelection = isStaleElementError(error) || isStaleWindowError(error) || error?.code === 'timeout';
        if (attempt > 0 || !retryableSelection) throw error;
        window = await this.#waitForChromeYoutube(signal, { query: searchQuery, previousHwnds });
      }
    }
    console.info('[solat:youtube-playback]', {
      stage: 'result_selected', direct_url: false,
      requires_reacquire: Boolean(selectedResult?.requires_reacquire),
    });
    if (selectedResult?.requires_reacquire) {
      try {
        window = await this.#waitForChromeYoutube(signal, {
          query: searchQuery,
          previousHwnds,
          excludeSearchResults: true,
          maxWaitMs: Math.max(this.timeoutMs, 15_000),
        });
      } catch (error) {
        throw error;
      }
      console.info('[solat:youtube-playback]', { stage: 'playback_window', hwnd: window.hwnd, title: window.title });
    }
    let playback;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        playback = await this.#youtubePlaybackControl(window.hwnd, signal);
        break;
      } catch (error) {
        const retryablePlayback = isStaleElementError(error) || isStaleWindowError(error)
          || error?.code === 'verification_failed' || error?.code === 'timeout';
        if (attempt > 0 || !retryablePlayback) throw error;
        window = await this.#waitForChromeYoutube(signal, { query: searchQuery, previousHwnds });
      }
    }
    const finalWindow = (await this.listWindows({ signal })).windows.find(candidate => candidate.hwnd === window.hwnd) || window;
    return {
      schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
      status: 'ready',
      operation: 'play_youtube_music',
      app_id: 'chrome',
      profile: 'Default',
      process_id: window.process_id || Number(launched?.pid) || null,
      hwnd: window.hwnd,
      page_title: finalWindow.title,
      query: requestedQuery,
      search_query: searchQuery,
      selected_result: selectedResult.name,
      playback: playback.state,
      playback_stable_for_ms: playback.stable_for_ms || 0,
      playback_samples: playback.samples || 0,
      verified: true,
    };
  }

  async #assertTarget(hwnd, signal) {
    const windows = (await this.listWindows({ signal })).windows;
    const target = windows.find(window => window.hwnd === validHwnd(hwnd));
    if (!target) throw new ComputerUseError('target_not_allowed', 'Target window is unknown, closed, or sensitive.');
    return target;
  }

  async assertTarget({ hwnd, signal } = {}) {
    return this.#assertTarget(hwnd, signal);
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

  async inspect({ hwnd, selector, depth = 5, interactiveOnly = true, signal } = {}) {
    let target = await this.#assertTarget(hwnd, signal);
    // Chromium may expose only its caption controls while the window is in
    // the background. Bring the already allowlisted target to the foreground
    // before taking the semantic snapshot, then re-bind its identity.
    if (target.is_foreground === false) {
      await this.activator(validHwnd(target.hwnd), { signal });
      target = await this.#assertTarget(target.hwnd, signal);
    }
    const boundedDepth = Number(depth);
    if (!Number.isInteger(boundedDepth) || boundedDepth < 1 || boundedDepth > 8) throw new ComputerUseError('invalid_arguments', 'depth must be between 1 and 8.');
    const args = ['inspect'];
    if (selector) args.push(boundedText(selector, 'selector', 300));
    args.push('--window', String(target.hwnd), '--depth', String(boundedDepth));
    // A selector-bounded inspection and an explicitly requested semantic
    // snapshot must include non-invokable controls such as Notepad's editor.
    // Model-planned full-window reads remain interactive-only by default.
    if (!selector && interactiveOnly !== false) args.push('--interactive');
    const tree = await this.#run(args, { signal });
    const serialized = JSON.stringify(tree);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES) throw new ComputerUseError('output_limit', 'UI tree exceeded its safety limit.');
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'inspect', target, tree };
  }

  async invoke({ hwnd, selector, verifySelector, verifyState, verifyValue, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    assertNotSensitiveTree(before.tree);
    try {
      await this.#run(['invoke', element, '--window', String(target.hwnd)], { signal });
    } catch (error) {
      // Some Chromium controls (e.g. the search ComboBox) expose no invoke
      // pattern; a bounded mouse click at the same observed element is the
      // equivalent activation.
      if (!(error instanceof ComputerUseError) || !/does not support any invoke pattern|cannot be activated/iu.test(error.message)) throw error;
      await this.#run(['click', element, '--window', String(target.hwnd)], { signal });
    }
    const verification = await this.#verify({ hwnd: target.hwnd, selector: verifySelector, state: verifyState, value: verifyValue, signal });
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'invoke', target, selector: element, verified: true, verification };
  }

  async setValue({ hwnd, selector, value, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const text = boundedText(value, 'value', 4_000);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    assertNotSensitiveTree(before.tree);
    await this.#run(['set-value', element, text, '--window', String(target.hwnd)], { signal });
    const verification = await this.#verify({ hwnd: target.hwnd, selector: element, state: 'value', value: text, signal });
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'set_value', target, selector: element, value_length: text.length, verified: true, verification };
  }

  async pressEnter({ hwnd, selector, verifyTitleContains, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const expectedTitle = boundedText(verifyTitleContains, 'expected title', 200).toLocaleLowerCase();
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    assertNotSensitiveTree(before.tree);
    await this.#run(['send-keys', 'enter', '--window', String(target.hwnd), '--target', element], { signal });
    const deadline = Date.now() + 5_000;
    do {
      const current = (await this.listWindows({ signal })).windows.find(window => window.hwnd === target.hwnd);
      if (current && current.title.toLocaleLowerCase().includes(expectedTitle)) {
        return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'press_enter', target: current, selector: element, key: 'enter', verified: true, verification: { title_contains: verifyTitleContains } };
      }
      await waitWithAbort(250, signal);
    } while (Date.now() < deadline);
    throw new ComputerUseError('verification_failed', 'Enter was pressed but the expected window title was not verified.');
  }

  async pressHotkey({ hwnd, selector, chord, verifySelector, verifyProperty, verifyValue, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const hotkey = boundedText(chord, 'hotkey', 40).toLocaleLowerCase();
    if (!SAFE_APP_HOTKEYS.has(hotkey)) {
      throw new ComputerUseError('hotkey_not_allowed', 'Only bounded application-local hotkeys are allowed.');
    }
    const verificationSelector = boundedText(verifySelector, 'verification selector', 300);
    const property = boundedText(verifyProperty, 'verification property', 40);
    if (!['toggle_state', 'expand_state', 'value', 'present'].includes(property)) {
      throw new ComputerUseError('invalid_arguments', 'verification property must be toggle_state, expand_state, value, or present.');
    }
    const expected = property === 'present' ? 'true' : boundedText(verifyValue, 'verification value', 300);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    assertNotSensitiveTree(before.tree);
    await this.#run(['send-keys', WINAPP_HOTKEY_TOKENS[hotkey], '--window', String(target.hwnd), '--target', element, '--via', 'send-input'], { signal });
    const deadline = Date.now() + 5_000;
    do {
      const snapshot = await this.inspect({ hwnd: target.hwnd, selector: verificationSelector, depth: 2, signal });
      const node = findUiaNode(snapshot.tree, verificationSelector);
      const actual = property === 'present' ? (node ? 'true' : 'false')
        : String(node?.[property === 'toggle_state' ? 'toggleState' : property === 'expand_state' ? 'expandState' : 'value'] ?? '');
      if (node && actual.toLocaleLowerCase() === expected.toLocaleLowerCase()) {
        return {
          schema_version: COMPUTER_RESULT_SCHEMA_VERSION,
          status: 'ready',
          operation: 'press_hotkey',
          target,
          selector: element,
          hotkey,
          verified: true,
          verification: { selector: verificationSelector, property, expected, actual },
        };
      }
      await waitWithAbort(200, signal);
    } while (Date.now() < deadline);
    throw new ComputerUseError('verification_failed', 'Hotkey was pressed but the expected application state was not verified.');
  }

  async scrollIntoView({ hwnd, selector, signal } = {}) {
    const target = await this.#assertTarget(hwnd, signal);
    const element = boundedText(selector, 'selector', 300);
    const before = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    assertNotSensitiveTree(before.tree);
    await this.#run(['scroll-into-view', element, '--window', String(target.hwnd)], { signal });
    const after = await this.inspect({ hwnd: target.hwnd, selector: element, depth: 2, signal });
    if (!after?.tree) throw new ComputerUseError('verification_failed', 'The target was not visible after scrolling.');
    return { schema_version: COMPUTER_RESULT_SCHEMA_VERSION, status: 'ready', operation: 'scroll_into_view', target, selector: element, verified: true, tree: after.tree };
  }
}

module.exports = { COMPUTER_RESULT_SCHEMA_VERSION, ComputerUseError, SAFE_WEBSITES, WinAppComputerUseAdapter, defaultRunner, defaultLaunchRunner, defaultWindowActivator, isSensitiveWindow, isSensitiveUiaNode, containsSensitiveUiaNode, resolveLaunchableApp, GOOGLE_SEARCH_BASE_URL, YOUTUBE_SEARCH_BASE_URL, normalizeYoutubeText, youtubeSearchQuery, youtubeResultScore };
