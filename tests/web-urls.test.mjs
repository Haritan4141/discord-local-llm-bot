import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDirectUrls,
  isUsefulSearchQuery,
  normalizeDirectUrl,
  stripUrlsFromText,
} from '../src/web/urls.mjs';

test('normalizeDirectUrl strips wrapping angle brackets and trailing punctuation', () => {
  assert.equal(normalizeDirectUrl('<https://example.com/foo>'), 'https://example.com/foo');
  assert.equal(normalizeDirectUrl('https://example.com/foo.'), 'https://example.com/foo');
  assert.equal(normalizeDirectUrl('https://example.com/foo!?'), 'https://example.com/foo');
});

test('normalizeDirectUrl preserves balanced parentheses', () => {
  assert.equal(
    normalizeDirectUrl('https://ja.wikipedia.org/wiki/Foo_(bar)'),
    'https://ja.wikipedia.org/wiki/Foo_(bar)',
  );
  // Sentence-style trailing paren is removed when unbalanced.
  assert.equal(
    normalizeDirectUrl('https://example.com/foo)'),
    'https://example.com/foo',
  );
});

test('normalizeDirectUrl rejects non-http(s) protocols and garbage', () => {
  assert.equal(normalizeDirectUrl('ftp://example.com'), '');
  assert.equal(normalizeDirectUrl('not a url'), '');
  assert.equal(normalizeDirectUrl(''), '');
});

test('extractDirectUrls deduplicates and normalizes', () => {
  const urls = extractDirectUrls(
    'Check https://example.com and https://example.com again, plus <https://example.org/path>.',
  );
  assert.equal(urls.length, 2);
  assert.ok(urls.includes('https://example.com/'));
  assert.ok(urls.includes('https://example.org/path'));
});

test('stripUrlsFromText removes URLs and collapses whitespace', () => {
  assert.equal(
    stripUrlsFromText('look at https://example.com for info'),
    'look at for info',
  );
  assert.equal(stripUrlsFromText('no urls here'), 'no urls here');
});

test('isUsefulSearchQuery rejects generic / very short phrases', () => {
  assert.equal(isUsefulSearchQuery('内容'), false);
  assert.equal(isUsefulSearchQuery('要約'), false);
  assert.equal(isUsefulSearchQuery('このページの内容'), false);
  assert.equal(isUsefulSearchQuery('これ'), false);
  assert.equal(isUsefulSearchQuery('abc'), false);
});

test('isUsefulSearchQuery accepts real questions', () => {
  assert.equal(isUsefulSearchQuery('最新のニュース'), true);
  assert.equal(isUsefulSearchQuery('TypeScript 5 release notes'), true);
});
