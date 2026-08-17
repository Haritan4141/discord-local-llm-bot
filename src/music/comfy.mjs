import fs from 'node:fs';
import { AttachmentBuilder } from 'discord.js';
import {
  ACE_POLL_MS_VALUE,
  COMFY_BASE_URL,
  COMFY_WORKFLOW_FILE,
  DISCORD_MAX_ATTACHMENT_BYTES,
  numEnv,
} from '../config.mjs';
import { sleep } from '../utils/http.mjs';
import { truncateText } from '../utils/text.mjs';

let comfyWorkflowTemplate = null;
let comfyWorkflowMtimeMs = 0;

export function loadComfyWorkflowTemplate() {
  if (!fs.existsSync(COMFY_WORKFLOW_FILE)) {
    throw new Error(`ComfyUI workflow not found: ${COMFY_WORKFLOW_FILE}`);
  }
  const stat = fs.statSync(COMFY_WORKFLOW_FILE);
  const mtime = Number(stat.mtimeMs || 0);
  if (comfyWorkflowTemplate && mtime === comfyWorkflowMtimeMs) {
    return comfyWorkflowTemplate;
  }
  const raw = fs.readFileSync(COMFY_WORKFLOW_FILE, 'utf-8');
  comfyWorkflowTemplate = JSON.parse(raw);
  comfyWorkflowMtimeMs = mtime;
  return comfyWorkflowTemplate;
}

