// MUSIC_BACKEND remains the ACE-Step transport selector for existing installations.
// Keep model selection separate so an existing MUSIC_BACKEND=comfyui still defaults to YuE2.
export function resolveMusicSettings(env = process.env) {
  const defaultModel = String(env.MUSIC_DEFAULT_MODEL || 'yue2').trim().toLowerCase();
  if (!['yue2', 'ace-step'].includes(defaultModel)) throw new Error('Invalid MUSIC_DEFAULT_MODEL');
  const maxDurationSec = Number(env.YUE2_MAX_DURATION_SECONDS || 360);
  if (!Number.isInteger(maxDurationSec) || maxDurationSec < 60 || maxDurationSec > 360) {
    throw new Error('YUE2_MAX_DURATION_SECONDS must be an integer from 60 to 360');
  }
  const url = new URL(env.YUE2_URL || 'http://192.168.0.104:8191');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('YUE2_URL must be an HTTP(S) origin without credentials or path');
  }
  return {
    defaultModel, maxDurationSec, yue2Url: url.origin,
    checkpoint: String(env.YUE2_CHECKPOINT || 'yue2_3b_bf16.safetensors'),
  };
}

export function resolveMusicRequest(options, settings) {
  const model = options.model || settings.defaultModel;
  if (!['yue2', 'ace-step'].includes(model)) throw new Error('利用できない音楽モデルです。');
  const prompt = String(options.prompt || '').trim();
  if (!prompt || prompt.length > 2000) throw new Error('prompt は1～2000文字で指定してください。');
  const lyrics = String(options.lyrics || '').trim();
  if (lyrics.length > 8000) throw new Error('歌詞は8000文字以内にしてください。');
  // A target cannot reserve all of the hard cap; leave at least 30 seconds of headroom.
  const upper = model === 'yue2' ? Math.min(300, settings.maxDurationSec - 30) : 600;
  const durationSec = options.durationSec ?? Math.min(120, upper);
  if (!Number.isInteger(durationSec) || durationSec < 10 || durationSec > upper) {
    throw new Error(`曲の長さは10～${upper}秒で指定してください。YuE2では目安です。`);
  }
  const bpm = options.bpm ?? null;
  if (bpm !== null && (!Number.isInteger(bpm) || bpm < 30 || bpm > 300)) throw new Error('BPMは30～300で指定してください。');
  return { model, prompt, lyrics, durationSec, bpm, language: String(options.language || 'ja').trim().slice(0, 80) };
}
