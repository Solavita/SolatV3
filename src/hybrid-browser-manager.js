const { BrowserWorkspaceError } = require('./core/browser-workspace-contracts');

class HybridBrowserManager {
  constructor({ chrome, embedded } = {}) {
    if (!chrome || !embedded) throw new TypeError('Hybrid browser requires Chrome and embedded managers.');
    this.chrome = chrome; this.embedded = embedded;
  }
  registerOwner(ownerId, sender) { this.chrome.registerOwner(ownerId, sender); return this.embedded.registerOwner(ownerId, sender); }
  async openForOwner(value) { return this.chrome.connectionStatus().connected ? this.chrome.openForOwner(value) : this.embedded.openForOwner(value); }
  adoptActiveForOwner(value) { return this.chrome.adoptActiveForOwner(value); }
  listTabsForOwner(value) { return this.chrome.listTabsForOwner(value); }
  switchTabForOwner(value) { return this.chrome.switchTabForOwner(value); }
  status(value) { return this.#manager(value).status(value); }
  observe(value) { return this.#manager(value).observe(value); }
  visualObserve(value) { return this.#manager(value).visualObserve(value); }
  getVisualCapture(value) { return this.#manager(value).getVisualCapture(value); }
  navigate(value) { return this.#manager(value).navigate(value); }
  act(value) { return this.#manager(value).act(value); }
  takeover(value) { return this.#manager(value).takeover(value); }
  returnControl(value) { return this.#manager(value).returnControl(value); }
  close(value) { return this.#manager(value).close(value); }
  shellCommand(sender, request) { return this.embedded.shellCommand(sender, request); }
  connectionStatus() { return this.chrome.connectionStatus(); }
  statusSummary() { return this.chrome.statusSummary(); }
  pair() { return this.chrome.pair(); }
  revealExtension() { return this.chrome.revealExtension(); }
  #manager(value) {
    const surfaceId = String(value?.request?.surfaceId || '');
    if (!surfaceId) throw new BrowserWorkspaceError('invalid_request', 'surface_id is invalid.');
    return surfaceId.startsWith('chrome_') ? this.chrome : this.embedded;
  }
}

function createHybridBrowserManager(options) { return new HybridBrowserManager(options); }

module.exports = { HybridBrowserManager, createHybridBrowserManager };
