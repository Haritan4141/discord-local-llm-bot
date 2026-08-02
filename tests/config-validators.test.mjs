import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBotTimezone,
  resolveLlmMaxHistoryMessages,
  resolveLlmTemperature,
  resolveImageProvider,
  resolveOpenAiImageQuality,
  resolveOpenAiWebSearchMaxSources,
  resolveOpenAiWebSearchMaxToolCalls,
  resolveWebSearchMode,
} from '../src/config.mjs';

test('resolveImageProvider accepts explicit providers and follows the OpenAI LLM default', () => {
  assert.equal(resolveImageProvider('openai'), 'openai');
  assert.equal(resolveImageProvider('stable-diffusion'), 'stable-diffusion');
  assert.equal(resolveImageProvider('SD'), 'stable-diffusion');
  assert.equal(resolveImageProvider('', { openAiLlm: true }), 'openai');
  assert.equal(resolveImageProvider('', { openAiLlm: false }), 'stable-diffusion');
  assert.equal(resolveImageProvider('unknown', { openAiLlm: true }), 'openai');
});

test('resolveOpenAiImageQuality accepts supported values and defaults to low', () => {
  assert.equal(resolveOpenAiImageQuality('AUTO'), 'auto');
  assert.equal(resolveOpenAiImageQuality('low'), 'low');
  assert.equal(resolveOpenAiImageQuality('medium'), 'medium');
  assert.equal(resolveOpenAiImageQuality('high'), 'high');
  assert.equal(resolveOpenAiImageQuality(''), 'low');
  assert.equal(resolveOpenAiImageQuality('ultra'), 'low');
});

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

test('resolveOpenAiWebSearchMaxToolCalls accepts 1 to 10 and defaults to 2', () => {
  assert.equal(resolveOpenAiWebSearchMaxToolCalls(undefined), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls(''), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('0'), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('1.5'), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('11'), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('1'), 1);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('2'), 2);
  assert.equal(resolveOpenAiWebSearchMaxToolCalls('10'), 10);
});

test('resolveOpenAiWebSearchMaxSources accepts 0 to 10 and defaults to 1', () => {
  assert.equal(resolveOpenAiWebSearchMaxSources(undefined), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources(''), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources('-1'), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources('1.5'), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources('11'), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources('0'), 0);
  assert.equal(resolveOpenAiWebSearchMaxSources('1'), 1);
  assert.equal(resolveOpenAiWebSearchMaxSources('10'), 10);
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
