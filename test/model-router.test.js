const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCAL_FAST_SYSTEM_PROMPT,
  ModelRouter,
  assertComputerControllerResult,
  compactAutoLocalMessages,
  requiresDeepSeek,
  requiresDeepSeekForComputerUse,
} = require('../src/core/model-router');
const { ProviderError, buildCompletionRequestBody } = require('../src/core/provider');

function fakeProvider(name, calls, behavior = {}) {
  return {
    status: () => ({ provider: name, model: `${name}-model`, configured: true, baseHost: `${name}.local` }),
    async complete(messages) { calls.push([name, 'plain', messages.at(-1)?.content]); if (behavior.complete) return behavior.complete(); return { content: name, provider: name, model: `${name}-model` }; },
    async completeStructured() {
      calls.push([name, 'structured']);
      if (behavior.structured) return behavior.structured();
      return {
        content: '{}',
        data: {
          schema_version: 'solat.computer-task-step.v1', status: 'needs_clarification',
          summary: 'More verified context is required.', tool: 'none', arguments: {},
        },
        provider: name, model: `${name}-model`,
      };
    },
    async completeWithTools() { calls.push([name, 'tools']); return { content: name, provider: name, model: `${name}-model` }; },
  };
}

function fakeVisionProvider(calls, configured = true) {
  return {
    status: () => ({ provider: 'vision', model: 'holo', configured, baseHost: '127.0.0.1:8000' }),
    async completeStructuredVision(messages, schema, capture) {
      calls.push(['vision', 'structured_vision', messages, schema, capture]);
      return { data: { action: 'inspect' }, provider: 'vision', model: 'holo' };
    },
  };
}

