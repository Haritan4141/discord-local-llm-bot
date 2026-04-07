import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.GUI_HOST || "127.0.0.1";
const PORT = Number(process.env.GUI_PORT || 3150);
const BASE_URL = `http://${HOST}:${PORT}`;
const ENV_FILE = path.join(__dirname, ".env");
const ENV_EXAMPLE_FILE = path.join(__dirname, ".env.example");
const BOT_ENTRY = path.join(__dirname, "index.mjs");
const LOG_FILE = path.join(__dirname, "bot.log");
const STATIC_DIR = path.join(__dirname, "gui");

const ENV_SECTIONS = [
  {
    id: "discord",
    title: "Discord",
    description: "Bot のログイン、スラッシュコマンド登録、応答チャンネルの設定です。",
    fields: [
      { key: "DISCORD_TOKEN", label: "Bot Token", type: "password", required: true, placeholder: "your_discord_bot_token_here" },
      { key: "CLIENT_ID", label: "Application / Client ID", type: "text", required: true, placeholder: "123456789012345678" },
      { key: "GUILD_ID", label: "Guild ID", type: "text", required: true, placeholder: "123456789012345678" },
      { key: "CHANNEL_IDS", label: "Allowed Channel IDs", type: "textarea", required: true, placeholder: "123456789012345678,987654321098765432", help: "Bot が反応するチャンネル ID。カンマ区切りで複数指定できます。" },
    ],
  },
  {
    id: "llm",
    title: "Local LLM",
    description: "通常会話と画像認識、/draw の日本語プロンプト翻訳に使う OpenAI 互換 API 設定です。",
    fields: [
      { key: "LLM_PROVIDER", label: "Provider", type: "select", options: ["ollama", "lmstudio", "custom"], required: true, placeholder: "ollama", help: "Ollama は http://127.0.0.1:11434/v1、LM Studio は http://127.0.0.1:1234/v1 を既定値として使います。" },
      { key: "LLM_BASE_URL", label: "Base URL", type: "url", placeholder: "http://127.0.0.1:11434/v1", help: "OpenAI 互換 API の base URL。通常は /v1 までを指定します。" },
      { key: "LLM_MODEL", label: "Model", type: "model", required: true, placeholder: "モデル一覧を取得するか、model identifier を入力" },
      { key: "LLM_API_KEY", label: "API Key", type: "password", placeholder: "任意。Ollama / LM Studio は通常空でOK" },
      { key: "SYSTEM_PROMPT", label: "System Prompt", type: "textarea", placeholder: "あなたはDiscordチャンネルの会話に自然に参加するAIです。" },
    ],
  },
  {
    id: "stable-diffusion",
    title: "Stable Diffusion WebUI (/draw)",
    description: "AUTOMATIC1111 の txt2img API に送る設定です。",
    fields: [
      { key: "SD_WEBUI_URL", label: "SD WebUI URL", type: "url", placeholder: "http://127.0.0.1:7860" },
      { key: "SD_WIDTH", label: "Default Width", type: "number", placeholder: "1024" },
      { key: "SD_HEIGHT", label: "Default Height", type: "number", placeholder: "1024" },
      { key: "SD_STEPS", label: "Default Steps", type: "number", placeholder: "20" },
      { key: "SD_CFG_SCALE", label: "Default CFG Scale", type: "number", placeholder: "5" },
      { key: "SD_SAMPLER", label: "Default Sampler", type: "text", placeholder: "Euler a" },
      { key: "SD_BATCH_SIZE", label: "Default Batch Size", type: "number", placeholder: "1" },
      { key: "SD_NEGATIVE_PROMPT", label: "Negative Prompt", type: "textarea", placeholder: "lowres, blurry, worst quality, bad anatomy" },
      { key: "SD_PROMPT_TRANSLATE", label: "Translate Japanese Prompt", type: "select", options: ["true", "false"], placeholder: "false" },
      { key: "SD_PROMPT_TRANSLATE_MODEL", label: "Translation Model", type: "text", placeholder: "未設定なら LLM_MODEL を使用" },
    ],
  },
  {
    id: "music",
    title: "Music (/music)",
    description: "ComfyUI または ACE-Step API を使った音楽生成設定です。",
    fields: [
      { key: "MUSIC_BACKEND", label: "Backend", type: "select", options: ["comfyui", "ace"], placeholder: "comfyui" },
      { key: "COMFY_URL", label: "ComfyUI URL", type: "url", placeholder: "http://127.0.0.1:8188" },
      { key: "COMFY_WORKFLOW_PATH", label: "ComfyUI Workflow Path", type: "text", placeholder: "./comfyui/workflows/audio_ace_step_1_5_checkpoint_api.json" },
      { key: "ACE_URL", label: "ACE-Step API URL", type: "url", placeholder: "http://127.0.0.1:8001" },
      { key: "ACE_POLL_MS", label: "ACE-Step Poll Interval (ms)", type: "number", placeholder: "2000" },
      { key: "ACE_API_KEY", label: "ACE-Step API Key", type: "password", placeholder: "任意" },
    ],
  },
];

