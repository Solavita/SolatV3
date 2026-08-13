const test = require('node:test');
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ConversationPersistence, sanitizeMessage } = require('../src/core/conversation-persistence');

test('conversation persistence restores context by session and redacts secrets', async () => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'solat-v2-conversation-history-'));
  try {
    const persistence = new ConversationPersistence({ rootDir: root, idFactory: () => 'tmp' });
    await persistence.save({ sessionId: 'session-a', thread: {
      id: 'thread-a', title: 'API key: sk-super-secret-value', createdAt: 1, updatedAt: 2,
      messages: [{ id: 'm1', ts: 1, role: 'user', content: 'Use api_key=abc123secret in this conversation.' }, { id: 'm2', ts: 2, role: 'assistant', content: 'Context kept.', responseMeta: { mode: 'model', searchRecoveryUsed: true, sources: [{ title: 'Wikipedia', url: 'https://wikipedia.org/' }], searchEvidence: [{ status: 'ready', source_scope: 'social', quality: { authority_level: 'social_discovery', corroboration: 'multi_host', agreement_status: 'not_assessed' } }], searchSummary: { source_count: 1, search_requested: true, search_used: true, search_recovery_used: true, source_scopes: ['social'], source_hosts: ['www.tiktok.com', 'www.pinterest.com'], statuses: ['ready'], requested_source_scopes: ['social'], source_scope_priority: ['social', 'auto'], candidate_source_scopes: ['social', 'auto'], candidate_source_scopes_used: ['social'], comparison_entities: ['Park Dayoung', 'Han Nari'], comparison_entities_with_evidence: ['Park Dayoung'], comparison_evidence_status: 'incomplete', requested_platforms: ['Pinterest', 'TikTok'], requested_platforms_with_evidence: ['Pinterest'], requested_platform_status: 'incomplete', authority_levels: ['social_discovery'], requested_source_scope_status: 'complete', candidate_source_scope_status: 'used' } } }],
    } });
    const restored = await persistence.load({ sessionId: 'session-a' });
    assert.equal(restored.thread.id, 'thread-a');
    assert.equal(restored.thread.messages.length, 2);
    assert.match(restored.thread.title, /\[REDACTED_SECRET\]/);
    assert.match(restored.thread.messages[0].content, /\[REDACTED_SECRET\]/);
    assert.equal(restored.thread.messages[1].responseMeta.sources[0].url, 'https://wikipedia.org/');
    assert.equal(restored.thread.messages[1].responseMeta.searchRecoveryUsed, true);
    assert.equal(restored.thread.messages[1].responseMeta.searchEvidence[0].quality.authority_level, 'social_discovery');
    assert.equal(restored.thread.messages[1].responseMeta.searchEvidence[0].quality.corroboration, 'multi_host');
    assert.equal(restored.thread.messages[1].responseMeta.searchEvidence[0].quality.agreement_status, 'not_assessed');
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.requested_platforms, ['Pinterest', 'TikTok']);
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.requested_platforms_with_evidence, ['Pinterest']);
    assert.equal(restored.thread.messages[1].responseMeta.searchSummary.requested_platform_status, 'incomplete');
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.source_scopes, ['social']);
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.candidate_source_scopes, ['social', 'auto']);
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.source_scope_priority, ['social', 'auto']);
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.comparison_entities, ['Park Dayoung', 'Han Nari']);
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.comparison_entities_with_evidence, ['Park Dayoung']);
    assert.equal(restored.thread.messages[1].responseMeta.searchSummary.comparison_evidence_status, 'incomplete');
    assert.deepEqual(restored.thread.messages[1].responseMeta.searchSummary.authority_levels, ['social_discovery']);
    assert.equal(restored.thread.messages[1].responseMeta.searchSummary.candidate_source_scope_status, 'used');
    assert.equal(restored.thread.messages[1].responseMeta.searchSummary.search_recovery_used, true);
    assert.deepEqual((await persistence.load({ sessionId: 'session-b' })).thread, null);
    await assert.rejects(() => persistence.load({ sessionId: '../session-a' }), error => error.code === 'invalid_request');
    assert.equal(sanitizeMessage({ role: 'unknown', content: 'ok' }).role, 'assistant');
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true });
  }
});
