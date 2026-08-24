const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
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

function registerSolatIpc({ ipcMain, services, exportRoot, shellOpenPath, spatialOverlay = null, browserWorkspace = null, chromeAssetImport = null, chromeControl = null, chromeExtensionPath = null, revealChromeExtension = null, handDisplayResolver = null, multimodalOwnerId = null, fsImpl = fs.promises }) {
  const { core, computerTaskLoop, agentService, filesystemWorkspace, conversationPersistence, creativePersistence, creativeWorkflow, assetStore, fileIntake, voiceService, spatialMemory, spatialAssetRuntime, multimodalCoordinator, handInputService } = services;
  // Renderer ownership is a main-process principal. A renderer-controlled
  // session id is only a conversation key and must never authorize another
  // renderer to inspect, focus, or mutate an active capture, Agent plan, or
  // Computer Task. Keep the principal derivation in one place so every IPC
  // boundary uses the sender supplied by Electron rather than request data.
  const rendererPrincipal = (event, errorCode = 'renderer_sender_unavailable') => {
    const senderId = event?.sender?.id;
    const normalized = String(senderId ?? '').trim();
    if (!normalized || normalized.length > 64 || !/^\d+$/.test(normalized)) {
      throw Object.assign(new Error('The renderer identity is unavailable.'), { code: errorCode });
    }
    return `renderer:${normalized}`;
  };
  const spatialOwnerPrincipal = event => rendererPrincipal(event, 'spatial_sender_unavailable');
  const durableMultimodalOwner = multimodalOwnerId === null ? null : String(multimodalOwnerId || '').trim();
  if (durableMultimodalOwner !== null && (!durableMultimodalOwner || durableMultimodalOwner.length > 160 || /[\u0000-\u001f\u007f]/u.test(durableMultimodalOwner))) {
    throw new TypeError('multimodalOwnerId must be a bounded main-process owner principal.');
  }
  // Electron webContents ids authenticate a live renderer but are deliberately
  // not persistence identities: Electron may assign a different id after an
  // application restart. Production supplies a profile-scoped principal from
  // main. Tests/legacy callers without one retain the stricter per-renderer
  // scope, so no renderer-provided owner value is ever trusted.
  const multimodalOwnerPrincipal = (event, errorCode = 'multimodal_sender_unavailable') => {
    const livePrincipal = rendererPrincipal(event, errorCode);
    return durableMultimodalOwner || livePrincipal;
  };
  // Plain node tests and a few legacy direct invocations do not have an
  // Electron event. Real renderer IPC always does; the null result lets the
  // core preserve that narrow compatibility path without trusting a
  // renderer-provided ownerId.
  const rendererPrincipalIfPresent = event => event?.sender?.id === undefined ? null : rendererPrincipal(event);
  const recordMultimodal = async (input, scope) => {
    if (!multimodalCoordinator?.record) return null;
    return multimodalCoordinator.record(input, scope);
  };
  const spatialAssetCapabilities = new Map();
  ipcMain.handle('solat:status', () => core.status());
  const voiceOwners = new Map();
  // Final STT events become grounding evidence only after they cross this
  // owner-bound main-process callback. Keep the timestamp keyed by renderer,
  // voice session, and exact transcript so a renderer cannot fabricate it.
  const voiceFinals = new Map();
  const voiceFinalKey = (senderId, sessionId, transcript) => `${String(senderId)}\u0000${String(sessionId)}\u0000${String(transcript)}`;
  const voiceSessionPrefix = (senderId, sessionId) => `${String(senderId)}\u0000${String(sessionId)}\u0000`;
  const clearVoiceFinals = (senderId, sessionId = null) => {
    const prefix = sessionId === null ? `${String(senderId)}\u0000` : voiceSessionPrefix(senderId, sessionId);
    for (const key of voiceFinals.keys()) if (key.startsWith(prefix)) voiceFinals.delete(key);
  };
  const rememberVoiceFinal = (senderId, payload) => {
    const sessionId = String(payload?.session_id || '').trim();
    const transcript = String(payload?.transcript || '').trim();
    const utteranceId = String(payload?.utterance_id || '').trim();
    const receivedAtMs = Number(payload?.received_at_ms);
    if (!sessionId || !transcript || transcript.length > 12000 || !utteranceId || utteranceId.length > 160
      || !Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) return;
    voiceFinals.set(voiceFinalKey(senderId, sessionId, transcript), Object.freeze({ sessionId, transcript, utteranceId, receivedAtMs }));
  };
  const watchedVoiceSenders = new WeakSet();
  const safelyCancelVoiceSession = sessionId => {
    for (const cancel of [voiceService.cancelSTT, voiceService.cancelTTS]) {
      try {
        const pending = cancel.call(voiceService, { sessionId });
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch {
        // A renderer teardown must always release ownership. Provider cleanup
        // is best-effort because the underlying socket may already be gone.
      }
    }
  };
  const releaseVoiceSender = senderId => {
    for (const [sessionId, ownerId] of voiceOwners) {
      if (ownerId !== senderId) continue;
      voiceOwners.delete(sessionId);
      safelyCancelVoiceSession(sessionId);
    }
    clearVoiceFinals(senderId);
  };
  const watchVoiceSender = event => {
    const sender = event?.sender;
    if (!sender || typeof sender !== 'object' || typeof sender.once !== 'function' || watchedVoiceSenders.has(sender)) return;
    watchedVoiceSenders.add(sender);
    const senderId = sender.id ?? 0;
    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      if (typeof sender.removeListener === 'function') {
        sender.removeListener('destroyed', cleanup);
        sender.removeListener('closed', cleanup);
      }
      releaseVoiceSender(senderId);
    };
    sender.once('destroyed', cleanup);
    sender.once('closed', cleanup);
  };
  const voiceSession = (event, request, { claim = false } = {}) => {
    const sessionId = String(request?.sessionId || '').trim();
    if (!sessionId) throw Object.assign(new Error('A voice session id is required.'), { code: 'invalid_voice_session' });
    const senderId = event?.sender?.id ?? 0;
    const owner = voiceOwners.get(sessionId);
    if (owner !== undefined && owner !== senderId) throw Object.assign(new Error('This voice session belongs to another window.'), { code: 'voice_session_forbidden' });
    if (claim) {
      voiceOwners.set(sessionId, senderId);
      watchVoiceSender(event);
    }
    return sessionId;
  };
  const voiceCall = async (event, request, action, options) => {
    try {
      const sessionId = voiceSession(event, request, options);
      return { ok: true, value: await action({ ...request, sessionId }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'voice_error', message: error?.message || 'The voice operation failed.' } };
    }
  };
  ipcMain.handle('solat:voice-status', () => voiceService.status());
  const watchedHandSenders = new WeakSet();
  const watchHandSender = event => {
    const sender = event?.sender;
    if (!sender?.once || watchedHandSenders.has(sender)) return;
    watchedHandSenders.add(sender);
    const ownerId = rendererPrincipal(event, 'hand_sender_unavailable');
    let released = false;
    const cleanup = () => {
      if (released) return; released = true;
      sender.removeListener?.('destroyed', cleanup); sender.removeListener?.('closed', cleanup);
      handInputService?.disposeOwner?.(ownerId);
    };
    sender.once('destroyed', cleanup); sender.once('closed', cleanup);
  };
  ipcMain.handle('solat:voice-start-stt', (event, request) => voiceCall(event, request, input => {
    clearVoiceFinals(event?.sender?.id ?? 0, input.sessionId);
    return voiceService.startSTT({
      ...input,
      onEvent: payload => {
        if (!event?.sender || event.sender.isDestroyed?.() || !payload || typeof payload !== 'object') return;
        if (payload.schema_version !== 'solat.voice-provider-event.v1' || payload.session_id !== input.sessionId) return;
        // The receive time is generated here, never accepted from Cartesia or
        // the renderer, and is included only on final events.
        const forwarded = payload.type === 'final' ? { ...payload, received_at_ms: Date.now() } : payload;
        if (forwarded.type === 'final') rememberVoiceFinal(event.sender.id ?? 0, forwarded);
        event.sender.send('solat:voice-event', forwarded);
      },
    });
  }, { claim: true }));
  ipcMain.handle('solat:voice-push-stt', (event, request) => voiceCall(event, request, input => voiceService.pushSTT(input)));
  ipcMain.handle('solat:voice-stop-stt', (event, request) => voiceCall(event, request, input => voiceService.stopSTT(input)));
  ipcMain.handle('solat:voice-cancel-stt', (event, request) => voiceCall(event, request, input => voiceService.cancelSTT(input)));
  ipcMain.handle('solat:voice-speak', (event, request) => voiceCall(event, request, input => voiceService.speak(input), { claim: true }));
  ipcMain.handle('solat:voice-cancel-tts', (event, request) => voiceCall(event, request, input => voiceService.cancelTTS(input)));
  ipcMain.handle('solat:voice-dispose', async (event, request) => {
    const result = await voiceCall(event, request, input => {
      voiceService.cancelSTT(input);
      voiceService.cancelTTS(input);
      return true;
    });
    if (result.ok) {
      const sessionId = String(request?.sessionId || '').trim();
      voiceOwners.delete(sessionId);
      clearVoiceFinals(event?.sender?.id ?? 0, sessionId);
    }
    return result;
  });
  const handCall = async (event, request, action) => {
    try {
      if (!handInputService) throw Object.assign(new Error('Hand input is unavailable.'), { code: 'hand_input_unavailable' });
      const ownerId = rendererPrincipal(event, 'hand_sender_unavailable');
      const sessionId = String(request?.sessionId || '').trim();
      if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
      return { ok: true, value: await action({ ownerId, sessionId, request: request || {} }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'hand_input_error', message: error?.message || 'Hand input failed.' } };
    }
  };
  ipcMain.handle('solat:hand-status', (event, request) => handCall(event, request, scope => handInputService.status(scope)));
  ipcMain.handle('solat:hand-start', (event, request) => handCall(event, request, scope => {
    const resolvedDisplay = handDisplayResolver?.(event?.sender);
    if (!resolvedDisplay) throw Object.assign(new Error('The active display could not be resolved.'), { code: 'hand_display_unavailable' });
    watchHandSender(event);
    return handInputService.start({ ...scope, contextId: String(scope.request?.contextId || '').trim(), display: resolvedDisplay });
  }));
  ipcMain.handle('solat:hand-frame', (event, request) => handCall(event, request, async scope => {
    const value = handInputService.frame({ ...scope, frame: scope.request?.frame });
    for (const handEvent of value.events || []) {
      const point = handEvent.points?.at(-1);
      await recordMultimodal({
        event_id: `hand:${handEvent.event_id}`, source: 'hand', type: 'spatial_point', occurred_at_ms: handEvent.ended_at_ms,
        payload: { event_id: handEvent.event_id, context_id: handEvent.context_id, gesture: handEvent.gesture, x: point?.x, y: point?.y, confidence: handEvent.confidence },
      }, { ownerId: multimodalOwnerPrincipal(event, 'hand_sender_unavailable'), sessionId: scope.sessionId });
      if (event?.sender && !event.sender.isDestroyed?.()) event.sender.send?.('solat:hand-event', handEvent);
    }
    return value;
  }));
  ipcMain.handle('solat:hand-stop', (event, request) => handCall(event, request, scope => handInputService.stop(scope)));
  ipcMain.handle('solat:set-model-mode', (_event, mode) => {
    try {
      if (!core.provider || typeof core.provider.setMode !== 'function') throw Object.assign(new Error('Model selection is unavailable.'), { code: 'model_mode_unavailable' });
      return { ok: true, value: core.provider.setMode(mode) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'invalid_model_mode', message: error?.message || 'Model mode could not be changed.' } };
    }
  });
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
      provider_calls: payload.provider_calls,
      actions_started: payload.actions_started,
      revision: payload.revision,
      summary: payload.summary,
      tool: payload.tool,
      elapsed_ms: payload.elapsed_ms,
    });
  };
  ipcMain.handle('solat:send', async (event, request) => {
    try {
      const sessionId = String(request?.sessionId || '').trim();
      const ownerId = rendererPrincipalIfPresent(event);
      const multimodalOwner = ownerId ? multimodalOwnerPrincipal(event) : null;
      if (ownerId && browserWorkspace?.registerOwner) browserWorkspace.registerOwner(ownerId, event.sender);
      const senderId = event?.sender?.id ?? 0;
      const voiceSessionId = String(request?.voiceSessionId || '').trim();
      const voiceUtteranceId = String(request?.voiceUtteranceId || '').trim();
      const voiceTranscript = String(request?.content || '').trim();
      const claimedVoiceAtMs = request?.voiceFinalAtMs === undefined || request?.voiceFinalAtMs === null
        ? null : Number(request.voiceFinalAtMs);
      let verifiedVoiceAtMs = null;
      if (voiceSessionId && voiceUtteranceId && voiceTranscript && voiceSessionId.length <= 160 && voiceUtteranceId.length <= 160
        && Number.isSafeInteger(claimedVoiceAtMs === null ? 0 : claimedVoiceAtMs)) {
        const key = voiceFinalKey(senderId, voiceSessionId, voiceTranscript);
        const final = voiceFinals.get(key);
        if (final && final.sessionId === voiceSessionId && final.transcript === voiceTranscript && final.utteranceId === voiceUtteranceId
          && (claimedVoiceAtMs === null || claimedVoiceAtMs === final.receivedAtMs)) {
          verifiedVoiceAtMs = final.receivedAtMs;
          // A final utterance is consumed once. Retries must not silently
          // re-ground themselves on an already-submitted speech event.
          voiceFinals.delete(key);
        }
      }
      const spatialContext = ownerId ? spatialMemory?.contextFor?.({
        ownerId,
        sessionId,
        text: request?.content,
        ...(verifiedVoiceAtMs === null ? {} : { atMs: verifiedVoiceAtMs }),
      }) : null;
      const spatialAssetContext = ownerId ? spatialAssetRuntime?.resolveReference?.({
        ownerId,
        sessionId,
        text: request?.content,
      }) : null;
      if (ownerId && verifiedVoiceAtMs !== null) await recordMultimodal({
        event_id: `voice:${voiceUtteranceId}`,
        source: 'voice', type: 'voice_final', occurred_at_ms: verifiedVoiceAtMs,
        payload: { context_id: voiceSessionId },
      }, { ownerId: multimodalOwner, sessionId });
      const multimodalContext = multimodalOwner && multimodalCoordinator?.contextFor
        ? await multimodalCoordinator.contextFor({ ownerId: multimodalOwner, sessionId, text: request?.content, ...(verifiedVoiceAtMs === null ? {} : { atMs: verifiedVoiceAtMs }) })
        : null;
      // Voice turns are internal input, not typed chat: the source label is
      // granted here only when a main-stamped STT final was verified above.
      const inputSource = verifiedVoiceAtMs === null ? 'text' : 'voice';
      const streamRequestId = String(request?.requestId || '').trim();
      const onAssistantDelta = request?.streamResponse === true && streamRequestId
        ? delta => {
          if (!event?.sender || event.sender.isDestroyed?.() || typeof delta !== 'string' || !delta) return;
          try {
            event.sender.send('solat:assistant-delta', {
              schema_version: 'solat.assistant-delta.v1',
              requestId: streamRequestId,
              delta: delta.slice(0, 4096),
            });
          } catch { /* a lost delta must never fail the provider response */ }
        }
        : null;
      return { ok: true, value: await core.send({ ...request, ownerId, spatialContext, spatialAssetContext, multimodalContext, inputSource, onAssistantDelta, onComputerTaskEvent: payload => emitComputerTaskEvent(event, payload) }) };
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
  ipcMain.handle('solat:spatial-open', async (event, request) => {
    try {
      if (!spatialOverlay?.open) throw Object.assign(new Error('Spatial input is unavailable.'), { code: 'spatial_unavailable' });
      const sessionId = String(request?.sessionId || '').trim();
      if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
      return { ok: true, value: await spatialOverlay.open({
        sender: event?.sender,
        ownerId: spatialOwnerPrincipal(event),
        sessionId,
        contextId: String(request?.contextId || '').trim(),
        gesture: String(request?.gesture || 'lasso').trim(),
      }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'spatial_error', message: error?.message || 'Spatial input could not start.' } };
    }
  });
  ipcMain.handle('solat:spatial-complete', async (event, request) => {
    try {
      if (!spatialOverlay?.complete) throw Object.assign(new Error('Spatial input is unavailable.'), { code: 'spatial_unavailable' });
      const captured = await spatialOverlay.complete({ sender: event?.sender, request });
      const value = spatialMemory.record(captured.event, captured.scope);
      await recordMultimodal({
        event_id: `spatial:${value.event_id}`, source: 'pointer', type: 'spatial_point', occurred_at_ms: value.ended_at_ms,
        payload: { event_id: value.event_id, context_id: value.context_id, gesture: value.gesture, x: value.bounds.x, y: value.bounds.y },
      }, { ownerId: multimodalOwnerPrincipal(event, 'spatial_sender_unavailable'), sessionId: captured.scope.sessionId });
      captured.commit?.(value);
      return { ok: true, value: { schema_version: value.schema_version, event_id: value.event_id, gesture: value.gesture, bounds: value.bounds } };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'spatial_error', message: error?.message || 'Spatial input could not be saved.' } };
    }
  });
  ipcMain.handle('solat:spatial-cancel', async (event, request) => {
    try {
      return { ok: true, value: await spatialOverlay?.cancel?.({ sender: event?.sender, request }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'spatial_error', message: error?.message || 'Spatial input could not be cancelled.' } };
    }
  });
  const spatialAssetCall = async (event, request, action) => {
    try {
      if (!spatialAssetRuntime) throw Object.assign(new Error('Spatial assets are unavailable.'), { code: 'spatial_asset_unavailable' });
      const ownerId = rendererPrincipal(event, 'spatial_asset_sender_unavailable');
      const sessionId = String(request?.sessionId || '').trim();
      if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
      const value = await action({ ownerId, sessionId, request: request || {} });
      const eventValue = value?.event || (value?.schema_version === 'solat.spatial-transfer-event.v1' ? value : null);
      const insertion = value?.insertion || (value?.schema_version === 'solat.spatial-insertion.v1' ? value : null);
      const fusionType = insertion ? 'asset_inserted'
        : eventValue?.type === 'selected' ? 'asset_selected'
          : ['drag_started', 'drag_moved', 'surface_switched', 'dropped'].includes(eventValue?.type) ? 'asset_dragged' : null;
      if (fusionType) await recordMultimodal({
        event_id: `asset:${eventValue?.event_id || insertion?.insertion_id}`,
        source: 'asset', type: fusionType,
        occurred_at_ms: Number(eventValue?.occurred_at_ms || insertion?.inserted_at_ms || Date.now()),
        payload: {
          spatial_asset_id: insertion?.spatial_asset_id || eventValue?.spatial_asset_id,
          insertion_id: insertion?.insertion_id,
          surface_id: insertion?.target_surface?.surface_id || eventValue?.target_surface?.surface_id || eventValue?.surface?.surface_id,
        },
      }, { ownerId: multimodalOwnerPrincipal(event, 'spatial_asset_sender_unavailable'), sessionId });
      if (event?.sender && !event.sender.isDestroyed?.()) event.sender.send?.('solat:spatial-asset-event', value);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'spatial_asset_error', message: error?.message || 'The spatial asset operation failed.' } };
    }
  };
  ipcMain.handle('solat:spatial-asset-register', (event, request) => spatialAssetCall(event, request, async scope => {
    const assetId = String(scope.request?.assetId || '').trim();
    if (!assetId) throw Object.assign(new Error('An original asset id is required.'), { code: 'invalid_request' });
    const capability = String(scope.request?.spatialCapability || '').trim();
    const authority = spatialAssetCapabilities.get(capability);
    if (!capability || !authority || Date.now() - authority.createdAtMs > 600000 || authority.ownerId !== scope.ownerId || authority.sessionId !== scope.sessionId || authority.assetId !== assetId) {
      if (capability) spatialAssetCapabilities.delete(capability);
      throw Object.assign(new Error('The original asset is not authorized for this renderer session.'), { code: 'spatial_asset_forbidden' });
    }
    const project = core.workspace.getProject(scope.sessionId);
    const stored = await assetStore.readOriginal({ ownerId: scope.sessionId, projectId: project.project_id, assetId });
    const registered = spatialAssetRuntime.register({
      spatial_asset_id: String(scope.request?.spatialAssetId || '').trim() || undefined,
      project_id: project.project_id,
      label: String(scope.request?.label || '').trim() || undefined,
      original: {
        asset_id: stored.asset.asset_id,
        hash: stored.asset.hash,
        mime_type: stored.asset.mime_type,
        width: scope.request?.width,
        height: scope.request?.height,
      },
      provenance: { source_kind: 'original_user_asset' },
    }, scope);
    spatialAssetCapabilities.delete(capability);
    return registered;
  }));
  ipcMain.handle('solat:spatial-asset-select', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.select({
    ...scope, spatialAssetId: scope.request?.spatialAssetId, surface: scope.request?.surface,
  })));
  ipcMain.handle('solat:spatial-asset-begin', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.beginDrag({
    ...scope, spatialAssetId: scope.request?.spatialAssetId, surface: scope.request?.surface, pointer: scope.request?.pointer,
    transform: scope.request?.transform, inputSource: scope.request?.inputSource,
  })));
  ipcMain.handle('solat:spatial-asset-move', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.moveGhost({
    ...scope, ghostId: scope.request?.ghostId, pointer: scope.request?.pointer, transform: scope.request?.transform,
  })));
  ipcMain.handle('solat:spatial-asset-switch', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.switchSurface({
    ...scope, ghostId: scope.request?.ghostId, targetSurface: scope.request?.targetSurface, pointer: scope.request?.pointer,
  })));
  ipcMain.handle('solat:spatial-asset-drop', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.drop({
    ...scope, ghostId: scope.request?.ghostId, targetSurface: scope.request?.targetSurface, pointer: scope.request?.pointer,
    transform: scope.request?.transform,
  })));
  ipcMain.handle('solat:spatial-asset-cancel', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.cancel({
    ...scope, ghostId: scope.request?.ghostId,
  })));
  ipcMain.handle('solat:spatial-asset-memory', (event, request) => spatialAssetCall(event, request, scope => spatialAssetRuntime.memory(scope)));
  ipcMain.handle('solat:multimodal-undo', async (event, request) => {
    try {
      if (!multimodalCoordinator?.undo) throw Object.assign(new Error('Multimodal memory is unavailable.'), { code: 'multimodal_unavailable' });
      const ownerId = multimodalOwnerPrincipal(event, 'multimodal_sender_unavailable');
      const sessionId = String(request?.sessionId || '').trim();
      if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
      return { ok: true, value: await multimodalCoordinator.undo({ ownerId, sessionId, eventId: request?.eventId }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'multimodal_error', message: error?.message || 'Multimodal undo failed.' } };
    }
  });
  const browserCall = async (event, action, request) => {
    try {
      if (!browserWorkspace) throw Object.assign(new Error('Browser Workspace is unavailable.'), { code: 'browser_workspace_unavailable' });
      const ownerId = rendererPrincipal(event, 'browser_sender_unavailable');
      browserWorkspace.registerOwner?.(ownerId, event.sender);
      return { ok: true, value: await action({ ownerId, request: request || {} }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'browser_workspace_error', message: error?.message || 'Browser Workspace failed.' } };
    }
  };
  ipcMain.handle('solat:browser-open', (event, request) => browserCall(event, value => browserWorkspace.openForOwner(value), request));
  ipcMain.handle('solat:browser-status', (event, request) => browserCall(event, value => browserWorkspace.status(value), request));
  ipcMain.handle('solat:browser-observe', (event, request) => browserCall(event, value => browserWorkspace.observe(value), request));
  ipcMain.handle('solat:browser-navigate', (event, request) => browserCall(event, value => browserWorkspace.navigate(value), request));
  ipcMain.handle('solat:browser-takeover', (event, request) => browserCall(event, value => browserWorkspace.takeover(value), request));
  ipcMain.handle('solat:browser-return-control', (event, request) => browserCall(event, value => browserWorkspace.returnControl(value), request));
  ipcMain.handle('solat:browser-close', (event, request) => browserCall(event, value => browserWorkspace.close(value), request));
  ipcMain.handle('solat:browser-shell-command', async (event, request) => {
    try {
      if (!browserWorkspace?.shellCommand) throw Object.assign(new Error('Browser Workspace is unavailable.'), { code: 'browser_workspace_unavailable' });
      return { ok: true, value: await browserWorkspace.shellCommand(event?.sender, request || {}) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'browser_workspace_error', message: error?.message || 'Browser Workspace failed.' } };
    }
  });
  ipcMain.handle('solat:chrome-asset-import', async (event, request) => {
    try {
      if (typeof chromeAssetImport !== 'function') throw Object.assign(new Error('Chrome image transfer is unavailable.'), { code: 'chrome_asset_unavailable' });
      const ownerId = rendererPrincipal(event, 'chrome_asset_sender_unavailable');
      return { ok: true, value: await chromeAssetImport({ ownerId, sender: event?.sender, request: request || {} }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || 'chrome_asset_error', message: error?.message || 'Chrome image transfer failed.' } };
    }
  });
  const chromeControlCall = async (event, action, request, fallbackCode = 'chrome_control_error') => {
    try {
      if (!chromeControl) throw Object.assign(new Error('Chrome Control is unavailable.'), { code: 'chrome_control_unavailable' });
      const ownerId = rendererPrincipal(event, 'chrome_control_sender_unavailable');
      chromeControl.registerOwner?.(ownerId, event.sender);
      return { ok: true, value: await action({ ownerId, request: request || {} }) };
    } catch (error) {
      return { ok: false, error: { code: error?.code || fallbackCode, message: error?.message || 'Chrome Control failed.' } };
    }
  };
  ipcMain.handle('solat:chrome-control-status', (event, request) => chromeControlCall(event, () => chromeControl.statusSummary(), request));
  ipcMain.handle('solat:chrome-control-pair', (event, request) => chromeControlCall(event, () => chromeControl.pair(), request, 'chrome_control_pair_error'));
  ipcMain.handle('solat:chrome-control-reveal-extension', (event, request) => chromeControlCall(event, async () => {
    // Revealing is intentionally behind an explicit renderer gesture. The
    // extension remains user-installed; SOLAT never changes Chrome policy or
    // silently loads an unpacked extension.
    if (typeof chromeControl.revealExtension === 'function') return chromeControl.revealExtension();
    if (typeof revealChromeExtension === 'function') return revealChromeExtension(chromeExtensionPath);
    throw Object.assign(new Error('The Chrome extension folder cannot be revealed.'), { code: 'chrome_extension_reveal_unavailable' });
  }, request, 'chrome_extension_reveal_error'));
  ipcMain.handle('solat:chrome-control-adopt-active', (event, request) => chromeControlCall(event, value => chromeControl.adoptActiveForOwner(value), request, 'chrome_control_adopt_error'));
  ipcMain.handle('solat:chrome-control-tabs', (event, request) => chromeControlCall(event, value => chromeControl.listTabsForOwner(value), request, 'chrome_control_tabs_error'));
  ipcMain.handle('solat:chrome-control-switch-tab', (event, request) => chromeControlCall(event, value => chromeControl.switchTabForOwner(value), request, 'chrome_control_switch_error'));
  const agentScope = (event, request) => {
    const sessionId = String(request?.sessionId || '').trim();
    if (!sessionId) throw Object.assign(new Error('A session id is required.'), { code: 'invalid_request' });
    // `ownerId` in an IPC payload is untrusted. A missing event is retained
    // only for direct node-test compatibility; a real Electron event always
    // derives ownership from sender.id and ignores request.ownerId.
    const ownerId = rendererPrincipalIfPresent(event) || sessionId;
    return { ...request, ownerId, sessionId };
  };
  const agentCall = async (event, action, request) => {
    try { return { ok: true, value: await action(agentScope(event, request)) }; } catch (error) { return { ok: false, error: { code: error?.code || 'agent_error', message: error?.message || 'Agent operation failed.' } }; }
  };
  // A failed verified observation must keep its real cause visible; the
  // generic envelope alone hides the adapter/CLI failure from the owner.
  const unverifiedObservation = failure => {
    const detail = failure?.code ? ` (${failure.code}: ${String(failure.message || 'no detail').slice(0, 300)})` : '';
    return Object.assign(new Error(`The approved computer action did not return verified evidence.${detail}`), { code: 'unverified_observation' });
  };
  ipcMain.handle('solat:agent-create', (event, request) => agentCall(event, value => agentService.createPlan(value), request));
  ipcMain.handle('solat:agent-inspect', (event, request) => agentCall(event, value => agentService.inspect(value), request));
  ipcMain.handle('solat:agent-approve', (event, request) => agentCall(event, value => agentService.approve(value), request));
  ipcMain.handle('solat:agent-cancel', (event, request) => agentCall(event, value => agentService.cancel(value), request));
  ipcMain.handle('solat:agent-run', (event, request) => agentCall(event, value => agentService.run(value), request));
  ipcMain.handle('solat:agent-interrupted-plans', (event, request) => agentCall(event, value => agentService.collectInterrupted(value), request));
  ipcMain.handle('solat:computer-task-continue', (event, request) => agentCall(event, async value => {
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
  ipcMain.handle('solat:computer-task-inspect', (event, request) => agentCall(event, value => {
    const taskId = String(value?.taskId || '').trim();
    if (!taskId) throw Object.assign(new Error('A computer task is required.'), { code: 'invalid_request' });
    return computerTaskLoop.inspect({ ownerId: value.ownerId, sessionId: value.sessionId, taskId });
  }, request));
  ipcMain.handle('solat:computer-task-approve-and-continue', (event, request) => agentCall(event, async value => {
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
  ipcMain.handle('solat:computer-task-cancel', (event, request) => agentCall(event, value => {
    const taskId = String(value?.taskId || '').trim();
    if (!taskId) throw Object.assign(new Error('A computer task is required.'), { code: 'invalid_request' });
    return computerTaskLoop.cancel({ ownerId: value.ownerId, sessionId: value.sessionId, taskId });
  }, request));
  ipcMain.handle('solat:agent-read-artifact', (event, request) => agentCall(event, async value => {
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
  ipcMain.handle('solat:agent-export-artifact', (event, request) => agentCall(event, async value => {
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
  ipcMain.handle('solat:store-original-asset', async (event, request) => {
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
      let spatialCapability = null;
      const ownerId = rendererPrincipalIfPresent(event);
      if (ownerId) {
        spatialCapability = crypto.randomUUID();
        spatialAssetCapabilities.set(spatialCapability, { ownerId, sessionId, assetId: asset.asset_id, createdAtMs: Date.now() });
        while (spatialAssetCapabilities.size > 1024) spatialAssetCapabilities.delete(spatialAssetCapabilities.keys().next().value);
      }
      return { ok: true, value: { assetId: asset.asset_id, projectId: asset.project_id, hash: asset.hash, sizeBytes: asset.size_bytes, spatialCapability, intakeStatus: intake.status, extraction: intake.extraction } };
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
