import 'dotenv/config';
import { Client, GatewayIntentBits, AttachmentBuilder } from 'discord.js';


const {
  DISCORD_TOKEN,
  CHANNEL_IDS,
  OLLAMA_URL,
  OLLAMA_MODEL,
  SYSTEM_PROMPT,
  SD_WEBUI_URL,
  SD_STEPS,
  SD_CFG_SCALE,
  SD_WIDTH,
  SD_HEIGHT,
  SD_SAMPLER,
  SD_NEGATIVE_PROMPT,
  SD_BATCH_SIZE,

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

// ======================
// ★ !draw (AUTOMATIC1111) 画像生成
// ======================
const SD_URL = (SD_WEBUI_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');

function numEnv(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function parseDrawCommand(text) {
  // 例: !draw a cute cat --w 512 --h 512 --steps 25 --cfg 7 --sampler "Euler a" --seed 123
  const raw = text.trim();

  const m = raw.match(/^!draw\s+([\s\S]+)$/i);
  if (!m) return null;

  const body = m[1].trim();
  if (!body) return { prompt: '', opts: {} };

  // 超軽量なオプションパーサ（--key value 形式だけ対応）
  const tokens = body.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  const opts = {};
  const promptParts = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const key = t.slice(2).toLowerCase();
      const next = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        opts[key] = true;
      } else {
        const val = next.replace(/^["']|["']$/g, '');
        opts[key] = val;
        i++;
      }
    } else {
      promptParts.push(t.replace(/^["']|["']$/g, ''));
    }
  }

  return { prompt: promptParts.join(' ').trim(), opts };
}

async function sdTxt2Img({ prompt, negativePrompt, width, height, steps, cfgScale, sampler, seed, batchSize }) {
  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    sampler_name: sampler,
    seed,
    batch_size: batchSize,
  };

  const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SD WebUI error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const images = Array.isArray(json?.images) ? json.images : [];

  return images; // base64 (png) strings
}


// ======================
// ★ 画像対応ヘルパー
// ======================
function pickFirstImageAttachment(msg) {
  const att = msg.attachments?.first?.();
  if (!att) return null;

  const url = att.url || '';
  const ct = att.contentType || '';

  // DiscordのcontentTypeが入ることもあるが、入らないこともあるので拡張子でも判定
  const looksImageByType = typeof ct === 'string' && ct.startsWith('image/');
  const looksImageByExt = /\.(png|jpe?g|webp|gif)$/i.test(url);

  if (!looksImageByType && !looksImageByExt) return null;

  return {
    url,
    contentType: looksImageByType ? ct : null,
    size: typeof att.size === 'number' ? att.size : null,
    name: att.name || null,
  };
}

function guessMimeFromUrl(url) {
  if (/\.png$/i.test(url)) return 'image/png';
  if (/\.jpe?g$/i.test(url)) return 'image/jpeg';
  if (/\.webp$/i.test(url)) return 'image/webp';
  if (/\.gif$/i.test(url)) return 'image/gif';
  return 'image/png';
}

async function fetchAsDataUrl(url, contentTypeHint, maxBytes = 10 * 1024 * 1024) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像取得に失敗: ${res.status} ${res.statusText}`);

  // サイズが取れるなら軽くガード（Discord添付は大きいとLLMが重い）
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(len / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(buf.length / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const mime = contentTypeHint || res.headers.get('content-type') || guessMimeFromUrl(url);
  const base64 = buf.toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ======================
// 即レス（キュー）処理
// ======================
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

      // ★画像が添付されているかチェック（1枚だけ）
      const imageAtt = pickFirstImageAttachment(msg);

      // 履歴には「画像あり」の印だけ残す（base64を残すと履歴が爆増するため）
      const userChunkForHistory = imageAtt
        ? `[画像あり] ${name}: ${text || '(画像)'}`
        : `${name}: ${text}`;

      st.history.push({ role: 'user', content: userChunkForHistory });
      trimHistory(st.history, 30);

      await msg.channel.sendTyping();

      // 送信は、画像があるときだけ「このターンだけ」vision形式で投げる
      let reply = '';
      if (imageAtt) {
        const dataUrl = await fetchAsDataUrl(imageAtt.url, imageAtt.contentType);

        // OpenAI互換: content を配列にして image_url を付ける
        const visionUserMessage = {
          role: 'user',
          content: [
            { type: 'text', text: `${name}: ${text || 'この画像について説明して'}` },
            { type: 'image_url', image_url: dataUrl },
          ],
        };

        // st.historyの末尾（さっき積んだ userChunkForHistory）を置き換えて送る
        // ※履歴自体は軽いまま維持しつつ、送信時だけ画像を添付するため
        const messagesToSend = [
          ...st.history.slice(0, -1),
          visionUserMessage,
        ];

        reply = await ollamaChat(messagesToSend);
      } else {
        reply = await ollamaChat(st.history);
      }

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
        '• `!draw <プロンプト> [--w 512 --h 512 ...]` : 画像生成（Stable Diffusion WebUI）',
        '• `!pause` : このチャンネルで黙る（停止）',
        '• `!resume` : このチャンネルで再開',
        '• `!reset` : このチャンネルの会話記憶リセット',
        '',
        'ℹ️ 反応条件:',
        '• このチャンネルの各メッセージに即レスします（1発言=1返答）',
        '• 画像添付があれば、画像も一緒にLLMへ渡します（※Vision対応モデル推奨）',
      ].join('\n')
    );
    return;
  }
  if (c === '!status') {
    const histLen = st.history?.length ?? 0;
    const paused = !!st.paused;
    const queueLen = st.queue?.length ?? 0;

    const mode = st.queue
      ? '即レス（1発言=1返答 / キュー処理）'
      : '不明';

    await msg.reply(
      [
        '📊 **LLMbot ステータス**',
        `• paused: \`${paused}\``,
        `• mode: ${mode}`,
        `• model: \`${process.env.OLLAMA_MODEL}\``,
        `• history: \`${histLen}\` messages`,
        `• queue: \`${queueLen}\``,
        `• channel: <#${msg.channelId}>`,
      ].join('\n')
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
      if (st.history?.[0]?.role === 'system') {
        st.history[0].content = base;
      }
      await msg.reply('✅ persona をデフォルトに戻したよ。必要なら `!reset` で会話履歴もリセットしてね。');
      return;
    }

    const newSystem = [base, '', '--- persona override ---', persona].join('\n');

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
  // ---- !draw（画像生成） ----
  if (c.startsWith('!draw')) {
    if (st.paused) {
      await msg.reply('いま paused 中だよ（`!resume` で再開）');
      return;
    }

    const parsed = parseDrawCommand(c);
    const prompt = parsed?.prompt || '';

    if (!prompt) {
      await msg.reply(
        [
          '使い方: `!draw <生成したい内容>`',
          '例: `!draw idolmaster, mayuzumi fuyuko, cowboy shot,`',
//          'オプション例: `!draw 猫 --w 512 --h 512 --steps 25 --cfg 7 --sampler "Euler a"`',
        ].join('\n')
      );
      return;
    }

    // envのデフォルト + コマンド上書き
    const o = parsed.opts || {};
    const width = numEnv(o.w ?? o.width ?? SD_WIDTH, 768);
    const height = numEnv(o.h ?? o.height ?? SD_HEIGHT, 768);
    const steps = numEnv(o.steps ?? SD_STEPS, 20);
    const cfgScale = numEnv(o.cfg ?? o.cfgscale ?? SD_CFG_SCALE, 7);
    const sampler = String(o.sampler ?? SD_SAMPLER ?? 'DPM++ 2M Karras');
    const seed = o.seed !== undefined ? Number(o.seed) : -1;
    const batchSize = numEnv(o.batch ?? o.batchsize ?? SD_BATCH_SIZE, 1);
    const negativePrompt = String(o.neg ?? o.negative ?? SD_NEGATIVE_PROMPT ?? '');

    await msg.channel.sendTyping();
    const statusMsg = await msg.reply('🎨 生成中…（Stable Diffusion）');

    try {
      const imagesB64 = await sdTxt2Img({
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        sampler,
        seed: Number.isFinite(seed) ? seed : -1,
        batchSize,
      });

      if (!imagesB64.length) {
        await statusMsg.edit('生成結果が空でした（images が返ってこなかった）');
        return;
      }

      const files = imagesB64.slice(0, 4).map((b64, idx) => { // 念のため最大4枚
        const buf = Buffer.from(b64, 'base64');
        return new AttachmentBuilder(buf, { name: `draw_${Date.now()}_${idx + 1}.png` });
      });

      // status を更新して画像を投稿
      await statusMsg.edit(
        `✅ 完了\nprompt: ${prompt}\nsize: ${width}x${height}, steps: ${steps}, cfg: ${cfgScale}, sampler: ${sampler}`
      );
      await msg.channel.send({ files });
    } catch (e) {
      console.error(e);
      await statusMsg.edit(`❌ 生成エラー: ${e.message}\n（WebUIを --api で起動してるか、URLが合ってるか確認してね）`);
    }

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
