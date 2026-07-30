import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSourceUrls } from '../src/web/context.mjs';

test('appendSourceUrls keeps links clickable without Discord previews', () => {
  assert.equal(
    appendSourceUrls('Answer.', [
      { title: 'Example', url: 'https://example.com/article' },
    ]),
    [
      'Answer.',
      '',
      'Sources:',
      '1. Example',
      '<https://example.com/article>',
    ].join('\n'),
  );
});
