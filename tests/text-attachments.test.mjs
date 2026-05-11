import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchTextAttachmentForLlm,
  pickFirstTextAttachment,
  readTextAttachment,
  TEXT_ATTACHMENT_MAX_CHARS,
} from '../src/discord/text-attachments.mjs';

test('readTextAttachment accepts supported mime types and extensions', () => {
  assert.deepEqual(
    readTextAttachment({
      url: 'https://example.com/message.txt',
      contentType: 'text/plain',
      size: 128,
      name: 'message.txt',
    }),
    {
      url: 'https://example.com/message.txt',
      contentType: 'text/plain',
      size: 128,
      name: 'message.txt',
    },
  );

  assert.equal(
    readTextAttachment({
      url: 'https://example.com/data.json',
      contentType: '',
      size: 64,
      name: 'data.json',
    })?.name,
    'data.json',
  );

  assert.equal(
    readTextAttachment({
      url: 'https://example.com/image.png',
      contentType: 'image/png',
      size: 64,
      name: 'image.png',
    }),
    null,
  );
});

test('pickFirstTextAttachment scans attachments and returns the first supported text file', () => {
  const msg = {
    attachments: new Map([
      ['1', { url: 'https://example.com/image.png', contentType: 'image/png', name: 'image.png' }],
      ['2', { url: 'https://example.com/message.txt', contentType: 'text/plain', name: 'message.txt', size: 77 }],
    ]),
  };

  assert.deepEqual(
    pickFirstTextAttachment(msg),
    {
      url: 'https://example.com/message.txt',
      contentType: 'text/plain',
      size: 77,
      name: 'message.txt',
    },
  );
});

test('fetchTextAttachmentForLlm decodes utf-8 text and truncates long content', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': '32' }),
    arrayBuffer: async () => new TextEncoder().encode(`\uFEFF${'a'.repeat(TEXT_ATTACHMENT_MAX_CHARS + 5)}`).buffer,
  });

  try {
    const result = await fetchTextAttachmentForLlm('https://example.com/message.txt');
    assert.equal(result.originalLength, TEXT_ATTACHMENT_MAX_CHARS + 5);
    assert.equal(result.truncated, true);
    assert.match(result.text, /^\s*a+/);
    assert.match(result.text, /\[Attachment truncated to first /);
  } finally {
    global.fetch = originalFetch;
  }
});
