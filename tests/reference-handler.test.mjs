import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReferenceHandler } from '../src/discord/references.mjs';
import { createReferenceStore } from '../src/image/references.mjs';
import { fetchReferenceImage } from '../src/image/reference-images.mjs';
import { createDrawHandler } from '../src/discord/draw.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4//9/AwAJfAN+bOwQyQAAAABJRU5ErkJggg==', 'base64');
const logger = { error() {} };
function interaction(subcommand, values = {}) {
  const replies = [];
  const read = name => values[name] ?? null;
  return {
    replies,
    options: { getSubcommand: () => subcommand, getString: read, getBoolean: read, getAttachment: read },
    async deferReply() { this.deferred = true; },
    async editReply(reply) { replies.push(reply); },
    async followUp(reply) { replies.push(reply); },
  };
}

test('reference commands create one image, reject duplicate names, and explicitly replace with restart persistence', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'discord-reference-handler-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const fetchImage = async attachment => ({ data: png, mime: 'image/png', originalName: attachment.name });
  let handler = createReferenceHandler({ store: createReferenceStore({ rootDir }), fetchImage, logger });
  const run = async (command, values) => {
    const i = interaction(command, values);
    await handler(i);
    assert.equal(i.deferred, true);
    for (const reply of i.replies) {
      assert.ok(reply.content.length <= 2000);
      assert.deepEqual(reply.allowedMentions, { parse: [] });
    }
    return i.replies.map(reply => reply.content).join('\n');
  };
  assert.match(await run('list'), /ありません/);
  assert.match(await run('add', { name: 'Akaya', image: { name: 'a.png' } }), /name: Akaya.*slug: akaya.*登録枚数: 1.*現在総枚数: 1/);
  handler = createReferenceHandler({ store: createReferenceStore({ rootDir }), fetchImage, logger });
  assert.match(await run('list'), /Akaya.*akaya.*images: 1.*updatedAt:/);
  const detail = await run('show', { name: 'akaya' });
  assert.match(detail, /createdAt:.*\nupdatedAt:.*\nimage count: 1/);
  assert.match(detail, /filename:.*originalName: a.png.*size: \d+ bytes/);
  assert.match(await run('add', { name: 'akaya', image: { name: 'c.png' } }), /reference error:.*登録済み.*replace: true/);
  assert.match(await run('show', { name: 'akaya' }), /image count: 1[\s\S]*originalName: a.png/);
  assert.match(await run('add', { name: 'Akaya', image: { name: 'd.png' }, replace: true }), /置換完了.*現在総枚数: 1/);
  assert.match(await run('delete', { name: 'akaya' }), /削除完了/);
  assert.match(await run('show', { name: 'akaya' }), /reference error:/);
  assert.match(await run('delete', { name: 'akaya' }), /reference error:/);
  assert.match(await run('list'), /ありません/);
});

test('failed attachment fetch never mutates the existing profile', async () => {
  let writes = 0;
  const handler = createReferenceHandler({ store: { async add() { writes++; } }, logger,
    fetchImage: async attachment => { if (attachment.name === 'bad') throw new Error('png/jpeg/webp のみ'); return {}; },
  });
  const i = interaction('add', { name: 'Akaya', image: { name: 'bad' }, replace: true });
  await handler(i);
  assert.equal(writes, 0);
  assert.match(i.replies[0].content, /png\/jpeg\/webp/);
});

test('stale multi-attachment reference commands reject all extra slots before downloads or writes', async () => {
  for (const slot of ['image2', 'image3', 'image4']) {
    let fetches = 0, writes = 0;
    const i = interaction('add', { name: 'Akaya', image: { name: 'first.png' }, [slot]: { name: 'extra.png' }, replace: true });
    await createReferenceHandler({ logger, store: { async add() { writes++; } }, fetchImage: async () => { fetches++; return {}; } })(i);
    assert.equal(fetches, 0);
    assert.equal(writes, 0);
    assert.match(i.replies[0].content, /1枚.*image のみ/);
  }
});

test('/reference add persists an ephemeral slash-command attachment through the real downloader', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'discord-ephemeral-reference-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const url = 'https://cdn.discordapp.com/ephemeral-attachments/123/456/avatar.png?ex=abc&hm=signature';
  const i = interaction('add', { name: 'Avatar', image: { url, name: 'avatar.png', contentType: 'image/png', size: png.length } });
  await createReferenceHandler({
    store: createReferenceStore({ rootDir }), logger,
    fetchImage: attachment => fetchReferenceImage(attachment, {
      fetchImpl: async requestedUrl => {
        assert.equal(requestedUrl, url);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      },
    }),
  })(i);
  assert.match(i.replies.at(-1).content, /登録完了.*現在総枚数: 1/);
  const images = await createReferenceStore({ rootDir }).loadImages('Avatar');
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].data, png);
});

test('long reference lists are split without losing entries or triggering mentions', async () => {
  const profiles = Array.from({ length: 40 }, (_, index) => ({ displayName: `@everyone Profile ${index}`, slug: `profile-${index}`, images: [{}], updatedAt: '2026-09-13T00:00:00.000Z' }));
  const i = interaction('list');
  await createReferenceHandler({ store: { async list() { return profiles; } }, logger })(i);
  assert.ok(i.replies.length > 1);
  const combined = i.replies.map(reply => reply.content).join('');
  for (const profile of profiles) assert.ok(combined.includes(profile.displayName));
  for (const reply of i.replies) {
    assert.ok(reply.content.length <= 2000);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
  }
});

test('two saved single-image profiles reach draw as exactly two images with name labels', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'discord-single-reference-draw-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const store = createReferenceStore({ rootDir });
  for (const name of ['はりたん', 'ぽろあーく']) {
    await store.add(name, [{ data: png, mime: 'image/png', originalName: `${name}.png` }]);
  }
  const values = { prompt: 'はりたんとぽろあーくがトランプをしている', reference: 'はりたん', reference2: 'ぽろあーく' };
  const read = key => values[key] ?? null;
  const replies = [];
  let generated = 0;
  const i = { options: { getString: read, getInteger: read, getNumber: read, getAttachment: read },
    async deferReply() {}, async editReply(reply) { replies.push(reply); } };
  await createDrawHandler({
    config: { IMAGE_PROVIDER_MODE: 'openai', OPENAI_IMAGE_SIZE_VALUE: '1024x1024', OPENAI_IMAGE_QUALITY_VALUE: 'low',
      OPENAI_IMAGE_MODELS: { flare: 'test-flare', sunburst: 'test-sunburst' }, DISCORD_MAX_ATTACHMENT_BYTES: 1024 * 1024 },
    referenceStore: createReferenceStore({ rootDir }),
    logger: { log() {}, error(error) { throw error; } },
    fetchImage: async () => { throw new Error('Unexpected attachment download'); },
    generateImages: async args => {
      generated++;
      assert.equal(args.model, 'test-sunburst');
      assert.deepEqual(args.references.map(image => image.originalName), ['はりたん.png', 'ぽろあーく.png']);
      assert.match(args.prompt, /Image 1: reference profile "はりたん"/);
      assert.match(args.prompt, /Image 2: reference profile "ぽろあーく"/);
      return { images: [png.toString('base64')], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  })(i);
  assert.equal(generated, 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].files.length, 1);
  assert.match(replies[0].content, /references: 2/);
});
