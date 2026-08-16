const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { composeAgentTools } = require('../src/core/agent-tool-composer');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { WinAppComputerUseAdapter } = require('../src/core/computer-use-adapter');

const execFileAsync = promisify(execFile);
const FIXTURE_TITLE = 'SOLAT Computer Use Fixture';
const TEST_VALUE = 'SOLAT-5-CASE-SMOKE';

function requireExecuteFlag() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  if (process.platform !== 'win32') throw new Error('Requires Windows.');
}
async function waitForTarget(adapter) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await adapter.listWindows();
    const matches = result.windows.filter(window => window.title === FIXTURE_TITLE);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('More than one fixture window is open.');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Fixture window did not become ready.');
}
async function approveAndRun({ service, pending }) {
  if (pending.model_result?.status !== 'confirmation_required' || !pending.action?.approval_token) throw new Error('Approval gate missing.');
  await service.approve({ ownerId: 'five-case-owner', sessionId: 'five-case-owner', idempotencyKey: pending.action.idempotency_key, approvalToken: pending.action.approval_token });
  return service.run({ ownerId: 'five-case-owner', sessionId: 'five-case-owner', idempotencyKey: pending.action.idempotency_key });
}
async function stopFixture(fixture) {
  if (!fixture || fixture.exitCode !== null) return;
  const exited = new Promise(resolve => fixture.once('exit', resolve));
  fixture.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
}
async function main() {
  requireExecuteFlag();
  const requestedRoot = process.env.SOLAT_TEST_TMP || os.tmpdir();
  await fs.promises.mkdir(requestedRoot, { recursive: true });
  const tempRoot = await fs.promises.mkdtemp(path.join(path.resolve(requestedRoot), 'solat-computer-5case-'));
  const fixtureExe = path.join(tempRoot, 'SolatComputerUseFixture.exe');
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const source = path.resolve(__dirname, '..', 'test', 'fixtures', 'SolatComputerUseFixture.cs');
  let fixture;
  const cases = [];
  try {
    await execFileAsync(csc, ['/nologo', '/target:winexe', `/out:${fixtureExe}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', source], { windowsHide: true });
    fixture = spawn(fixtureExe, [], { shell: false, windowsHide: false, stdio: 'ignore' });
    const adapter = new WinAppComputerUseAdapter();
    const target = await waitForTarget(adapter);
    const tools = composeAgentTools(createComputerAgentTools({ adapter }));
    const service = new AgentService({ rootDir: path.join(tempRoot, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });

    const listed = await adapter.listWindows();
    cases.push({ id: 'CU-01', name: 'list_windows', status: listed.windows.some(window => window.hwnd === target.hwnd && window.title === FIXTURE_TITLE) ? 'PASS' : 'FAIL' });
    const inspected = await adapter.inspect({ hwnd: target.hwnd, selector: 'AgentInput', depth: 2 });
    const initial = inspected.tree?.windows?.[0]?.elements?.[0]?.value;
    cases.push({ id: 'CU-02', name: 'inspect_initial_value', status: initial === 'idle' ? 'PASS' : 'FAIL', observed: initial });
    const pendingSet = await bridge.execute({ sessionId: 'five-case-owner', requestId: 'five-set', call: { name: 'computer_set_value', arguments: { hwnd: target.hwnd, selector: 'AgentInput', value: TEST_VALUE } } });
    const unchanged = await adapter.inspect({ hwnd: target.hwnd, selector: 'AgentInput', depth: 2 });
    cases.push({ id: 'CU-03', name: 'write_pauses_before_approval', status: pendingSet.model_result?.status === 'confirmation_required' && unchanged.tree?.windows?.[0]?.elements?.[0]?.value === 'idle' ? 'PASS' : 'FAIL' });
    const setRun = await approveAndRun({ service, pending: pendingSet });
    cases.push({ id: 'CU-04', name: 'approved_set_value_verified', status: setRun.plan.status === 'SUCCEEDED' && setRun.plan.steps[0]?.output?.verified === true ? 'PASS' : 'FAIL' });
    const pendingInvoke = await bridge.execute({ sessionId: 'five-case-owner', requestId: 'five-invoke', call: { name: 'computer_invoke', arguments: { hwnd: target.hwnd, selector: 'ApplyAgentInput', verify_selector: 'AgentStatus', verify_state: 'value', verify_value: `status:${TEST_VALUE}` } } });
    const invokeRun = await approveAndRun({ service, pending: pendingInvoke });
    const final = await adapter.verifyState({ hwnd: target.hwnd, selector: 'AgentStatus', state: 'value', value: `status:${TEST_VALUE}` });
    cases.push({ id: 'CU-05', name: 'approved_invoke_postcondition', status: invokeRun.plan.status === 'SUCCEEDED' && final.found === true && final.state === 'value' ? 'PASS' : 'FAIL' });
    const failed = cases.filter(item => item.status !== 'PASS');
    process.stdout.write(`${JSON.stringify({ schema_version: 'solat.computer-use-5-case-smoke.v1', status: failed.length ? 'FAIL' : 'PASS', cases, executable: 'Microsoft.WinAppCli' }, null, 2)}\n`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await stopFixture(fixture);
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'computer_5_case_failed', message: error.message })}\n`); process.exitCode = 1; });
