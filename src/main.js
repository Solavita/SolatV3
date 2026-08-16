const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { readConfig } = require('./core/config');
const { ConversationCore } = require('./core/conversation-core');
const { CreativeWorkflow } = require('./core/creative-workflow');
const { CreativePersistence } = require('./core/creative-persistence');
const { ConversationPersistence } = require('./core/conversation-persistence');
const { AssetStore } = require('./core/asset-store');
const { FileIntakeService } = require('./core/file-intake');
const { FileContextProvider } = require('./core/file-context');
const { exportEditableHtml, inspectEditableHtml } = require('./core/exporter');
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

let mainWindow;
let core;
let creativeWorkflow;
let creativePersistence;
let conversationPersistence;
let assetStore;
let fileIntake;
let fileContextProvider;
let searchService;
let commerceService;
let agentService;
let filesystemWorkspace;
let computerTaskLoop;

function resolveOwnedExportPath(requestedPath) {
  const candidate = String(requestedPath || '').trim();
  if (!candidate) throw Object.assign(new Error('An exported HTML path is required.'), { code: 'invalid_export_path' });
  const resolved = path.resolve(candidate);
  const exportRoot = path.resolve(path.join(app.getPath('userData'), 'exports'));
  const relative = path.relative(exportRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(resolved).toLowerCase() !== 'index.html') {
    throw Object.assign(new Error('Only an exported SOLAT HTML file can be opened.'), { code: 'invalid_export_path' });
  }
  return resolved;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#f7f6f2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.env.SOLAT_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

function registerIpc() {
  ipcMain.handle('solat:status', () => core.status());
  const emitComputerTaskEvent = (event, payload) => {
    if (!event?.sender || event.sender.isDestroyed() || !payload || typeof payload !== 'object') return;
    event.sender.send('solat:computer-task-event', {
      schema_version: payload.schema_version,
      type: payload.type,
      task_id: payload.task_id,
      session_id: payload.session_id,
      request_id: payload.request_id,
      status: payload.status,
      planner_turns: payload.planner_turns,
      observation_count: payload.observation_count,
      revision: payload.revision,
      summary: payload.summary,
      tool: payload.tool,
    });
  };
  ipcMain.handle('solat:send', async (event, request) => {
    try {
      return { ok: true, value: await core.send({ ...request, onComputerTaskEvent: payload => emitComputerTaskEvent(event, payload) }) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'provider_error',
          message: typeof error?.message === 'string' ? error.message : 'The request failed.',
        },
      };
    }
  });
  const agentScope = request => {
    const sessionId = String(request?.sessionId || '').trim();
    if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
    return { ...request, ownerId: sessionId, sessionId };
  };
  const agentCall = async (action, request) => {
    try { return { ok: true, value: await action(agentScope(request)) }; } catch (error) { return { ok: false, error: { code: error?.code || 'agent_error', message: error?.message || 'Agent operation failed.' } }; }
  };
  ipcMain.handle('solat:agent-create', (_event, request) => agentCall(value => agentService.createPlan(value), request));
  ipcMain.handle('solat:agent-inspect', (_event, request) => agentCall(value => agentService.inspect(value), request));
  ipcMain.handle('solat:agent-approve', (_event, request) => agentCall(value => agentService.approve(value), request));
  ipcMain.handle('solat:agent-cancel', (_event, request) => agentCall(value => agentService.cancel(value), request));
  ipcMain.handle('solat:agent-run', (_event, request) => agentCall(value => agentService.run(value), request));
  ipcMain.handle('solat:computer-task-continue', (event, request) => agentCall(async value => {
    const taskId = String(value?.taskId || '').trim();
    const idempotencyKey = String(value?.idempotencyKey || '').trim();
    if (!taskId || !idempotencyKey) throw Object.assign(new Error('A computer task and approved action are required.'), { code: 'invalid_request' });
    // The renderer cannot fabricate a successful observation: reload the
    // owner-scoped persisted plan and pass only its verified tool output.
    const plan = await agentService.inspect({ ownerId: value.ownerId, sessionId: value.sessionId, idempotencyKey });
    const output = plan?.status === 'SUCCEEDED' ? plan.steps?.[0]?.output : null;
    if (!output || output.status !== 'ready') throw Object.assign(new Error('The approved computer action did not return verified evidence.'), { code: 'unverified_observation' });
    return computerTaskLoop.continue({
      ownerId: value.ownerId,
      sessionId: value.sessionId,
      taskId,
      actionIdempotencyKey: idempotencyKey,
      verifiedObservation: output,
      eventSink: payload => emitComputerTaskEvent(event, payload),
    });
  }, request));
  ipcMain.handle('solat:computer-task-approve-and-continue', (event, request) => agentCall(async value => {
    const taskId = String(value?.taskId || '').trim();
    const idempotencyKey = String(value?.idempotencyKey || '').trim();
    const approvalToken = String(value?.approvalToken || '').trim();
    if (!taskId || !idempotencyKey || !approvalToken) throw Object.assign(new Error('A computer task, pending action, and approval token are required.'), { code: 'invalid_request' });
    const before = computerTaskLoop.inspect({ ownerId: value.ownerId, sessionId: value.sessionId, taskId });
    if (before.status !== 'AWAITING_APPROVAL' || before.pending_action?.action?.idempotency_key !== idempotencyKey) {
      throw Object.assign(new Error('This approval does not match the current computer task action.'), { code: 'action_mismatch' });
    }
    await agentService.approve({ ownerId: value.ownerId, sessionId: value.sessionId, idempotencyKey, approvalToken });
    const result = await agentService.run({ ownerId: value.ownerId, sessionId: value.sessionId, idempotencyKey });
    const output = result.plan?.status === 'SUCCEEDED' ? result.plan.steps?.[0]?.output : null;
    if (!output || output.status !== 'ready') throw Object.assign(new Error('The approved computer action did not return verified evidence.'), { code: 'unverified_observation' });
    const nextTask = await computerTaskLoop.continue({
      ownerId: value.ownerId, sessionId: value.sessionId, taskId,
      actionIdempotencyKey: idempotencyKey, verifiedObservation: output,
      eventSink: payload => emitComputerTaskEvent(event, payload),
    });
    return { plan: result.plan, next_task: nextTask };
  }, request));
  ipcMain.handle('solat:computer-task-cancel', (_event, request) => agentCall(value => {
    const taskId = String(value?.taskId || '').trim();
    if (!taskId) throw Object.assign(new Error('A computer task is required.'), { code: 'invalid_request' });
    return computerTaskLoop.cancel({ ownerId: value.ownerId, sessionId: value.sessionId, taskId });
  }, request));
  ipcMain.handle('solat:agent-read-artifact', (_event, request) => agentCall(async value => {
    const relativePath = String(value?.relativePath || '').trim();
    const expectedSha256 = String(value?.expectedSha256 || '').trim();
    if (!relativePath || !/^sha256:[a-f0-9]{64}$/u.test(expectedSha256)) {
      throw Object.assign(new Error('A workspace path and verified SHA-256 are required.'), { code: 'invalid_artifact_request' });
    }
    const artifact = await filesystemWorkspace.read({ ownerId: value.ownerId, sessionId: value.sessionId, relativePath });
    if (artifact.sha256 !== expectedSha256) {
      throw Object.assign(new Error('The workspace file changed after this message was created.'), { code: 'artifact_hash_mismatch' });
    }
    const previewLimit = 200000;
    return {
      schema_version: 'solat.agent-artifact-preview.v1',
      status: 'ready',
      relative_path: artifact.relative_path,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
      content: artifact.content.slice(0, previewLimit),
      truncated: artifact.content.length > previewLimit,
    };
  }, request));
  ipcMain.handle('solat:agent-export-artifact', (_event, request) => agentCall(async value => {
    const relativePath = String(value?.relativePath || '').trim();
    const expectedSha256 = String(value?.expectedSha256 || '').trim();
    const exportName = String(value?.exportName || '').trim();
    if (!relativePath || !exportName || !/^sha256:[a-f0-9]{64}$/u.test(expectedSha256)) {
      throw Object.assign(new Error('A verified workspace file and export name are required.'), { code: 'invalid_artifact_export' });
    }
    // A download is a user-initiated copy to the fixed, owner-scoped export
    // directory. The renderer never chooses an arbitrary local destination.
    return filesystemWorkspace.exportFile({
      ownerId: value.ownerId,
      sessionId: value.sessionId,
      relativePath,
      exportName,
      expectedSha256,
    });
  }, request));
  ipcMain.handle('solat:save-conversation', async (_event, request) => {
    try {
      return { ok: true, value: await conversationPersistence.save(request) };
    } catch (error) {
      return { ok: false, error: { code: typeof error?.code === 'string' ? error.code : 'persistence_write_failed', message: typeof error?.message === 'string' ? error.message : 'Conversation could not be saved.' } };
    }
  });
  ipcMain.handle('solat:load-conversation', async (_event, request) => {
    try {
      return { ok: true, value: await conversationPersistence.load(request) };
    } catch (error) {
      return { ok: false, error: { code: typeof error?.code === 'string' ? error.code : 'persistence_read_failed', message: typeof error?.message === 'string' ? error.message : 'Conversation could not be loaded.' } };
    }
  });
  ipcMain.handle('solat:create-deck', async (_event, request) => {
    try {
      const value = await creativeWorkflow.createDeck(request);
      await creativePersistence.saveResult({ sessionId: request?.sessionId, result: value });
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'workflow_error',
          message: typeof error?.message === 'string' ? error.message : 'The creative workflow failed.',
        },
      };
    }
  });
  ipcMain.handle('solat:load-creative-history', async (_event, request) => {
    try {
      return { ok: true, value: await creativePersistence.loadHistory({ sessionId: request?.sessionId }) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'persistence_read_failed',
          message: typeof error?.message === 'string' ? error.message : 'Creative history could not be loaded.',
        },
      };
    }
  });
  ipcMain.handle('solat:store-original-asset', async (_event, request) => {
    try {
      const sessionId = String(request?.sessionId || '').trim();
      const project = core.workspace.getProject(sessionId);
      const intake = await fileIntake.intake({
        ownerId: sessionId,
        projectId: project.project_id,
        fileName: request?.fileName,
        mimeType: request?.mimeType,
        bytes: request?.bytes,
      });
      const asset = intake.asset;
      core.workspace.linkProject({ sessionId, assetIds: [asset.asset_id] });
      return { ok: true, value: { assetId: asset.asset_id, projectId: asset.project_id, hash: asset.hash, sizeBytes: asset.size_bytes, intakeStatus: intake.status, extraction: intake.extraction } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'asset_storage_error',
          message: typeof error?.message === 'string' ? error.message : 'The original asset could not be stored.',
        },
      };
    }
  });
  ipcMain.handle('solat:export-html', async (_event, request) => {
    try {
      const sessionId = String(request?.sessionId || '').trim();
      const creativeId = String(request?.creativeId || '').trim();
      if (!sessionId || !creativeId) throw Object.assign(new Error('A session and creative result are required.'), { code: 'invalid_request' });
      const result = core.workspace.getArtifact({ sessionId, kind: 'creative_result', artifactId: creativeId });
      const project = core.workspace.getProject(sessionId);
      const storedAssets = Array.isArray(result.artifacts?.assets) ? [...result.artifacts.assets] : [];
      for (const assetId of project.asset_ids || []) {
        try {
          const stored = await assetStore.readOriginal({ ownerId: sessionId, projectId: project.project_id, assetId });
          if (!storedAssets.some(asset => asset.asset_id === stored.asset.asset_id)) storedAssets.push(stored.asset);
        } catch (error) {
          if (error?.code !== 'asset_not_found') throw error;
        }
      }
      const exported = await exportEditableHtml({
        document: result.artifacts?.document,
        designSystem: result.artifacts?.design,
        assets: storedAssets,
        userLocks: result.artifacts?.document?.user_locks || [],
        provenance: { creative_result_id: creativeId, revision_of: result.revisionOf || null, provider: result.provider, model: result.model },
        outputRoot: path.join(app.getPath('userData'), 'exports'),
      });
      await creativePersistence.recordExport({ sessionId, creativeId, exported: { htmlPath: exported.html_path, manifestPath: exported.manifest_path, revision: exported.revision } });
      return { ok: true, value: { format: exported.format, outputDir: exported.output_dir, htmlPath: exported.html_path, manifestPath: exported.manifest_path, documentId: exported.document_id, revision: exported.revision } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'export_error',
          message: typeof error?.message === 'string' ? error.message : 'The editable export failed.',
        },
      };
    }
  });
  ipcMain.handle('solat:open-export', async (_event, request) => {
    try {
      const requestedPath = resolveOwnedExportPath(request?.htmlPath);
      const stat = await fs.promises.stat(requestedPath);
      if (!stat.isFile()) throw Object.assign(new Error('The exported HTML file is not available.'), { code: 'export_not_found' });
      const openError = await shell.openPath(requestedPath);
      if (openError) throw Object.assign(new Error(openError), { code: 'export_open_failed' });
      return { ok: true, value: { htmlPath: requestedPath } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'export_open_failed',
          message: typeof error?.message === 'string' ? error.message : 'The exported HTML could not be opened.',
        },
      };
    }
  });
  ipcMain.handle('solat:inspect-export', async (_event, request) => {
    try {
      const htmlPath = resolveOwnedExportPath(request?.htmlPath);
      const manifestPath = path.join(path.dirname(htmlPath), 'manifest.json');
      const [html, manifestText] = await Promise.all([
        fs.promises.readFile(htmlPath, 'utf8'),
        fs.promises.readFile(manifestPath, 'utf8'),
      ]);
      const manifest = JSON.parse(manifestText);
      const inspection = inspectEditableHtml({ html, manifest });
      const sessionId = String(request?.sessionId || '').trim();
      const creativeId = String(request?.creativeId || '').trim();
      if (!sessionId || !creativeId) throw Object.assign(new Error('A session and creative result are required.'), { code: 'invalid_request' });
      await creativePersistence.recordInspection({ sessionId, creativeId, inspection });
      return { ok: true, value: { htmlPath, manifestPath, inspection } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'export_inspection_failed',
          message: typeof error?.message === 'string' ? error.message : 'The exported HTML could not be inspected.',
        },
      };
    }
  });
}

