import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicQueue } from '../src/music/queue-engine.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  let nextId = 0;
  const timers = new Map();
  const cleared = [];
  return {
    setTimer(callback, delay) {
      const timer = { id: ++nextId, callback, delay, unref() {} };
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimer(timer) {
      cleared.push(timer);
      timers.delete(timer?.id);
    },
    fire() {
      const timer = [...timers.values()][0];
      if (!timer) return false;
      timers.delete(timer.id);
      timer.callback();
      return true;
    },
    get timers() { return timers; },
    cleared,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('enforces maxJobs atomically and returns one-based positions', async () => {
  const timers = fakeTimers();
  const first = deferred();
  const started = [];
  const queue = createMusicQueue({
    maxJobs: 2,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runJob: async (job) => {
      started.push(job);
      if (job === 'first') await first.promise;
    },
  });

  assert.equal(queue.enqueue('first'), 1);
  assert.equal(queue.enqueue('second'), 2);
  assert.throws(() => queue.enqueue('third'), { code: 'MUSIC_QUEUE_FULL' });
  assert.equal(queue.totalCount(), 2);

  first.resolve();
  await queue.whenIdle();
  assert.deepEqual(started, ['first', 'second']);
  queue.dispose();
});

test('runs different model jobs through one serial queue', async () => {
  const timers = fakeTimers();
  const first = deferred();
  const events = [];
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runJob: async (job) => {
      events.push(`start:${job.model}`);
      if (job.model === 'yue2') await first.promise;
      events.push(`end:${job.model}`);
    },
  });

  queue.enqueue({ model: 'yue2' });
  queue.enqueue({ model: 'ace-step' });
  await flush();
  assert.deepEqual(events, ['start:yue2']);
  first.resolve();
  await queue.whenIdle();
  assert.deepEqual(events, [
    'start:yue2',
    'end:yue2',
    'start:ace-step',
    'end:ace-step',
  ]);
  queue.dispose();
});

test('continues after job errors and protects an error handler that throws', async () => {
  const timers = fakeTimers();
  const run = [];
  const reported = [];
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runJob: async (job) => {
      run.push(job);
      if (job === 'bad') throw new Error('backend failed');
    },
    onError: async (job, error) => {
      reported.push([job, error.message]);
      throw new Error('reply failed');
    },
  });

  queue.enqueue('bad');
  queue.enqueue('good');
  await queue.whenIdle();
  assert.deepEqual(run, ['bad', 'good']);
  assert.deepEqual(reported, [['bad', 'backend failed']]);
  queue.dispose();
});

test('cancels a pending idle-release timer when a new job arrives', async () => {
  const timers = fakeTimers();
  let releaseCount = 0;
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => { releaseCount += 1; },
    runJob: async () => {},
  });

  queue.enqueue('first');
  await queue.whenIdle();
  assert.equal(timers.timers.size, 1);
  queue.enqueue('second');
  assert.equal(timers.cleared.length, 1);
  await queue.whenIdle();
  assert.equal(releaseCount, 0);
  queue.dispose();
});

test('idleDelayMs=0 disables automatic idle release', async () => {
  const timers = fakeTimers();
  let releaseCount = 0;
  const queue = createMusicQueue({
    idleDelayMs: 0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => { releaseCount += 1; },
    runJob: async () => {},
  });

  queue.enqueue('job');
  await queue.whenIdle();
  assert.equal(timers.timers.size, 0);
  assert.equal(releaseCount, 0);
  queue.dispose();
});

test('retries idle release when the backend reports retained work', async () => {
  const timers = fakeTimers();
  let releaseCount = 0;
  const queue = createMusicQueue({
    idleDelayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => {
      releaseCount += 1;
      return releaseCount === 1 ? false : true;
    },
    runJob: async () => {},
  });

  queue.enqueue('job');
  await queue.whenIdle();
  assert.equal(timers.fire(), true);
  await flush();
  assert.equal(releaseCount, 1);
  assert.equal(timers.timers.size, 1);

  assert.equal(timers.fire(), true);
  await queue.whenIdle();
  await flush();
  assert.equal(releaseCount, 2);
  assert.equal(timers.timers.size, 0);
  queue.dispose();
});

