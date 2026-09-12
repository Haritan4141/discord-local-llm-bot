import { Worker } from 'node:worker_threads';
import {
  OTHELLO_AI,
  cloneBoard,
  getLegalMoves,
} from './board.mjs';
import { getAiSearchProfile } from './ai.mjs';

export const MAX_OTHELLO_AI_WORKERS = 2;
export const MAX_OTHELLO_AI_QUEUE_LENGTH = 100;
export const DEFAULT_OTHELLO_AI_QUEUE_WAIT_MS = 10_000;
const MAX_WORKER_TIMEOUT_MS = 60_000;
const DEFAULT_WORKER_GRACE_MS = 1_000;

const queuedRequests = [];
let activeWorkerCount = 0;
let requestSequence = 0;

export class OthelloAiWorkerError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'OthelloAiWorkerError';
    if (cause) this.cause = cause;
  }
}

export class OthelloAiWorkerTimeoutError extends OthelloAiWorkerError {
  constructor(message) {
    super(message);
    this.name = 'OthelloAiWorkerTimeoutError';
  }
}

export class OthelloAiInvalidResultError extends OthelloAiWorkerError {
  constructor(message = 'Othello AI worker returned an invalid move') {
    super(message);
    this.name = 'OthelloAiInvalidResultError';
  }
}

export class OthelloAiQueueFullError extends OthelloAiWorkerError {
  constructor(message = 'Othello AI request queue is full') {
    super(message);
    this.name = 'OthelloAiQueueFullError';
  }
}

export class OthelloAiQueueTimeoutError extends OthelloAiWorkerError {
  constructor(message = 'Othello AI request waited too long in the queue') {
    super(message);
    this.name = 'OthelloAiQueueTimeoutError';
  }
}

function createAbortError() {
  const error = new Error('Othello AI search was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function moveCoordinates(move) {
  return move ? { r: move.r, c: move.c } : null;
}

function workerTimeoutMs(difficulty, options) {
  const requested = Number(options.workerTimeoutMs);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(MAX_WORKER_TIMEOUT_MS, Math.max(1, requested));
  }

  const profile = getAiSearchProfile(difficulty);
  const budget = Number(options.timeBudgetMs);
  const searchBudget = Number.isFinite(budget) && budget >= 0 ? budget : profile.timeBudgetMs;
  return Math.min(
    MAX_WORKER_TIMEOUT_MS,
    Math.max(DEFAULT_WORKER_GRACE_MS, searchBudget + DEFAULT_WORKER_GRACE_MS),
  );
}

function queueWaitTimeoutMs(options) {
  const requested = Number(options.queueWaitTimeoutMs);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(MAX_WORKER_TIMEOUT_MS, Math.max(1, requested));
  }
  return DEFAULT_OTHELLO_AI_QUEUE_WAIT_MS;
}

function workerSearchOptions(options) {
  const result = {};
  if (options.timeBudgetMs !== undefined) result.timeBudgetMs = options.timeBudgetMs;
  if (options.maxDepth !== undefined) result.maxDepth = options.maxDepth;
  return result;
}

function removeQueuedRequest(request) {
  const index = queuedRequests.indexOf(request);
  if (index >= 0) queuedRequests.splice(index, 1);
}

function cleanupRequest(request) {
  if (request.queueTimeout) clearTimeout(request.queueTimeout);
  request.queueTimeout = null;
  if (request.timeout) clearTimeout(request.timeout);
  request.timeout = null;
  if (request.signal && request.abortListener) {
    request.signal.removeEventListener('abort', request.abortListener);
  }
  request.abortListener = null;
}

function releaseWorker(request) {
  if (request.released) return;
  request.released = true;
  activeWorkerCount -= 1;
  pumpWorkers();
}

function settleRequest(request, value, error = null) {
  if (request.done) return;
  request.done = true;
  cleanupRequest(request);

  if (error) request.reject(error);
  else request.resolve(value);

  if (!request.worker) {
    if (request.started) releaseWorker(request);
    return;
  }

  // Termination is awaited before releasing the slot so a cancelled or timed
  // out search cannot briefly exceed the worker concurrency limit.
  Promise.resolve(request.worker.terminate())
    .catch(() => {})
    .finally(() => releaseWorker(request));
}

function abortRequest(request) {
  if (request.done) return;
  if (!request.started) {
    removeQueuedRequest(request);
    settleRequest(request, null, createAbortError());
    return;
  }

  request.aborted = true;
  Atomics.store(request.cancelView, 0, 1);
  settleRequest(request, null, createAbortError());
}

