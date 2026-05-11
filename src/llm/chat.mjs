import {
  BOT_TIMEZONE,
  LLM_CHAT_COMPLETIONS_URL,
  LLM_MODEL_NAME,
  LLM_PROVIDER_MODE,
  LLM_TEMPERATURE_VALUE,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_NATIVE_BASE_URL,
  llmHeaders,
  normalizeOllamaKeepAliveForApi,
} from '../config.mjs';
import { fetchJsonWithTimeout } from '../utils/http.mjs';

export function getCurrentDateContextText() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: BOT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const formatted = formatter.format(now).replace(' ', 'T');
  return [
    `Current date/time: ${formatted} ${BOT_TIMEZONE}.`,
    'Use this as the current date unless the user explicitly asks about a different date.',
    'Do not assume the current year is 2024 by default.',
  ].join(' ');
}

export function injectRuntimeSystemMessages(messages, extraSystemContents = []) {
  const systemMessages = [
    getCurrentDateContextText(),
    ...extraSystemContents.filter(Boolean),
  ].map(content => ({ role: 'system', content }));

  if (!systemMessages.length) return messages;
  if (messages[0]?.role === 'system') {
    return [messages[0], ...systemMessages, ...messages.slice(1)];
  }
  return [...systemMessages, ...messages];
}

export async function localLlmChat(messages, options = {}) {
  const finalMessages = injectRuntimeSystemMessages(messages, options.extraSystemContents || []);
  const payload = {
    model: options.model || LLM_MODEL_NAME,
    messages: finalMessages,
    temperature: options.temperature ?? LLM_TEMPERATURE_VALUE,
    stream: false,
  };

  if (LLM_PROVIDER_MODE === 'ollama' && options.reasoningEffort) {
    payload.reasoning_effort = options.reasoningEffort;
  }

  const res = await fetch(LLM_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0] || null;
  const rawContent = choice?.message?.content ?? '';
  let text = '';

  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .map(part => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  } else if (rawContent != null) {
    text = String(rawContent);
  }

  return {
    text,
    rawContent,
    finishReason: choice?.finish_reason ?? null,
    json,
  };
}

export async function preloadOllamaModel() {
  if (LLM_PROVIDER_MODE !== 'ollama' || !OLLAMA_NATIVE_BASE_URL) return;

  const keepAlive = normalizeOllamaKeepAliveForApi(OLLAMA_KEEP_ALIVE);
  const body = {
    model: LLM_MODEL_NAME,
    stream: false,
  };
  if (keepAlive !== null) body.keep_alive = keepAlive;

  try {
    const json = await fetchJsonWithTimeout(
      `${OLLAMA_NATIVE_BASE_URL}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      30000,
    );

    const loadDurationNs = Number(json?.load_duration || 0);
    const loadDurationMs = Number.isFinite(loadDurationNs) && loadDurationNs > 0
      ? Math.round(loadDurationNs / 1_000_000)
      : null;
    const suffix = loadDurationMs !== null ? ` (${loadDurationMs} ms)` : '';
    const keepAliveText = OLLAMA_KEEP_ALIVE ? ` keep_alive=${OLLAMA_KEEP_ALIVE}` : '';
    console.log(`[ollama] preload complete: ${LLM_MODEL_NAME}${keepAliveText}${suffix}`);
  } catch (error) {
    console.warn(`[ollama] preload failed: ${error.message}`);
  }
}
