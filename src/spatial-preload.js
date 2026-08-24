const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solatSpatial', Object.freeze({
  onInit: listener => {
    if (typeof listener !== 'function') throw new TypeError('A spatial init listener is required.');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('solat:spatial-init', handler);
    return () => ipcRenderer.removeListener('solat:spatial-init', handler);
  },
  complete: async request => unwrap(await ipcRenderer.invoke('solat:spatial-complete', request)),
  cancel: async request => unwrap(await ipcRenderer.invoke('solat:spatial-cancel', request)),
}));

function unwrap(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || 'The spatial operation failed.');
    error.code = result.error?.code || 'spatial_error';
    throw error;
  }
  return result?.value;
}
