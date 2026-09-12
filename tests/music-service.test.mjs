import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicService } from '../src/music/service.mjs';

function setup(overrides = {}) {
  const events = [], errors = [];
  const yue2Client = { assertIdle: async () => events.push('check-yue2'), free: async () => events.push('free-yue2') };
  const aceClient = { assertIdle: async () => events.push('check-ace'), free: async () => events.push('free-ace') };
  const jobs = createMusicService({ yue2Client, aceClient, idleDelayMs: 0,
    runYue2: async () => events.push('run-yue2'), runComfyAce: async () => events.push('run-ace'),
    onError: async (_job, e) => errors.push(e), ...overrides });
  return { jobs, events, errors, yue2Client, aceClient };
}
test('model switching releases the previous idle ComfyUI model before the next one', async () => {
  const h = setup(); h.jobs.enqueue({ model: 'yue2' }); h.jobs.enqueue({ model: 'ace-step' });
  await h.jobs.whenIdle(); h.jobs.dispose();
  assert.ok(h.events.indexOf('free-yue2') > h.events.indexOf('run-yue2'));
  assert.ok(h.events.indexOf('free-yue2') < h.events.indexOf('run-ace'));
});
test('unused stopped ACE server does not prevent YuE2, but a busy one does', async () => {
  for (const busy of [false, true]) {
    const h = setup();
    h.aceClient.assertIdle = async () => { throw Object.assign(new Error('offline or busy'), busy ? { code: 'MUSIC_SERVER_BUSY' } : {}); };
    h.jobs.enqueue({ model: 'yue2' }); await h.jobs.whenIdle(); h.jobs.dispose();
    assert.equal(h.events.includes('run-yue2'), !busy);
  }
});

test('a backend that declines release is not discarded when switching models', async () => {
  const h = setup();
  let frees = 0;
  h.yue2Client.free = async () => { frees++; return false; };
  h.jobs.enqueue({ model: 'yue2' }); h.jobs.enqueue({ model: 'ace-step' }); h.jobs.enqueue({ model: 'ace-step' });
  await h.jobs.whenIdle(); h.jobs.dispose();
  assert.equal(frees, 2);
  assert.equal(h.events.includes('run-ace'), false);
  assert.deepEqual(h.errors.map(e => e.code), ['MUSIC_SERVER_BUSY', 'MUSIC_SERVER_BUSY']);
});
test('a timed-out remote job is not overlapped with a later request', async () => {
  let uncertain = false;
  const h = setup({ runYue2: async () => { uncertain = true; throw new Error('lost response'); } });
  h.yue2Client.assertIdle = async () => { if (uncertain) throw Object.assign(new Error('busy'), { code: 'MUSIC_SERVER_BUSY' }); };
  h.jobs.enqueue({ model: 'yue2' }); h.jobs.enqueue({ model: 'ace-step' });
  await h.jobs.whenIdle(); h.jobs.dispose();
  assert.equal(h.errors.length, 2); assert.equal(h.events.includes('run-ace'), false);
});
test('worker waits for queued reply setup and never generates cancelled jobs', async () => {
  let ready;
  const h = setup(); const job = { model: 'yue2', ready: new Promise(resolve => { ready = resolve; }) };
  h.jobs.enqueue(job); await Promise.resolve(); assert.deepEqual(h.events, []);
  job.cancelled = true; ready(); await h.jobs.whenIdle(); h.jobs.dispose();
  assert.equal(h.events.includes('run-yue2'), false);
});
test('legacy ACE API failure conservatively blocks subsequent generation until operator recovery', async () => {
  const h = setup({ aceBackend: 'ace', aceClient: null, runApiAce: async () => { throw new Error('lost result'); } });
  h.jobs.enqueue({ model: 'ace-step' }); h.jobs.enqueue({ model: 'yue2' });
  await h.jobs.whenIdle(); h.jobs.dispose();
  assert.equal(h.errors.at(-1).code, 'MUSIC_STATE_UNKNOWN');
  assert.equal(h.events.includes('run-yue2'), false);
});
