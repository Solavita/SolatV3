const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeIntent } = require('../src/core/intent-router');

test('reference resolution keeps Thai and compact romanized lookup subjects usable in a follow-up', () => {
  const thaiFollowUp = analyzeIntent({
    content: '\u0e40\u0e02\u0e32\u0e40\u0e1b\u0e47\u0e19\u0e43\u0e04\u0e23',
    history: [{
      role: 'user',
      content: '\u0e04\u0e49\u0e19\u0e2b\u0e32 \u0e2e\u0e31\u0e19 \u0e19\u0e32\u0e23\u0e35 \u0e08\u0e32\u0e01\u0e21\u0e31\u0e07\u0e2e\u0e27\u0e32',
    }],
  });
  assert.equal(thaiFollowUp.original_message, '\u0e40\u0e02\u0e32\u0e40\u0e1b\u0e47\u0e19\u0e43\u0e04\u0e23');
  assert.deepEqual(thaiFollowUp.reference_resolution.candidates, ['\u0e2e\u0e31\u0e19 \u0e19\u0e32\u0e23\u0e35']);
  assert.equal(thaiFollowUp.reference_resolution.status, 'resolved_from_context');
  assert.equal(thaiFollowUp.reference_resolution.recommended_query, '\u0e2e\u0e31\u0e19 \u0e19\u0e32\u0e23\u0e35');

  const compactRomanizedFollowUp = analyzeIntent({
    content: 'tell me more about him',
    history: [{ role: 'user', content: 'ParkDayoung' }],
  });
  assert.deepEqual(compactRomanizedFollowUp.reference_resolution.candidates, ['ParkDayoung']);
  assert.equal(compactRomanizedFollowUp.reference_resolution.status, 'resolved_from_context');
  assert.equal(compactRomanizedFollowUp.reference_resolution.recommended_query, 'ParkDayoung');
});

test('Thai ordinal reference retains comparison order without guessing an entity', () => {
  const result = analyzeIntent({
    content: '\u0e04\u0e19\u0e41\u0e23\u0e01\u0e21\u0e35\u0e1c\u0e25\u0e07\u0e32\u0e19\u0e2d\u0e30\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07',
    history: [{
      role: 'user',
      content: '\u0e40\u0e1b\u0e23\u0e35\u0e22\u0e1a\u0e40\u0e17\u0e35\u0e22\u0e1a \u0e2e\u0e31\u0e19 \u0e19\u0e32\u0e23\u0e35 \u0e01\u0e31\u0e1a \u0e1b\u0e32\u0e23\u0e4c\u0e04 \u0e14\u0e32\u0e22\u0e2d\u0e07',
    }],
  });
  assert.equal(result.reference_resolution.ordinal, 0);
  assert.equal(result.reference_resolution.status, 'resolved_ordinal_context');
  assert.equal(result.reference_resolution.recommended_query, '\u0e2e\u0e31\u0e19 \u0e19\u0e32\u0e23\u0e35');
});

test('reference resolution retains a user subject beyond four turns', () => {
  const history = [
    { role: 'user', content: 'Park Dayoung' },
    { role: 'assistant', content: 'Which one do you mean?' },
    { role: 'user', content: 'the manhwa character' },
    { role: 'assistant', content: 'Understood.' },
    { role: 'user', content: 'thanks' },
    { role: 'assistant', content: 'You are welcome.' },
  ];
  const result = analyzeIntent({ content: 'tell me more about her', history });
  assert.equal(result.reference_resolution.status, 'resolved_from_context');
  assert.equal(result.reference_resolution.recommended_query, 'Park Dayoung');
  assert.deepEqual(result.task.context_qualifiers, ['manhwa character']);
});

test('latest user correction overrides a stale assistant domain interpretation', () => {
  const result = analyzeIntent({
    content: '\u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\u0e19\u0e31\u0e01\u0e23\u0e49\u0e2d\u0e07 \u0e09\u0e31\u0e19\u0e2b\u0e21\u0e32\u0e22\u0e16\u0e36\u0e07\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23\u0e21\u0e31\u0e07\u0e2e\u0e27\u0e32',
    history: [
      { role: 'user', content: 'Park Dayoung' },
      { role: 'assistant', content: 'She is a music artist and singer.' },
    ],
  });
  assert.equal(result.conversational_context.correction_detected, true);
  assert.deepEqual(result.task.context_qualifiers, ['manhwa character']);
  assert.deepEqual(result.task.context_entity_candidates, ['Park Dayoung']);
});
