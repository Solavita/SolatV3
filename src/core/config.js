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

function normalizeRunpodVllmBaseUrl(provider, rawValue) {
  const raw = String(rawValue || '').replace(/\/+$/u, '');
  if (String(provider || '').toLowerCase() !== 'runpod_vllm' || !raw) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname !== 'api.runpod.ai') return raw;
    const decodedPath = decodeURIComponent(url.pathname).trim().replace(/\s*\/+$/u, '');
    const match = /^\/v2\/([^/]+)\/runsync$/u.exec(decodedPath);
    if (!match) return raw;
    url.pathname = `/v2/${match[1]}/openai/v1`;
    url.search = '';
    return url.toString().replace(/\/+$/u, '');
  } catch {
    return raw;
  }
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
  const timeoutMsValue = value('SOLAT_MODEL_TIMEOUT_MS', '');
  const timeoutSecondsValue = value('SOLAT_MODEL_TIMEOUT_SECONDS', '');
  const timeout = Number.parseInt(
    timeoutMsValue || (timeoutSecondsValue ? Number.parseFloat(timeoutSecondsValue) * 1000 : '45000'),
    10,
  );
  const requestedThinkingMode = String(value('SOLAT_MODEL_THINKING', 'disabled')).trim().toLowerCase();
  const thinkingMode = ['enabled', 'disabled'].includes(requestedThinkingMode) ? requestedThinkingMode : 'disabled';
  const provider = String(value('SOLAT_MODEL_PROVIDER', 'deepseek_api'));
  return Object.freeze({
    provider,
    baseUrl: normalizeRunpodVllmBaseUrl(provider, value('SOLAT_MODEL_BASE_URL', 'https://api.deepseek.com')),
    apiKey: String(value('SOLAT_MODEL_API_KEY')),
    model: String(value('SOLAT_MODEL_NAME', 'deepseek-v4-flash')),
    thinkingMode,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45000,
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
