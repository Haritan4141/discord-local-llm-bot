import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  OTHELLO_AI,
  createOthelloBoard,
  getLegalMoves,
} from '../src/othello/board.mjs';
import {
  chooseAiMoveAsync,
  getOthelloAiWorkerStats,
  MAX_OTHELLO_AI_WORKERS,
  OthelloAiQueueTimeoutError,
  OthelloAiWorkerTimeoutError,
} from '../src/othello/ai-client.mjs';

const BUSY_BOARD = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 1, 1, 0, 1, 1, 0],
  [0, 2, 2, 1, 1, 1, 0, 0],
  [1, 0, 2, 1, 2, 2, 0, 0],
  [0, 0, 2, 1, 1, 0, 0, 0],
  [2, 2, 2, 1, 1, 1, 2, 0],
  [0, 2, 0, 1, 2, 0, 1, 0],
  [2, 0, 0, 0, 0, 2, 0, 0],
];

function openingLegalCoordinates() {
  return getLegalMoves(createOthelloBoard(), OTHELLO_AI).map(move => `${move.r},${move.c}`);
}

async function waitForWorkersToDrain() {
  for (let i = 0; i < 50; i++) {
    if (getOthelloAiWorkerStats().active === 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(getOthelloAiWorkerStats().active, 0);
}

test('chooseAiMoveAsync returns a legal coordinate and does not mutate the board', async () => {
  const board = createOthelloBoard();
  const before = JSON.stringify(board);
  const move = await chooseAiMoveAsync(board, 'normal', { timeBudgetMs: 20, maxDepth: 2 });
  assert.ok(move);
  assert.ok(openingLegalCoordinates().includes(`${move.r},${move.c}`));
  assert.equal(JSON.stringify(board), before);
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync rejects promptly when aborted', async () => {
  const controller = new AbortController();
  const pending = chooseAiMoveAsync(createOthelloBoard(), 'max', {
    timeBudgetMs: 500,
    maxDepth: 12,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync rejects when a worker exceeds its finite wait limit', async () => {
  await assert.rejects(
    chooseAiMoveAsync(createOthelloBoard(), 'hard', {
      timeBudgetMs: 100,
      maxDepth: 8,
      workerTimeoutMs: 1,
    }),
    error => error instanceof OthelloAiWorkerTimeoutError,
  );
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync can abort a request waiting in the queue', async () => {
  const options = { timeBudgetMs: 1_000, maxDepth: 32, workerTimeoutMs: 3_000 };
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = chooseAiMoveAsync(BUSY_BOARD, 'max', { ...options, signal: firstController.signal });
  const second = chooseAiMoveAsync(BUSY_BOARD, 'max', { ...options, signal: secondController.signal });
  const controller = new AbortController();
  const queued = chooseAiMoveAsync(BUSY_BOARD, 'max', {
    ...options,
    signal: controller.signal,
    queueWaitTimeoutMs: 1_000,
  });
  assert.equal(getOthelloAiWorkerStats().active, MAX_OTHELLO_AI_WORKERS);
  assert.ok(getOthelloAiWorkerStats().pending >= 1);
  controller.abort();
  await assert.rejects(queued, error => error?.name === 'AbortError');
  firstController.abort();
  secondController.abort();
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected'));
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync times out a request that remains queued', async () => {
  const options = { timeBudgetMs: 1_000, maxDepth: 32, workerTimeoutMs: 3_000 };
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = chooseAiMoveAsync(BUSY_BOARD, 'max', { ...options, signal: firstController.signal });
  const second = chooseAiMoveAsync(BUSY_BOARD, 'max', { ...options, signal: secondController.signal });
  const queued = chooseAiMoveAsync(BUSY_BOARD, 'max', {
    ...options,
    queueWaitTimeoutMs: 10,
  });
  await assert.rejects(queued, error => error instanceof OthelloAiQueueTimeoutError);
  firstController.abort();
  secondController.abort();
  await Promise.allSettled([first, second]);
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync leaves the main event loop responsive during search', async () => {
  const started = performance.now();
  const movePromise = chooseAiMoveAsync(BUSY_BOARD, 'max', { timeBudgetMs: 120, maxDepth: 12 });
  const immediateDelay = await new Promise(resolve => {
    setImmediate(() => resolve(performance.now() - started));
  });
  assert.ok(immediateDelay < 250, `setImmediate delayed by ${immediateDelay}ms`);
  assert.ok(await movePromise);
  await waitForWorkersToDrain();
});

test('chooseAiMoveAsync caps concurrent workers and drains queued requests', async () => {
  const requests = Array.from({ length: MAX_OTHELLO_AI_WORKERS + 3 }, () => (
    chooseAiMoveAsync(createOthelloBoard(), 'normal', { timeBudgetMs: 20, maxDepth: 2 })
  ));
  const duringSearch = getOthelloAiWorkerStats();
  assert.ok(duringSearch.active <= MAX_OTHELLO_AI_WORKERS);
  assert.ok(duringSearch.pending >= 0);
  const results = await Promise.all(requests);
  assert.equal(results.length, MAX_OTHELLO_AI_WORKERS + 3);
  for (const move of results) {
    assert.ok(move);
    assert.ok(openingLegalCoordinates().includes(`${move.r},${move.c}`));
  }
  await waitForWorkersToDrain();
  assert.deepEqual(getOthelloAiWorkerStats(), {
    active: 0,
    pending: 0,
    limit: MAX_OTHELLO_AI_WORKERS,
  });
});

test('chooseAiMoveAsync returns null when the AI has no legal move', async () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(1));
  assert.equal(await chooseAiMoveAsync(board, 'normal'), null);
  assert.deepEqual(getOthelloAiWorkerStats(), {
    active: 0,
    pending: 0,
    limit: MAX_OTHELLO_AI_WORKERS,
  });
});
