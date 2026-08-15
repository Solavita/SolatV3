const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProgress } = require('../scripts/validate-chatgpt-progress');

test('partial ChatGPT B progress is reported as incomplete with exact missing IDs', () => {
  const corpus = {
    cases: [
      { id: 'b-0', content: 'follow up 0', history: [{ role: 'user', content: 'seed 0' }] },
      { id: 'b-1', content: 'follow up 1', history: [{ role: 'user', content: 'seed 1' }] },
    ],
  };
  const progress = {
    mode: 'B',
    capture_protocol: { mode: 'fresh_chat_with_exact_history_per_case' },
    cases: [{
      id: 'b-0',
      content: 'follow up 0',
      context_mode: 'matched_history',
      seed_inputs: [{ role: 'user', content: 'seed 0' }],
      transcript: [{ role: 'user', content: 'seed 0' }, { role: 'assistant', content: 'seed reply' }],
      isolation_id: 'chat-0',
      response: 'follow-up answer',
      status: 'PASS',
    }],
  };
  const result = validateProgress(corpus, progress, { expectedCount: 2, mode: 'B' });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.completed_count, 1);
  assert.deepEqual(result.missing_ids, ['b-1']);
  assert.equal(result.incomplete_count, 0);
});

test('partial ChatGPT B progress rejects a failed row without response or transcript', () => {
  const corpus = { cases: [{ id: 'b-0', content: 'follow up', history: [{ role: 'user', content: 'seed' }] }] };
  const progress = {
    mode: 'B',
    capture_protocol: { mode: 'fresh_chat_with_exact_history_per_case' },
    cases: [{ id: 'b-0', content: 'follow up', context_mode: 'matched_history', status: 'FAIL', error: 'temporary chat not enabled' }],
  };
  const result = validateProgress(corpus, progress, { expectedCount: 1, mode: 'B' });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.incomplete_count, 1);
  assert.ok(result.incomplete[0].issues.some((issue) => issue.code === 'response_missing'));
  assert.ok(result.incomplete[0].issues.some((issue) => issue.code === 'capture_status_not_pass'));
});
