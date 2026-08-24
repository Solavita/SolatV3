const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');
const { createProvider } = require('../src/core/provider');
const { ModelRouter } = require('../src/core/model-router');

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Live YouTube planner smoke is opt-in. Re-run with --execute.');
  const config = readConfig({ cwd: process.cwd(), envFiles: [path.join(process.cwd(), 'dist', 'win-unpacked', '.env')] });
  if (!config.flashModel?.apiKey || !config.plusModel?.apiKey) throw Object.assign(new Error('Qwen Flash and Plus are required.'), { code: 'provider_not_configured' });
  const provider = new ModelRouter({
    flashProvider: createProvider(config.flashModel), plusProvider: createProvider(config.plusModel), mode: config.modelMode,
  });
  const root = await fs.promises.mkdtemp(path.join(process.env.SOLAT_TEST_TMP || os.tmpdir(), 'solat-youtube-planner-live-'));
  try {
    // No computer action is executed in this smoke: the bridge must stop at
    // the owner-approval plan before any adapter method can run.
    const computerTools = createComputerAgentTools({ adapter: { async listWindows() { return { status: 'ready', windows: [] }; } } });
    const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: computerTools.registry, executeTool: computerTools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: computerTools.definitions });
    const core = new ConversationCore({ config, provider, agentBridge: bridge, router: { analyze() { return { allowed_tools: [], task: {}, disambiguation: {} }; } } });
    const result = await core.send({
      sessionId: 'live-youtube-smoke', requestId: 'live-youtube-smoke-request', agentMode: true, agentCommand: 'computer-use',
      content: 'Open YouTube and play the song Lllies.',
    });
    const action = Array.isArray(result.agentActions) ? result.agentActions[0] : null;
    if (!action || action.status !== 'confirmation_required' || action.tool !== 'computer_play_youtube_music' || action.arguments?.query !== 'Lllies') {
      throw Object.assign(new Error('The live model did not create the expected reviewable YouTube playback action.'), { code: 'unexpected_live_youtube_plan' });
    }
    process.stdout.write(`${JSON.stringify({ schema_version: 'solat.live-youtube-planner-smoke.v1', status: 'PASS', architecture: config.modelArchitecture, models: { flash: config.flashModel.model, plus: config.plusModel.model }, planned_tool: action.tool, query: action.arguments.query, approval_required: true, computer_mutations_before_approval: 0 }, null, 2)}\n`);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'live_youtube_planner_failed', message: error?.message || String(error)})}\n`); process.exitCode = 1; });
