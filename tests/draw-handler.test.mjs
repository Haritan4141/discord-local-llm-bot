import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawHandler } from '../src/discord/draw.mjs';
import { resolveOpenAiImageModels } from '../src/image/openai-models.mjs';
import { fetchReferenceImage } from '../src/image/reference-images.mjs';
import { numEnv } from '../src/utils/llm-config.mjs';
import sharp from 'sharp';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4//9/AwAJfAN+bOwQyQAAAABJRU5ErkJggg==', 'base64');
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

test('/draw sends resized attachment and profile copies through multipart while preserving output settings and originals', async () => {
  const attachment = { data: await sharp({ create: { width: 2048, height: 1024, channels: 3, background: 'red' } }).jpeg().toBuffer(), mime: 'image/jpeg', originalName: 'direct.jpg' };
  const profile = { data: await sharp({ create: { width: 1024, height: 2048, channels: 4, background: '#0000ff80' } }).png().toBuffer(), mime: 'image/png', originalName: 'saved.png' };
  const copies = [Buffer.from(attachment.data), Buffer.from(profile.data)];
  const i = interaction({ prompt: 'Draw them', image: {}, reference: 'Saved' });
  const { generateOpenAiImages } = await import('../src/image/openai.mjs');
  let calls = 0;
  await createDrawHandler({ config: { ...config, OPENAI_IMAGE_REFERENCE_MAX_EDGE_VALUE: 512 }, logger,
    fetchImage: async () => attachment,
    referenceStore: { loadImages: async () => [profile] },
    generateImages: args => generateOpenAiImages({ ...args, fetchImpl: async (_, request) => {
      calls++;
      assert.equal(request.body.get('size'), '1024x1024');
      assert.equal(request.body.get('quality'), 'low');
      const files = request.body.getAll('image[]');
      for (const [index, file] of files.entries()) {
        assert.equal(file.name, `reference_${index + 1}.png`);
        assert.equal(file.type, 'image/png');
        const { width, height } = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
        assert.deepEqual([width, height], index ? [256, 512] : [512, 256]);
      }
      assert.equal(files.length, 2);
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    } }),
  })(i);
  assert.equal(calls, 1);
  assert.deepEqual(attachment.data, copies[0]);
  assert.deepEqual(profile.data, copies[1]);
  assert.match(i.replies.at(-1).content, /reference input: 512x256 \/ 256x512 px/);
});

