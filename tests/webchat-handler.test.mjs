import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the real command branch without importing bot.mjs, which logs in
// to Discord and starts services. Every interaction and queue call is mocked.
const source = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
const start = source.indexOf("    if (interaction.commandName === 'webchat') {");
const end = source.indexOf('\n  } catch (e) {', start);
assert.ok(start >= 0 && end > start, 'webchat command branch must exist');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const handleWebchat = new AsyncFunction(
  'interaction', 'st', 'OPENAI_RESPONSES_ENABLED', 'OLLAMA_WEB_API_KEY_VALUE', 'processQueue',
  source.slice(start, end),
);

async function run({ openAi = true, key, paused = false, message = '調べてください' } = {}) {
  const replies = [], processedChannels = [];
  let deferred = 0;
  const interaction = {
    commandName: 'webchat', channelId: 'test-channel',
    options: { getString: () => message },
    member: { displayName: 'テスト利用者' }, user: { username: 'test-user' },
    reply: async value => { replies.push(value); },
    deferReply: async () => { deferred++; },
    editReply: async () => { assert.fail('queue must not fail'); },
  };
  const state = { paused, queue: [] };
  await handleWebchat(interaction, state, openAi, key, async channelId => {
    processedChannels.push(channelId);
  });
  return { replies, processedChannels, deferred, queue: state.queue };
}

for (const [name, key] of [['absent', undefined], ['empty', ''], ['whitespace', '   ']]) {
  test(`OpenAI /webchat enqueues without an Ollama key (${name})`, async () => {
    const result = await run({ openAi: true, key });
    assert.deepEqual(result.replies, []);
    assert.equal(result.deferred, 1);
    assert.deepEqual(result.processedChannels, ['test-channel']);
    assert.equal(result.queue.length, 1);
    assert.equal(result.queue[0].webSearch, true);
    assert.equal(result.queue[0].text, '調べてください');
  });
}

test('non-OpenAI /webchat still requires an Ollama key', async () => {
  const result = await run({ openAi: false, key: '   ' });
  assert.match(result.replies[0], /OLLAMA_WEB_API_KEY/);
  assert.equal(result.deferred, 0);
  assert.equal(result.queue.length, 0);
  assert.deepEqual(result.processedChannels, []);
});

test('non-OpenAI /webchat enqueues with a configured Ollama key', async () => {
  const result = await run({ openAi: false, key: 'test-only-placeholder' });
  assert.deepEqual(result.replies, []);
  assert.equal(result.deferred, 1);
  assert.equal(result.queue.length, 1);
  assert.equal(result.queue[0].webSearch, true);
});

test('OpenAI /webchat still respects paused channels', async () => {
  const result = await run({ paused: true });
  assert.match(result.replies[0], /停止中/);
  assert.equal(result.deferred, 0);
  assert.equal(result.queue.length, 0);
});

test('OpenAI /webchat still rejects empty messages', async () => {
  const result = await run({ message: '  ' });
  assert.match(result.replies[0], /message:/);
  assert.equal(result.deferred, 0);
  assert.equal(result.queue.length, 0);
});
