import test from 'node:test';
import assert from 'node:assert/strict';
import { comfyFreeMemory } from '../src/music/comfy.mjs';

test('comfyFreeMemory requests model unload and allocator cleanup', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, statusText: 'OK' };
  };

  try {
    await comfyFreeMemory();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(request.url, /\/free$/);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    unload_models: true,
    free_memory: true,
  });
});

test('comfyFreeMemory reports ComfyUI errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    text: async () => 'ComfyUI is stopping',
  });

  try {
    await assert.rejects(
      () => comfyFreeMemory(),
      /ComfyUI free memory error: 503 Service Unavailable\nComfyUI is stopping/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
