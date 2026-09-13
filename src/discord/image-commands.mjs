import { SlashCommandBuilder } from 'discord.js';
import { DRAW_REFERENCE_OPTION_NAMES } from '../image/draw-references.mjs';

export function buildDrawCommand() {
  const command = new SlashCommandBuilder()
    .setName("draw")
    .setDescription("設定した画像生成Providerで画像を生成します。")
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
        .setDescription("Sampling steps (Stable Diffusion only)")
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName("cfg")
        .setDescription("CFG scale (Stable Diffusion only)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("sampler")
        .setDescription("Sampler name (Stable Diffusion only)")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("seed")
        .setDescription("Seed (-1 for random, Stable Diffusion only)")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("batch")
        .setDescription("Number of images (1-4)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("negative")
        .setDescription("Negative prompt (Stable Diffusion only)")
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName("image").setDescription("参照画像 png/jpeg/webp (OpenAI only)").setRequired(false)
    );
  for (const [index, name] of DRAW_REFERENCE_OPTION_NAMES.entries()) {
    command.addStringOption(option => option
      .setName(name)
      .setDescription(index === 0
        ? "保存済み reference の名前または slug (OpenAI only)"
        : `追加reference ${index + 1} の名前または slug（全参照画像合計8枚まで、OpenAI only）`)
      .setRequired(false));
  }
  return command.addStringOption(option =>
      option.setName("model").setDescription("画像モデル (OpenAI only、未指定は auto)")
        .addChoices(
          { name: "auto", value: "auto" },
          { name: "flare", value: "flare" },
          { name: "sunburst", value: "sunburst" }
        ).setRequired(false)
    );
}

export function buildReferenceCommand() {
  return new SlashCommandBuilder()
    .setName("reference")
    .setDescription("名前付きの参照画像を保存・管理します。")
    .addSubcommand(command => command
      .setName("add").setDescription("参照画像を登録・追加・置換します（各 profile 最大8枚）。")
      .addStringOption(option => option.setName("name").setDescription("Profile 名").setRequired(true).setMaxLength(100))
      .addAttachmentOption(option => option.setName("image").setDescription("参照画像 png/jpeg/webp").setRequired(true))
      .addAttachmentOption(option => option.setName("image2").setDescription("参照画像2 png/jpeg/webp"))
      .addAttachmentOption(option => option.setName("image3").setDescription("参照画像3 png/jpeg/webp"))
      .addAttachmentOption(option => option.setName("image4").setDescription("参照画像4 png/jpeg/webp"))
      .addBooleanOption(option => option.setName("replace").setDescription("true で既存画像をすべて置換（既定は追加）")))
    .addSubcommand(command => command.setName("list").setDescription("保存済み profile の一覧を表示します。"))
    .addSubcommand(command => command
      .setName("show").setDescription("Profile と各画像の情報を表示します。")
      .addStringOption(option => option.setName("name").setDescription("Profile 名または slug").setRequired(true)))
    .addSubcommand(command => command
      .setName("delete").setDescription("Profile と保存画像をすべて削除します。")
      .addStringOption(option => option.setName("name").setDescription("Profile 名または slug").setRequired(true)));
}
