import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMusicTimingHistory } from '../src/music/progress-estimates.mjs';

function addSamples(history, key, stage, values) {
  for (const remainingMs of values) {
    assert.equal(history.record(key, [{ stage, remainingMs }]), true);
  }
}

test('estimates stay unavailable until three samples and use a broad range', () => {
  const history = createMusicTimingHistory();

  addSamples(history, 'key-a', 'sampler', [1000, 1200]);
  assert.equal(history.estimate('key-a', 'sampler'), null);

  history.record('key-a', [{ stage: 'sampler', remainingMs: 1400 }]);
  assert.deepEqual(history.estimate('key-a', 'sampler'), {
    minMs: 700,
    maxMs: 1820,
    samples: 3,
  });
});

test('elapsed time is subtracted and overruns do not become a false zero ETA', () => {
  const history = createMusicTimingHistory();
  addSamples(history, 'key-a', 'decode', [1000, 1200, 1400]);

  assert.deepEqual(history.estimate('key-a', 'decode', { elapsedMs: 200 }), {
    minMs: 500,
    maxMs: 1620,
    samples: 3,
  });
  assert.equal(history.estimate('key-a', 'decode', { elapsedMs: 1820 }), null);
  assert.equal(history.estimate('key-a', 'decode', { elapsedMs: Number.NaN }), null);
  assert.equal(history.estimate('key-a', 'decode', null), null);
});

test('outlier observations widen the range instead of producing false precision', () => {
  const history = createMusicTimingHistory();
  addSamples(history, 'key-a', 'variable-stage', [100, 110, 10000]);

  assert.deepEqual(history.estimate('key-a', 'variable-stage'), {
    minMs: 70,
    maxMs: 13000,
    samples: 3,
  });
});

test('sample windows are bounded and retain the latest observations', () => {
  const history = createMusicTimingHistory({ maxSamples: 3 });
  addSamples(history, 'key-a', 'stage', [100, 200, 300, 400]);

  assert.deepEqual(history.estimate('key-a', 'stage'), {
    minMs: 140,
    maxMs: 520,
    samples: 3,
  });
});

test('keys are isolated and oldest keys are evicted at the configured bound', () => {
  const history = createMusicTimingHistory({ maxKeys: 2 });
  for (const key of ['a', 'b', 'c']) addSamples(history, key, 'stage', [100, 100, 100]);

  assert.equal(history.estimate('a', 'stage'), null);
  assert.deepEqual(history.estimate('b', 'stage'), {
    minMs: 70,
    maxMs: 130,
    samples: 3,
  });
  assert.deepEqual(history.estimate('c', 'stage'), {
    minMs: 70,
    maxMs: 130,
    samples: 3,
  });
});

test('malformed records are rejected atomically and do not bypass bounds', () => {
  const history = createMusicTimingHistory({ maxKeys: 1 });
  assert.equal(history.record('key-a', [
    { stage: 'ok', remainingMs: 100 },
    { stage: 'bad', remainingMs: Number.POSITIVE_INFINITY },
  ]), false);
  assert.equal(history.estimate('key-a', 'ok'), null);
  assert.equal(history.record('key-a', []), false);
  assert.equal(history.record('key-a', [{ stage: 'ok', remainingMs: -1 }]), false);
  assert.equal(history.record('key-a', [{ stage: 'ok', remainingMs: 100 }, { stage: 'ok', remainingMs: 100 }]), false);
  assert.equal(history.record('\u0000', [{ stage: 'ok', remainingMs: 100 }]), false);

  const tooManyStages = Array.from({ length: 65 }, (_, index) => ({
    stage: `stage-${index}`,
    remainingMs: 100,
  }));
  assert.equal(history.record('key-a', tooManyStages), false);
});

test('persistence reloads valid bounded samples and ignores corrupt or oversized data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'music-progress-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'timings.json');

  const history = createMusicTimingHistory({ path: filePath });
  addSamples(history, 'key-a', 'sampler', [1000, 1200, 1400]);
  await history.flush();
  const reloaded = createMusicTimingHistory({ path: filePath });
  assert.deepEqual(reloaded.estimate('key-a', 'sampler'), {
    minMs: 700,
    maxMs: 1820,
    samples: 3,
  });

  await writeFile(filePath, '{broken json', 'utf8');
  assert.equal(createMusicTimingHistory({ path: filePath }).estimate('key-a', 'sampler'), null);
  await writeFile(filePath, 'x'.repeat(1024 * 1024 + 1), 'utf8');
  assert.equal(createMusicTimingHistory({ path: filePath }).estimate('key-a', 'sampler'), null);
});

test('persistence errors and parallel flushes are fail-soft', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'music-progress-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A directory cannot be replaced by the timing file. The generation-facing
  // API still resolves and keeps its in-memory estimate.
  const history = createMusicTimingHistory({ path: directory });
  addSamples(history, 'key-a', 'stage', [100, 120, 140]);
  await assert.doesNotReject(history.flush());
  assert.deepEqual(history.estimate('key-a', 'stage'), {
    minMs: 70,
    maxMs: 182,
    samples: 3,
  });

  const filePath = join(directory, 'parallel', 'timings.json');
  const persisted = createMusicTimingHistory({ path: filePath });
  addSamples(persisted, 'key-a', 'stage', [100, 120, 140]);
  await Promise.all([persisted.flush(), persisted.flush(), persisted.flush()]);
  const text = await readFile(filePath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(text));
  assert.deepEqual(createMusicTimingHistory({ path: filePath }).estimate('key-a', 'stage'), {
    minMs: 70,
    maxMs: 182,
    samples: 3,
  });
});

test('invalid factory bounds fail before a history is created', () => {
  assert.throws(() => createMusicTimingHistory({ maxKeys: 0 }), RangeError);
  assert.throws(() => createMusicTimingHistory({ maxSamples: 65 }), RangeError);
  assert.throws(() => createMusicTimingHistory(null), TypeError);
});
