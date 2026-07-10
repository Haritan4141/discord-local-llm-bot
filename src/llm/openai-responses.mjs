function responseImageUrl(part) {
  if (typeof part?.image_url === 'string') return part.image_url;
  return String(part?.image_url?.url || '').trim();
}

export function convertChatMessagesForResponses(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => {
    const role = String(message?.role || 'user');
    const content = message?.content;

    if (!Array.isArray(content)) {
      return { role, content: content == null ? '' : String(content) };
    }

    const converted = [];
    for (const part of content) {
      if (typeof part === 'string') {
        converted.push({ type: 'input_text', text: part });
        continue;
      }
      if (part?.type === 'text' || part?.type === 'input_text') {
        converted.push({ type: 'input_text', text: String(part.text || '') });
        continue;
      }
      if (part?.type === 'image_url' || part?.type === 'input_image') {
        const imageUrl = responseImageUrl(part);
        if (imageUrl) converted.push({ type: 'input_image', image_url: imageUrl });
      }
    }

    return { role, content: converted };
  });
}

export function modelSupportsOpenAiReasoning(model) {
  const value = String(model || '').trim().toLowerCase();
  return /^gpt-5(?:[.-]|$)/.test(value) && !/(?:chat|search)/.test(value);
}

export function resolveOpenAiWebSearchMode({ forceSearch = false, configuredMode = '' } = {}) {
  if (forceSearch) return 'required';
  return String(configuredMode).trim().toLowerCase() === 'auto' ? 'auto' : 'off';
}

export function buildOpenAiResponsesPayload(messages, options = {}) {
  const model = String(options.model || '').trim();
  const webSearch = options.webSearch === 'required'
    ? 'required'
    : options.webSearch === 'auto'
      ? 'auto'
      : 'off';

  const payload = {
    model,
    input: convertChatMessagesForResponses(messages),
    store: false,
  };

  if (webSearch !== 'off') {
    payload.tools = [{ type: 'web_search' }];
    payload.tool_choice = webSearch;
    payload.include = ['web_search_call.action.sources'];

    // OpenAI notes that web search quality can be lower with reasoning disabled.
    if (modelSupportsOpenAiReasoning(model)) {
      payload.reasoning = { effort: 'low' };
    }
  }

  return payload;
}

function annotationSource(annotation) {
  const nested = annotation?.url_citation || null;
  const url = String(annotation?.url || nested?.url || '').trim();
  if (!url) return null;
  return {
    url,
    title: String(annotation?.title || nested?.title || url).trim(),
  };
}

function actionSource(source) {
  const url = String(source?.url || source?.source_website_url || '').trim();
  if (!url) return null;
  return {
    url,
    title: String(source?.title || source?.name || url).trim(),
  };
}

export function parseOpenAiResponsesResult(json) {
  const output = Array.isArray(json?.output) ? json.output : [];
  const textParts = [];
  const rawContent = [];
  const citedSourcesByUrl = new Map();
  const consultedSourcesByUrl = new Map();
  let usedWebSearch = false;

  const addSource = (map, source) => {
    if (!source?.url || map.has(source.url)) return;
    map.set(source.url, source);
  };

  for (const item of output) {
    if (item?.type === 'web_search_call') {
      usedWebSearch = true;
      for (const source of item?.action?.sources || []) {
        addSource(consultedSourcesByUrl, actionSource(source));
      }
      continue;
    }
    if (item?.type !== 'message') continue;

    for (const part of Array.isArray(item.content) ? item.content : []) {
      rawContent.push(part);
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        textParts.push(part.text);
        for (const annotation of part.annotations || []) {
          addSource(citedSourcesByUrl, annotationSource(annotation));
        }
      } else if (part?.type === 'refusal' && typeof part.refusal === 'string') {
        textParts.push(part.refusal);
      }
    }
  }

  const text = textParts.join('') || String(json?.output_text || '');
  const incompleteReason = json?.incomplete_details?.reason || null;
  const sourcesByUrl = new Map(citedSourcesByUrl);
  for (const [url, source] of consultedSourcesByUrl) {
    if (!sourcesByUrl.has(url)) sourcesByUrl.set(url, source);
  }
  return {
    text,
    rawContent,
    finishReason: incompleteReason || json?.status || null,
    json,
    sources: [...sourcesByUrl.values()].slice(0, 10),
    usedWebSearch,
  };
}

export async function callOpenAiResponses({
  url,
  headers,
  messages,
  model,
  webSearch,
  timeoutMs = 120000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildOpenAiResponsesPayload(messages, { model, webSearch })),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`OpenAI Responses error: ${res.status} ${res.statusText}\n${bodyText}`);
    }

    return parseOpenAiResponsesResult(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