const LEGACY_ENV_KEYS = ["OLLAMA_URL", "OLLAMA_MODEL"];
const KNOWN_ENV_KEYS = new Set([
  ...ENV_SECTIONS.flatMap(section => section.fields.map(field => field.key)),
  ...LEGACY_ENV_KEYS,
]);

let botProcess = null;
let botStartedAt = null;
let commandProcess = null;
let logSeq = 0;
let logBuffer = [];

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return false;
  if (!fs.existsSync(ENV_EXAMPLE_FILE)) {
    throw new Error(".env がなく、.env.example も見つかりません。");
  }
  fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  appendLog("gui", ".env が見つからなかったため .env.example から作成しました。");
  return true;
}

function parseEnvValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === "\"" && last === "\"") {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"");
    }
  }
  if (first === "'" && last === "'") return value.slice(1, -1);
  return value;
}

function parseEnvContent(content) {
  const values = {};
  const orderedKeys = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    values[key] = parseEnvValue(match[2]);
    orderedKeys.push(key);
  }

  return { values, orderedKeys };
}

function readEnv() {
  ensureEnvFile();
  const content = fs.readFileSync(ENV_FILE, "utf8");
  return parseEnvContent(content);
}

function defaultLlmBaseUrl(provider) {
  if (provider === "lmstudio") return "http://127.0.0.1:1234/v1";
  if (provider === "ollama") return "http://127.0.0.1:11434/v1";
  return "";
}

function normalizeOpenAiBaseUrl(url) {
  let base = String(url || "").trim().replace(/\/+$/, "");
  base = base.replace(/\/chat\/completions$/i, "");
  return base;
}

function buildGuiValues(values) {
  const next = { ...values };
  const hasExplicitProvider = !!next.LLM_PROVIDER;
  const provider = (next.LLM_PROVIDER || "ollama").toLowerCase();
  next.LLM_PROVIDER = provider;
  if (!next.LLM_BASE_URL) {
    next.LLM_BASE_URL = !hasExplicitProvider && next.OLLAMA_URL
      ? normalizeOpenAiBaseUrl(next.OLLAMA_URL)
      : defaultLlmBaseUrl(provider);
  }
  if (!next.LLM_MODEL && next.OLLAMA_MODEL) next.LLM_MODEL = next.OLLAMA_MODEL;
  if (!next.LLM_API_KEY) next.LLM_API_KEY = "";
  return next;
}

function nativeOllamaBaseUrl(baseUrl) {
  return normalizeOpenAiBaseUrl(baseUrl).replace(/\/v1$/i, "");
}

function modelHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
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
      if (typeof item === "string") return item;
      return item?.id || item?.name || item?.model || "";
    })
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

