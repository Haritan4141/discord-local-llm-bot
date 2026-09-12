import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAiImageEditForm, generateOpenAiImages, parseOpenAiImageResult } from '../src/image/openai.mjs';
import { resolveOpenAiImageModel, resolveOpenAiImageModels } from '../src/image/openai-models.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const reference = { data: png, mime: 'image/png', originalName: '猫.png' };
const options = { model: 'gpt-image-2.5-sunburst', prompt: '猫と月', size: '1536x1024', quality: 'low', count: 2 };

test('image model resolution selects auto by references and respects explicit modes', () => {
  for (const count of [0, 1, 8]) {
    for (const mode of [undefined, 'auto', 'flare', 'sunburst']) {
      const family = !mode || mode === 'auto' ? (count ? 'sunburst' : 'flare') : mode;
      assert.deepEqual(resolveOpenAiImageModel({ mode, referenceCount: count }), {
        mode: mode || 'auto', model: `gpt-image-2.5-${family}`,
      });
    }
  }
  assert.throws(() => resolveOpenAiImageModel({ mode: 'unknown' }), /auto.*flare.*sunburst/);
});

test('dedicated model settings override legacy, blank settings preserve legacy fallback', () => {
  assert.deepEqual(resolveOpenAiImageModels({ legacy: ' gpt-image-2 ', flare: ' ', sunburst: '' }), {
    flare: 'gpt-image-2', sunburst: 'gpt-image-2',
  });
  assert.deepEqual(resolveOpenAiImageModels({ legacy: 'old', flare: ' new-flare ', sunburst: 'new-sunburst' }), {
    flare: 'new-flare', sunburst: 'new-sunburst',
  });
  assert.deepEqual(resolveOpenAiImageModels({ flare: 'custom', legacy: ' ' }), {
    flare: 'custom', sunburst: 'gpt-image-2.5-sunburst',
  });
});

test('edit multipart contains scalar fields and ordered binary image[] files', async () => {
  const jpeg = { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]), mime: 'image/jpeg', originalName: 'photo.jpg' };
  const form = buildOpenAiImageEditForm({ ...options, references: [reference, jpeg] });
  for (const [key, value] of Object.entries({ model: options.model, prompt: options.prompt, size: options.size, quality: 'low', n: '2', output_format: 'png' })) {
    assert.equal(form.get(key), value);
  }
  const images = form.getAll('image[]');
  assert.equal(images.length, 2);
  assert.equal(images[0].type, 'image/png');
  assert.equal(images[1].type, 'image/jpeg');
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), png);
  assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), jpeg.data);
});

test('edit validation refuses empty, too many and non-image inputs', () => {
  assert.throws(() => buildOpenAiImageEditForm({ ...options, references: [] }), /参照画像/);
  assert.throws(() => buildOpenAiImageEditForm({ ...options, references: Array(9).fill(reference) }), /8/);
  assert.throws(() => buildOpenAiImageEditForm({ ...options, references: [{ ...reference, data: Buffer.from('not an image') }] }));
});

test('generation and edits use the correct URL, authentication and content type', async () => {
  for (const references of [[], [reference]]) {
    const result = await generateOpenAiImages({
      ...options, references, apiKey: 'test-key', url: 'https://api.openai.com/v1/images/generations',
      fetchImpl: async (url, request) => {
        assert.equal(url, `https://api.openai.com/v1/images/${references.length ? 'edits' : 'generations'}`);
        assert.equal(request.headers.Authorization, 'Bearer test-key');
        assert.equal(request.method, 'POST');
        if (references.length) {
          assert.equal(request.headers['Content-Type'], undefined);
          assert.equal(request.body.get('n'), '2');
          // The runtime supplies the multipart boundary; no manually fixed header.
          assert.match(new Request(url, request).headers.get('content-type'), /^multipart\/form-data; boundary=/);
        } else {
          assert.equal(request.headers['Content-Type'], 'application/json');
          assert.equal(JSON.parse(request.body).n, 2);
        }
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      },
    });
    assert.equal(result.images.length, 1);
  }
});

test('generation and edits share readable API failures and timeout handling', async () => {
  for (const references of [[], [reference]]) {
    const base = { ...options, references, apiKey: 'test-key', url: 'https://api.openai.com/v1/images/generations' };
    await assert.rejects(generateOpenAiImages({ ...base, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'model unavailable' } }), { status: 400 }) }), /400.*\nmodel unavailable/);
    await assert.rejects(generateOpenAiImages({ ...base, timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }) }), /timeout/);
  }
});

test('image usage supports nested API details and top-level text/image counters', () => {
  const usage = parseOpenAiImageResult({ usage: { input_text_tokens: 120, input_image_tokens: 3820, output_tokens: 1450, total_tokens: 5390 } }).usage;
  assert.equal(usage.inputTextTokens, 120);
  assert.equal(usage.inputImageTokens, 3820);
  assert.equal(usage.totalTokens, 5390);
});