export function cloneWorkflow(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function findNodeByType(nodes, type) {
  return nodes.find(n => n.type === type);
}

function findNodeByTitle(nodes, title) {
  return nodes.find(n => n.title === title);
}

function findApiNodeByClass(workflow, classType) {
  for (const key of Object.keys(workflow)) {
    const node = workflow[key];
    if (node?.class_type === classType) return node;
  }
  return null;
}

export function updateWorkflowForMusic(workflow, { prompt, lyrics, durationSec, bpm, language }) {
  const seed = Math.floor(Math.random() * 2147483647);
  const lang = (language || 'ja').trim() || 'ja';
  const safeDuration = Number.isFinite(durationSec) ? durationSec : 20;
  const finalBpm = Number.isFinite(bpm) ? bpm : null;

  if (Array.isArray(workflow.nodes)) {
    const nodes = workflow.nodes || [];
    const textNode = findNodeByType(nodes, 'TextEncodeAceStepAudio1.5');
    const seedNode = findNodeByTitle(nodes, 'seed');
    const durationNode = findNodeByTitle(nodes, 'Song Duration');
    const emptyLatent = findNodeByType(nodes, 'EmptyAceStep1.5LatentAudio');
    const sampler = findNodeByType(nodes, 'KSampler');
    const shiftNode = findNodeByType(nodes, 'ModelSamplingAuraFlow');

    if (textNode?.widgets_values) {
      textNode.widgets_values[0] = prompt || '';
      textNode.widgets_values[1] = lyrics || '';
      textNode.widgets_values[2] = seed;
      if (finalBpm !== null) textNode.widgets_values[4] = finalBpm;
      textNode.widgets_values[5] = safeDuration;
      textNode.widgets_values[6] = '4';
      textNode.widgets_values[7] = lang;
      textNode.widgets_values[8] = 'E minor';
    }

    if (seedNode?.widgets_values) {
      seedNode.widgets_values[0] = seed;
      seedNode.widgets_values[1] = 'fixed';
    }

    if (durationNode?.widgets_values) {
      durationNode.widgets_values[0] = safeDuration;
      durationNode.widgets_values[1] = 'fixed';
    }

    if (emptyLatent?.widgets_values) {
      emptyLatent.widgets_values[0] = safeDuration;
      emptyLatent.widgets_values[1] = 1;
    }

    if (sampler?.widgets_values) {
      sampler.widgets_values[0] = seed;
      sampler.widgets_values[1] = 'fixed';
      sampler.widgets_values[2] = 8;
      sampler.widgets_values[3] = 1.0;
      sampler.widgets_values[4] = 'euler';
      sampler.widgets_values[5] = 'simple';
      sampler.widgets_values[6] = 1.0;
    }

    if (shiftNode?.widgets_values) {
      shiftNode.widgets_values[0] = 3.0;
    }
    return;
  }

  const textNode = findApiNodeByClass(workflow, 'TextEncodeAceStepAudio1.5');
  const emptyLatent = findApiNodeByClass(workflow, 'EmptyAceStep1.5LatentAudio');
  const sampler = findApiNodeByClass(workflow, 'KSampler');
  const shiftNode = findApiNodeByClass(workflow, 'ModelSamplingAuraFlow');

  if (textNode?.inputs) {
    textNode.inputs.tags = prompt || '';
    textNode.inputs.lyrics = lyrics || '';
    textNode.inputs.seed = seed;
    if (finalBpm !== null) textNode.inputs.bpm = finalBpm;
    textNode.inputs.duration = safeDuration;
    textNode.inputs.timesignature = '4';
    textNode.inputs.language = lang;
    textNode.inputs.keyscale = 'E minor';
    if (textNode.inputs.cfg_scale === undefined) textNode.inputs.cfg_scale = 1.0;
    if (textNode.inputs.generate_audio_codes === undefined) textNode.inputs.generate_audio_codes = true;
    if (textNode.inputs.top_k === undefined) textNode.inputs.top_k = 0;
    if (textNode.inputs.temperature === undefined) textNode.inputs.temperature = 1.0;
    if (textNode.inputs.top_p === undefined) textNode.inputs.top_p = 0.9;
  }

  if (emptyLatent?.inputs) {
    emptyLatent.inputs.seconds = safeDuration;
    emptyLatent.inputs.batch_size = 1;
  }

  if (sampler?.inputs) {
    sampler.inputs.seed = seed;
    sampler.inputs.steps = 8;
    sampler.inputs.cfg = 1.0;
    sampler.inputs.sampler_name = 'euler';
    sampler.inputs.scheduler = 'simple';
    sampler.inputs.denoise = 1.0;
  }

  if (shiftNode?.inputs) {
    shiftNode.inputs.shift = 3.0;
  }
}

export async function comfySubmitPrompt(workflow) {
  const res = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `llmbot-${Date.now()}`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const promptId = json?.prompt_id;
  if (!promptId) {
    throw new Error(`ComfyUI error: prompt_id missing. response=${truncateText(JSON.stringify(json), 500)}`);
  }
  return promptId;
}

export async function comfyFetchHistory(promptId) {
  const res = await fetch(`${COMFY_BASE_URL}/history/${promptId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI history error: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

export function pickAudioFromHistory(history, promptId) {
  const entry = history?.[promptId] || history;
  const outputs = entry?.outputs || {};

  for (const key of Object.keys(outputs)) {
    const out = outputs[key];
    if (out?.audio?.length) return out.audio[0];
  }
  return null;
}

export async function comfyFetchAudio(file) {
  if (!file || !file.filename) {
    throw new Error('ComfyUI audio not found in history.');
  }
  const subfolder = file.subfolder || '';
  const type = file.type || 'output';
  const url = `${COMFY_BASE_URL}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI audio error: ${res.status} ${res.statusText}\n${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, filename: file.filename };
}

export async function comfyFreeMemory() {
  const res = await fetch(`${COMFY_BASE_URL}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      unload_models: true,
      free_memory: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI free memory error: ${res.status} ${res.statusText}\n${text}`);
  }
}

export async function handleMusicJobComfy(job) {
  const { interaction, prompt, durationSec } = job;
  const pollMs = Math.max(500, numEnv(ACE_POLL_MS_VALUE, 2000));
  const timeoutMs = 20 * 60 * 1000;

  try {
    await interaction.editReply(`music: generating... (${durationSec}s)`);
  } catch {}

  const template = loadComfyWorkflowTemplate();
  const workflow = cloneWorkflow(template);
  updateWorkflowForMusic(workflow, {
    prompt,
    lyrics: job.lyrics || '',
    durationSec,
    bpm: job.bpm,
    language: job.language,
  });

  const promptId = await comfySubmitPrompt(workflow);

  const started = Date.now();
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('music: timeout while waiting for result.');
    }
    await sleep(pollMs);
    const history = await comfyFetchHistory(promptId);
    const audio = pickAudioFromHistory(history, promptId);
    if (!audio) continue;

    const { buf, filename } = await comfyFetchAudio(audio);
    if (buf.length > DISCORD_MAX_ATTACHMENT_BYTES) {
      await interaction.editReply(
        `music: 生成は完了しましたが、ファイルサイズが Discord 上限を超えています (${Math.round(buf.length / 1024 / 1024)}MB)。duration を短くするか、bitrate の低い設定で再試行してください。`,
      );
      return;
    }
    const ext = (filename.split('.').pop() || 'mp3').toLowerCase();
    const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : 'mp3';
    const outName = `music_${Date.now()}.${safeExt}`;
    const file = new AttachmentBuilder(buf, { name: outName });
    const lyricText = (job.lyrics || '').trim();
    const lyricSnippet = lyricText.length > 80 ? `${lyricText.slice(0, 80)}…` : lyricText;
    const lyricLine = lyricSnippet ? ` | lyrics: ${lyricSnippet}` : '';
    const header = `music: done. duration=${durationSec}s | prompt: ${prompt}${lyricLine}`;

    await interaction.editReply({
      content: header,
      files: [file],
    });
    return;
  }
}
