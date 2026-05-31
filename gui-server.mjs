import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  defaultLlmBaseUrl,
  nativeOllamaBaseUrl,
  normalizeOpenAiBaseUrl,
} from './src/utils/llm-config.mjs';
import {
  formatEnvValue,
  parseEnvContent,
} from './src/utils/env-file.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.GUI_HOST || '127.0.0.1';
const PORT = Number(process.env.GUI_PORT || 3150);
const BASE_URL = `http://${HOST}:${PORT}`;
const ENV_FILE = path.join(__dirname, '.env');
const ENV_EXAMPLE_FILE = path.join(__dirname, '.env.example');
const BOT_ENTRY = path.join(__dirname, 'index.mjs');
const STANDBY_ENTRY = path.join(__dirname, 'standby-bot.mjs');
const REGISTER_COMMANDS_ENTRY = path.join(__dirname, 'register-commands.mjs');
const LOG_FILE = path.join(__dirname, 'bot.log');
const STATIC_DIR = path.join(__dirname, 'gui');

const GUI_TOKEN = crypto.randomBytes(32).toString('hex');
const GUI_TOKEN_BUF = Buffer.from(GUI_TOKEN);
const ALLOWED_HOSTS = new Set([
  `${HOST}:${PORT}`,
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map(host => `http://${host}`));

const LOG_MAX_BYTES = Number(process.env.GUI_LOG_MAX_BYTES || 5 * 1024 * 1024);
const LOG_BACKUP_COUNT = 3;

const ENV_SECTIONS = [
  {
    id: 'discord',
    title: 'Discord',
    description: 'Bot のログインと、反応するサーバー・チャンネルの設定です。',
    fields: [
      { key: 'DISCORD_TOKEN', label: 'Bot Token', type: 'password', required: true, placeholder: 'your_discord_bot_token_here' },
      { key: 'CLIENT_ID', label: 'Application / Client ID', type: 'text', required: true, placeholder: '123456789012345678' },
      { key: 'GUILD_ID', label: 'Guild ID(s)', type: 'textarea', placeholder: '123456789012345678,987654321098765432', help: 'Register Guild Commands の対象サーバー ID です。カンマ区切りで複数指定できます。' },
      { key: 'CHANNEL_IDS', label: 'Allowed Channel IDs', type: 'textarea', required: true, placeholder: '123456789012345678,987654321098765432', help: 'メイン Bot が反応するチャンネル ID です。カンマ区切りで複数指定できます。' },
    ],
  },
  {
    id: 'llm',
    title: 'Local LLM',
    description: '通常チャット、/chat、/webchat、/draw の翻訳で使う LLM の設定です。',
    fields: [
      { key: 'LLM_PROVIDER', label: 'Provider', type: 'select', options: ['ollama', 'lmstudio', 'custom'], required: true, placeholder: 'ollama', help: 'Ollama は http://127.0.0.1:11434/v1、LM Studio は http://127.0.0.1:1234/v1 を初期値として使います。' },
      { key: 'LLM_BASE_URL', label: 'Base URL', type: 'url', placeholder: 'http://127.0.0.1:11434/v1', help: 'OpenAI 互換 API の base URL です。通常は /v1 まで指定します。' },
      { key: 'LLM_MODEL', label: 'Model', type: 'model', required: true, placeholder: '使う model identifier を指定してください。' },
      { key: 'LLM_TEMPERATURE', label: 'LLM Temperature', type: 'number', placeholder: '0.4', min: 0, max: 2, step: 0.1, help: '通常チャットの temperature です。低いほど安定します。既定値は 0.4 です。' },
      { key: 'LLM_MAX_HISTORY_MESSAGES', label: 'Max History Messages', type: 'number', placeholder: '30', min: 0, step: 1, help: 'チャンネルごとの履歴として保持する最大メッセージ数です。system は別管理です。' },
      { key: 'WEB_SEARCH_MODE', label: 'Web Search Mode', type: 'select', options: ['manual', 'auto'], placeholder: 'manual', help: 'manual は /webchat のみ検索、auto は通常チャットでも毎ターン検索要否を判定します。' },
      { key: 'BOT_TIMEZONE', label: 'Bot Timezone', type: 'text', placeholder: 'Asia/Tokyo', help: 'LLM に渡す現在時刻のタイムゾーンです。IANA 名で指定します。' },
      { key: 'LLM_API_KEY', label: 'API Key', type: 'password', placeholder: 'Ollama / LM Studio は通常不要です。' },
      { key: 'OLLAMA_KEEP_ALIVE', label: 'Ollama Keep Alive', type: 'text', placeholder: '30m / 1h / 3600 / -1', help: 'Ollama モデルの保持時間です。30m=30分、1h=1時間、3600=3600秒、-1=常時ロードです。' },
      { key: 'OLLAMA_WEB_API_KEY', label: 'Ollama Web Search API Key', type: 'password', placeholder: '/webchat や auto 検索用' },
      { key: 'SYSTEM_PROMPT', label: 'System Prompt', type: 'textarea', placeholder: '通常時の共通 System Prompt を指定します。' },
    ],
  },
  {
    id: 'standby',
    title: 'Standby Bot',
    description: 'メイン Bot を止めている間だけ、同じ Bot で固定返信するための設定です。',
    fields: [
      { key: 'STANDBY_CHANNEL_IDS', label: 'Standby Channel IDs', type: 'textarea', placeholder: '空欄なら CHANNEL_IDS を使います', help: 'Standby モードが反応するチャンネル ID です。空欄なら CHANNEL_IDS をそのまま使います。' },
      { key: 'STANDBY_REPLY_MESSAGE', label: 'Standby Reply Message', type: 'textarea', placeholder: '現在メイン Bot は停止中です。しばらくしてからもう一度試してください。' },
      { key: 'STANDBY_REPLY_COOLDOWN_SECONDS', label: 'Standby Reply Cooldown (sec)', type: 'number', placeholder: '300', min: 0, step: 1, help: '同じユーザーが同じチャンネルで連投したときの固定返信クールダウン秒数です。' },
    ],
  },
  {
    id: 'stable-diffusion',
    title: 'Stable Diffusion WebUI (/draw)',
    description: 'AUTOMATIC1111 の txt2img API に送る既定値です。',
    fields: [
      { key: 'SD_WEBUI_URL', label: 'SD WebUI URL', type: 'url', placeholder: 'http://127.0.0.1:7860' },
      { key: 'SD_WIDTH', label: 'Default Width', type: 'number', placeholder: '1024' },
      { key: 'SD_HEIGHT', label: 'Default Height', type: 'number', placeholder: '1024' },
      { key: 'SD_STEPS', label: 'Default Steps', type: 'number', placeholder: '20' },
      { key: 'SD_CFG_SCALE', label: 'Default CFG Scale', type: 'number', placeholder: '5' },
      { key: 'SD_SAMPLER', label: 'Default Sampler', type: 'text', placeholder: 'Euler a' },
      { key: 'SD_BATCH_SIZE', label: 'Default Batch Size', type: 'number', placeholder: '1' },
      { key: 'SD_NEGATIVE_PROMPT', label: 'Negative Prompt', type: 'textarea', placeholder: 'lowres, blurry, worst quality, bad anatomy' },
      { key: 'SD_PROMPT_TRANSLATE', label: 'Translate Japanese Prompt', type: 'select', options: ['true', 'false'], placeholder: 'false' },
      { key: 'SD_PROMPT_TRANSLATE_MODEL', label: 'Translation Model', type: 'text', placeholder: '未設定なら LLM_MODEL を使います。' },
    ],
  },
  {
    id: 'music',
    title: 'Music (/music)',
    description: 'ComfyUI または ACE-Step API を使った音楽生成の設定です。',
    fields: [
      { key: 'MUSIC_BACKEND', label: 'Backend', type: 'select', options: ['comfyui', 'ace'], placeholder: 'comfyui' },
      { key: 'COMFY_URL', label: 'ComfyUI URL', type: 'url', placeholder: 'http://127.0.0.1:8188' },
      { key: 'COMFY_WORKFLOW_PATH', label: 'ComfyUI Workflow Path', type: 'text', placeholder: './comfyui/workflows/audio_ace_step_1_5_checkpoint_api.json' },
      { key: 'ACE_URL', label: 'ACE-Step API URL', type: 'url', placeholder: 'http://127.0.0.1:8001' },
      { key: 'ACE_POLL_MS', label: 'ACE-Step Poll Interval (ms)', type: 'number', placeholder: '2000' },
      { key: 'ACE_API_KEY', label: 'ACE-Step API Key', type: 'password', placeholder: '必要な場合のみ指定します。' },
    ],
  },
];

const LEGACY_ENV_KEYS = ['OLLAMA_URL', 'OLLAMA_MODEL'];
const KNOWN_ENV_KEYS = new Set([
  ...ENV_SECTIONS.flatMap(section => section.fields.map(field => field.key)),
  ...LEGACY_ENV_KEYS,
]);

let botProcess = null;
let botStartedAt = null;
let standbyProcess = null;
let standbyStartedAt = null;
let commandProcess = null;
let logSeq = 0;
let logBuffer = [];

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return false;
  if (!fs.existsSync(ENV_EXAMPLE_FILE)) {
    throw new Error('.env がなく、.env.example も見つかりません。');
  }
  fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  appendLog('gui', '.env がなかったため .env.example から自動作成しました。');
  return true;
}

