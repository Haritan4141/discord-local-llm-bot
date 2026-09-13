import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from 'discord.js';

import {
  BOT_TIMEZONE,
  DISCORD_TOKEN_VALUE,
  IMAGE_PROVIDER_MODE,
  LLM_BASE_URL_RESOLVED,
  LLM_MAX_HISTORY_MESSAGES_VALUE,
  LLM_MODEL_NAME,
  LLM_PROVIDER_MODE,
  LLM_TEMPERATURE_VALUE,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_WEB_API_KEY_VALUE,
  OPENAI_WEB_SEARCH_MAX_SOURCES_VALUE,
  OPENAI_WEB_SEARCH_MAX_TOOL_CALLS_VALUE,
  OPENAI_RESPONSES_ENABLED,
  OPENAI_IMAGE_MODELS,
  OPENAI_IMAGE_QUALITY_VALUE,
  OPENAI_IMAGE_SIZE_VALUE,
  OPENAI_IMAGE_REFERENCE_MAX_EDGE_VALUE,
  MEMBER_CONTEXT_CACHE_TTL_SECONDS_VALUE,
  MEMBER_CONTEXT_ENABLED_VALUE,
  MEMBER_CONTEXT_MAX_CHARS_VALUE,
  MEMBER_CONTEXT_MAX_MEMBERS_VALUE,
  SYSTEM_PROMPT_VALUE,
  WEB_SEARCH_MODE_VALUE,
  allowedChannelIds,
  assertRuntimeConfig,
} from './config.mjs';
import { preloadOllamaModel } from './llm/chat.mjs';
import { getState, stateByChannel } from './discord/state.mjs';
import { processQueue } from './discord/queue.mjs';
import { memberDirectory } from './discord/members.mjs';
import { pickImageFromInteraction } from './discord/images.mjs';
import { createDrawHandler } from './discord/draw.mjs';
import { createReferenceHandler } from './discord/references.mjs';
import { createReferenceStore } from './image/references.mjs';
import { musicJobs, musicSettings } from './music/queue.mjs';
import { createMusicHandler } from './discord/music.mjs';
import { OthelloService } from './othello/game.mjs';

assertRuntimeConfig();
const handleMusic = createMusicHandler({ jobs: musicJobs, settings: musicSettings });

const referenceStore = createReferenceStore();
const handleDraw = createDrawHandler({ referenceStore });
const handleReference = createReferenceHandler({ store: referenceStore });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Receive deletion events even if a long-running game's message was evicted.
  partials: [Partials.Message, Partials.Channel],
});

const othello = new OthelloService({ isAllowedChannel: id => allowedChannelIds.has(id) });

client.on(Events.MessageDelete, message => othello.removeMessage(message.id));
client.on(Events.MessageBulkDelete, messages => {
  for (const id of messages.keys()) othello.removeMessage(id);
});
client.on(Events.ChannelDelete, channel => othello.removeChannel(channel.id));
client.on(Events.ThreadDelete, thread => othello.removeChannel(thread.id));
client.on(Events.GuildDelete, guild => othello.removeGuild(guild.id));

