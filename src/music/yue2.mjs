import { AttachmentBuilder } from 'discord.js';
import { setTimeout as wait } from 'node:timers/promises';
import { buildYue2Workflow, parseYue2HistoryResult } from './yue2-workflow.mjs';
import { formatYue2Completion, formatYue2GeneratingMessage } from './messages.mjs';
import { MusicBackendError } from './comfy-client.mjs';
import { observeMusicProgress } from './progress.mjs';

export function createYue2Handler({ client, settings, sleep = wait, now = Date.now, timeoutMs = 20 * 60 * 1000, pollMs = 2000, timingHistory }) {
  return async function handleYue2(job) {
    const { interaction } = job;
    await interaction.editReply({ content: formatYue2GeneratingMessage(job.durationSec, settings.maxDurationSec), allowedMentions: { parse: [] } });
    const workflow = buildYue2Workflow({ ...job, ...settings });
    // Abort early on a missing/mismatched server extension; do not generate an unclassifiable song.
    const info = await client.request('/object_info/DiscordYuE2Result');
    if (!info?.DiscordYuE2Result) throw new MusicBackendError('YuE2 result extension is missing', 'MUSIC_SETUP_REQUIRED');
    const progress = await observeMusicProgress(client, {
      interaction, workflow, model: 'yue2', durationSec: job.durationSec, maxDurationSec: settings.maxDurationSec,
      baseUrl: client.baseUrl, now, timingHistory,
    });
    try {
      const id = await client.submit(workflow, { clientId: progress.clientId });
      progress.setPromptId(id);
      const started = now();
      while (now() - started < timeoutMs) {
        const result = parseYue2HistoryResult(await client.history(id), id);
        if (result) {
          if (result.maxDurationSec !== settings.maxDurationSec || result.targetDurationSec !== job.durationSec || result.actualDurationSec > settings.maxDurationSec + 0.04) {
            throw new MusicBackendError('YuE2 metadata does not match this request', 'MUSIC_STATE_UNKNOWN');
          }
          progress.phase('音声ファイルを取得・送信準備中', { finalizing: true });
          await progress.tick();
          // 8MiB fallback is conservative when the interaction does not report its actual limit.
          const limit = Math.min(interaction.attachmentSizeLimit || 8 * 1024 * 1024, 24 * 1024 * 1024);
          const buffer = await client.audio(result.audio, limit);
          await interaction.editReply({
            content: formatYue2Completion({ ...result, targetDurationSec: job.durationSec, maxDurationSec: settings.maxDurationSec, prompt: job.prompt }),
            files: [new AttachmentBuilder(buffer, { name: `yue2_${id}.mp3` })], allowedMentions: { parse: [] },
          });
          await progress.complete();
          return result;
        }
        await progress.tick();
        await sleep(pollMs);
      }
      // Do not /interrupt a shared server or silently retry a job whose final state is unknown.
      throw new MusicBackendError('YuE2 result wait timed out; job may still be running', 'MUSIC_RESULT_TIMEOUT');
    } finally { progress.close(); }
  };
}
