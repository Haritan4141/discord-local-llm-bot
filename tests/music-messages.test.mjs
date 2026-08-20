import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMusicErrorMessage,
  formatMusicGeneratingMessage,
  formatMusicQueuedMessage,
} from '../src/music/messages.mjs';

test('music status messages are shown in Japanese', () => {
  assert.equal(
    formatMusicGeneratingMessage(120),
    '🎵 音楽を生成中です（曲の長さ: 120秒）',
  );
  assert.equal(
    formatMusicQueuedMessage(2),
    '🎵 音楽生成を待機中です（順番: 2番目）',
  );
});

test('backend connection errors use a user-friendly message', () => {
  const message = formatMusicErrorMessage(new TypeError('fetch failed'));
  assert.equal(
    message,
    [
      '⚠️ 音楽生成機能は現在利用できません。',
      '音楽生成サーバーが起動していないか、接続できない状態です。',
      '管理者に問い合わせてください。',
    ].join('\n'),
  );
  assert.doesNotMatch(message, /fetch failed/);
});

test('non-connection music errors do not expose internal details', () => {
  const message = formatMusicErrorMessage(new Error('ComfyUI error: 500 Internal Server Error'));
  assert.equal(
    message,
    ['⚠️ 音楽生成中にエラーが発生しました。', '管理者に問い合わせてください。'].join('\n'),
  );
  assert.doesNotMatch(message, /500 Internal Server Error/);
});
