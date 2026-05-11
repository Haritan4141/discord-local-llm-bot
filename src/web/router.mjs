import { LLM_PROVIDER_MODE } from '../config.mjs';
import { localLlmChat } from '../llm/chat.mjs';
import { truncateText } from '../utils/text.mjs';
import { AUTO_WEB_ROUTER_HISTORY_MESSAGES } from './ollama-search.mjs';

export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

export function buildAutoWebRouterMessages(history, name, text) {
  const recentMessages = history.slice(-(AUTO_WEB_ROUTER_HISTORY_MESSAGES + 1), -1);
  const recentText = recentMessages.map(message => {
    const role = String(message?.role || 'unknown').toUpperCase();
    return `${role}: ${truncateText(message?.content || '', 500)}`;
  }).join('\n\n');

  return [
    {
      role: 'system',
      content: [
        'You are a routing assistant for web search.',
        'Decide whether the latest user message requires up-to-date web search before answering.',
        'Return JSON only with keys: needs_web_search (boolean), search_query (string), reason (string).',
        'Set needs_web_search=true when the answer depends on current facts, current dates, release status, prices, availability, current versions, recent news, or when the latest message is a follow-up to such a topic.',
        'If the latest message contains a concrete URL and asks about that page, treat it as requiring web access.',
        "Use recent conversation context to resolve follow-up questions like 'それいくら？' or '本当に出た？'.",
        'If direct URL fetch alone is enough, you may set search_query to an empty string.',
        'If needs_web_search=false, set search_query to an empty string.',
        'No markdown. No prose outside the JSON.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        recentText ? `[Recent conversation]\n${recentText}` : '[Recent conversation]\n(none)',
        '',
        '[Latest user message]',
        `${name}: ${text}`,
      ].join('\n'),
    },
  ];
}

export async function decideAutoWebSearch(history, name, text) {
  const result = await localLlmChat(buildAutoWebRouterMessages(history, name, text), {
    temperature: 0.0,
    reasoningEffort: LLM_PROVIDER_MODE === 'ollama' ? 'none' : undefined,
  });

  const parsed = extractJsonObject(result?.text);
  if (!parsed) {
    console.warn(`[web] auto route parse failed: ${JSON.stringify(truncateText(result?.text || '', 300))}`);
  }
  const needsWebSearch = !!(parsed?.needs_web_search ?? parsed?.needsWebSearch);
  const rawQuery = String(parsed?.search_query ?? parsed?.searchQuery ?? '').trim();
  const reason = truncateText(String(parsed?.reason || ''), 300);
  const searchQuery = needsWebSearch ? truncateText(rawQuery || text, 300) : '';

  console.log(
    `[web] auto route: needs_search=${needsWebSearch} query=${JSON.stringify(searchQuery)} reason=${JSON.stringify(reason)}`,
  );

  return {
    needsWebSearch,
    searchQuery,
    reason,
    rawText: result?.text || '',
  };
}
