import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawHandler } from '../src/discord/draw.mjs';
import { resolveOpenAiImageModels } from '../src/image/openai-models.mjs';
import { numEnv } from '../src/utils/llm-config.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const direct = { data: png, mime: 'image/png', originalName: 'direct.png' };
const saved = { ...direct, originalName: 'saved.png' };
const config = {
  IMAGE_PROVIDER_MODE: 'openai', OPENAI_IMAGE_MODELS: resolveOpenAiImageModels(),
  OPENAI_IMAGE_SIZE_VALUE: '1024x1024', OPENAI_IMAGE_QUALITY_VALUE: 'low',
  OPENAI_IMAGE_GENERATIONS_URL: 'https://api.openai.com/v1/images/generations',
  OPENAI_IMAGE_EDITS_URL: 'https://api.openai.com/v1/images/edits',
  OPENAI_IMAGE_API_KEY_VALUE: 'test-key', DISCORD_MAX_ATTACHMENT_BYTES: 1024 * 1024,
  SD_DEFAULTS: { width: 768, height: 768, steps: 20, cfgScale: 7, sampler: 'Euler', batchSize: 1, negative: 'bad' },
  numEnv,
};
const logger = { log() {}, error() {} };

function interaction(values = {}) {
  const replies = [];
  const read = name => values[name] ?? null;
  return {
    replies,
    options: { getString: read, getInteger: read, getNumber: read, getAttachment: read },
    async reply(value) { replies.push(value); },
    async deferReply() { this.deferred = true; },
    async editReply(value) { replies.push(value); },
  };
}

test('/draw old prompt/size/batch and new reference combinations reach the actual API builder', async () => {
  for (const values of [
    { prompt: '猫' },
    { prompt: '猫', width: 1536, height: 1024, batch: 2 },
    { prompt: '猫', image: { name: 'direct.png' } },
    { prompt: '猫', reference: 'Akaya' },
    { prompt: '猫', image: { name: 'direct.png' }, reference: 'Akaya' },
    { prompt: '猫', image: { name: 'direct.png' }, reference: 'Akaya', savedCount: 7 },
    { prompt: '猫', image: { name: 'direct.png' }, model: 'flare' },
    { prompt: '猫', model: 'sunburst' },
  ]) {
    const i = interaction(values);
    const savedCount = values.reference ? values.savedCount || 1 : 0;
    const expectedRefs = (values.image ? 1 : 0) + savedCount;
    const expectedFamily = values.model || (expectedRefs ? 'sunburst' : 'flare');
    const { generateOpenAiImages } = await import('../src/image/openai.mjs');
    const handler = createDrawHandler({
      config, logger,
      referenceStore: { async loadImages(name) { assert.equal(name, 'Akaya'); return Array(savedCount).fill(saved); } },
      fetchImage: async () => direct,
      generateImages: async args => {
        assert.deepEqual(args.references.map(image => image.originalName), [ ...(values.image ? ['direct.png'] : []), ...Array(savedCount).fill('saved.png') ]);
        return generateOpenAiImages({ ...args, fetchImpl: async (url, request) => {
          assert.equal(url, expectedRefs ? config.OPENAI_IMAGE_EDITS_URL : config.OPENAI_IMAGE_GENERATIONS_URL);
          const payload = expectedRefs ? Object.fromEntries(request.body) : JSON.parse(request.body);
          assert.equal(payload.model, `gpt-image-2.5-${expectedFamily}`);
          assert.equal(payload.size, values.width ? '1536x1024' : '1024x1024');
          assert.equal(Number(payload.n), values.batch || 1);
          assert.equal(payload.prompt, '猫');
          return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: {
            input_tokens_details: { text_tokens: 120, image_tokens: 3820 }, output_tokens: 1450, total_tokens: 5390,
          } }));
        } });
      },
    });
    await handler(i);
    assert.equal(i.deferred, true);
    const reply = i.replies.at(-1);
    assert.equal(reply.files.length, 1);
    assert.match(reply.content, new RegExp(`model: gpt-image-2.5-${expectedFamily}.*mode: ${values.model || 'auto'}`));
    assert.match(reply.content, new RegExp(`references: ${expectedRefs}`));
    assert.match(reply.content, /input_text: 120.*input_image: 3820.*output: 1450.*total: 5390/);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
  }
});

