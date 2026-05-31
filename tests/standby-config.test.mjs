import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STANDBY_REPLY_MESSAGE,
  resolveStandbyChannelIds,
  resolveStandbyReplyCooldownSeconds,
  resolveStandbyReplyMessage,
} from '../src/standby/config.mjs';

test('resolveStandbyChannelIds uses explicit ids or falls back to CHANNEL_IDS', () => {
  assert.deepEqual(
    [...resolveStandbyChannelIds('111, 222', '333')],
    ['111', '222'],
  );
  assert.deepEqual(
    [...resolveStandbyChannelIds('', '333,444')],
    ['333', '444'],
  );
});

test('resolveStandbyReplyMessage falls back to the default', () => {
  assert.equal(resolveStandbyReplyMessage(''), DEFAULT_STANDBY_REPLY_MESSAGE);
  assert.equal(
    resolveStandbyReplyMessage('ただいま停止中です。'),
    'ただいま停止中です。',
  );
});

test('resolveStandbyReplyCooldownSeconds validates integer seconds', () => {
  assert.equal(resolveStandbyReplyCooldownSeconds(undefined), 300);
  assert.equal(resolveStandbyReplyCooldownSeconds(''), 300);
  assert.equal(resolveStandbyReplyCooldownSeconds('-1'), 300);
  assert.equal(resolveStandbyReplyCooldownSeconds('1.5'), 300);
  assert.equal(resolveStandbyReplyCooldownSeconds('0'), 0);
  assert.equal(resolveStandbyReplyCooldownSeconds('120'), 120);
});
