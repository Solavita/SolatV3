const { HandGestureProcessor } = require('./hand-gesture-foundation');

const STATUS_SCHEMA = 'solat.hand-input-status.v1';
const MAX_SESSIONS = 32;

function handError(code, message) { return Object.assign(new Error(message), { code }); }
function scope(ownerId, sessionId) {
  const owner = String(ownerId || '').trim(); const session = String(sessionId || '').trim();
  if (!owner || !session || owner.length > 160 || session.length > 160) throw handError('invalid_hand_scope', 'Hand input owner/session is invalid.');
  return { owner, session, key: JSON.stringify([owner, session]) };
}

class HandInputService {
  constructor({ processorFactory = options => new HandGestureProcessor(options), maxSessions = MAX_SESSIONS } = {}) {
    this.processorFactory = processorFactory;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  start({ ownerId, sessionId, contextId = '', display } = {}) {
    const current = scope(ownerId, sessionId);
    if (!display || typeof display !== 'object') throw handError('invalid_hand_display', 'Hand input display metadata is required.');
    if (!this.sessions.has(current.key) && this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    const processor = this.processorFactory({ ownerId: current.owner, sessionId: current.session, contextId, display });
    this.sessions.set(current.key, { processor, frames: 0, events: 0, startedAtMs: Date.now() });
    return this.status({ ownerId, sessionId });
  }

  frame({ ownerId, sessionId, frame } = {}) {
    const current = scope(ownerId, sessionId);
    const state = this.sessions.get(current.key);
    if (!state) throw handError('hand_input_not_started', 'Start hand input before sending landmarks.');
    const result = state.processor.processFrame(frame);
    state.frames += 1; state.events += result.events.length;
    return Object.freeze({
      schema_version: 'solat.hand-input-result.v1',
      status: 'ready',
      frame_id: result.frame_id,
      events: result.events,
      active: result.active,
      transform: result.transform || null,
      privacy: state.processor.getPrivacyStatus(),
    });
  }

  stop({ ownerId, sessionId } = {}) {
    const current = scope(ownerId, sessionId);
    const state = this.sessions.get(current.key);
    if (!state) return Object.freeze({ schema_version: STATUS_SCHEMA, status: 'idle', active: false, frames: 0, events: 0 });
    state.processor.reset(); this.sessions.delete(current.key);
    return Object.freeze({ schema_version: STATUS_SCHEMA, status: 'idle', active: false, frames: state.frames, events: state.events });
  }

  status({ ownerId, sessionId } = {}) {
    const current = scope(ownerId, sessionId);
    const state = this.sessions.get(current.key);
    return Object.freeze({
      schema_version: STATUS_SCHEMA,
      status: state ? 'tracking' : 'idle', active: Boolean(state),
      frames: state?.frames || 0, events: state?.events || 0,
      privacy: state?.processor.getPrivacyStatus() || { raw_images_persisted: false, raw_frames_persisted: false },
    });
  }

  disposeOwner(ownerId) {
    const owner = String(ownerId || '').trim();
    for (const [key, state] of this.sessions) {
      if (JSON.parse(key)[0] !== owner) continue;
      state.processor.reset(); this.sessions.delete(key);
    }
  }

  dispose() { for (const state of this.sessions.values()) state.processor.reset(); this.sessions.clear(); }
}

module.exports = { HandInputService, STATUS_SCHEMA };
