import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReferenceHandler } from '../src/discord/references.mjs';
import { createReferenceStore } from '../src/image/references.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
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

test('reference commands add/append/replace/list/show/delete with restart persistence', async t => {
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
  assert.match(await run('add', { name: 'Akaya', image: { name: 'a.png' }, image2: { name: 'b.png' } }), /name: Akaya.*slug: akaya.*登録枚数: 2.*現在総枚数: 2/);
  handler = createReferenceHandler({ store: createReferenceStore({ rootDir }), fetchImage, logger });
  assert.match(await run('list'), /Akaya.*akaya.*images: 2.*updatedAt:/);
  const detail = await run('show', { name: 'akaya' });
  assert.match(detail, /createdAt:.*\nupdatedAt:.*\nimage count: 2/);
  assert.match(detail, /filename:.*originalName: a.png.*size: \d+ bytes/);
  assert.match(await run('add', { name: 'akaya', image: { name: 'c.png' } }), /現在総枚数: 3/);
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
  const i = interaction('add', { name: 'Akaya', image: { name: 'good' }, image2: { name: 'bad' }, replace: true });
  await handler(i);
  assert.equal(writes, 0);
  assert.match(i.replies[0].content, /png\/jpeg\/webp/);
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
