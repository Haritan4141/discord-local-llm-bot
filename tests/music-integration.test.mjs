import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMusicSettings, resolveMusicRequest } from '../src/music/settings.mjs';
import { createMusicHandler } from '../src/discord/music.mjs';
import { buildMusicCommand } from '../src/discord/music-command.mjs';
import { formatMusicErrorMessage, formatYue2Completion } from '../src/music/messages.mjs';

test('existing ACE transport does not override default YuE2 model', () => {
  assert.equal(resolveMusicSettings({ MUSIC_BACKEND: 'comfyui' }).defaultModel, 'yue2');
  assert.equal(resolveMusicSettings({ MUSIC_DEFAULT_MODEL: 'ace-step' }).defaultModel, 'ace-step');
  for (const cap of ['0', 'NaN', '361', '30']) assert.throws(() => resolveMusicSettings({ YUE2_MAX_DURATION_SECONDS: cap }));
  assert.throws(() => resolveMusicSettings({ YUE2_URL: 'http://secret:pass@localhost:8191' }));
});

test('target is validated independently and leaves cap headroom', () => {
  const settings = resolveMusicSettings({});
  assert.equal(resolveMusicRequest({ prompt: 'p' }, settings).durationSec, 120);
  assert.equal(resolveMusicRequest({ prompt: 'p' }, settings).model, 'yue2');
  assert.equal(resolveMusicRequest({ prompt: 'p', model: 'ace-step', durationSec: 600 }, settings).durationSec, 600);
  for (const durationSec of [360, 600, -1, NaN]) assert.throws(() => resolveMusicRequest({ prompt: 'p', durationSec }, settings));
  assert.throws(() => resolveMusicRequest({ prompt: '', model: 'yue2' }, settings));
  assert.throws(() => resolveMusicRequest({ prompt: 'p', lyrics: 'x'.repeat(8001) }, settings));
});

test('slash command keeps existing option names and adds model selection', () => {
  const command = buildMusicCommand().toJSON();
  assert.equal(command.name, 'music');
  assert.deepEqual(command.options.map(o => o.name), ['prompt', 'model', 'language', 'lyrics', 'duration', 'bpm']);
  assert.match(command.options.find(o => o.name === 'duration').description, /目安/);
});

function harness(values = {}, jobsOverride = {}) {
  const edits = [], replies = [], enqueued = [];
  const jobs = { totalCount: () => 0, enqueue: job => { enqueued.push(job); return 1; }, ...jobsOverride };
  const interaction = {
    options: { getString: key => values[key] ?? null, getInteger: key => values[key] ?? null },
    attachmentSizeLimit: 9000,
    reply: async value => replies.push(value),
    deferReply: async () => {},
    fetchReply: async () => ({ edit: async value => edits.push(value) }),
  };
  return { handler: createMusicHandler({ jobs, settings: resolveMusicSettings({}) }), interaction, edits, replies, enqueued };
}
test('music handler defaults to YuE2 and uses normal Bot message edits with no mentions', async () => {
  const h = harness({ prompt: '@everyone quiet song' });
  await h.handler(h.interaction, {});
  assert.equal(h.enqueued[0].model, 'yue2');
  assert.equal(h.enqueued[0].interaction.attachmentSizeLimit, 9000);
  await h.enqueued[0].interaction.editReply({ content: 'done @everyone' });
  assert.deepEqual(h.edits.at(-1).allowedMentions, { parse: [] });
});
test('paused, invalid, and full requests never enqueue', async () => {
  for (const [values, jobs, state] of [
    [{ prompt: 'p' }, {}, { paused: true }],
    [{ prompt: 'p', duration: 600 }, {}, {}],
    [{ prompt: 'p' }, { totalCount: () => 5 }, {}],
  ]) {
    const h = harness(values, jobs); await h.handler(h.interaction, state);
    assert.equal(h.enqueued.length, 0); assert.equal(h.replies.length, 1);
  }
});
test('late full queue rejection is reported after deferred reply', async () => {
  const h = harness({ prompt: 'p' }, { enqueue: () => { throw Object.assign(new Error(), { code: 'MUSIC_QUEUE_FULL' }); } });
  await h.handler(h.interaction, {});
  assert.match(h.edits.at(-1).content, /混み合/);
});
test('natural and capped results have distinct honest labels', () => {
  const result = { actualDurationSec: 145, targetDurationSec: 120, maxDurationSec: 360, prompt: 'p' };
  assert.match(formatYue2Completion({ ...result, truncated: false }), /実際: 145.00秒/);
  assert.match(formatYue2Completion({ ...result, truncated: true }), /途中で切れて/);
  assert.doesNotMatch(formatYue2Completion({ ...result, truncated: false }), /自然に完結/);
  assert.match(formatMusicErrorMessage({ code: 'MUSIC_RESULT_TIMEOUT' }), /再生成せず管理者/);
});