function readEnv() {
  ensureEnvFile();
  return parseEnvContent(fs.readFileSync(ENV_FILE, 'utf8'));
}

function buildGuiValues(values) {
  const next = { ...values };
  const hasExplicitProvider = !!next.LLM_PROVIDER;
  const provider = (next.LLM_PROVIDER || 'ollama').toLowerCase();
  next.LLM_PROVIDER = provider;

  if (!next.LLM_BASE_URL) {
    next.LLM_BASE_URL = !hasExplicitProvider && next.OLLAMA_URL
      ? normalizeOpenAiBaseUrl(next.OLLAMA_URL)
      : defaultLlmBaseUrl(provider);
  }
  if (!next.LLM_MODEL && next.OLLAMA_MODEL) next.LLM_MODEL = next.OLLAMA_MODEL;
  if (!next.LLM_TEMPERATURE) next.LLM_TEMPERATURE = '0.4';
  if (!next.LLM_MAX_HISTORY_MESSAGES) next.LLM_MAX_HISTORY_MESSAGES = '30';
  if (!next.WEB_SEARCH_MODE) next.WEB_SEARCH_MODE = 'manual';
  if (!next.BOT_TIMEZONE) next.BOT_TIMEZONE = 'Asia/Tokyo';
  if (!next.LLM_API_KEY) next.LLM_API_KEY = '';
  if (!next.OLLAMA_KEEP_ALIVE && provider === 'ollama') next.OLLAMA_KEEP_ALIVE = '30m';
  if (!next.STANDBY_REPLY_MESSAGE) {
    next.STANDBY_REPLY_MESSAGE = '現在メイン Bot は停止中です。しばらくしてからもう一度試してください。';
  }
  if (!next.STANDBY_REPLY_COOLDOWN_SECONDS) next.STANDBY_REPLY_COOLDOWN_SECONDS = '300';
  return next;
}

function modelHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeModelList(json) {
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];

  const names = rows
    .map(item => {
      if (typeof item === 'string') return item;
      return item?.id || item?.name || item?.model || '';
    })
    .filter(Boolean);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

async function listLlmModels({ provider, baseUrl, apiKey }) {
  const finalProvider = String(provider || 'ollama').toLowerCase();
  const finalBaseUrl = normalizeOpenAiBaseUrl(baseUrl || defaultLlmBaseUrl(finalProvider));
  if (!finalBaseUrl) throw new Error('LLM_BASE_URL を入力してください。');

  try {
    const json = await fetchJsonWithTimeout(`${finalBaseUrl}/models`, {
      method: 'GET',
      headers: modelHeaders(apiKey),
    });
    return normalizeModelList(json);
  } catch (error) {
    if (finalProvider !== 'ollama') throw error;
    const tagsJson = await fetchJsonWithTimeout(`${nativeOllamaBaseUrl(finalBaseUrl)}/api/tags`, {
      method: 'GET',
      headers: modelHeaders(apiKey),
    });
    return normalizeModelList(tagsJson);
  }
}

function writeEnv(updates) {
  ensureEnvFile();
  const current = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = current.split(/\r?\n/);
  const seen = new Set();
  const allowedUpdates = {};

  for (const key of KNOWN_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      allowedUpdates[key] = String(updates[key] ?? '');
    }
  }

  const nextLines = lines.map(line => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=(.*)$/);
    if (!match) return line;
    const key = match[2];
    if (!Object.prototype.hasOwnProperty.call(allowedUpdates, key)) return line;
    seen.add(key);
    return `${key}=${formatEnvValue(allowedUpdates[key])}`;
  });

  const missing = Object.keys(allowedUpdates).filter(key => !seen.has(key));
  if (missing.length) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') nextLines.push('');
    nextLines.push('# GUI managed values');
    for (const key of missing) {
      nextLines.push(`${key}=${formatEnvValue(allowedUpdates[key])}`);
    }
  }

  fs.writeFileSync(ENV_FILE, `${nextLines.join('\n').replace(/\s+$/u, '')}\n`, 'utf8');
  appendLog('gui', '.env を保存しました。変更を反映するには必要に応じて Bot を再起動してください。');
}