test('/draw rejects missing profile, combined limit, invalid image and invalid dimensions before generation', async () => {
  const cases = [
    { values: { reference: 'missing' }, load: async () => { throw new Error('reference が見つかりません'); }, error: /見つかりません/ },
    { values: { reference: 'full', image: {} }, load: async () => Array(8).fill(saved), error: /8/ },
    { values: { image: {} }, fetch: async () => { throw new Error('画像 MIME が未対応'); }, error: /MIME/ },
    { values: { width: 512, height: 512 }, error: /未対応/ },
  ];
  for (const c of cases) {
    const i = interaction({ prompt: '猫', ...c.values });
    let generated = false;
    await createDrawHandler({ config, logger,
      referenceStore: { loadImages: c.load }, fetchImage: c.fetch,
      generateImages: async () => { generated = true; },
    })(i);
    assert.equal(generated, false);
    assert.match(i.replies.at(-1).content, c.error);
  }
});

test('SD rejects all explicitly supplied OpenAI options including auto before downloading or generating', async () => {
  for (const provider of ['stable-diffusion', 'sd']) {
    for (const values of [{ image: {} }, { reference: 'Akaya' }, { model: 'auto' }, { model: 'flare' }, { model: 'sunburst' }]) {
      const i = interaction({ prompt: 'cat', ...values });
      const forbidden = async () => { assert.fail('must not contact providers or storage'); };
      await createDrawHandler({ config: { ...config, IMAGE_PROVIDER_MODE: provider }, logger,
        generateImages: forbidden, sdGenerate: forbidden, fetchImage: forbidden,
        referenceStore: { loadImages: forbidden },
      })(i);
      assert.equal(i.deferred, undefined);
      assert.match(i.replies.at(-1), /OpenAI image provider のみ対応/);
    }
  }
});

test('SD old options, defaults, clamps, translation and translation failure remain intact', async () => {
  for (const custom of [false, true]) {
    const i = interaction({ prompt: '猫', ...(custom ? { width: 9000, height: 32, steps: 999, cfg: 0, sampler: 'DDIM', seed: 42, batch: 8, negative: 'blurry' } : {}) });
    await createDrawHandler({ config: { ...config, IMAGE_PROVIDER_MODE: 'stable-diffusion' }, logger,
      translatePrompt: async () => { if (custom) throw new Error('LLM offline'); return { prompt: 'cat', translated: true }; },
      sdGenerate: async options => {
        assert.deepEqual(options, custom ? {
          prompt: '猫', width: 2048, height: 64, steps: 150, cfgScale: 1, sampler: 'DDIM', seed: 42, batchSize: 4, negativePrompt: 'blurry',
        } : { prompt: 'cat', width: 768, height: 768, steps: 20, cfgScale: 7, sampler: 'Euler', seed: -1, batchSize: 1, negativePrompt: 'bad' });
        return [png.toString('base64')];
      },
    })(i);
    assert.equal(i.replies.at(-1).files.length, 1);
    assert.match(i.replies.at(-1).content, /生成完了/);
  }
});

test('/draw pause, empty prompt, API error, empty response and Discord size limit are handled', async () => {
  const paused = interaction({ prompt: '猫' });
  await createDrawHandler({ config, logger })(paused, { paused: true });
  assert.match(paused.replies[0], /paused/);
  const empty = interaction({ prompt: ' ' });
  await createDrawHandler({ config, logger })(empty);
  assert.match(empty.replies[0], /prompt is required/);
  for (const [generateImages, pattern] of [
    [async () => { throw new Error('API denied'); }, /API denied/],
    [async () => ({ images: [] }), /画像が返されません/],
    [async () => ({ images: [Buffer.alloc(config.DISCORD_MAX_ATTACHMENT_BYTES + 1).toString('base64')] }), /送信上限/],
  ]) {
    const i = interaction({ prompt: '猫' });
    await createDrawHandler({ config, logger, generateImages })(i);
    const reply = i.replies.at(-1);
    assert.match(typeof reply === 'string' ? reply : reply.content, pattern);
  }
});
