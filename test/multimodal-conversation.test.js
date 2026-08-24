const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMultimodalContextInstruction } = require('../src/core/conversation-core');

test('resolved multimodal context is reference evidence only and never grants action authority', () => {
  const instruction = buildMultimodalContextInstruction({
    schema_version: 'solat.multimodal-context.v1', status: 'resolved', reference: 'asset_inserted',
    event_id: 'asset-1', source: 'asset', type: 'asset_inserted', occurred_at_ms: 900, age_ms: 100,
    payload: { spatial_asset_id: 'spatial-1', surface_id: 'browser-1' }, ordering: 'occurred_at_then_receive_sequence',
  });
  assert.match(instruction, /owner\/session-scoped|not permission|Re-observe/u);
  assert.match(instruction, /spatial-1|browser-1/u);
  assert.doesNotMatch(instruction, /cookie|raw_pcm|image_bytes/u);
});

test('unresolved multimodal context produces a clarification boundary instead of guessed grounding', () => {
  assert.match(buildMultimodalContextInstruction({ schema_version: 'solat.multimodal-context.v1', status: 'needs_clarification' }), /Ask one concise clarification/u);
});
