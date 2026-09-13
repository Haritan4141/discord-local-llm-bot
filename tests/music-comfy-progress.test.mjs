import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import {
  buildComfyWebSocketUrl,
  COMFY_PROGRESS_EVENT_TYPES,
} from '../src/music/comfy-progress.mjs';
import { createComfyClient } from '../src/music/comfy-client.mjs';

class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.closed = false;
  }

  open() { this.emit('open'); }

  message(value, isBinary = false) { this.emit('message', value, isBinary); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const event = (type, promptId, data = {}) => JSON.stringify({ type, data: { prompt_id: promptId, ...data } });

test('buildComfyWebSocketUrl converts HTTP(S) base URLs and preserves a stable client id', () => {
  assert.equal(
    buildComfyWebSocketUrl('http://127.0.0.1:8188/', 'discord-music-test'),
    'ws://127.0.0.1:8188/ws?clientId=discord-music-test',
  );
  assert.equal(
    new URL(buildComfyWebSocketUrl('https://example.test/comfy', 'id with spaces')).protocol,
    'wss:',
  );
  assert.equal(new URL(buildComfyWebSocketUrl('https://example.test/comfy', 'id with spaces')).searchParams.get('clientId'), 'id with spaces');
  assert.deepEqual([...COMFY_PROGRESS_EVENT_TYPES].sort(), [
    'error', 'executed', 'executing', 'execution_cached', 'execution_start',
    'interrupted', 'progress', 'progress_state', 'success',
  ].sort());
});

test('openProgress buffers a bounded set of early events and filters by exact prompt id', async () => {
  const sockets = [];
  const websocketOptions = [];
  const received = [];
  const client = createComfyClient('http://localhost:8188', {
    websocketFactory: (url, options) => {
      websocketOptions.push(options);
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    connectTimeoutMs: 100,
    reconnectMs: 100,
    earlyEventLimit: 2,
    maxMessageBytes: 1000,
  });
  const progressPromise = client.openProgress({ onEvent: value => received.push(value) });
  sockets[0].open();
  const session = await progressPromise;

  sockets[0].message(event('progress', 'target', { value: 1, max: 4 }));
  sockets[0].message(event('progress', 'other', { value: 2, max: 4 }));
  sockets[0].message(event('progress', 'target', { value: 3, max: 4 }));
  sockets[0].message(event('progress', 'target', { value: 4, max: 4 }));
  session.setPromptId('target');

  // The bounded buffer keeps only the two most recent entries.
  assert.deepEqual(received.map(item => item.data.value), [3, 4]);
  sockets[0].message(event('execution_interrupted', 'target'));
  sockets[0].message(event('success', 'other'));
  sockets[0].message(event('success', 'target'));
  sockets[0].message(JSON.stringify({ type: 'progress', data: { value: 1, max: 2 } }));
  sockets[0].message(Buffer.from(event('success', 'target')), true);
  sockets[0].message('x'.repeat(1001));
  assert.deepEqual(received.map(item => item.type), ['progress', 'progress', 'interrupted', 'success']);
  assert.ok(received.every(item => item.data.prompt_id === 'target'));
  assert.equal(websocketOptions[0].maxPayload, 1000);
  session.close();
});

test('openProgress resolves on connection failure or timeout without throwing', async () => {
  const errors = [];
  const refused = createComfyClient('http://localhost:8188', {
    websocketFactory: () => { throw new Error('connection refused'); },
    connectTimeoutMs: 100,
    reconnectMs: 1000,
  });
  const refusedSession = await refused.openProgress({ onConnection: value => errors.push(value) });
  assert.ok(refusedSession.clientId.startsWith('discord-music-'));
  assert.deepEqual(errors, [false]);
  refusedSession.close();

  let neverOpeningSocket;
  const timedOut = createComfyClient('http://localhost:8188', {
    websocketFactory: url => (neverOpeningSocket = new FakeSocket(url)),
    connectTimeoutMs: 20,
    reconnectMs: 1000,
  });
  const started = Date.now();
  const timeoutSession = await timedOut.openProgress({ onConnection: value => errors.push(value) });
  assert.ok(Date.now() - started < 500);
  assert.equal(neverOpeningSocket.closed, true);
  timeoutSession.close();
});

test('disconnect reports unavailable and reconnects with the same client id without resubmitting', async () => {
  const sockets = [];
  const connections = [];
  const received = [];
  const client = createComfyClient('http://localhost:8188', {
    websocketFactory: url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    connectTimeoutMs: 100,
    reconnectMs: 10,
  });
  const sessionPromise = client.openProgress({
    onConnection: value => connections.push(value),
    onEvent: value => received.push(value),
  });
  sockets[0].open();
  const session = await sessionPromise;
  session.setPromptId('prompt-1');
  const firstClientId = new URL(sockets[0].url).searchParams.get('clientId');
  sockets[0].emit('close');
  await wait(25);
  assert.equal(sockets.length, 2);
  assert.equal(new URL(sockets[1].url).searchParams.get('clientId'), firstClientId);
  sockets[1].open();
  sockets[1].message(event('progress', 'prompt-1', { value: 1, max: 2 }));
  assert.deepEqual(connections, [true, false, true]);
  assert.equal(received.length, 1);
  session.close();
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise(resolve => server.close(() => resolve()));
}

async function closeWebSocketServer(server) {
  for (const socket of server.clients || []) socket.terminate();
  if (server._server?.listening === false) return;
  await new Promise(resolve => server.close(() => resolve()));
}

test('real localhost WebSocket accepts execution aliases and ignores binary frames', async () => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  wss.on('connection', socket => {
    socket.send(event('execution_success', 'real-prompt'));
    socket.send(Buffer.from(event('success', 'real-prompt')), { binary: true });
    socket.send(event('execution_error', 'other-prompt'));
  });
  await once(wss, 'listening');
  const port = wss.address().port;
  const received = [];
  try {
    const client = createComfyClient(`http://127.0.0.1:${port}`, {
      connectTimeoutMs: 300,
      reconnectMs: 1000,
      maxMessageBytes: 4096,
    });
    const sessionPromise = client.openProgress({ onEvent: value => received.push(value) });
    const session = await sessionPromise;
    session.setPromptId('real-prompt');
    await wait(20);
    assert.deepEqual(received.map(item => item.type), ['success']);
    session.close();
  } finally {
    await closeWebSocketServer(wss);
  }
});

test('real stalled HTTP upgrade and refused localhost connection resolve safely', async () => {
  let stalledServer;
  let refusedServer;
  let stalledSocket;
  let stalledSession;
  let refusedSession;
  try {
    stalledServer = createServer();
    stalledServer.on('upgrade', (_request, socket) => { stalledSocket = socket; });
    const stalledPort = await listen(stalledServer);
    const stalledClient = createComfyClient(`http://127.0.0.1:${stalledPort}`, {
      connectTimeoutMs: 25,
      reconnectMs: 1000,
    });
    const started = Date.now();
    stalledSession = await stalledClient.openProgress();
    assert.ok(Date.now() - started < 500);

    refusedServer = createServer();
    const refusedPort = await listen(refusedServer);
    await closeServer(refusedServer);
    refusedServer = null;
    const refusedClient = createComfyClient(`http://127.0.0.1:${refusedPort}`, {
      connectTimeoutMs: 100,
      reconnectMs: 1000,
    });
    const connections = [];
    refusedSession = await refusedClient.openProgress({ onConnection: value => connections.push(value) });
    assert.deepEqual(connections, [false]);
  } finally {
    stalledSession?.close();
    refusedSession?.close();
    stalledSocket?.destroy();
    await closeServer(stalledServer);
    await closeServer(refusedServer);
  }
});

test('close is idempotent and prevents later websocket events or reconnects', async () => {
  const sockets = [];
  const received = [];
  const connections = [];
  const client = createComfyClient('http://localhost:8188', {
    websocketFactory: url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    connectTimeoutMs: 100,
    reconnectMs: 10,
  });
  const promise = client.openProgress({
    onEvent: value => received.push(value),
    onConnection: value => connections.push(value),
  });
  sockets[0].open();
  const session = await promise;
  session.setPromptId('prompt-1');
  session.close();
  session.close();
  sockets[0].message(event('success', 'prompt-1'));
  sockets[0].emit('close');
  await wait(30);
  assert.equal(sockets.length, 1);
  assert.deepEqual(received, []);
  assert.deepEqual(connections, [true]);
});

test('submit uses the progress client id when supplied and retains a random fallback', async () => {
  const calls = [];
  const client = createComfyClient('http://localhost:8188', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json({ prompt_id: `prompt-${calls.length}` });
    },
    websocketFactory: () => {
      const socket = new FakeSocket('ws://localhost:8188/ws');
      queueMicrotask(() => socket.open());
      return socket;
    },
    connectTimeoutMs: 100,
  });
  const session = await client.openProgress();
  await client.submit({ node: {} }, { clientId: session.clientId });
  await client.submit({ node: {} });
  const first = JSON.parse(calls[0].options.body).client_id;
  const second = JSON.parse(calls[1].options.body).client_id;
  assert.equal(first, session.clientId);
  assert.match(second, /^discord-music-/);
  session.close();
});
