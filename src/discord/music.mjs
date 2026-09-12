import { resolveMusicRequest } from '../music/settings.mjs';
import { formatMusicErrorMessage, formatMusicQueuedMessage } from '../music/messages.mjs';

export function createMusicHandler({ jobs, settings }) {
  return async function handleMusic(interaction, state) {
    if (state.paused) { await interaction.reply('このチャンネルではBotが一時停止しています。'); return; }
    let request;
    try {
      request = resolveMusicRequest({
        prompt: interaction.options.getString('prompt', true), model: interaction.options.getString('model'),
        durationSec: interaction.options.getInteger('duration'), lyrics: interaction.options.getString('lyrics'),
        language: interaction.options.getString('language'), bpm: interaction.options.getInteger('bpm'),
      }, settings);
    } catch (error) {
      await interaction.reply({ content: error.message, allowedMentions: { parse: [] } }); return;
    }
    if (jobs.totalCount() >= 5) {
      await interaction.reply(formatMusicErrorMessage({ code: 'MUSIC_QUEUE_FULL' })); return;
    }
    await interaction.deferReply();
    // Normal Bot message edits outlive interaction tokens while a long music queue is running.
    const message = await interaction.fetchReply();
    const reply = {
      attachmentSizeLimit: interaction.attachmentSizeLimit,
      editReply: payload => message.edit(typeof payload === 'string'
        ? { content: payload, allowedMentions: { parse: [] } }
        : { ...payload, allowedMentions: { parse: [] } }),
    };
    let releaseReady;
    const ready = new Promise(resolve => { releaseReady = resolve; });
    const job = { ...request, interaction: reply, ready };
    try {
      const position = jobs.enqueue(job);
      await reply.editReply(formatMusicQueuedMessage(position));
    } catch (error) {
      job.cancelled = true;
      await reply.editReply(formatMusicErrorMessage(error));
    } finally { releaseReady(); }
  };
}
