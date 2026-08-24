const fs = require('node:fs');
const path = require('node:path');

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function readConfig({ env = process.env, cwd = process.cwd(), envFiles = [] } = {}) {
  let fileValues = {};
  const candidates = [path.join(cwd, '.env'), ...envFiles].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      fileValues = { ...fileValues, ...parseDotEnv(fs.readFileSync(candidate, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const value = (key, fallback = '') => env[key] ?? fileValues[key] ?? fallback;
  // The Cloud architecture exposes one automatic role-based mode. Legacy
  // persisted/environment mode names are intentionally decommissioned here.
  const modelMode = 'auto';
  const qwenBaseUrl = String(value('SOLAT_QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')).replace(/\/+$/u, '');
  // SOLAT_QWEN_API_KEY is canonical for the unified Cloud architecture. The
  // former vision-only key remains a documented compatibility source so the
  // existing local owner configuration migrates without copying a secret.
  const qwenApiKey = String(value('SOLAT_QWEN_API_KEY', value('SOLAT_VISION_MODEL_API_KEY', '')));
  const flashTimeout = Number.parseInt(value('SOLAT_QWEN_FLASH_TIMEOUT_MS', '45000'), 10);
  const plusTimeout = Number.parseInt(value('SOLAT_QWEN_PLUS_TIMEOUT_MS', '90000'), 10);
  const visionEnabled = /^(?:1|true|on)$/iu.test(String(value('SOLAT_VISION_ENABLED', 'false')));
  const visionTimeout = Number.parseInt(value('SOLAT_VISION_MODEL_TIMEOUT_MS', '60000'), 10);
  const visionProvider = String(value('SOLAT_VISION_MODEL_PROVIDER', 'qwencloud_vision')).trim().toLowerCase();
  const voiceEnabled = !/^(?:0|false|off)$/iu.test(String(value('SOLAT_VOICE_ENABLED', 'true')));
  const voiceTimeout = Number.parseInt(value('SOLAT_VOICE_TIMEOUT_MS', '30000'), 10);
  const voiceTurnEndTimeout = Number.parseInt(value('SOLAT_VOICE_TURN_END_TIMEOUT_MS', '1200'), 10);
  const voiceSampleRate = Number.parseInt(value('SOLAT_VOICE_TTS_SAMPLE_RATE', '44100'), 10);
  return Object.freeze({
    modelArchitecture: 'qwen_flash_plus.v1',
    modelMode,
    flashModel: Object.freeze({
      provider: 'qwencloud_text',
      baseUrl: qwenBaseUrl,
      apiKey: qwenApiKey,
      model: String(value('SOLAT_QWEN_FLASH_MODEL', 'qwen3.7-flash')).trim(),
      thinkingMode: 'disabled',
      timeoutMs: Number.isFinite(flashTimeout) && flashTimeout > 0 ? flashTimeout : 45000,
    }),
    plusModel: Object.freeze({
      provider: 'qwencloud_text',
      baseUrl: qwenBaseUrl,
      apiKey: qwenApiKey,
      model: String(value('SOLAT_QWEN_PLUS_MODEL', 'qwen3.7-plus')).trim(),
      thinkingMode: 'enabled',
      timeoutMs: Number.isFinite(plusTimeout) && plusTimeout > 0 ? plusTimeout : 90000,
    }),
    visionModel: Object.freeze({
      enabled: visionEnabled,
      provider: visionProvider,
      baseUrl: String(value('SOLAT_VISION_MODEL_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')).replace(/\/+$/u, ''),
      apiKey: String(value('SOLAT_VISION_MODEL_API_KEY', qwenApiKey)),
      model: String(value('SOLAT_VISION_MODEL_NAME', 'qwen3-vl-flash')),
      thinkingMode: 'disabled',
      maxTokens: 128,
      keepAlive: '0s',
      timeoutMs: Number.isFinite(visionTimeout) && visionTimeout > 0 ? visionTimeout : 60000,
    }),
    voice: Object.freeze({
      enabled: voiceEnabled,
      provider: String(value('SOLAT_VOICE_PROVIDER', 'cartesia')).trim().toLowerCase(),
      apiKey: String(value('SOLAT_CARTESIA_API_KEY', '')),
      sttModel: String(value('SOLAT_VOICE_STT_MODEL', 'ink-2')).trim(),
      ttsModel: String(value('SOLAT_VOICE_TTS_MODEL', 'sonic-latest')).trim(),
      voiceId: String(value('SOLAT_CARTESIA_VOICE_ID', '')).trim(),
      language: String(value('SOLAT_VOICE_LANGUAGE', 'auto')).trim().toLowerCase(),
      timeoutMs: Number.isFinite(voiceTimeout) && voiceTimeout > 0 ? voiceTimeout : 30000,
      turnEndTimeoutMs: Math.max(640, Math.min(Number.isFinite(voiceTurnEndTimeout) ? voiceTurnEndTimeout : 1200, 11200)),
      ttsSampleRate: [8000, 16000, 22050, 24000, 44100, 48000].includes(voiceSampleRate) ? voiceSampleRate : 44100,
    }),
    // DuckDuckGo needs no additional credential, and its candidates are still
    // reduced to SOLAT's approved source allowlist before a model can use them.
    searchProvider: String(value('SOLAT_SEARCH_PROVIDER', 'ddg')).toLowerCase(),
    searchBaseUrl: String(value('SOLAT_SEARCH_BASE_URL', '')).replace(/\/+$/u, ''),
    searchApiKey: String(value('SOLAT_SEARCH_API_KEY', '')),
    searchTimeoutMs: Number.parseInt(value('SOLAT_SEARCH_TIMEOUT_MS', '8000'), 10) || 8000,
    searchResultLimit: Math.max(1, Math.min(Number.parseInt(value('SOLAT_SEARCH_RESULT_LIMIT', '5'), 10) || 5, 10)),
    searchWikipediaFallback: !/^(?:0|false|off)$/iu.test(String(value('SOLAT_SEARCH_WIKIPEDIA_FALLBACK', 'true'))),
    searchEngines: String(value('SOLAT_SEARCH_ENGINES', '')),
    commerceBaseUrl: String(value('SOLAT_BACKEND_BASE_URL', '')).replace(/\/+$/u, ''),
    commerceUserId: String(value('SOLAT_BACKEND_USER_ID', '')),
    commerceToken: String(value('SOLAT_BACKEND_TOKEN', '')),
    commerceTimeoutMs: Number.parseInt(value('SOLAT_BACKEND_TIMEOUT_MS', '12000'), 10) || 12000,
  });
}

module.exports = { parseDotEnv, readConfig };