async function listLlmModels({ provider, baseUrl, apiKey }) {
  const finalProvider = String(provider || "ollama").toLowerCase();
  const finalBaseUrl = normalizeOpenAiBaseUrl(baseUrl || defaultLlmBaseUrl(finalProvider));
  if (!finalBaseUrl) throw new Error("LLM_BASE_URL を入力してください。");

  try {
    const json = await fetchJsonWithTimeout(`${finalBaseUrl}/models`, {
      method: "GET",
      headers: modelHeaders(apiKey),
    });
    return normalizeModelList(json);
  } catch (error) {
    if (finalProvider !== "ollama") throw error;

    const tagsJson = await fetchJsonWithTimeout(`${nativeOllamaBaseUrl(finalBaseUrl)}/api/tags`, {
      method: "GET",
      headers: modelHeaders(apiKey),
    });
    return normalizeModelList(tagsJson);
  }
}

function formatEnvValue(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/[\r\n#="'`]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function writeEnv(updates) {
  ensureEnvFile();
  const current = fs.readFileSync(ENV_FILE, "utf8");
  const lines = current.split(/\r?\n/);
  const seen = new Set();
  const allowedUpdates = {};

  for (const key of KNOWN_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      allowedUpdates[key] = String(updates[key] ?? "");
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
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push("# GUI managed values");
    for (const key of missing) {
      nextLines.push(`${key}=${formatEnvValue(allowedUpdates[key])}`);
    }
  }

  fs.writeFileSync(ENV_FILE, `${nextLines.join("\n").replace(/\s+$/u, "")}\n`, "utf8");
  appendLog("gui", ".env を保存しました。変更を Bot に反映するには Bot を再起動してください。");
}

function appendLog(source, chunk) {
  const text = String(chunk ?? "");
  if (!text) return;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const now = new Date().toLocaleString("ja-JP");
  const entries = lines.map(line => ({
    seq: ++logSeq,
    time: now,
    source,
    line,
    text: `[${now}] [${source}] ${line}`,
  }));

  logBuffer.push(...entries);
  if (logBuffer.length > 2000) logBuffer = logBuffer.slice(-2000);

  const fileText = entries.map(entry => entry.text).join("\n") + "\n";
  try {
    fs.appendFileSync(LOG_FILE, fileText, "utf8");
  } catch {
    // Logging must never crash the GUI.
  }
}

function getBotStatus() {
  return {
    running: !!botProcess,
    pid: botProcess?.pid ?? null,
    startedAt: botStartedAt,
  };
}

function startBot() {
  ensureEnvFile();
  if (botProcess) return { started: false, message: "Bot はすでに起動中です。", status: getBotStatus() };

  appendLog("gui", "Bot を起動します。");
  botStartedAt = new Date().toISOString();
  botProcess = spawn(process.execPath, [BOT_ENTRY], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  botProcess.stdout.on("data", data => appendLog("bot", data));
  botProcess.stderr.on("data", data => appendLog("bot", data));
  botProcess.on("error", error => appendLog("bot", `process error: ${error.message}`));
  botProcess.on("close", (code, signal) => {
    appendLog("gui", `Bot が停止しました。code=${code ?? "null"} signal=${signal ?? "null"}`);
    botProcess = null;
    botStartedAt = null;
  });

  return { started: true, message: "Bot を起動しました。", status: getBotStatus() };
}

function stopBot() {
  if (!botProcess) return { stopped: false, message: "Bot は起動していません。", status: getBotStatus() };
  appendLog("gui", "Bot を停止します。");
  botProcess.kill();
  return { stopped: true, message: "Bot に停止シグナルを送りました。", status: getBotStatus() };
}

function runRegisterCommands() {
  ensureEnvFile();
  if (commandProcess) return { started: false, message: "スラッシュコマンド登録はすでに実行中です。" };

  appendLog("gui", "スラッシュコマンド登録を実行します。");
  commandProcess = spawn(process.execPath, [path.join(__dirname, "register-commands.mjs")], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  commandProcess.stdout.on("data", data => appendLog("commands", data));
  commandProcess.stderr.on("data", data => appendLog("commands", data));
  commandProcess.on("error", error => appendLog("commands", `process error: ${error.message}`));
  commandProcess.on("close", (code, signal) => {
    appendLog("gui", `スラッシュコマンド登録が終了しました。code=${code ?? "null"} signal=${signal ?? "null"}`);
    commandProcess = null;
  });

  return { started: true, message: "スラッシュコマンド登録を開始しました。" };
}

function jsonResponse(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function textResponse(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function staticPathFor(urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const decoded = decodeURIComponent(cleanPath);
  const resolved = path.resolve(STATIC_DIR, `.${decoded}`);
  const relative = path.relative(STATIC_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/config") {
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
    });
  }

  if (req.method === "POST" && pathname === "/api/config") {
    const body = await readJsonBody(req);
    writeEnv(body.values || {});
    const { values, orderedKeys } = readEnv();
    const unknownKeys = orderedKeys.filter(key => !KNOWN_ENV_KEYS.has(key));
    return jsonResponse(res, 200, {
      ok: true,
      message: "保存しました。Bot 起動中の場合は再起動してください。",
      values: buildGuiValues(values),
      unknownKeys,
      bot: getBotStatus(),
    });
  }

  if (req.method === "POST" && pathname === "/api/llm/models") {
    const body = await readJsonBody(req);
    const models = await listLlmModels({
      provider: body.provider,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    appendLog("gui", `LLM モデル一覧を取得しました。count=${models.length}`);
    return jsonResponse(res, 200, { models });
  }

  if (req.method === "POST" && pathname === "/api/bot/start") {
    return jsonResponse(res, 200, startBot());
  }

  if (req.method === "POST" && pathname === "/api/bot/stop") {
    return jsonResponse(res, 200, stopBot());
  }

  if (req.method === "POST" && pathname === "/api/bot/restart") {
    const wasRunning = !!botProcess;
    if (wasRunning) stopBot();
    setTimeout(() => startBot(), wasRunning ? 1200 : 0);
    return jsonResponse(res, 200, { restarted: true, message: "Bot を再起動します。", status: getBotStatus() });
  }

  if (req.method === "GET" && pathname === "/api/bot/status") {
    return jsonResponse(res, 200, getBotStatus());
  }

  if (req.method === "POST" && pathname === "/api/commands/register") {
    return jsonResponse(res, 200, runRegisterCommands());
  }

  if (req.method === "GET" && pathname === "/api/logs") {
    const since = Number(new URL(req.url, BASE_URL).searchParams.get("since") || 0);
    const entries = since > 0 ? logBuffer.filter(entry => entry.seq > since) : logBuffer;
    return jsonResponse(res, 200, { seq: logSeq, entries });
  }

  if (req.method === "POST" && pathname === "/api/logs/clear") {
    logBuffer = [];
    logSeq += 1;
    appendLog("gui", "画面ログをクリアしました。");
    return jsonResponse(res, 200, { ok: true, seq: logSeq });
  }

  return jsonResponse(res, 404, { error: "API endpoint not found." });
}

function serveStatic(req, res, pathname) {
  const filePath = staticPathFor(pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return textResponse(res, 404, "Not found");
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    appendLog("gui", `request error: ${error.stack || error.message}`);
    jsonResponse(res, 500, { error: error.message || String(error) });
  }
});

function openBrowser(url) {
  if (process.env.GUI_NO_OPEN === "1") return;
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

process.on("SIGINT", () => {
  if (botProcess) botProcess.kill();
  server.close(() => process.exit(0));
});

server.listen(PORT, HOST, () => {
  ensureEnvFile();
  appendLog("gui", `GUI を起動しました: ${BASE_URL}`);
  console.log(`GUI: ${BASE_URL}`);
  openBrowser(BASE_URL);
});
