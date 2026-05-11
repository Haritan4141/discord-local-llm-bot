import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEnvValue,
  parseEnvContent,
  parseEnvValue,
} from '../src/utils/env-file.mjs';

test('parseEnvValue handles plain, quoted, and JSON-encoded values', () => {
  assert.equal(parseEnvValue('hello'), 'hello');
  assert.equal(parseEnvValue('"hello"'), 'hello');
  assert.equal(parseEnvValue("'hello'"), 'hello');
  assert.equal(parseEnvValue('"line1\\nline2"'), 'line1\nline2');
  assert.equal(parseEnvValue('   spaced   '), 'spaced');
  assert.equal(parseEnvValue(''), '');
  assert.equal(parseEnvValue(undefined), '');
});

test('parseEnvContent extracts KEY=VALUE pairs in order', () => {
  const { values, orderedKeys } = parseEnvContent(
    [
      '# comment',
      'DISCORD_TOKEN=token-value',
      'CHANNEL_IDS=1,2,3',
      'SYSTEM_PROMPT="multi\\nline"',
      '',
      'EMPTY=',
      'bad line without equals',
    ].join('\n'),
  );

  assert.deepEqual(orderedKeys, ['DISCORD_TOKEN', 'CHANNEL_IDS', 'SYSTEM_PROMPT', 'EMPTY']);
  assert.equal(values.DISCORD_TOKEN, 'token-value');
  assert.equal(values.CHANNEL_IDS, '1,2,3');
  assert.equal(values.SYSTEM_PROMPT, 'multi\nline');
  assert.equal(values.EMPTY, '');
});

test('parseEnvContent tolerates CRLF line endings', () => {
  const { values } = parseEnvContent('FOO=bar\r\nBAZ=qux\r\n');
  assert.equal(values.FOO, 'bar');
  assert.equal(values.BAZ, 'qux');
});

test('formatEnvValue keeps simple values raw and quotes complex ones', () => {
  assert.equal(formatEnvValue('plain'), 'plain');
  assert.equal(formatEnvValue(''), '');
  assert.equal(formatEnvValue(null), '');
  // Quoted because it contains a newline.
  assert.equal(formatEnvValue('multi\nline'), JSON.stringify('multi\nline'));
  // Quoted because it contains '#'.
  assert.equal(formatEnvValue('a#b'), JSON.stringify('a#b'));
  // Quoted because of leading whitespace.
  assert.equal(formatEnvValue(' leading'), JSON.stringify(' leading'));
});

test('parseEnvValue and formatEnvValue round-trip plain values', () => {
  for (const value of ['hello', 'gemma3:12b', '30m', '0.4', '127.0.0.1']) {
    assert.equal(parseEnvValue(formatEnvValue(value)), value);
  }
});
