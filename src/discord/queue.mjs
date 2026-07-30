import {
  LLM_MAX_HISTORY_MESSAGES_VALUE,
  LLM_PROVIDER_MODE,
  LLM_TEMPERATURE_VALUE,
  OPENAI_RESPONSES_ENABLED,
  WEB_SEARCH_MODE_VALUE,
} from '../config.mjs';
import { localLlmChat } from '../llm/chat.mjs';
import { resolveOpenAiWebSearchMode } from '../llm/openai-responses.mjs';
import { logEmptyLlmResponse, logLlmTimeout } from '../llm/diagnostics.mjs';
import {
  buildVisionImageContentPart,
  fetchImageForLlm,
  pickFirstImageAttachment,
} from './images.mjs';
import {
  fetchTextAttachmentForLlm,
  pickFirstTextAttachment,
} from './text-attachments.mjs';
import { getState, trimHistory } from './state.mjs';
import { startTypingLoop } from './typing.mjs';
import { splitForDiscord, stripInvisibleCharacters } from '../utils/text.mjs';
import {
  appendSourceUrls,
  buildWebChatMessages,
  buildWebSearchContext,
} from '../web/context.mjs';
import { decideAutoWebSearch } from '../web/router.mjs';
import {
  extractDirectUrls,
  stripUrlsFromText,
} from '../web/urls.mjs';

function formatAttachmentSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '';
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function buildHistoryUserChunk({ name, text, imageAtt, textAtt }) {
  const lines = [];
  if (text) {
    lines.push(`${name}: ${text}`);
  } else {
    lines.push(`${name}:`);
  }
  if (imageAtt) {
    lines.push(`[image attachment: ${imageAtt.name || 'image'}]`);
  }
  if (textAtt) {
    const sizeText = formatAttachmentSize(textAtt.size);
    lines.push(`[text attachment: ${textAtt.name || 'attachment'}${sizeText ? `, ${sizeText}` : ''}]`);
  }
  return lines.join('\n');
}

function buildUserMessageText({ name, text, textAttachment, fallbackText }) {
  const baseLine = text
    ? `${name}: ${text}`
    : `${name}: ${fallbackText || '添付内容を読んでください。'}`;

  if (!textAttachment?.text) return baseLine;

  const note = textAttachment.truncated
    ? ` [truncated from ${textAttachment.originalLength} chars]`
    : '';

  return [
    baseLine,
    '',
    `[Attached text file: ${textAttachment.name || 'attachment'}${note}]`,
    textAttachment.text,
  ].join('\n');
}

