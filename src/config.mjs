import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultLlmBaseUrl,
  isOpenAiApiProvider,
  normalizeOpenAiBaseUrl,
  nativeOllamaBaseUrl,
  numEnv,
  normalizeOllamaKeepAliveForApi,
} from './utils/llm-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root (one level above src/).
export const PROJECT_ROOT = path.resolve(__dirname, '..');

const {
  DISCORD_TOKEN,
  CHANNEL_IDS,
  LLM_PROVIDER,
  LLM_BASE_URL,
  LLM_MODEL,
  LLM_API_KEY,
  LLM_TEMPERATURE,
  LLM_MAX_HISTORY_MESSAGES,
  WEB_SEARCH_MODE,
  OPENAI_WEB_SEARCH_MAX_TOOL_CALLS,
  OPENAI_WEB_SEARCH_MAX_SOURCES,
  OLLAMA_KEEP_ALIVE: OLLAMA_KEEP_ALIVE_ENV,
  OLLAMA_URL,
  OLLAMA_MODEL,
  OLLAMA_WEB_API_KEY,
  SYSTEM_PROMPT,
  SD_WEBUI_URL,
  SD_STEPS,
  SD_CFG_SCALE,
  SD_WIDTH,
  SD_HEIGHT,
  SD_SAMPLER,
  SD_NEGATIVE_PROMPT,
  SD_BATCH_SIZE,
  SD_PROMPT_TRANSLATE,
  SD_PROMPT_TRANSLATE_MODEL,
  ACE_URL,
  ACE_POLL_MS,
  ACE_API_KEY,
  COMFY_URL,
  COMFY_WORKFLOW_PATH,
  MUSIC_BACKEND,
  BOT_TIMEZONE: BOT_TIMEZONE_ENV,
} = process.env;

export const DISCORD_TOKEN_VALUE = DISCORD_TOKEN;
export const OLLAMA_WEB_API_KEY_VALUE = OLLAMA_WEB_API_KEY;
export const SYSTEM_PROMPT_VALUE = SYSTEM_PROMPT;

export const allowedChannelIds = new Set(
  (CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

export const LLM_PROVIDER_MODE =
  (LLM_PROVIDER || (LLM_BASE_URL || LLM_MODEL ? 'custom' : 'ollama')).toLowerCase();
export const LLM_MODEL_NAME = LLM_MODEL || OLLAMA_MODEL;
export const OLLAMA_KEEP_ALIVE = String(OLLAMA_KEEP_ALIVE_ENV || '').trim();

const DEFAULT_LLM_TEMPERATURE = 0.4;
const DEFAULT_LLM_MAX_HISTORY_MESSAGES = 30;
const DEFAULT_WEB_SEARCH_MODE = 'manual';
const DEFAULT_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS = 2;
const DEFAULT_OPENAI_WEB_SEARCH_MAX_SOURCES = 1;

export function resolveLlmTemperature(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_LLM_TEMPERATURE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_TEMPERATURE;
  if (parsed < 0 || parsed > 2) return DEFAULT_LLM_TEMPERATURE;
  return parsed;
}

export function resolveLlmMaxHistoryMessages(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_LLM_MAX_HISTORY_MESSAGES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return DEFAULT_LLM_MAX_HISTORY_MESSAGES;
  if (parsed < 0) return DEFAULT_LLM_MAX_HISTORY_MESSAGES;
  return parsed;
}

export function resolveWebSearchMode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  return DEFAULT_WEB_SEARCH_MODE;
}

function resolveIntegerInRange(value, fallback, min, max) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function resolveOpenAiWebSearchMaxToolCalls(value) {
  return resolveIntegerInRange(
    value,
    DEFAULT_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS,
    1,
    10,
  );
}

export function resolveOpenAiWebSearchMaxSources(value) {
  return resolveIntegerInRange(
    value,
    DEFAULT_OPENAI_WEB_SEARCH_MAX_SOURCES,
    0,
    10,
  );
}

export function resolveBotTimezone(value, { logger } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Asia/Tokyo';
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone: raw });
    return raw;
  } catch {
    if (logger) logger(raw);
    return 'Asia/Tokyo';
  }
}