app.whenReady().then(() => {
  const executableDir = path.dirname(process.execPath);
  const userDataEnv = path.join(app.getPath('userData'), '.env');
  const config = readConfig({
      cwd: app.getAppPath(),
      envFiles: [path.join(executableDir, '.env'), userDataEnv],
    });
  searchService = new WebSearchService({
    provider: config.searchProvider,
    baseUrl: config.searchBaseUrl,
    apiKey: config.searchApiKey,
    timeoutMs: config.searchTimeoutMs,
    resultLimit: config.searchResultLimit,
    wikipediaFallback: config.searchWikipediaFallback,
    engines: config.searchEngines,
  });
  assetStore = new AssetStore({ rootDir: path.join(app.getPath('userData'), 'assets') });
  fileIntake = new FileIntakeService({ assetStore });
  fileContextProvider = new FileContextProvider({ fileIntake });
  filesystemWorkspace = new FilesystemWorkspace({
    rootDir: path.join(app.getPath('userData'), 'agent-workspaces'),
    exportRoot: path.join(app.getPath('userData'), 'agent-exports'),
  });
  const filesystemTools = createAgentTools({ fileContextProvider, fileWorkspace: filesystemWorkspace });
  const computerAdapter = new WinAppComputerUseAdapter();
  const computerTools = createComputerAgentTools({ adapter: computerAdapter });
  const screenCapture = new WindowScreenCapture({
    assertTarget: input => computerAdapter.assertTarget(input),
    tempRoot: path.join(app.getPath('temp'), 'solat-screen-capture'),
  });
  const agentTools = composeAgentTools(filesystemTools, computerTools);
  agentService = new AgentService({
    rootDir: path.join(app.getPath('userData'), 'agent-plans'),
    toolRegistry: agentTools.registry,
    executeTool: agentTools.executeTool,
  });
  const agentBridge = new AgentChatBridge({
    agentService, toolDefinitions: agentTools.definitions,
    targetResolver: ({ hwnd }) => computerAdapter.assertTarget({ hwnd }),
  });
  commerceService = new CommerceClient({
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
  core = new ConversationCore({ config, searchService, commerceService, fileContextProvider, agentBridge });
  computerTaskLoop = new ComputerTaskLoop({ provider: core.provider, bridge: agentBridge, toolRegistry: computerTools.registry, screenCapture });
  core.computerTaskLoop = computerTaskLoop;
  creativePersistence = new CreativePersistence({ rootDir: path.join(app.getPath('userData'), 'creative-history') });
  conversationPersistence = new ConversationPersistence({ rootDir: path.join(app.getPath('userData'), 'conversation-history') });
  creativeWorkflow = new CreativeWorkflow({ provider: core.provider, workspace: core.workspace });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