export async function processQueue(channelId) {
  const st = getState(channelId);
  if (st.processing) return;
  st.processing = true;

  try {
    while (st.queue.length > 0) {
      if (st.paused) {
        st.queue.length = 0;
        return;
      }

      const item = st.queue.shift();

      const api = (() => {
        if (item.kind === 'interaction') {
          const interaction = item.interaction;
          return {
            kind: 'interaction',
            channel: interaction.channel,
            typing: async () => {},
            replyFirst: async (replyText) => interaction.editReply(replyText),
            sendMore: async (replyText) => interaction.followUp(replyText),
            onError: async (message) => {
              try { await interaction.editReply(`⚠️ エラー: ${message}`); } catch {}
            },
          };
        }

        const msg = item.msg;
        return {
          kind: 'message',
          channel: msg.channel,
          typing: async () => msg.channel.sendTyping(),
          replyFirst: async (replyText) => msg.reply(replyText),
          sendMore: async (replyText) => msg.channel.send(replyText),
          onError: async (message) => {
            try { await msg.reply(`⚠️ エラー: ${message}`); } catch {}
          },
        };
      })();

      const name = item.name;
      const text = item.text || '';
      const directUrls = extractDirectUrls(text);
      let useWebSearch = !!item.webSearch;
      let webSearchQuery = directUrls.length ? stripUrlsFromText(text) : text;
      const normalChatOptions = LLM_PROVIDER_MODE === 'ollama'
        ? { reasoningEffort: 'none' }
        : {};

      const imageAtt =
        item.kind === 'interaction'
          ? (item.imageAtt || null)
          : pickFirstImageAttachment(item.msg);
      const textAtt =
        item.kind === 'interaction'
          ? null
          : pickFirstTextAttachment(item.msg);

      const stopTyping = startTypingLoop(api.typing);

      let messagesToSend = st.history;
      let replyResult = null;
      let sourceUrls = [];
      let userMessagePushed = false;
      let textAttachment = null;

      try {
        if (!text.trim() && !imageAtt && !textAtt) {
          await api.replyFirst('テキスト、画像、またはテキストファイルを送ってください。');
          continue;
        }

        const userChunkForHistory = buildHistoryUserChunk({
          name,
          text,
          imageAtt,
          textAtt,
        });

        st.history.push({ role: 'user', content: userChunkForHistory });
        userMessagePushed = true;
        trimHistory(st.history, LLM_MAX_HISTORY_MESSAGES_VALUE);

        if (textAtt) {
          const loaded = await fetchTextAttachmentForLlm(textAtt.url);
          textAttachment = {
            ...loaded,
            name: textAtt.name || 'attachment',
            size: textAtt.size,
          };
        }

        if (
          !OPENAI_RESPONSES_ENABLED
          && !useWebSearch
          && WEB_SEARCH_MODE_VALUE === 'auto'
          && !imageAtt
        ) {
          if (directUrls.length) {
            useWebSearch = true;
          } else {
            const route = await decideAutoWebSearch(st.history, name, text);
            useWebSearch = route.needsWebSearch;
            if (route.searchQuery) webSearchQuery = route.searchQuery;
          }
        }

        if (imageAtt) {
          const image = await fetchImageForLlm(imageAtt.url, imageAtt.contentType);
          const userTextForLlm = buildUserMessageText({
            name,
            text,
            textAttachment,
            fallbackText: 'この画像や添付内容について質問して',
          });

          const visionUserMessage = {
            role: 'user',
            content: [
              { type: 'text', text: userTextForLlm },
              buildVisionImageContentPart(image),
            ],
          };

          messagesToSend = [
            ...st.history.slice(0, -1),
            visionUserMessage,
          ];

          replyResult = await localLlmChat(messagesToSend, normalChatOptions);
        } else if (OPENAI_RESPONSES_ENABLED) {
          if (textAttachment) {
            messagesToSend = [
              ...st.history.slice(0, -1),
              {
                role: 'user',
                content: buildUserMessageText({
                  name,
                  text,
                  textAttachment,
                }),
              },
            ];
          }

          const openAiWebSearch = resolveOpenAiWebSearchMode({
            forceSearch: !!item.webSearch,
            configuredMode: WEB_SEARCH_MODE_VALUE,
          });
          replyResult = await localLlmChat(messagesToSend, {
            ...normalChatOptions,
            webSearch: openAiWebSearch,
          });
          sourceUrls = Array.isArray(replyResult?.sources) ? replyResult.sources : [];
          useWebSearch = !!replyResult?.usedWebSearch;
        } else if (useWebSearch) {
          const webContext = await buildWebSearchContext({
            query: webSearchQuery,
            directUrls,
          });
          sourceUrls = webContext.sources;
          messagesToSend = buildWebChatMessages(
            st.history,
            buildUserMessageText({
              name,
              text,
              textAttachment,
            }),
            webContext,
          );
          replyResult = await localLlmChat(messagesToSend, {
            ...normalChatOptions,
            temperature: LLM_TEMPERATURE_VALUE,
          });
        } else {
          if (textAttachment) {
            messagesToSend = [
              ...st.history.slice(0, -1),
              {
                role: 'user',
                content: buildUserMessageText({
                  name,
                  text,
                  textAttachment,
                }),
              },
            ];
          }
          replyResult = await localLlmChat(messagesToSend, normalChatOptions);
        }

        const normalizedReplyText = stripInvisibleCharacters(replyResult?.text || '').trim();
        if (!normalizedReplyText) {
          if (userMessagePushed && st.history[st.history.length - 1]?.role === 'user') {
            st.history.pop();
            userMessagePushed = false;
          }
          logEmptyLlmResponse({ item, useWebSearch, imageAtt, result: replyResult });
          await api.replyFirst('⚠️ モデルが空の応答を返しました。');
          continue;
        }
        const cleaned = appendSourceUrls(normalizedReplyText, sourceUrls);

        st.history.push({ role: 'assistant', content: cleaned });
        trimHistory(st.history, LLM_MAX_HISTORY_MESSAGES_VALUE);

        const parts = splitForDiscord(cleaned);
        await api.replyFirst(parts[0]);
        for (let i = 1; i < parts.length; i += 1) {
          await api.sendMore(parts[i]);
        }
      } catch (error) {
        if (userMessagePushed && st.history[st.history.length - 1]?.role === 'user') {
          st.history.pop();
        }
        logLlmTimeout({
          error,
          messages: messagesToSend,
          item,
          useWebSearch,
          imageAtt,
        });
        console.error(error);
        await api.onError(error?.message || String(error));
      } finally {
        stopTyping();
      }
    }
  } finally {
    st.processing = false;
  }
}
