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

export function resolveOpenAiImageSize({ width, height, configuredSize = DEFAULT_SIZE } = {}) {
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

export function buildOpenAiImagePayload({ model, prompt, size, quality = 'low', count = 1 }) {
  const finalModel = String(model || '').trim();
  const finalPrompt = String(prompt || '').trim();
  const finalQuality = String(quality || '').trim().toLowerCase();
  const finalCount = Number(count);

  if (!finalModel) throw new Error('OpenAI image model is required.');
  if (!finalPrompt) throw new Error('Image prompt is required.');
  if (!parseSize(size)) throw new Error('OpenAI image size is required.');
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
    output_format: 'png',
  };
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
      inputTextTokens: nonNegativeInteger(usage.input_tokens_details?.text_tokens),
      inputImageTokens: nonNegativeInteger(usage.input_tokens_details?.image_tokens),
      outputTokens: nonNegativeInteger(usage.output_tokens),
      totalTokens: nonNegativeInteger(usage.total_tokens),
    },
  };
}

export async function generateOpenAiImages({
  url,
  apiKey,
  model,
  prompt,
  size,
  quality,
  count,
  timeoutMs = 180000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildOpenAiImagePayload({ model, prompt, size, quality, count })),
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
