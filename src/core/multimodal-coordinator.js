const { MultimodalFusion } = require('./multimodal-fusion');

function scopeKey(ownerId, sessionId) { return JSON.stringify([String(ownerId || '').trim(), String(sessionId || '').trim()]); }

class MultimodalCoordinator {
  constructor({ fusion = new MultimodalFusion(), persistence, maxLoadedScopes = 128 } = {}) {
    if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function') throw new TypeError('Multimodal persistence is required.');
    this.fusion = fusion;
    this.persistence = persistence;
    this.loaded = new Set();
    this.loading = new Map();
    this.mutations = new Map();
    this.recovery = new Map();
    this.maxLoadedScopes = maxLoadedScopes;
  }

  #markLoaded(key) {
    this.loaded.delete(key);
    this.loaded.add(key);
    while (this.loaded.size > this.maxLoadedScopes) this.loaded.delete(this.loaded.values().next().value);
  }

  #enqueue(scope, action) {
    const key = scopeKey(scope?.ownerId, scope?.sessionId);
    const previous = this.mutations.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(action);
    const tracked = run.finally(() => { if (this.mutations.get(key) === tracked) this.mutations.delete(key); });
    this.mutations.set(key, tracked);
    return tracked;
  }

  async #waitForMutation(scope) {
    const pending = this.mutations.get(scopeKey(scope?.ownerId, scope?.sessionId));
    if (pending) await pending;
  }

  async #ready(scope) {
    const key = scopeKey(scope?.ownerId, scope?.sessionId);
    if (this.loaded.has(key) && (typeof this.fusion.hasScope !== 'function' || this.fusion.hasScope(scope))) {
      this.#markLoaded(key);
      return;
    }
    this.loaded.delete(key);
    if (!this.loading.has(key)) this.loading.set(key, (async () => {
      try {
        const snapshot = await this.persistence.load(scope);
        if (snapshot) this.fusion.restore(snapshot, scope);
      } catch (error) {
        if (!['invalid_multimodal_snapshot', 'multimodal_scope_mismatch'].includes(error?.code)) throw error;
        // Corrupt interaction memory must not break normal chat. Keep the
        // artifact on disk for diagnosis and recover with empty, bounded state.
        this.fusion.clear(scope);
        this.recovery.set(key, Object.freeze({ status: 'degraded', code: error.code }));
      }
      this.#markLoaded(key);
      this.loading.delete(key);
    })().catch(error => { this.loading.delete(key); throw error; }));
    await this.loading.get(key);
  }

  async record(event, scope) {
    return this.#enqueue(scope, async () => {
      await this.#ready(scope);
      let previous = null;
      try { previous = this.fusion.snapshot(scope); } catch (error) { if (error?.code !== 'multimodal_context_missing') throw error; }
      const recorded = this.fusion.record(event, scope);
      try { await this.persistence.save({ ...scope, snapshot: this.fusion.snapshot(scope) }); }
      catch (error) {
        if (previous) this.fusion.restore(previous, scope); else this.fusion.clear(scope);
        throw error;
      }
      return recorded;
    });
  }

  async contextFor(request) {
    await this.#waitForMutation(request);
    await this.#ready(request);
    return this.fusion.contextFor(request);
  }

  async undo(scope) {
    return this.#enqueue(scope, async () => {
      await this.#ready(scope);
      const previous = this.fusion.snapshot(scope);
      const result = this.fusion.undo(scope);
      try { await this.persistence.save({ ...scope, snapshot: this.fusion.snapshot(scope) }); }
      catch (error) { this.fusion.restore(previous, scope); throw error; }
      return result;
    });
  }

  async clear(scope) {
    return this.#enqueue(scope, async () => {
      await this.persistence.remove(scope);
      this.fusion.clear(scope);
      const key = scopeKey(scope?.ownerId, scope?.sessionId);
      this.loaded.delete(key); this.recovery.delete(key);
      return true;
    });
  }

  recoveryStatus(scope) {
    return this.recovery.get(scopeKey(scope?.ownerId, scope?.sessionId)) || Object.freeze({ status: 'ready' });
  }
}

module.exports = { MultimodalCoordinator };
