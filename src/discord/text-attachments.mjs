export const SUPPORTED_TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
]);

export const SUPPORTED_TEXT_EXT_RE = /\.(txt|md|markdown|json|csv|tsv|log)(?:$|\?)/i;
export const TEXT_ATTACHMENT_MAX_BYTES = 256 * 1024;
export const TEXT_ATTACHMENT_MAX_CHARS = 20_000;

export function readTextAttachment(att) {
  if (!att) return null;
  const url = att.url || '';
  const rawCt = String(att.contentType || '').toLowerCase().split(';')[0].trim();
  const looksTextByType = SUPPORTED_TEXT_MIMES.has(rawCt);
  const looksTextByExt = SUPPORTED_TEXT_EXT_RE.test(url);
  if (!looksTextByType && !looksTextByExt) return null;
  return {
    url,
    contentType: looksTextByType ? rawCt : null,
    size: typeof att.size === 'number' ? att.size : null,
    name: att.name || null,
  };
}

export function pickFirstTextAttachment(msg) {
  const attachments = msg.attachments;
  if (!attachments) return null;
  for (const att of attachments.values()) {
    const result = readTextAttachment(att);
    if (result) return result;
  }
  return null;
}

export async function fetchTextAttachmentForLlm(
  url,
  maxBytes = TEXT_ATTACHMENT_MAX_BYTES,
  maxChars = TEXT_ATTACHMENT_MAX_CHARS,
) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`テキスト添付の取得に失敗: ${res.status} ${res.statusText}`);

  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new Error(`テキスト添付が大きすぎます (${Math.round(len / 1024)}KB)。${Math.round(maxBytes / 1024)}KB 以下にしてください。`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`テキスト添付が大きすぎます (${Math.round(buf.length / 1024)}KB)。${Math.round(maxBytes / 1024)}KB 以下にしてください。`);
  }

  let text = new TextDecoder('utf-8').decode(buf);
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  const originalLength = text.length;
  const truncated = originalLength > maxChars;
  if (truncated) {
    text = [
      text.slice(0, maxChars),
      '',
      `[Attachment truncated to first ${maxChars} characters.]`,
    ].join('\n');
  }

  return {
    text,
    originalLength,
    truncated,
    byteLength: buf.length,
  };
}
