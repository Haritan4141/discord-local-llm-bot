const BACKEND_UNAVAILABLE_PATTERN = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i;

export function formatMusicGeneratingMessage(durationSec) {
  return `🎵 音楽を生成中です（曲の長さ: ${durationSec}秒）`;
}

export function formatMusicQueuedMessage(position) {
  return `🎵 音楽生成を待機中です（順番: ${position}番目）`;
}

export function formatMusicErrorMessage(error) {
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
