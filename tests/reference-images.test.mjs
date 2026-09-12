import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  assertReferenceImageCount,
  fetchReferenceImage,
  validateReferenceImage,
} from '../src/image/reference-images.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.from('RIFFxxxxWEBP', 'ascii');

function responseFor(data, mime = 'image/png', headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': mime, 'content-length': String(data.length), ...headers }),
    body: (async function* body() {
      yield data.subarray(0, Math.max(1, Math.floor(data.length / 2)));
      yield data.subarray(Math.max(1, Math.floor(data.length / 2)));
    }()),
  };
}

test('reference image validation requires an allowed MIME and matching signature', () => {
  assert.equal(MAX_REFERENCE_IMAGES, 8);
  assert.equal(MAX_REFERENCE_IMAGE_BYTES, 20 * 1024 * 1024);
  assert.deepEqual(validateReferenceImage({ data: PNG, mime: 'image/png', originalName: '猫.png' }), {
    data: PNG,
    mime: 'image/png',
    originalName: '猫.png',
  });
  assert.equal(validateReferenceImage({ data: JPEG, mime: 'image/jpeg', originalName: 'photo.jpg' }).mime, 'image/jpeg');
  assert.equal(validateReferenceImage({ data: WEBP, mime: 'image/webp', originalName: 'photo.webp' }).mime, 'image/webp');
  assert.throws(
    () => validateReferenceImage({ data: PNG, mime: 'image/jpeg', originalName: 'wrong.jpg' }),
    /signature|MIME/i,
  );
  assert.throws(
    () => validateReferenceImage({ data: Buffer.from('not an image'), mime: 'image/png', originalName: 'bad.png' }),
    /signature/i,
  );
  assert.throws(
    () => validateReferenceImage({ data: PNG, mime: 'image/gif', originalName: 'bad.gif' }),
    /MIME/i,
  );
});

test('reference image count is bounded', () => {
  assert.equal(assertReferenceImageCount(0), 0);
  assert.equal(assertReferenceImageCount(8), 8);
  assert.throws(() => assertReferenceImageCount(9), /8/);
  assert.throws(() => assertReferenceImageCount(-1), /8/);
});

test('fetchReferenceImage accepts Discord CDN streams and enforces redirect/size checks', async () => {
  let request;
  const image = await fetchReferenceImage({
    url: 'https://cdn.discordapp.com/attachments/123/456/cat.png?ex=abc',
    contentType: 'image/png',
    name: 'cat.png',
    size: PNG.length,
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFor(PNG);
    },
  });
  assert.deepEqual(image, { data: PNG, mime: 'image/png', originalName: 'cat.png' });
  assert.equal(request.url, 'https://cdn.discordapp.com/attachments/123/456/cat.png?ex=abc');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.method, 'GET');

  await assert.rejects(
    fetchReferenceImage({ url: 'https://example.com/attachments/123/456/cat.png', contentType: 'image/png' }, {
      fetchImpl: async () => responseFor(PNG),
    }),
    /Discord CDN/i,
  );
  await assert.rejects(
    fetchReferenceImage({ url: 'https://media.discordapp.net/attachments/123/456/cat.png', contentType: 'image/png' }, {
      fetchImpl: async () => responseFor(PNG, 'image/png', { 'content-length': '999' }),
      maxBytes: 100,
    }),
    /large|maximum/i,
  );
  await assert.rejects(
    fetchReferenceImage({ url: 'https://cdn.discordapp.com/attachments/123/456/cat.png', contentType: 'image/png' }, {
      fetchImpl: async () => ({ ...responseFor(PNG), redirected: true }),
    }),
    /redirect/i,
  );
});

test('fetchReferenceImage times out a hanging fetch', async () => {
  await assert.rejects(
    fetchReferenceImage({ url: 'https://cdn.discordapp.com/attachments/123/456/cat.png', contentType: 'image/png' }, {
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        void resolve;
      }),
    }),
    /timed out/i,
  );
});

test('fetchReferenceImage aborts failed downloads and cancels an overflowing stream', async () => {
  let canceled = false;
  let aborted = false;
  let reads = 0;
  const body = {
    getReader() {
      return {
        async read() {
          reads += 1;
          return reads === 1 ? { done: false, value: Buffer.alloc(5) } : { done: true };
        },
        async cancel() { canceled = true; },
        releaseLock() {},
      };
    },
  };
  await assert.rejects(
    fetchReferenceImage({
      url: 'https://cdn.discordapp.com/attachments/123/456/cat.png',
      contentType: 'image/png',
    }, {
      maxBytes: 4,
      fetchImpl: async (_url, { signal }) => {
        signal.addEventListener('abort', () => { aborted = true; });
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), body };
      },
    }),
    /large|maximum/i,
  );
  assert.equal(canceled, true);
  assert.equal(aborted, true);
});
