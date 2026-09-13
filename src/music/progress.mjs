import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMusicTimingHistory } from './progress-estimates.mjs';

const INTERVAL_MS = 5000;
const STAGES = {
  CheckpointLoaderSimple: 'モデルを準備中',
  YuE2GenerateABC: '作曲（楽譜を生成）',
  YuE2GenerateMusic: '曲の構成を生成',
  EmptyYuE2LatentAudio: '音声生成の準備',
  'TextEncodeAceStepAudio1.5': '歌詞・曲の構成を生成',
  KSampler: '音声生成',
  KSamplerAdvanced: '音声生成',
  VAEDecodeAudio: '音声の変換',
  VAEDecodeAudioTiled: '音声の変換',
  SaveAudioAdvanced: '音声ファイルの保存',
  SaveAudioMP3: '音声ファイルの保存',
  SaveAudio: '音声ファイルの保存',
  DiscordYuE2Result: '生成情報の確認',
};
const FIXED_STEPS = new Set(['KSampler', 'KSamplerAdvanced']);
const TIMING_INPUTS = new Set([
  'ckpt_name', 'steps', 'sampler_name', 'scheduler', 'cfg', 'denoise', 'mode',
  'max_duration', 'max_abc_tokens', 'tile_size', 'overlap', 'batch_size',
  'seconds', 'duration', 'language', 'bpm', 'format', 'format.quality',
]);
let sharedHistory;
function defaultHistory() {
  return sharedHistory ??= createMusicTimingHistory({
    path: fileURLToPath(new URL('../../data/music-timings.json', import.meta.url)),
  });
}

export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

function formatRange({ minMs, maxMs }) {
  // Round outward: ranges are estimates, not second-accurate promises.
  const low = Math.max(5, Math.floor(minMs / 5000) * 5);
  const high = Math.max(low + 5, Math.ceil(maxMs / 5000) * 5);
  return `${formatElapsed(low * 1000)}〜${formatElapsed(high * 1000)}`;
}

/** Event callbacks only update memory. tick() is awaited by the polling loop,
 * so no background Discord edits can overwrite a terminal result/error. */
