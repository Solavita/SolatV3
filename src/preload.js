const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solat', Object.freeze({
  status: () => ipcRenderer.invoke('solat:status'),
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
  agentReadArtifact: async request => {
    const result = await ipcRenderer.invoke('solat:agent-read-artifact', request);
    if (result?.ok === false) { const error = new Error(result.error?.message || 'Agent file could not be opened.'); error.code = result.error?.code || 'agent_error'; throw error; }
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
