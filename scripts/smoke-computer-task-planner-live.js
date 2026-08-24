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
const { ModelRouter } = require('../src/core/model-router');

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Live computer task planner smoke is opt-in. Re-run with --execute.');
  const config = readConfig({ cwd: process.cwd(), envFiles: [path.join(process.cwd(), 'dist', 'win-unpacked', '.env')] });
  if (!config.flashModel?.apiKey || !config.plusModel?.apiKey) throw Object.assign(new Error('Qwen Flash and Plus are required for live computer planner smoke.'), { code: 'provider_not_configured' });
  const provider = new ModelRouter({
    flashProvider: createProvider(config.flashModel), plusProvider: createProvider(config.plusModel), mode: config.modelMode,
  });
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
    const loop = new ComputerTaskLoop({ provider, bridge, toolRegistry: computerTools.registry });
    const task = await loop.start({ ownerId: 'live-computer-smoke', sessionId: 'live-computer-smoke', requestId: 'live-computer-smoke-request', goal: 'Open Google in Chrome. Do not type, log in, or submit anything.' });
    if (task.status !== 'AWAITING_APPROVAL' || !task.pending_action?.action || !['computer_open_website', 'computer_launch_app'].includes(task.pending_action.tool)) {
      throw Object.assign(new Error(`The live model did not produce an approved safe computer action (status: ${task.status}).`), { code: 'unexpected_live_computer_plan' });
    }
    if (mutations !== 0) throw Object.assign(new Error('A computer mutation occurred before owner approval.'), { code: 'approval_bypass' });
    // The owner-visible scope must be explicit and bound to the approved call,
    // never widened by goal keywords such as "Chrome".
    const grantedScope = task.pending_action.action.granted_scope;
    if (!grantedScope || typeof grantedScope !== 'object') {
      throw Object.assign(new Error('The pending computer action is missing its explicit granted scope.'), { code: 'missing_granted_scope' });
    }
    for (const field of ['allowed_tools', 'allowed_apps', 'allowed_sites', 'allowed_hwnds', 'allowed_targets']) {
      if (!Array.isArray(grantedScope[field])) throw Object.assign(new Error(`Granted scope field ${field} is invalid.`), { code: 'invalid_granted_scope' });
    }
    if (task.pending_action.tool === 'computer_open_website') {
      if (JSON.stringify(grantedScope.allowed_sites) !== JSON.stringify(['google']) || grantedScope.allowed_apps.length !== 0) {
        throw Object.assign(new Error('The granted scope must equal the approved website only.'), { code: 'unexpected_granted_scope' });
      }
    } else if (JSON.stringify(grantedScope.allowed_apps) !== JSON.stringify(['chrome']) || grantedScope.allowed_sites.length !== 0) {
      throw Object.assign(new Error('The granted scope must equal the approved app only.'), { code: 'unexpected_granted_scope' });
    }
    process.stdout.write(`${JSON.stringify({
      schema_version: 'solat.live-computer-task-planner-smoke.v1', status: 'PASS', architecture: config.modelArchitecture,
      models: { flash: config.flashModel.model, plus: config.plusModel.model },
      planned_tool: task.pending_action.tool, approval_required: true, computer_mutations_before_approval: 0,
      granted_scope: { allowed_apps: grantedScope.allowed_apps, allowed_sites: grantedScope.allowed_sites, allowed_hwnds: grantedScope.allowed_hwnds },
    }, null, 2)}\n`);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'live_computer_planner_failed', message: error?.message || String(error) })}\n`); process.exitCode = 1; });
