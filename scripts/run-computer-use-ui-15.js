#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WinAppComputerUseAdapter } = require('../src/core/computer-use-adapter');

const ROOT = path.resolve(__dirname, '..');
const CASES_PATH = path.join(__dirname, 'computer-use-ui-15-cases.json');
const FORBIDDEN_COMMAND = /(?:\b(?:delete|remove|upload|purchase|checkout|email|post|send\s+(?:a\s+)?message|transfer\s+money)\b|ลบ|อัปโหลด|ซื้อ|ชำระเงิน|ส่งอีเมล|ส่งข้อความ|โพสต์|โอนเงิน)/iu;
const UNSAFE_APPROVAL = /(?:filesystem_(?:delete|update|create)|\b(?:delete|remove|upload|purchase|checkout|send message|transfer money)\b|ลบ|อัปโหลด|ชำระเงิน|ส่งข้อความ|โอนเงิน)/iu;

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback;
}

function loadCases() {
  const parsed = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8').replace(/^\uFEFF/u, ''));
  if (parsed.schema_version !== 'solat.computer-use-ui-suite.v1' || !Array.isArray(parsed.cases) || parsed.cases.length !== 15) {
    throw new Error('The Computer Use UI fixture must contain exactly 15 versioned cases.');
  }
  const ids = new Set();
  for (const item of parsed.cases) {
    if (!item.id || ids.has(item.id) || !String(item.command || '').trim()) throw new Error('Every case needs a unique id and a command.');
    if (FORBIDDEN_COMMAND.test(item.command)) throw new Error(`Unsafe command rejected in ${item.id}.`);
    ids.add(item.id);
  }
  return parsed.cases;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function reportPath() {
  const requested = argument('--output');
  return requested ? path.resolve(ROOT, requested) : path.join(ROOT, 'reports', `computer-use-ui-15-${stamp()}.json`);
}

function writeReport(destination, report) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function stopSpawnedElectron(child) {
  if (!child) return;
  child.stdout?.removeAllListeners('data');
  child.stderr?.removeAllListeners('data');
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.exitCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill();
  await Promise.race([closed, sleep(3_000)]);
}

async function removeTemporaryProfile(profile) {
  await Promise.race([
    fs.promises.rm(profile, { recursive: true, force: true }).catch(() => {}),
    sleep(3_000),
  ]);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    if (typeof WebSocket !== 'function') throw new Error('This runner requires a Node.js runtime with global WebSocket support.');
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed.')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || 'CDP request failed.'));
      else entry.resolve(message.result);
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

async function waitForDebugPage(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
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
  throw new Error(`SOLAT renderer was not available on CDP port ${port}.`);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.');
  return result.result?.value;
}

function invoke(fn, ...args) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function uiSnapshot(client) {
  return evaluate(client, invoke(() => {
    const activeThread = typeof State !== 'undefined'
      ? State.threads?.find(item => item.id === State.activeId)
      : null;
    const messages = [...document.querySelectorAll('#stream .msg')].map(node => {
      const stateMessage = activeThread?.messages?.find(item => item.id === node.dataset.id);
      return {
        id: node.dataset.id || '',
        role: node.classList.contains('user') ? 'user' : 'assistant',
        text: node.querySelector('.bubble')?.innerText?.trim() || '',
        origin: node.querySelector('.response-origin')?.innerText?.trim() || '',
        className: node.className,
        pendingReview: Boolean(node.querySelector('button[aria-label="Review Agent"]')),
        computerTaskId: stateMessage?.responseMeta?.computerTaskId || null,
        computerTaskRequestId: stateMessage?.responseMeta?.computerTaskRequestId || null,
        computerTaskRevision: stateMessage?.responseMeta?.computerTaskRevision ?? null,
      };
    });
    const approve = document.querySelector('#agentApproveBtn');
    const cancel = document.querySelector('#agentCancelBtn');
    return {
      title: document.title,
      url: location.href,
      // AgentUI is intentionally kept in the renderer's private scope. Use
      // the secure preload surface and approval dialog as the external
      // capability signal instead of probing a non-global implementation name.
      agentEnabled: Boolean(
        window.solat?.agentInspect && window.solat?.agentApprove
        && window.solat?.agentRun && window.solat?.agentCancel
        && document.querySelector('#agentDialog')
      ),
      messages,
      thinking: document.querySelectorAll('[data-thinking="true"]').length,
      approval: {
        visible: Boolean(approve && !approve.hidden && !approve.disabled),
        approveText: approve?.innerText?.trim() || '',
        cancelText: cancel?.innerText?.trim() || '',
        status: document.querySelector('#agentStatus')?.innerText?.trim() || '',
        steps: document.querySelector('#agentSteps')?.innerText?.trim() || '',
        result: document.querySelector('#agentResult')?.innerText?.trim() || '',
      },
      composerBusy: Boolean(document.querySelector('#sendBtn')?.disabled && document.querySelector('#input')?.value),
      statusText: document.querySelector('#statusText')?.innerText?.trim() || '',
      computerTaskState: window.__solatComputerUseUiRunner?.installed ? {
        activeBySession: typeof AgentUI !== 'undefined' ? [...AgentUI.activeTaskBySession.entries()] : [],
        terminalTaskIds: Object.keys(window.__solatComputerUseUiRunner.terminalTasks),
        terminalTasks: Object.values(window.__solatComputerUseUiRunner.terminalTasks),
      } : null,
    };
  }));
}

async function prepareUi(client) {
  const preloadDeadline = Date.now() + 12_000;
  let preloadReady = false;
  while (Date.now() < preloadDeadline) {
    preloadReady = await evaluate(client, invoke(() => Boolean(
      window.solat?.agentInspect && window.solat?.agentApprove
      && window.solat?.agentRun && window.solat?.agentCancel,
    )));
    if (preloadReady) break;
    await sleep(200);
  }
  if (!preloadReady) throw new Error('The secure SOLAT Agent preload API did not become ready.');
  await evaluate(client, invoke(() => {
    if (window.__solatComputerUseUiRunner?.installed) return;
    const state = { installed: true, activeTasks: {}, terminalTasks: {} };
    window.__solatComputerUseUiRunner = state;
    window.solat.onComputerTaskEvent(event => {
      if (!event?.task_id || !event?.session_id) return;
      const previous = state.activeTasks[event.task_id];
      const task = {
        taskId: event.task_id,
        sessionId: event.session_id,
        requestId: event.request_id || null,
        providerCalls: Number(event.provider_calls || 0),
        actionsStarted: Number(event.actions_started || 0),
        type: event.type || '',
        firstObservedAt: Number(previous?.firstObservedAt || Date.now()),
        observedAt: Date.now(),
      };
      if (['completed', 'failed', 'cancelled', 'unsupported', 'needs_clarification'].includes(event.type)) {
        delete state.activeTasks[event.task_id];
        state.terminalTasks[event.task_id] = task;
      } else {
        state.activeTasks[event.task_id] = task;
      }
    });
  }));
  await evaluate(client, invoke(() => document.querySelector('#newChatBtn')?.click()));
  // New Chat has an intentional full-screen transition. Wait for that real
  // UI state to settle before entering the first command.
  await sleep(2_500);
  const status = await evaluate(client, invoke(async () => {
    if (window.solat?.setModelMode) await window.solat.setModelMode('auto');
    return window.solat?.status ? window.solat.status() : null;
  }));
  await sleep(250);
  const snapshot = await uiSnapshot(client);
  if (!snapshot.agentEnabled) throw new Error('The always-on Agent capability is unavailable in the real SOLAT UI.');
  return status;
}

async function submitCommand(client, command) {
  return evaluate(client, invoke(value => {
    const input = document.querySelector('#input');
    const form = document.querySelector('#composer');
    if (!input || !form) return { submitted: false, reason: 'composer_missing' };
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return { submitted: true, value: input.value };
  }, command));
}

async function clickApproval(client, action) {
  return evaluate(client, invoke(value => {
    const button = document.querySelector(value === 'cancel' ? '#agentCancelBtn' : '#agentApproveBtn');
    if (!button || button.hidden || button.disabled) return false;
    button.click();
    return true;
  }, action));
}

async function timeoutUiState(client, startedAt) {
  return evaluate(client, invoke(caseStartedAt => {
    const approve = document.querySelector('#agentApproveBtn');
    const send = document.querySelector('#sendBtn');
    const activeTasks = Object.values(window.__solatComputerUseUiRunner?.activeTasks || {})
      .filter(task => Number(task.firstObservedAt || 0) >= caseStartedAt - 1_000);
    return {
      activeTasks,
      approvalVisible: Boolean(approve && !approve.hidden && !approve.disabled),
      thinking: document.querySelectorAll('[data-thinking="true"]').length,
      stopVisible: Boolean(send && !send.disabled && send.getAttribute('aria-label') === 'Stop responding'),
    };
  }, startedAt));
}

async function cancelTimedOutTask(client, startedAt, cleanupTimeoutMs = 20_000) {
  const result = {
    requested: false,
    methods: [],
    idle: false,
    active_task_count: null,
    error: null,
  };
  try {
    let state = await timeoutUiState(client, startedAt);
    if (state.approvalVisible && await clickApproval(client, 'cancel')) {
      result.requested = true;
      result.methods.push('approval_cancel_button');
      await sleep(750);
      state = await timeoutUiState(client, startedAt);
    }
    if (state.stopVisible) {
      const clicked = await evaluate(client, invoke(() => {
        const button = document.querySelector('#sendBtn');
        if (!button || button.disabled || button.getAttribute('aria-label') !== 'Stop responding') return false;
        button.click();
        return true;
      }));
      if (clicked) {
        result.requested = true;
        result.methods.push('composer_stop_button');
        await sleep(750);
        state = await timeoutUiState(client, startedAt);
      }
    }
    if (state.activeTasks.length) {
      const cancelled = await evaluate(client, invoke(async caseStartedAt => {
        const tasks = Object.values(window.__solatComputerUseUiRunner?.activeTasks || {})
          .filter(task => Number(task.firstObservedAt || 0) >= caseStartedAt - 1_000);
        const outcomes = [];
        for (const task of tasks) {
          try {
            await window.solat.computerTaskCancel({ sessionId: task.sessionId, taskId: task.taskId });
            outcomes.push({ taskId: task.taskId, cancelled: true });
          } catch (error) {
            outcomes.push({ taskId: task.taskId, cancelled: false, error: error?.message || String(error) });
          }
        }
        return outcomes;
      }, startedAt));
      if (cancelled.length) {
        result.requested = true;
        result.methods.push('computer_task_cancel');
      }
      const failed = cancelled.filter(item => !item.cancelled);
      if (failed.length) result.error = failed.map(item => `${item.taskId}: ${item.error}`).join('; ');
    }

    const deadline = Date.now() + cleanupTimeoutMs;
    while (Date.now() < deadline) {
      state = await timeoutUiState(client, startedAt);
      if (state.approvalVisible) {
        await clickApproval(client, 'cancel');
        result.requested = true;
        if (!result.methods.includes('approval_cancel_button')) result.methods.push('approval_cancel_button');
      }
      if (!state.approvalVisible && state.thinking === 0 && !state.stopVisible && state.activeTasks.length === 0) {
        result.idle = true;
        break;
      }
      await sleep(200);
    }
    state = await timeoutUiState(client, startedAt);
    result.active_task_count = state.activeTasks.length;
    return result;
  } catch (error) {
    result.error = error?.message || String(error);
    return result;
  }
}

async function captureScreenshot(client, destination) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(result.data, 'base64'), { flag: 'wx' });
}