export function createMusicProgress({
  interaction, workflow = {}, model, durationSec, maxDurationSec, baseUrl = '', now = Date.now,
  detailSupported = true,
  timingHistory = defaultHistory(), intervalMs = INTERVAL_MS,
} = {}) {
  const nodes = Object.assign(Object.create(null), Object.fromEntries(Object.entries(workflow).filter(([id, node]) =>
    /^[\w.-]{1,80}$/.test(id) && typeof node?.class_type === 'string')));
  const started = now();
  let lastEdit = started, current = null, phase = 'サーバーでの開始待ち・準備中';
  let stageStarted = started, connected = false, stopped = false, editing = false;
  let reliable = true, sawStart = false, cached = null, progress = null;
  let lastEvent = started;
  const observations = new Map();
  const topology = Object.entries(nodes).map(([id, node]) => [id, node.class_type,
    Object.fromEntries(Object.entries(node.inputs || {}).filter(([key, value]) =>
      TIMING_INPUTS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)))]);
  const key = () => createHash('sha256').update(JSON.stringify({
    version: 1, baseUrl, model, durationSec, topology, cached,
  })).digest('hex');
  const stageKey = id => `${id}:${nodes[id].class_type}`;

  function setNode(id) {
    if (!nodes[id]) return;
    if (current !== id) {
      current = id; stageStarted = now(); progress = null;
      if (!observations.has(stageKey(id))) observations.set(stageKey(id), stageStarted);
    }
    phase = Object.hasOwn(STAGES, nodes[id].class_type) ? STAGES[nodes[id].class_type] : '音楽生成を処理中';
  }
  function updateSteps(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || value < 0 || max <= 0 || value > max || max > 1e7) return;
    const at = now();
    if (!progress || progress.max !== max || value < progress.value) {
      progress = { value, max, samples: [{ value, at }], at };
    } else if (value > progress.value) {
      progress.value = value; progress.at = at;
      progress.samples.push({ value, at });
      if (progress.samples.length > 12) progress.samples.shift();
    }
  }

  function onEvent({ type, data } = {}) {
    if (stopped || !data || typeof data !== 'object') return;
    lastEvent = now();
    if (type === 'execution_start') { sawStart = true; return; }
    if (type === 'execution_cached' && Array.isArray(data.nodes)) {
      cached = data.nodes.filter(id => typeof id === 'string' && nodes[id]).sort();
      return;
    }
    if (type === 'executing') {
      if (data.node === null) {
        current = null; progress = null; phase = '生成結果を確認中'; stageStarted = now();
      } else setNode(String(data.node));
    } else if (type === 'progress') {
      const id = String(data.node);
      // Reject delayed events for an already completed/different stage.
      if (!current && nodes[id] && !observations.has(stageKey(id))) setNode(id);
      if (id === current) updateSteps(data.value, data.max);
    } else if (type === 'progress_state' && current) {
      const state = data.nodes?.[current];
      if (state?.state === 'running') updateSteps(state.value, state.max);
    }
  }

  function content() {
    const at = now();
    const fixed = FIXED_STEPS.has(nodes[current]?.class_type);
    const stale = !connected || at - lastEvent > 30000;
    let detail = phase;
    if (!stale && fixed && progress) {
      detail += `（${progress.value} / ${progress.max}ステップ・${Math.floor(progress.value / progress.max * 100)}%）`;
    }
    const lines = [
      `🎵 ${model === 'yue2' ? 'YuE2' : 'ACE-Step'}で音楽を生成中です（長さの目安: ${durationSec}秒${model === 'yue2' && Number.isFinite(maxDurationSec) ? ` / 安全上限: ${maxDurationSec}秒` : ''}）`,
      `工程: ${detail}${stale && detailSupported ? '（詳細進捗の更新待ち）' : ''}`,
      `経過: ${formatElapsed(at - started)}（生成処理の開始から）`,
    ];
    // Cache classification is observational, not an invented cold/warm flag.
    const estimate = !stale && reliable && cached !== null && current
      ? timingHistory?.estimate(key(), stageKey(current), { elapsedMs: at - stageStarted }) : null;
    lines.push(estimate
      ? `完了目安: あと約${formatRange(estimate)}（同条件の過去${estimate.samples}件からの推定）`
      : detailSupported ? '完了目安: 算出中（曲の長さやモデルの読み込みで変動します）'
        : '完了目安: この接続方式では取得できません');
    if (!estimate && !stale && fixed && progress?.samples.length >= 3 && at - progress.at < 15000) {
      const first = progress.samples[0], last = progress.samples.at(-1);
      const elapsed = last.at - first.at, steps = last.value - first.value;
      if (elapsed >= 2000 && steps > 0 && progress.value < progress.max) {
        const remaining = (progress.max - progress.value) * elapsed / steps;
        lines.push(`この工程の残り: 約${formatRange({ minMs: remaining * 0.7, maxMs: remaining * 1.5 })}（推定・保存/送信時間は別）`);
      }
    }
    if (model === 'yue2') lines.push('※ 曲の長さは目安です。％は表示中の工程内の進捗で、曲全体の完成率ではありません。');
    else if (detailSupported) lines.push('※ ％は表示中の工程内の進捗です。');
    return lines.join('\n');
  }

  return {
    onEvent,
    onConnection(value) {
      if (stopped) return;
      connected = value === true;
      if (!connected) { reliable = false; progress = null; }
    },
    phase(value) { if (!stopped) { current = null; progress = null; phase = value; } },
    content,
    async tick() {
      if (stopped || editing || now() - lastEdit < intervalMs) return;
      editing = true; lastEdit = now();
      try { await interaction.editReply({ content: content(), allowedMentions: { parse: [] } }); }
      catch { /* Progress is optional; the terminal delivery is still attempted. */ }
      finally { editing = false; }
    },
    async complete() {
      if (stopped) return;
      stopped = true;
      if (!reliable || !sawStart || cached === null || observations.size === 0) return;
      const ended = now();
      timingHistory?.record(key(), [...observations].map(([stage, at]) => ({ stage, remainingMs: ended - at })));
      await timingHistory?.flush?.();
    },
    stop() { stopped = true; },
  };
}

export async function observeMusicProgress(client, options) {
  const progress = createMusicProgress(options);
  let session;
  try {
    session = await client.openProgress?.({ onEvent: progress.onEvent, onConnection: progress.onConnection });
  } catch { progress.onConnection(false); }
  return {
    ...progress,
    clientId: session?.clientId,
    setPromptId(id) { session?.setPromptId(id); },
    close() { progress.stop(); session?.close(); },
  };
}
