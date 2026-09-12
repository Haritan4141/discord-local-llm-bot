import { randomBytes } from 'node:crypto';

/**
 * YuE2's acoustic token rate in the pinned ComfyUI implementation.
 *
 * Keep this local instead of importing the ComfyUI Python implementation. The
 * value is part of the tested YuE2 workflow contract and is also used by the
 * metadata output node.
 */
export const YUE2_FRAMES_PER_SECOND = 25;
export const YUE2_MAX_DURATION_SEC = 360;
export const YUE2_DEFAULT_CHECKPOINT = 'yue2_3b_bf16.safetensors';

export class Yue2ResultError extends Error {
  constructor(message, code = 'YUE2_RESULT_INVALID') {
    super(message);
    this.name = 'Yue2ResultError';
    this.code = code;
  }
}

const DEFAULT_ABC_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 1.0;
const DEFAULT_TOP_P = 0.95;
const DEFAULT_TOP_K = 100;
const DEFAULT_REPETITION_PENALTY = 1.2;
const MAX_SEED = Number.MAX_SAFE_INTEGER;

function asNonEmptyString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function validateDuration(value, name) {
  if (!Number.isFinite(value) || value < 0.04) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 0.04 seconds.`);
  }
  return Number(value);
}

function validateCap(value) {
  const cap = validateDuration(value, 'maxDurationSec');
  if (cap > YUE2_MAX_DURATION_SEC) {
    throw new RangeError(`maxDurationSec must not exceed ${YUE2_MAX_DURATION_SEC} seconds.`);
  }
  return cap;
}

function normaliseSeed(value) {
  if (value === undefined || value === null) {
    // A short integer keeps the API JSON portable and is sufficient for the
    // three stochastic stages in this workflow.
    return randomBytes(4).readUInt32BE(0);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SEED) {
    throw new RangeError('seed must be a non-negative safe integer.');
  }
  return value;
}

function nextSeed(seed, offset) {
  return (seed + offset) % (MAX_SEED + 1);
}

function makeSafeFilenamePrefix() {
  const timestamp = Date.now().toString(36);
  const suffix = randomBytes(8).toString('hex');
  return `audio/yue2/discord_yue2_${timestamp}_${suffix}`;
}

function buildStylePrompt(prompt, durationSec, language, bpm) {
  const hints = [
    `Target duration is approximately ${durationSec} seconds.`,
    'Treat the duration as a target, allow a natural ending, and do not stop abruptly at the target.',
  ];
  if (language) hints.push(`Vocal language: ${language}.`);
  if (bpm !== null) hints.push(`Tempo: ${bpm} BPM.`);
  return `${prompt}\n\n[Generation guidance]\n${hints.join(' ')}`;
}

function validateBpm(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 30 || value > 300) {
    throw new RangeError('bpm must be an integer between 30 and 300.');
  }
  return value;
}

/**
 * Build the pinned, full-mode YuE2 ComfyUI API workflow.
 *
 * `durationSec` is deliberately only a target instruction. YuE2's generated
 * conditioning supplies the actual number of frames to the latent node, so
 * an early EOS is retained and a target boundary never crops the audio. The
 * independent `maxDurationSec` is the hard token-generation safety cap.
 */
export function buildYue2Workflow({
  prompt,
  lyrics = '',
  durationSec,
  language = 'ja',
  bpm = null,
  maxDurationSec = YUE2_MAX_DURATION_SEC,
  seed,
  checkpoint = YUE2_DEFAULT_CHECKPOINT,
  // This optional test/advanced hook is not used by the Bot. If supplied it
  // still has to be safe because it becomes a ComfyUI output path prefix.
  filenamePrefix,
} = {}) {
  const stylePrompt = asNonEmptyString(prompt);
  if (!stylePrompt) throw new TypeError('prompt must be a non-empty string.');
  const safeLyrics = typeof lyrics === 'string' ? lyrics : '';
  const targetDurationSec = validateDuration(durationSec, 'durationSec');
  const hardCapSec = validateCap(maxDurationSec);
  if (targetDurationSec > hardCapSec) {
    throw new RangeError('durationSec must not exceed maxDurationSec.');
  }
  const vocalLanguage = asNonEmptyString(language, 'ja');
  const tempo = validateBpm(bpm);
  const baseSeed = normaliseSeed(seed);
  const checkpointName = asNonEmptyString(checkpoint, YUE2_DEFAULT_CHECKPOINT);
  const prefix = filenamePrefix === undefined
    ? makeSafeFilenamePrefix()
    : asNonEmptyString(filenamePrefix);
  if (
    !prefix ||
    prefix.startsWith('/') ||
    prefix.startsWith('\\\\') ||
    !/^[a-z0-9_./-]+$/i.test(prefix) ||
    prefix.includes('..')
  ) {
    throw new TypeError('filenamePrefix must contain only safe path characters.');
  }

  const style = buildStylePrompt(stylePrompt, targetDurationSec, vocalLanguage, tempo);

  return {
    checkpoint: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpointName },
      _meta: { title: 'Load YuE2 Checkpoint' },
    },
    abc: {
      class_type: 'YuE2GenerateABC',
      inputs: {
        clip: ['checkpoint', 1],
        style,
        lyrics: safeLyrics,
        seed: baseSeed,
        mode: 'full',
        max_abc_tokens: DEFAULT_ABC_TOKENS,
      },
      _meta: { title: 'YuE2 Generate ABC' },
    },
    music: {
      class_type: 'YuE2GenerateMusic',
      inputs: {
        clip: ['checkpoint', 1],
        style,
        lyrics: safeLyrics,
        abc: ['abc', 0],
        seed: nextSeed(baseSeed, 1),
        mode: 'full',
        max_duration: hardCapSec,
        temperature: DEFAULT_TEMPERATURE,
        top_p: DEFAULT_TOP_P,
        top_k: DEFAULT_TOP_K,
        repetition_penalty: DEFAULT_REPETITION_PENALTY,
      },
      _meta: { title: 'YuE2 Generate Music' },
    },
    latent: {
      class_type: 'EmptyYuE2LatentAudio',
      inputs: {
        // The generated EOS length, not the requested target, controls the
        // latent. This is what prevents target-time hard truncation.
        seconds: ['music', 1],
        batch_size: 1,
      },
      _meta: { title: 'Empty YuE2 Latent Audio' },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        model: ['checkpoint', 0],
        positive: ['music', 0],
        negative: ['music', 0],
        latent_image: ['latent', 0],
        seed: nextSeed(baseSeed, 2),
        steps: 32,
        cfg: 1.0,
        sampler_name: 'dpm_2',
        scheduler: 'sgm_uniform',
        denoise: 1.0,
      },
      _meta: { title: 'KSampler (YuE2 pinned settings)' },
    },
    decode: {
      class_type: 'VAEDecodeAudioTiled',
      inputs: {
        samples: ['sampler', 0],
        vae: ['checkpoint', 2],
        tile_size: 1920,
        overlap: 128,
      },
      _meta: { title: 'VAE Decode Audio (Tiled)' },
    },
    save_mp3: {
      class_type: 'SaveAudioAdvanced',
      inputs: {
        audio: ['decode', 0],
        filename_prefix: `${prefix}_mp3`,
        // DynamicCombo API inputs are flattened by ComfyUI into
        // {format: {format: 'mp3', quality: '128k'}} at execution time.
        format: 'mp3',
        'format.quality': '128k',
      },
      _meta: { title: 'Save YuE2 Audio (MP3)' },
    },
    save_flac: {
      class_type: 'SaveAudioAdvanced',
      inputs: {
        audio: ['decode', 0],
        filename_prefix: `${prefix}_flac`,
        format: 'flac',
      },
      _meta: { title: 'Save YuE2 Audio (FLAC)' },
    },
    result_metadata: {
      class_type: 'DiscordYuE2Result',
      inputs: {
        conditioning: ['music', 0],
        target_duration_sec: targetDurationSec,
        max_duration_sec: hardCapSec,
      },
      _meta: { title: 'YuE2 Result Metadata' },
    },
  };
}

function pickHistoryEntry(history, promptId) {
  if (!history || typeof history !== 'object') return null;
  if (promptId !== undefined && promptId !== null) {
    // A caller polling a prompt must never accidentally consume another
    // prompt's result from a multi-entry history response.
    return history[promptId] || null;
  }
  // Tests and callers may pass the entry directly when no prompt id is given.
  if (history.outputs || history.status || history.prompt) return history;
  return null;
}

function historyStatusError(entry) {
  const status = entry?.status;
  if (entry?.execution_error || entry?.interrupted || entry?.error) {
    return new Yue2ResultError('YuE2 execution failed.', 'YUE2_EXECUTION_FAILED');
  }
  if (!status || typeof status !== 'object') return null;
  if (String(status.status_str || '').toLowerCase() === 'error') {
    return new Yue2ResultError('YuE2 execution failed.', 'YUE2_EXECUTION_FAILED');
  }
  const messages = JSON.stringify(status.messages ?? '').toLowerCase();
  if (messages.includes('execution_error') || messages.includes('execution_interrupted')) {
    return new Yue2ResultError('YuE2 execution was interrupted or failed.', 'YUE2_EXECUTION_FAILED');
  }
  return null;
}

function isPendingHistory(entry) {
  const status = entry?.status;
  if (!status || typeof status !== 'object') return false;
  const statusName = String(status.status_str || '').toLowerCase();
  if (statusName === 'running' || statusName === 'pending') return true;
  // ComfyUI may expose completed=false before it has produced a terminal
  // status. Treat that as pending, but let execution_error/interrupted above
  // take precedence and throw immediately.
  return status.completed === false;
}

function pickMp3Output(outputs) {
  const files = outputs?.save_mp3?.audio;
  if (!Array.isArray(files)) return null;
  const file = files.find(candidate => (
    candidate && typeof candidate === 'object' &&
    typeof candidate.filename === 'string' &&
    /\.mp3$/i.test(candidate.filename) &&
    candidate.type === 'output'
  ));
  if (!file) return null;
  return {
    filename: file.filename,
    subfolder: typeof file.subfolder === 'string' ? file.subfolder : '',
    type: typeof file.type === 'string' ? file.type : 'output',
  };
}

/**
 * Parse one completed ComfyUI history response for the YuE2 output node.
 *
 * Returning null is intentional only for missing/pending history. Terminal
 * execution failures and completed jobs with invalid or incomplete metadata
 * throw Yue2ResultError so a caller cannot poll a permanently bad job until
 * timeout. In particular, duration is never used to infer whether YuE2
 * reached a natural EOS; that fact comes only from the pinned
 * `yue2_truncated` metadata exposed by DiscordYuE2Result.
 */
export function parseYue2HistoryResult(history, promptId) {
  const entry = pickHistoryEntry(history, promptId);
  if (!entry) return null;
  const statusError = historyStatusError(entry);
  if (statusError) throw statusError;
  if (isPendingHistory(entry)) return null;

  const outputs = entry.outputs;
  const rawResults = outputs?.result_metadata?.yue2_result;
  if (!Array.isArray(rawResults) || rawResults.length < 1) {
    throw new Yue2ResultError('YuE2 result metadata is missing.');
  }
  const metadata = rawResults[0];
  if (!metadata || typeof metadata !== 'object') {
    throw new Yue2ResultError('YuE2 result metadata is invalid.');
  }
  if (metadata.metadataAvailable !== true) {
    throw new Yue2ResultError('YuE2 result metadata is unavailable.');
  }
  if (typeof metadata.truncated !== 'boolean') {
    throw new Yue2ResultError('YuE2 truncation metadata is invalid.');
  }
  if (metadata.abcNonempty !== true) {
    throw new Yue2ResultError('YuE2 ABC score is missing or empty.');
  }
  if (!Number.isInteger(metadata.frames) || metadata.frames < 1) {
    throw new Yue2ResultError('YuE2 frame metadata is invalid.');
  }
  if (!Number.isFinite(metadata.actualDurationSec) || metadata.actualDurationSec <= 0) {
    throw new Yue2ResultError('YuE2 actual duration metadata is invalid.');
  }
  if (!Number.isFinite(metadata.targetDurationSec) || metadata.targetDurationSec < 0.04) {
    throw new Yue2ResultError('YuE2 target duration metadata is invalid.');
  }
  if (!Number.isFinite(metadata.maxDurationSec) || metadata.maxDurationSec < 0.04 || metadata.maxDurationSec > YUE2_MAX_DURATION_SEC) {
    throw new Yue2ResultError('YuE2 hard duration cap is invalid.');
  }
  if (metadata.targetDurationSec > metadata.maxDurationSec) {
    throw new Yue2ResultError('YuE2 target duration exceeds its hard cap.');
  }
  const expectedDurationSec = metadata.frames / YUE2_FRAMES_PER_SECOND;
  if (Math.abs(metadata.actualDurationSec - expectedDurationSec) > 0.01) {
    throw new Yue2ResultError('YuE2 duration and frame metadata disagree.');
  }
  // A one-frame rounding margin is permitted; a materially over-cap result is
  // invalid rather than silently accepted as a natural finish.
  if (metadata.actualDurationSec > metadata.maxDurationSec + (1 / YUE2_FRAMES_PER_SECOND)) {
    throw new Yue2ResultError('YuE2 result exceeds its hard duration cap.');
  }

  const audio = pickMp3Output(outputs);
  if (!audio) {
    throw new Yue2ResultError('YuE2 MP3 output is missing or invalid.');
  }

  return {
    audio,
    actualDurationSec: metadata.actualDurationSec,
    targetDurationSec: metadata.targetDurationSec,
    maxDurationSec: metadata.maxDurationSec,
    frames: metadata.frames,
    truncated: metadata.truncated,
    abcNonempty: metadata.abcNonempty,
    metadataAvailable: metadata.metadataAvailable,
  };
}
