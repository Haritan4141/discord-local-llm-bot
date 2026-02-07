import 'dotenv/config';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  Partials,
} from 'discord.js';


const {
  DISCORD_TOKEN,
  CHANNEL_IDS,
  OLLAMA_URL,
  OLLAMA_MODEL,
  SYSTEM_PROMPT,
  SD_WEBUI_URL,
  SD_STEPS,
  SD_CFG_SCALE,
  SD_WIDTH,
  SD_HEIGHT,
  SD_SAMPLER,
  SD_NEGATIVE_PROMPT,
  SD_BATCH_SIZE,
  SD_PROMPT_TRANSLATE,
  SD_PROMPT_TRANSLATE_MODEL,
  ACE_URL,
  ACE_POLL_MS,
  ACE_API_KEY,
  COMFY_URL,
  COMFY_WORKFLOW_PATH,
  MUSIC_BACKEND,

} = process.env;

const allowedChannelIds = new Set(
  (CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN が .env に設定されていません');
if (allowedChannelIds.size === 0) throw new Error('CHANNEL_IDS が .env に設定されていません');
if (!OLLAMA_URL) throw new Error('OLLAMA_URL が .env に設定されていません');
if (!OLLAMA_MODEL) throw new Error('OLLAMA_MODEL が .env に設定されていません');

const stateByChannel = new Map();
const musicQueue = [];
let musicProcessing = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * state = {
 *   paused: boolean,
 *   history: [{role, content}],
 *   queue: Array<QueueItem>,
 *   processing: boolean,
 * }
 *
 * QueueItem:
 *  - { kind: 'message', msg, name, text }
 *  - { kind: 'interaction', interaction, name, text, imageAtt }
 */

function getState(channelId) {
  if (!stateByChannel.has(channelId)) {
    stateByChannel.set(channelId, {
      paused: false,
      history: [
        {
          role: 'system',
          content:
            SYSTEM_PROMPT ||
            'You are a helpful assistant. Reply in Japanese, concise, and only when needed.',
        },
      ],
      queue: [],
      processing: false,
    });
  }
  return stateByChannel.get(channelId);
}

function trimHistory(hist, maxMessages = 30) {
  const sys = hist[0];
  const rest = hist.slice(1);
  const trimmed = rest.slice(-maxMessages);
  hist.length = 0;
  hist.push(sys, ...trimmed);
}

async function ollamaChat(messages) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || '';
}

function splitForDiscord(text, chunkSize = 1800) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks.length ? chunks : ['(empty)'];
}


