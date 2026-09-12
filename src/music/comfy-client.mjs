import { randomUUID } from 'node:crypto';

export class MusicBackendError extends Error {
  constructor(message, code = 'MUSIC_BACKEND_ERROR', options) { super(message, options); this.code = code; }
}

export function createComfyClient(baseUrl, { fetchImpl = (...args) => fetch(...args), timeoutMs = 15000 } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  async function request(path, { body, binaryLimit, allowEmpty = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new MusicBackendError(`ComfyUI HTTP ${response.status}`);
      if (!binaryLimit) {
        // Official ComfyUI /free returns HTTP 200 with no response body.
        // Other endpoints must still provide valid JSON (especially /queue).
        if (allowEmpty) {
          const text = await response.text();
          return text.trim() ? JSON.parse(text) : null;
        }
        return await response.json();
      }
      const size = Number(response.headers.get('content-length') || 0);
      if (size > binaryLimit) {
        await response.body?.cancel();
        throw new MusicBackendError('Audio exceeds attachment limit', 'MUSIC_AUDIO_TOO_LARGE');
      }
      const chunks = []; let total = 0;
      if (!response.body) throw new MusicBackendError('Empty audio response');
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > binaryLimit) throw new MusicBackendError('Audio exceeds attachment limit', 'MUSIC_AUDIO_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
      if (!total) throw new MusicBackendError('Empty audio');
      return Buffer.concat(chunks, total);
    } finally { clearTimeout(timer); }
  }
  async function queue() {
    const value = await request('/queue');
    if (!Array.isArray(value?.queue_running) || !Array.isArray(value?.queue_pending)) {
      throw new MusicBackendError('Cannot establish server queue state', 'MUSIC_STATE_UNKNOWN');
    }
    return value;
  }
  async function assertIdle() {
    const state = await queue();
    if (state.queue_running.length || state.queue_pending.length) {
      throw new MusicBackendError('Music server has active or queued work', 'MUSIC_SERVER_BUSY');
    }
  }
  return {
    baseUrl: base, request, queue, assertIdle,
    async submit(workflow) {
      const result = await request('/prompt', { body: { prompt: workflow, client_id: `discord-music-${randomUUID()}` } });
      if (!result?.prompt_id || (result.node_errors && Object.keys(result.node_errors).length)) {
        throw new MusicBackendError('ComfyUI rejected workflow');
      }
      return result.prompt_id;
    },
    history: id => request(`/history/${encodeURIComponent(id)}`),
    async audio(file, limit) {
      if (!file?.filename || file.type !== 'output') throw new MusicBackendError('Invalid output reference');
      const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: 'output' });
      return request(`/view?${query}`, { binaryLimit: limit });
    },
    async free() {
      await assertIdle();
      // New Bot jobs are serialized with free by queue-engine; also respect ComfyUI UI submissions.
      return request('/free', { body: { unload_models: true, free_memory: true }, allowEmpty: true });
    },
  };
}
