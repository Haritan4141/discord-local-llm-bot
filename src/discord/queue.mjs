import {
  LLM_MAX_HISTORY_MESSAGES_VALUE,
  LLM_PROVIDER_MODE,
  LLM_TEMPERATURE_VALUE,
  WEB_SEARCH_MODE_VALUE,
} from '../config.mjs';
import { localLlmChat } from '../llm/chat.mjs';
import { logEmptyLlmResponse, logLlmTimeout } from '../llm/diagnostics.mjs';
import {
  buildVisionImageContentPart,
  fetchImageForLlm,
  pickFirstImageAttachment,
} from './images.mjs';
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
            replyFirst: async (text) => interaction.editReply(text),
            sendMore: async (text) => interaction.followUp(text),
            onError: async (msg) => {
              try { await interaction.editReply(`⚠️ エラー: ${msg}`); } catch {}
            },
          };
        }

        const msg = item.msg;
        return {
          kind: 'message',
          channel: msg.channel,
          typing: async () => msg.channel.sendTyping(),
          replyFirst: async (text) => msg.reply(text),
          sendMore: async (text) => msg.channel.send(text),
          onError: async (msgText) => {
            try { await msg.reply(`⚠️ エラー: ${msgText}`); } catch {}
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

      const stopTyping = startTypingLoop(api.typing);

      // Hoisted so the catch block can reference them after a throw.
      let messagesToSend = st.history;
      let replyResult = null;
      let sourceUrls = [];
      let userMessagePushed = false;

      try {
        const userChunkForHistory = imageAtt
          ? `[画像あり] ${name}: ${text || '(画像)'}`
          : `${name}: ${text}`;

        st.history.push({ role: 'user', content: userChunkForHistory });
        userMessagePushed = true;
        trimHistory(st.history, LLM_MAX_HISTORY_MESSAGES_VALUE);

        if (!useWebSearch && WEB_SEARCH_MODE_VALUE === 'auto' && !imageAtt) {
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

          const visionUserMessage = {
            role: 'user',
            content: [
              { type: 'text', text: `${name}: ${text || 'この画像について説明して'}` },
              buildVisionImageContentPart(image),
            ],
          };

          messagesToSend = [
            ...st.history.slice(0, -1),
            visionUserMessage,
          ];

          replyResult = await localLlmChat(messagesToSend, normalChatOptions);
        } else if (useWebSearch) {
          const webContext = await buildWebSearchContext({
            query: webSearchQuery,
            directUrls,
          });
          sourceUrls = webContext.sources;
          messagesToSend = buildWebChatMessages(st.history, name, text, webContext);
          replyResult = await localLlmChat(messagesToSend, {
            ...normalChatOptions,
            temperature: LLM_TEMPERATURE_VALUE,
          });
        } else {
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
        for (let i = 1; i < parts.length; i++) {
          await api.sendMore(parts[i]);
        }
      } catch (e) {
        if (userMessagePushed && st.history[st.history.length - 1]?.role === 'user') {
          st.history.pop();
        }
        logLlmTimeout({ error: e, messages: messagesToSend, item, useWebSearch, imageAtt });
        console.error(e);
        await api.onError(e?.message || String(e));
      } finally {
        stopTyping();
      }
    }
  } finally {
    st.processing = false;
  }
}
