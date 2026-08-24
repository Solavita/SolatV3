const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { ConversationCore } = require('../src/core/conversation-core');
const { AgentService } = require('../src/core/agent-service');
const { AgentChatBridge } = require('../src/core/agent-chat-bridge');
const { FilesystemWorkspace } = require('../src/core/filesystem-workspace');
const { createAgentTools } = require('../src/core/agent-tools');
const { createProvider } = require('../src/core/provider');
const { ModelRouter } = require('../src/core/model-router');

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Live Agent planner smoke is opt-in. Re-run with --execute.');
  const config = readConfig({
    cwd: process.cwd(),
    envFiles: [path.join(process.cwd(), 'dist', 'win-unpacked', '.env')],
  });
  if (!config.flashModel?.apiKey || !config.plusModel?.apiKey) throw Object.assign(new Error('Qwen Flash and Plus are required for live Agent planner smoke.'), { code: 'provider_not_configured' });
  const provider = new ModelRouter({
    flashProvider: createProvider(config.flashModel), plusProvider: createProvider(config.plusModel), mode: config.modelMode,
  });
  const root = await fs.promises.mkdtemp(path.join(process.env.SOLAT_TEST_TMP || os.tmpdir(), 'solat-agent-planner-live-'));
  try {
    const workspace = new FilesystemWorkspace({ rootDir: path.join(root, 'workspace'), exportRoot: path.join(root, 'exports') });
    const tools = createAgentTools({ fileContextProvider: { async build() { return ''; } }, fileWorkspace: workspace });
    const service = new AgentService({ rootDir: path.join(root, 'plans'), toolRegistry: tools.registry, executeTool: tools.executeTool });
    const bridge = new AgentChatBridge({ agentService: service, toolDefinitions: tools.definitions });
    const core = new ConversationCore({ config, provider, agentBridge: bridge, router: { analyze() { return { allowed_tools: [], task: {}, disambiguation: {} }; } } });
    const result = await core.send({
      sessionId: 'live-agent-smoke', requestId: 'live-agent-smoke-request', agentMode: true, agentCommand: 'create-file',
      content: 'Create a text file named live-smoke.txt with the exact content: SAFE PLAN ONLY',
    });
    const action = Array.isArray(result.agentActions) ? result.agentActions[0] : null;
    if (!action || action.status !== 'confirmation_required' || action.tool !== 'filesystem_create') {
      throw Object.assign(new Error('The live model did not produce a reviewable filesystem-create approval action.'), { code: 'unexpected_live_plan' });
    }
    let existsBeforeApproval = false;
    try { await workspace.read({ ownerId: 'live-agent-smoke', sessionId: 'live-agent-smoke', relativePath: 'live-smoke.txt' }); existsBeforeApproval = true; } catch (error) { if (error?.code !== 'file_not_found' && error?.code !== 'ENOENT') throw error; }
    if (existsBeforeApproval) throw Object.assign(new Error('A file was written before owner approval.'), { code: 'approval_bypass' });
    process.stdout.write(`${JSON.stringify({
      schema_version: 'solat.live-agent-planner-smoke.v1', status: 'PASS', architecture: config.modelArchitecture,
      models: { flash: config.flashModel.model, plus: config.plusModel.model },
      planned_tool: action.tool, approval_required: true, file_written_before_approval: false,
    }, null, 2)}\n`);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'live_agent_planner_failed', message: error?.message || String(error) })}\n`); process.exitCode = 1; });