export const LLM_TEMPERATURE_VALUE = resolveLlmTemperature(LLM_TEMPERATURE);
export const LLM_MAX_HISTORY_MESSAGES_VALUE = resolveLlmMaxHistoryMessages(LLM_MAX_HISTORY_MESSAGES);
export const WEB_SEARCH_MODE_VALUE = resolveWebSearchMode(WEB_SEARCH_MODE);
export const OPENAI_WEB_SEARCH_MAX_TOOL_CALLS_VALUE =
  resolveOpenAiWebSearchMaxToolCalls(OPENAI_WEB_SEARCH_MAX_TOOL_CALLS);
export const OPENAI_WEB_SEARCH_MAX_SOURCES_VALUE =
  resolveOpenAiWebSearchMaxSources(OPENAI_WEB_SEARCH_MAX_SOURCES);
export const BOT_TIMEZONE = resolveBotTimezone(BOT_TIMEZONE_ENV, {
  logger: raw => console.warn(`[config] invalid BOT_TIMEZONE=${JSON.stringify(raw)}, falling back to Asia/Tokyo`),
});

function resolveLlmBaseUrl() {
  if (LLM_BASE_URL) return normalizeOpenAiBaseUrl(LLM_BASE_URL);
  if (LLM_PROVIDER) return normalizeOpenAiBaseUrl(defaultLlmBaseUrl(LLM_PROVIDER_MODE));
  if (OLLAMA_URL) return normalizeOpenAiBaseUrl(OLLAMA_URL);
  return normalizeOpenAiBaseUrl(defaultLlmBaseUrl(LLM_PROVIDER_MODE));
}

export const LLM_BASE_URL_RESOLVED = resolveLlmBaseUrl();
export const LLM_CHAT_COMPLETIONS_URL = LLM_BASE_URL_RESOLVED
  ? `${LLM_BASE_URL_RESOLVED}/chat/completions`
  : '';
export const LLM_RESPONSES_URL = LLM_BASE_URL_RESOLVED
  ? `${LLM_BASE_URL_RESOLVED}/responses`
  : '';
export const OPENAI_RESPONSES_ENABLED = isOpenAiApiProvider(
  LLM_PROVIDER_MODE,
  LLM_BASE_URL_RESOLVED,
);
export const OLLAMA_NATIVE_BASE_URL = LLM_PROVIDER_MODE === 'ollama'
  ? nativeOllamaBaseUrl(LLM_BASE_URL_RESOLVED)
  : '';

export function llmHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;
  return headers;
}

// Stable Diffusion / music backend constants.
export const SD_URL = (SD_WEBUI_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');
export const ACE_BASE_URL = (ACE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
export const ACE_KEY = ACE_API_KEY || process.env.ACESTEP_API_KEY;
export const ACE_POLL_MS_VALUE = ACE_POLL_MS;
export const COMFY_BASE_URL = (COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
export const COMFY_WORKFLOW_FILE = COMFY_WORKFLOW_PATH
  ? COMFY_WORKFLOW_PATH
  : path.join(PROJECT_ROOT, 'comfyui', 'workflows', 'audio_ace_step_1_5_checkpoint_api.json');
export const MUSIC_BACKEND_MODE = (MUSIC_BACKEND || 'comfyui').toLowerCase();
export const SD_TRANSLATE_ENABLED = String(SD_PROMPT_TRANSLATE || 'false').toLowerCase() === 'true';
export const SD_TRANSLATE_MODEL = SD_PROMPT_TRANSLATE_MODEL || LLM_MODEL_NAME;
export const SD_DEFAULTS = {
  width: SD_WIDTH,
  height: SD_HEIGHT,
  steps: SD_STEPS,
  cfgScale: SD_CFG_SCALE,
  sampler: SD_SAMPLER,
  negative: SD_NEGATIVE_PROMPT,
  batchSize: SD_BATCH_SIZE,
};

export const DISCORD_MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

export function assertRuntimeConfig() {
  if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN が .env に設定されていません');
  if (allowedChannelIds.size === 0) throw new Error('CHANNEL_IDS が .env に設定されていません');
  if (!LLM_CHAT_COMPLETIONS_URL) throw new Error('LLM_BASE_URL または OLLAMA_URL が .env に設定されていません');
  if (!LLM_MODEL_NAME) throw new Error('LLM_MODEL または OLLAMA_MODEL が .env に設定されていません');
  if (OPENAI_RESPONSES_ENABLED && !LLM_API_KEY) {
    throw new Error('OpenAI API を使うには LLM_API_KEY を .env に設定してください');
  }
}

// Re-export low-level utilities for callers that import config.mjs directly.
export { numEnv, normalizeOllamaKeepAliveForApi };
