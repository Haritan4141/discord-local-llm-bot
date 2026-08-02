import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAiImagePayload,
  formatOpenAiImageCompletion,
  generateOpenAiImages,
  parseOpenAiImageResult,
  resolveOpenAiImageSize,
  validateOpenAiImageDimensions,
} from '../src/image/openai.mjs';

test('formatOpenAiImageCompletion shows the prompt above generation details', () => {
  assert.equal(
    formatOpenAiImageCompletion({
      prompt: '  ポチ  ',
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'low',
      imageCount: 1,
    }),
    [
      'prompt: ポチ',
      '生成完了 | provider: OpenAI | model: gpt-image-2 | size: 1024x1024 | quality: low | images: 1',
    ].join('\n'),
  );
});

test('validateOpenAiImageDimensions follows gpt-image-2 constraints', () => {
  assert.equal(validateOpenAiImageDimensions(1024, 1024), true);
  assert.equal(validateOpenAiImageDimensions(1536, 1024), true);
  assert.equal(validateOpenAiImageDimensions(3840, 2160), true);
  assert.equal(validateOpenAiImageDimensions(512, 512), false);
  assert.equal(validateOpenAiImageDimensions(1025, 1024), false);
  assert.equal(validateOpenAiImageDimensions(3840, 1024), false);
  assert.equal(validateOpenAiImageDimensions(4096, 2048), false);
});

test('resolveOpenAiImageSize uses configured defaults and command overrides', () => {
  assert.equal(resolveOpenAiImageSize(), '1024x1024');
  assert.equal(resolveOpenAiImageSize({ configuredSize: '1536x1024' }), '1536x1024');
  assert.equal(
    resolveOpenAiImageSize({ width: 1024, height: 1536, configuredSize: '1024x1024' }),
    '1024x1536',
  );
  assert.throws(
    () => resolveOpenAiImageSize({ width: 512, height: 512 }),
    /サイズ 512x512 は未対応/,
  );
});

test('buildOpenAiImagePayload creates a direct Image API request', () => {
  assert.deepEqual(
    buildOpenAiImagePayload({
      model: 'gpt-image-2',
      prompt: '月面の白い猫',
      size: '1024x1024',
      quality: 'low',
      count: 2,
    }),
    {
      model: 'gpt-image-2',
      prompt: '月面の白い猫',
      n: 2,
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
    },
  );
});

test('parseOpenAiImageResult extracts images and token usage', () => {
  assert.deepEqual(
    parseOpenAiImageResult({
      data: [
        { b64_json: 'image-one', revised_prompt: 'first' },
        { b64_json: 'image-two', revised_prompt: 'second' },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 34,
        total_tokens: 46,
        input_tokens_details: { text_tokens: 12, image_tokens: 0 },
      },
    }),
    {
      images: ['image-one', 'image-two'],
      revisedPrompts: ['first', 'second'],
      usage: {
        inputTokens: 12,
        inputTextTokens: 12,
        inputImageTokens: 0,
        outputTokens: 34,
        totalTokens: 46,
      },
    },
  );
});

test('generateOpenAiImages posts to the Image API with bearer authentication', async t => {
  const originalFetch = globalThis.fetch;
  let request = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: 'generated-image' }] }),
    };
  };

  const result = await generateOpenAiImages({
    url: 'https://api.openai.com/v1/images/generations',
    apiKey: 'test-key',
    model: 'gpt-image-2',
    prompt: '白い猫',
    size: '1024x1024',
    quality: 'low',
    count: 1,
  });

  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(request.options.body).model, 'gpt-image-2');
  assert.deepEqual(result.images, ['generated-image']);
});
