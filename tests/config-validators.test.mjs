import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBotTimezone,
  resolveLlmMaxHistoryMessages,
  resolveLlmTemperature,
  resolveWebSearchMode,
} from '../src/config.mjs';

test('resolveLlmTemperature clamps invalid input to the default', () => {
  assert.equal(resolveLlmTemperature(undefined), 0.4);
  assert.equal(resolveLlmTemperature(''), 0.4);
  assert.equal(resolveLlmTemperature('not-a-number'), 0.4);
  assert.equal(resolveLlmTemperature('-1'), 0.4);
  assert.equal(resolveLlmTemperature('3'), 0.4);
});

test('resolveLlmTemperature accepts values in [0, 2]', () => {
  assert.equal(resolveLlmTemperature('0'), 0);
  assert.equal(resolveLlmTemperature('0.4'), 0.4);
  assert.equal(resolveLlmTemperature('1.2'), 1.2);
  assert.equal(resolveLlmTemperature('2'), 2);
});

test('resolveLlmMaxHistoryMessages requires a non-negative integer', () => {
  assert.equal(resolveLlmMaxHistoryMessages(undefined), 30);
  assert.equal(resolveLlmMaxHistoryMessages(''), 30);
  assert.equal(resolveLlmMaxHistoryMessages('-1'), 30);
  assert.equal(resolveLlmMaxHistoryMessages('1.5'), 30);
  assert.equal(resolveLlmMaxHistoryMessages('not-a-number'), 30);
  assert.equal(resolveLlmMaxHistoryMessages('0'), 0);
  assert.equal(resolveLlmMaxHistoryMessages('45'), 45);
});

test('resolveWebSearchMode only accepts auto', () => {
  assert.equal(resolveWebSearchMode(undefined), 'manual');
  assert.equal(resolveWebSearchMode(''), 'manual');
  assert.equal(resolveWebSearchMode('off'), 'manual');
  assert.equal(resolveWebSearchMode('AUTO'), 'auto');
  assert.equal(resolveWebSearchMode('auto'), 'auto');
});

test('resolveBotTimezone validates IANA names and falls back', () => {
  const warned = [];
  const logger = raw => warned.push(raw);
  assert.equal(resolveBotTimezone('', { logger }), 'Asia/Tokyo');
  assert.equal(resolveBotTimezone(undefined, { logger }), 'Asia/Tokyo');
  assert.equal(resolveBotTimezone('America/New_York', { logger }), 'America/New_York');
  assert.equal(resolveBotTimezone('Asia/Tokyo', { logger }), 'Asia/Tokyo');
  assert.equal(resolveBotTimezone('Not/A_Zone', { logger }), 'Asia/Tokyo');
  assert.ok(warned.includes('Not/A_Zone'), 'invalid timezone should trigger the warning callback');
});
