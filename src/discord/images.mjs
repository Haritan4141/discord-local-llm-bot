import { LLM_PROVIDER_MODE } from '../config.mjs';

export const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const SUPPORTED_IMAGE_EXT_RE = /\.(png|jpe?g|webp)(?:$|\?)/i;

export function readImageAttachment(att) {
  if (!att) return null;
  const url = att.url || '';
  const rawCt = String(att.contentType || '').toLowerCase().split(';')[0].trim();
  const looksImageByType = SUPPORTED_IMAGE_MIMES.has(rawCt);
  const looksImageByExt = SUPPORTED_IMAGE_EXT_RE.test(url);
  if (!looksImageByType && !looksImageByExt) return null;
  return {
    url,
    contentType: looksImageByType ? rawCt : null,
    size: typeof att.size === 'number' ? att.size : null,
    name: att.name || null,
  };
}

export function pickImageFromInteraction(interaction) {
  return readImageAttachment(interaction.options.getAttachment('image'));
}

export function pickFirstImageAttachment(msg) {
  const attachments = msg.attachments;
  if (!attachments) return null;
  for (const att of attachments.values()) {
    const result = readImageAttachment(att);
    if (result) return result;
  }
  return null;
}

export function guessMimeFromUrl(url) {
  let target = String(url || '');
  try {
    target = new URL(target).pathname || target;
  } catch {}

  target = target.split('?')[0].split('#')[0];

  if (/\.png$/i.test(target)) return 'image/png';
  if (/\.jpe?g$/i.test(target)) return 'image/jpeg';
  if (/\.webp$/i.test(target)) return 'image/webp';
  return 'image/png';
}

export function normalizeMimeForLlm(mime, url) {
  const raw = String(mime || '').toLowerCase().split(';')[0].trim();
  const guessed = guessMimeFromUrl(url);
  const candidate = SUPPORTED_IMAGE_MIMES.has(raw) ? raw : guessed;

  if (LLM_PROVIDER_MODE === 'lmstudio') {
    if (candidate === 'image/png' || candidate === 'image/jpeg') return candidate;
    return 'image/png';
  }

  return candidate || 'image/png';
}

export async function fetchImageForLlm(url, contentTypeHint, maxBytes = 10 * 1024 * 1024) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像取得に失敗: ${res.status} ${res.statusText}`);

  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(len / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(buf.length / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const mime = normalizeMimeForLlm(contentTypeHint || res.headers.get('content-type') || '', url);
  const base64 = buf.toString('base64');
  return {
    mime,
    base64,
    dataUrl: `data:${mime};base64,${base64}`,
  };
}

export function buildVisionImageContentPart(image) {
  if (LLM_PROVIDER_MODE === 'ollama') {
    return { type: 'image_url', image_url: image.dataUrl };
  }
  if (LLM_PROVIDER_MODE === 'lmstudio') {
    return { type: 'image_url', image_url: { url: image.dataUrl } };
  }
  return { type: 'image_url', image_url: { url: image.dataUrl } };
}
