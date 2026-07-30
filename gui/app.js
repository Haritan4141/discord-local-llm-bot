const form = document.querySelector('#configForm');
const envPath = document.querySelector('#envPath');
const saveBtn = document.querySelector('#saveBtn');
const reloadBtn = document.querySelector('#reloadBtn');
const startBotBtn = document.querySelector('#startBotBtn');
const stopBotBtn = document.querySelector('#stopBotBtn');
const restartBotBtn = document.querySelector('#restartBotBtn');
const startStandbyBtn = document.querySelector('#startStandbyBtn');
const stopStandbyBtn = document.querySelector('#stopStandbyBtn');
const restartStandbyBtn = document.querySelector('#restartStandbyBtn');
const registerGuildCommandsBtn = document.querySelector('#registerGuildCommandsBtn');
const registerGlobalCommandsBtn = document.querySelector('#registerGlobalCommandsBtn');
const clearLogBtn = document.querySelector('#clearLogBtn');
const logBox = document.querySelector('#logBox');
const botState = document.querySelector('#botState');
const standbyState = document.querySelector('#standbyState');
const saveState = document.querySelector('#saveState');
const pidText = document.querySelector('#pidText');
const standbyPidText = document.querySelector('#standbyPidText');
const toast = document.querySelector('#toast');
const showSecrets = document.querySelector('#showSecrets');
const autoScroll = document.querySelector('#autoScroll');

let sections = [];
let fieldMap = new Map();
let lastSeq = 0;
let dirty = false;
let toastTimer = null;
let modelSelect = null;

const placeholderValues = new Set([
  'your_discord_bot_token_here',
  'your_discord_application_client_id_here',
  'your_discord_server_guild_id_here',
]);

const providerDefaults = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
};

const GUI_TOKEN =
  document.querySelector('meta[name="gui-token"]')?.getAttribute('content') || '';

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      'X-GUI-Token': GUI_TOKEN,
      ...(options.headers || {}),
    },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

function setDirty(next) {
  dirty = next;
  saveState.textContent = dirty ? '未保存あり' : '未保存なし';
  saveState.className = dirty ? 'pill warn' : 'pill ok';
}

function setProcessStatus({ pill, pidLabel, label, status, startBtn, stopBtn, restartBtn }) {
  const running = !!status?.running;
  pill.textContent = running ? `${label} 起動中` : `${label} 停止中`;
  pill.className = running ? 'pill ok' : 'pill neutral';
  pidLabel.textContent = running ? `PID: ${status.pid}` : 'PID: -';
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;
  if (restartBtn) restartBtn.disabled = !running;
}

function setBotStatus(status) {
  setProcessStatus({
    pill: botState,
    pidLabel: pidText,
    label: 'Main Bot',
    status,
    startBtn: startBotBtn,
    stopBtn: stopBotBtn,
    restartBtn: restartBotBtn,
  });
}

function setStandbyStatus(status) {
  setProcessStatus({
    pill: standbyState,
    pidLabel: standbyPidText,
    label: 'Standby',
    status,
    startBtn: startStandbyBtn,
    stopBtn: stopStandbyBtn,
    restartBtn: restartStandbyBtn,
  });
}

function applyProcessInterlocks(botStatus, standbyStatus) {
  if (standbyStatus?.running) {
    startBotBtn.disabled = true;
  }
  if (botStatus?.running) {
    startStandbyBtn.disabled = true;
  }
}

function fieldId(key) {
  return `env-${key}`;
}