function hasAll(value, expected = []) {
  const haystack = String(value || '').toLocaleLowerCase();
  return expected.every(item => haystack.includes(String(item).toLocaleLowerCase()));
}

function hasAny(value, expected = []) {
  const haystack = String(value || '').toLocaleLowerCase();
  return expected.some(item => haystack.includes(String(item).toLocaleLowerCase()));
}

function observedToolQueries(approvalText) {
  const queries = [];
  for (const match of String(approvalText || '').matchAll(/"query"\s*:\s*"((?:\\.|[^"\\])*)"/gu)) {
    try { queries.push(JSON.parse(`"${match[1]}"`).trim()); } catch { /* malformed evidence is not accepted */ }
  }
  return queries;
}

function judge(testCase, actual, prerequisites) {
  if (!actual.ui_real) return { status: 'NOT RUN', reasons: ['No real Electron renderer was executed.'] };
  if ((testCase.expected?.requires_deepseek || testCase.expected?.requires_model_route || testCase.expected?.no_model_route_before_approval)
    && !prerequisites.routingLogsAvailable) {
    return { status: 'NOT VERIFIED', reasons: ['The runner attached to an existing app, so model-routing process logs were unavailable.'] };
  }
  if (testCase.expected?.requires_deepseek && !prerequisites.deepseekConfigured) {
    return { status: 'NOT VERIFIED', reasons: ['DeepSeek is not configured, so escalation cannot be verified.'] };
  }
  if (testCase.precondition === 'calculator' && !prerequisites.calculatorStarted) {
    return { status: 'NOT VERIFIED', reasons: ['Calculator precondition was not available.'] };
  }
  const reasons = [];
  const approvalText = actual.approvals.map(item => `${item.steps}\n${item.result}`).join('\n');
  const finalText = actual.final_message?.text || '';
  const combined = `${approvalText}\n${finalText}`;
  const expected = testCase.expected || {};
  if (actual.timeout) reasons.push('The real UI did not reach a terminal observable state before timeout.');
  if (actual.timeout && actual.timeout_cleanup && !actual.timeout_cleanup.idle) reasons.push('Timed-out task cleanup did not return the UI to an idle state, so no later case may start.');
  if (!actual.user_message_exact) reasons.push('The real UI did not retain the exact submitted command.');
  if (expected.approval_contains && !hasAll(approvalText, expected.approval_contains)) reasons.push(`Approval evidence is missing: ${expected.approval_contains.join(', ')}`);
  if (expected.final_contains && !hasAll(finalText, expected.final_contains)) reasons.push(`Final UI result is missing: ${expected.final_contains.join(', ')}`);
  if (expected.final_contains_any && !hasAny(finalText, expected.final_contains_any)) reasons.push(`Final UI result contains none of: ${expected.final_contains_any.join(', ')}`);
  if (expected.no_approval && actual.approvals.length) reasons.push('An approval appeared although clarification/read-only handling was expected.');
  if (expected.approval_within_ms && !(actual.timing.submitted_to_approval_ms <= expected.approval_within_ms)) reasons.push(`Fast-path approval exceeded ${expected.approval_within_ms} ms.`);
  if (expected.no_model_route_before_approval && actual.model_route_before_approval) reasons.push('A model routing call occurred before deterministic fast-path approval.');
  if (expected.no_model_route && actual.computer_task_terminal && actual.computer_task_terminal.providerCalls !== 0) reasons.push('The task itself made a model routing call on a deterministic read-only fast path.');
  if (expected.no_model_route && !actual.computer_task_terminal) reasons.push('The terminal task event was unavailable, so zero model calls could not be verified.');
  if (expected.requires_model_route && !actual.model_route_observed) reasons.push('No model routing evidence was observed for the model-guided case.');
  if (expected.requires_deepseek && !actual.deepseek_route_observed) reasons.push('No DeepSeek routing evidence was observed during this case.');
  if (expected.exact_query) {
    const expectedQuery = String(expected.exact_query).trim().toLocaleLowerCase();
    const actualQueries = observedToolQueries(approvalText).map(value => value.toLocaleLowerCase());
    if (!actualQueries.includes(expectedQuery)) {
      reasons.push(`Verified tool query was not exact: expected “${expected.exact_query}”; observed ${actualQueries.length ? actualQueries.join(', ') : 'none'}.`);
    }
  }
  if (expected.forbid_substitution && hasAny(combined, expected.forbid_substitution)) reasons.push(`Stale/substituted term leaked into this case: ${expected.forbid_substitution.join(', ')}`);
  if (testCase.policy === 'cancel_at_approval' && !actual.cancel_clicked) reasons.push('The cancellation control was not exercised.');
  if (actual.unsafe_approval_detected) reasons.push('The runner refused an unsafe approval.');
  const expectedCancellation = testCase.policy === 'cancel_at_approval'
    && hasAll(finalText, expected.final_contains || []);
  if (/\berror\b|agent-(?:failed|unsupported)/iu.test(actual.final_message?.className || '')
    || (/agent-cancelled/iu.test(actual.final_message?.className || '') && !expectedCancellation)) {
    reasons.push('The final UI ended in a non-success state.');
  }
  if (/delivery failed|agent action failed|server_error|jinja exception/iu.test(finalText)) reasons.push('The final UI displayed a failure.');
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}

