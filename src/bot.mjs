import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from 'discord.js';

import {
  BOT_TIMEZONE,
  DISCORD_TOKEN_VALUE,
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
  WEB_SEARCH_MODE_VALUE,
  allowedChannelIds,
  assertRuntimeConfig,
  numEnv,
  SD_DEFAULTS,
} from './config.mjs';
import { preloadOllamaModel } from './llm/chat.mjs';
import { getState, stateByChannel } from './discord/state.mjs';
import { processQueue } from './discord/queue.mjs';
import { pickImageFromInteraction } from './discord/images.mjs';
import { translatePromptForSd, sdTxt2Img } from './sd/draw.mjs';
import {
  isMusicProcessing,
  musicQueue,
  processMusicQueue,
} from './music/queue.mjs';
import {
  REACTION_DIGITS,
  getOthelloGame,
  getReactionMoves,
  handlePlayerMove,
  othelloMessageToGame,
  startOthelloGame,
  updateReactionGame,
} from './othello/game.mjs';

assertRuntimeConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const SYSTEM_PROMPT_OVERRIDE_MARKER = '--- system prompt override ---';
const LEGACY_PERSONA_OVERRIDE_MARKER = '--- persona override ---';

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Allowed channels: ${[...allowedChannelIds].join(', ')}`);
  console.log(`✅ LLM provider: ${LLM_PROVIDER_MODE}`);
  console.log(`✅ LLM base URL: ${LLM_BASE_URL_RESOLVED}`);
  console.log(`✅ Model: ${LLM_MODEL_NAME}`);
  console.log(`✅ LLM temperature: ${LLM_TEMPERATURE_VALUE}`);
  console.log(`✅ LLM max history messages: ${LLM_MAX_HISTORY_MESSAGES_VALUE}`);
  console.log(`✅ Web search mode: ${WEB_SEARCH_MODE_VALUE}`);
  console.log(`✅ LLM API mode: ${OPENAI_RESPONSES_ENABLED ? 'OpenAI Responses' : 'Chat Completions'}`);
  if (OPENAI_RESPONSES_ENABLED) {
    console.log(`✅ OpenAI web max tool calls: ${OPENAI_WEB_SEARCH_MAX_TOOL_CALLS_VALUE}`);
    console.log(`✅ OpenAI Sources display limit: ${OPENAI_WEB_SEARCH_MAX_SOURCES_VALUE}`);
  }
  console.log(`✅ Timezone: ${BOT_TIMEZONE}`);
  if (LLM_PROVIDER_MODE === 'ollama') {
    const keepAliveText = OLLAMA_KEEP_ALIVE || '(server default)';
    console.log(`✅ Ollama keep alive: ${keepAliveText}`);
    void preloadOllamaModel();
  }
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
          '• `/draw` : Stable Diffusion WebUI で画像生成',
          '• `/music` : ComfyUI で音楽生成',
          '• `/chat <message> <image>` : LLMと会話',
          '• `/webchat <message>` : Web検索を使って最新情報つきで会話',
          '• `/systemprompt [text] [reset]` : System Prompt を設定またはリセット',
          '• `/systemprompt-show` : 現在の System Prompt を表示',
          '• `/othello [difficulty]` : オセロ開始（リアクション操作）',
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
          `• web search backend: \`${OPENAI_RESPONSES_ENABLED ? 'OpenAI web_search' : 'Ollama Web Search'}\``,
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
      const base = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';

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
      const base = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';
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

    if (interaction.commandName === 'draw') {
      if (st.paused) {
        await interaction.reply('paused in this channel. use /resume.');
        return;
      }

      const prompt = (interaction.options.getString('prompt', true) || '').trim();
      if (!prompt) {
        await interaction.reply('prompt is required.');
        return;
      }

      const width = interaction.options.getInteger('width');
      const height = interaction.options.getInteger('height');
      const steps = interaction.options.getInteger('steps');
      const cfgScale = interaction.options.getNumber('cfg');
      const samplerOpt = interaction.options.getString('sampler');
      const seedOpt = interaction.options.getInteger('seed');
      const batchOpt = interaction.options.getInteger('batch');
      const negativeOpt = interaction.options.getString('negative');

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const finalWidth = clamp(Number.isFinite(width) ? width : numEnv(SD_DEFAULTS.width, 768), 64, 2048);
      const finalHeight = clamp(Number.isFinite(height) ? height : numEnv(SD_DEFAULTS.height, 768), 64, 2048);
      const finalSteps = clamp(Number.isFinite(steps) ? steps : numEnv(SD_DEFAULTS.steps, 20), 1, 150);
      const finalCfgScale = clamp(Number.isFinite(cfgScale) ? cfgScale : numEnv(SD_DEFAULTS.cfgScale, 7), 1, 30);
      const finalSampler = String(samplerOpt ?? SD_DEFAULTS.sampler ?? 'DPM++ 2M Karras');
      const finalSeed = Number.isFinite(seedOpt) ? seedOpt : -1;
      const finalBatch = clamp(Number.isFinite(batchOpt) ? batchOpt : numEnv(SD_DEFAULTS.batchSize, 1), 1, 4);
      const finalNegative = String(negativeOpt ?? SD_DEFAULTS.negative ?? '');

      await interaction.deferReply();

      try {
        let promptForSd = prompt;
        let translated = false;
        try {
          const t = await translatePromptForSd(prompt);
          promptForSd = t.prompt;
          translated = t.translated;
        } catch (e) {
          console.error('prompt translate failed:', e);
        }

        const imagesB64 = await sdTxt2Img({
          prompt: promptForSd,
          negativePrompt: finalNegative,
          width: finalWidth,
          height: finalHeight,
          steps: finalSteps,
          cfgScale: finalCfgScale,
          sampler: finalSampler,
          seed: finalSeed,
          batchSize: finalBatch,
        });

        if (!imagesB64.length) {
          await interaction.editReply('no images returned.');
          return;
        }

        const files = imagesB64.slice(0, 4).map((b64, idx) => {
          const buf = Buffer.from(b64, 'base64');
          return new AttachmentBuilder(buf, { name: `draw_${Date.now()}_${idx + 1}.png` });
        });

        const translateTag = translated ? ` | translated: ja->en | translated prompt: ${promptForSd}` : '';
        const statusLine = `生成完了 prompt: ${prompt} | size: ${finalWidth}x${finalHeight} | steps: ${finalSteps} | cfg: ${finalCfgScale} | sampler: ${finalSampler}${translateTag}`;
        await interaction.editReply({ content: statusLine, files });
      } catch (e) {
        console.error(e);
        await interaction.editReply(`draw error: ${e.message}`);
      }

      return;
    }

    if (interaction.commandName === 'music') {
      if (st.paused) {
        await interaction.reply('paused in this channel. use /resume.');
        return;
      }

      const prompt = (interaction.options.getString('prompt', true) || '').trim();
      if (!prompt) {
        await interaction.reply('prompt is required.');
        return;
      }

      const language = (interaction.options.getString('language') || '').trim();
      const lyrics = (interaction.options.getString('lyrics') || '').trim();
      const durationOpt = interaction.options.getInteger('duration');
      let durationSec = Number.isFinite(durationOpt) ? durationOpt : 120;
      durationSec = Math.max(10, Math.min(600, durationSec));
      const bpmOpt = interaction.options.getInteger('bpm');
      const bpm = Number.isFinite(bpmOpt) ? Math.max(30, Math.min(300, bpmOpt)) : null;

      await interaction.deferReply();

      musicQueue.push({ interaction, prompt, durationSec, lyrics, bpm, language });
      const position = musicQueue.length + (isMusicProcessing() ? 1 : 0);

      if (isMusicProcessing() || position > 1) {
        try {
          await interaction.editReply(`music: queued (position ${position}).`);
        } catch {}
      }

      processMusicQueue().catch(e => console.error('music queue error:', e));
      return;
    }

    if (interaction.commandName === 'othello') {
      const difficulty = interaction.options.getString('difficulty') || 'normal';
      await startOthelloGame(interaction, difficulty);
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

      if (!String(OLLAMA_WEB_API_KEY_VALUE || '').trim()) {
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

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const gameId = othelloMessageToGame.get(reaction.message.id);
    if (!gameId) return;
    const game = getOthelloGame(gameId);
    if (!game) return;
    if (user.id !== game.playerId) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const name = reaction.emoji.name;
    if (name === '◀️') {
      game.reactionPage = Math.max(0, (game.reactionPage || 0) - 1);
      await updateReactionGame(game, reaction.message.channel);
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }
    if (name === '▶️') {
      const { totalPages } = getReactionMoves(game);
      game.reactionPage = Math.min(totalPages - 1, (game.reactionPage || 0) + 1);
      await updateReactionGame(game, reaction.message.channel);
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const digit = REACTION_DIGITS.get(name);
    if (digit === undefined) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const { slice } = getReactionMoves(game);
    if (!slice[digit]) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const move = slice[digit];
    const result = await handlePlayerMove(game, move);
    if (result.ok) {
      await updateReactionGame(game, reaction.message.channel);
    }
    try { await reaction.users.remove(user.id); } catch {}
  } catch (e) {
    console.error('reaction error:', e);
  }
});

client.login(DISCORD_TOKEN_VALUE);
