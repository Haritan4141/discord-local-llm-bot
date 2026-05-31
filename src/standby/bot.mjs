import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
} from 'discord.js';

import {
  STANDBY_LOGIN_TOKEN_VALUE,
  STANDBY_REPLY_COOLDOWN_SECONDS_VALUE,
  STANDBY_REPLY_MESSAGE_VALUE,
  assertStandbyConfig,
  standbyAllowedChannelIds,
} from './config.mjs';

assertStandbyConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const replyCooldownMs = STANDBY_REPLY_COOLDOWN_SECONDS_VALUE * 1000;
const lastReplyAtByKey = new Map();

function cooldownKey(message) {
  return `${message.channelId}:${message.author.id}`;
}

function shouldReply(message) {
  if (replyCooldownMs <= 0) return true;
  const key = cooldownKey(message);
  const now = Date.now();
  const last = lastReplyAtByKey.get(key) || 0;
  if (now - last < replyCooldownMs) return false;
  lastReplyAtByKey.set(key, now);
  return true;
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Standby bot logged in as ${readyClient.user.tag}`);
  console.log(`Standby allowed channels: ${[...standbyAllowedChannelIds].join(', ')}`);
  console.log(`Standby cooldown seconds: ${STANDBY_REPLY_COOLDOWN_SECONDS_VALUE}`);
  console.log(`Standby reply message: ${JSON.stringify(STANDBY_REPLY_MESSAGE_VALUE)}`);
  try {
    await readyClient.user.setActivity('メイン Bot 停止中', {
      type: ActivityType.Watching,
    });
  } catch {}
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!standbyAllowedChannelIds.has(message.channelId)) return;
  if (!shouldReply(message)) return;

  try {
    await message.reply(STANDBY_REPLY_MESSAGE_VALUE);
  } catch (error) {
    console.error(error);
  }
});

client.login(STANDBY_LOGIN_TOKEN_VALUE);