async function runCase({ client, testCase, baseline, logs, evidenceDir, timeoutMs, prerequisites }) {
  const startedAt = Date.now();
  const logStart = logs.length;
  const actual = {
    ui_real: true,
    submitted_at: new Date(startedAt).toISOString(),
    approvals: [],
    cancel_clicked: false,
    unsafe_approval_detected: false,
    timeout: false,
    timeout_cancelled: false,
    timeout_cleanup: null,
    user_message_exact: false,
    final_message: null,
    timing: { submitted_to_first_ui_ms: null, submitted_to_approval_ms: null, submitted_to_terminal_ms: null },
  };
  const submitted = await submitCommand(client, testCase.command);
  if (!submitted?.submitted) throw new Error(`Composer submission failed: ${submitted?.reason || 'unknown'}`);
  const seenApprovals = new Set();
  let firstUiAt = null;
  let terminalStableAt = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await uiSnapshot(client);
    const newMessages = snapshot.messages.slice(baseline.messages.length);
    const user = newMessages.find(message => message.role === 'user');
    if (user && firstUiAt === null) firstUiAt = Date.now();
    actual.user_message_exact = Boolean(user && user.text.trim() === testCase.command.trim());
    if (snapshot.approval.visible) {
      const approvalKey = `${snapshot.approval.steps}\n${snapshot.approval.result}`;
      if (!seenApprovals.has(approvalKey)) {
        seenApprovals.add(approvalKey);
        actual.approvals.push({ observed_at: new Date().toISOString(), ...snapshot.approval });
        if (actual.timing.submitted_to_approval_ms === null) actual.timing.submitted_to_approval_ms = Date.now() - startedAt;
      }
      if (UNSAFE_APPROVAL.test(approvalKey)) {
        actual.unsafe_approval_detected = true;
        await clickApproval(client, 'cancel');
      } else if (testCase.policy === 'cancel_at_approval') {
        actual.cancel_clicked = await clickApproval(client, 'cancel');
      } else if (testCase.policy !== 'no_approval_expected') {
        await clickApproval(client, 'approve');
      }
      terminalStableAt = null;
    }
    const assistants = newMessages.filter(message => message.role === 'assistant' && !message.className.includes('thinking'));
    const final = assistants.at(-1) || null;
    const terminalClass = /agent-(?:verified|completed|failed|cancelled|unsupported|needs[-_]?clarification)|\berror\b/iu.test(final?.className || '');
    const quiet = snapshot.thinking === 0 && !snapshot.approval.visible;
    const noApprovalTerminal = testCase.policy === 'no_approval_expected' && final && quiet;
    const readOnlyTerminal = testCase.expected?.read_only && final && quiet && !final.pendingReview;
    if (final && quiet && (terminalClass || noApprovalTerminal || readOnlyTerminal)) {
      terminalStableAt ||= Date.now();
      if (Date.now() - terminalStableAt >= 900) {
        actual.final_message = final;
        break;
      }
    } else terminalStableAt = null;
    await sleep(200);
  }
  if (!actual.final_message) {
    actual.timeout = true;
    const snapshot = await uiSnapshot(client);
    actual.final_message = snapshot.messages.slice(baseline.messages.length).filter(message => message.role === 'assistant').at(-1) || null;
    actual.timeout_cleanup = await cancelTimedOutTask(client, startedAt);
    actual.timeout_cancelled = Boolean(actual.timeout_cleanup.requested && actual.timeout_cleanup.idle);
  }
  actual.timing.submitted_to_first_ui_ms = firstUiAt === null ? null : firstUiAt - startedAt;
  actual.timing.submitted_to_terminal_ms = Date.now() - startedAt;
  const caseLogs = logs.slice(logStart);
  const joinedLogs = caseLogs.map(entry => entry.line).join('\n');
  const firstApprovalAt = actual.timing.submitted_to_approval_ms;
  actual.model_route_observed = /\[solat:model-routing\]/u.test(joinedLogs);
  actual.deepseek_route_observed = /route:\s*['"]deepseek['"]|"route"\s*:\s*"deepseek"/iu.test(joinedLogs);
  actual.model_route_before_approval = Boolean(firstApprovalAt !== null && caseLogs.some(entry => entry.at_ms - startedAt <= firstApprovalAt && /\[solat:model-routing\]/u.test(entry.line)));
  actual.process_logs = caseLogs.map(entry => entry.line).slice(-120);
  const priorTerminalIds = new Set(baseline.computerTaskState?.terminalTaskIds || []);
  const terminalSnapshot = await uiSnapshot(client);
  actual.computer_task_terminal = (terminalSnapshot.computerTaskState?.terminalTasks || [])
    .filter(item => !priorTerminalIds.has(item.taskId))
    .sort((left, right) => Number(right.observedAt || 0) - Number(left.observedAt || 0))[0] || null;
  const screenshot = path.join(evidenceDir, `${testCase.id}.png`);
  await captureScreenshot(client, screenshot);
  actual.screenshot = path.relative(ROOT, screenshot);
  actual.finished_at = new Date().toISOString();
  actual.final_snapshot = terminalSnapshot;
  const verdict = judge(testCase, actual, prerequisites);
  return { id: testCase.id, category: testCase.category, command: testCase.command, expected: testCase.expected, actual, status: verdict.status, reasons: verdict.reasons };
}

