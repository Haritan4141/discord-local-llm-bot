import 'dotenv/config';

import { DISCORD_TOKEN_VALUE } from '../config.mjs';

const {
  STANDBY_CHANNEL_IDS,
  CHANNEL_IDS,
  STANDBY_REPLY_MESSAGE,
  STANDBY_REPLY_COOLDOWN_SECONDS,
} = process.env;

export const DEFAULT_STANDBY_REPLY_MESSAGE =
  '現在メイン Bot は停止中です。しばらくしてからもう一度試してください。';
export const DEFAULT_STANDBY_REPLY_COOLDOWN_SECONDS = 300;

export function resolveStandbyChannelIds(value, fallbackValue = '') {
  const raw = String(value ?? '').trim();
  const source = raw || String(fallbackValue ?? '').trim();
  return new Set(
    source
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  );
}

export function resolveStandbyReplyMessage(value) {
  const raw = String(value ?? '').trim();
  return raw || DEFAULT_STANDBY_REPLY_MESSAGE;
}

export function resolveStandbyReplyCooldownSeconds(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_STANDBY_REPLY_COOLDOWN_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_STANDBY_REPLY_COOLDOWN_SECONDS;
  }
  return parsed;
}

export const STANDBY_LOGIN_TOKEN_VALUE = String(DISCORD_TOKEN_VALUE || '').trim();
export const standbyAllowedChannelIds = resolveStandbyChannelIds(
  STANDBY_CHANNEL_IDS,
  CHANNEL_IDS,
);
export const STANDBY_REPLY_MESSAGE_VALUE = resolveStandbyReplyMessage(
  STANDBY_REPLY_MESSAGE,
);
export const STANDBY_REPLY_COOLDOWN_SECONDS_VALUE =
  resolveStandbyReplyCooldownSeconds(STANDBY_REPLY_COOLDOWN_SECONDS);

export function assertStandbyConfig() {
  if (!STANDBY_LOGIN_TOKEN_VALUE) {
    throw new Error('DISCORD_TOKEN を .env に設定してください');
  }
  if (standbyAllowedChannelIds.size === 0) {
    throw new Error(
      'STANDBY_CHANNEL_IDS または CHANNEL_IDS を .env に設定してください',
    );
  }
}