function rotateLogFileIfNeeded() {
  let size = 0;
  try {
    size = fs.statSync(LOG_FILE).size;
  } catch {
    return;
  }
  if (size < LOG_MAX_BYTES) return;

  try {
    for (let i = LOG_BACKUP_COUNT - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i === LOG_BACKUP_COUNT - 1 && fs.existsSync(dst)) {
          fs.unlinkSync(dst);
        }
        fs.renameSync(src, dst);
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // Best effort only.
  }
}

function appendLog(source, chunk) {
  const text = String(chunk ?? '');
  if (!text) return;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');
  const now = new Date().toISOString();
  const entries = lines.map(line => ({
    seq: ++logSeq,
    time: now,
    source,
    line,
    text: `[${now}] [${source}] ${line}`,
  }));

  logBuffer.push(...entries);
  if (logBuffer.length > 2000) logBuffer = logBuffer.slice(-2000);

  try {
    rotateLogFileIfNeeded();
    fs.appendFileSync(
      LOG_FILE,
      entries.map(entry => entry.text).join('\n') + '\n',
      'utf8',
    );
  } catch {
    // Logging must never crash the GUI.
  }
}

function isAllowedRequestOrigin(req) {
  const host = req.headers.host;
  if (!host || !ALLOWED_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
  return true;
}

function timingSafeStringEqual(value) {
  if (typeof value !== 'string') return false;
  const buf = Buffer.from(value);
  if (buf.length !== GUI_TOKEN_BUF.length) return false;
  try {
    return crypto.timingSafeEqual(buf, GUI_TOKEN_BUF);
  } catch {
    return false;
  }
}

function isAllowedApiRequest(req) {
  if (!isAllowedRequestOrigin(req)) return false;
  return timingSafeStringEqual(req.headers['x-gui-token']);
}

function privateModelUrlAllowed(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'
  ) {
    return true;
  }

  try {
    const { values } = readEnv();
    const savedRaw = String(values.LLM_BASE_URL || '').trim();
    if (savedRaw) {
      const saved = new URL(normalizeOpenAiBaseUrl(savedRaw));
      if (
        saved.hostname.toLowerCase() === host &&
        (saved.port || '') === (parsed.port || '')
      ) {
        return true;
      }
    }
  } catch {}

  return false;
}

function getBotStatus() {
  return {
    running: !!botProcess,
    pid: botProcess?.pid ?? null,
    startedAt: botStartedAt,
  };
}

function getStandbyStatus() {
  return {
    running: !!standbyProcess,
    pid: standbyProcess?.pid ?? null,
    startedAt: standbyStartedAt,
  };
}

