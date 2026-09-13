import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMusicSettings, resolveMusicRequest } from '../src/music/settings.mjs';
import { createMusicHandler } from '../src/discord/music.mjs';
import { buildMusicCommand } from '../src/discord/music-command.mjs';
import {
  formatMusicErrorMessage, formatMusicGeneratingMessage,
  formatYue2GeneratingMessage, formatYue2Completion,
} from '../src/music/messages.mjs';

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
  const edits = [], replies = [], enqueued = [], initialEdits = [], events = [], snapshots = [];
  const lifecycle = { deferred: false, loading: false, tokenExpired: false };
  const jobs = { totalCount: () => 0, enqueue: job => { events.push('enqueue'); enqueued.push(job); return 1; }, ...jobsOverride };
  const message = {
    edit: async value => {
      // Ordinary channel-message edits do not clear a deferred response's LOADING flag.
      events.push('message.edit'); edits.push(value);
      snapshots.push({ ...value, loading: lifecycle.loading });
      return message;
    },
  };
  const interaction = {
    options: { getString: key => values[key] ?? null, getInteger: key => values[key] ?? null },
    attachmentSizeLimit: 9000,
    reply: async value => replies.push(value),
    deferReply: async () => {
      events.push('deferReply'); lifecycle.deferred = true; lifecycle.loading = true;
    },
    fetchReply: async () => message,
    editReply: async value => {
      assert.equal(lifecycle.deferred, true);
      if (lifecycle.tokenExpired) throw new Error('Interaction token expired');
      events.push('interaction.editReply'); initialEdits.push(value);
      lifecycle.loading = false;
      return message;
    },
  };
  return {
    handler: createMusicHandler({ jobs, settings: resolveMusicSettings({}) }),
    interaction, edits, replies, enqueued, initialEdits, events, snapshots, lifecycle,
  };
}
test('music handler defaults to YuE2 and uses normal Bot message edits with no mentions', async () => {
  const h = harness({ prompt: '@everyone quiet song' });
  await h.handler(h.interaction, {});
  assert.equal(h.enqueued[0].model, 'yue2');
  assert.equal(h.enqueued[0].interaction.attachmentSizeLimit, 9000);
  await h.enqueued[0].interaction.editReply({ content: 'done @everyone' });
  assert.deepEqual(h.edits.at(-1).allowedMentions, { parse: [] });
});
for (const model of ['yue2', 'ace-step']) {
  test(`${model}: completes deferred reply before enqueue and keeps progress/completion visible after token expiry`, async () => {
    const h = harness({ prompt: 'song', model });
    await h.handler(h.interaction, {});
    assert.deepEqual(h.events, ['deferReply', 'interaction.editReply', 'enqueue', 'message.edit']);
    assert.equal(h.initialEdits.length, 1);
    assert.match(h.initialEdits[0].content, /音楽生成を受け付け/);
    assert.deepEqual(h.initialEdits[0].allowedMentions, { parse: [] });
    assert.match(h.snapshots[0].content, /待機中/);
    const job = h.enqueued[0];
    assert.equal(job.model, model);
    await job.ready;

    // Model a queue/generation lasting beyond the interaction token's 15-minute lifetime.
    h.lifecycle.tokenExpired = true;
    const generating = model === 'yue2'
      ? formatYue2GeneratingMessage(120, 360) : formatMusicGeneratingMessage(120);
    await job.interaction.editReply(generating);
    const files = [{ attachment: Buffer.from('mock mp3'), name: 'test.mp3' }];
    await job.interaction.editReply({ content: '音楽の生成が完了しました。', files });
    assert.equal(h.initialEdits.length, 1);
    assert.equal(h.lifecycle.loading, false);
    assert.equal(h.snapshots.length, 3);
    assert.match(h.snapshots[1].content, /音楽を生成中/);
    assert.match(h.snapshots[2].content, /生成が完了/);
    assert.equal(h.snapshots[2].files, files);
    for (const snapshot of h.snapshots) {
      assert.equal(snapshot.loading, false);
      assert.deepEqual(snapshot.allowedMentions, { parse: [] });
    }
  });
}

test('music is not enqueued until the initial interaction edit succeeds', async () => {
  const h = harness({ prompt: 'p' });
  let finishReceipt, receiptStarted;
  const gate = new Promise(resolve => { finishReceipt = resolve; });
  const started = new Promise(resolve => { receiptStarted = resolve; });
  const editReply = h.interaction.editReply;
  h.interaction.editReply = async payload => {
    receiptStarted(); await gate; return editReply(payload);
  };
  const pending = h.handler(h.interaction, {});
  await Promise.race([started, pending]);
  assert.equal(h.enqueued.length, 0);
  assert.equal(h.edits.length, 0);
  finishReceipt();
  await pending;
  assert.equal(h.enqueued.length, 1);
  assert.equal(h.lifecycle.loading, false);
});

test('failed initial interaction edit does not enqueue or generate music', async () => {
  const h = harness({ prompt: 'p' });
  h.interaction.editReply = async () => { throw new Error('Initial reply failed'); };
  await assert.rejects(h.handler(h.interaction, {}), /Initial reply failed/);
  assert.equal(h.enqueued.length, 0);
  assert.equal(h.edits.length, 0);
});

test('server failure remains visible through normal message edits after token expiry', async () => {
  const h = harness({ prompt: 'p' });
  await h.handler(h.interaction, {});
  h.lifecycle.tokenExpired = true;
  await h.enqueued[0].interaction.editReply(formatMusicErrorMessage(new Error('fetch failed')));
  assert.equal(h.snapshots.at(-1).loading, false);
  assert.match(h.snapshots.at(-1).content, /管理者に問い合わせ/);
  assert.equal(h.initialEdits.length, 1);
});

test('paused, invalid, and full requests never enqueue', async () => {
  for (const [values, jobs, state] of [
    [{ prompt: 'p' }, {}, { paused: true }],
    [{ prompt: 'p', duration: 600 }, {}, {}],
    [{ prompt: 'p' }, { totalCount: () => 5 }, {}],
  ]) {
    const h = harness(values, jobs); await h.handler(h.interaction, state);
    assert.equal(h.enqueued.length, 0); assert.equal(h.replies.length, 1);
    assert.equal(h.lifecycle.deferred, false); assert.equal(h.initialEdits.length, 0);
  }
});
test('late full queue rejection is reported after deferred reply', async () => {
  const h = harness({ prompt: 'p' }, { enqueue: () => { throw Object.assign(new Error(), { code: 'MUSIC_QUEUE_FULL' }); } });
  await h.handler(h.interaction, {});
  assert.match(h.edits.at(-1).content, /混み合/);
  assert.equal(h.snapshots.at(-1).loading, false);
});
test('natural and capped results have distinct honest labels', () => {
  const result = { actualDurationSec: 145, targetDurationSec: 120, maxDurationSec: 360, prompt: 'p' };
  assert.match(formatYue2Completion({ ...result, truncated: false }), /実際: 145.00秒/);
  assert.match(formatYue2Completion({ ...result, truncated: true }), /途中で切れて/);
  assert.doesNotMatch(formatYue2Completion({ ...result, truncated: false }), /自然に完結/);
  assert.match(formatMusicErrorMessage({ code: 'MUSIC_RESULT_TIMEOUT' }), /再生成せず管理者/);
});
