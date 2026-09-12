const BACKEND_UNAVAILABLE_PATTERN = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i;

export function formatMusicGeneratingMessage(durationSec) {
  return `🎵 音楽を生成中です（曲の長さ: ${durationSec}秒）`;
}

export function formatMusicQueuedMessage(position) {
  return `🎵 音楽生成を待機中です（順番: ${position}番目）`;
}

export function formatYue2GeneratingMessage(target, cap) {
  return `🎵 YuE2で音楽を生成中です（長さの目安: ${target}秒 / 安全上限: ${cap}秒）\n目安の秒数では切らず、モデルの終了まで生成します。実際の長さは前後します。`;
}

export function formatYue2Completion({ actualDurationSec, truncated, targetDurationSec, maxDurationSec, prompt }) {
  const status = truncated
    ? '⚠️ 生成上限に到達しました。曲や歌詞が途中で切れている可能性があります。'
    : '🎵 音楽の生成が完了しました。';
  return `${status}\nmodel: YuE2 | 長さの目安: ${targetDurationSec}秒 | 実際: ${actualDurationSec.toFixed(2)}秒 | 安全上限: ${maxDurationSec}秒\nprompt: ${String(prompt).slice(0, 1000)}`;
}

export function formatMusicErrorMessage(error) {
  const specific = {
    MUSIC_QUEUE_FULL: '音楽生成の受付が混み合っています。現在の生成が終わってから再度お試しください。',
    MUSIC_SERVER_BUSY: '音楽生成サーバーで別の生成が処理中または待機中です。終了後に再度お試しください。',
    MUSIC_SETUP_REQUIRED: 'YuE2の連携設定が未完了です。管理者に問い合わせてください。',
    MUSIC_STATE_UNKNOWN: '生成サーバーの状態を確認できません。管理者に問い合わせてください。',
    MUSIC_AUDIO_TOO_LARGE: '音声が添付サイズ上限を超えています。元音声は生成サーバーに保存されています。管理者に問い合わせてください。',
    MUSIC_RESULT_TIMEOUT: '結果の待機時間を超えました。サーバーでは処理が続いている可能性があります。再生成せず管理者に問い合わせてください。',
  }[error?.code];
  if (specific) return `⚠️ ${specific}`;
  const message = String(error?.message || error || '');
  const causeCode = String(error?.cause?.code || '');
  const details = `${message} ${causeCode}`;

  if (BACKEND_UNAVAILABLE_PATTERN.test(details)) {
    return [
      '⚠️ 音楽生成機能は現在利用できません。',
      '音楽生成サーバーが起動していないか、接続できない状態です。',
      '管理者に問い合わせてください。',
    ].join('\n');
  }

  return [
    '⚠️ 音楽生成中にエラーが発生しました。',
    '管理者に問い合わせてください。',
  ].join('\n');
}
