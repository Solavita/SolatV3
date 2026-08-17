const path = require('node:path');
const fs = require('node:fs');
const { exportEditableHtml, inspectEditableHtml } = require('./core/exporter');

// Every channel keeps its original name and error envelope. Electron globals
// are injected so the router stays testable under plain node --test.
function resolveOwnedExportPath(requestedPath, exportRoot) {
  const candidate = String(requestedPath || '').trim();
  if (!candidate) throw Object.assign(new Error('An exported HTML path is required.'), { code: 'invalid_export_path' });
  const resolved = path.resolve(candidate);
  const normalizedRoot = path.resolve(exportRoot);
  const relative = path.relative(normalizedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(resolved).toLowerCase() !== 'index.html') {
    throw Object.assign(new Error('Only an exported SOLAT HTML file can be opened.'), { code: 'invalid_export_path' });
  }
  return resolved;
}

function registerSolatIpc({ ipcMain, services, exportRoot, shellOpenPath, fsImpl = fs.promises }) {
  const { core, computerTaskLoop, agentService, filesystemWorkspace, conversationPersistence, creativePersistence, creativeWorkflow, assetStore, fileIntake } = services;
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
  // A failed verified observation must keep its real cause visible; the
  // generic envelope alone hides the adapter/CLI failure from the owner.
  const unverifiedObservation = failure => {
    const detail = failure?.code ? ` (${failure.code}: ${String(failure.message || 'no detail').slice(0, 300)})` : '';
    return Object.assign(new Error(`The approved computer action did not return verified evidence.${detail}`), { code: 'unverified_observation' });
  };
  ipcMain.handle('solat:agent-create', (_event, request) => agentCall(value => agentService.createPlan(value), request));
  ipcMain.handle('solat:agent-inspect', (_event, request) => agentCall(value => agentService.inspect(value), request));
  ipcMain.handle('solat:agent-approve', (_event, request) => agentCall(value => agentService.approve(value), request));
  ipcMain.handle('solat:agent-cancel', (_event, request) => agentCall(value => agentService.cancel(value), request));
  ipcMain.handle('solat:agent-run', (_event, request) => agentCall(value => agentService.run(value), request));
  ipcMain.handle('solat:agent-interrupted-plans', (_event, request) => agentCall(value => agentService.collectInterrupted(value), request));
  ipcMain.handle('solat:computer-task-continue', (event, request) => agentCall(async value => {
    const taskId = String(value?.taskId || '').trim();
    const idempotencyKey = String(value?.idempotencyKey || '').trim();
    if (!taskId || !idempotencyKey) throw Object.assign(new Error('A computer task and approved action are required.'), { code: 'invalid_request' });
    // The renderer cannot fabricate a successful observation: reload the
    // owner-scoped persisted plan and pass only its verified tool output.
    const plan = await agentService.inspect({ ownerId: value.ownerId, sessionId: value.sessionId, idempotencyKey });
    const output = plan?.status === 'SUCCEEDED' ? plan.steps?.[0]?.output : null;
    if (!output || output.status !== 'ready') throw unverifiedObservation(plan?.failure);
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
    if (!output || output.status !== 'ready') throw unverifiedObservation(result.plan?.failure);
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
        outputRoot: exportRoot,
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
      const requestedPath = resolveOwnedExportPath(request?.htmlPath, exportRoot);
      const stat = await fsImpl.stat(requestedPath);
      if (!stat.isFile()) throw Object.assign(new Error('The exported HTML file is not available.'), { code: 'export_not_found' });
      const openError = await shellOpenPath(requestedPath);
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
      const htmlPath = resolveOwnedExportPath(request?.htmlPath, exportRoot);
      const manifestPath = path.join(path.dirname(htmlPath), 'manifest.json');
      const [html, manifestText] = await Promise.all([
        fsImpl.readFile(htmlPath, 'utf8'),
        fsImpl.readFile(manifestPath, 'utf8'),
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

module.exports = { registerSolatIpc, resolveOwnedExportPath };
