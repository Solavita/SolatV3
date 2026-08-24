const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solat', Object.freeze({
  status: () => ipcRenderer.invoke('solat:status'),
  voiceStatus: () => ipcRenderer.invoke('solat:voice-status'),
  voiceStartSTT: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-start-stt', request)),
  voicePushSTT: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-push-stt', request)),
  voiceStopSTT: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-stop-stt', request)),
  voiceCancelSTT: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-cancel-stt', request)),
  voiceSpeak: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-speak', request)),
  voiceCancelTTS: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-cancel-tts', request)),
  voiceDispose: async request => unwrapVoice(await ipcRenderer.invoke('solat:voice-dispose', request)),
  onVoiceEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A voice event listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:voice-event', handler);
    return () => ipcRenderer.removeListener('solat:voice-event', handler);
  },
  onAssistantDelta: listener => {
    if (typeof listener !== 'function') throw new TypeError('An assistant delta listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:assistant-delta', handler);
    return () => ipcRenderer.removeListener('solat:assistant-delta', handler);
  },
  spatialOpen: async request => unwrapSpatial(await ipcRenderer.invoke('solat:spatial-open', request)),
  onSpatialEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A spatial event listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:spatial-event', handler);
    return () => ipcRenderer.removeListener('solat:spatial-event', handler);
  },
  onSpatialShortcut: listener => {
    if (typeof listener !== 'function') throw new TypeError('A spatial shortcut listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:spatial-shortcut', handler);
    return () => ipcRenderer.removeListener('solat:spatial-shortcut', handler);
  },
  spatialAssetRegister: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-register', request)),
  spatialAssetSelect: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-select', request)),
  spatialAssetBegin: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-begin', request)),
  spatialAssetMove: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-move', request)),
  spatialAssetSwitch: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-switch', request)),
  spatialAssetDrop: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-drop', request)),
  spatialAssetCancel: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-cancel', request)),
  spatialAssetMemory: async request => unwrapSpatialAsset(await ipcRenderer.invoke('solat:spatial-asset-memory', request)),
  multimodalUndo: async request => unwrapMultimodal(await ipcRenderer.invoke('solat:multimodal-undo', request)),
  handStatus: async request => unwrapHand(await ipcRenderer.invoke('solat:hand-status', request)),
  handStart: async request => unwrapHand(await ipcRenderer.invoke('solat:hand-start', request)),
  handFrame: async request => unwrapHand(await ipcRenderer.invoke('solat:hand-frame', request)),
  handStop: async request => unwrapHand(await ipcRenderer.invoke('solat:hand-stop', request)),
  onHandEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A hand event listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:hand-event', handler);
    return () => ipcRenderer.removeListener('solat:hand-event', handler);
  },
  onSpatialAssetEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A spatial asset listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:spatial-asset-event', handler);
    return () => ipcRenderer.removeListener('solat:spatial-asset-event', handler);
  },
  browserOpen: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-open', request)),
  browserStatus: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-status', request)),
  browserObserve: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-observe', request)),
  browserNavigate: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-navigate', request)),
  browserTakeover: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-takeover', request)),
  browserReturnControl: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-return-control', request)),
  browserClose: async request => unwrapBrowser(await ipcRenderer.invoke('solat:browser-close', request)),
  chromeAssetImport: async request => unwrapBrowser(await ipcRenderer.invoke('solat:chrome-asset-import', request)),
  chromeControlStatus: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-status', request)),
  chromeControlPair: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-pair', request)),
  chromeControlRevealExtension: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-reveal-extension', request)),
  chromeControlAdoptActive: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-adopt-active', request)),
  chromeControlTabs: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-tabs', request)),
  chromeControlSwitchTab: async request => unwrapChromeControl(await ipcRenderer.invoke('solat:chrome-control-switch-tab', request)),
  onBrowserWorkspaceEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A browser workspace listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:browser-workspace-event', handler);
    return () => ipcRenderer.removeListener('solat:browser-workspace-event', handler);
  },
  onBrowserAssetSelected: listener => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:browser-asset-selected', handler);
    return () => ipcRenderer.removeListener('solat:browser-asset-selected', handler);
  },
  setModelMode: async mode => {
    const result = await ipcRenderer.invoke('solat:set-model-mode', mode);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'Model mode could not be changed.');
      error.code = result.error?.code || 'invalid_model_mode';
      throw error;
    }
    return result?.value;
  },
  send: async request => {
    const result = await ipcRenderer.invoke('solat:send', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The request failed.');
      error.code = result.error?.code || 'provider_error';
      throw error;
    }
    return result?.value;
  },
  agentCreate: async request => {
    const result = await ipcRenderer.invoke('solat:agent-create', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent plan could not be created.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentInspect: async request => {
    const result = await ipcRenderer.invoke('solat:agent-inspect', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent plan could not be inspected.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentApprove: async request => {
    const result = await ipcRenderer.invoke('solat:agent-approve', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent plan could not be approved.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentCancel: async request => {
    const result = await ipcRenderer.invoke('solat:agent-cancel', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent plan could not be cancelled.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentRun: async request => {
    const result = await ipcRenderer.invoke('solat:agent-run', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent plan could not run.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentInterruptedPlans: async request => {
    const result = await ipcRenderer.invoke('solat:agent-interrupted-plans', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Interrupted agent plans could not be read.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  computerTaskContinue: async request => {
    const result = await ipcRenderer.invoke('solat:computer-task-continue', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Computer task could not continue.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  computerTaskInspect: async request => {
    const result = await ipcRenderer.invoke('solat:computer-task-inspect', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Computer task could not be inspected.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  computerTaskApproveAndContinue: async request => {
    const result = await ipcRenderer.invoke('solat:computer-task-approve-and-continue', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Computer task approval could not continue.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  computerTaskCancel: async request => {
    const result = await ipcRenderer.invoke('solat:computer-task-cancel', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Computer task could not be cancelled.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  onComputerTaskEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A computer task event listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:computer-task-event', handler);
    return () => ipcRenderer.removeListener('solat:computer-task-event', handler);
  },
  agentReadArtifact: async request => {
    const result = await ipcRenderer.invoke('solat:agent-read-artifact', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent file could not be opened.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  agentExportArtifact: async request => {
    const result = await ipcRenderer.invoke('solat:agent-export-artifact', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent file could not be downloaded.'); error.code = result.error?.code || 'agent_error'; throw error; }
    return result?.value;
  },
  saveConversation: async request => {
    const result = await ipcRenderer.invoke('solat:save-conversation', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'Conversation could not be saved.');
      error.code = result.error?.code || 'persistence_write_failed';
      throw error;
    }
    return result?.value;
  },
  loadConversation: async request => {
    const result = await ipcRenderer.invoke('solat:load-conversation', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'Conversation could not be loaded.');
      error.code = result.error?.code || 'persistence_read_failed';
      throw error;
    }
    return result?.value;
  },
  createDeck: async request => {
    const result = await ipcRenderer.invoke('solat:create-deck', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The creative workflow failed.');
      error.code = result.error?.code || 'workflow_error';
      throw error;
    }
    return result?.value;
  },
  loadCreativeHistory: async request => {
    const result = await ipcRenderer.invoke('solat:load-creative-history', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'Creative history could not be loaded.');
      error.code = result.error?.code || 'persistence_read_failed';
      throw error;
    }
    return result?.value;
  },
  storeOriginalAsset: async request => {
    const result = await ipcRenderer.invoke('solat:store-original-asset', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The original asset could not be stored.');
      error.code = result.error?.code || 'asset_storage_error';
      throw error;
    }
    return result?.value;
  },
  exportHtml: async request => {
    const result = await ipcRenderer.invoke('solat:export-html', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The editable export failed.');
      error.code = result.error?.code || 'export_error';
      throw error;
    }
    return result?.value;
  },
  openExport: async request => {
    const result = await ipcRenderer.invoke('solat:open-export', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The exported HTML could not be opened.');
      error.code = result.error?.code || 'export_open_failed';
      throw error;
    }
    return result?.value;
  },
  inspectExport: async request => {
    const result = await ipcRenderer.invoke('solat:inspect-export', request);
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'The exported HTML could not be inspected.');
      error.code = result.error?.code || 'export_inspection_failed';
      throw error;
    }
    return result?.value;
  },
}));

function unwrapVoice(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'The voice operation failed.');
    error.code = result.error?.code || 'voice_error';
    throw error;
  }
  return result?.value;
}

function unwrapSpatial(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'The spatial operation failed.');
    error.code = result.error?.code || 'spatial_error';
    throw error;
  }
  return result?.value;
}

function unwrapSpatialAsset(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'The spatial asset operation failed.');
    error.code = result.error?.code || 'spatial_asset_error';
    throw error;
  }
  return result?.value;
}

function unwrapBrowser(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'Browser Workspace failed.');
    error.code = result.error?.code || 'browser_workspace_error';
    throw error;
  }
  return result?.value;
}

function unwrapChromeControl(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'Chrome Control failed.');
    error.code = result.error?.code || 'chrome_control_error';
    throw error;
  }
  return result?.value;
}

function unwrapMultimodal(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'Multimodal operation failed.');
    error.code = result.error?.code || 'multimodal_error';
    throw error;
  }
  return result?.value;
}

function unwrapHand(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'Hand input failed.');
    error.code = result.error?.code || 'hand_input_error';
    throw error;
  }
  return result?.value;
}
