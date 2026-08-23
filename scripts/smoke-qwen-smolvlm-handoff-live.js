const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readConfig } = require('../src/core/config');
const { createProvider, messagesWithVisionCapture } = require('../src/core/provider');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_IMAGE = 'C:\\Users\\pengc\\Pictures\\Screenshots\\Screenshot 2026-08-20 212727.png';
const SMOLVLM_MODEL = 'hf.co/pierretokns/smolvlm-500m-ccmcp-v1:Q4_K_M';

const HANDOFF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'status', 'instruction', 'reason'],
  properties: {
    schema_version: { type: 'string', const: 'solat.qwen-vision-handoff.v1' },
    status: { type: 'string', const: 'vision_required' },
    instruction: { type: 'string', minLength: 1, maxLength: 160 },
    reason: { type: 'string', minLength: 1, maxLength: 240 },
  },
});

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function stopModel(model) {
  const result = spawnSync('ollama', ['stop', model], { encoding: 'utf8', windowsHide: true });
  return {
    attempted: true,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : null,
    stderr: String(result.stderr || '').trim().slice(0, 500),
  };
}

function parseModelJson(content) {
  const raw = String(content || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(raw);
  return JSON.parse(fenced ? fenced[1].trim() : raw);
}

function assessVision(content, width, height, box) {
  let parsed = null;
  try {
    parsed = parseModelJson(content);
  } catch {
    return { pass: false, reason: 'malformed_json', parsed: null };
  }
  const point = Array.isArray(parsed?.coordinate) ? parsed.coordinate.map(Number) : [];
  const valid = parsed?.action === 'left_click'
    && point.length === 2
    && point.every(Number.isFinite)
    && point[0] >= 0 && point[0] < width
    && point[1] >= 0 && point[1] < height;
  const inBox = valid && point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
  return { pass: inBox, reason: inBox ? null : 'coordinate_not_grounded', parsed };
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Opt-in required: re-run with --execute.');
  const output = path.resolve(ROOT, argument('--output', 'reports/qwen-smolvlm-handoff-live-latest.json'));
  const imagePath = path.resolve(argument('--image', DEFAULT_IMAGE));
  const bytes = fs.readFileSync(imagePath);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error('Expected a valid PNG input.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const box = { x1: 1160, y1: 780, x2: 1425, y2: 990 };
  const config = readConfig();
  if (!String(config.localModel?.model || '').includes('Qwen3.8-2B-GGUF')) {
    throw new Error(`Expected the verified Qwen3.8-2B local model, received ${config.localModel?.model || 'none'}.`);
  }

  const startedAt = Date.now();
  const qwenStartedAt = Date.now();
  const qwen = await createProvider(config.localModel).completeStructured([
    {
      role: 'system',
      content: 'You are the bounded SOLAT controller. UI Automation returned no usable controls. Return exactly one JSON handoff asking the vision specialist to locate the requested target. Do not invent coordinates and do not claim completion.',
    },
    { role: 'user', content: 'Locate the visible SEND button in the supplied current-screen step.' },
  ], HANDOFF_SCHEMA);
  const qwenLatencyMs = Date.now() - qwenStartedAt;
  const handoffValid = qwen?.data?.schema_version === 'solat.qwen-vision-handoff.v1'
    && qwen?.data?.status === 'vision_required'
    && /send/iu.test(String(qwen?.data?.instruction || ''));

  // The 16 GB target must not retain the text controller while loading vision.
  const unload = stopModel(config.localModel.model);
  const visionProvider = createProvider({
    provider: 'ollama_vision',
    baseUrl: argument('--base-url', 'http://127.0.0.1:11434/v1'),
    apiKey: 'ollama',
    model: SMOLVLM_MODEL,
    timeoutMs: Math.max(1_000, Number(argument('--timeout-ms', '60000')) || 60_000),
    maxTokens: 128,
    keepAlive: '0s',
  });
  const visionStartedAt = Date.now();
  const capture = {
    metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/png' },
    bytes,
  };
  const vision = await visionProvider.complete(messagesWithVisionCapture([
    { role: 'system', content: 'Ground one GUI action. Output only JSON: {"action":"left_click","coordinate":[x,y]} using screenshot pixels.' },
    { role: 'user', content: String(qwen?.data?.instruction || 'Click the SEND button') },
  ], capture), { responseFormat: { type: 'json_object' } });
  const visionLatencyMs = Date.now() - visionStartedAt;
  const visionAssessment = assessVision(vision.content, width, height, box);
  stopModel(SMOLVLM_MODEL);

  const alternativePath = path.resolve(ROOT, 'reports/computer-use-ui-15-qwen2-all-pass-candidate-20260822.json');
  const alternative = fs.existsSync(alternativePath) ? JSON.parse(fs.readFileSync(alternativePath, 'utf8')) : null;
  const alternativeRows = Array.isArray(alternative?.rows) ? alternative.rows : [];
  const alternativeVerified = alternative?.status === 'PASS'
    && alternativeRows.length === 15
    && alternativeRows.every(item => item.status === 'PASS');
  const status = handoffValid && visionAssessment.pass
    ? 'PASS'
    : handoffValid && alternativeVerified
      ? 'BLOCKED_WITH_VERIFIED_ALTERNATIVE'
      : 'FAIL';
  const report = {
    schema_version: 'solat.qwen-smolvlm-handoff-live.v1',
    created_at: new Date().toISOString(),
    status,
    policy: {
      uia_first: true,
      sequence: ['qwen_controller', 'unload_qwen', 'smolvlm_grounding', 'verified_uia_or_deepseek_alternative'],
      simultaneous_heavy_models: false,
    },
    qwen: {
      status: handoffValid ? 'PASS' : 'FAIL',
      model: config.localModel.model,
      provider: qwen.provider,
      latency_ms: qwenLatencyMs,
      handoff: qwen.data || null,
      unload,
    },
    vision: {
      status: visionAssessment.pass ? 'PASS' : 'BLOCKED',
      model: SMOLVLM_MODEL,
      latency_ms: visionLatencyMs,
      raw_response: String(vision.content || '').slice(0, 4_000),
      assessment: visionAssessment,
      image: { path: imagePath, width, height, size_bytes: bytes.length },
      expected_box: box,
    },
    verified_alternative: {
      status: alternativeVerified ? 'PASS' : 'NOT VERIFIED',
      evidence: alternativePath,
      cases: alternativeRows.length,
    },
    total_ms: Date.now() - startedAt,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, status, qwen_latency_ms: qwenLatencyMs, vision_latency_ms: visionLatencyMs, total_ms: report.total_ms })}\n`);
  if (!['PASS', 'BLOCKED_WITH_VERIFIED_ALTERNATIVE'].includes(status)) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