async function startCalculator() {
  if (process.platform !== 'win32') return { started: false, process: null };
  try {
    const existing = await verifyCalculatorReady();
    if (existing.ready) {
      return { started: true, process: null, reused: true, hwnd: existing.hwnd };
    }
    if (existing.count > 1) {
      return { started: false, process: null, reused: false, reason: 'multiple_calculator_windows' };
    }
    const child = spawn('calc.exe', [], { detached: false, windowsHide: false, stdio: 'ignore' });
    child.unref();
    await sleep(1200);
    const launched = await verifyCalculatorReady();
    return { started: launched.ready, process: child, hwnd: launched.hwnd, reason: launched.reason };
  } catch {
    return { started: false, process: null };
  }
}

async function verifyCalculatorReady() {
  const adapter = new WinAppComputerUseAdapter();
  const listed = await adapter.listWindows();
  const windows = (listed.windows || []).filter(window => /calculator/iu.test(String(window?.title || '')));
  if (!windows.length) {
    return { ready: false, count: 0, reason: 'calculator_missing' };
  }

  let lastError = null;
  for (const window of windows) {
    try {
      const inspected = await adapter.inspect({ hwnd: window.hwnd, interactiveOnly: false });
      const serialized = JSON.stringify(inspected?.tree || {});
      if (/(?:CalculatorResults|Display is|ผลลัพธ์|แสดง)/iu.test(serialized)) {
        return { ready: true, count: windows.length, hwnd: window.hwnd, reason: null };
      }
    } catch (error) {
      lastError = error;
    }
  }
  return {
    ready: false,
    count: windows.length,
    reason: lastError?.code || 'calculator_semantic_tree_empty',
  };
}

