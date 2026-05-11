import {
  LLM_CHAT_COMPLETIONS_URL,
  SD_TRANSLATE_ENABLED,
  SD_TRANSLATE_MODEL,
  SD_URL,
  llmHeaders,
} from '../config.mjs';

export function looksJapaneseText(text) {
  return /[぀-ヿ㐀-鿿]/.test(text || '');
}

export async function translatePromptForSd(prompt) {
  if (!SD_TRANSLATE_ENABLED) return { prompt, translated: false };
  if (!looksJapaneseText(prompt)) return { prompt, translated: false };

  const messages = [
    {
      role: 'system',
      content:
        "Translate the user's Stable Diffusion prompt into concise natural English. Return only the translated prompt text, no explanations, no quotes.",
    },
    { role: 'user', content: prompt },
  ];

  const res = await fetch(LLM_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify({
      model: SD_TRANSLATE_MODEL,
      messages,
      temperature: 0.0,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Prompt translation error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const translated = json?.choices?.[0]?.message?.content?.trim();
  if (!translated) return { prompt, translated: false };
  return { prompt: translated.replace(/^["']|["']$/g, ''), translated: true };
}

export async function sdTxt2Img({ prompt, negativePrompt, width, height, steps, cfgScale, sampler, seed, batchSize }) {
  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    sampler_name: sampler,
    seed,
    batch_size: batchSize,
  };

  const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SD WebUI error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const images = Array.isArray(json?.images) ? json.images : [];
  return images;
}
