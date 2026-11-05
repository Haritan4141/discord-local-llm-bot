import { Blob } from 'node:buffer';
import sharp from 'sharp';
import { truncateText } from '../utils/text.mjs';
import { assertReferenceImageCount, validateReferenceImage } from './reference-images.mjs';

const DEFAULT_SIZE = '1024x1024';
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3840;

function parseSize(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function validateOpenAiImageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return false;
  }
  if (width > MAX_EDGE || height > MAX_EDGE) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;

  const pixels = width * height;
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) return false;

  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  return aspectRatio <= 3;
}

export function resolveOpenAiImageSize({ width, height, configuredSize = DEFAULT_SIZE, format = 'png' } = {}) {
  if (format === 'gif') {
    if (width == null && height == null) return 'auto';
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= MAX_EDGE && value % 16 === 0)
        || width * height > MAX_PIXELS) {
      throw new Error('GIFのwidth / heightは両方を16px単位で指定してください（各辺は最大3840px）。省略すると自動サイズです。');
    }
    return `${width}x${height}`;
  }
  const configured = parseSize(configuredSize) || parseSize(DEFAULT_SIZE);
  const resolvedWidth = Number.isInteger(width) ? width : configured.width;
  const resolvedHeight = Number.isInteger(height) ? height : configured.height;

  if (!validateOpenAiImageDimensions(resolvedWidth, resolvedHeight)) {
    throw new Error(
      `OpenAI Image のサイズ ${resolvedWidth}x${resolvedHeight} は未対応です。` +
      '各辺を16px単位・最大3840px、総画素数を655,360〜8,294,400、縦横比を3:1以内にしてください。' +
      '例: 1024x1024、1536x1024、1024x1536',
    );
  }

  return `${resolvedWidth}x${resolvedHeight}`;
}

export function resolveOpenAiImageOutput({ format = 'png', frameCount, frameDurationMs } = {}) {
  const finalFormat = String(format).trim().toLowerCase();
  if (!['png', 'gif'].includes(finalFormat)) throw new Error('format は png / gif を指定してください。');
  if (finalFormat === 'png') {
    if (frameCount != null || frameDurationMs != null) {
      throw new Error('frame_count / frame_duration_ms は format:gif の場合だけ指定できます。');
    }
    return { format: 'png' };
  }
  const count = frameCount ?? 9;
  const duration = frameDurationMs ?? 200;
  if (!Number.isInteger(count) || count < 2 || count > 64) {
    throw new Error('frame_count は2〜64の整数で指定してください。');
  }
  if (!Number.isInteger(duration) || duration < 20 || duration > 2000) {
    throw new Error('frame_duration_ms は20〜2000の整数で指定してください。');
  }
  return { format: 'gif', frameCount: count, frameDurationMs: Math.round(duration / 10) * 10 };
}

export function assertOpenAiGifModel(model) {
  if (!['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'].includes(model)) {
    throw new Error('GIF生成には gpt-image-2.6-flare / gpt-image-2.6-sunburst を設定してください。');
  }
}

export async function assertAnimatedGif(buffer) {
  try {
    const metadata = await sharp(buffer, { animated: true }).metadata();
    if (metadata.format === 'gif' && metadata.pages >= 2) return;
  } catch {}
  throw new Error('OpenAI Image APIから有効なアニメーションGIFが返されませんでした。');
}

export function buildOpenAiImagePayload({ model, prompt, size, quality = 'low', count = 1, ...outputOptions }) {
  const finalModel = String(model || '').trim();
  const finalPrompt = String(prompt || '').trim();
  const finalQuality = String(quality || '').trim().toLowerCase();
  const finalCount = Number(count);
  const output = resolveOpenAiImageOutput(outputOptions);

  if (!finalModel) throw new Error('OpenAI image model is required.');
  if (!finalPrompt) throw new Error('Image prompt is required.');
  if (output.format === 'gif') {
    assertOpenAiGifModel(finalModel);
    if (size !== 'auto') {
      const dimensions = parseSize(size);
      if (!dimensions) throw new Error('OpenAI GIF size is required.');
      resolveOpenAiImageSize({ ...dimensions, format: 'gif' });
    }
  } else if (!parseSize(size)) throw new Error('OpenAI image size is required.');
  if (!['auto', 'low', 'medium', 'high'].includes(finalQuality)) {
    throw new Error(`Unsupported OpenAI image quality: ${quality}`);
  }
  if (!Number.isInteger(finalCount) || finalCount < 1 || finalCount > 4) {
    throw new Error('OpenAI image count must be between 1 and 4.');
  }

  return {
    model: finalModel,
    prompt: finalPrompt,
    n: finalCount,
    size,
    quality: finalQuality,
    output_format: output.format,
    ...(output.format === 'gif' ? { frame_count: output.frameCount, frame_duration_ms: output.frameDurationMs } : {}),
  };
}

