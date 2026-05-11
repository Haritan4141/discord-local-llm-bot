import { MUSIC_BACKEND_MODE } from '../config.mjs';
import { handleMusicJobAce } from './ace.mjs';
import { handleMusicJobComfy } from './comfy.mjs';

export const musicQueue = [];
let musicProcessing = false;

export function isMusicProcessing() {
  return musicProcessing;
}

export async function handleMusicJob(job) {
  if (MUSIC_BACKEND_MODE === 'comfyui') {
    return handleMusicJobComfy(job);
  }
  return handleMusicJobAce(job);
}

export async function processMusicQueue() {
  if (musicProcessing) return;
  musicProcessing = true;
  try {
    while (musicQueue.length > 0) {
      const job = musicQueue.shift();
      if (!job) continue;
      try {
        await handleMusicJob(job);
      } catch (e) {
        console.error(e);
        try { await job.interaction.editReply(`music error: ${e?.message || String(e)}`); } catch {}
      }
    }
  } finally {
    musicProcessing = false;
  }
}
