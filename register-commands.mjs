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
    .setDescription("人格を変更・指定します。")
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

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ========================
// ✅ どっちに登録するか選ぶ
// ========================

/**
 * (A) ギルド（サーバー）限定で登録：反映が速い（数秒〜）
 * いま使ってるのはこっち
 */
await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands }
);
console.log("✅ Guild slash commands registered");

// ---- ↓ グローバルにしたい時は上をコメントアウトして、下を有効にする ----

/**
 * (B) グローバル（全サーバー）登録：反映が遅い（数分〜最大1時間くらい）
 * ※ すでにギルド登録が残ってると /help が2つ出る原因になるので、
 *    切り替える時は不要側を “空配列PUT” で消すのが安全。
 */
// await rest.put(
//   Routes.applicationCommands(process.env.CLIENT_ID),
//   { body: commands }
// );
// console.log("✅ GLOBAL slash commands registered");