const SYSTEM_PROMPT_OVERRIDE_MARKER = '--- system prompt override ---';
const LEGACY_PERSONA_OVERRIDE_MARKER = '--- persona override ---';

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Allowed channels: ${[...allowedChannelIds].join(', ')}`);
  console.log(`✅ LLM provider: ${LLM_PROVIDER_MODE}`);
  console.log(`✅ LLM base URL: ${LLM_BASE_URL_RESOLVED}`);
  console.log(`✅ Model: ${LLM_MODEL_NAME}`);
  console.log(`✅ LLM temperature: ${LLM_TEMPERATURE_VALUE}`);
  console.log(`✅ LLM max history messages: ${LLM_MAX_HISTORY_MESSAGES_VALUE}`);
  console.log(`✅ Web search mode: ${WEB_SEARCH_MODE_VALUE}`);
  console.log(`✅ Member context enabled: ${MEMBER_CONTEXT_ENABLED_VALUE}`);
  if (MEMBER_CONTEXT_ENABLED_VALUE) {
    console.log(`✅ Member cache TTL: ${MEMBER_CONTEXT_CACHE_TTL_SECONDS_VALUE}s`);
    console.log(`✅ Member context max members: ${MEMBER_CONTEXT_MAX_MEMBERS_VALUE}`);
    console.log(`✅ Member context max chars: ${MEMBER_CONTEXT_MAX_CHARS_VALUE}`);
    void memberDirectory.warmGuilds(readyClient, allowedChannelIds).then(summary => {
      console.log(`[members] warmed guilds=${summary.guildCount} members=${summary.memberCount}`);
    }).catch(error => {
      console.warn(`[members] warmup failed: ${error?.message || error}`);
    });
  }
  console.log(`✅ LLM API mode: ${OPENAI_RESPONSES_ENABLED ? 'OpenAI Responses' : 'Chat Completions'}`);
  if (OPENAI_RESPONSES_ENABLED) {
    console.log(`✅ OpenAI web max tool calls: ${OPENAI_WEB_SEARCH_MAX_TOOL_CALLS_VALUE}`);
    console.log(`✅ OpenAI Sources display limit: ${OPENAI_WEB_SEARCH_MAX_SOURCES_VALUE}`);
  }
  console.log(`✅ Image provider: ${IMAGE_PROVIDER_MODE}`);
  if (IMAGE_PROVIDER_MODE === 'openai') {
    console.log(`✅ OpenAI image models: flare=${OPENAI_IMAGE_MODELS.flare} sunburst=${OPENAI_IMAGE_MODELS.sunburst}`);
    console.log(`✅ OpenAI image quality: ${OPENAI_IMAGE_QUALITY_VALUE}`);
    console.log(`✅ OpenAI image size: ${OPENAI_IMAGE_SIZE_VALUE}`);
    console.log(`✅ OpenAI reference max edge: ${OPENAI_IMAGE_REFERENCE_MAX_EDGE_VALUE}px`);
  }
  console.log(`✅ Timezone: ${BOT_TIMEZONE}`);
  if (LLM_PROVIDER_MODE === 'ollama') {
    const keepAliveText = OLLAMA_KEEP_ALIVE || '(server default)';
    console.log(`✅ Ollama keep alive: ${keepAliveText}`);
    void preloadOllamaModel();
  }
});

client.on(Events.GuildMemberAdd, member => {
  memberDirectory.upsertMember(member);
});

client.on(Events.GuildMemberRemove, member => {
  memberDirectory.removeMember(member);
});

client.on(Events.GuildMemberUpdate, (_oldMember, member) => {
  memberDirectory.upsertMember(member);
});

client.on(Events.PresenceUpdate, (_oldPresence, presence) => {
  memberDirectory.updatePresence(presence);
});

client.on(Events.MessageCreate, (msg) => {
  if (msg.author.bot) return;
  if (!allowedChannelIds.has(msg.channelId)) return;

  const st = getState(msg.channelId);

  const name = msg.member?.displayName || msg.author.username;
  st.queue.push({ kind: 'message', msg, name, text: msg.content });

  processQueue(msg.channelId).catch(e => {
    console.error(e);
    msg.reply(`エラー: ${e.message}`).catch(() => {});
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (othello.owns(interaction)) {
      await othello.handle(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    if (!allowedChannelIds.has(interaction.channelId)) {
      await interaction.reply({
        content: '❌ このチャンネルでは使用できません',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const st = getState(interaction.channelId);

    if (interaction.commandName === 'help') {
      await interaction.reply(
        [
          '🧠 **LLMBot ヘルプ**',
          '',
          '**スラッシュコマンド**',
          '• `/help` : このヘルプを表示',
          '• `/status` : Botの状態確認',
          `• \`/draw\` : ${IMAGE_PROVIDER_MODE === 'openai' ? 'OpenAI Image API' : 'Stable Diffusion WebUI'} で画像生成`,
          '• `/reference add|list|show|delete` : 参照画像を保存・管理',
          '• `/music` : ComfyUI で音楽生成',
          '• `/chat <message> <image>` : LLMと会話',
          '• `/webchat <message>` : Web検索を使って最新情報つきで会話',
          '• `/systemprompt [text] [reset]` : System Prompt を設定またはリセット',
          '• `/systemprompt-show` : 現在の System Prompt を表示',
          '• `/othello [difficulty]` : オセロ開始（座標ボタンで操作・黒でAIと対局）',
          '• `/pause` : 応答を一時停止',
          '• `/resume` : 応答を再開',
          '• `/reset` : 会話履歴をリセット',
          '',
        ].join('\n'),
      );
      return;
    }

    if (interaction.commandName === 'status') {
      const histLen = st.history?.length ?? 0;
      const paused = !!st.paused;
      const queueLen = st.queue?.length ?? 0;

      await interaction.reply(
        [
          '📊 **LLMBot ステータス**',
          `• paused: \`${paused}\``,
          `• llm provider: \`${LLM_PROVIDER_MODE}\``,
          `• llm model: \`${LLM_MODEL_NAME}\``,
          `• llm temperature: \`${LLM_TEMPERATURE_VALUE}\``,
          `• llm max history: \`${LLM_MAX_HISTORY_MESSAGES_VALUE}\``,
          `• web search mode: \`${WEB_SEARCH_MODE_VALUE}\``,
          `• member context: \`${MEMBER_CONTEXT_ENABLED_VALUE}\``,
          ...(MEMBER_CONTEXT_ENABLED_VALUE
            ? [
                `• member cache ttl: \`${MEMBER_CONTEXT_CACHE_TTL_SECONDS_VALUE}s\``,
                `• member context max members: \`${MEMBER_CONTEXT_MAX_MEMBERS_VALUE}\``,
                `• member context max chars: \`${MEMBER_CONTEXT_MAX_CHARS_VALUE}\``,
              ]
            : []),
          `• web search backend: \`${OPENAI_RESPONSES_ENABLED ? 'OpenAI web_search' : 'Ollama Web Search'}\``,
          `• image provider: \`${IMAGE_PROVIDER_MODE}\``,
          ...(IMAGE_PROVIDER_MODE === 'openai'
            ? [
                `• image models: flare=\`${OPENAI_IMAGE_MODELS.flare}\` sunburst=\`${OPENAI_IMAGE_MODELS.sunburst}\``,
                `• image quality: \`${OPENAI_IMAGE_QUALITY_VALUE}\``,
                `• image size: \`${OPENAI_IMAGE_SIZE_VALUE}\``,
                `• reference max edge: \`${OPENAI_IMAGE_REFERENCE_MAX_EDGE_VALUE}px\``,
              ]
            : []),
          `• ollama web search: \`${String(!!String(OLLAMA_WEB_API_KEY_VALUE || '').trim())}\``,
          `• history: \`${histLen}\` messages`,
          `• queue: \`${queueLen}\``,
          `• channel: <#${interaction.channelId}>`,
        ].join('\n'),
      );
      return;
    }

    if (interaction.commandName === 'pause') {
      st.paused = true;
      await interaction.reply('了解、このチャンネルでは黙るね（paused）');
      return;
    }

    if (interaction.commandName === 'resume') {
      st.paused = false;
      await interaction.reply('再開するね（resume）');
      return;
    }

    if (interaction.commandName === 'reset') {
      stateByChannel.delete(interaction.channelId);
      await interaction.reply('このチャンネルの履歴をリセットしたよ');
      return;
    }

    if (interaction.commandName === 'systemprompt') {
      const reset = !!interaction.options.getBoolean('reset');
      const text = (interaction.options.getString('text') || '').trim();
      const base = SYSTEM_PROMPT_VALUE;

      if (reset || text.toLowerCase() === 'reset') {
        if (st.history?.[0]?.role === 'system') {
          st.history[0].content = base;
        }
        await interaction.reply(
          [
            'System Prompt をデフォルトに戻しました。',
            '',
            '```',
            base,
            '```',
          ].join('\n'),
        );
        return;
      }

      if (!text) {
        await interaction.reply('`text` を指定するか `reset:true` を設定してください。');
        return;
      }

      const newSystem = [base, '', SYSTEM_PROMPT_OVERRIDE_MARKER, text].join('\n');
      if (st.history?.[0]?.role === 'system') {
        st.history[0].content = newSystem;
      } else if (st.history) {
        st.history.unshift({ role: 'system', content: newSystem });
      }

      const preview = text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
      await interaction.reply(
        [
          'System Prompt を更新しました。',
          '',
          '```',
          preview || '(empty)',
          '```',
        ].join('\n'),
      );
      return;
    }

    if (interaction.commandName === 'systemprompt-show') {
      const base = SYSTEM_PROMPT_VALUE;
      let current = base;
      if (st.history?.[0]?.role === 'system') {
        current = st.history[0].content || base;
      }

      const marker =
        [SYSTEM_PROMPT_OVERRIDE_MARKER, LEGACY_PERSONA_OVERRIDE_MARKER].find(value =>
          current.includes(value),
        ) || SYSTEM_PROMPT_OVERRIDE_MARKER;
      let baseText = current;
      let overrideText = '';
      const idx = current.indexOf(marker);
      if (idx !== -1) {
        baseText = current.slice(0, idx).trim();
        overrideText = current.slice(idx + marker.length).trim();
      } else {
        baseText = current.trim();
      }

      const header = '🧩 **System Prompt 現在設定**';
      const status = `• override: ${overrideText ? 'あり' : 'なし'}`;
      const body = overrideText
        ? `${baseText}\n\n${SYSTEM_PROMPT_OVERRIDE_MARKER}\n${overrideText}`
        : baseText || base;

      await interaction.reply([header, status, '', '```', body, '```'].join('\n'));
      return;
    }

    if (interaction.commandName === 'reference') {
      await handleReference(interaction);
      return;
    }

    if (interaction.commandName === 'draw') {
      await handleDraw(interaction, st);
      return;
    }

    if (interaction.commandName === 'music') {
      await handleMusic(interaction, st);
      return;
    }

    if (interaction.commandName === 'othello') {
      const difficulty = interaction.options.getString('difficulty') || 'normal';
      await othello.start(interaction, difficulty);
      return;
    }

    if (interaction.commandName === 'chat') {
      if (st.paused) {
        await interaction.reply('⏸️ 現在このチャンネルは停止中です（/resume で再開）');
        return;
      }

      const text = interaction.options.getString('message') || '';
      const imageAtt = pickImageFromInteraction(interaction);

      if (!text && !imageAtt) {
        await interaction.reply('`/chat message:<文章>` か `image:<画像>` のどちらかを指定してね');
        return;
      }

      await interaction.deferReply();

      const name = interaction.member?.displayName || interaction.user.username;

      st.queue.push({
        kind: 'interaction',
        interaction,
        name,
        text,
        imageAtt,
      });

      processQueue(interaction.channelId).catch(e => {
        console.error(e);
        interaction.editReply(`⚠️ エラー: ${e.message}`).catch(() => {});
      });

      return;
    }

    if (interaction.commandName === 'webchat') {
      if (st.paused) {
        await interaction.reply('⏸️ 現在このチャンネルは停止中です（/resume で再開）');
        return;
      }

      const text = (interaction.options.getString('message', true) || '').trim();
      if (!text) {
        await interaction.reply('`/webchat message:<文章>` を指定してね');
        return;
      }

      if (!OPENAI_RESPONSES_ENABLED && !String(OLLAMA_WEB_API_KEY_VALUE || '').trim()) {
        await interaction.reply('`OLLAMA_WEB_API_KEY` が未設定です。GUI または .env に設定してください。');
        return;
      }

      await interaction.deferReply();

      const name = interaction.member?.displayName || interaction.user.username;
      st.queue.push({
        kind: 'interaction',
        interaction,
        name,
        text,
        webSearch: true,
      });

      processQueue(interaction.channelId).catch(e => {
        console.error(e);
        interaction.editReply(`⚠️ エラー: ${e.message}`).catch(() => {});
      });

      return;
    }
  } catch (e) {
    console.error('interaction error:', e);

    if (e?.code === 10062 || e?.code === 40060) {
      return;
    }

    if (interaction.deferred || interaction.replied) {
      try {
        await interaction.editReply({ content: '⚠️ エラーが発生しました' });
      } catch {
        try {
          await interaction.followUp({
            content: '⚠️ エラーが発生しました',
            flags: MessageFlags.Ephemeral,
          });
        } catch {}
      }
      return;
    }

    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: '⚠️ エラーが発生しました',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});


client.login(DISCORD_TOKEN_VALUE);
