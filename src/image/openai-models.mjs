export const DEFAULT_FLARE_MODEL = 'gpt-image-2.5-flare';
export const DEFAULT_SUNBURST_MODEL = 'gpt-image-2.5-sunburst';

export function resolveOpenAiImageModels({ flare, sunburst, legacy } = {}) {
  const legacyModel = String(legacy || '').trim();
  return {
    flare: String(flare || '').trim() || legacyModel || DEFAULT_FLARE_MODEL,
    sunburst: String(sunburst || '').trim() || legacyModel || DEFAULT_SUNBURST_MODEL,
  };
}

export function resolveOpenAiImageModel({ mode, referenceCount = 0, models = resolveOpenAiImageModels() } = {}) {
  const selectedMode = String(mode || 'auto').trim().toLowerCase();
  if (!['auto', 'flare', 'sunburst'].includes(selectedMode)) {
    throw new Error('OpenAI image model は auto / flare / sunburst を指定してください。');
  }
  const family = selectedMode === 'auto' ? (referenceCount > 0 ? 'sunburst' : 'flare') : selectedMode;
  return { mode: selectedMode, model: models[family] };
}
