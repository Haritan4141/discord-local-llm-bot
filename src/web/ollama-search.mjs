import { OLLAMA_WEB_API_KEY_VALUE } from '../config.mjs';
import { fetchJsonWithTimeout } from '../utils/http.mjs';

export const OLLAMA_WEB_SEARCH_URL = 'https://ollama.com/api/web_search';
export const OLLAMA_WEB_FETCH_URL = 'https://ollama.com/api/web_fetch';
export const WEB_SEARCH_MAX_RESULTS = 5;
export const WEB_FETCH_TOP_RESULTS = 3;
export const WEB_SEARCH_SNIPPET_MAX_CHARS = 500;
export const WEB_FETCH_CONTENT_MAX_CHARS = 2500;
export const WEB_DIRECT_FETCH_MAX_URLS = 3;
export const AUTO_WEB_ROUTER_HISTORY_MESSAGES = 6;

export function ollamaWebHeaders() {
  const apiKey = String(OLLAMA_WEB_API_KEY_VALUE || '').trim();
  if (!apiKey) {
    throw new Error('OLLAMA_WEB_API_KEY が設定されていません。/webchat を使うには GUI か .env で設定してください。');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function ollamaWebSearch(query, maxResults = WEB_SEARCH_MAX_RESULTS) {
  const json = await fetchJsonWithTimeout(
    OLLAMA_WEB_SEARCH_URL,
    {
      method: 'POST',
      headers: ollamaWebHeaders(),
      body: JSON.stringify({
        query,
        max_results: Math.max(1, Math.min(10, maxResults)),
      }),
    },
    15000,
  );

  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .map(item => ({
      title: String(item?.title || '').trim(),
      url: String(item?.url || '').trim(),
      content: String(item?.content || '').trim(),
    }))
    .filter(item => item.url);
}

export async function ollamaWebFetch(url) {
  const json = await fetchJsonWithTimeout(
    OLLAMA_WEB_FETCH_URL,
    {
      method: 'POST',
      headers: ollamaWebHeaders(),
      body: JSON.stringify({ url }),
    },
    20000,
  );

  return {
    title: String(json?.title || '').trim(),
    content: String(json?.content || '').trim(),
    links: Array.isArray(json?.links) ? json.links.map(link => String(link || '').trim()).filter(Boolean) : [],
  };
}
