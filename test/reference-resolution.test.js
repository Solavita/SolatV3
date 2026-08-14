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
