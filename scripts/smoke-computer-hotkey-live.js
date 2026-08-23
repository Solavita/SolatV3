const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { composeAgentTools } = require('../src/core/agent-tool-composer');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { WinAppComputerUseAdapter } = require('../src/core/computer-use-adapter');

function requireExecuteFlag() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  if (process.platform !== 'win32') throw new Error('Requires Windows.');
}

function flatten(tree, out = []) {
  if (!tree || typeof tree !== 'object') return out;
  if (Array.isArray(tree)) {
    for (const value of tree) flatten(value, out);
    return out;
  }
  if (tree.selector || tree.name) out.push(tree);
  for (const value of Object.values(tree)) if (value && typeof value === 'object') flatten(value, out);
  return out;
}

async function main() {
  requireExecuteFlag();
  const startedAt = Date.now();
  const adapter = new WinAppComputerUseAdapter();
  let listed = await adapter.listWindows();
  let candidates = listed.windows.filter(window => /notepad/iu.test(window.process_name));
  let launchedForTest = false;
  if (candidates.length === 0) {
    await adapter.launchApp({ appId: 'notepad' });
    launchedForTest = true;
    listed = await adapter.listWindows();
    candidates = listed.windows.filter(window => /notepad/iu.test(window.process_name));
  }
  if (candidates.length !== 1) throw new Error(`Expected exactly one visible Notepad window, found ${candidates.length}.`);
  const target = candidates[0];
  const inspected = await adapter.inspect({ hwnd: target.hwnd, depth: 8 });
  const nodes = flatten(inspected.tree);
  let editor = nodes.find(node => /text editor/iu.test(String(node.name || '')) && node.selector);
  const bold = nodes.find(node => /^bold(?:\s|$)/iu.test(String(node.name || '')) && node.selector && node.toggleState);
  if (!editor) {
    const editorInspection = await adapter.inspect({ hwnd: target.hwnd, selector: 'Text editor', depth: 2 });
    const observedEditor = flatten(editorInspection.tree).find(node => /text editor/iu.test(String(node.name || '')));
    if (observedEditor) editor = { ...observedEditor, selector: observedEditor.selector || 'Text editor' };
  }
  if (!editor || !bold) {
    const visible = nodes.slice(0, 80).map(node => ({ name: node.name, selector: node.selector, controlType: node.controlType || node.type, toggleState: node.toggleState }));
    throw new Error(`The Notepad editor or Bold toggle was not observable through UI Automation: ${JSON.stringify(visible)}`);
  }
  const expected = String(bold.toggleState).toLocaleLowerCase() === 'on' ? 'off' : 'on';

  const rootBase = process.env.SOLAT_TEST_TMP || os.tmpdir();
  await fs.promises.mkdir(rootBase, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(path.resolve(rootBase), 'solat-hotkey-live-'));
  try {
    const tools = composeAgentTools(createComputerAgentTools({ adapter }));
    const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
    const pending = await bridge.execute({
      sessionId: 'hotkey-live-owner',
      requestId: 'hotkey-live-request',
      call: { name: 'computer_press_hotkey', arguments: { hwnd: target.hwnd, selector: editor.selector, chord: 'ctrl+b', verify_selector: bold.selector, verify_property: 'toggle_state', verify_value: expected } },
    });
    if (pending.model_result?.status !== 'confirmation_required') throw new Error('The hotkey mutation did not pause for owner approval.');
    await service.approve({ ownerId: 'hotkey-live-owner', sessionId: 'hotkey-live-owner', idempotencyKey: pending.action.idempotency_key, approvalToken: pending.action.approval_token });
    const completed = await service.run({ ownerId: 'hotkey-live-owner', sessionId: 'hotkey-live-owner', idempotencyKey: pending.action.idempotency_key });
    const output = completed.plan.steps[0]?.output;
    const report = {
      schema_version: 'solat.computer-hotkey-live.v1',
      status: completed.plan.status === 'SUCCEEDED' && output?.verified === true ? 'PASS' : 'FAIL',
      approval_gate: pending.model_result.status,
      launched_for_test: launchedForTest,
      target: { hwnd: target.hwnd, process_name: target.process_name, title: target.title },
      chord: 'ctrl+b',
      state_before: bold.toggleState,
      state_after: output?.verification?.actual || null,
      plan_status: completed.plan.status,
      failure: completed.plan.error || completed.plan.steps.map(step => ({ status: step.status, error: step.error, output: step.output })),
      audit_tail: Array.isArray(completed.plan.audit) ? completed.plan.audit.slice(-3) : null,
      result_keys: Object.keys(completed),
      completed_error: completed.error || null,
      service_audit_tail: Array.isArray(completed.audit) ? completed.audit.slice(-4) : null,
      elapsed_ms: Date.now() - startedAt,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'PASS') process.exitCode = 1;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'hotkey_live_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
