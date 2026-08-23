const path = require('node:path');
const { ConversationCore } = require('./core/conversation-core');
const { CreativeWorkflow } = require('./core/creative-workflow');
const { CreativePersistence } = require('./core/creative-persistence');
const { ConversationPersistence } = require('./core/conversation-persistence');
const { AssetStore } = require('./core/asset-store');
const { FileIntakeService } = require('./core/file-intake');
const { FileContextProvider } = require('./core/file-context');
const { WebSearchService } = require('./core/web-search');
const { CommerceClient } = require('./core/commerce-client');
const { AgentService } = require('./core/agent-service');
const { createAgentTools } = require('./core/agent-tools');
const { FilesystemWorkspace } = require('./core/filesystem-workspace');
const { WinAppComputerUseAdapter } = require('./core/computer-use-adapter');
const { createComputerAgentTools } = require('./core/computer-agent-tools');
const { composeAgentTools } = require('./core/agent-tool-composer');
const { AgentChatBridge } = require('./core/agent-chat-bridge');
const { ComputerTaskLoop } = require('./core/computer-task-loop');
const { WindowScreenCapture } = require('./core/computer-screen-capture');
const { AdaptiveScreenSampler } = require('./core/adaptive-screen-sampler');
const { createProvider } = require('./core/provider');
const { GroundingProvider } = require('./core/grounding-provider');
const { ModelRouter } = require('./core/model-router');

// Composition root for the main process. Everything is wired here once; the
// Electron shell in main.js only supplies paths and lifecycle.
function createSolatServices({ config, userDataDir, tempDir }) {
  const visionProvider = config.visionModel?.enabled === true
    && config.visionModel.baseUrl && config.visionModel.model
    ? new GroundingProvider({ transport: createProvider(config.visionModel) })
    : null;
  const provider = new ModelRouter({
    localProvider: createProvider(config.localModel),
    deepseekProvider: createProvider(config),
    visionProvider,
    mode: config.modelMode,
  });
  const searchService = new WebSearchService({
    provider: config.searchProvider,
    baseUrl: config.searchBaseUrl,
    apiKey: config.searchApiKey,
    timeoutMs: config.searchTimeoutMs,
    resultLimit: config.searchResultLimit,
    wikipediaFallback: config.searchWikipediaFallback,
    engines: config.searchEngines,
  });
  const assetStore = new AssetStore({ rootDir: path.join(userDataDir, 'assets') });
  const fileIntake = new FileIntakeService({ assetStore });
  const fileContextProvider = new FileContextProvider({ fileIntake });
  const filesystemWorkspace = new FilesystemWorkspace({
    rootDir: path.join(userDataDir, 'agent-workspaces'),
    exportRoot: path.join(userDataDir, 'agent-exports'),
  });
  const filesystemTools = createAgentTools({ fileContextProvider, fileWorkspace: filesystemWorkspace });
  const computerAdapter = new WinAppComputerUseAdapter();
  const computerTools = createComputerAgentTools({ adapter: computerAdapter });
  const screenCapture = new WindowScreenCapture({
    assertTarget: input => computerAdapter.assertTarget(input),
    tempRoot: path.join(tempDir, 'solat-screen-capture'),
  });
  const screenSampler = new AdaptiveScreenSampler({ screenCapture });
  const agentTools = composeAgentTools(filesystemTools, computerTools);
  const agentService = new AgentService({
    rootDir: path.join(userDataDir, 'agent-plans'),
    toolRegistry: agentTools.registry,
    executeTool: agentTools.executeTool,
  });
  const agentBridge = new AgentChatBridge({
    agentService, toolDefinitions: agentTools.definitions,
    targetResolver: ({ hwnd }) => computerAdapter.assertTarget({ hwnd }),
  });
  const commerceService = new CommerceClient({
    baseUrl: config.commerceBaseUrl,
    userId: config.commerceUserId,
    token: config.commerceToken,
    timeoutMs: config.commerceTimeoutMs,
    assetResolver: async ({ sessionId, assetId }) => {
      const normalizedSession = String(sessionId || '').trim();
      if (!normalizedSession) throw Object.assign(new Error('A session is required to read an attached asset.'), { code: 'invalid_session' });
      const project = core.workspace.getProject(normalizedSession);
      return assetStore.readOriginal({ ownerId: normalizedSession, projectId: project.project_id, assetId });
    },
  });
  const core = new ConversationCore({ config, provider, searchService, commerceService, fileContextProvider, agentBridge });
  const computerTaskLoop = new ComputerTaskLoop({
    provider: core.provider, bridge: agentBridge, toolRegistry: computerTools.registry,
    toolDefinitions: computerTools.definitions,
    screenCapture, screenSampler,
  });
  core.computerTaskLoop = computerTaskLoop;
  const creativePersistence = new CreativePersistence({ rootDir: path.join(userDataDir, 'creative-history') });
  const conversationPersistence = new ConversationPersistence({ rootDir: path.join(userDataDir, 'conversation-history') });
  const creativeWorkflow = new CreativeWorkflow({ provider: core.provider, workspace: core.workspace });
  return {
    core,
    computerTaskLoop,
    agentService,
    filesystemWorkspace,
    conversationPersistence,
    creativePersistence,
    creativeWorkflow,
    assetStore,
    fileIntake,
  };
}

module.exports = { createSolatServices };