function startWorker(request) {
  activeWorkerCount += 1;
  request.started = true;
  request.cancelView = new Int32Array(new SharedArrayBuffer(4));
  if (request.queueTimeout) clearTimeout(request.queueTimeout);
  request.queueTimeout = null;

  try {
    request.worker = new Worker(new URL('./ai-worker.mjs', import.meta.url), {
      type: 'module',
      // Do not inherit test-runner or host-specific V8 flags. Some valid
      // process flags are rejected by Worker on newer Node versions.
      execArgv: [],
    });
  } catch (error) {
    settleRequest(request, null, new OthelloAiWorkerError('Failed to start Othello AI worker', error));
    return;
  }

  request.timeout = setTimeout(() => {
    if (request.done) return;
    settleRequest(
      request,
      null,
      new OthelloAiWorkerTimeoutError('Othello AI worker exceeded its finite wait limit'),
    );
  }, workerTimeoutMs(request.difficulty, request.options));
  request.timeout.unref?.();

  request.worker.once('message', message => {
    if (request.done) return;
    if (message?.type === 'result') {
      const result = message.move;
      const legal = request.legalMoves;
      const valid = result && legal.find(move => move.r === result.r && move.c === result.c);
      // The client validates the worker response against the snapshot used to
      // start the request before returning coordinates to the caller.
      if (!valid) {
        settleRequest(request, null, new OthelloAiInvalidResultError());
      } else {
        settleRequest(request, moveCoordinates(valid));
      }
      return;
    }

    const messageText = message?.message || 'Unknown Othello AI worker failure';
    settleRequest(request, null, new OthelloAiWorkerError(messageText));
  });

  request.worker.once('error', error => {
    if (request.done) return;
    settleRequest(request, null, new OthelloAiWorkerError('Othello AI worker failed', error));
  });

  request.worker.once('exit', code => {
    if (request.done) return;
    const message = code === 0
      ? 'Othello AI worker exited before returning a result'
      : `Othello AI worker exited with code ${code}`;
    settleRequest(request, null, new OthelloAiWorkerError(message));
  });

  try {
    request.worker.postMessage({
      type: 'search',
      board: request.board,
      difficulty: request.difficulty,
      options: workerSearchOptions(request.options),
      cancelBuffer: request.cancelView.buffer,
    });
  } catch (error) {
    settleRequest(request, null, new OthelloAiWorkerError('Failed to send Othello AI worker request', error));
  }
}

function pumpWorkers() {
  while (activeWorkerCount < MAX_OTHELLO_AI_WORKERS && queuedRequests.length) {
    const request = queuedRequests.shift();
    if (request.done) continue;
    if (request.signal?.aborted) {
      settleRequest(request, null, createAbortError());
      continue;
    }
    startWorker(request);
  }
}

export function getOthelloAiWorkerStats() {
  return {
    active: activeWorkerCount,
    pending: queuedRequests.length,
    limit: MAX_OTHELLO_AI_WORKERS,
  };
}

/**
 * Search for an AI move without blocking the caller's Node.js event loop.
 * The promise rejects with AbortError when signal is aborted and with an
 * OthelloAiWorkerError when the finite worker wait or worker itself fails.
 */
export function chooseAiMoveAsync(board, difficulty = 'normal', options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  let boardSnapshot;
  let legalMoves;
  try {
    boardSnapshot = cloneBoard(board);
    legalMoves = getLegalMoves(boardSnapshot, OTHELLO_AI);
  } catch (error) {
    return Promise.reject(error);
  }

  if (!legalMoves.length) return Promise.resolve(null);
  if (safeOptions.signal?.aborted) return Promise.reject(createAbortError());
  if (queuedRequests.length >= MAX_OTHELLO_AI_QUEUE_LENGTH) {
    return Promise.reject(new OthelloAiQueueFullError());
  }

  return new Promise((resolve, reject) => {
    const request = {
      id: requestSequence += 1,
      board: boardSnapshot,
      legalMoves,
      difficulty,
      options: safeOptions,
      signal: safeOptions.signal || null,
      resolve,
      reject,
      started: false,
      done: false,
      released: false,
      aborted: false,
      abortListener: null,
      queueTimeout: null,
      timeout: null,
      worker: null,
      cancelView: null,
    };
    request.abortListener = () => abortRequest(request);
    request.signal?.addEventListener('abort', request.abortListener, { once: true });
    request.queueTimeout = setTimeout(() => {
      if (request.done || request.started) return;
      removeQueuedRequest(request);
      settleRequest(
        request,
        null,
        new OthelloAiQueueTimeoutError(),
      );
      pumpWorkers();
    }, queueWaitTimeoutMs(safeOptions));
    request.queueTimeout.unref?.();
    queuedRequests.push(request);
    pumpWorkers();
  });
}
