const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeechChunker } = require('../renderer/speech-chunker');

test('speech chunker emits coherent sentence chunks as deltas arrive', () => {
  const chunker = createSpeechChunker();
  const chunks = [];
  for (const delta of ['Hello there. ', 'This is SOLAT ', 'speaking early. ', 'Final part.']) {
    chunks.push(...chunker.push(delta));
  }
  chunks.push(...chunker.flush());
  assert.deepEqual(chunks, ['Hello there.', 'This is SOLAT speaking early.', 'Final part.']);
});

test('speech chunker keeps buffering until a sentence boundary is safe', () => {
  const chunker = createSpeechChunker({ maxChunkChars: 60 });
  assert.deepEqual(chunker.push('Not done yet'), []);
  assert.deepEqual(chunker.push(', still going'), []);
  const ready = chunker.push('. Now it ends. Tail.');
  assert.deepEqual(ready, ['Not done yet, still going.', 'Now it ends.', 'Tail.']);
  assert.deepEqual(chunker.flush(), []);
});

test('speech chunker does not split decimals mid-number', () => {
  const chunker = createSpeechChunker();
  assert.deepEqual(chunker.push('The value is 2.5 units total'), []);
  assert.deepEqual(chunker.flush(), ['The value is 2.5 units total']);
});

test('speech chunker splits newlines into separate spoken chunks', () => {
  const chunker = createSpeechChunker();
  const chunks = chunker.push('First line\nSecond line\n');
  assert.deepEqual(chunks, ['First line', 'Second line']);
  assert.deepEqual(chunker.flush(), []);
});

test('speech chunker force-splits unspaced Thai text at the size cap', () => {
  const chunker = createSpeechChunker({ maxChunkChars: 24, minChunkChars: 8 });
  const thai = '\u0E01\u0E02\u0E04\u0E07\u0E08\u0E09\u0E0A\u0E0D\u0E10\u0E11\u0E14\u0E17\u0E19\u0E1B\u0E1C\u0E1E\u0E1F\u0E21\u0E22\u0E23\u0E25\u0E27\u0E2A\u0E2D\u0E2E';
  const chunks = [];
  chunks.push(...chunker.push(thai));
  chunks.push(...chunker.flush());
  assert.equal(chunks.join(''), thai);
  assert.ok(chunks.length >= 2, 'expected the long unspaced text to split into multiple chunks');
  for (const chunk of chunks) assert.ok(chunk.length <= 24, `chunk too long: ${chunk.length}`);
});

test('speech chunker never emits empty chunks and flushes the remainder once', () => {
  const chunker = createSpeechChunker();
  assert.deepEqual(chunker.push(''), []);
  assert.deepEqual(chunker.push('   \n  '), []);
  assert.deepEqual(chunker.push('Only one fragment'), []);
  assert.deepEqual(chunker.flush(), ['Only one fragment']);
  assert.deepEqual(chunker.flush(), []);
});

test('speech chunker splits at whitespace before the cap when no sentence boundary exists', () => {
  const chunker = createSpeechChunker({ maxChunkChars: 30, minChunkChars: 4 });
  const chunks = [];
  chunks.push(...chunker.push('word '.repeat(12).trim()));
  chunks.push(...chunker.flush());
  assert.equal(chunks.join(' '), 'word '.repeat(12).trim());
  for (const chunk of chunks) assert.ok(chunk.length <= 30, `chunk too long: ${chunk.length}`);
  assert.ok(chunks.length >= 2);
});
