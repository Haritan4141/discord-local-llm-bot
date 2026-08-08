import {
  MEMBER_CONTEXT_CACHE_TTL_MS_VALUE,
  MEMBER_CONTEXT_ENABLED_VALUE,
  MEMBER_CONTEXT_MAX_CHARS_VALUE,
  MEMBER_CONTEXT_MAX_MEMBERS_VALUE,
} from '../config.mjs';

const MENTION_PATTERN = /<@!?(\d{5,22})>/g;
const MEMBER_TOPIC_PATTERN = /(?:メンバー|ユーザー|参加者|住人|サーバー|オンライン|オフライン|誰|人(?:数|一覧)|この人|どんな人|いる人|名前|ニックネーム|表示名|在籍|参加|退出|不在|プロフィール|さん|くん|ちゃん|member|user|online|offline)/iu;
const ONLINE_TOPIC_PATTERN = /(?:オンライン|online|ログイン|在席|いる人)/iu;
const OFFLINE_TOPIC_PATTERN = /(?:オフライン|offline|不在|いない人)/iu;
const ACTIVE_STATUSES = new Set(['online', 'idle', 'dnd']);
const STATUS_LABELS = {
  online: 'online',
  idle: 'idle',
  dnd: 'do-not-disturb',
  offline: 'offline',
};

