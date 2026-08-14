#!/usr/bin/env node
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { analyzeIntent } = require('../src/core/intent-router');
const {
  buildConversationSystemPrompt,
  buildResolvedReferenceInstruction,
  modelContextWindow,
  CONVERSATION_PROMPT_VERSION,
} = require('../src/core/conversation-core');
const { buildCompletionRequestBody } = require('../src/core/provider');
const { WebSearchService } = require('../src/core/web-search');

const iterations = Number.parseInt(process.env.SOLAT_REQUEST_CONSISTENCY_ITERATIONS || '500', 10);
if (!Number.isInteger(iterations) || iterations < 2 || iterations > 5000) {
  throw new Error('SOLAT_REQUEST_CONSISTENCY_ITERATIONS must be an integer from 2 to 5000.');
}

const config = Object.freeze({
  baseUrl: 'https://api.deepseek.com',
  model: 'local-contract-model',
  thinkingMode: 'disabled',
});
const history = Object.freeze([
  Object.freeze({ role: 'user', content: 'Tell me about Park Dayoung the singer.' }),
  Object.freeze({ role: 'assistant', content: 'Which detail would you like to compare?' }),
]);
const tools = (() => {
  const search = new WebSearchService({ provider: 'disabled' });
  return Object.freeze([search.toolDefinition(), search.readPageToolDefinition()]);
})();

function requestFixture(content) {
  const intentHints = analyzeIntent({ content, history });
  const prompt = buildConversationSystemPrompt({
    intentHints,
    resolvedReferenceInstruction: buildResolvedReferenceInstruction(intentHints),
  });
  const context = modelContextWindow(history, content);
  const messages = [{ role: 'system', content: prompt }, ...context.messages];
  const request = buildCompletionRequestBody(config, messages, { tools, toolChoice: 'auto' });
  return { intentHints, prompt, request };
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const baselineContent = 'Compare Park Dayoung with Han Nari.';
const correctionContent = 'ไม่ใช่นักร้อง ฉันหมายถึง Park Dayoung ตัวละครในมังฮวา';
const baseline = requestFixture(baselineContent);
const correction = requestFixture(correctionContent);
const baselineJson = JSON.stringify(baseline);
const correctionJson = JSON.stringify(correction);
const expectedToolOrder = ['web_search', 'web_read_page'];
const observedToolOrder = baseline.request.tools.map(tool => tool.function.name);
const started = performance.now();
let mismatchCount = 0;
for (let index = 0; index < iterations; index += 1) {
  if (JSON.stringify(requestFixture(baselineContent)) !== baselineJson) mismatchCount += 1;
  if (JSON.stringify(requestFixture(correctionContent)) !== correctionJson) mismatchCount += 1;
}
const elapsedMs = performance.now() - started;

const checks = {
  repeated_prompt_and_request_are_stable: mismatchCount === 0,
  message_order_is_system_history_user: baseline.request.messages.map(message => message.role).join(',') === 'system,user,assistant,user',
  tool_order_is_stable: JSON.stringify(observedToolOrder) === JSON.stringify(expectedToolOrder),
  tool_schemas_are_present: baseline.request.tools.every(tool => tool?.function?.parameters?.type === 'object'),
  tool_schemas_do_not_change_with_correction: JSON.stringify(baseline.request.tools) === JSON.stringify(correction.request.tools),
  correction_changes_request: digest(baseline.request) !== digest(correction.request),
  correction_hint_is_versioned: correction.prompt.startsWith(`Prompt version: ${CONVERSATION_PROMPT_VERSION}.`)
    && correction.intentHints.conversational_context.correction_detected === true
    && correction.intentHints.conversational_context.correction_policy === 'prefer_latest_user_correction'
    && baseline.intentHints.conversational_context.correction_detected === false
    && correction.prompt.includes('"correction_detected":true')
    && correction.prompt.includes('"correction_policy":"prefer_latest_user_correction"')
    && baseline.prompt.includes('"correction_detected":false'),
  request_contains_no_credentials: !baselineJson.includes('apiKey') && !baselineJson.includes('authorization'),
};
const report = {
  schema_version: 'solat.request-consistency-local.v1',
  prompt_version: CONVERSATION_PROMPT_VERSION,
  scope: 'deterministic production prompt and provider request construction only; semantic answer consistency remains NOT VERIFIED',
  iterations,
  total_request_builds: iterations * 2,
  elapsed_ms: elapsedMs,
  mismatch_count: mismatchCount,
  baseline_request_sha256: digest(baseline.request),
  correction_request_sha256: digest(correction.request),
  message_order: baseline.request.messages.map(message => message.role),
  tool_order: observedToolOrder,
  checks,
  semantic_answer_consistency: 'NOT VERIFIED',
  status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === 'PASS' ? 0 : 1;
