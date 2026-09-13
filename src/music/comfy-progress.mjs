import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

/**
 * ComfyUI sends a mixture of execution, node-progress, and queue messages on
 * the same websocket.  Keep this allow-list deliberately small: callers can
 * add node-specific validation after the transport has associated an event
 * with their prompt.
 */
export const COMFY_PROGRESS_EVENT_TYPES = Object.freeze([
  'executing',
  'progress',
  'progress_state',
  'execution_cached',
  'executed',
  'execution_start',
  'success',
  'error',
  'interrupted',
]);

const EVENT_TYPES = new Set(COMFY_PROGRESS_EVENT_TYPES);
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_RECONNECT_MS = 1_000;
const DEFAULT_EARLY_EVENT_LIMIT = 64;
const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;
const EVENT_TYPE_ALIASES = Object.freeze({
  execution_success: 'success',
  execution_error: 'error',
  execution_interrupted: 'interrupted',
});

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function messageByteLength(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Number.POSITIVE_INFINITY;
}

function toTextMessage(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  return null;
}

function safeCallback(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    const result = callback(...args);
    // A consumer callback is allowed to be async.  Do not let a rejected
    // callback become an unhandled rejection in a long-running Bot process.
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Progress reporting is best-effort and must never affect generation.
  }
}

function addListener(socket, event, handler) {
  if (typeof socket?.on === 'function') {
    socket.on(event, handler);
    return () => {
      if (typeof socket.off === 'function') socket.off(event, handler);
      else if (typeof socket.removeListener === 'function') socket.removeListener(event, handler);
    };
  }
  if (typeof socket?.addEventListener === 'function') {
    socket.addEventListener(event, handler);
    return () => socket.removeEventListener?.(event, handler);
  }
  throw new TypeError('ComfyUI websocket does not expose an event API');
}

function installSafeErrorSink(socket) {
  const sink = () => {};
  try {
    if (typeof socket?.on === 'function') {
      socket.on('error', sink);
      return;
    }
    socket?.addEventListener?.('error', sink);
  } catch {
    // The socket may already be closed; there is nothing else to do.
  }
}

function closeSocket(socket, { terminate = false } = {}) {
  try {
    // ws can emit an asynchronous `error` when close() aborts a CONNECTING
    // handshake.  Keep a no-op error listener through the transition.  When
    // available, terminate() also avoids ws's long abort-handshake timeout.
    installSafeErrorSink(socket);
    const isConnecting = socket?.readyState === WebSocket.CONNECTING || socket?.readyState === 0;
    if ((terminate || isConnecting) && typeof socket?.terminate === 'function') socket.terminate();
    else if (typeof socket?.close === 'function') socket.close();
    else if (typeof socket?.terminate === 'function') socket.terminate();
  } catch {
    // A failed close is harmless; the session has already detached handlers.
  }
}