// ======================
// ★ draw (AUTOMATIC1111) 画像生成
// ======================
const SD_URL = (SD_WEBUI_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');
const ACE_BASE_URL = (ACE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const ACE_KEY = ACE_API_KEY || process.env.ACESTEP_API_KEY;
const COMFY_BASE_URL = (COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const COMFY_WORKFLOW_FILE = COMFY_WORKFLOW_PATH
  ? COMFY_WORKFLOW_PATH
  : path.join(__dirname, 'comfyui', 'workflows', 'audio_ace_step_1_5_checkpoint_api.json');
const MUSIC_BACKEND_MODE = (MUSIC_BACKEND || 'comfyui').toLowerCase();
const SD_TRANSLATE_ENABLED = String(SD_PROMPT_TRANSLATE || "false").toLowerCase() === "true";
const SD_TRANSLATE_MODEL = SD_PROMPT_TRANSLATE_MODEL || OLLAMA_MODEL;

function numEnv(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function looksJapaneseText(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text || "");
}

async function translatePromptForSd(prompt) {
  if (!SD_TRANSLATE_ENABLED) return { prompt, translated: false };
  if (!looksJapaneseText(prompt)) return { prompt, translated: false };

  const messages = [
    {
      role: "system",
      content: "Translate the user's Stable Diffusion prompt into concise natural English. Return only the translated prompt text, no explanations, no quotes.",
    },
    { role: "user", content: prompt },
  ];

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SD_TRANSLATE_MODEL,
      messages,
      temperature: 0.0,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Prompt translation error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const translated = json?.choices?.[0]?.message?.content?.trim();
  if (!translated) return { prompt, translated: false };
  return { prompt: translated.replace(/^["']|["']$/g, ""), translated: true };
}


async function sdTxt2Img({ prompt, negativePrompt, width, height, steps, cfgScale, sampler, seed, batchSize }) {
  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    sampler_name: sampler,
    seed,
    batch_size: batchSize,
  };

  const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SD WebUI error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const images = Array.isArray(json?.images) ? json.images : [];

  return images; // base64 (png) strings
}

// ======================
// ★ music (ACE-Step)
// ======================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function aceHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ACE_KEY) headers.Authorization = `Bearer ${ACE_KEY}`;
  return headers;
}

async function aceReleaseTask({ prompt, durationSec, audioFormat, lyrics, bpm, language }) {
  const payload = {
    prompt,
    lyrics: lyrics || "",
    audio_duration: durationSec,
    audio_format: audioFormat || "mp3",
    bpm: Number.isFinite(bpm) ? bpm : null,
    vocal_language: (language || "ja").trim() || "ja",
    time_signature: "4",
    key_scale: "E minor",
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
    method: "POST",
    headers: aceHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ACE-Step error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw new Error(`ACE-Step error: task_id missing. response=${JSON.stringify(json)}`);
  }
  return {
    taskId,
    queuePosition: json?.data?.queue_position ?? null,
  };
}

async function aceQueryResult(taskId) {
  const res = await fetch(`${ACE_BASE_URL}/query_result`, {
    method: "POST",
    headers: aceHeaders(),
    body: JSON.stringify({ task_id_list: [taskId] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ACE-Step poll error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  if (!row) {
    throw new Error(`ACE-Step poll error: invalid response ${JSON.stringify(json)}`);
  }

  return {
    status: typeof row.status === "number" ? row.status : 0,
    result: row.result || "",
  };
}

function normalizeAceAudioUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("/v1/audio?path=")) {
    return `${ACE_BASE_URL}${pathOrUrl}`;
  }
  return `${ACE_BASE_URL}/v1/audio?path=${encodeURIComponent(pathOrUrl)}`;
}

async function aceFetchAudio(pathOrUrl) {
  const url = normalizeAceAudioUrl(pathOrUrl);
  const res = await fetch(url, { headers: ACE_KEY ? { Authorization: `Bearer ${ACE_KEY}` } : {} });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ACE-Step audio error: ${res.status} ${res.statusText}\n${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  return { buf, contentType: ct };
}

// ======================
// ★ music (ComfyUI)
// ======================
let comfyWorkflowTemplate = null;

function loadComfyWorkflowTemplate() {
  if (comfyWorkflowTemplate) return comfyWorkflowTemplate;
  if (!fs.existsSync(COMFY_WORKFLOW_FILE)) {
    throw new Error(`ComfyUI workflow not found: ${COMFY_WORKFLOW_FILE}`);
  }
  const raw = fs.readFileSync(COMFY_WORKFLOW_FILE, 'utf-8');
  const json = JSON.parse(raw);
  comfyWorkflowTemplate = json;
  return comfyWorkflowTemplate;
}

function cloneWorkflow(obj) {
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

function updateWorkflowForMusic(workflow, { prompt, lyrics, durationSec, bpm, language }) {
  const seed = Math.floor(Math.random() * 2147483647);
  const lang = (language || "ja").trim() || "ja";
  const safeDuration = Number.isFinite(durationSec) ? durationSec : 20;
  const finalBpm = Number.isFinite(bpm) ? bpm : null;

  // UI workflow format (nodes/links)
  if (Array.isArray(workflow.nodes)) {
    const nodes = workflow.nodes || [];
    const textNode = findNodeByType(nodes, "TextEncodeAceStepAudio1.5");
    const seedNode = findNodeByTitle(nodes, "seed");
    const durationNode = findNodeByTitle(nodes, "Song Duration");
    const emptyLatent = findNodeByType(nodes, "EmptyAceStep1.5LatentAudio");
    const sampler = findNodeByType(nodes, "KSampler");
    const shiftNode = findNodeByType(nodes, "ModelSamplingAuraFlow");

    if (textNode?.widgets_values) {
      textNode.widgets_values[0] = prompt || "";
      textNode.widgets_values[1] = lyrics || "";
      textNode.widgets_values[2] = seed;
      if (finalBpm !== null) textNode.widgets_values[4] = finalBpm;
      textNode.widgets_values[5] = safeDuration;
      textNode.widgets_values[6] = "4";
      textNode.widgets_values[7] = lang;
      textNode.widgets_values[8] = "E minor";
    }

    if (seedNode?.widgets_values) {
      seedNode.widgets_values[0] = seed;
      seedNode.widgets_values[1] = "fixed";
    }

    if (durationNode?.widgets_values) {
      durationNode.widgets_values[0] = safeDuration;
      durationNode.widgets_values[1] = "fixed";
    }

    if (emptyLatent?.widgets_values) {
      emptyLatent.widgets_values[0] = safeDuration;
      emptyLatent.widgets_values[1] = 1;
    }

    if (sampler?.widgets_values) {
      sampler.widgets_values[0] = seed;
      sampler.widgets_values[1] = "fixed";
      sampler.widgets_values[2] = 8;
      sampler.widgets_values[3] = 1.0;
      sampler.widgets_values[4] = "euler";
      sampler.widgets_values[5] = "simple";
      sampler.widgets_values[6] = 1.0;
    }

    if (shiftNode?.widgets_values) {
      shiftNode.widgets_values[0] = 3.0;
    }
    return;
  }

  // API workflow format (node_id: {class_type, inputs})
  const textNode = findApiNodeByClass(workflow, "TextEncodeAceStepAudio1.5");
  const emptyLatent = findApiNodeByClass(workflow, "EmptyAceStep1.5LatentAudio");
  const sampler = findApiNodeByClass(workflow, "KSampler");
  const shiftNode = findApiNodeByClass(workflow, "ModelSamplingAuraFlow");

  if (textNode?.inputs) {
    textNode.inputs.tags = prompt || "";
    textNode.inputs.lyrics = lyrics || "";
    textNode.inputs.seed = seed;
    if (finalBpm !== null) textNode.inputs.bpm = finalBpm;
    textNode.inputs.duration = safeDuration;
    textNode.inputs.timesignature = "4";
    textNode.inputs.language = lang;
    textNode.inputs.keyscale = "E minor";
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
    sampler.inputs.sampler_name = "euler";
    sampler.inputs.scheduler = "simple";
    sampler.inputs.denoise = 1.0;
  }

  if (shiftNode?.inputs) {
    shiftNode.inputs.shift = 3.0;
  }
}

async function comfySubmitPrompt(workflow) {
  const res = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `llmbot-${Date.now()}`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI error: ${res.status} ${res.statusText}\n${text}`);
  }

  const json = await res.json();
  const promptId = json?.prompt_id;
  if (!promptId) {
    throw new Error(`ComfyUI error: prompt_id missing. response=${JSON.stringify(json)}`);
  }
  return promptId;
}

async function comfyFetchHistory(promptId) {
  const res = await fetch(`${COMFY_BASE_URL}/history/${promptId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI history error: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

function pickAudioFromHistory(history, promptId) {
  const entry = history?.[promptId] || history;
  const outputs = entry?.outputs || {};

  for (const key of Object.keys(outputs)) {
    const out = outputs[key];
    if (out?.audio?.length) return out.audio[0];
  }
  return null;
}

async function comfyFetchAudio(file) {
  if (!file || !file.filename) {
    throw new Error("ComfyUI audio not found in history.");
  }
  const subfolder = file.subfolder || "";
  const type = file.type || "output";
  const url = `${COMFY_BASE_URL}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI audio error: ${res.status} ${res.statusText}\n${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, filename: file.filename };
}

async function handleMusicJobComfy(job) {
  const { interaction, prompt, durationSec } = job;
  const pollMs = Math.max(500, numEnv(ACE_POLL_MS, 2000));
  const timeoutMs = 20 * 60 * 1000;

  try {
    await interaction.editReply(`music: generating... (${durationSec}s)`);
  } catch {}

  const template = loadComfyWorkflowTemplate();
  const workflow = cloneWorkflow(template);
  updateWorkflowForMusic(workflow, {
    prompt,
    lyrics: job.lyrics || "",
    durationSec,
    bpm: job.bpm,
    language: job.language,
  });

  const promptId = await comfySubmitPrompt(workflow);

  const started = Date.now();
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("music: timeout while waiting for result.");
    }
    await sleep(pollMs);
    const history = await comfyFetchHistory(promptId);
    const audio = pickAudioFromHistory(history, promptId);
    if (!audio) continue;

    const { buf, filename } = await comfyFetchAudio(audio);
    const ext = (filename.split(".").pop() || "mp3").toLowerCase();
    const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : "mp3";
    const outName = `music_${Date.now()}.${safeExt}`;
    const file = new AttachmentBuilder(buf, { name: outName });
    const lyricText = (job.lyrics || "").trim();
    const lyricSnippet = lyricText.length > 80 ? `${lyricText.slice(0, 80)}…` : lyricText;
    const lyricLine = lyricSnippet ? ` | lyrics: ${lyricSnippet}` : "";
    const header = `music: done. duration=${durationSec}s | prompt: ${prompt}${lyricLine}`;

    await interaction.editReply({
      content: header,
      files: [file],
    });
    return;
  }
}

async function handleMusicJobAce(job) {
  const { interaction, prompt, durationSec } = job;
  const pollMs = Math.max(500, numEnv(ACE_POLL_MS, 2000));
  const timeoutMs = 20 * 60 * 1000;

  try {
    await interaction.editReply(`music: generating... (${durationSec}s)`);
  } catch {}

  const { taskId, queuePosition } = await aceReleaseTask({
    prompt,
    durationSec,
    audioFormat: "mp3",
    lyrics: job.lyrics || "",
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
      throw new Error("music: timeout while waiting for result.");
    }

    await sleep(pollMs);
    const { status, result } = await aceQueryResult(taskId);

    if (status === 0) {
      continue;
    }
    if (status === 2) {
      throw new Error("music: generation failed.");
    }

    let parsed = [];
    try {
      parsed = JSON.parse(result || "[]");
    } catch {}

    const item = Array.isArray(parsed) ? parsed[0] : null;
    const filePath = item?.file || "";
    if (!filePath) {
      throw new Error("music: audio file path missing.");
    }

    const { buf, contentType } = await aceFetchAudio(filePath);
    const ext = (filePath.split(".").pop() || "mp3").toLowerCase();
    const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : "mp3";
    const filename = `music_${Date.now()}.${safeExt}`;

    const file = new AttachmentBuilder(buf, { name: filename });
    const meta = item?.metas?.duration ? `duration=${item.metas.duration}s` : `duration=${durationSec}s`;
    const promptText = item?.prompt || prompt;
    const lyricText = (job.lyrics || "").trim();
    const lyricSnippet = lyricText.length > 80 ? `${lyricText.slice(0, 80)}…` : lyricText;
    const lyricLine = lyricSnippet ? ` | lyrics: ${lyricSnippet}` : "";
    const header = `music: done. ${meta} | prompt: ${promptText}${lyricLine}`;

    await interaction.editReply({
      content: header,
      files: [file],
    });
    return;
  }
}

async function handleMusicJob(job) {
  if (MUSIC_BACKEND_MODE === "comfyui") {
    return handleMusicJobComfy(job);
  }
  return handleMusicJobAce(job);
}

async function processMusicQueue() {
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


// ======================
// Othello (VS AI)
// ======================

const OTHELLO_SIZE = 8;
const OTHELLO_EMPTY = 0;
const OTHELLO_PLAYER = 1; // player (black)
const OTHELLO_AI = 2; // AI (white)
const OTHELLO_DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

const othelloGames = new Map(); // gameId -> game
const othelloMessageToGame = new Map(); // messageId -> gameId (reaction mode)

function createOthelloBoard() {
  const b = Array.from({ length: OTHELLO_SIZE }, () => Array(OTHELLO_SIZE).fill(OTHELLO_EMPTY));
  const mid = OTHELLO_SIZE / 2;
  b[mid - 1][mid - 1] = OTHELLO_AI;
  b[mid][mid] = OTHELLO_AI;
  b[mid - 1][mid] = OTHELLO_PLAYER;
  b[mid][mid - 1] = OTHELLO_PLAYER;
  return b;
}

function inBounds(r, c) {
  return r >= 0 && r < OTHELLO_SIZE && c >= 0 && c < OTHELLO_SIZE;
}

function otherColor(color) {
  return color === OTHELLO_PLAYER ? OTHELLO_AI : OTHELLO_PLAYER;
}

function getFlips(board, r, c, color) {
  if (!inBounds(r, c) || board[r][c] !== OTHELLO_EMPTY) return [];
  const opp = otherColor(color);
  const flips = [];
  for (const [dr, dc] of OTHELLO_DIRS) {
    let rr = r + dr;
    let cc = c + dc;
    const line = [];
    while (inBounds(rr, cc) && board[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length && inBounds(rr, cc) && board[rr][cc] === color) {
      flips.push(...line);
    }
  }
  return flips;
}

function getLegalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      const flips = getFlips(board, r, c, color);
      if (flips.length) moves.push({ r, c, flips });
    }
  }
  return moves;
}

function applyMove(board, color, move) {
  board[move.r][move.c] = color;
  for (const [rr, cc] of move.flips) {
    board[rr][cc] = color;
  }
}

function countPieces(board) {
  let black = 0;
  let white = 0;
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      if (board[r][c] === OTHELLO_PLAYER) black += 1;
      else if (board[r][c] === OTHELLO_AI) white += 1;
    }
  }
  return { black, white };
}

function isBoardFull(board) {
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      if (board[r][c] === OTHELLO_EMPTY) return false;
    }
  }
  return true;
}

function cloneBoard(board) {
  return board.map(row => row.slice());
}

function evaluateBoard(board) {
  const { black, white } = countPieces(board);
  const diff = black - white;
  const corners = [
    board[0][0], board[0][OTHELLO_SIZE - 1],
    board[OTHELLO_SIZE - 1][0], board[OTHELLO_SIZE - 1][OTHELLO_SIZE - 1],
  ];
  let cornerScore = 0;
  for (const v of corners) {
    if (v === OTHELLO_PLAYER) cornerScore += 25;
    else if (v === OTHELLO_AI) cornerScore -= 25;
  }
  const mobility = getLegalMoves(board, OTHELLO_PLAYER).length - getLegalMoves(board, OTHELLO_AI).length;
  return diff + cornerScore + mobility;
}

function chooseAiMove(board, moves, difficulty) {
  if (!moves.length) return null;

  if (difficulty === "easy") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (difficulty === "normal") {
    return moves.reduce((best, m) => (m.flips.length > best.flips.length ? m : best), moves[0]);
  }

  if (difficulty === "hard") {
    const corners = new Set(["0,0", `0,${OTHELLO_SIZE - 1}`, `${OTHELLO_SIZE - 1},0`, `${OTHELLO_SIZE - 1},${OTHELLO_SIZE - 1}`]);
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const key = `${m.r},${m.c}`;
      let score = m.flips.length;
      if (corners.has(key)) score += 20;
      if (m.r === 0 || m.r === OTHELLO_SIZE - 1 || m.c === 0 || m.c === OTHELLO_SIZE - 1) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  const maxDepth = 3;
  function minimax(boardState, color, depth, alpha, beta) {
    const legal = getLegalMoves(boardState, color);
    if (depth === 0 || isBoardFull(boardState) || (legal.length === 0 && getLegalMoves(boardState, otherColor(color)).length === 0)) {
      return evaluateBoard(boardState);
    }
    if (legal.length === 0) {
      return minimax(boardState, otherColor(color), depth - 1, alpha, beta);
    }
    if (color === OTHELLO_AI) {
      let best = -Infinity;
      for (const m of legal) {
        const next = cloneBoard(boardState);
        applyMove(next, color, m);
        best = Math.max(best, minimax(next, otherColor(color), depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of legal) {
      const next = cloneBoard(boardState);
      applyMove(next, color, m);
      best = Math.min(best, minimax(next, otherColor(color), depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = cloneBoard(board);
    applyMove(next, OTHELLO_AI, m);
    const score = minimax(next, OTHELLO_PLAYER, maxDepth - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

function formatOthelloStatus(game) {
  const { black, white } = countPieces(game.board);
  const turn = game.current === OTHELLO_PLAYER ? "あなた (黒)" : "AI (白)";
  const diffLabel = {
    easy: "弱め",
    normal: "普通",
    hard: "強め",
    max: "最強",
  }[game.difficulty] || game.difficulty;
  const note = game.note ? `\n${game.note}` : "";
  return `オセロ (VS AI) | AI: ${diffLabel} | 操作: リアクション\n手番: ${turn}\n黒 ${black} - 白 ${white}${note}`;
}


const OTHELLO_RENDER = { size: 8, cell: 48, pad: 8 };
const OTHELLO_DIGITS = [
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "001", "001", "001"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
];

let OTHELLO_CRC_TABLE = null;
function crc32(buf) {
  if (!OTHELLO_CRC_TABLE) {
    OTHELLO_CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      OTHELLO_CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ OTHELLO_CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcBuf);
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc >>> 0);
  return Buffer.concat([len, typeBuf, data, crcOut]);
}

function setPixel(buf, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function fillRect(buf, width, height, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      setPixel(buf, width, xx, yy, color[0], color[1], color[2], color[3]);
    }
  }
}

function drawCircle(buf, width, height, cx, cy, r, color) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) {
          setPixel(buf, width, x, y, color[0], color[1], color[2], color[3]);
        }
      }
    }
  }
}

function drawDigit(buf, width, height, cx, cy, digit, color) {
  const pattern = OTHELLO_DIGITS[digit];
  if (!pattern) return;
  const scale = 4;
  const w = 3 * scale;
  const h = 5 * scale;
  const startX = Math.round(cx - w / 2);
  const startY = Math.round(cy - h / 2);
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (pattern[r][c] === "1") {
        fillRect(buf, width, height, startX + c * scale, startY + r * scale, scale, scale, color);
      }
    }
  }
}

function encodePng(width, height, rgba) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = deflateSync(raw);
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([header, ...chunks]);
}

function renderOthelloPng(board, moveLabels = new Map()) {
  const size = OTHELLO_RENDER.size;
  const cell = OTHELLO_RENDER.cell;
  const pad = OTHELLO_RENDER.pad;
  const width = pad * 2 + cell * size;
  const height = pad * 2 + cell * size;
  const bg = [46, 125, 50, 255];
  const grid = [27, 94, 32, 255];
  const black = [17, 17, 17, 255];
  const white = [245, 245, 245, 255];
  const whiteStroke = [187, 187, 187, 255];
  const mark = [25, 118, 210, 255];
  const markText = [255, 255, 255, 255];
  const img = Buffer.alloc(width * height * 4);
  fillRect(img, width, height, 0, 0, width, height, bg);

  const boardSize = cell * size;
  const x0 = pad;
  const y0 = pad;
  const line = 2;
  for (let i = 0; i <= size; i++) {
    const y = y0 + i * cell;
    fillRect(img, width, height, x0, y, boardSize, line, grid);
    const x = x0 + i * cell;
    fillRect(img, width, height, x, y0, line, boardSize, grid);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cx = x0 + c * cell + Math.floor(cell / 2);
      const cy = y0 + r * cell + Math.floor(cell / 2);
      const v = board[r][c];
      if (v === OTHELLO_PLAYER) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), black);
      } else if (v === OTHELLO_AI) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), white);
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35) - 2, whiteStroke);
      }
      const key = `${r},${c}`;
      if (moveLabels.has(key)) {
        const label = String(moveLabels.get(key));
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.28), mark);
        if (/^[0-9]$/.test(label)) {
          drawDigit(img, width, height, cx, cy, Number(label), markText);
        }
      }
    }
  }

  return encodePng(width, height, img);
}

function getReactionMoves(game) {
  const playerMoves = getLegalMoves(game.board, OTHELLO_PLAYER);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(playerMoves.length / pageSize));
  const page = Math.min(game.reactionPage || 0, totalPages - 1);
  const slice = playerMoves.slice(page * pageSize, page * pageSize + pageSize);
  return { playerMoves, slice, page, totalPages };
}

async function notifyReactionPermission(game, message) {
  if (game.reactionPermissionWarned) return;
  game.reactionPermissionWarned = true;
  try {
    await message.channel.send(
      "⚠️ リアクションを付与する権限がありません。権限: メッセージにリアクション / リアクションの管理 を付与してください。"
    );
  } catch {}
}

async function syncReactionControls(game, message, sliceLen, page, totalPages) {
  if (game.reactionDisabled) return;
  const digits = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  const desired = [];
  const count = Math.min(sliceLen, digits.length);
  for (let i = 0; i < count; i++) desired.push(digits[i]);
  if (totalPages > 1 && page > 0) desired.push("◀️");
  if (totalPages > 1 && page < totalPages - 1) desired.push("▶️");

  const botId = message.client?.user?.id;

  for (let pass = 0; pass < 2; pass++) {
    const fresh = pass === 0 ? message : await message.fetch().catch(() => message);
    const cache = fresh.reactions.cache;
    let missing = false;

    for (const emoji of desired) {
      const reaction = cache.get(emoji);
      if (reaction?.me) continue;
      missing = true;
      try {
        await fresh.react(emoji);
      } catch (e) {
        if (e?.code === 50013) {
          game.reactionDisabled = true;
          await notifyReactionPermission(game, message);
          return;
        }
      }
    }

    if (!missing || pass === 1) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  if (botId) {
    const cache = message.reactions.cache;
    for (const [emoji, reaction] of cache) {
      if (desired.includes(emoji)) continue;
      if (!reaction.me) continue;
      try {
        await reaction.users.remove(botId);
      } catch (e) {
        if (e?.code === 50013) {
          game.reactionDisabled = true;
          await notifyReactionPermission(game, message);
          return;
        }
      }
    }
  }
}

async function updateReactionGame(game, channel) {
  const { slice, page, totalPages } = getReactionMoves(game);
  const labels = new Map();
  slice.forEach((m, idx) => {
    labels.set(`${m.r},${m.c}`, `${idx}`);
  });
  const file = new AttachmentBuilder(renderOthelloPng(game.board, labels), { name: `othello_${game.id}.png` });

  const list = slice.map((m, idx) => `${idx}: ${String.fromCharCode(65 + m.c)}${m.r + 1}`).join(" ");
  const pageText = `page ${page + 1}/${totalPages}`;
  const msg = await channel.messages.fetch(game.reactionMessageId).catch(() => null);
  if (msg) {
    await msg.edit({
      content: `${formatOthelloStatus(game)}\n${pageText}\n${list || ""}`,
      files: [file],
    });
    const stateKey = `${slice.length}:${page}:${totalPages}`;
    if (!game.reactionDisabled && game.reactionStateKey !== stateKey) {
      game.reactionStateKey = stateKey;
      await syncReactionControls(game, msg, slice.length, page, totalPages);
    }
  }
}

function checkGameEnd(game) {
  const playerMoves = getLegalMoves(game.board, OTHELLO_PLAYER);
  const aiMoves = getLegalMoves(game.board, OTHELLO_AI);
  if (isBoardFull(game.board) || (playerMoves.length === 0 && aiMoves.length === 0)) {
    game.ended = true;
    const { black, white } = countPieces(game.board);
    if (black > white) game.note = "勝利: あなた (黒)";
    else if (white > black) game.note = "勝利: AI (白)";
    else game.note = "引き分け";
    if (game.reactionMessageId) {
      othelloMessageToGame.delete(game.reactionMessageId);
    }
    return true;
  }
  return false;
}

function runAiIfNeeded(game) {
  let note = "";
  let loopGuard = 0;
  while (!game.ended && loopGuard < 10) {
    loopGuard += 1;
    if (checkGameEnd(game)) break;
    const moves = getLegalMoves(game.board, game.current);
    if (moves.length === 0) {
      note = game.current === OTHELLO_PLAYER ? "パス: あなた (黒)" : "パス: AI (白)";
      game.current = otherColor(game.current);
      continue;
    }
    if (game.current === OTHELLO_AI) {
      const m = chooseAiMove(game.board, moves, game.difficulty);
      if (m) applyMove(game.board, OTHELLO_AI, m);
      game.current = OTHELLO_PLAYER;
      continue;
    }
    break;
  }
  if (note) game.note = note;
}

function getOthelloGame(gameId) {
  return othelloGames.get(gameId) || null;
}

async function handlePlayerMove(game, move) {
  if (game.locked) return { ok: false, message: "他の操作中です。少し待ってください。" };
  if (game.ended) return { ok: false, message: "対局は終了しました。" };
  if (game.current !== OTHELLO_PLAYER) return { ok: false, message: "AIの手番です。" };
  const legal = getLegalMoves(game.board, OTHELLO_PLAYER);
  const target = legal.find(m => m.r === move.r && m.c === move.c);
  if (!target) return { ok: false, message: "そこには置けません。" };

  game.locked = true;
  try {
    applyMove(game.board, OTHELLO_PLAYER, target);
    game.current = OTHELLO_AI;
    game.note = "";
    runAiIfNeeded(game);
    return { ok: true };
  } finally {
    game.locked = false;
  }
}

async function startOthelloGame(interaction, difficulty) {
  const gameId = Math.random().toString(36).slice(2, 10);
  const game = {
    id: gameId,
    channelId: interaction.channelId,
    playerId: interaction.user.id,
    difficulty,
    board: createOthelloBoard(),
    current: OTHELLO_PLAYER,
    ended: false,
    locked: false,
    note: "",
    reactionMessageId: null,
    reactionPage: 0,
    reactionStateKey: "",
    reactionDisabled: false,
    reactionPermissionWarned: false,
  };
  othelloGames.set(gameId, game);

  try {
    await interaction.reply({
      content: `オセロを開始しました。AI=${difficulty}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) return;
  }

  const channel = interaction.channel;
  const msg = await channel.send({ content: formatOthelloStatus(game) });
  game.reactionMessageId = msg.id;
  othelloMessageToGame.set(msg.id, gameId);
  await updateReactionGame(game, channel);
}

// ======================
// ★ 画像対応ヘルパー
// ======================
function pickImageFromInteraction(interaction) {
  const att = interaction.options.getAttachment("image");
  if (!att) return null;

  const url = att.url || "";
  const ct = att.contentType || "";

  const looksImageByType = typeof ct === "string" && ct.startsWith("image/");
  const looksImageByExt = /\.(png|jpe?g|webp|gif)$/i.test(url);
  if (!looksImageByType && !looksImageByExt) return null;

  return {
    url,
    contentType: looksImageByType ? ct : null,
    size: typeof att.size === "number" ? att.size : null,
    name: att.name || null,
  };
}

function pickFirstImageAttachment(msg) {
  const att = msg.attachments?.first?.();
  if (!att) return null;

  const url = att.url || '';
  const ct = att.contentType || '';

  // DiscordのcontentTypeが入ることもあるが、入らないこともあるので拡張子でも判定
  const looksImageByType = typeof ct === 'string' && ct.startsWith('image/');
  const looksImageByExt = /\.(png|jpe?g|webp|gif)$/i.test(url);

  if (!looksImageByType && !looksImageByExt) return null;

  return {
    url,
    contentType: looksImageByType ? ct : null,
    size: typeof att.size === 'number' ? att.size : null,
    name: att.name || null,
  };
}

function guessMimeFromUrl(url) {
  if (/\.png$/i.test(url)) return 'image/png';
  if (/\.jpe?g$/i.test(url)) return 'image/jpeg';
  if (/\.webp$/i.test(url)) return 'image/webp';
  if (/\.gif$/i.test(url)) return 'image/gif';
  return 'image/png';
}

async function fetchAsDataUrl(url, contentTypeHint, maxBytes = 10 * 1024 * 1024) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像取得に失敗: ${res.status} ${res.statusText}`);

  // サイズが取れるなら軽くガード（Discord添付は大きいとLLMが重い）
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(len / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`画像が大きすぎます（${Math.round(buf.length / 1024 / 1024)}MB）。もう少し小さくしてね。`);
  }

  const mime = contentTypeHint || res.headers.get('content-type') || guessMimeFromUrl(url);
  const base64 = buf.toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ======================
// 即レス（キュー）処理
// ======================
// ======================
// 即レス（キュー）処理：message / slash を完全直列化
// ======================
async function processQueue(channelId) {
  const st = getState(channelId);
  if (st.processing) return;
  st.processing = true;

  try {
    while (st.queue.length > 0) {
      if (st.paused) {
        st.queue.length = 0;
        return;
      }

      const item = st.queue.shift();

      // item から「返信API」を抽象化（message と interaction の違いを吸収）
      const api = (() => {
        if (item.kind === "interaction") {
          const interaction = item.interaction;
          return {
            kind: "interaction",
            channel: interaction.channel,
            // deferReply() 済みを想定（/chat 側で defer する）
            typing: async () => {}, // interaction は “考え中” 表示が出るので基本不要
            replyFirst: async (text) => interaction.editReply(text),
            sendMore: async (text) => interaction.followUp(text),
            onError: async (msg) => {
              try { await interaction.editReply(`⚠️ エラー: ${msg}`); } catch {}
            },
          };
        }

        // kind === "message"
        const msg = item.msg;
        return {
          kind: "message",
          channel: msg.channel,
          typing: async () => msg.channel.sendTyping(),
          replyFirst: async (text) => msg.reply(text),
          sendMore: async (text) => msg.channel.send(text),
          onError: async (msgText) => {
            try { await msg.reply(`⚠️ エラー: ${msgText}`); } catch {}
          },
        };
      })();

      const name = item.name;
      const text = item.text || "";

      // ★画像：message は添付から拾う / interaction は item.imageAtt を使う
      const imageAtt =
        item.kind === "interaction"
          ? (item.imageAtt || null)
          : pickFirstImageAttachment(item.msg);

      try {
        // 履歴には「画像あり」の印だけ残す（base64を残すと履歴が爆増するため）
        const userChunkForHistory = imageAtt
          ? `[画像あり] ${name}: ${text || "(画像)"}`
          : `${name}: ${text}`;

        st.history.push({ role: "user", content: userChunkForHistory });
        trimHistory(st.history, 30);

        await api.typing();

        // 送信は、画像があるときだけ「このターンだけ」vision形式で投げる
        let reply = "";
        if (imageAtt) {
          const dataUrl = await fetchAsDataUrl(imageAtt.url, imageAtt.contentType);

          // OpenAI互換: content を配列にして image_url を付ける
          const visionUserMessage = {
            role: "user",
            content: [
              { type: "text", text: `${name}: ${text || "この画像について説明して"}` },
              { type: "image_url", image_url: dataUrl },
            ],
          };

          // st.historyの末尾（さっき積んだ userChunkForHistory）を置き換えて送る
          // ※履歴自体は軽いまま維持しつつ、送信時だけ画像を添付するため
          const messagesToSend = [
            ...st.history.slice(0, -1),
            visionUserMessage,
          ];

          reply = await ollamaChat(messagesToSend);
        } else {
          reply = await ollamaChat(st.history);
        }

        const cleaned = (reply || "").trim();
        if (!cleaned) continue;

        st.history.push({ role: "assistant", content: cleaned });
        trimHistory(st.history, 30);

        // 返信（1通目は返信、2通目以降は追加送信）
        const parts = splitForDiscord(cleaned);
        await api.replyFirst(parts[0]);
        for (let i = 1; i < parts.length; i++) {
          await api.sendMore(parts[i]);
        }
      } catch (e) {
        console.error(e);
        await api.onError(e?.message || String(e));
      }
    }
  } finally {
    st.processing = false;
  }
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Allowed channels: ${[...allowedChannelIds].join(', ')}`);
  console.log(`✅ Model: ${OLLAMA_MODEL}`);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!allowedChannelIds.has(msg.channelId)) return;

  const st = getState(msg.channelId);

  const name = msg.member?.displayName || msg.author.username;
  st.queue.push({ kind: "message", msg, name, text: msg.content });

  try {
    await processQueue(msg.channelId);
  } catch (e) {
    console.error(e);
    try { await msg.reply(`エラー: ${e.message}`); } catch {}
  }
});

// ================================
// スラッシュコマンド用
// ================================

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    // チャンネル制限（既存と同じ）
    if (!allowedChannelIds.has(interaction.channelId)) {
      await interaction.reply({
        content: "❌ このチャンネルでは使用できません",
        flags: MessageFlags.Ephemeral, // ← ephemeral警告対策
      });
      return;
    }

    // ★既存設計：チャンネルごとの状態
    const st = getState(interaction.channelId);

    if (interaction.commandName === "help") {
      await interaction.reply(
        [
          "🧠 **LLMBot ヘルプ**",
          "",
          "**スラッシュコマンド**",
          "• `/help` : このヘルプを表示",
          "• `/status` : Botの状態確認",
          "• `/draw` : Stable Diffusion WebUI で画像生成",
          "• `/music` : ComfyUI で音楽生成",
          "• `/chat <message> <image>` : LLMと会話",
          "• `/persona <text>` : 人格を変更",
          "• `/persona-show` : 現在のpersonaを表示",
          "• `/othello [difficulty]` : オセロ開始（リアクション操作）",
          "• `/pause` : 応答を一時停止",
          "• `/resume` : 応答を再開",
          "• `/reset` : 会話履歴をリセット",
          "",
        ].join("\n")
      );
      return;
    }

    if (interaction.commandName === "status") {
      const histLen = st.history?.length ?? 0;
      const paused = !!st.paused;
      const queueLen = st.queue?.length ?? 0;

      await interaction.reply(
        [
          "📊 **LLMBot ステータス**",
          `• paused: \`${paused}\``,
          `• model: \`${process.env.OLLAMA_MODEL}\``,
          `• history: \`${histLen}\` messages`,
          `• queue: \`${queueLen}\``,
          `• channel: <#${interaction.channelId}>`,
        ].join("\n")
      );
      return;
    }

    if (interaction.commandName === "pause") {
      st.paused = true;
      await interaction.reply("了解、このチャンネルでは黙るね（paused）");
      return;
    }

    if (interaction.commandName === "resume") {
      st.paused = false;
      await interaction.reply("再開するね（resume）");
      return;
    }

    if (interaction.commandName === "reset") {
      stateByChannel.delete(interaction.channelId);
      await interaction.reply("このチャンネルの履歴をリセットしたよ");
      return;
    }

    if (interaction.commandName === "persona") {
      const reset = !!interaction.options.getBoolean("reset");
      const text = (interaction.options.getString("text") || "").trim();
      const base = process.env.SYSTEM_PROMPT || "You are a helpful assistant.";

      if (reset || text.toLowerCase() === "reset") {
        if (st.history?.[0]?.role === "system") {
          st.history[0].content = base;
        }
        await interaction.reply(
          [
            "persona reset to default.",
            "",
            "```",
            base,
            "```",
          ].join("\n")
        );
        return;
      }

      if (!text) {
        await interaction.reply("Provide `text` or set `reset:true`.");
        return;
      }

      const newSystem = [base, "", "--- persona override ---", text].join("\n");
      if (st.history?.[0]?.role === "system") {
        st.history[0].content = newSystem;
      } else if (st.history) {
        st.history.unshift({ role: "system", content: newSystem });
      }

      const preview = text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
      await interaction.reply(
        [
          "persona updated. 人格設定完了。",
          "",
          "```",
          preview || "(empty)",
          "```",
        ].join("\n")
      );
      return;
    }

    if (interaction.commandName === "persona-show") {
      const base = process.env.SYSTEM_PROMPT || "You are a helpful assistant.";
      let current = base;
      if (st.history?.[0]?.role === "system") {
        current = st.history[0].content || base;
      }

      const marker = "--- persona override ---";
      let baseText = current;
      let overrideText = "";
      const idx = current.indexOf(marker);
      if (idx !== -1) {
        baseText = current.slice(0, idx).trim();
        overrideText = current.slice(idx + marker.length).trim();
      } else {
        baseText = current.trim();
      }

      const header = "🧩 **persona 現在設定**";
      const status = `• override: ${overrideText ? "あり" : "なし"}`;
      const body = overrideText
        ? `${baseText}\n\n${marker}\n${overrideText}`
        : baseText || base;

      await interaction.reply([header, status, "", "```", body, "```"].join("\n"));
      return;
    }

    if (interaction.commandName === "draw") {
      if (st.paused) {
        await interaction.reply("paused in this channel. use /resume.");
        return;
      }

      const prompt = (interaction.options.getString("prompt", true) || "").trim();
      if (!prompt) {
        await interaction.reply("prompt is required.");
        return;
      }

      const width = interaction.options.getInteger("width");
      const height = interaction.options.getInteger("height");
      const steps = interaction.options.getInteger("steps");
      const cfgScale = interaction.options.getNumber("cfg");
      const samplerOpt = interaction.options.getString("sampler");
      const seedOpt = interaction.options.getInteger("seed");
      const batchOpt = interaction.options.getInteger("batch");
      const negativeOpt = interaction.options.getString("negative");

      const finalWidth = Number.isFinite(width) ? width : numEnv(SD_WIDTH, 768);
      const finalHeight = Number.isFinite(height) ? height : numEnv(SD_HEIGHT, 768);
      const finalSteps = Number.isFinite(steps) ? steps : numEnv(SD_STEPS, 20);
      const finalCfgScale = Number.isFinite(cfgScale) ? cfgScale : numEnv(SD_CFG_SCALE, 7);
      const finalSampler = String(samplerOpt ?? SD_SAMPLER ?? "DPM++ 2M Karras");
      const finalSeed = Number.isFinite(seedOpt) ? seedOpt : -1;
      const finalBatch = Number.isFinite(batchOpt) ? batchOpt : numEnv(SD_BATCH_SIZE, 1);
      const finalNegative = String(negativeOpt ?? SD_NEGATIVE_PROMPT ?? "");

      await interaction.deferReply();

      try {
        let promptForSd = prompt;
        let translated = false;
        try {
          const t = await translatePromptForSd(prompt);
          promptForSd = t.prompt;
          translated = t.translated;
        } catch (e) {
          console.error("prompt translate failed:", e);
        }

        const imagesB64 = await sdTxt2Img({
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
          await interaction.editReply("no images returned.");
          return;
        }

        const files = imagesB64.slice(0, 4).map((b64, idx) => {
          const buf = Buffer.from(b64, "base64");
          return new AttachmentBuilder(buf, { name: `draw_${Date.now()}_${idx + 1}.png` });
        });

        const translateTag = translated ? " | translated: ja->en" : "";
        const statusLine = `done. prompt: ${prompt} | size: ${finalWidth}x${finalHeight} | steps: ${finalSteps} | cfg: ${finalCfgScale} | sampler: ${finalSampler}${translateTag}`;
        await interaction.editReply({ content: statusLine, files });
      } catch (e) {
        console.error(e);
        await interaction.editReply(`draw error: ${e.message}`);
      }

      return;
    }

    if (interaction.commandName === "music") {
      if (st.paused) {
        await interaction.reply("paused in this channel. use /resume.");
        return;
      }

      const prompt = (interaction.options.getString("prompt", true) || "").trim();
      if (!prompt) {
        await interaction.reply("prompt is required.");
        return;
      }

      const language = (interaction.options.getString("language") || "").trim();
      const lyrics = (interaction.options.getString("lyrics") || "").trim();
      const durationOpt = interaction.options.getInteger("duration");
      let durationSec = Number.isFinite(durationOpt) ? durationOpt : 120;
      durationSec = Math.max(10, Math.min(600, durationSec));
      const bpmOpt = interaction.options.getInteger("bpm");
      const bpm = Number.isFinite(bpmOpt) ? Math.max(30, Math.min(300, bpmOpt)) : null;

      await interaction.deferReply();

      musicQueue.push({ interaction, prompt, durationSec, lyrics, bpm, language });
      const position = musicQueue.length + (musicProcessing ? 1 : 0);

      if (musicProcessing || position > 1) {
        try {
          await interaction.editReply(`music: queued (position ${position}).`);
        } catch {}
      }

      await processMusicQueue();
      return;
    }

    if (interaction.commandName === "othello") {
      const difficulty = interaction.options.getString("difficulty") || "normal";
      await startOthelloGame(interaction, difficulty);
      return;
    }

    if (interaction.commandName === "chat") {
      const st = getState(interaction.channelId);

      if (st.paused) {
        await interaction.reply("⏸️ 現在このチャンネルは停止中です（/resume で再開）");
        return;
      }

      const text = interaction.options.getString("message") || "";
      const imageAtt = pickImageFromInteraction(interaction);

      if (!text && !imageAtt) {
        await interaction.reply("`/chat message:<文章>` か `image:<画像>` のどちらかを指定してね");
        return;
      }

      // ★3秒制限対策：先に defer しておく（この後はキュー待ちでもOK）
      await interaction.deferReply();

      const name = interaction.member?.displayName || interaction.user.username;

      // ★/chat もキューへ（interaction）
      st.queue.push({
        kind: "interaction",
        interaction,
        name,
        text,
        imageAtt, // 画像は interaction から拾ったものを渡す（message添付とは別ルート）
      });

      // ★キュー処理（チャンネル単位で完全直列化）
      try {
        await processQueue(interaction.channelId);
      } catch (e) {
        console.error(e);
        try { await interaction.editReply(`⚠️ エラー: ${e.message}`); } catch { }
      }

      return;
    }


  } catch (e) {
    console.error("interaction error:", e);

    if (e?.code === 10062 || e?.code === 40060) {
      return;
    }

    // defer済みの場合は followUp で返す
    if (interaction.deferred || interaction.replied) {
      try {
        await interaction.editReply({ content: "⚠️ エラーが発生しました" });
      } catch {
        try {
          await interaction.followUp({
            content: "⚠️ エラーが発生しました",
            flags: MessageFlags.Ephemeral,
          });
        } catch {}
      }
      return;
    }

    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: "⚠️ エラーが発生しました",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

const REACTION_DIGITS = new Map([
  ["0️⃣", 0], ["1️⃣", 1], ["2️⃣", 2], ["3️⃣", 3], ["4️⃣", 4],
  ["5️⃣", 5], ["6️⃣", 6], ["7️⃣", 7], ["8️⃣", 8], ["9️⃣", 9],
]);

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const gameId = othelloMessageToGame.get(reaction.message.id);
    if (!gameId) return;
    const game = getOthelloGame(gameId);
    if (!game) return;
    if (user.id !== game.playerId) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const name = reaction.emoji.name;
    if (name === "◀️") {
      game.reactionPage = Math.max(0, (game.reactionPage || 0) - 1);
      await updateReactionGame(game, reaction.message.channel);
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }
    if (name === "▶️") {
      const { totalPages } = getReactionMoves(game);
      game.reactionPage = Math.min(totalPages - 1, (game.reactionPage || 0) + 1);
      await updateReactionGame(game, reaction.message.channel);
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const digit = REACTION_DIGITS.get(name);
    if (digit === undefined) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const { slice } = getReactionMoves(game);
    if (!slice[digit]) {
      try { await reaction.users.remove(user.id); } catch {}
      return;
    }

    const move = slice[digit];
    const result = await handlePlayerMove(game, move);
    if (result.ok) {
      await updateReactionGame(game, reaction.message.channel);
    }
    try { await reaction.users.remove(user.id); } catch {}
  } catch (e) {
    console.error("reaction error:", e);
  }
});


client.login(DISCORD_TOKEN);
