import { AttachmentBuilder } from 'discord.js';
import {
  ACE_BASE_URL,
  ACE_KEY,
  ACE_POLL_MS_VALUE,
  DISCORD_MAX_ATTACHMENT_BYTES,
  numEnv,
} from '../config.mjs';
import { sleep } from '../utils/http.mjs';
import { truncateText } from '../utils/text.mjs';

function aceHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ACE_KEY) headers.Authorization = `Bearer ${ACE_KEY}`;
  return headers;
}

export async function aceReleaseTask({ prompt, durationSec, audioFormat, lyrics, bpm, language }) {
  const payload = {
    prompt,
    lyrics: lyrics || '',
    audio_duration: durationSec,
    audio_format: audioFormat || 'mp3',
    bpm: Number.isFinite(bpm) ? bpm : null,
    vocal_language: (language || 'ja').trim() || 'ja',
    time_signature: '4',
    key_scale: 'E minor',
    inference_steps: 8,
    guidance_scale: 1.0,
    shift: 3.0,
    batch_size: 1,
    thinking: false,
    sample_mode: false,
    use_format: false,
    use_cot_caption: false,
    use_cot_language: false,
  };

  const res = await fetch(`${ACE_BASE_URL}/release_task`, {
    method: 'POST',
    headers: aceHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ACE-Step error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw new Error(`ACE-Step error: task_id missing. response=${truncateText(JSON.stringify(json), 500)}`);
  }
  return {
    taskId,
    queuePosition: json?.data?.queue_position ?? null,
  };
}

export async function aceQueryResult(taskId) {
  const res = await fetch(`${ACE_BASE_URL}/query_result`, {
    method: 'POST',
    headers: aceHeaders(),
    body: JSON.stringify({ task_id_list: [taskId] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ACE-Step poll error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  if (!row) {
    throw new Error(`ACE-Step poll error: invalid response ${truncateText(JSON.stringify(json), 500)}`);
  }

  return {
    status: typeof row.status === 'number' ? row.status : 0,
    result: row.result || '',
  };
}

export function normalizeAceAudioUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/v1/audio?path=')) {
    return `${ACE_BASE_URL}${pathOrUrl}`;
  }
  return `${ACE_BASE_URL}/v1/audio?path=${encodeURIComponent(pathOrUrl)}`;
}

export async function aceFetchAudio(pathOrUrl) {
  const url = normalizeAceAudioUrl(pathOrUrl);
  const res = await fetch(url, { headers: ACE_KEY ? { Authorization: `Bearer ${ACE_KEY}` } : {} });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ACE-Step audio error: ${res.status} ${res.statusText}\n${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  return { buf, contentType: ct };
}

export async function handleMusicJobAce(job) {
  const { interaction, prompt, durationSec } = job;
  const pollMs = Math.max(500, numEnv(ACE_POLL_MS_VALUE, 2000));
  const timeoutMs = 20 * 60 * 1000;

  try {
    await interaction.editReply(`music: generating... (${durationSec}s)`);
  } catch {}

  const { taskId, queuePosition } = await aceReleaseTask({
    prompt,
    durationSec,
    audioFormat: 'mp3',
    lyrics: job.lyrics || '',
    bpm: job.bpm,
    language: job.language,
  });

  if (queuePosition && queuePosition > 1) {
    try {
      await interaction.editReply(`music: queued (position ${queuePosition}).`);
    } catch {}
  }

  const started = Date.now();
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('music: timeout while waiting for result.');
    }

    await sleep(pollMs);
    const { status, result } = await aceQueryResult(taskId);

    if (status === 0) continue;
    if (status === 2) throw new Error('music: generation failed.');

    let parsed = [];
    try {
      parsed = JSON.parse(result || '[]');
    } catch {}

    const item = Array.isArray(parsed) ? parsed[0] : null;
    const filePath = item?.file || '';
    if (!filePath) throw new Error('music: audio file path missing.');

    const { buf } = await aceFetchAudio(filePath);
    if (buf.length > DISCORD_MAX_ATTACHMENT_BYTES) {
      await interaction.editReply(
        `music: 生成は完了しましたが、ファイルサイズが Discord 上限を超えています (${Math.round(buf.length / 1024 / 1024)}MB)。duration を短くするか、bitrate の低い設定で再試行してください。`,
      );
      return;
    }
    const ext = (filePath.split('.').pop() || 'mp3').toLowerCase();
    const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : 'mp3';
    const filename = `music_${Date.now()}.${safeExt}`;

    const file = new AttachmentBuilder(buf, { name: filename });
    const meta = item?.metas?.duration ? `duration=${item.metas.duration}s` : `duration=${durationSec}s`;
    const promptText = item?.prompt || prompt;
    const lyricText = (job.lyrics || '').trim();
    const lyricSnippet = lyricText.length > 80 ? `${lyricText.slice(0, 80)}…` : lyricText;
    const lyricLine = lyricSnippet ? ` | lyrics: ${lyricSnippet}` : '';
    const header = `music: done. ${meta} | prompt: ${promptText}${lyricLine}`;

    await interaction.editReply({
      content: header,
      files: [file],
    });
    return;
  }
}
