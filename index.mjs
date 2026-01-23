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
 *   queue: Array<QueueItem>,
 *   processing: boolean,
 * }
 *
 * QueueItem:
 *  - { kind: 'message', msg, name, text }
 *  - { kind: 'interaction', interaction, name, text, imageAtt }
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


// ======================
// ★ draw (AUTOMATIC1111) 画像生成
// ======================
const SD_URL = (SD_WEBUI_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');

function numEnv(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
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
function pickImageFromInteraction(interaction) {
  const att = interaction.options.getAttachment("image");
  if (!att) return null;

  const url = att.url || "";
  const ct = att.contentType || "";

  const looksImageByType = typeof ct === "string" && ct.startsWith("image/");
  const looksImageByExt = /\.(png|jpe?g|webp|gif)$/i.test(url);
  if (!looksImageByType && !looksImageByExt) return null;

  return {
    url,
    contentType: looksImageByType ? ct : null,
    size: typeof att.size === "number" ? att.size : null,
    name: att.name || null,
  };
}

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
// ======================
// 即レス（キュー）処理：message / slash を完全直列化
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

      // item から「返信API」を抽象化（message と interaction の違いを吸収）
      const api = (() => {
        if (item.kind === "interaction") {
          const interaction = item.interaction;
          return {
            kind: "interaction",
            channel: interaction.channel,
            // deferReply() 済みを想定（/chat 側で defer する）
            typing: async () => {}, // interaction は “考え中” 表示が出るので基本不要
            replyFirst: async (text) => interaction.editReply(text),
            sendMore: async (text) => interaction.followUp(text),
            onError: async (msg) => {
              try { await interaction.editReply(`⚠️ エラー: ${msg}`); } catch {}
            },
          };
        }

        // kind === "message"
        const msg = item.msg;
        return {
          kind: "message",
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
      const text = item.text || "";

      // ★画像：message は添付から拾う / interaction は item.imageAtt を使う
      const imageAtt =
        item.kind === "interaction"
          ? (item.imageAtt || null)
          : pickFirstImageAttachment(item.msg);

      try {
        // 履歴には「画像あり」の印だけ残す（base64を残すと履歴が爆増するため）
        const userChunkForHistory = imageAtt
          ? `[画像あり] ${name}: ${text || "(画像)"}`
          : `${name}: ${text}`;

        st.history.push({ role: "user", content: userChunkForHistory });
        trimHistory(st.history, 30);

        await api.typing();

        // 送信は、画像があるときだけ「このターンだけ」vision形式で投げる
        let reply = "";
        if (imageAtt) {
          const dataUrl = await fetchAsDataUrl(imageAtt.url, imageAtt.contentType);

          // OpenAI互換: content を配列にして image_url を付ける
          const visionUserMessage = {
            role: "user",
            content: [
              { type: "text", text: `${name}: ${text || "この画像について説明して"}` },
              { type: "image_url", image_url: dataUrl },
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

        const cleaned = (reply || "").trim();
        if (!cleaned) continue;

        st.history.push({ role: "assistant", content: cleaned });
        trimHistory(st.history, 30);

        // 返信（1通目は返信、2通目以降は追加送信）
        const parts = splitForDiscord(cleaned);
        await api.replyFirst(parts[0]);
        for (let i = 1; i < parts.length; i++) {
          await api.sendMore(parts[i]);
        }
      } catch (e) {
        console.error(e);
        await api.onError(e?.message || String(e));
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

  const name = msg.member?.displayName || msg.author.username;
  st.queue.push({ kind: "message", msg, name, text: msg.content });

  try {
    await processQueue(msg.channelId);
  } catch (e) {
    console.error(e);
    try { await msg.reply(`エラー: ${e.message}`); } catch {}
  }
});

// ================================
// スラッシュコマンド用
// ================================
import { MessageFlags } from "discord.js"; // まだ入れてなければ追加（discord.js v14+）

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    // チャンネル制限（既存と同じ）
    if (!allowedChannelIds.has(interaction.channelId)) {
      await interaction.reply({
        content: "❌ このチャンネルでは使用できません",
        flags: MessageFlags.Ephemeral, // ← ephemeral警告対策
      });
      return;
    }

    // ★既存設計：チャンネルごとの状態
    const st = getState(interaction.channelId);

    if (interaction.commandName === "help") {
      await interaction.reply(
        [
          "🧠 **LLMBot ヘルプ**",
          "",
          "**スラッシュコマンド**",
          "• `/help` : このヘルプを表示",
          "• `/status` : Botの状態確認",
          "• `/draw` : Stable Diffusion WebUI で画像生成",
          "• `/chat <message> <image>` : LLMと会話",
          "• `/pause` : 応答を一時停止",
          "• `/resume` : 応答を再開",
          "• `/reset` : 会話履歴をリセット",
          "",
        ].join("\n")
      );
      return;
    }

    if (interaction.commandName === "status") {
      const histLen = st.history?.length ?? 0;
      const paused = !!st.paused;
      const queueLen = st.queue?.length ?? 0;

      await interaction.reply(
        [
          "📊 **LLMBot ステータス**",
          `• paused: \`${paused}\``,
          `• model: \`${process.env.OLLAMA_MODEL}\``,
          `• history: \`${histLen}\` messages`,
          `• queue: \`${queueLen}\``,
          `• channel: <#${interaction.channelId}>`,
        ].join("\n")
      );
      return;
    }

    if (interaction.commandName === "pause") {
      st.paused = true;
      await interaction.reply("了解、このチャンネルでは黙るね（paused）");
      return;
    }

    if (interaction.commandName === "resume") {
      st.paused = false;
      await interaction.reply("再開するね（resume）");
      return;
    }

    if (interaction.commandName === "reset") {
      stateByChannel.delete(interaction.channelId);
      await interaction.reply("このチャンネルの履歴をリセットしたよ");
      return;
    }

    if (interaction.commandName === "persona") {
      const reset = !!interaction.options.getBoolean("reset");
      const text = (interaction.options.getString("text") || "").trim();
      const base = process.env.SYSTEM_PROMPT || "You are a helpful assistant.";

      if (reset || text.toLowerCase() === "reset") {
        if (st.history?.[0]?.role === "system") {
          st.history[0].content = base;
        }
        await interaction.reply("persona reset to default.");
        return;
      }

      if (!text) {
        await interaction.reply("Provide `text` or set `reset:true`.");
        return;
      }

      const newSystem = [base, "", "--- persona override ---", text].join("\n");
      if (st.history?.[0]?.role === "system") {
        st.history[0].content = newSystem;
      } else if (st.history) {
        st.history.unshift({ role: "system", content: newSystem });
      }

      await interaction.reply("persona updated.");
      return;
    }

    if (interaction.commandName === "draw") {
      if (st.paused) {
        await interaction.reply("paused in this channel. use /resume.");
        return;
      }

      const prompt = (interaction.options.getString("prompt", true) || "").trim();
      if (!prompt) {
        await interaction.reply("prompt is required.");
        return;
      }

      const width = interaction.options.getInteger("width");
      const height = interaction.options.getInteger("height");
      const steps = interaction.options.getInteger("steps");
      const cfgScale = interaction.options.getNumber("cfg");
      const samplerOpt = interaction.options.getString("sampler");
      const seedOpt = interaction.options.getInteger("seed");
      const batchOpt = interaction.options.getInteger("batch");
      const negativeOpt = interaction.options.getString("negative");

      const finalWidth = Number.isFinite(width) ? width : numEnv(SD_WIDTH, 768);
      const finalHeight = Number.isFinite(height) ? height : numEnv(SD_HEIGHT, 768);
      const finalSteps = Number.isFinite(steps) ? steps : numEnv(SD_STEPS, 20);
      const finalCfgScale = Number.isFinite(cfgScale) ? cfgScale : numEnv(SD_CFG_SCALE, 7);
      const finalSampler = String(samplerOpt ?? SD_SAMPLER ?? "DPM++ 2M Karras");
      const finalSeed = Number.isFinite(seedOpt) ? seedOpt : -1;
      const finalBatch = Number.isFinite(batchOpt) ? batchOpt : numEnv(SD_BATCH_SIZE, 1);
      const finalNegative = String(negativeOpt ?? SD_NEGATIVE_PROMPT ?? "");

      await interaction.deferReply();

      try {
        const imagesB64 = await sdTxt2Img({
          prompt,
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
          await interaction.editReply("no images returned.");
          return;
        }

        const files = imagesB64.slice(0, 4).map((b64, idx) => {
          const buf = Buffer.from(b64, "base64");
          return new AttachmentBuilder(buf, { name: `draw_${Date.now()}_${idx + 1}.png` });
        });

        const statusLine = `done. prompt: ${prompt} | size: ${finalWidth}x${finalHeight} | steps: ${finalSteps} | cfg: ${finalCfgScale} | sampler: ${finalSampler}`;
        await interaction.editReply({ content: statusLine, files });
      } catch (e) {
        console.error(e);
        await interaction.editReply(`draw error: ${e.message}`);
      }

      return;
    }

    if (interaction.commandName === "chat") {
      const st = getState(interaction.channelId);

      if (st.paused) {
        await interaction.reply("⏸️ 現在このチャンネルは停止中です（/resume で再開）");
        return;
      }

      const text = interaction.options.getString("message") || "";
      const imageAtt = pickImageFromInteraction(interaction);

      if (!text && !imageAtt) {
        await interaction.reply("`/chat message:<文章>` か `image:<画像>` のどちらかを指定してね");
        return;
      }

      // ★3秒制限対策：先に defer しておく（この後はキュー待ちでもOK）
      await interaction.deferReply();

      const name = interaction.member?.displayName || interaction.user.username;

      // ★/chat もキューへ（interaction）
      st.queue.push({
        kind: "interaction",
        interaction,
        name,
        text,
        imageAtt, // 画像は interaction から拾ったものを渡す（message添付とは別ルート）
      });

      // ★キュー処理（チャンネル単位で完全直列化）
      try {
        await processQueue(interaction.channelId);
      } catch (e) {
        console.error(e);
        try { await interaction.editReply(`⚠️ エラー: ${e.message}`); } catch { }
      }

      return;
    }


  } catch (e) {
    console.error("interaction error:", e);

    // defer済みの場合は followUp で返す
    if (interaction.deferred) {
      try {
        await interaction.followUp({
          content: "⚠️ エラーが発生しました",
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
      return;
    }

    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: "⚠️ エラーが発生しました",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});



client.login(DISCORD_TOKEN);
