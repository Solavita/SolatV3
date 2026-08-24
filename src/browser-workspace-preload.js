const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solatBrowserShell', Object.freeze({
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('solat:browser-shell-state', listener);
    return () => ipcRenderer.removeListener('solat:browser-shell-state', listener);
  },
  async command(action, payload = {}) {
    const result = await ipcRenderer.invoke('solat:browser-shell-command', { action, ...payload });
    if (result?.ok === false) {
      const error = new Error(result.error?.message || 'Browser Workspace command failed.');
      error.code = result.error?.code || 'browser_workspace_error';
      throw error;
    }
    return result?.value;
  },
}));
