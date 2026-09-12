// Read existing results; never submit a generation. --verify-idle-release explicitly
// exercises the production queue/service free path with a one-second test interval.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { hostname } from 'node:os';
import { createComfyClient } from '../src/music/comfy-client.mjs';
import { createMusicService } from '../src/music/service.mjs';
import { parseYue2HistoryResult } from '../src/music/yue2-workflow.mjs';

const { values } = parseArgs({ options: {
  'base-url': { type: 'string', default: 'http://127.0.0.1:8191' },
  'prompt-id': { type: 'string', multiple: true },
  'verify-idle-release': { type: 'boolean', default: false },
} });
assert(values['prompt-id']?.length, 'Pass at least one existing --prompt-id');
if (values['verify-idle-release']) {
  assert.equal(hostname().toUpperCase(), 'DESKTOP-L9HAM1G', 'Model release validation is BLUE-only');
  assert(['http://127.0.0.1:8191', 'http://192.168.0.104:8191'].includes(values['base-url']),
    'Release validation must use the dedicated YuE2 endpoint, never ACE/video/another ComfyUI');
}
const client = createComfyClient(values['base-url']);
const results = [];
for (const id of values['prompt-id']) {
  const result = parseYue2HistoryResult(await client.history(id), id);
  assert(result, 'Result is not completed');
  const audio = await client.audio(result.audio, 8 * 1024 * 1024);
  results.push({ promptId: id, ...result, downloadedBytes: audio.length });
}
let idleRelease = 'NOT_REQUESTED';
if (values['verify-idle-release']) {
  await client.assertIdle();
  let resolveFree, rejectFree, watchdog;
  const freed = new Promise((resolve, reject) => { resolveFree = resolve; rejectFree = reject; });
  const started = Date.now();
  const checkedClient = { ...client, async free() {
    const response = await client.free();
    resolveFree({ elapsedMs: Date.now() - started, response });
    return response;
  } };
  const service = createMusicService({
    yue2Client: checkedClient, runYue2: async () => {},
    onError: async (_job, error) => rejectFree(error), idleDelayMs: 1000,
  });
  try {
    watchdog = setTimeout(() => rejectFree(new Error('Idle release did not finish')), 20000);
    service.enqueue({ model: 'yue2' });
    await service.whenIdle();
    idleRelease = await freed;
    await service.whenIdle();
    await client.assertIdle();
    assert(idleRelease.elapsedMs >= 1000, 'Release occurred before the idle interval');
  } finally { clearTimeout(watchdog); service.dispose(); }
}
console.log(JSON.stringify({ status: 'PASS', results, idleRelease }));
