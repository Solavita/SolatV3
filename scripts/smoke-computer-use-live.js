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
const TEST_VALUE = 'SOLAT-LIVE-SMOKE';

function requireExecuteFlag() {
  if (!process.argv.includes('--execute')) {
    throw new Error('Live computer-use smoke is opt-in. Re-run with --execute.');
  }
  if (process.platform !== 'win32') throw new Error('Live computer-use smoke requires Windows.');
}

async function waitForTarget(adapter, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await adapter.listWindows();
    const matches = result.windows.filter(window => window.title === FIXTURE_TITLE);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('More than one computer-use fixture window is open.');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Computer-use fixture window did not become ready.');
}

async function approveAndRun({ service, pending }) {
  if (pending.model_result.status !== 'confirmation_required' || !pending.action?.approval_token) {
    throw new Error('Write action did not pause for owner approval.');
  }
  await service.approve({
    ownerId: 'live-fixture-owner',
    sessionId: 'live-fixture-owner',
    idempotencyKey: pending.action.idempotency_key,
    approvalToken: pending.action.approval_token,
  });
  return service.run({
    ownerId: 'live-fixture-owner',
    sessionId: 'live-fixture-owner',
    idempotencyKey: pending.action.idempotency_key,
  });
}

async function stopFixture(fixture) {
  if (!fixture || fixture.exitCode !== null) return;
  const exited = new Promise(resolve => fixture.once('exit', resolve));
  fixture.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
}

async function removeCreatedTemp(tempRoot) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw lastError;
}

async function main() {
  requireExecuteFlag();
  const requestedRoot = process.env.SOLAT_TEST_TMP || os.tmpdir();
  await fs.promises.mkdir(requestedRoot, { recursive: true });
  const tempRoot = await fs.promises.mkdtemp(path.join(path.resolve(requestedRoot), 'solat-computer-live-'));
  const fixtureExe = path.join(tempRoot, 'SolatComputerUseFixture.exe');
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const source = path.resolve(__dirname, '..', 'test', 'fixtures', 'SolatComputerUseFixture.cs');
  let fixture;
  try {
    await execFileAsync(csc, ['/nologo', '/target:winexe', `/out:${fixtureExe}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', source], { windowsHide: true });
    fixture = spawn(fixtureExe, [], { shell: false, windowsHide: false, stdio: 'ignore' });
    const adapter = new WinAppComputerUseAdapter();
    const target = await waitForTarget(adapter);
    const tools = composeAgentTools(createComputerAgentTools({ adapter }));
    const service = new AgentService({ rootDir: path.join(tempRoot, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });

    const before = await adapter.inspect({ hwnd: target.hwnd, selector: 'AgentInput', depth: 2 });
    const beforeValue = before.tree?.windows?.[0]?.elements?.[0]?.value;
    if (beforeValue !== 'idle') throw new Error(`Unexpected initial fixture value: ${beforeValue}.`);

    const setPending = await bridge.execute({
      sessionId: 'live-fixture-owner',
      requestId: 'live-set-value',
      call: { name: 'computer_set_value', arguments: { hwnd: target.hwnd, selector: 'AgentInput', value: TEST_VALUE } },
    });
    const unchanged = await adapter.inspect({ hwnd: target.hwnd, selector: 'AgentInput', depth: 2 });
    if (unchanged.tree?.windows?.[0]?.elements?.[0]?.value !== 'idle') throw new Error('Computer value changed before approval.');
    const setRun = await approveAndRun({ service, pending: setPending });
    if (setRun.plan.status !== 'SUCCEEDED' || setRun.plan.steps[0]?.output?.verified !== true) throw new Error('Approved set-value did not produce verified success.');

    await adapter.verifyState({ hwnd: target.hwnd, selector: 'AgentStatus', state: 'value', value: 'status:idle' });
    const invokePending = await bridge.execute({
      sessionId: 'live-fixture-owner',
      requestId: 'live-invoke',
      call: {
        name: 'computer_invoke',
        arguments: {
          hwnd: target.hwnd,
          selector: 'ApplyAgentInput',
          verify_selector: 'AgentStatus',
          verify_state: 'value',
          verify_value: `status:${TEST_VALUE}`,
        },
      },
    });
    await adapter.verifyState({ hwnd: target.hwnd, selector: 'AgentStatus', state: 'value', value: 'status:idle' });
    const invokeRun = await approveAndRun({ service, pending: invokePending });
    if (invokeRun.plan.status !== 'SUCCEEDED' || invokeRun.plan.steps[0]?.output?.verified !== true) throw new Error('Approved invoke did not produce verified success.');
    const finalState = await adapter.verifyState({ hwnd: target.hwnd, selector: 'AgentStatus', state: 'value', value: `status:${TEST_VALUE}` });

    process.stdout.write(`${JSON.stringify({
      schema_version: 'solat.computer-live-smoke.v1',
      status: 'PASS',
      approval_gates: 2,
      before_value: beforeValue,
      after_value: TEST_VALUE,
      final_state: finalState,
      executable: 'Microsoft.WinAppCli',
    }, null, 2)}\n`);
  } finally {
    await stopFixture(fixture);
    await removeCreatedTemp(tempRoot);
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'computer_live_smoke_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
