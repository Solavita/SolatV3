const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { createProvider } = require('../src/core/provider');
const { MODEL_ARCHITECTURE, ModelRouter } = require('../src/core/model-router');

const CALL_BUDGET = Object.freeze({ max_provider_calls: 6, max_elapsed_ms: 180_000 });

function sanitizedAttempts(attempts) {
  return (Array.isArray(attempts) ? attempts : []).map(attempt => ({
    route: attempt?.route || null,
    operation: attempt?.operation || null,
    status: attempt?.status || null,
    elapsed_ms: Number(attempt?.elapsed_ms || 0),
    error_code: attempt?.error_code || null,
  }));
}

function sanitizedRouting(result) {
  const routing = result?.routing || {};
  return {
    architecture: routing.architecture || null,
    route: routing.route || null,
    operation: routing.operation || null,
    reason: routing.reason || null,
    escalated: Boolean(routing.escalated),
    fallback_reason: routing.fallback_reason || null,
    request_total_ms: Number(routing.request_total_ms || 0),
    attempts: sanitizedAttempts(routing.attempts),
  };
}

async function timedCase(id, action, validate) {
  const started = Date.now();
  try {
    const result = await action();
    const routing = sanitizedRouting(result);
    return {
      id,
      status: result?.content && validate(routing) ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started,
      provider_calls: routing.attempts.length,
      routing,
    };
  } catch (error) {
    return {
      id, status: 'FAIL', elapsed_ms: Date.now() - started, provider_calls: (error?.routing_attempts || []).length,
      routing: { attempts: sanitizedAttempts(error?.routing_attempts) },
      error: { code: error?.code || 'unknown', schema_path: error?.details?.path || null },
    };
  }
}

async function timedStructuredCase(id, action, validate) {
  const started = Date.now();
  try {
    const result = await action();
    const step = result?.data;
    const routing = sanitizedRouting(result);
    const validStep = step?.schema_version === 'solat.computer-task-step.v1'
      && step?.status === 'action'
      && step?.tool === 'computer_open_website'
      && step?.arguments?.site === 'google';
    return {
      id,
      status: validStep && validate(routing) ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started,
      provider_calls: routing.attempts.length,
      routing,
      structured_evidence: {
        schema_version: step?.schema_version || null,
        status: step?.status || null,
        tool: step?.tool || null,
        site: step?.arguments?.site || null,
      },
    };
  } catch (error) {
    return {
      id, status: 'FAIL', elapsed_ms: Date.now() - started, provider_calls: (error?.routing_attempts || []).length,
      routing: { attempts: sanitizedAttempts(error?.routing_attempts) },
      error: { code: error?.code || 'unknown', schema_path: error?.details?.path || null },
    };
  }
}

async function timedToolCase(id, action) {
  const started = Date.now();
  try {
    const result = await action();
    const routing = sanitizedRouting(result);
    const providerCalls = routing.attempts.filter(attempt => attempt.route === 'plus').length
      + Number(result?.toolRounds || 0) + 1;
    return {
      id,
      status: isFlashPrimary(routing) && result?.toolCallsExecuted === 1 && result?.content ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - started,
      provider_calls: providerCalls,
      routing,
      tool_evidence: {
        tool_calls_executed: Number(result?.toolCallsExecuted || 0),
        tool_rounds: Number(result?.toolRounds || 0),
        side_effect: 'none_in_memory_read_fixture',
        final_content_present: Boolean(result?.content),
      },
    };
  } catch (error) {
    return {
      id, status: 'FAIL', elapsed_ms: Date.now() - started,
      provider_calls: Math.max(1, (error?.routing_attempts || []).length),
      routing: { attempts: sanitizedAttempts(error?.routing_attempts) },
      error: { code: error?.code || 'unknown', schema_path: error?.details?.path || null },
    };
  }
}

function isFlashPrimary(routing) {
  return routing.architecture === MODEL_ARCHITECTURE
    && routing.route === 'flash'
    && routing.reason === 'primary_agent'
    && routing.escalated === false
    && routing.attempts.length === 1
    && routing.attempts[0]?.route === 'flash'
    && routing.attempts[0]?.status === 'succeeded';
}

