import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicProgress, observeMusicProgress, formatElapsed } from '../src/music/progress.mjs';
import { createMusicTimingHistory } from '../src/music/progress-estimates.mjs';

const workflow = {
  abc: { class_type: 'YuE2GenerateABC', inputs: { style: 'private prompt', lyrics: 'private lyrics', seed: 123 } },
  music: { class_type: 'YuE2GenerateMusic' },
  sampler: { class_type: 'KSampler', inputs: { steps: 32 } },
  decode: { class_type: 'VAEDecodeAudio' },
};
function setup(options = {}) {
  let time = 0;
  const edits = [], records = [];
  const timingHistory = { estimate: () => null, record: (...args) => records.push(args) };
  const p = createMusicProgress({
    interaction: { editReply: async value => edits.push(value) }, workflow, model: 'yue2',
    durationSec: 120, now: () => time, timingHistory, ...options,
  });
  const emit = (type, data = {}) => p.onEvent({ type, data });
  const stage = node => emit('executing', { node });
  const steps = (node, value, max = 32) => emit('progress', { node, value, max });
  return { p, edits, records, timingHistory, emit, stage, steps, at: ms => { time = ms; } };
}

test('YuE2 variable-length token caps never become a completion percentage', () => {
  const h = setup(); h.p.onConnection(true);
  for (const [node, max] of [['abc', 8192], ['music', 9000]]) {
    h.stage(node); h.steps(node, max / 2, max);
    assert.doesNotMatch(h.p.content(), /50%|ステップ/);
    assert.match(h.p.content(), /算出中/);
  }
});

test('fixed sampler shows stage percent and measured stage-only ETA, not a whole-song promise', () => {
  const h = setup(); h.p.onConnection(true); h.stage('sampler');
  h.steps('sampler', 1);
  h.at(3000); h.steps('sampler', 2);
  h.at(6000); h.steps('sampler', 3);
  assert.match(h.p.content(), /3 \/ 32ステップ・9%/);
  assert.match(h.p.content(), /この工程の残り: 約.*推定・保存\/送信時間は別/);
  assert.match(h.p.content(), /完了目安: 算出中/);
  assert.match(h.p.content(), /経過: 6秒/);
  h.stage('decode');
  assert.doesNotMatch(h.p.content(), /ステップ・|この工程の残り/);
});

test('ignores invalid counters, wrong-node progress and stale progress after completion', () => {
  const h = setup(); h.p.onConnection(true); h.stage('sampler'); h.steps('sampler', 4);
  for (const value of [NaN, Infinity, -1, 999]) h.steps('sampler', value);
  h.steps('music', 20); h.steps('unknown', 30);
  assert.match(h.p.content(), /4 \/ 32/);
  h.stage(null); h.steps('sampler', 8);
  assert.doesNotMatch(h.p.content(), /ステップ/);
  assert.match(h.p.content(), /生成結果を確認中/);
});

test('progress_state only uses current running node; stage maximum changes reset measured speed', () => {
  const h = setup(); h.p.onConnection(true); h.stage('sampler');
  h.emit('progress_state', { nodes: { sampler: { state: 'running', value: 16, max: 32 }, music: { state: 'running', value: 2, max: 4 } } });
  assert.match(h.p.content(), /16 \/ 32ステップ・50%/);
  h.emit('progress_state', { nodes: { sampler: { state: 'finished', value: 32, max: 32 } } });
  assert.match(h.p.content(), /16 \/ 32/);
  h.steps('sampler', 1, 8);
  assert.match(h.p.content(), /1 \/ 8ステップ・12%/);
  assert.doesNotMatch(h.p.content(), /この工程の残り/);
});

test('throttles edits, uses safe mentions, suppresses overlap and cannot edit after stop', async () => {
  let release;
  const edits = [];
  const h = setup({ interaction: { editReply: value => { edits.push(value); return new Promise(resolve => { release = resolve; }); } } });
  h.at(4999); await h.p.tick(); assert.equal(edits.length, 0);
  h.at(5000); const first = h.p.tick();
  h.at(10000); await h.p.tick(); assert.equal(edits.length, 1);
  release(); await first;
  assert.deepEqual(edits[0].allowedMentions, { parse: [] });
  h.p.stop(); h.at(15000); await h.p.tick(); assert.equal(edits.length, 1);
});

