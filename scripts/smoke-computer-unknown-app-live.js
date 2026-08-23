const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { createProvider } = require('../src/core/provider');
const { ModelRouter } = require('../src/core/model-router');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { composeAgentTools } = require('../src/core/agent-tool-composer');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { ComputerTaskLoop } = require('../src/core/computer-task-loop');
const { WinAppComputerUseAdapter } = require('../src/core/computer-use-adapter');

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? String(process.argv[modeIndex + 1] || '').trim() : 'auto';
  if (!['auto', 'local', 'deepseek'].includes(mode)) throw new Error('--mode must be auto, local, or deepseek.');
  const config = readConfig();
  const localProvider = createProvider(config.localModel);
  if (process.argv.includes('--trace-steps')) {
    const originalCompleteStructured = localProvider.completeStructured.bind(localProvider);
    localProvider.completeStructured = async (...args) => {
      const result = await originalCompleteStructured(...args);
      process.stderr.write(`[qwen-controller-step] ${JSON.stringify(result.data)}\n`);
      return result;
    };
  }
  const router = new ModelRouter({
    localProvider,
    deepseekProvider: createProvider(config),
    mode,
  });
  const adapter = new WinAppComputerUseAdapter();
  const rootBase = process.env.SOLAT_TEST_TMP || os.tmpdir();
  await fs.promises.mkdir(rootBase, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(path.resolve(rootBase), 'solat-unknown-app-live-'));
  const startedAt = Date.now();
  const events = [];
  try {
    const computerTools = createComputerAgentTools({ adapter });
    const tools = composeAgentTools(computerTools);
    const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
    const loop = new ComputerTaskLoop({ provider: router, bridge, toolRegistry: computerTools.registry, limits: { maxPlannerTurns: 6, maxProviderCalls: 8, maxActions: 6 } });
    const task = await loop.start({
      ownerId: 'unknown-app-live-owner',
      sessionId: 'unknown-app-live-owner',
      requestId: 'unknown-app-live-request',
      goal: 'Read only: find the already-open Calculator window and report the current displayed value. Do not click, type, invoke, or change anything.',
      eventSink: event => events.push(event),
    });
    const toolsUsed = events.filter(item => item.type === 'observation_ready').map(item => item.tool).filter(Boolean);
    const report = {
      schema_version: 'solat.computer-unknown-app-live.v1',
      model_mode: mode,
      status: task.status === 'COMPLETED' && toolsUsed.includes('computer_list_windows') && toolsUsed.includes('computer_inspect') ? 'PASS' : 'FAIL',
      task_status: task.status,
      summary: task.summary,
      tools_used: toolsUsed,
      provider_calls: task.provider_calls,
      actions: task.actions_started,
      elapsed_ms: Date.now() - startedAt,
      event_summaries: events.map(item => ({ type: item.type, tool: item.tool, status: item.status, observation_count: item.observation_count, elapsed_ms: item.elapsed_ms })),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'PASS') process.exitCode = 1;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'unknown_app_live_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
