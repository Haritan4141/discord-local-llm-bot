import {
  LLM_MAX_HISTORY_MESSAGES_VALUE,
  LLM_MODEL_NAME,
  LLM_PROVIDER_MODE,
} from '../config.mjs';
import {
  codePointPreview,
  previewValueForLog,
  stripInvisibleCharacters,
  truncateText,
} from '../utils/text.mjs';

export function estimateHistoryCharCount(messages) {
  return (messages || []).reduce((sum, message) => {
    const content = message?.content;
    if (typeof content === 'string') return sum + content.length;
    if (Array.isArray(content)) {
      return sum + content.reduce((inner, part) => {
        if (typeof part === 'string') return inner + part.length;
        if (typeof part?.text === 'string') return inner + part.text.length;
        if (typeof part?.image_url === 'string') return inner + part.image_url.length;
        if (typeof part?.image_url?.url === 'string') return inner + part.image_url.url.length;
        return inner;
      }, 0);
    }
    if (content == null) return sum;
    return sum + String(content).length;
  }, 0);
}

export function logLlmTimeout({ error, messages, item, useWebSearch, imageAtt }) {
  const causeCode = error?.cause?.code || '';
  if (causeCode !== 'UND_ERR_HEADERS_TIMEOUT') return;

  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const historyMessageCount = Math.max(0, messageCount - 1);
  const historyCharCount = estimateHistoryCharCount(messages);
  const lastUserLength = String(item?.text || '').length;
  const promptPreview = truncateText(item?.text || '', 200);

  console.log(
    `[llm] headers timeout: provider=${LLM_PROVIDER_MODE} model=${LLM_MODEL_NAME} kind=${item?.kind || 'unknown'} webSearch=${useWebSearch} image=${!!imageAtt} history_message_count=${historyMessageCount} history_char_count=${historyCharCount} max_history_messages=${LLM_MAX_HISTORY_MESSAGES_VALUE} last_user_length=${lastUserLength} prompt=${JSON.stringify(promptPreview)}`,
  );
}

export function logEmptyLlmResponse({ item, useWebSearch, imageAtt, result }) {
  const topLevelKeys = Object.keys(result?.json || {});
  const choice = result?.json?.choices?.[0] || {};
  const choiceKeys = Object.keys(choice);
  const messageKeys = Object.keys(choice?.message || {});
  const rawPreview = previewValueForLog(result?.rawContent);
  const textPreview = previewValueForLog(result?.text);
  const promptPreview = truncateText(item?.text || (imageAtt ? '[image]' : ''), 120);

  console.warn(
    `[llm] empty response detected: provider=${LLM_PROVIDER_MODE} model=${LLM_MODEL_NAME} kind=${item?.kind || 'unknown'} webSearch=${useWebSearch} image=${!!imageAtt} finish_reason=${result?.finishReason ?? 'null'} prompt=${JSON.stringify(promptPreview)}`,
  );
  console.warn(
    `[llm] empty response details: text_length=${String(result?.text || '').length} visible_length=${stripInvisibleCharacters(result?.text || '').trim().length} raw_type=${Array.isArray(result?.rawContent) ? 'array' : typeof result?.rawContent} top_level_keys=${topLevelKeys.join(',') || '(none)'} choice_keys=${choiceKeys.join(',') || '(none)'} message_keys=${messageKeys.join(',') || '(none)'}`,
  );
  console.warn(
    `[llm] empty response preview: text=${JSON.stringify(textPreview)} raw=${JSON.stringify(rawPreview)} codepoints=${codePointPreview(result?.text)}`,
  );
}
