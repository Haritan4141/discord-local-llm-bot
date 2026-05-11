// Shared LLM / Ollama configuration helpers used by both the bot runtime
// (src/config.mjs) and the GUI server (gui-server.mjs).

export function defaultLlmBaseUrl(provider) {
  if (provider === 'lmstudio') return 'http://127.0.0.1:1234/v1';
  if (provider === 'ollama') return 'http://127.0.0.1:11434/v1';
  return '';
}

export function normalizeOpenAiBaseUrl(url) {
  let base = String(url || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '');
  return base;
}

export function nativeOllamaBaseUrl(baseUrl) {
  return normalizeOpenAiBaseUrl(baseUrl).replace(/\/v1$/i, '');
}

export function numEnv(value, defaultValue) {
  if (value == null) return defaultValue;
  const raw = String(value).trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export function normalizeOllamaKeepAliveForApi(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}