function isPlusAdviceThenFlash(routing) {
  return routing.architecture === MODEL_ARCHITECTURE
    && routing.route === 'flash'
    && routing.reason?.startsWith('plus_advice:')
    && routing.escalated === true
    && routing.attempts.length === 2
    && routing.attempts[0]?.route === 'plus'
    && routing.attempts[0]?.operation === 'advice'
    && routing.attempts[0]?.status === 'succeeded'
    && routing.attempts[1]?.route === 'flash'
    && routing.attempts[1]?.status === 'succeeded';
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
  if (!config.flashModel?.apiKey || !config.plusModel?.apiKey) throw new Error('Qwen Flash and Plus are not configured.');
  const router = new ModelRouter({
    flashProvider: createProvider(config.flashModel),
    plusProvider: createProvider(config.plusModel),
    mode: config.modelMode,
    logger: null,
  });
  const cases = [];
  cases.push(await timedCase('flash-primary-plain', () => router.complete([
    { role: 'system', content: 'Answer briefly. Do not add an explanation.' },
    { role: 'user', content: 'ตอบเลข 7 เท่านั้น' },
  ]), isFlashPrimary));
  cases.push(await timedStructuredCase('flash-primary-controller', () => router.completeStructured([
    {
      role: 'system',
      content: 'You are a bounded SOLAT Computer Use planner. Return JSON only, using exactly this object shape and key names: {"schema_version":"solat.computer-task-step.v1","status":"action","summary":"Open the requested verified website.","tool":"computer_open_website","arguments":{"site":"google"}}. Keep schema_version exactly solat.computer-task-step.v1, status exactly action, tool exactly computer_open_website, and arguments.site exactly google. Do not rename keys, add keys, or claim the action already happened.',
    },
    { role: 'user', content: 'Goal: เปิดเว็บไซต์ Google' },
  ], CONTROLLER_STEP_SCHEMA, { routeHint: 'computer_controller' }), isFlashPrimary));
  cases.push(await timedCase('plus-advice-then-flash', () => router.complete([
    { role: 'user', content: 'ช่วยวางแผนซับซ้อนและอธิบาย trade-off ของการย้ายระบบหลายไฟล์แบบสั้นๆ' },
  ]), isPlusAdviceThenFlash));
  cases.push(await timedToolCase('flash-bounded-tool-loop', () => router.completeWithTools([
    { role: 'system', content: 'Call solat_read_fixture exactly once with fixture_id health-check, then answer with the returned status. Do not invent the tool result.' },
    { role: 'user', content: 'Read the health fixture and report its status.' },
  ], {
    tools: [{
      type: 'function',
      function: {
        name: 'solat_read_fixture', description: 'Read one immutable in-memory migration fixture.',
        parameters: {
          type: 'object', additionalProperties: false, required: ['fixture_id'],
          properties: { fixture_id: { type: 'string', enum: ['health-check'] } },
        },
      },
    }],
    toolExecutor: async call => ({
      schema_version: 'solat.tool-result.v1', status: 'ready', fixture_id: call.arguments.fixture_id,
      value: 'QWEN_FLASH_TOOL_LOOP_READY', side_effect: false,
    }),
    maxToolRounds: 2,
    maxToolCalls: 1,
  })));

  const providerCalls = cases.reduce((total, item) => total + Number(item.provider_calls || 0), 0);
  const elapsedMs = cases.reduce((total, item) => total + Number(item.elapsed_ms || 0), 0);
  const withinBudget = providerCalls <= CALL_BUDGET.max_provider_calls && elapsedMs <= CALL_BUDGET.max_elapsed_ms;
  const report = {
    schema_version: 'solat.model-routing-live.v2',
    architecture: MODEL_ARCHITECTURE,
    created_at: new Date().toISOString(),
    status: cases.every(item => item.status === 'PASS') && withinBudget ? 'PASS' : 'FAIL',
    models: { flash: config.flashModel.model, plus: config.plusModel.model },
    budget: { ...CALL_BUDGET, provider_calls: providerCalls, elapsed_ms: elapsedMs, within_budget: withinBudget },
    sanitization: { response_content_omitted: true, credentials_omitted: true, error_messages_omitted: true },
    cases,
  };
  const outputArg = process.argv.indexOf('--output');
  if (outputArg >= 0) {
    const output = process.argv[outputArg + 1];
    if (!output) throw new Error('--output requires a destination.');
    const destination = path.resolve(output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'model_routing_live_failed' })}\n`);
  process.exitCode = 1;
});