test('a new job cancels an idle-release retry timer', async () => {
  const timers = fakeTimers();
  let releaseCount = 0;
  const queue = createMusicQueue({
    idleDelayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => {
      releaseCount += 1;
      return releaseCount === 1 ? false : true;
    },
    runJob: async () => {},
  });

  queue.enqueue('first');
  await queue.whenIdle();
  assert.equal(timers.fire(), true);
  await flush();
  assert.equal(releaseCount, 1);
  assert.equal(timers.timers.size, 1);

  queue.enqueue('second');
  await queue.whenIdle();
  // The retry that was pending is cancelled while the new job runs. Once the
  // new job finishes, the normal idle timer is scheduled afresh.
  assert.equal(releaseCount, 1);
  assert.equal(timers.timers.size, 1);
  assert.equal(timers.cleared.length, 1);
  assert.equal(timers.fire(), true);
  await flush();
  assert.equal(releaseCount, 2);
  assert.equal(timers.timers.size, 0);
  queue.dispose();
});

test('dispose cancels a pending idle-release retry', async () => {
  const timers = fakeTimers();
  let releaseCount = 0;
  const queue = createMusicQueue({
    idleDelayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => {
      releaseCount += 1;
      return false;
    },
    runJob: async () => {},
  });

  queue.enqueue('job');
  await queue.whenIdle();
  assert.equal(timers.fire(), true);
  await flush();
  assert.equal(releaseCount, 1);
  assert.equal(timers.timers.size, 1);

  queue.dispose();
  assert.equal(timers.timers.size, 0);
  assert.equal(timers.cleared.length, 1);
  assert.equal(timers.fire(), false);
  assert.equal(releaseCount, 1);
});

test('waits for asynchronous idle release before starting a newly queued job', async () => {
  const timers = fakeTimers();
  const release = deferred();
  const events = [];
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => {
      events.push('release:start');
      await release.promise;
      events.push('release:end');
    },
    beforeJob: async (job) => { events.push(`before:${job}`); },
    runJob: async (job) => { events.push(`run:${job}`); },
  });

  queue.enqueue('first');
  await queue.whenIdle();
  assert.equal(timers.fire(), true);
  await flush();
  assert.deepEqual(events, ['before:first', 'run:first', 'release:start']);

  queue.enqueue('second');
  await flush();
  assert.deepEqual(events, ['before:first', 'run:first', 'release:start']);
  let idleResolved = false;
  queue.whenIdle().then(() => { idleResolved = true; });
  release.resolve();
  await queue.whenIdle();
  assert.deepEqual(events, [
    'before:first',
    'run:first',
    'release:start',
    'release:end',
    'before:second',
    'run:second',
  ]);
  assert.equal(idleResolved, true);
  queue.dispose();
});

test('does not release resources while the queue is busy', async () => {
  const timers = fakeTimers();
  const first = deferred();
  let releaseCount = 0;
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    releaseIdle: async () => { releaseCount += 1; },
    runJob: async (job) => {
      if (job === 'first') await first.promise;
    },
  });

  queue.enqueue('first');
  queue.enqueue('second');
  assert.equal(timers.timers.size, 0);
  first.resolve();
  await queue.whenIdle();
  assert.equal(releaseCount, 0);
  assert.equal(timers.timers.size, 1);
  timers.fire();
  await queue.whenIdle();
  assert.equal(releaseCount, 1);
  queue.dispose();
});

test('dispose cancels future timers and rejects new jobs without aborting active work', async () => {
  const timers = fakeTimers();
  const active = deferred();
  let finished = false;
  const queue = createMusicQueue({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runJob: async () => {
      await active.promise;
      finished = true;
    },
  });

  queue.enqueue('active');
  queue.dispose();
  assert.equal(timers.cleared.length, 0);
  assert.throws(() => queue.enqueue('new'), { code: 'MUSIC_QUEUE_DISPOSED' });
  active.resolve();
  await queue.whenIdle();
  assert.equal(finished, true);
  assert.equal(timers.timers.size, 0);
});
