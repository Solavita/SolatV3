const test = require('node:test');
const assert = require('node:assert/strict');
const { HandInputService } = require('../src/core/hand-input-service');

test('hand input service scopes processor state and never accepts frames before explicit start', () => {
  const calls = [];
  const service = new HandInputService({ processorFactory: options => ({
    processFrame(frame) { calls.push([options.ownerId, options.sessionId, frame.frame_id]); return { frame_id: frame.frame_id, events: [], active: null, transform: null }; },
    getPrivacyStatus() { return { raw_images_persisted: false, retained_hand_count: 0 }; },
    reset() { calls.push(['reset', options.ownerId, options.sessionId]); },
  }) });
  assert.throws(() => service.frame({ ownerId: 'renderer:7', sessionId: 'a', frame: {} }), error => error.code === 'hand_input_not_started');
  assert.equal(service.start({ ownerId: 'renderer:7', sessionId: 'a', display: { bounds: { width: 100, height: 100 } } }).active, true);
  assert.equal(service.frame({ ownerId: 'renderer:7', sessionId: 'a', frame: { frame_id: 'f1' } }).privacy.raw_images_persisted, false);
  assert.throws(() => service.frame({ ownerId: 'renderer:8', sessionId: 'a', frame: { frame_id: 'f2' } }), error => error.code === 'hand_input_not_started');
  assert.equal(service.stop({ ownerId: 'renderer:7', sessionId: 'a' }).frames, 1);
  assert.deepEqual(calls, [['renderer:7', 'a', 'f1'], ['reset', 'renderer:7', 'a']]);
});
