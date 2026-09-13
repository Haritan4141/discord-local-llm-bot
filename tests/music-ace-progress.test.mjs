import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMusicJobAce } from '../src/music/ace.mjs';

test('legacy ACE API shows elapsed time without inventing steps or remaining-time figures', async () => {
  let time = 0, submits = 0;
  const edits = [];
  await handleMusicJobAce({ prompt: 'song', durationSec: 120, interaction: { editReply: async p => edits.push(p) } }, {
    releaseTask: async () => { submits++; return { taskId: 'id', queuePosition: 2 }; },
    queryResult: async () => time < 12000 ? { status: 0 } : { status: 1, result: JSON.stringify([{ file: 'test.mp3' }]) },
    fetchAudio: async () => ({ buf: Buffer.from('mp3') }),
    now: () => time, sleepImpl: async () => { time += 6000; },
  });
  assert.equal(submits, 1);
  const progress = edits.find(p => p.content?.includes('経過: 6秒'));
  assert.ok(progress); assert.match(progress.content, /詳細進捗非対応/);
  assert.doesNotMatch(progress.content, /更新待ち|算出中/);
  assert.doesNotMatch(progress.content, /\d+%|あと約/);
  assert.match(edits.at(-1).content, /生成が完了/); assert.equal(edits.at(-1).files.length, 1);
});