test('auto routes simple chat locally and complex or structured work to DeepSeek', async () => {
  const calls = [];
  const router = new ModelRouter({ localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const simple = await router.complete([{ role: 'user', content: '2 + 3 เท่ากับเท่าไร' }]);
  assert.equal(simple.content, 'local');
  assert.equal(simple.routing.route, 'local');
  await router.complete([{ role: 'user', content: 'ค้นหาข่าวล่าสุดและเปรียบเทียบแหล่งข้อมูล' }]);
  await router.completeStructured([{ role: 'user', content: 'return json' }], { type: 'object' });
  assert.deepEqual(calls.map(item => item.slice(0, 2)), [['local', 'plain'], ['deepseek', 'plain'], ['deepseek', 'structured']]);
  assert.equal(requiresDeepSeek([{ role: 'user', content: 'ช่วยวิเคราะห์โค้ดนี้' }]), true);
});

test('auto local chat compacts only the main SOLAT policy prompt', () => {
  const messages = compactAutoLocalMessages([
    { role: 'system', content: 'Prompt version: solat.conversation-system.v4.\nVery long policy.' },
    { role: 'system', content: 'Owner-scoped file context.' },
    { role: 'user', content: 'hello' },
  ]);
  assert.match(messages[0].content, /simple, low-risk conversation/u);
  assert.equal(messages[1].content, 'Owner-scoped file context.');
  assert.equal(messages[2].content, 'hello');
  const withoutMainPolicy = compactAutoLocalMessages([{ role: 'user', content: 'hello' }]);
  assert.equal(withoutMainPolicy[0].role, 'system');
  assert.match(withoutMainPolicy[0].content, /simple, low-risk conversation/u);
  assert.equal(withoutMainPolicy[1].content, 'hello');
});

test('auto falls back to DeepSeek only when a simple local call fails', async () => {
  const calls = [];
  const local = fakeProvider('local', calls, { complete: () => { throw new ProviderError('timeout', 'local timeout'); } });
  const router = new ModelRouter({ localProvider: local, deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const result = await router.complete([{ role: 'user', content: 'สวัสดี' }]);
  assert.equal(result.content, 'deepseek');
  assert.equal(result.routing.fallback_reason, 'timeout');
  assert.deepEqual(result.routing.attempts.map(item => [item.route, item.status]), [['local', 'failed'], ['deepseek', 'succeeded']]);
  assert.equal(result.routing.request_total_ms, result.routing.attempts.reduce((total, item) => total + item.elapsed_ms, 0));
  assert.deepEqual(calls.map(item => item[0]), ['local', 'deepseek']);
});

test('auto uses local Qwen for bounded controller plans and falls back on invalid local output', async () => {
  const calls = [];
  const router = new ModelRouter({ localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const localPlan = await router.completeStructured([{ role: 'user', content: 'open notepad' }], {}, { routeHint: 'local_controller' });
  assert.equal(localPlan.routing.route, 'local');

  const fallbackCalls = [];
  const local = fakeProvider('local', fallbackCalls, { structured: () => { throw new ProviderError('malformed_response', 'invalid local JSON'); } });
  const fallbackRouter = new ModelRouter({ localProvider: local, deepseekProvider: fakeProvider('deepseek', fallbackCalls), logger: null });
  const fallbackPlan = await fallbackRouter.completeStructured([{ role: 'user', content: 'open notepad' }], {}, { routeHint: 'local_controller' });
  assert.equal(fallbackPlan.routing.route, 'deepseek');
  assert.equal(fallbackPlan.routing.fallback_reason, 'malformed_response');
  assert.deepEqual(fallbackCalls.map(item => item[0]), ['local', 'deepseek']);
});

test('computer controller rejects contradictory status and tool combinations', () => {
  assert.throws(
    () => assertComputerControllerResult({
      data: {
        schema_version: 'solat.computer-task-step.v1', status: 'unsupported',
        summary: 'Contradictory.', tool: 'computer_open_website', arguments: { site: 'google' },
      },
    }),
    error => error.code === 'malformed_response',
  );
  assert.equal(assertComputerControllerResult({
    data: {
      schema_version: 'solat.computer-task-step.v1', status: 'action',
      summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' },
    },
  }).data.status, 'action');
});

test('auto repairs one contradictory local controller response before fallback', async () => {
  const calls = [];
  let localCalls = 0;
  const local = fakeProvider('local', calls, {
    structured: () => {
      localCalls += 1;
      return localCalls === 1
        ? { data: { schema_version: 'solat.computer-task-step.v1', status: 'unsupported', summary: 'No.', tool: 'computer_open_website', arguments: { site: 'google' } }, provider: 'local', model: 'local-model' }
        : { data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } }, provider: 'local', model: 'local-model' };
    },
  });
  const router = new ModelRouter({ localProvider: local, deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const result = await router.completeStructured([
    { role: 'system', content: 'You are a bounded SOLAT Computer Use planner (test).' },
    { role: 'user', content: 'Goal: เปิดเว็บไซต์ Google' },
  ], {}, { routeHint: 'computer_controller' });
  assert.equal(result.routing.route, 'local');
  assert.equal(result.routing.operation, 'structured_repair');
  assert.deepEqual(result.routing.attempts.map(item => [item.route, item.status]), [['local', 'failed'], ['local', 'succeeded']]);
  assert.deepEqual(calls.map(item => item[0]), ['local', 'local']);
});

test('auto falls back after two contradictory local controller responses while manual local fails visibly', async () => {
  const contradictory = () => ({
    data: { schema_version: 'solat.computer-task-step.v1', status: 'unsupported', summary: 'No.', tool: 'computer_open_website', arguments: { site: 'google' } },
    provider: 'local', model: 'local-model',
  });
  const calls = [];
  const messages = [
    { role: 'system', content: 'You are a bounded SOLAT Computer Use planner (test).' },
    { role: 'user', content: 'Goal: เปิดเว็บไซต์ Google' },
  ];
  const router = new ModelRouter({
    localProvider: fakeProvider('local', calls, { structured: contradictory }),
    deepseekProvider: fakeProvider('deepseek', calls, { structured: () => ({ data: { schema_version: 'solat.computer-task-step.v1', status: 'action', summary: 'Open Google.', tool: 'computer_open_website', arguments: { site: 'google' } }, provider: 'deepseek', model: 'deepseek-model' }) }),
    logger: null,
  });
  const result = await router.completeStructured(messages, {}, { routeHint: 'computer_controller' });
  assert.equal(result.routing.route, 'deepseek');
  assert.equal(result.routing.fallback_reason, 'malformed_response');
  assert.deepEqual(calls.map(item => item[0]), ['local', 'local', 'deepseek']);

  const manualCalls = [];
  const manual = new ModelRouter({
    localProvider: fakeProvider('local', manualCalls, { structured: contradictory }),
    deepseekProvider: fakeProvider('deepseek', manualCalls), mode: 'local', logger: null,
  });
  await assert.rejects(
    manual.completeStructured(messages, {}, { routeHint: 'computer_controller' }),
    error => error.code === 'malformed_response',
  );
  assert.deepEqual(manualCalls.map(item => item[0]), ['local']);
});

test('auto routes simple Computer Use to Qwen and complex or ambiguous work to DeepSeek', async () => {
  const calls = [];
  const router = new ModelRouter({ localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const computerSystem = { role: 'system', content: 'You are a bounded SOLAT Computer Use planner (test).' };

  const simple = await router.completeStructured([
    computerSystem,
    { role: 'user', content: 'Goal: เปิด Notepad แล้วพิมพ์ hello\nVerified observations: none' },
  ], {}, { routeHint: 'local_controller' });
  assert.equal(simple.routing.route, 'local');

  const complex = await router.completeStructured([
    computerSystem,
    { role: 'user', content: 'Goal: เปิด Chrome เข้า Google Classroom หา Physics ตรวจงานที่ยังไม่ส่ง แล้วสรุปผลทั้งหมด\nVerified observations: none' },
  ], {}, { routeHint: 'local_controller' });
  assert.equal(complex.routing.route, 'deepseek');

  const ambiguous = await router.completeStructured([
    { role: 'user', content: 'เปิดโปรแกรมนั้นแล้วทำต่อเหมือนเดิม' },
  ], {}, { routeHint: 'computer_controller' });
  assert.equal(ambiguous.routing.route, 'deepseek');
  assert.deepEqual(calls.map(item => item[0]), ['local', 'deepseek', 'deepseek']);
  assert.equal(requiresDeepSeekForComputerUse([{ role: 'user', content: 'เปิด Notepad แล้วพิมพ์ hello' }]), false);
  assert.equal(requiresDeepSeekForComputerUse([{ role: 'user', content: 'เปิดโปรแกรมนั้นแล้วทำต่อ' }]), true);
  assert.equal(requiresDeepSeekForComputerUse([{ role: 'user', content: 'ดูหน้าต่าง Calculator แล้วบอกตัวเลขที่แสดง' }]), true);
});

test('auto routes cross-application Computer Use directly to DeepSeek', async () => {
  const calls = [];
  const router = new ModelRouter({ localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const computerSystem = { role: 'system', content: 'You are a bounded SOLAT Computer Use planner (test).' };

  const result = await router.completeStructured([
    computerSystem,
    { role: 'user', content: 'Goal: เปิด Chrome ค้นหา TypeScript แล้วกลับไปที่ Notepad โดยไม่แก้ข้อความเดิม\nVerified observations: none' },
  ], {}, { routeHint: 'local_controller' });

  assert.equal(result.routing.route, 'deepseek');
  assert.deepEqual(calls.map(item => item[0]), ['deepseek']);
  assert.equal(requiresDeepSeekForComputerUse([{ role: 'user', content: 'Open Calculator, then switch to another app and report what is visible.' }]), true);
  assert.equal(requiresDeepSeekForComputerUse([{ role: 'user', content: 'เปิด Chrome แล้วค้นหา TypeScript' }]), false);
});

test('Auto Computer Use falls back to DeepSeek when local Qwen fails', async () => {
  const calls = [];
  const local = fakeProvider('local', calls, { structured: () => { throw new ProviderError('timeout', 'local timeout'); } });
  const router = new ModelRouter({ localProvider: local, deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  const result = await router.completeStructured([{ role: 'user', content: 'เปิด Notepad' }], {}, { routeHint: 'computer_controller' });
  assert.equal(result.routing.route, 'deepseek');
  assert.equal(result.routing.fallback_reason, 'timeout');
  assert.deepEqual(calls.map(item => item[0]), ['local', 'deepseek']);
});

test('manual model modes never switch provider for Computer Use complexity or failure', async () => {
  const calls = [];
  const local = fakeProvider('local', calls);
  const deepseek = fakeProvider('deepseek', calls);
  const router = new ModelRouter({ localProvider: local, deepseekProvider: deepseek, mode: 'local', logger: null });
  const complexGoal = [{ role: 'user', content: 'วิเคราะห์หน้าจอที่กำกวม เปรียบเทียบตัวเลือก แล้วสรุปวิธีที่ปลอดภัยที่สุด' }];

  const localResult = await router.completeStructured(complexGoal, {}, { routeHint: 'computer_controller' });
  assert.equal(localResult.routing.route, 'local');
  router.setMode('deepseek');
  const deepseekResult = await router.completeStructured([{ role: 'user', content: 'เปิด Notepad' }], {}, { routeHint: 'computer_controller' });
  assert.equal(deepseekResult.routing.route, 'deepseek');
  assert.deepEqual(calls.map(item => item[0]), ['local', 'deepseek']);

  const failingCalls = [];
  const failingLocal = fakeProvider('local', failingCalls, { structured: () => { throw new ProviderError('timeout', 'manual local timeout'); } });
  const manualLocal = new ModelRouter({ localProvider: failingLocal, deepseekProvider: fakeProvider('deepseek', failingCalls), mode: 'local', logger: null });
  await assert.rejects(
    manualLocal.completeStructured([{ role: 'user', content: 'เปิด Notepad' }], {}, { routeHint: 'computer_controller' }),
    error => error.code === 'timeout',
  );
  assert.deepEqual(failingCalls.map(item => item[0]), ['local']);
});

test('explicit model modes do not silently switch provider', async () => {
  const calls = [];
  const router = new ModelRouter({ localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null });
  router.setMode('local');
  await router.completeStructured([{ role: 'user', content: 'json' }]);
  router.setMode('deepseek');
  await router.complete([{ role: 'user', content: 'hello' }]);
  assert.deepEqual(calls.map(item => item[0]), ['local', 'deepseek']);
  assert.throws(() => router.setMode('other'), error => error.code === 'invalid_model_mode');
});

test('manual local chat uses the bounded local policy instead of the full SOLAT policy', async () => {
  const seen = [];
  const local = fakeProvider('local', []);
  local.complete = async messages => {
    seen.push(messages);
    return { content: 'LOCAL', provider: 'local', model: 'local-model' };
  };
  const router = new ModelRouter({ localProvider: local, deepseekProvider: fakeProvider('deepseek', []), mode: 'local', logger: null });
  await router.complete([
    { role: 'system', content: 'Prompt version: solat.conversation-system.v1\nVery long main policy.' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].content, LOCAL_FAST_SYSTEM_PROMPT);
  assert.equal(seen[0][1].content, 'hello');
});

test('local Ollama requests disable expensive reasoning for the fast chat path', () => {
  const body = buildCompletionRequestBody({ provider: 'ollama_local', model: 'qwen-local', baseUrl: 'http://127.0.0.1:11434/v1' }, [
    { role: 'system', content: 'Primary policy.' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'Hi.' },
    { role: 'system', content: 'Final synthesis only.' },
  ]);
  assert.equal(body.think, false);
  assert.deepEqual(body.options, { num_predict: 256 });
  assert.equal(body.max_tokens, undefined);
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user', 'assistant']);
  assert.match(body.messages[0].content, /Primary policy[\s\S]*Final synthesis only/u);
  const deepseek = buildCompletionRequestBody({ provider: 'deepseek_api', model: 'deep', baseUrl: 'https://api.deepseek.com', thinkingMode: 'disabled' }, []);
  assert.equal(deepseek.think, undefined);
  assert.equal(deepseek.options, undefined);
  assert.equal(deepseek.max_tokens, undefined);
});

test('vision route exists only for a configured dedicated vision provider', async () => {
  const calls = [];
  const providers = { localProvider: fakeProvider('local', calls), deepseekProvider: fakeProvider('deepseek', calls), logger: null };
  const disabled = new ModelRouter(providers);
  assert.equal(typeof disabled.completeStructuredVision, 'undefined');
  assert.equal(disabled.status().vision.configured, false);

  const unconfigured = new ModelRouter({ ...providers, visionProvider: fakeVisionProvider(calls, false) });
  assert.equal(typeof unconfigured.completeStructuredVision, 'undefined');

  const enabled = new ModelRouter({ ...providers, visionProvider: fakeVisionProvider(calls, true) });
  const result = await enabled.completeStructuredVision(
    [{ role: 'user', content: 'inspect' }],
    { type: 'object' },
    { metadata: {}, bytes: Buffer.from('png') },
  );
  assert.equal(result.data.action, 'inspect');
  assert.equal(result.routing.route, 'vision');
  assert.equal(result.routing.operation, 'structured_vision');
  assert.equal(enabled.status().vision.model, 'holo');
});
