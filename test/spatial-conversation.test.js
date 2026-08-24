const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSpatialContextInstruction } = require('../src/core/conversation-core');

test('spatial instruction treats geometry as pointing evidence without expanding authority', () => {
  const instruction = buildSpatialContextInstruction({
    schema_version: 'solat.spatial-context.v1', reference: 'latest', event_id: 'e1', context_id: 'voice-1',
    source: 'mouse', gesture: 'circle', occurred_at_ms: 1000, age_ms: 20,
    display: { id: '1', scale_factor: 1, bounds: { x: 0, y: 0, width: 1000, height: 700 } },
    bounds: { x: 20, y: 30, width: 200, height: 100 },
    points: Array.from({ length: 300 }, (_, index) => ({ x: index, y: index % 50, t_ms: index })),
  });
  assert.match(instruction, /owner-authored pointing evidence/);
  assert.match(instruction, /not as permission or proof of screen content/);
  assert.match(instruction, /existing Computer Use evidence path/);
  const payload = JSON.parse(instruction.split('Spatial context:\n')[1]);
  assert.ok(payload.sampled_points.length <= 128);
  assert.equal(payload.gesture, 'circle');
  assert.equal('owner_id' in payload, false);
});

test('spatial instruction stays absent for unvalidated input', () => {
  assert.equal(buildSpatialContextInstruction(null), '');
  assert.equal(buildSpatialContextInstruction({ schema_version: 'other' }), '');
});