export function buildOpenAiImageEditForm({ references, ...options }) {
  if (resolveOpenAiImageOutput(options).format === 'gif') {
    throw new Error('GIF生成は新規生成専用です。参照画像を使う編集には対応していません。');
  }
  if (!Array.isArray(references) || !references.length) {
    throw new Error('OpenAI Image edits には参照画像が必要です。');
  }
  assertReferenceImageCount(references.length);
  const form = new FormData();
  const payload = buildOpenAiImagePayload(options);
  for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
  for (const [index, reference] of references.entries()) {
    const { data, mime } = validateReferenceImage(reference);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
    form.append('image[]', new Blob([data], { type: mime }), `reference_${index + 1}.${extension}`);
  }
  return form;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

export function parseOpenAiImageResult(json) {
  const data = Array.isArray(json?.data) ? json.data : [];
  const images = data
    .map(item => String(item?.b64_json || '').trim())
    .filter(Boolean);
  const usage = json?.usage || {};

  return {
    images,
    revisedPrompts: data.map(item => String(item?.revised_prompt || '').trim()),
    usage: {
      inputTokens: nonNegativeInteger(usage.input_tokens),
      inputTextTokens: nonNegativeInteger(usage.input_tokens_details?.text_tokens ?? usage.input_text_tokens),
      inputImageTokens: nonNegativeInteger(usage.input_tokens_details?.image_tokens ?? usage.input_image_tokens),
      outputTokens: nonNegativeInteger(usage.output_tokens),
      totalTokens: nonNegativeInteger(usage.total_tokens),
    },
  };
}

export function formatOpenAiImageCompletion({
  prompt,
  model,
  size,
  quality,
  imageCount,
  mode,
  referenceCount,
  referenceNames = [],
  referenceDimensions = [],
  automaticReferences = false,
  usage,
  maxPromptChars = 1000,
  format = 'png',
  frameCount,
  frameDurationMs,
}) {
  const promptText = truncateText(prompt, maxPromptChars) || '(empty)';
  return [
    `prompt: ${promptText}`,
    `生成完了 | provider: OpenAI | model: ${model}${mode ? ` | mode: ${mode}` : ''}` +
      ` | size: ${size} | quality: ${quality} | images: ${imageCount}` +
      (referenceCount == null ? '' : ` | references: ${referenceCount}`),
    ...(format === 'gif' ? [`format: gif | frames: ${frameCount} | frame duration: ${frameDurationMs}ms | loop: ${frameCount * frameDurationMs / 1000}秒`] : []),
    ...(referenceNames.length > 1 || (automaticReferences && referenceNames.length) ? [
      `${automaticReferences ? '自動参照' : 'reference profiles'}: ${truncateText(referenceNames.map(name => JSON.stringify(name)).join(' / '), 450)}`,
    ] : []),
    ...(usage ? [
      `usage | input_text: ${usage.inputTextTokens} | input_image: ${usage.inputImageTokens}` +
      ` | output: ${usage.outputTokens} | total: ${usage.totalTokens}`,
    ] : []),
    ...(referenceDimensions.length ? [`reference input: ${referenceDimensions.join(' / ')} px`] : []),
  ].join('\n');
}

export async function generateOpenAiImages({
  url,
  apiKey,
  model,
  prompt,
  size,
  quality,
  count,
  format = 'png',
  frameCount,
  frameDurationMs,
  references = [],
  editsUrl = 'https://api.openai.com/v1/images/edits',
  fetchImpl = globalThis.fetch,
  timeoutMs = 180000,
}) {
  const isEdit = references.length > 0;
  const options = { model, prompt, size, quality, count, format, frameCount, frameDurationMs };
  const body = isEdit
    ? buildOpenAiImageEditForm({ ...options, references })
    : JSON.stringify(buildOpenAiImagePayload(options));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(isEdit ? editsUrl : url, {
      method: 'POST',
      headers: {
        ...(!isEdit ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      let detail = bodyText;
      try {
        detail = JSON.parse(bodyText)?.error?.message || bodyText;
      } catch {}
      throw new Error(`OpenAI Image API error: ${res.status} ${res.statusText}${detail ? `\n${detail}` : ''}`);
    }

    return parseOpenAiImageResult(await res.json());
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`OpenAI Image API timeout after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