test('failed optional status edit does not fail a generation', async () => {
  const h = setup({ interaction: { editReply: async () => { throw new Error('rate limited'); } } });
  h.at(5000); await assert.doesNotReject(h.p.tick());
});

test('disconnect and stalled events suppress stale numeric estimates; reconnect is observational only', () => {
  const h = setup(); h.p.onConnection(true); h.stage('sampler'); h.steps('sampler', 10);
  h.p.onConnection(false);
  assert.match(h.p.content(), /詳細進捗の更新待ち/);
  assert.doesNotMatch(h.p.content(), /10 \/ 32/);
  h.p.onConnection(true); h.at(40000);
  assert.match(h.p.content(), /更新待ち/);
});

test('empirical estimates and successful timing records exclude private prompt/lyrics/seed', () => {
  const h = setup(); h.p.onConnection(true); h.emit('execution_start'); h.emit('execution_cached', { nodes: [] });
  h.stage('abc'); h.at(12000); h.stage('sampler');
  h.timingHistory.estimate = (key, stage, options) => {
    assert.match(key, /^[a-f0-9]{64}$/); assert.equal(stage, 'sampler:KSampler');
    assert.equal(options.elapsedMs, 5000);
    return { minMs: 30000, maxMs: 60000, samples: 3 };
  };
  h.at(17000);
  assert.match(h.p.content(), /完了目安: あと約30秒〜1分0秒.*過去3件/);
  h.at(50000); h.p.complete();
  assert.equal(h.records.length, 1);
  assert.deepEqual(h.records[0][1], [{ stage: 'abc:YuE2GenerateABC', remainingMs: 50000 }, { stage: 'sampler:KSampler', remainingMs: 38000 }]);
  assert.doesNotMatch(JSON.stringify(h.records), /private|123/);
});

test('incomplete or disconnected traces do not train total ETA', () => {
  for (const failure of ['disconnect', 'no-cache', 'no-start', 'stopped']) {
    const h = setup(); h.p.onConnection(true);
    if (failure !== 'no-start') h.emit('execution_start');
    if (failure !== 'no-cache') h.emit('execution_cached', { nodes: [] });
    h.stage('sampler');
    if (failure === 'disconnect') h.p.onConnection(false);
    if (failure === 'stopped') h.p.stop(); else h.p.complete();
    assert.equal(h.records.length, 0);
  }
});

test('elapsed formatting is nonnegative and minute aware', () => {
  assert.equal(formatElapsed(-1), '0秒'); assert.equal(formatElapsed(70500), '1分10秒');
});

test('optional transport failure and missing transport are harmless', async () => {
  for (const client of [{}, { openProgress: async () => { throw new Error('offline'); } }]) {
    const p = await observeMusicProgress(client, { interaction: {}, model: 'yue2', durationSec: 120, timingHistory: null });
    assert.equal(p.clientId, undefined); p.setPromptId('id'); p.close();
  }
});

test('three completed traces enable total ETA on the next matching job, not other cache/server/settings', async () => {
  const history = createMusicTimingHistory();
  const make = (options = {}, cache = []) => {
    const h = setup({ timingHistory: history, baseUrl: 'http://server:8191', ...options });
    h.p.onConnection(true); h.emit('execution_start'); h.emit('execution_cached', { nodes: cache }); h.stage('sampler');
    return h;
  };
  for (let i = 0; i < 3; i++) {
    const h = make(); h.at(30000 + i * 1000); await h.p.complete();
  }
  assert.match(make().p.content(), /完了目安: あと約.*過去3件/);
  for (const h of [make({ durationSec: 180 }), make({ baseUrl: 'http://another:8188' }), make({}, ['abc'])]) {
    assert.match(h.p.content(), /完了目安: 算出中/);
  }
  const h = make({ workflow: { ...workflow, abc: { ...workflow.abc, inputs: { style: 'different private prompt', lyrics: 'different words', seed: 456 } } } });
  assert.match(h.p.content(), /過去3件/); // Prompt text never fragments or enters timing storage.
});
