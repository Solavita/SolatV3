const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIsolatedChatGptBaselines, validatePairedCorpus, validatePairedProviderCaptures } = require('../scripts/validate-paired-corpus');

test('paired corpus preflight preserves cases while exposing invalid semantic evidence', () => {
  const report = validatePairedCorpus({ cases: [
    { id: 'direct', category: 'chat', content: 'Hello', history: [] },
    { id: 'context', category: 'context', content: 'Tell me about the person I mentioned.', history: [] },
    { id: 'broken', category: 'thai', content: 'เน€เธโฌ', history: [] },
  ] }, { expectedCount: 3 });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.case_count, 3);
  assert.equal(report.unique_case_count, 3);
  assert.equal(report.issue_counts.context_required_but_missing, 1);
  assert.equal(report.issue_counts.mojibake_input, 1);
  assert.equal(report.issues.some(item => item.id === 'direct'), false);
});

test('paired corpus preflight passes a complete fixed-size corpus', () => {
  const cases = Array.from({ length: 2 }, (_, index) => ({
    id: `case-${index}`,
    category: 'chat',
    content: `Prompt ${index}`,
    history: [],
  }));
  const report = validatePairedCorpus({ cases }, { expectedCount: 2 });
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.issues, []);
});

test('ChatGPT isolation preflight requires explicit zero history and a fresh chat per case', () => {
  const corpus = { cases: [
    { id: 'case-0', content: 'First prompt' },
    { id: 'case-1', content: 'Second prompt' },
  ] };
  const valid = validateIsolatedChatGptBaselines(corpus, {
    capture_protocol: { mode: 'fresh_temporary_chat_per_case' },
    cases: [
      { id: 'case-0', content: 'First prompt', response: 'First answer', context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'chat-0' },
      { id: 'case-1', content: 'Second prompt', response: 'Second answer', context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'chat-1' },
    ],
  }, { expectedCount: 2 });
  assert.equal(valid.status, 'PASS');
  assert.equal(valid.unique_isolation_count, 2);

  const invalid = validateIsolatedChatGptBaselines(corpus, {
    capture_protocol: { mode: 'reused_chat' },
    cases: [
      { id: 'case-0', content: 'First prompt', response: 'Answer', context_mode: 'temporary_chat', history_count: 0, isolation_id: 'same-chat' },
      { id: 'case-1', content: 'Wrong prompt', response: 'Answer', context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'same-chat' },
    ],
  }, { expectedCount: 2 });
  assert.equal(invalid.status, 'FAIL');
  assert.equal(invalid.issue_counts.chatgpt_capture_protocol_not_isolated, 1);
  assert.equal(invalid.issue_counts.chatgpt_history_not_proven_empty, 1);
  assert.equal(invalid.issue_counts.chatgpt_isolation_id_reused, 1);
  assert.equal(invalid.issue_counts.chatgpt_prompt_mismatch, 1);
});

test('declared missing-history limitations do not silently pass as context evidence', () => {
  const corpus = { cases: [{ id: 'case-0', category: 'context', content: 'I mentioned someone earlier.', history: [] }] };
  const undeclared = validatePairedCorpus(corpus, { expectedCount: 1 });
  assert.equal(undeclared.status, 'FAIL');
  const declared = validatePairedCorpus(corpus, { expectedCount: 1, limitations: { declared_missing_history: [{ id: 'case-0', expected_behavior: 'clarify_or_state_insufficient_context' }] } });
  assert.equal(declared.status, 'PASS_WITH_DECLARED_LIMITATIONS');
  assert.equal(declared.issue_counts.context_required_but_missing || 0, 0);
});

test('paired provider preflight requires isolated A and matched-history B/C captures', () => {
  const corpusA = { cases: [{ id: 'a', content: 'Hello', history: [] }] };
  const goodA = validatePairedProviderCaptures(corpusA, { rows: [{ id: 'a', prompt: 'Hello', captures: {
    chatgpt: { context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'gpt-a', response: 'Hi' },
    solat: { context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'solat-a', response: 'Hi' },
  } }] }, { mode: 'A' });
  assert.equal(goodA.status, 'PASS');
  const corpusB = { cases: [{ id: 'b', content: 'Continue', history: [{ role: 'user', content: 'Earlier' }] }] };
  const goodB = validatePairedProviderCaptures(corpusB, { rows: [{ id: 'b', prompt: 'Continue', captures: {
    chatgpt: { context_mode: 'matched_history', history: [{ role: 'user', content: 'Earlier' }], history_count: 1, seed_transcript: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Seed reply' }], isolation_id: 'gpt-b', response: 'Ok' },
    solat: { history: [{ role: 'user', content: 'Earlier' }], history_count: 1, seed_transcript: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Seed reply' }], isolation_id: 'solat-b', response: 'Ok' },
  } }] }, { mode: 'B' });
  assert.equal(goodB.status, 'PASS');
  const badB = validatePairedProviderCaptures(corpusB, { rows: [{ id: 'b', prompt: 'Wrong', captures: {
    chatgpt: { history: [], history_count: 0, isolation_id: 'same', response: 'Ok' },
    solat: { history: [], history_count: 0, isolation_id: 'same', response: 'Ok' },
  } }] }, { mode: 'B' });
  assert.equal(badB.status, 'FAIL');
  assert.equal(badB.issue_counts.prompt_mismatch, 1);
  assert.equal(badB.issue_counts.matched_history_mismatch, 2);
  assert.equal(badB.issue_counts.isolation_id_reused, 1);
});

test('ChatGPT B protocol requires exact user seeds plus alternating transcript, while C is fresh', () => {
  const corpus = { cases: [{ id: 'b', content: 'Continue', history: [{ role: 'user', content: 'Earlier' }] }] };
  const b = validateIsolatedChatGptBaselines(corpus, { capture_protocol: { mode: 'fresh_chat_with_exact_history_per_case' }, cases: [{
    id: 'b', content: 'Continue', context_mode: 'matched_history', seed_inputs: [{ role: 'user', content: 'Earlier' }],
    transcript: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Seed reply' }], isolation_id: 'b-1', response: 'Follow-up',
  }] }, { expectedCount: 1, mode: 'B' });
  assert.equal(b.status, 'PASS');
  const c = validateIsolatedChatGptBaselines({ cases: [{ id: 'c', content: 'No history', history: [{ role: 'user', content: 'ignored for C' }] }] }, { capture_protocol: { mode: 'fresh_temporary_chat_per_case' }, cases: [{
    id: 'c', content: 'No history', context_mode: 'temporary_chat', history: [], history_count: 0, isolation_id: 'c-1', response: 'Fresh',
  }] }, { expectedCount: 1, mode: 'C' });
  assert.equal(c.status, 'PASS');
});