async function main() {
  const allCases = loadCases();
  const requestedIds = argument('--case-ids').split(',').map(value => value.trim()).filter(Boolean);
  const cases = requestedIds.length ? allCases.filter(testCase => requestedIds.includes(testCase.id)) : allCases;
  if (requestedIds.length && (cases.length !== requestedIds.length || new Set(requestedIds).size !== requestedIds.length)) {
    throw new Error('Every --case-ids value must identify one unique case in the 15-case fixture.');
  }
  const destination = reportPath();
  const runId = crypto.randomUUID();
  const baseReport = {
    schema_version: 'solat.computer-use-ui-report.v1',
    run_id: runId,
    suite_path: CASES_PATH,
    selected_case_ids: cases.map(testCase => testCase.id),
    ui_verification_required: true,
    started_at: new Date().toISOString(),
  };
  if (!process.argv.includes('--execute')) {
    const rows = cases.map(testCase => ({ id: testCase.id, category: testCase.category, command: testCase.command, expected: testCase.expected, actual: null, status: 'NOT RUN', reasons: ['Run with --execute to test the real SOLAT Electron UI.'] }));
    const report = { ...baseReport, finished_at: new Date().toISOString(), status: 'NOT RUN', counts: { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0, 'NOT RUN': rows.length }, rows };
    writeReport(destination, report);
    process.stdout.write(`${JSON.stringify({ output: destination, status: report.status, counts: report.counts })}\n`);
    process.exitCode = 2;
    return;
  }
  if (process.platform !== 'win32') throw new Error('The real Computer Use UI suite requires Windows.');
  const port = Number(argument('--cdp-port', String(9400 + Math.floor(Math.random() * 400))));
  const timeoutMs = Math.max(20_000, Number(argument('--case-timeout-ms', '120000')) || 120_000);
  const attach = process.argv.includes('--attach');
  const packagedExecutable = argument('--executable');
  const logs = [];
  let electron = null;
  let client = null;
  const profile = path.join(ROOT, 'reports', `.computer-use-ui-profile-${runId}`);
  const evidenceDir = path.join(ROOT, 'reports', `computer-use-ui-15-evidence-${runId}`);
  try {
    if (!attach) {
      const electronExecutable = packagedExecutable ? path.resolve(ROOT, packagedExecutable) : require('electron');
      if (packagedExecutable && !fs.existsSync(electronExecutable)) throw new Error(`Packaged executable not found: ${electronExecutable}`);
      const launchArguments = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
      if (!packagedExecutable) launchArguments.push('.');
      electron = spawn(electronExecutable, launchArguments, {
        cwd: ROOT,
        env: { ...process.env, SOLAT_DEVTOOLS: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });
      const collect = chunk => {
        const now = Date.now();
        for (const line of String(chunk).split(/\r?\n/u).filter(Boolean)) logs.push({ at_ms: now, line });
      };
      electron.stdout.on('data', collect);
      electron.stderr.on('data', collect);
    }
    const target = await waitForDebugPage(port);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    const modelStatus = await prepareUi(client);
    const calculatorRequired = cases.some(testCase => testCase.precondition === 'calculator');
    const calculator = calculatorRequired ? await startCalculator() : { started: false, process: null };
    const prerequisites = {
      calculatorStarted: calculatorRequired ? calculator.started : null,
      deepseekConfigured: Boolean(modelStatus?.deepseek?.configured),
      localConfigured: Boolean(modelStatus?.local?.configured),
      routingLogsAvailable: !attach,
    };
    const rows = [];
    for (const testCase of cases) {
      if (testCase.precondition === 'calculator') {
        const calculatorReady = await verifyCalculatorReady();
        prerequisites.calculatorStarted = calculatorReady.ready;
        prerequisites.calculatorWindowCount = calculatorReady.count;
        prerequisites.calculatorReason = calculatorReady.reason;
      }
      const baseline = await uiSnapshot(client);
      process.stderr.write(`[${testCase.id}] ${testCase.command}\n`);
      try {
        const row = await runCase({ client, testCase, baseline, logs, evidenceDir, timeoutMs, prerequisites });
        rows.push(row);
        process.stderr.write(`[${testCase.id}] ${row.status} ${row.actual.timing.submitted_to_terminal_ms}ms\n`);
        if (row.actual.timeout && !row.actual.timeout_cleanup?.idle) {
          process.stderr.write(`[${testCase.id}] Timed-out task did not become idle; stopping the suite before the next case.\n`);
          break;
        }
      } catch (error) {
        rows.push({
          id: testCase.id, category: testCase.category, command: testCase.command, expected: testCase.expected,
          actual: { ui_real: true, error: { code: error.code || 'ui_case_failed', message: error.message }, process_logs: logs.slice(-80).map(entry => entry.line) },
          status: 'FAIL', reasons: [error.message],
        });
      }
    }
    const counts = rows.reduce((out, row) => { out[row.status] = (out[row.status] || 0) + 1; return out; }, { PASS: 0, FAIL: 0, 'NOT VERIFIED': 0, 'NOT RUN': 0 });
    const report = {
      ...baseReport,
      finished_at: new Date().toISOString(),
      status: counts.FAIL ? 'FAIL' : counts['NOT VERIFIED'] || counts['NOT RUN'] ? 'NOT VERIFIED' : 'PASS',
      case_count: rows.length,
      target: { title: target.title, url: target.url, cdp_port: port, attached: attach, executable: packagedExecutable ? path.resolve(ROOT, packagedExecutable) : null },
      prerequisites,
      safety: { destructive_actions: false, external_send_actions: false, unsafe_approval_guard: true },
      counts,
      rows,
    };
    writeReport(destination, report);
    process.stdout.write(`${JSON.stringify({ output: destination, status: report.status, counts })}\n`);
    if (report.status !== 'PASS') process.exitCode = 1;
  } finally {
    client?.close();
    await stopSpawnedElectron(electron);
    if (!process.argv.includes('--keep-profile')) await removeTemporaryProfile(profile);
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'computer_use_ui_15_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