function cleanMemberText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMemberSearchText(value) {
  return cleanMemberText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/g, '');
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return Object.hasOwn(STATUS_LABELS, status) ? status : 'offline';
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = cleanMemberText(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

export function normalizeMemberRecord(member) {
  const user = member?.user || {};
  const id = cleanMemberText(member?.id || user.id);
  if (!id) return null;

  const username = cleanMemberText(user.username);
  const globalName = cleanMemberText(user.globalName);
  const nickname = cleanMemberText(member?.nickname);
  const displayName = cleanMemberText(
    member?.displayName || nickname || globalName || username || id,
  );

  return {
    id,
    username,
    globalName,
    nickname,
    displayName,
    bot: Boolean(user.bot),
    status: normalizeStatus(member?.presence?.status),
    aliases: uniqueStrings([displayName, nickname, globalName, username]),
  };
}

export function extractMentionedMemberIds(text) {
  const result = [];
  const seen = new Set();
  const value = String(text || '');
  for (const match of value.matchAll(MENTION_PATTERN)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function shouldInspectMemberMessage(text) {
  return extractMentionedMemberIds(text).length > 0 || MEMBER_TOPIC_PATTERN.test(String(text || ''));
}

function getGuildId(value) {
  return cleanMemberText(value?.guildId || value?.guild?.id);
}

function cacheFromGuild(guild, members) {
  const records = new Map();
  for (const member of members?.values?.() || members || []) {
    const record = normalizeMemberRecord(member);
    if (record) records.set(record.id, record);
  }

  return {
    guildId: cleanMemberText(guild?.id),
    guildName: cleanMemberText(guild?.name) || cleanMemberText(guild?.id),
    fetchedAt: Date.now(),
    lastEventAt: 0,
    members: records,
  };
}

function recordScore(record, normalizedText, mentionedIds) {
  if (mentionedIds.includes(record.id)) return 10_000;

  let score = 0;
  for (const alias of record.aliases || []) {
    const normalizedAlias = normalizeMemberSearchText(alias);
    if (normalizedAlias.length < 2) continue;
    if (!normalizedText.includes(normalizedAlias)) continue;
    score = Math.max(score, normalizedAlias.length);
  }
  return score;
}

function sortByDisplayName(records) {
  return [...records].sort((left, right) => (
    left.displayName.localeCompare(right.displayName, 'ja')
    || left.id.localeCompare(right.id)
  ));
}

function limitContextLines(lines, maxChars) {
  const limit = Math.max(800, Number(maxChars) || MEMBER_CONTEXT_MAX_CHARS_VALUE);
  const result = [];
  let length = 0;
  let truncated = false;

  for (const line of lines) {
    const separatorLength = result.length ? 1 : 0;
    if (length + separatorLength + line.length > limit) {
      truncated = true;
      break;
    }
    result.push(line);
    length += separatorLength + line.length;
  }

  if (truncated) {
    const marker = '… (member context truncated)';
    while (result.length && result.join('\n').length + marker.length + 1 > limit) {
      result.pop();
    }
    result.push(marker);
  }

  return result.join('\n');
}

export function buildMemberContext(cache, text, options = {}) {
  if (!cache?.members || !(cache.members instanceof Map)) return null;

  const rawText = String(text || '');
  const normalizedText = normalizeMemberSearchText(rawText);
  const mentionedIds = extractMentionedMemberIds(rawText);
  const allRecords = [...cache.members.values()];
  const humanRecords = allRecords.filter(record => !record.bot);
  const matched = allRecords
    .map(record => ({ record, score: recordScore(record, normalizedText, mentionedIds) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id));

  const hasTopic = shouldInspectMemberMessage(rawText);
  if (!hasTopic && matched.length === 0) return null;

  const maxMembers = Math.max(1, Number(options.maxMembers) || MEMBER_CONTEXT_MAX_MEMBERS_VALUE);
  const onlineQuery = ONLINE_TOPIC_PATTERN.test(rawText);
  const offlineQuery = OFFLINE_TOPIC_PATTERN.test(rawText);
  const topicRecords = offlineQuery
    ? humanRecords.filter(record => record.status === 'offline')
    : onlineQuery
      ? humanRecords.filter(record => ACTIVE_STATUSES.has(record.status))
      : humanRecords;

  const selected = matched.length
    ? matched.slice(0, maxMembers).map(item => item.record)
    : sortByDisplayName(topicRecords).slice(0, maxMembers);
  const activeCount = humanRecords.filter(record => ACTIVE_STATUSES.has(record.status)).length;
  const reason = matched.length ? 'name-or-mention-match' : 'member-topic';
  const fetchedAt = Number.isFinite(cache.fetchedAt) ? new Date(cache.fetchedAt).toISOString() : 'unknown';

  const lines = [
    '[Discord server member context]',
    `Server: ${cache.guildName || cache.guildId || 'unknown'}`,
    `Fetched at: ${fetchedAt}`,
    `Human member count: ${humanRecords.length}`,
    `Active member count: ${activeCount}`,
    `Included member records: ${selected.length}`,
    `Lookup reason: ${reason}`,
    'Use only the member records below for claims about server members. Do not invent names, roles, presence, or other details that are not listed.',
  ];

  for (const record of selected) {
    const fields = [
      `display_name=${record.displayName || record.id}`,
      record.username && `username=${record.username}`,
      record.globalName && record.globalName !== record.displayName && `global_name=${record.globalName}`,
      `status=${STATUS_LABELS[record.status] || 'offline'}`,
      record.bot ? 'bot=true' : 'bot=false',
    ].filter(Boolean);
    lines.push(`- ${fields.join('; ')}`);
  }

  return {
    prompt: limitContextLines(lines, options.maxChars),
    guildId: cache.guildId,
    matchedCount: matched.length,
    selectedCount: selected.length,
    totalCount: humanRecords.length,
    activeCount,
    reason,
  };
}

export function createMemberDirectory(options = {}) {
  const enabled = options.enabled ?? MEMBER_CONTEXT_ENABLED_VALUE;
  const cacheTtlMs = Math.max(30_000, Number(options.cacheTtlMs) || MEMBER_CONTEXT_CACHE_TTL_MS_VALUE);
  const maxMembers = Math.max(1, Number(options.maxMembers) || MEMBER_CONTEXT_MAX_MEMBERS_VALUE);
  const maxChars = Math.max(800, Number(options.maxChars) || MEMBER_CONTEXT_MAX_CHARS_VALUE);
  const cacheByGuildId = new Map();
  const pendingByGuildId = new Map();

  async function refreshGuild(guild, { force = false } = {}) {
    if (!enabled || !guild?.id || typeof guild?.members?.fetch !== 'function') return null;
    const guildId = String(guild.id);
    const current = cacheByGuildId.get(guildId);
    if (!force && current && Date.now() - current.fetchedAt < cacheTtlMs) return current;
    if (pendingByGuildId.has(guildId)) return pendingByGuildId.get(guildId);

    const promise = (async () => {
      let members;
      try {
        members = await guild.members.fetch({ withPresences: true });
      } catch (presenceError) {
        console.warn(`[members] presence fetch failed for guild=${guildId}; retrying without presences: ${presenceError?.message || presenceError}`);
        members = await guild.members.fetch();
      }

      const next = cacheFromGuild(guild, members);
      cacheByGuildId.set(guildId, next);
      console.log(`[members] cached guild=${guildId} members=${next.members.size}`);
      return next;
    })().catch(error => {
      console.warn(`[members] failed to fetch guild=${guildId}: ${error?.message || error}`);
      throw error;
    }).finally(() => {
      pendingByGuildId.delete(guildId);
    });

    pendingByGuildId.set(guildId, promise);
    return promise;
  }

  async function warmGuilds(client, allowedChannelIds) {
    if (!enabled || !client?.guilds?.cache) return { guildCount: 0, memberCount: 0 };
    const channelIds = new Set([...allowedChannelIds || []].map(String));
    const guilds = [...client.guilds.cache.values()].filter(guild => (
      [...guild.channels?.cache?.keys?.() || []].some(channelId => channelIds.has(String(channelId)))
    ));
    const results = await Promise.allSettled(guilds.map(guild => refreshGuild(guild, { force: true })));
    const successful = results
      .map(result => result.status === 'fulfilled' ? result.value : null)
      .filter(Boolean);
    return {
      guildCount: successful.length,
      memberCount: successful.reduce((total, cache) => total + cache.members.size, 0),
    };
  }

  function upsertMember(member) {
    const guildId = getGuildId(member);
    const cache = cacheByGuildId.get(guildId);
    const record = normalizeMemberRecord(member);
    if (!cache || !record) return false;
    const previous = cache.members.get(record.id);
    if (previous && !member?.presence) record.status = previous.status;
    cache.members.set(record.id, record);
    cache.lastEventAt = Date.now();
    return true;
  }

  function removeMember(member) {
    const guildId = getGuildId(member);
    const memberId = cleanMemberText(member?.id || member?.user?.id);
    const cache = cacheByGuildId.get(guildId);
    if (!cache || !memberId) return false;
    const removed = cache.members.delete(memberId);
    cache.lastEventAt = Date.now();
    return removed;
  }

  function updatePresence(presence) {
    const guildId = getGuildId(presence);
    const memberId = cleanMemberText(presence?.userId || presence?.user?.id);
    const cache = cacheByGuildId.get(guildId);
    const record = cache?.members.get(memberId);
    if (!record) return false;
    record.status = normalizeStatus(presence?.status);
    cache.lastEventAt = Date.now();
    return true;
  }

  async function getContextForMessage({ guild, text } = {}) {
    if (!enabled || !guild?.id) return null;
    const guildId = String(guild.id);
    let cache = cacheByGuildId.get(guildId);

    if (!cache) {
      try {
        cache = await refreshGuild(guild, { force: true });
      } catch {
        return null;
      }
    } else if (Date.now() - cache.fetchedAt >= cacheTtlMs && !pendingByGuildId.has(guildId)) {
      void refreshGuild(guild, { force: true }).catch(() => {});
    }

    return buildMemberContext(cache, text, { maxMembers, maxChars });
  }

  function clear() {
    cacheByGuildId.clear();
    pendingByGuildId.clear();
  }

  return {
    enabled: Boolean(enabled),
    refreshGuild,
    warmGuilds,
    upsertMember,
    removeMember,
    updatePresence,
    getContextForMessage,
    clear,
    getCache: guildId => cacheByGuildId.get(String(guildId)) || null,
  };
}

export const memberDirectory = createMemberDirectory();
