import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAiResponsesPayload,
  convertChatMessagesForResponses,
  modelSupportsOpenAiReasoning,
  parseOpenAiResponsesResult,
  resolveOpenAiWebSearchMode,
} from '../src/llm/openai-responses.mjs';

test('convertChatMessagesForResponses converts vision content', () => {
  const converted = convertChatMessagesForResponses([
    { role: 'system', content: 'Be helpful.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ],
    },
  ]);

  assert.deepEqual(converted, [
    { role: 'system', content: 'Be helpful.' },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'What is this?' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc' },
      ],
    },
  ]);
});

test('buildOpenAiResponsesPayload leaves search disabled for normal manual chat', () => {
  const payload = buildOpenAiResponsesPayload(
    [{ role: 'user', content: 'hello' }],
    { model: 'gpt-5.4-nano', webSearch: 'off' },
  );

  assert.equal(payload.model, 'gpt-5.4-nano');
  assert.equal(payload.store, false);
  assert.equal(payload.tools, undefined);
  assert.equal(payload.tool_choice, undefined);
  assert.equal(payload.reasoning, undefined);
});

test('buildOpenAiResponsesPayload enables optional and required hosted search', () => {
  const auto = buildOpenAiResponsesPayload([], {
    model: 'gpt-5.4-nano',
    webSearch: 'auto',
  });
  assert.deepEqual(auto.tools, [{ type: 'web_search' }]);
  assert.equal(auto.tool_choice, 'auto');
  assert.deepEqual(auto.include, ['web_search_call.action.sources']);
  assert.deepEqual(auto.reasoning, { effort: 'low' });

  const required = buildOpenAiResponsesPayload([], {
    model: 'gpt-5.4-nano',
    webSearch: 'required',
  });
  assert.equal(required.tool_choice, 'required');
});

test('modelSupportsOpenAiReasoning excludes chat and search models', () => {
  assert.equal(modelSupportsOpenAiReasoning('gpt-5.4-nano'), true);
  assert.equal(modelSupportsOpenAiReasoning('gpt-5-nano'), true);
  assert.equal(modelSupportsOpenAiReasoning('chat-latest'), false);
  assert.equal(modelSupportsOpenAiReasoning('gpt-5-search-api'), false);
  assert.equal(modelSupportsOpenAiReasoning('gpt-4.1-mini'), false);
});

test('resolveOpenAiWebSearchMode preserves manual, auto, and forced search semantics', () => {
  assert.equal(resolveOpenAiWebSearchMode(), 'off');
  assert.equal(resolveOpenAiWebSearchMode({ configuredMode: 'auto' }), 'auto');
  assert.equal(resolveOpenAiWebSearchMode({ forceSearch: true }), 'required');
  assert.equal(
    resolveOpenAiWebSearchMode({ forceSearch: true, configuredMode: 'auto' }),
    'required',
  );
});

test('parseOpenAiResponsesResult extracts text, search state, and unique sources', () => {
  const result = parseOpenAiResponsesResult({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        action: {
          sources: [
            { url: 'https://example.com/a', title: 'Source A' },
            { url: 'https://example.com/b' },
          ],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Answer with citations.',
            annotations: [
              { type: 'url_citation', url: 'https://example.com/a', title: 'Duplicate A' },
              {
                type: 'url_citation',
                url_citation: { url: 'https://example.com/c', title: 'Source C' },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(result.text, 'Answer with citations.');
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.usedWebSearch, true);
  assert.deepEqual(result.sources, [
    { url: 'https://example.com/a', title: 'Duplicate A' },
    { url: 'https://example.com/c', title: 'Source C' },
    { url: 'https://example.com/b', title: 'https://example.com/b' },
  ]);
});
