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
  const timeoutMsValue = value('SOLAT_MODEL_TIMEOUT_MS', '');
  const timeoutSecondsValue = value('SOLAT_MODEL_TIMEOUT_SECONDS', '');
  const timeout = Number.parseInt(
    timeoutMsValue || (timeoutSecondsValue ? Number.parseFloat(timeoutSecondsValue) * 1000 : '45000'),
    10,
  );
  const requestedThinkingMode = String(value('SOLAT_MODEL_THINKING', 'disabled')).trim().toLowerCase();
  const thinkingMode = ['enabled', 'disabled'].includes(requestedThinkingMode) ? requestedThinkingMode : 'disabled';
  return Object.freeze({
    provider: String(value('SOLAT_MODEL_PROVIDER', 'deepseek_api')),
    baseUrl: String(value('SOLAT_MODEL_BASE_URL', 'https://api.deepseek.com')).replace(/\/+$/, ''),
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
  });
}

module.exports = { parseDotEnv, readConfig };