function escapeText(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function getFieldValue(key) {
  return fieldMap.get(key)?.control?.value?.trim() || '';
}

function createField(field, value) {
  const wrap = document.createElement('div');
  const isLong = field.type === 'textarea'
    || field.type === 'model'
    || field.key === 'CHANNEL_IDS'
    || field.key === 'STANDBY_CHANNEL_IDS'
    || field.key === 'SYSTEM_PROMPT'
    || field.key === 'SD_NEGATIVE_PROMPT';
  wrap.className = `field${isLong ? ' full' : ''}${field.required ? ' required' : ''}`;
  wrap.dataset.key = field.key;

  const id = fieldId(field.key);
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.innerHTML = `<span>${escapeText(field.label)}</span><span class="key">${escapeText(field.key)}</span>`;
  wrap.appendChild(label);

  let control;
  if (field.type === 'textarea') {
    control = document.createElement('textarea');
  } else if (field.type === 'select') {
    control = document.createElement('select');
    control.appendChild(new Option('(未設定)', ''));
    for (const optionValue of field.options || []) {
      control.appendChild(new Option(optionValue, optionValue));
    }
  } else {
    control = document.createElement('input');
    control.type = field.type === 'password' && !showSecrets.checked
      ? 'password'
      : field.type === 'model'
        ? 'text'
        : field.type || 'text';
  }

  control.id = id;
  control.name = field.key;
  control.value = value ?? '';
  if (field.placeholder) control.placeholder = field.placeholder;
  if (field.required) control.required = true;
  if (field.type === 'number') {
    if (field.min !== undefined) control.min = String(field.min);
    if (field.max !== undefined) control.max = String(field.max);
    if (field.step !== undefined) control.step = String(field.step);
  }

  const onChange = () => {
    validateField(field, control);
    setDirty(true);
  };
  control.addEventListener('input', onChange);
  control.addEventListener('change', onChange);

  if (field.type === 'model') {
    const modelGroup = document.createElement('div');
    modelGroup.className = 'model-picker';

    modelSelect = document.createElement('select');
    modelSelect.className = 'model-select';
    modelSelect.disabled = true;
    modelSelect.appendChild(new Option('Fetch Models で一覧を取得', ''));
    modelSelect.addEventListener('change', () => {
      if (!modelSelect.value) return;
      control.value = modelSelect.value;
      validateField(field, control);
      setDirty(true);
    });
    modelGroup.appendChild(modelSelect);

    const row = document.createElement('div');
    row.className = 'input-row';
    row.appendChild(control);

    const fetchButton = document.createElement('button');
    fetchButton.type = 'button';
    fetchButton.className = 'secondary small-button';
    fetchButton.textContent = 'Fetch Models';
    fetchButton.addEventListener('click', () => {
      fetchLlmModels().catch(error => showToast(error.message));
    });
    row.appendChild(fetchButton);
    modelGroup.appendChild(row);
    wrap.appendChild(modelGroup);
  } else {
    wrap.appendChild(control);
  }

  if (field.help) {
    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = field.help;
    wrap.appendChild(help);
  }

  fieldMap.set(field.key, { field, control, wrap });
  validateField(field, control);
  return wrap;
}

function validateIdList(value, { allowEmpty = false } = {}) {
  const ids = value.split(',').map(item => item.trim()).filter(Boolean);
  if (!ids.length) return allowEmpty;
  return ids.every(id => /^\d{17,20}$/.test(id));
}

function validateField(field, control) {
  const wrap = control.closest('.field');
  const value = control.value.trim();
  let valid = true;

  if (field.required && !value) valid = false;
  if (field.required && placeholderValues.has(value)) valid = false;
  if (field.key === 'LLM_BASE_URL' && getFieldValue('LLM_PROVIDER') === 'custom' && !value) {
    valid = false;
  }
  if (value && field.type === 'number' && !Number.isFinite(Number(value))) valid = false;
  if (value && field.key === 'LLM_TEMPERATURE') {
    const numeric = Number(value);
    valid = Number.isFinite(numeric) && numeric >= 0 && numeric <= 2;
  }
  if (value && field.key === 'LLM_MAX_HISTORY_MESSAGES') {
    const numeric = Number(value);
    valid = Number.isInteger(numeric) && numeric >= 0;
  }
  if (value && field.key === 'OPENAI_WEB_SEARCH_MAX_TOOL_CALLS') {
    const numeric = Number(value);
    valid = Number.isInteger(numeric) && numeric >= 1 && numeric <= 10;
  }
  if (value && field.key === 'OPENAI_WEB_SEARCH_MAX_SOURCES') {
    const numeric = Number(value);
    valid = Number.isInteger(numeric) && numeric >= 0 && numeric <= 10;
  }
  if (value && field.key === 'STANDBY_REPLY_COOLDOWN_SECONDS') {
    const numeric = Number(value);
    valid = Number.isInteger(numeric) && numeric >= 0;
  }
  if (value && field.type === 'url') {
    try {
      new URL(value);
    } catch {
      valid = false;
    }
  }
  if (value && field.key === 'CLIENT_ID' && !/^\d{17,20}$/.test(value)) valid = false;
  if (value && field.key === 'GUILD_ID') valid = validateIdList(value);
  if (field.key === 'CHANNEL_IDS' && !validateIdList(value)) valid = false;
  if (value && field.key === 'STANDBY_CHANNEL_IDS' && !validateIdList(value, { allowEmpty: true })) {
    valid = false;
  }

  wrap.classList.toggle('invalid', !valid);
  return valid;
}

function renderForm(values) {
  form.replaceChildren();
  fieldMap = new Map();
  modelSelect = null;

  for (const section of sections) {
    const card = document.createElement('section');
    card.className = 'section-card';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML = `<h2>${escapeText(section.title)}</h2><p>${escapeText(section.description || '')}</p>`;
    card.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'field-grid';
    for (const field of section.fields) {
      grid.appendChild(createField(field, values[field.key]));
    }
    card.appendChild(grid);
    form.appendChild(card);
  }

  attachLlmProviderBehavior();
}

function isKnownProviderDefault(value) {
  return Object.values(providerDefaults).includes(value);
}

function attachLlmProviderBehavior() {
  const provider = fieldMap.get('LLM_PROVIDER')?.control;
  const baseUrl = fieldMap.get('LLM_BASE_URL')?.control;
  if (!provider || !baseUrl) return;

  provider.addEventListener('change', () => {
    const nextDefault = providerDefaults[provider.value] || '';
    if (!baseUrl.value.trim() || isKnownProviderDefault(baseUrl.value.trim())) {
      baseUrl.value = nextDefault;
      validateField(fieldMap.get('LLM_BASE_URL').field, baseUrl);
    }
    setDirty(true);
  });
}

function updateModelOptions(models) {
  if (!modelSelect) return;
  const current = getFieldValue('LLM_MODEL');
  modelSelect.replaceChildren();
  modelSelect.appendChild(new Option(models.length ? 'モデルを選択' : 'モデル一覧なし', ''));
  for (const model of models) {
    modelSelect.appendChild(new Option(model, model));
  }
  modelSelect.disabled = models.length === 0;
  modelSelect.value = current && models.includes(current) ? current : '';
}

async function fetchLlmModels() {
  const provider = getFieldValue('LLM_PROVIDER') || 'ollama';
  const baseUrl = getFieldValue('LLM_BASE_URL') || providerDefaults[provider] || '';
  const apiKey = getFieldValue('LLM_API_KEY');

  if (!baseUrl) {
    showToast('LLM_BASE_URL を入力してください。');
    return;
  }

  const data = await api('/api/llm/models', {
    method: 'POST',
    body: JSON.stringify({ provider, baseUrl, apiKey }),
  });
  const models = data.models || [];
  updateModelOptions(models);
  if (!models.length) {
    showToast('モデル一覧を取得できませんでした。');
    return;
  }

  const modelControl = fieldMap.get('LLM_MODEL')?.control;
  if (modelControl && !modelControl.value.trim()) {
    modelControl.value = models[0];
    validateField(fieldMap.get('LLM_MODEL').field, modelControl);
    setDirty(true);
  }
  showToast(`${models.length} 件のモデルを取得しました。`);
}

function collectValues() {
  const values = {};
  let valid = true;
  for (const [key, item] of fieldMap) {
    values[key] = item.control.value;
    if (!validateField(item.field, item.control)) valid = false;
  }
  return { values, valid };
}

async function loadConfig() {
  const data = await api('/api/config');
  sections = data.sections || [];
  envPath.textContent = `.env: ${data.envPath}`;
  renderForm(data.values || {});
  updateModelOptions(data.values?.LLM_MODEL ? [data.values.LLM_MODEL] : []);
  setBotStatus(data.bot || {});
  setStandbyStatus(data.standby || {});
  applyProcessInterlocks(data.bot || {}, data.standby || {});
  setDirty(false);

  if (data.envCreated) {
    showToast('.env がなかったため .env.example から自動作成しました。');
  }
  if (Array.isArray(data.unknownKeys) && data.unknownKeys.length) {
    showToast(`GUI 未対応の .env キーがあります: ${data.unknownKeys.join(', ')}`);
  }
}

async function saveConfig() {
  const { values, valid } = collectValues();
  if (!valid) {
    showToast('入力内容を確認してください。');
    return;
  }
  const data = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
  renderForm(data.values || values);
  updateModelOptions((data.values || values).LLM_MODEL ? [(data.values || values).LLM_MODEL] : []);
  setBotStatus(data.bot || {});
  setStandbyStatus(data.standby || {});
  setDirty(false);
  showToast(data.message || '保存しました。');
}

async function refreshStatus() {
  const [bot, standby] = await Promise.all([
    api('/api/bot/status'),
    api('/api/standby/status'),
  ]);
  setBotStatus(bot);
  setStandbyStatus(standby);
  applyProcessInterlocks(bot, standby);
}

async function postAction(path, successFallback) {
  const data = await api(path, { method: 'POST', body: '{}' });
  showToast(data.message || successFallback);
  await refreshStatus();
}

async function pollLogs() {
  try {
    const data = await api(`/api/logs?since=${lastSeq}`);
    const entries = data.entries || [];
    if (entries.length) {
      if (logBox.textContent === 'ログを読み込み中です...') logBox.textContent = '';
      logBox.textContent += entries.map(entry => entry.text).join('\n') + '\n';
      lastSeq = data.seq || entries[entries.length - 1].seq || lastSeq;
      if (logBox.textContent.length > 200000) {
        logBox.textContent = logBox.textContent.slice(-160000);
      }
      if (autoScroll.checked) logBox.scrollTop = logBox.scrollHeight;
    } else if (data.seq) {
      lastSeq = Math.max(lastSeq, data.seq);
    }
  } catch {
    // Ignore transient polling errors.
  }
}

saveBtn.addEventListener('click', () => saveConfig().catch(error => showToast(error.message)));
reloadBtn.addEventListener('click', () => loadConfig().catch(error => showToast(error.message)));
startBotBtn.addEventListener('click', () => postAction('/api/bot/start', 'Bot を起動しました。').catch(error => showToast(error.message)));
stopBotBtn.addEventListener('click', () => postAction('/api/bot/stop', 'Bot を停止します。').catch(error => showToast(error.message)));
restartBotBtn.addEventListener('click', () => postAction('/api/bot/restart', 'Bot を再起動します。').catch(error => showToast(error.message)));
startStandbyBtn.addEventListener('click', () => postAction('/api/standby/start', 'Standby Bot を起動しました。').catch(error => showToast(error.message)));
stopStandbyBtn.addEventListener('click', () => postAction('/api/standby/stop', 'Standby Bot を停止します。').catch(error => showToast(error.message)));
restartStandbyBtn.addEventListener('click', () => postAction('/api/standby/restart', 'Standby Bot を再起動します。').catch(error => showToast(error.message)));
registerGuildCommandsBtn.addEventListener('click', () => postAction('/api/commands/register-guild', 'ギルドコマンド登録を開始しました。').catch(error => showToast(error.message)));
registerGlobalCommandsBtn.addEventListener('click', () => postAction('/api/commands/register-global', 'グローバルコマンド登録を開始しました。').catch(error => showToast(error.message)));
clearLogBtn.addEventListener('click', async () => {
  logBox.textContent = '';
  lastSeq = 0;
  await api('/api/logs/clear', { method: 'POST', body: '{}' });
  await pollLogs();
});
showSecrets.addEventListener('change', () => {
  for (const { field, control } of fieldMap.values()) {
    if (field.type === 'password') {
      control.type = showSecrets.checked ? 'text' : 'password';
    }
  }
});

window.addEventListener('beforeunload', event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

loadConfig().catch(error => showToast(error.message));
pollLogs();
setInterval(pollLogs, 1200);
setInterval(() => refreshStatus().catch(() => {}), 2500);
