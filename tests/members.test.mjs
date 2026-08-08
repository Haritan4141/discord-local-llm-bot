import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemberContext,
  createMemberDirectory,
  extractMentionedMemberIds,
  normalizeMemberRecord,
  normalizeMemberSearchText,
  shouldInspectMemberMessage,
} from '../src/discord/members.mjs';

function makeMember({
  id,
  username,
  globalName = username,
  nickname = '',
  status = 'offline',
  bot = false,
} = {}) {
  return {
    id,
    nickname,
    displayName: nickname || globalName || username,
    user: { id, username, globalName, bot },
    presence: { status },
  };
}

function makeCache(members) {
  return {
    guildId: 'guild-1',
    guildName: 'Test Server',
    fetchedAt: Date.now(),
    members: new Map(members.map(member => [member.id, normalizeMemberRecord(member)])),
  };
}

test('member names and Discord mentions are normalized for lookup', () => {
  assert.equal(normalizeMemberSearchText(' Ａｌｉｃｅ  さん '), 'aliceさん');
  assert.deepEqual(extractMentionedMemberIds('<@123456789012345678> <@!234567890123456789>'), [
    '123456789012345678',
    '234567890123456789',
  ]);
  assert.equal(shouldInspectMemberMessage('オンラインのメンバーは？'), true);
  assert.equal(shouldInspectMemberMessage('今日は天気の話です'), false);
});

test('buildMemberContext selects a matching member and includes presence', () => {
  const cache = makeCache([
    makeMember({ id: '123456789012345678', username: 'alice', globalName: 'Alice', nickname: 'アリス', status: 'online' }),
    makeMember({ id: '234567890123456789', username: 'bob', globalName: 'Bob', status: 'offline' }),
  ]);

  const result = buildMemberContext(cache, 'アリスさんは今いる？');

  assert.equal(result.matchedCount, 1);
  assert.equal(result.selectedCount, 1);
  assert.match(result.prompt, /display_name=アリス/);
  assert.match(result.prompt, /username=alice/);
  assert.match(result.prompt, /status=online/);
  assert.doesNotMatch(result.prompt, /username=bob/);
});

test('buildMemberContext filters topic queries by active presence and caps output', () => {
  const cache = makeCache([
    makeMember({ id: '123456789012345678', username: 'alice', status: 'online' }),
    makeMember({ id: '234567890123456789', username: 'bob', status: 'offline' }),
    makeMember({ id: '345678901234567890', username: 'carol', status: 'idle' }),
    makeMember({ id: '456789012345678901', username: 'helper-bot', status: 'online', bot: true }),
  ]);

  const result = buildMemberContext(cache, 'オンラインのメンバー一覧を教えて', {
    maxMembers: 10,
    maxChars: 2000,
  });

  assert.equal(result.selectedCount, 2);
  assert.match(result.prompt, /username=alice/);
  assert.match(result.prompt, /username=carol/);
  assert.doesNotMatch(result.prompt, /username=bob/);
  assert.doesNotMatch(result.prompt, /helper-bot/);

  const capped = buildMemberContext(cache, 'メンバー一覧を教えて', { maxMembers: 1, maxChars: 800 });
  assert.equal(capped.selectedCount, 1);
  assert.ok(capped.prompt.length <= 800);
});

test('buildMemberContext ignores unrelated messages', () => {
  const cache = makeCache([
    makeMember({ id: '123456789012345678', username: 'alice' }),
  ]);
  assert.equal(buildMemberContext(cache, '今日は天気の話です'), null);
});

test('member directory lazily fetches once and updates events', async () => {
  const alice = makeMember({ id: '123456789012345678', username: 'alice', status: 'offline' });
  let fetchCount = 0;
  const guild = {
    id: 'guild-1',
    name: 'Test Server',
    members: {
      fetch: async options => {
        fetchCount += 1;
        assert.deepEqual(options, { withPresences: true });
        return new Map([[alice.id, alice]]);
      },
    },
  };
  const directory = createMemberDirectory({ cacheTtlMs: 60_000, maxMembers: 10, maxChars: 2000 });

  assert.equal(await directory.getContextForMessage({ guild, text: '今日は天気の話です' }), null);
  const first = await directory.getContextForMessage({ guild, text: 'aliceさんについて教えて' });
  assert.ok(first);
  assert.equal(fetchCount, 1);

  directory.updatePresence({ guildId: guild.id, userId: alice.id, status: 'online' });
  const online = await directory.getContextForMessage({ guild, text: 'aliceさんはオンライン？' });
  assert.match(online.prompt, /status=online/);

  directory.removeMember({ guildId: guild.id, id: alice.id });
  assert.equal(directory.getCache(guild.id).members.size, 0);
});