function startManagedProcess(entryFile, sourceName, label, onClose) {
  appendLog('gui', `${label} を起動します。`);
  const child = spawn(process.execPath, [entryFile], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', data => appendLog(sourceName, data));
  child.stderr.on('data', data => appendLog(sourceName, data));
  child.on('error', error => appendLog(sourceName, `process error: ${error.message}`));
  child.on('close', (code, signal) => {
    appendLog('gui', `${label} が終了しました。code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    onClose();
  });

  return child;
}

function startBot() {
  ensureEnvFile();
  if (standbyProcess) {
    return {
      started: false,
      message: 'Standby Bot が起動中です。先に Standby Bot を停止してください。',
      status: getBotStatus(),
    };
  }
  if (botProcess) {
    return {
      started: false,
      message: 'Bot はすでに起動中です。',
      status: getBotStatus(),
    };
  }

  botStartedAt = new Date().toISOString();
  botProcess = startManagedProcess(BOT_ENTRY, 'bot', 'Bot', () => {
    botProcess = null;
    botStartedAt = null;
  });
  return { started: true, message: 'Bot を起動しました。', status: getBotStatus() };
}

function stopBot() {
  if (!botProcess) {
    return {
      stopped: false,
      message: 'Bot は起動していません。',
      status: getBotStatus(),
    };
  }
  appendLog('gui', 'Bot を停止します。');
  botProcess.kill();
  return {
    stopped: true,
    message: 'Bot に停止シグナルを送りました。',
    status: getBotStatus(),
  };
}

function restartBot() {
  const previous = botProcess;
  if (previous) {
    previous.once('close', () => {
      startBot();
    });
    stopBot();
  } else {
    startBot();
  }
  return { restarted: true, message: 'Bot を再起動します。', status: getBotStatus() };
}

function startStandbyBot() {
  ensureEnvFile();
  if (botProcess) {
    return {
      started: false,
      message: 'メイン Bot が起動中です。先に Bot を停止してください。',
      status: getStandbyStatus(),
    };
  }
  if (standbyProcess) {
    return {
      started: false,
      message: 'Standby Bot はすでに起動中です。',
      status: getStandbyStatus(),
    };
  }

  standbyStartedAt = new Date().toISOString();
  standbyProcess = startManagedProcess(STANDBY_ENTRY, 'standby', 'Standby Bot', () => {
    standbyProcess = null;
    standbyStartedAt = null;
  });
  return {
    started: true,
    message: 'Standby Bot を起動しました。',
    status: getStandbyStatus(),
  };
}

function stopStandbyBot() {
  if (!standbyProcess) {
    return {
      stopped: false,
      message: 'Standby Bot は起動していません。',
      status: getStandbyStatus(),
    };
  }
  appendLog('gui', 'Standby Bot を停止します。');
  standbyProcess.kill();
  return {
    stopped: true,
    message: 'Standby Bot に停止シグナルを送りました。',
    status: getStandbyStatus(),
  };
}

function restartStandbyBot() {
  const previous = standbyProcess;
  if (previous) {
    previous.once('close', () => {
      startStandbyBot();
    });
    stopStandbyBot();
  } else {
    startStandbyBot();
  }
  return {
    restarted: true,
    message: 'Standby Bot を再起動します。',
    status: getStandbyStatus(),
  };
}

function runRegisterCommands(mode = 'guild') {
  ensureEnvFile();
  if (commandProcess) {
    return { started: false, message: 'スラッシュコマンド登録はすでに実行中です。' };
  }

  const args = [REGISTER_COMMANDS_ENTRY, mode === 'global' ? '--global' : '--guild'];
  const label = mode === 'global' ? 'グローバル' : 'ギルド';
  appendLog('gui', `${label}スラッシュコマンド登録を開始します。`);
  commandProcess = spawn(process.execPath, args, {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  commandProcess.stdout.on('data', data => appendLog('commands', data));
  commandProcess.stderr.on('data', data => appendLog('commands', data));
  commandProcess.on('error', error => appendLog('commands', `process error: ${error.message}`));
  commandProcess.on('close', (code, signal) => {
    appendLog('gui', `${label}スラッシュコマンド登録が終了しました。code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    commandProcess = null;
  });

  return { started: true, message: `${label}スラッシュコマンド登録を開始しました。` };
}

function jsonResponse(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function textResponse(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error('Request body is too large.');
  }
  return body ? JSON.parse(body) : {};
}

function staticPathFor(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const decoded = decodeURIComponent(cleanPath);
  const resolved = path.resolve(STATIC_DIR, `.${decoded}`);
  const relative = path.relative(STATIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/config') {
    const envCreated = ensureEnvFile();
    const { values, orderedKeys } = readEnv();
    const unknownKeys = orderedKeys.filter(key => !KNOWN_ENV_KEYS.has(key));
    return jsonResponse(res, 200, {
      envCreated,
      envPath: ENV_FILE,
      sections: ENV_SECTIONS,
      values: buildGuiValues(values),
      unknownKeys,
      bot: getBotStatus(),
      standby: getStandbyStatus(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const body = await readJsonBody(req);
    writeEnv(body.values || {});
    const { values, orderedKeys } = readEnv();
    const unknownKeys = orderedKeys.filter(key => !KNOWN_ENV_KEYS.has(key));
    return jsonResponse(res, 200, {
      ok: true,
      message: '保存しました。必要に応じて Bot を再起動してください。',
      values: buildGuiValues(values),
      unknownKeys,
      bot: getBotStatus(),
      standby: getStandbyStatus(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/llm/models') {
    const body = await readJsonBody(req);
    const finalProvider = String(body.provider || 'ollama').toLowerCase();
    const finalBaseUrl = normalizeOpenAiBaseUrl(body.baseUrl || defaultLlmBaseUrl(finalProvider));
    if (!finalBaseUrl) {
      return jsonResponse(res, 400, { error: 'LLM_BASE_URL を入力してください。' });
    }
    if (!privateModelUrlAllowed(finalBaseUrl)) {
      appendLog('gui', `LLM モデル一覧取得を拒否しました (SSRF guard): ${finalBaseUrl}`);
      return jsonResponse(res, 403, {
        error: 'URL は localhost か、保存済みの LLM_BASE_URL と同じ host:port にしてください。',
      });
    }

    const models = await listLlmModels({
      provider: finalProvider,
      baseUrl: finalBaseUrl,
      apiKey: body.apiKey,
    });
    appendLog('gui', `LLM モデル一覧を取得しました。count=${models.length}`);
    return jsonResponse(res, 200, { models });
  }

  if (req.method === 'POST' && pathname === '/api/bot/start') {
    return jsonResponse(res, 200, startBot());
  }
  if (req.method === 'POST' && pathname === '/api/bot/stop') {
    return jsonResponse(res, 200, stopBot());
  }
  if (req.method === 'POST' && pathname === '/api/bot/restart') {
    return jsonResponse(res, 200, restartBot());
  }
  if (req.method === 'GET' && pathname === '/api/bot/status') {
    return jsonResponse(res, 200, getBotStatus());
  }

  if (req.method === 'POST' && pathname === '/api/standby/start') {
    return jsonResponse(res, 200, startStandbyBot());
  }
  if (req.method === 'POST' && pathname === '/api/standby/stop') {
    return jsonResponse(res, 200, stopStandbyBot());
  }
  if (req.method === 'POST' && pathname === '/api/standby/restart') {
    return jsonResponse(res, 200, restartStandbyBot());
  }
  if (req.method === 'GET' && pathname === '/api/standby/status') {
    return jsonResponse(res, 200, getStandbyStatus());
  }

  if (req.method === 'POST' && pathname === '/api/commands/register-guild') {
    return jsonResponse(res, 200, runRegisterCommands('guild'));
  }
  if (req.method === 'POST' && pathname === '/api/commands/register-global') {
    return jsonResponse(res, 200, runRegisterCommands('global'));
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const since = Number(new URL(req.url, BASE_URL).searchParams.get('since') || 0);
    const entries = since > 0 ? logBuffer.filter(entry => entry.seq > since) : logBuffer;
    return jsonResponse(res, 200, { seq: logSeq, entries });
  }

  if (req.method === 'POST' && pathname === '/api/logs/clear') {
    logBuffer = [];
    logSeq += 1;
    appendLog('gui', '画面ログをクリアしました。');
    return jsonResponse(res, 200, { ok: true, seq: logSeq });
  }

  return jsonResponse(res, 404, { error: 'API endpoint not found.' });
}

function serveStatic(req, res, pathname) {
  const filePath = staticPathFor(pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return textResponse(res, 404, 'Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') {
    const text = fs.readFileSync(filePath, 'utf8').replace(/__GUI_TOKEN__/g, GUI_TOKEN);
    return textResponse(res, 200, text, contentTypeFor(filePath));
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname.startsWith('/api/')) {
      if (!isAllowedApiRequest(req)) {
        return jsonResponse(res, 403, { error: 'Forbidden.' });
      }
      await handleApi(req, res, url.pathname);
      return;
    }

    if (!isAllowedRequestOrigin(req)) {
      return textResponse(res, 403, 'Forbidden');
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    appendLog('gui', `request error: ${error.stack || error.message}`);
    jsonResponse(res, 500, { error: error.message || String(error) });
  }
});

function openBrowser(url) {
  if (process.env.GUI_NO_OPEN === '1') return;
  const command = process.platform === 'win32'
    ? 'cmd'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

process.on('SIGINT', () => {
  if (botProcess) botProcess.kill();
  if (standbyProcess) standbyProcess.kill();
  if (commandProcess) commandProcess.kill();
  server.close(() => process.exit(0));
});

server.listen(PORT, HOST, () => {
  ensureEnvFile();
  appendLog('gui', `GUI を起動しました: ${BASE_URL}`);
  console.log(`GUI: ${BASE_URL}`);
  openBrowser(BASE_URL);
});
