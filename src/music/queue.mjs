import {
  MUSIC_BACKEND_MODE,
  MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE,
} from '../config.mjs';
import { handleMusicJobAce } from './ace.mjs';
import { comfyFreeMemory, handleMusicJobComfy } from './comfy.mjs';
import { formatMusicErrorMessage } from './messages.mjs';

export const musicQueue = [];
let musicProcessing = false;
let comfyVramReleaseTimer = null;

export function isMusicProcessing() {
  return musicProcessing;
}

export function cancelScheduledMusicVramRelease() {
  if (comfyVramReleaseTimer === null) return;
  clearTimeout(comfyVramReleaseTimer);
  comfyVramReleaseTimer = null;
}

export function scheduleMusicVramRelease() {
  cancelScheduledMusicVramRelease();

  if (MUSIC_BACKEND_MODE !== 'comfyui' || MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE <= 0) {
    return;
  }

  const delayMs = MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE * 1000;
  comfyVramReleaseTimer = setTimeout(async () => {
    comfyVramReleaseTimer = null;

    // A new job may have been queued while the timer was waiting. Never ask
    // ComfyUI to unload models while the music queue is active.
    if (musicProcessing || musicQueue.length > 0) {
      scheduleMusicVramRelease();
      return;
    }

    try {
      await comfyFreeMemory();
      console.info(
        `[music] ComfyUI VRAM release requested after ${MUSIC_VRAM_RELEASE_DELAY_SECONDS_VALUE}s idle.`,
      );
    } catch (e) {
      console.warn(`[music] ComfyUI VRAM release failed: ${e?.message || String(e)}`);
    }
  }, delayMs);

  // The timer should not keep a graceful bot shutdown alive by itself.
  comfyVramReleaseTimer.unref?.();
}

export async function handleMusicJob(job) {
  if (MUSIC_BACKEND_MODE === 'comfyui') {
    return handleMusicJobComfy(job);
  }
  return handleMusicJobAce(job);
}

export async function processMusicQueue() {
  if (musicProcessing) return;
  cancelScheduledMusicVramRelease();
  musicProcessing = true;
  try {
    while (musicQueue.length > 0) {
      const job = musicQueue.shift();
      if (!job) continue;
      try {
        await handleMusicJob(job);
      } catch (e) {
        console.error(e);
        try { await job.interaction.editReply(formatMusicErrorMessage(e)); } catch {}
      }
    }
  } finally {
    musicProcessing = false;
    if (musicQueue.length === 0) scheduleMusicVramRelease();
  }
}