function normalizeWebSocketUrl(baseUrl, clientId) {
  const url = new URL(baseUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new TypeError('ComfyUI base URL must use http(s), ws(s), or a compatible URL');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('clientId', clientId);
  return url.toString();
}

export function buildComfyWebSocketUrl(baseUrl, clientId) {
  const id = nonEmptyString(clientId);
  if (!id) throw new TypeError('ComfyUI websocket clientId is required');
  return normalizeWebSocketUrl(baseUrl, id);
}

function validateEvent(raw, promptId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = EVENT_TYPE_ALIASES[raw.type] || raw.type;
  if (!EVENT_TYPES.has(type)) return null;
  const data = raw.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const eventPromptId = nonEmptyString(data.prompt_id);
  if (!eventPromptId || (promptId && eventPromptId !== promptId)) return null;
  if (type === 'progress') {
    if (!Number.isFinite(Number(data.value)) || !Number.isFinite(Number(data.max))) return null;
    if (Number(data.max) <= 0 || Number(data.value) < 0) return null;
  }
  if (type === 'progress_state' && (!data.nodes || typeof data.nodes !== 'object' || Array.isArray(data.nodes))) return null;
  return { type, data };
}

function createSession(baseUrl, {
  websocketFactory = (url, options) => new WebSocket(url, options),
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  reconnectMs = DEFAULT_RECONNECT_MS,
  earlyEventLimit = DEFAULT_EARLY_EVENT_LIMIT,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  onEvent,
  onConnection,
} = {}) {
  const clientId = `discord-music-${randomUUID()}`;
  const connectTimeout = positiveInteger(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const reconnectDelay = positiveInteger(reconnectMs, DEFAULT_RECONNECT_MS);
  const eventLimit = positiveInteger(earlyEventLimit, DEFAULT_EARLY_EVENT_LIMIT);
  const messageLimit = positiveInteger(maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
  const earlyEvents = [];

  let socket = null;
  let socketCleanup = [];
  let connectTimer = null;
  let reconnectTimer = null;
  let closed = false;
  let currentPromptId = null;
  let connectionState;
  let initialSettled = false;
  let resolveInitial;

  const initialReady = new Promise(resolve => { resolveInitial = resolve; });

  function settleInitial() {
    if (initialSettled) return;
    initialSettled = true;
    resolveInitial();
  }

  function clearConnectTimer() {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function updateConnection(available) {
    if (connectionState === available) return;
    connectionState = available;
    safeCallback(onConnection, available);
  }

  function removeSocketListeners() {
    for (const cleanup of socketCleanup.splice(0)) {
      try { cleanup(); } catch { /* best effort */ }
    }
  }

  function detachSocket(candidate, { close = false, terminate = false } = {}) {
    if (candidate !== socket) return;
    clearConnectTimer();
    removeSocketListeners();
    socket = null;
    if (close) closeSocket(candidate, { terminate });
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
  }

  function onMessage(candidate, rawValue, isBinary = false) {
    if (closed || candidate !== socket || isBinary) return;

    // Browser EventTarget message listeners receive a MessageEvent, while
    // ws's EventEmitter receives (data, isBinary).  Accept both forms.
    let raw = rawValue;
    if (rawValue && typeof rawValue === 'object' && 'data' in rawValue && arguments.length < 3) raw = rawValue.data;
    if (messageByteLength(raw) > messageLimit) return;
    const text = toTextMessage(raw);
    if (text === null) return;

    let parsed;
    try { parsed = JSON.parse(text); } catch { return; }
    const event = validateEvent(parsed, currentPromptId);
    if (!event) return;

    if (!currentPromptId) {
      if (earlyEvents.length >= eventLimit) earlyEvents.shift();
      earlyEvents.push(event);
      return;
    }
    safeCallback(onEvent, event);
  }

  function onOpen(candidate) {
    if (closed || candidate !== socket) return;
    clearConnectTimer();
    updateConnection(true);
    settleInitial();
  }

  function onClose(candidate) {
    if (candidate !== socket) return;
    detachSocket(candidate);
    updateConnection(false);
    settleInitial();
    scheduleReconnect();
  }

  function onError(candidate) {
    if (closed || candidate !== socket) return;
    // ws normally emits close after error, but test doubles and alternative
    // websocket implementations are not required to do so.
    updateConnection(false);
    settleInitial();
    detachSocket(candidate, { close: true, terminate: true });
    scheduleReconnect();
  }

  function onConnectTimeout(candidate) {
    if (closed || candidate !== socket) return;
    // A non-opening socket must not block reconnect forever.  Detach first so
    // its eventual close cannot affect the replacement attempt.
    updateConnection(false);
    settleInitial();
    detachSocket(candidate, { close: true, terminate: true });
    scheduleReconnect();
  }

  function connect() {
    if (closed || socket || reconnectTimer !== null) return;
    let candidate;
    try {
      candidate = websocketFactory(buildComfyWebSocketUrl(baseUrl, clientId), {
        // ws enforces this limit while receiving the frame, before it is
        // delivered to the application.  The application check below remains
        // necessary for text encodings and non-ws test/browser transports.
        maxPayload: messageLimit,
      });
    } catch {
      updateConnection(false);
      settleInitial();
      scheduleReconnect();
      return;
    }
    if (!candidate) {
      updateConnection(false);
      settleInitial();
      scheduleReconnect();
      return;
    }
    socket = candidate;
    try {
      const messageHandler = (...args) => {
        const value = args[0];
        // EventTarget implementations deliver one MessageEvent, whereas ws
        // delivers (data, isBinary).  Keep the distinction before forwarding
        // the message so browser-like test doubles work as well.
        if (args.length === 1 && value && typeof value === 'object' && 'data' in value) {
          onMessage(candidate, value.data, false);
        } else {
          onMessage(candidate, value, args[1] === true);
        }
      };
      socketCleanup = [
        addListener(candidate, 'open', () => onOpen(candidate)),
        addListener(candidate, 'message', messageHandler),
        addListener(candidate, 'close', () => onClose(candidate)),
        addListener(candidate, 'error', () => onError(candidate)),
      ];
    } catch {
      updateConnection(false);
      settleInitial();
      detachSocket(candidate, { close: true, terminate: true });
      scheduleReconnect();
      return;
    }
    connectTimer = setTimeout(() => onConnectTimeout(candidate), connectTimeout);
  }

  const session = {
    clientId,
    setPromptId(promptId) {
      const id = nonEmptyString(promptId);
      if (closed || !id) return false;
      if (currentPromptId && currentPromptId !== id) return false;
      currentPromptId = id;
      const pending = earlyEvents.splice(0);
      for (const event of pending) {
        if (event.data.prompt_id === id) safeCallback(onEvent, event);
      }
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      clearConnectTimer();
      clearReconnectTimer();
      earlyEvents.length = 0;
      const candidate = socket;
      removeSocketListeners();
      socket = null;
      // Progress is optional and the server is not required to complete a
      // websocket close handshake.  Terminate the client-side transport so a
      // terminal music result cannot leave a long-lived socket handle behind.
      if (candidate) closeSocket(candidate, { terminate: true });
      settleInitial();
    },
  };

  connect();
  return initialReady.then(() => session);
}

/**
 * Create the per-ComfyUI-client progress transport used by comfy-client.mjs.
 * A new call to openProgress creates one stable clientId and one reconnecting
 * websocket session for a single queued prompt.
 */
export function createComfyProgressTransport(baseUrl, options = {}) {
  return {
    openProgress({ onEvent, onConnection } = {}) {
      return createSession(baseUrl, { ...options, onEvent, onConnection });
    },
  };
}
