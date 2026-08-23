const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { createProvider, messagesWithVisionCapture } = require('../src/core/provider');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_IMAGE = 'C:\\Users\\pengc\\Pictures\\Screenshots\\Screenshot 2026-08-20 212727.png';
const DEFAULT_MODELS = [
  'hf.co/pierretokns/smolvlm-500m-ccmcp-v1:Q4_K_M',
  'hf.co/pierretokns/smolvlm-500m-ccmcp-v1:F16',
];

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error('Expected a valid PNG input.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function expectedBox(value) {
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) throw new Error('--expected-box must be x1,y1,x2,y2.');
  const [x1, y1, x2, y2] = parts;
  if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1) throw new Error('--expected-box is invalid.');
  return { x1, y1, x2, y2 };
}

function evaluate(data, box, dimensions) {
  const coordinate = Array.isArray(data?.coordinate) ? data.coordinate.map(Number) : [];
  const validCoordinate = coordinate.length === 2 && coordinate.every(Number.isFinite)
    && coordinate[0] >= 0 && coordinate[0] < dimensions.width
    && coordinate[1] >= 0 && coordinate[1] < dimensions.height;
  const inExpectedBox = validCoordinate
    && coordinate[0] >= box.x1 && coordinate[0] <= box.x2
    && coordinate[1] >= box.y1 && coordinate[1] <= box.y2;
  return {
    action_is_left_click: data?.action === 'left_click',
    coordinate: validCoordinate ? coordinate : null,
    coordinate_in_image: validCoordinate,
    coordinate_in_expected_box: inExpectedBox,
    pass: data?.action === 'left_click' && inExpectedBox,
  };
}

function parseModelJson(content) {
  const raw = String(content || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(raw);
  return JSON.parse(fenced ? fenced[1].trim() : raw);
}

async function runModel({ model, mode, bytes, dimensions, box }) {
  const provider = createProvider({
    provider: 'ollama_vision',
    baseUrl: argument('--base-url', 'http://127.0.0.1:11434/v1'),
    apiKey: 'ollama',
    model,
    timeoutMs: Math.max(1_000, Number(argument('--timeout-ms', '60000')) || 60_000),
    maxTokens: 128,
    keepAlive: '5m',
  });
  const startedAt = Date.now();
  try {
    const capture = {
      metadata: { schema_version: 'solat.computer-screen-capture.v1', media_type: 'image/png' },
      bytes,
    };
    const messages = messagesWithVisionCapture([
      { role: 'system', content: 'You are a GUI grounding assistant. Given a screenshot and instruction, output click coordinates as JSON.' },
      { role: 'user', content: argument('--instruction', 'Click the SEND button') },
    ], capture);
    const result = await provider.complete(messages, mode === 'json_format' ? { responseFormat: { type: 'json_object' } } : {});
    let data;
    try {
      data = parseModelJson(result.content);
    } catch {
      return {
        model,
        mode,
        status: 'FAIL',
        latency_ms: Date.now() - startedAt,
        raw_response: String(result.content || '').slice(0, 4_000),
        usage: result.usage || null,
        error: { code: 'malformed_response', message: 'The model did not return one valid JSON object.' },
      };
    }
    const assessment = evaluate(data, box, dimensions);
    return {
      model,
      mode,
      status: assessment.pass ? 'PASS' : 'FAIL',
      latency_ms: Date.now() - startedAt,
      raw_response: String(result.content || '').slice(0, 4_000),
      response: data,
      usage: result.usage || null,
      assessment,
    };
  } catch (error) {
    return {
      model,
      mode,
      status: 'FAIL',
      latency_ms: Date.now() - startedAt,
      error: { code: error?.code || 'unknown', message: String(error?.message || error).slice(0, 500) },
    };
  }
}

async function main() {
  const output = path.resolve(ROOT, argument('--output', 'reports/smolvlm-grounding-live-latest.json'));
  const imagePath = path.resolve(argument('--image', DEFAULT_IMAGE));
  const models = argument('--models', DEFAULT_MODELS.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  const modes = argument('--modes', 'raw,json_format').split(',').map(value => value.trim()).filter(value => ['raw', 'json_format'].includes(value));
  if (!modes.length) throw new Error('--modes must contain raw and/or json_format.');
  const box = expectedBox(argument('--expected-box', '1160,780,1425,990'));
  const base = {
    schema_version: 'solat.smolvlm-grounding-smoke.v1',
    executed: process.argv.includes('--execute'),
    image_path: imagePath,
    instruction: argument('--instruction', 'Click the SEND button'),
    expected_box: box,
    models,
    modes,
    started_at: new Date().toISOString(),
  };
  if (!base.executed) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify({ ...base, status: 'NOT RUN', results: [] }, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output, status: 'NOT RUN' })}\n`);
    process.exitCode = 2;
    return;
  }
  const bytes = fs.readFileSync(imagePath);
  const dimensions = pngDimensions(bytes);
  const results = [];
  for (const model of models) {
    for (const mode of modes) results.push(await runModel({ model, mode, bytes, dimensions, box }));
  }
  const status = results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
  const report = {
    ...base,
    finished_at: new Date().toISOString(),
    status,
    image: {
      ...dimensions,
      size_bytes: bytes.length,
      sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    },
    results,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, status, results: results.map(result => ({ model: result.model, status: result.status, latency_ms: result.latency_ms })) })}\n`);
  if (status !== 'PASS') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
