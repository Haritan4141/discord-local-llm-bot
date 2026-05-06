import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("LLMBotの使い方・コマンド一覧を表示します。"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Botの現在状態を表示します。"),

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("LLMに話しかけます。")
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("送るメッセージ")
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName("image")
        .setDescription("一緒に送る画像（任意）")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("webchat")
    .setDescription("Web検索を使って最新情報を含めて会話します。")
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("検索しながら答えてほしい内容")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Botの応答を一時停止します"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Botの応答を再開します"),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("会話コンテキストをリセットします"),

  new SlashCommandBuilder()
    .setName("persona")
    .setDescription("人格を変更・保持します。")
    .addStringOption(option =>
      option
        .setName("text")
        .setDescription("Persona instruction text")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName("reset")
        .setDescription("Reset persona to default")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("persona-show")
    .setDescription("現在のpersona設定を表示します。"),

  new SlashCommandBuilder()
    .setName("draw")
    .setDescription("Stable Diffusion WebUI で画像生成をします。")
    .addStringOption(option =>
      option
        .setName("prompt")
        .setDescription("Prompt text")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("width")
        .setDescription("Image width")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("height")
        .setDescription("Image height")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("steps")
        .setDescription("Sampling steps")
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName("cfg")
        .setDescription("CFG scale")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("sampler")
        .setDescription("Sampler name")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("seed")
        .setDescription("Seed (-1 for random)")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("batch")
        .setDescription("Batch size")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("negative")
        .setDescription("Negative prompt")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("music")
    .setDescription("ACE-Step で音楽生成をします。")
    .addStringOption(option =>
      option
        .setName("prompt")
        .setDescription("Prompt text")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("language")
        .setDescription("Vocal language (default: ja)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("lyrics")
        .setDescription("Lyrics (optional)")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("duration")
        .setDescription("Duration (seconds)")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("bpm")
        .setDescription("BPM (30-300)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("othello")
    .setDescription("オセロを開始します（VS AI）")
    .addStringOption(option =>
      option
        .setName("difficulty")
        .setDescription("AIの強さ")
        .addChoices(
          { name: "弱め", value: "easy" },
          { name: "普通", value: "normal" },
          { name: "強め", value: "hard" },
          { name: "最強", value: "max" }
        )
        .setRequired(false)
    ),
].map(cmd => cmd.toJSON());

function parseGuildIds(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function resolveMode(argv) {
  if (argv.includes("--global")) return "global";
  if (argv.includes("--guild")) return "guild";
  return "guild";
}

const mode = resolveMode(process.argv.slice(2));

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN が設定されていません。");
if (!process.env.CLIENT_ID) throw new Error("CLIENT_ID が設定されていません。");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

if (mode === "global") {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("✓ Global slash commands registered");
  process.exit(0);
}

const guildIds = parseGuildIds(process.env.GUILD_ID);
if (!guildIds.length) {
  throw new Error("GUILD_ID が設定されていません。ギルド登録ではカンマ区切りで複数指定できます。");
}

for (const guildId of guildIds) {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
    { body: commands }
  );
  console.log(`✓ Guild slash commands registered: ${guildId}`);
}