test('/draw stops before generation when either a saved or attached image cannot be decoded', async () => {
  const corrupt = { ...direct, data: Buffer.from('89504e470d0a1a0a', 'hex') };
  for (const badSaved of [false, true]) {
    const i = interaction({ prompt: 'Draw them', image: {}, reference: 'Saved' });
    let calls = 0;
    await createDrawHandler({ config, logger,
      fetchImage: async () => badSaved ? direct : corrupt,
      referenceStore: { loadImages: async () => [badSaved ? corrupt : saved] },
      generateImages: async () => { calls++; },
    })(i);
    assert.equal(calls, 0);
    assert.match(i.replies.at(-1).content, /縮小できません/);
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

test('/draw accepts an ephemeral attachment through the real downloader and selects Sunburst', async () => {
  const url = 'https://cdn.discordapp.com/ephemeral-attachments/123/456/avatar.png?ex=abc&hm=signature';
  const i = interaction({ prompt: '雪山を背景に', image: { url, name: 'avatar.png', contentType: 'image/png' } });
  let generated = false;
  await createDrawHandler({
    config, logger,
    fetchImage: attachment => fetchReferenceImage(attachment, {
      fetchImpl: async requestedUrl => {
        assert.equal(requestedUrl, url);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      },
    }),
    generateImages: async args => {
      generated = true;
      assert.equal(args.model, 'gpt-image-2.5-sunburst');
      assert.equal(args.references.length, 1);
      const actualPixels = await sharp(args.references[0].data).raw().toBuffer();
      assert.deepEqual(actualPixels, await sharp(png).raw().toBuffer());
      return { images: [png.toString('base64')], usage: {} };
    },
  })(i);
  assert.equal(generated, true);
  assert.equal(i.replies.at(-1).files.length, 1);
});

test('/draw combines named profiles in option order and sends name-to-image labels with the edit request', async () => {
  const alice = [
    { ...saved, originalName: 'alice-front.png' },
    { ...saved, originalName: 'alice-back.png' },
  ];
  const bob = [{ ...saved, originalName: 'bob.png' }];
  const profiles = new Map([['Alice Smith', alice], ['Bob, Jr.', bob]]);
  const prompt = 'Alice Smith and Bob, Jr. are playing cards.';
  for (const values of [
    { reference: 'Alice Smith', reference2: 'Bob, Jr.' },
    { reference: 'Alice Smith', reference3: 'Bob, Jr.', image: { name: 'direct.png' }, model: 'flare' },
    { reference2: 'Bob, Jr.' },
    { reference8: 'Bob, Jr.' },
  ]) {
    const i = interaction({ prompt, ...values });
    const names = ['reference', 'reference2', 'reference3', 'reference8'].map(key => values[key]).filter(Boolean);
    const loaded = [];
    let apiCalls = 0;
    const expectedImages = [...(values.image ? [direct] : []), ...names.flatMap(name => profiles.get(name))];
    const { generateOpenAiImages } = await import('../src/image/openai.mjs');
    await createDrawHandler({ config, logger,
      referenceStore: { async loadImages(name) { loaded.push(name); return profiles.get(name); } },
      fetchImage: async () => direct,
      generateImages: args => {
        assert.deepEqual(args.references.map(image => image.originalName), expectedImages.map(image => image.originalName));
        return generateOpenAiImages({ ...args, fetchImpl: async (url, request) => {
          apiCalls++;
          assert.equal(url, config.OPENAI_IMAGE_EDITS_URL);
          const form = request.body;
          assert.equal(form.getAll('image[]').length, expectedImages.length);
          assert.equal(form.get('model'), `gpt-image-2.5-${values.model || 'sunburst'}`);
          if (names.length === 1) {
            assert.equal(form.get('prompt'), prompt);
          } else {
            const offset = values.image ? 1 : 0;
            assert.ok(form.get('prompt').includes(`Images ${1 + offset}-${2 + offset}: reference profile "Alice Smith".`));
            assert.ok(form.get('prompt').includes(`Image ${3 + offset}: reference profile "Bob, Jr.".`));
            if (values.image) assert.ok(form.get('prompt').includes('Image 1: directly attached image.'));
            assert.ok(form.get('prompt').endsWith(`User request:\n${prompt}`));
          }
          return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
        } });
      },
    })(i);
    assert.equal(apiCalls, 1);
    assert.deepEqual(loaded, names);
    assert.equal(i.replies.at(-1).files.length, 1);
    assert.ok(i.replies.at(-1).content.startsWith(`prompt: ${prompt}\n`));
    if (names.length > 1) assert.ok(i.replies.at(-1).content.includes('reference profiles: "Alice Smith" / "Bob, Jr."'));
    assert.deepEqual(i.replies.at(-1).allowedMentions, { parse: [] });
  }
});

test('/draw applies the eight-image cap across all profiles and the direct attachment before external calls', async () => {
  for (const { counts, image, accepted } of [
    { counts: [4, 4], image: false, accepted: true },
    { counts: [3, 4], image: true, accepted: true },
    { counts: [4, 4], image: true, accepted: false },
    { counts: Array(8).fill(1), image: false, accepted: true },
    { counts: Array(8).fill(1), image: true, accepted: false },
  ]) {
    const values = Object.fromEntries(counts.map((_, index) => [index ? `reference${index + 1}` : 'reference', `Person ${index}`]));
    const i = interaction({ prompt: 'Group photo', ...values, ...(image ? { image: {} } : {}) });
    let apiCalls = 0;
    let downloads = 0;
    await createDrawHandler({ config, logger,
      referenceStore: { async loadImages(name) { return Array(counts[Number(name.split(' ')[1])]).fill(saved); } },
      fetchImage: async () => { downloads++; return direct; },
      generateImages: async args => {
        apiCalls++;
        assert.equal(args.references.length, 8);
        return { images: [png.toString('base64')], usage: {} };
      },
    })(i);
    assert.equal(apiCalls, accepted ? 1 : 0);
    assert.equal(downloads, accepted && image ? 1 : 0);
    if (!accepted) assert.match(i.replies.at(-1).content, /最大8枚/);
  }
});

test('/draw aborts the whole request when a later profile is missing or corrupt', async () => {
  for (const failure of ['Reference profile not found', 'Stored reference image hash mismatch']) {
    const i = interaction({ prompt: 'Group photo', reference: 'Good', reference2: 'Bad', image: {} });
    const loaded = [];
    let externalCalls = 0;
    await createDrawHandler({ config, logger,
      referenceStore: { async loadImages(name) {
        loaded.push(name);
        if (name === 'Bad') throw new Error(failure);
        return [saved];
      } },
      fetchImage: async () => { externalCalls++; return direct; },
      generateImages: async () => { externalCalls++; },
    })(i);
    assert.deepEqual(loaded, ['Good', 'Bad']);
    assert.equal(externalCalls, 0);
    assert.ok(i.replies.at(-1).content.includes(failure));
  }
});

test('/draw keeps long multi-profile replies within the Discord message limit', async () => {
  const names = Array.from({ length: 8 }, (_, index) => `${index} ${'長い名前'.repeat(20)}`);
  const values = Object.fromEntries(names.map((name, index) => [index ? `reference${index + 1}` : 'reference', name]));
  const i = interaction({ prompt: 'Describe the group. '.repeat(200), ...values });
  await createDrawHandler({ config, logger,
    referenceStore: { async loadImages() { return [saved]; } },
    generateImages: async () => ({ images: [png.toString('base64')], usage: {} }),
  })(i);
  const reply = i.replies.at(-1);
  assert.equal(reply.files.length, 1);
  assert.ok(reply.content.length <= 2000);
  assert.match(reply.content, /reference profiles:/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('SD rejects all explicitly supplied OpenAI options including auto before downloading or generating', async () => {
  for (const provider of ['stable-diffusion', 'sd']) {
    for (const values of [
      { image: {} }, { reference: 'Akaya' },
      ...Array.from({ length: 7 }, (_, index) => ({ [`reference${index + 2}`]: 'Akaya' })),
      { model: 'auto' }, { model: 'flare' }, { model: 'sunburst' },
    ]) {
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
