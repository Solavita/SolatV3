const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { createProvider } = require('../src/core/provider');
const { ModelRouter } = require('../src/core/model-router');

async function timedCase(id, action) {
  const started = Date.now();
  try {
    const result = await action();
    return {
      id,
      status: result?.content ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started,
      provider: result?.provider,
      model: result?.model,
      route: result?.routing?.route,
      fallback_reason: result?.routing?.fallback_reason || null,
      request_total_ms: result?.routing?.request_total_ms,
      attempts: result?.routing?.attempts,
      response_preview: String(result?.content || '').slice(0, 120),
    };
  } catch (error) {
    return { id, status: 'FAIL', elapsed_ms: Date.now() - started, error: { code: error.code || 'unknown', message: error.message } };
  }
}

async function timedStructuredCase(id, action) {
  const started = Date.now();
  try {
    const result = await action();
    const step = result?.data;
    const validStep = step?.schema_version === 'solat.computer-task-step.v1'
      && step?.status === 'action'
      && step?.tool === 'computer_open_website'
      && step?.arguments?.site === 'google';
    return {
      id,
      status: validStep ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started,
      provider: result?.provider,
      model: result?.model,
      route: result?.routing?.route,
      fallback_reason: result?.routing?.fallback_reason || null,
      request_total_ms: result?.routing?.request_total_ms,
      attempts: result?.routing?.attempts,
      structured_step: step || null,
    };
  } catch (error) {
    return { id, status: 'FAIL', elapsed_ms: Date.now() - started, error: { code: error.code || 'unknown', message: error.message } };
  }
}

const CONTROLLER_STEP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'status', 'summary', 'tool', 'arguments'],
  properties: {
    schema_version: { type: 'string', const: 'solat.computer-task-step.v1' },
    status: { type: 'string', enum: ['action', 'needs_clarification', 'unsupported'] },
    summary: { type: 'string', minLength: 1, maxLength: 200 },
    tool: { type: 'string', enum: ['computer_open_website', 'none'] },
    arguments: {
      type: 'object',
      additionalProperties: false,
      properties: { site: { type: 'string', enum: ['google'] } },
    },
  },
});

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  const config = readConfig();
  const local = createProvider(config.localModel);
  const deepseek = createProvider(config);
  const router = new ModelRouter({ localProvider: local, deepseekProvider: deepseek, mode: 'local', logger: null });
  const cases = [];
  cases.push(await timedCase('manual-qwen-late-system-normalization', () => router.complete([
    { role: 'system', content: 'Answer briefly.' },
    { role: 'user', content: 'ตอบเลข 7 เท่านั้น' },
    { role: 'system', content: 'Do not add an explanation.' },
  ])));
  router.setMode('auto');
  cases.push(await timedCase('auto-simple-to-qwen', () => router.complete([{ role: 'user', content: '2 + 3 เท่ากับเท่าไร ตอบสั้นๆ' }])));
  cases.push(await timedStructuredCase('auto-simple-controller-to-qwen', () => router.completeStructured([
    {
      role: 'system',
      content: 'You are a bounded SOLAT Computer Use planner (solat.computer-task-step.v1). Return one strict JSON object only. For this goal, select computer_open_website with site google. Never claim the action already happened.',
    },
    { role: 'user', content: 'Goal: เปิดเว็บไซต์ Google' },
  ], CONTROLLER_STEP_SCHEMA, { routeHint: 'computer_controller' })));
  router.setMode('deepseek');
  cases.push(await timedCase('manual-deepseek', () => router.complete([{ role: 'user', content: 'Reply with OK only.' }])));
  router.setMode('auto');
  cases.push(await timedCase('auto-complex-to-deepseek', () => router.complete([{ role: 'user', content: 'ช่วยวิเคราะห์ข้อดีข้อเสียของ local model เทียบ cloud model แบบสั้นๆ' }])));

  const failedLocalConfig = { ...config.localModel, baseUrl: 'http://127.0.0.1:1/v1', timeoutMs: 1_000 };
  const fallbackRouter = new ModelRouter({ localProvider: createProvider(failedLocalConfig), deepseekProvider: deepseek, mode: 'auto', logger: null });
  cases.push(await timedCase('auto-local-failure-to-deepseek', () => fallbackRouter.complete([{ role: 'user', content: 'สวัสดี ตอบสั้นๆ' }])));

  const report = {
    schema_version: 'solat.model-routing-live.v1',
    created_at: new Date().toISOString(),
    status: 'NOT VERIFIED',
    local_model: config.localModel.model,
    cases,
  };
  const manualLocal = cases.find(item => item.id === 'manual-qwen-late-system-normalization');
  const autoSimple = cases.find(item => item.id === 'auto-simple-to-qwen');
  const autoController = cases.find(item => item.id === 'auto-simple-controller-to-qwen');
  const manualDeepSeek = cases.find(item => item.id === 'manual-deepseek');
  const autoComplex = cases.find(item => item.id === 'auto-complex-to-deepseek');
  const fallback = cases.find(item => item.id === 'auto-local-failure-to-deepseek');
  if (manualLocal?.route !== 'local' || manualLocal?.fallback_reason) manualLocal.status = 'FAIL';
  if (autoSimple?.route !== 'local' || autoSimple?.fallback_reason) autoSimple.status = 'FAIL';
  if (autoController?.route !== 'local' || autoController?.fallback_reason) autoController.status = 'FAIL';
  if (manualDeepSeek?.route !== 'deepseek' || manualDeepSeek?.fallback_reason) manualDeepSeek.status = 'FAIL';
  if (autoComplex?.route !== 'deepseek' || autoComplex?.fallback_reason) autoComplex.status = 'FAIL';
  if (fallback?.route !== 'deepseek' || !fallback?.fallback_reason) fallback.status = 'FAIL';
  report.status = cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
  const outputArg = process.argv.indexOf('--output');
  if (outputArg >= 0) {
    const destination = path.resolve(process.argv[outputArg + 1]);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'model_routing_live_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
