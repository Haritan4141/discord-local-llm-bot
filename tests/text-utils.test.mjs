import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitForDiscord,
  stripInvisibleCharacters,
  truncateText,
} from '../src/utils/text.mjs';

test('truncateText collapses whitespace and trims', () => {
  assert.equal(truncateText('  hello   world  '), 'hello world');
  assert.equal(truncateText(''), '');
  assert.equal(truncateText(null), '');
});

test('truncateText appends ellipsis when over the limit', () => {
  const long = 'abcdefghij';
  assert.equal(truncateText(long, 5), 'abcde…');
  assert.equal(truncateText(long, 10), 'abcdefghij');
  assert.equal(truncateText(long, 100), 'abcdefghij');
});

test('stripInvisibleCharacters removes BOM and zero-width chars', () => {
  const dirty = '﻿hello​world‍!⁠';
  assert.equal(stripInvisibleCharacters(dirty), 'helloworld!');
  assert.equal(stripInvisibleCharacters(''), '');
});

test('splitForDiscord chunks long strings to ~chunkSize', () => {
  const text = 'x'.repeat(4100);
  const chunks = splitForDiscord(text, 1800);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1800);
  assert.equal(chunks[1].length, 1800);
  assert.equal(chunks[2].length, 500);
  assert.equal(chunks.join(''), text);
});

test('splitForDiscord returns ["(empty)"] for empty input', () => {
  assert.deepEqual(splitForDiscord(''), ['(empty)']);
});
