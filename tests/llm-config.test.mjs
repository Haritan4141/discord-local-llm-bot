import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLlmBaseUrl,
  isOpenAiApiProvider,
  normalizeOpenAiBaseUrl,
  nativeOllamaBaseUrl,
  numEnv,
  normalizeOllamaKeepAliveForApi,
} from '../src/utils/llm-config.mjs';

test('defaultLlmBaseUrl returns the official local endpoints', () => {
  assert.equal(defaultLlmBaseUrl('openai'), 'https://api.openai.com/v1');
  assert.equal(defaultLlmBaseUrl('ollama'), 'http://127.0.0.1:11434/v1');
  assert.equal(defaultLlmBaseUrl('lmstudio'), 'http://127.0.0.1:1234/v1');
  assert.equal(defaultLlmBaseUrl('custom'), '');
  assert.equal(defaultLlmBaseUrl(undefined), '');
});

test('isOpenAiApiProvider recognizes the provider and official API host', () => {
  assert.equal(isOpenAiApiProvider('openai', ''), true);
  assert.equal(isOpenAiApiProvider('custom', 'https://api.openai.com/v1'), true);
  assert.equal(isOpenAiApiProvider('custom', 'https://API.OPENAI.COM/v1/'), true);
  assert.equal(isOpenAiApiProvider('custom', 'http://api.openai.com/v1'), false);
  assert.equal(isOpenAiApiProvider('custom', 'https://example.com/v1'), false);
  assert.equal(isOpenAiApiProvider('ollama', 'http://127.0.0.1:11434/v1'), false);
});

test('normalizeOpenAiBaseUrl strips trailing slashes and /chat/completions', () => {
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1/chat/completions'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeOpenAiBaseUrl('   http://x/v1   '), 'http://x/v1');
  assert.equal(normalizeOpenAiBaseUrl(undefined), '');
});

test('nativeOllamaBaseUrl strips /v1 suffix', () => {
  assert.equal(nativeOllamaBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434');
  assert.equal(nativeOllamaBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(nativeOllamaBaseUrl('http://x/v1/'), 'http://x');
});

test('numEnv treats undefined / null / empty string as missing', () => {
  assert.equal(numEnv(undefined, 7), 7);
  assert.equal(numEnv(null, 7), 7);
  assert.equal(numEnv('', 7), 7);
  assert.equal(numEnv('   ', 7), 7);
  assert.equal(numEnv('not-a-number', 7), 7);
});

test('numEnv parses numeric strings', () => {
  assert.equal(numEnv('42', 1), 42);
  assert.equal(numEnv('0', 1), 0);
  assert.equal(numEnv('-3.5', 1), -3.5);
  assert.equal(numEnv(' 12 ', 0), 12);
});

test('normalizeOllamaKeepAliveForApi returns numbers for integer strings', () => {
  assert.equal(normalizeOllamaKeepAliveForApi('30m'), '30m');
  assert.equal(normalizeOllamaKeepAliveForApi('1h'), '1h');
  assert.equal(normalizeOllamaKeepAliveForApi('3600'), 3600);
  assert.equal(normalizeOllamaKeepAliveForApi('-1'), -1);
  assert.equal(normalizeOllamaKeepAliveForApi(''), null);
  assert.equal(normalizeOllamaKeepAliveForApi('   '), null);
});
