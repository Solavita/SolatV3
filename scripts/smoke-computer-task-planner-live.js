const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { composeAgentTools } = require('../src/core/agent-tool-composer');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { ComputerTaskLoop } = require('../src/core/computer-task-loop');
const { createProvider } = require('../src/core/provider');

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Live computer task planner smoke is opt-in. Re-run with --execute.');
  const config = readConfig({ cwd: process.cwd(), envFiles: [path.join(process.cwd(), 'dist', 'win-unpacked', '.env')] });
  if (!config.apiKey) throw Object.assign(new Error('A configured model provider is required for live computer planner smoke.'), { code: 'provider_not_configured' });
  const root = await fs.promises.mkdtemp(path.join(process.env.SOLAT_TEST_TMP || os.tmpdir(), 'solat-computer-planner-live-'));
  try {
    let mutations = 0;
    const adapter = {
      async listWindows() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'list_windows', windows: [] }; },
      async inspect() { return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'inspect', tree: {} }; },
      async launchApp() { mutations += 1; throw new Error('Live planner smoke must not launch an app.'); },
      async openWebsite() { mutations += 1; throw new Error('Live planner smoke must not open a website.'); },
      async playYoutubeMusic() { mutations += 1; throw new Error('Live planner smoke must not play media.'); },
      async invoke() { mutations += 1; throw new Error('Live planner smoke must not invoke UI.'); },
      async setValue() { mutations += 1; throw new Error('Live planner smoke must not type into UI.'); },
    };
    const computerTools = createComputerAgentTools({ adapter });
    const tools = composeAgentTools(computerTools);
    const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
    const loop = new ComputerTaskLoop({ provider: createProvider(config), bridge, toolRegistry: computerTools.registry });
    const task = await loop.start({ ownerId: 'live-computer-smoke', sessionId: 'live-computer-smoke', requestId: 'live-computer-smoke-request', goal: 'Open Google in Chrome. Do not type, log in, or submit anything.' });
    if (task.status !== 'AWAITING_APPROVAL' || !task.pending_action?.action || !['computer_open_website', 'computer_launch_app'].includes(task.pending_action.tool)) {
      throw Object.assign(new Error(`The live model did not produce an approved safe computer action (status: ${task.status}).`), { code: 'unexpected_live_computer_plan' });
    }
    if (mutations !== 0) throw Object.assign(new Error('A computer mutation occurred before owner approval.'), { code: 'approval_bypass' });
    process.stdout.write(`${JSON.stringify({
      schema_version: 'solat.live-computer-task-planner-smoke.v1', status: 'PASS', provider: config.provider, model: config.model,
      planned_tool: task.pending_action.tool, approval_required: true, computer_mutations_before_approval: 0,
    }, null, 2)}\n`);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'live_computer_planner_failed', message: error?.message || String(error) })}\n`); process.exitCode = 1; });
