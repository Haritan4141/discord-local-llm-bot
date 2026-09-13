import sharp from 'sharp';
import { assertReferenceImageCount, validateReferenceImage } from './reference-images.mjs';

export const DEFAULT_REFERENCE_MAX_EDGE = 768;
export const MAX_REFERENCE_INPUT_PIXELS = 40_000_000;

export function resolveReferenceMaxEdge(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_REFERENCE_MAX_EDGE;
  const edge = Number(value);
  if (!Number.isInteger(edge) || edge < 256 || edge > 2048) {
    throw new Error('OPENAI_IMAGE_REFERENCE_MAX_EDGE は256〜2048の整数で指定してください。');
  }
  return edge;
}

/** Prepare transmission copies only; never write to reference storage. */
export async function prepareReferenceImages(references, { maxEdge } = {}) {
  assertReferenceImageCount(references.length);
  const edge = resolveReferenceMaxEdge(maxEdge);
  const prepared = [];
  // Decode sequentially so one request cannot expand eight large images at once.
  for (const [index, reference] of references.entries()) {
    const source = validateReferenceImage(reference);
    try {
      const pipeline = sharp(source.data, { limitInputPixels: MAX_REFERENCE_INPUT_PIXELS, failOn: 'warning' });
      const metadata = await pipeline.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
        throw new Error('A single PNG, JPEG or WebP image is required.');
      }
      const { data, info } = await pipeline
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .png()
        .timeout({ seconds: 10 })
        .toBuffer({ resolveWithObject: true });
      const output = validateReferenceImage({ data, mime: 'image/png', originalName: source.originalName });
      prepared.push({ ...output, width: info.width, height: info.height });
    } catch (cause) {
      throw new Error(
        `参照画像${index + 1}を縮小できません。正常な静止画PNG/JPEG/WebP（4,000万画素以下）を使用してください。`,
        { cause },
      );
    }
  }
  return prepared;
}
