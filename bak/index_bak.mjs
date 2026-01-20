import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const {
  DISCORD_TOKEN,
  CHANNEL_IDS,
  OLLAMA_URL,
  OLLAMA_MODEL,
  SYSTEM_PROMPT,
} = process.env;

const allowedChannelIds = new Set(
  (CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN が .env に設定されていません');
if (allowedChannelIds.size === 0) throw new Error('CHANNEL_IDS が .env に設定されていません');
if (!OLLAMA_URL) throw new Error('OLLAMA_URL が .env に設定されていません');
if (!OLLAMA_MODEL) throw new Error('OLLAMA_MODEL が .env に設定されていません');

const stateByChannel = new Map();
/**
 * state = {
 *   paused: boolean,
 *   history: [{role, content}],
 *   queue: Array<{ msg, name, text }>,
 *   processing: boolean,
 * }
 */
function getState(channelId) {
  if (!stateByChannel.has(channelId)) {
    stateByChannel.set(channelId, {
      paused: false,
      history: [
        {
          role: 'system',
          content:
            SYSTEM_PROMPT ||
            'You are a helpful assistant. Reply in Japanese, concise, and only when needed.',
        },
      ],
      queue: [],
      processing: false,
    });
  }
  return stateByChannel.get(channelId);
}

function trimHistory(hist, maxMessages = 30) {
  const sys = hist[0];
  const rest = hist.slice(1);
  const trimmed = rest.slice(-maxMessages);
  hist.length = 0;
  hist.push(sys, ...trimmed);
}

async function ollamaChat(messages) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || '';
}

function splitForDiscord(text, chunkSize = 1800) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks.length ? chunks : ['(empty)'];
}

function isCommand(text) {
  const c = text.trim();
  return c === '!help' || c === '!pause' || c === '!resume' || c === '!reset';
}

async function processQueue(channelId) {
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
      const { msg, name, text } = item;

      // コマンドはここに来ない想定だが念のため
      if (isCommand(text)) continue;

      // 即レス：この1発言を履歴に積んでLLMへ
      const userChunk = `${name}: ${text}`;
      st.history.push({ role: 'user', content: userChunk });
      trimHistory(st.history, 30);

      await msg.channel.sendTyping();

      const reply = await ollamaChat(st.history);
      const cleaned = reply.trim();
      if (!cleaned) continue;

      st.history.push({ role: 'assistant', content: cleaned });
      trimHistory(st.history, 30);

      // 「この発言への返事」にしたいので reply を使う
      const parts = splitForDiscord(cleaned);
      await msg.reply(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        await msg.channel.send(parts[i]);
      }
    }
  } finally {
    st.processing = false;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Allowed channels: ${[...allowedChannelIds].join(', ')}`);
  console.log(`✅ Model: ${OLLAMA_MODEL}`);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!allowedChannelIds.has(msg.channelId)) return;

  const st = getState(msg.channelId);
  const c = msg.content.trim();

  // ---- コマンド ----
  if (c === '!help') {
    await msg.reply(
      [
        '🧠 **LLMbot コマンド一覧（即レス版）**',
        '',
        '• `!help` : このヘルプを表示',
        '• `!status` : 状態表示',
        '• `!persona <説明>` : 人格/口調の変更',
        '• `!persona reset` : 元に戻す',
        '• `!pause` : このチャンネルで黙る（停止）',
        '• `!resume` : このチャンネルで再開',
        '• `!reset` : このチャンネルの会話記憶リセット',
        '',
        'ℹ️ 反応条件:',
        '• このチャンネルの各メッセージに即レスします（1発言=1返答）',
      ].join('\n')
    );
    return;
  }
  if (c === '!status') {
    // st はすでに const st = getState(msg.channelId); がある想定
    const histLen = st.history?.length ?? 0;
    const paused = !!st.paused;

    // 即レス版なら st.queue、まとめ版なら st.buffer がある
    const queueLen = st.queue?.length ?? 0;
    const bufferLen = st.buffer?.length ?? 0;

    // モード推定（ざっくり）
    const mode =
      st.queue ? '即レス（1発言=1返答 / キュー処理）' :
      st.buffer ? 'まとめ（数秒分をまとめて返答）' :
      '不明';

    await msg.reply(
      [
        '📊 **LLMbot ステータス**',
        `• paused: \`${paused}\``,
        `• mode: ${mode}`,
        `• model: \`${process.env.OLLAMA_MODEL}\``,
        `• history: \`${histLen}\` messages`,
        st.queue ? `• queue: \`${queueLen}\`` : null,
        st.buffer ? `• buffer: \`${bufferLen}\`` : null,
        `• channel: <#${msg.channelId}>`,
      ].filter(Boolean).join('\n')
    );
    return;
  }
  if (c.startsWith('!persona')) {
    const persona = c.replace(/^!persona\s*/i, '').trim();

    if (!persona) {
      await msg.reply(
        [
          '使い方: `!persona <人格/口調/ルール>`',
          '例: `!persona あなたは落ち着いた関西弁の雑談相手。短めに返答し、質問で返して会話を続ける。`',
          '',
          '元に戻す: `!persona reset`',
        ].join('\n')
      );
      return;
    }

    const base = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';

    if (persona.toLowerCase() === 'reset') {
      // デフォルトに戻す
      if (st.history?.[0]?.role === 'system') {
        st.history[0].content = base;
      }
      await msg.reply('✅ persona をデフォルトに戻したよ。必要なら `!reset` で会話履歴もリセットしてね。');
      return;
    }

    // system prompt を差し替え（チャンネル単位）
    const newSystem = [
      base,
      '',
      '--- persona override ---',
      persona,
    ].join('\n');

    if (st.history?.[0]?.role === 'system') {
      st.history[0].content = newSystem;
    } else if (st.history) {
      st.history.unshift({ role: 'system', content: newSystem });
    }

    await msg.reply(
      [
        '✅ persona を設定したよ。',
        '反映は次の返答から。',
        '※ “完全に雰囲気を切り替えたい”なら `!reset` もおすすめ。',
      ].join('\n')
    );
    return;
  }
  if (c === '!pause') {
    st.paused = true;
    await msg.reply('了解、このチャンネルでは黙るね（paused）');
    return;
  }
  if (c === '!resume') {
    st.paused = false;
    await msg.reply('再開するね（resume）');
    return;
  }
  if (c === '!reset') {
    stateByChannel.delete(msg.channelId);
    await msg.reply('このチャンネルの履歴をリセットしたよ');
    return;
  }

  // コマンド以外をキューへ
  const name = msg.member?.displayName || msg.author.username;
  st.queue.push({ msg, name, text: msg.content });

  // 即処理（チャンネル単位で直列化）
  try {
    await processQueue(msg.channelId);
  } catch (e) {
    console.error(e);
    try { await msg.reply(`エラー: ${e.message}`); } catch {}
  }
});

client.login(DISCORD_TOKEN);
