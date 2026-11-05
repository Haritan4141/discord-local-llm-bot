import { AttachmentBuilder } from 'discord.js';
import * as runtimeConfig from '../config.mjs';
import { translatePromptForSd, sdTxt2Img } from '../sd/draw.mjs';
import {
  assertAnimatedGif,
  assertOpenAiGifModel,
  formatOpenAiImageCompletion,
  generateOpenAiImages,
  resolveOpenAiImageOutput,
  resolveOpenAiImageSize,
} from '../image/openai.mjs';
import { resolveOpenAiImageModel } from '../image/openai-models.mjs';
import { assertReferenceImageCount, fetchReferenceImage } from '../image/reference-images.mjs';
import { DRAW_REFERENCE_OPTION_NAMES, addReferenceProfileLabels } from '../image/draw-references.mjs';
import { prepareReferenceImages } from '../image/prepare-references.mjs';
import { detectReferenceProfiles } from '../image/automatic-references.mjs';
import { truncateText } from '../utils/text.mjs';

export function createDrawHandler({
  config = runtimeConfig,
  referenceStore,
  fetchImage = fetchReferenceImage,
  generateImages = generateOpenAiImages,
  translatePrompt = translatePromptForSd,
  sdGenerate = sdTxt2Img,
  logger = console,
} = {}) {
  return async function handleDraw(interaction, { paused = false } = {}) {
    if (paused) {
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
    const image = interaction.options.getAttachment('image');
    let referenceNames = DRAW_REFERENCE_OPTION_NAMES
      .map(name => interaction.options.getString(name))
      .filter(name => name != null);
    const modelOpt = interaction.options.getString('model');
    const autoReferenceOpt = interaction.options.getBoolean('auto_reference');
    const formatOpt = interaction.options.getString('format');
    const frameCountOpt = interaction.options.getInteger('frame_count');
    const frameDurationOpt = interaction.options.getInteger('frame_duration_ms');

    if (config.IMAGE_PROVIDER_MODE !== 'openai' && (image || referenceNames.length || modelOpt != null || autoReferenceOpt != null || formatOpt != null || frameCountOpt != null || frameDurationOpt != null)) {
      await interaction.reply('image / reference～reference8 / model (auto・flare・sunburst) / auto_reference / format / frame_count / frame_duration_ms は現在 OpenAI image provider のみ対応しています。');
      return;
    }

    await interaction.deferReply();

    try {
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

      if (config.IMAGE_PROVIDER_MODE === 'openai') {
        const output = resolveOpenAiImageOutput({
          format: formatOpt ?? 'png', frameCount: frameCountOpt, frameDurationMs: frameDurationOpt,
        });
        const size = resolveOpenAiImageSize({
          width,
          height,
          configuredSize: config.OPENAI_IMAGE_SIZE_VALUE,
          format: output.format,
        });
        const finalBatch = clamp(Number.isFinite(batchOpt) ? batchOpt : 1, 1, 4);
        if (output.format === 'gif' && (image || referenceNames.length)) {
          throw new Error('GIF生成は新規生成専用です。image / reference～reference8 を外してください。');
        }
        let automaticReferences = false;
        if (!referenceNames.length && autoReferenceOpt !== false) {
          const profiles = detectReferenceProfiles(prompt, await referenceStore.list());
          referenceNames = profiles.map(profile => profile.displayName);
          automaticReferences = referenceNames.length > 0;
        }
        if (output.format === 'gif' && referenceNames.length) {
          throw new Error('GIF生成は参照画像に対応していません。登録名が自動参照の対象です。auto_reference:false で参照せずに新規生成できます。');
        }
        const references = [];
        const referenceGroups = [];
        for (const name of referenceNames) {
          const profileImages = await referenceStore.loadImages(name);
          assertReferenceImageCount(references.length + profileImages.length + (image ? 1 : 0));
          referenceGroups.push({ name, firstImage: references.length + (image ? 1 : 0) + 1, imageCount: profileImages.length });
          references.push(...profileImages);
        }
        if (image) references.unshift(await fetchImage(image));
        const preparedReferences = await prepareReferenceImages(references, {
          maxEdge: config.OPENAI_IMAGE_REFERENCE_MAX_EDGE_VALUE,
        });
        const referenceDimensions = preparedReferences.map(({ width, height }) => `${width}x${height}`);
        const { model, mode } = resolveOpenAiImageModel({
          mode: modelOpt,
          referenceCount: references.length,
          models: config.OPENAI_IMAGE_MODELS,
        });
        if (output.format === 'gif') assertOpenAiGifModel(model);
        const result = await generateImages({
          url: config.OPENAI_IMAGE_GENERATIONS_URL,
          editsUrl: config.OPENAI_IMAGE_EDITS_URL,
          apiKey: config.OPENAI_IMAGE_API_KEY_VALUE,
          model,
          prompt: addReferenceProfileLabels(prompt, referenceGroups, Boolean(image)),
          size,
          quality: config.OPENAI_IMAGE_QUALITY_VALUE,
          count: finalBatch,
          references: preparedReferences,
          ...output,
        });

        if (!result.images.length) {
          await interaction.editReply('OpenAI Image API から画像が返されませんでした。');
          return;
        }

        const configuredLimit = config.DISCORD_MAX_ATTACHMENT_BYTES || 20 * 1024 * 1024;
        const discordLimit = interaction.attachmentSizeLimit > 0 ? interaction.attachmentSizeLimit : 20 * 1024 * 1024;
        const attachmentLimit = Math.min(configuredLimit, discordLimit);
        const files = await Promise.all(result.images.map(async (b64, idx) => {
          const buf = Buffer.from(b64, 'base64');
          if (buf.length > attachmentLimit) {
            throw new Error(
              `生成画像 ${idx + 1} が Discord の送信上限 ${Number((attachmentLimit / 1024 / 1024).toFixed(2))}MiB を超えました。` +
              (output.format === 'gif' ? 'フレーム数（frame_count）、画像サイズまたは品質を下げてください。' : '画像サイズまたは品質を下げてください。'),
            );
          }
          if (output.format === 'gif') await assertAnimatedGif(buf);
          return new AttachmentBuilder(buf, { name: `openai_draw_${Date.now()}_${idx + 1}.${output.format}` });
        }));

        const usage = result.usage;
        logger.log(
          `[openai-image] model=${model} mode=${mode} references=${references.length} size=${size} quality=${config.OPENAI_IMAGE_QUALITY_VALUE}` +
          ` reference_selection=${automaticReferences ? 'automatic' : referenceNames.length ? 'manual' : 'none'}` +
          (output.format === 'gif' ? ` format=gif frame_count=${output.frameCount} frame_duration_ms=${output.frameDurationMs}` : '') +
          ` images=${files.length} input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens}` +
          ` total_tokens=${usage.totalTokens}`,
          ...(referenceDimensions.length ? [`reference_input=${referenceDimensions.join(',')}`] : []),
        );
        const content = formatOpenAiImageCompletion({
          prompt,
          model,
          mode,
          size,
          quality: config.OPENAI_IMAGE_QUALITY_VALUE,
          imageCount: files.length,
          referenceCount: references.length,
          referenceNames,
          referenceDimensions,
          automaticReferences,
          usage,
          ...output,
        });
        await interaction.editReply({
          content,
          files,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const finalWidth = clamp(Number.isFinite(width) ? width : config.numEnv(config.SD_DEFAULTS.width, 768), 64, 2048);
      const finalHeight = clamp(Number.isFinite(height) ? height : config.numEnv(config.SD_DEFAULTS.height, 768), 64, 2048);
      const finalSteps = clamp(Number.isFinite(steps) ? steps : config.numEnv(config.SD_DEFAULTS.steps, 20), 1, 150);
      const finalCfgScale = clamp(Number.isFinite(cfgScale) ? cfgScale : config.numEnv(config.SD_DEFAULTS.cfgScale, 7), 1, 30);
      const finalSampler = String(samplerOpt ?? config.SD_DEFAULTS.sampler ?? 'DPM++ 2M Karras');
      const finalSeed = Number.isFinite(seedOpt) ? seedOpt : -1;
      const finalBatch = clamp(Number.isFinite(batchOpt) ? batchOpt : config.numEnv(config.SD_DEFAULTS.batchSize, 1), 1, 4);
      const finalNegative = String(negativeOpt ?? config.SD_DEFAULTS.negative ?? '');

      let promptForSd = prompt;
      let translated = false;
      try {
        const t = await translatePrompt(prompt);
        promptForSd = t.prompt;
        translated = t.translated;
      } catch (e) {
        logger.error('prompt translate failed:', e);
      }

      const imagesB64 = await sdGenerate({
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
      logger.error(e);
      await interaction.editReply({
        content: truncateText(`draw error: ${e.message}`, 1900),
        allowedMentions: { parse: [] },
      });
    }

    return;
  };
}
