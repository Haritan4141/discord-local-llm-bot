import { MUSIC_BACKEND_MODE, COMFY_BASE_URL, MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE } from '../config.mjs';
import { handleMusicJobAce } from './ace.mjs';
import { handleMusicJobComfy } from './comfy.mjs';
import { createComfyClient } from './comfy-client.mjs';
import { createYue2Handler } from './yue2.mjs';
import { resolveMusicSettings } from './settings.mjs';
import { createMusicService } from './service.mjs';
import { formatMusicErrorMessage } from './messages.mjs';

export const musicSettings = resolveMusicSettings();
const yue2Client = createComfyClient(musicSettings.yue2Url);
export const musicJobs = createMusicService({
  yue2Client,
  aceClient: MUSIC_BACKEND_MODE === 'comfyui' ? createComfyClient(COMFY_BASE_URL) : null,
  aceBackend: MUSIC_BACKEND_MODE,
  runYue2: createYue2Handler({ client: yue2Client, settings: musicSettings }),
  runComfyAce: handleMusicJobComfy,
  runApiAce: handleMusicJobAce,
  idleDelayMs: MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE * 1000,
  async onError(job, error) {
    console.error('[music]', error);
    await job.interaction.editReply({ content: formatMusicErrorMessage(error), allowedMentions: { parse: [] } });
  },
});
