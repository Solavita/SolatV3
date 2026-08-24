(function speechChunkerModule(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.SolatSpeechChunker = exported;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const SENTENCE_ENDERS = new Set(['.', '!', '?', '\u2026', '\u0E2F']);
  const DEFAULT_MAX_CHUNK_CHARS = 200;
  const DEFAULT_MIN_CHUNK_CHARS = 16;

  // Splits a streaming assistant response into coherent spoken phrases.
  // Boundaries prefer sentence-ending punctuation and line breaks, then fall
  // back to the nearest whitespace before the size cap, and only force-split
  // unspaced scripts (Thai) at the cap itself. Pure and deterministic so the
  // speech pipeline can be regression-tested without a provider.
  function createSpeechChunker({
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    minChunkChars = DEFAULT_MIN_CHUNK_CHARS,
  } = {}) {
    const maxChars = Number.isInteger(maxChunkChars) && maxChunkChars >= 24 ? maxChunkChars : DEFAULT_MAX_CHUNK_CHARS;
    const minChars = Number.isInteger(minChunkChars) && minChunkChars >= 1 && minChunkChars < maxChars ? minChunkChars : DEFAULT_MIN_CHUNK_CHARS;
    let buffer = '';

    function takeChunk(endIndexExclusive) {
      const chunk = buffer.slice(0, endIndexExclusive).trim();
      buffer = buffer.slice(endIndexExclusive);
      return chunk;
    }

    function findSentenceBoundary() {
      for (let index = 0; index < buffer.length; index += 1) {
        const char = buffer[index];
        if (char === '\n') return index + 1;
        if (!SENTENCE_ENDERS.has(char)) continue;
        // Split after a sentence ender only when it is followed by whitespace,
        // a line break, or the end of the buffered text, so decimals such as
        // "2.5" stay intact.
        const next = buffer[index + 1];
        if (next === undefined || next === '\n' || /\s/u.test(next)) return index + 1;
      }
      return -1;
    }

    function drain(finalFlush) {
      const chunks = [];
      for (;;) {
        if (!buffer.length) break;
        const sentenceBoundary = findSentenceBoundary();
        if (sentenceBoundary > 0) {
          const chunk = takeChunk(sentenceBoundary);
          if (chunk) chunks.push(chunk);
          continue;
        }
        if (finalFlush) {
          const chunk = takeChunk(buffer.length);
          if (chunk) chunks.push(chunk);
          break;
        }
        if (buffer.length < maxChars) break;
        let cut = -1;
        for (let index = maxChars - 1; index >= minChars; index -= 1) {
          if (/\s/u.test(buffer[index])) { cut = index + 1; break; }
        }
        // Unspaced scripts (Thai) have no whitespace to prefer; cut at the cap.
        if (cut < 0) cut = maxChars;
        const chunk = takeChunk(cut);
        if (chunk) chunks.push(chunk);
      }
      return chunks;
    }

    return Object.freeze({
      push(deltaText) {
        const delta = String(deltaText || '');
        if (!delta) return [];
        buffer += delta;
        return drain(false);
      },
      flush() {
        return drain(true);
      },
      pending() {
        return buffer;
      },
    });
  }

  return Object.freeze({
    createSpeechChunker,
    DEFAULT_MAX_CHUNK_CHARS,
    DEFAULT_MIN_CHUNK_CHARS,
  });
});
