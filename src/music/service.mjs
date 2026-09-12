import { createMusicQueue } from './queue-engine.mjs';

export function createMusicService({
  yue2Client, aceClient = null, aceBackend = 'comfyui', runYue2, runComfyAce, runApiAce,
  onError, idleDelayMs = 300000, ...timerOptions
}) {
  if (!['comfyui', 'ace'].includes(aceBackend)) throw new Error('Invalid MUSIC_BACKEND');
  const clients = new Map([['yue2', yue2Client], ...(aceClient ? [['ace-step', aceClient]] : [])]);
  const usedClients = new Set();
  let uncertainAceApi = false;
  return createMusicQueue({
    idleDelayMs, maxJobs: 5, ...timerOptions,
    async beforeJob(job) {
      await job.ready;
      if (job.cancelled) throw new Error('Music reply could not be prepared; generation cancelled');
      if (uncertainAceApi) throw Object.assign(new Error('Legacy ACE API job state unknown; administrator must check server before restarting Bot'), { code: 'MUSIC_STATE_UNKNOWN' });
      const selected = clients.get(job.model);
      for (const client of new Set(clients.values())) {
        try { await client.assertIdle(); }
        catch (error) {
          if (client === selected || usedClients.has(client) || ['MUSIC_SERVER_BUSY', 'MUSIC_STATE_UNKNOWN'].includes(error.code)) throw error;
          continue; // An unused, unavailable alternative does not prevent use of the selected server.
        }
        if (client !== selected && usedClients.has(client)) {
          if (await client.free() === false) throw Object.assign(new Error('Previous music server could not be released'), { code: 'MUSIC_SERVER_BUSY' });
          usedClients.delete(client);
        }
      }
      // The remote server may accept a request even if its HTTP response is lost.
      if (selected) usedClients.add(selected);
    },
    async runJob(job) {
      if (job.model === 'yue2') return runYue2(job);
      if (job.model !== 'ace-step') throw new Error('Invalid music model');
      if (aceBackend === 'comfyui') return runComfyAce(job);
      try { return await runApiAce(job); }
      catch (error) { uncertainAceApi = true; throw error; }
    },
    onError,
    async releaseIdle() {
      for (const client of usedClients) {
        try { if (await client.free() !== false) usedClients.delete(client); }
        catch (error) { console.warn('[music] Idle release skipped:', error.message); }
      }
      // Busy/temporarily unreachable servers are checked again after another idle interval.
      return usedClients.size === 0;
    },
  });
}
