import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  applyMove,
  createOthelloBoard,
  getLegalMoves,
} from '../src/othello/board.mjs';
import { chooseAiMove, evaluateBoard, OTHELLO_WIN_SCORE } from '../src/othello/ai.mjs';

const A3_BOARD = [
  [2, 2, 2, 2, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 2, 1, 1],
  [0, 2, 2, 2, 2, 2, 1, 1],
  [2, 1, 2, 2, 2, 2, 1, 1],
  [2, 2, 1, 1, 1, 2, 1, 1],
  [2, 2, 2, 2, 1, 1, 1, 1],
  [2, 2, 2, 0, 1, 0, 0, 2],
  [2, 2, 0, 1, 1, 1, 0, 0],
];

test('chooseAiMove returns null when there are no legal moves', () => {
  assert.equal(chooseAiMove(createOthelloBoard(), [], 'max'), null);
});

test('chooseAiMove ignores stale or illegal supplied moves', () => {
  const board = createOthelloBoard();
  const moves = getLegalMoves(board, OTHELLO_AI);
  const fakeMove = { r: 7, c: 7, flips: [[6, 6], [5, 5], [4, 4]] };
  const pick = chooseAiMove(board, [...moves, fakeMove], 'normal', { timeBudgetMs: 0 });
  assert.ok(moves.some(move => move.r === pick.r && move.c === pick.c));
  assert.notEqual(pick, fakeMove);
});

test('hard difficulty uses deterministic corner-first fallback when time is exhausted', () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(OTHELLO_PLAYER));
  board[0][0] = 0;
  board[0][1] = OTHELLO_PLAYER;
  board[0][2] = OTHELLO_AI;
  const moves = getLegalMoves(board, OTHELLO_AI);
  assert.ok(moves.some(move => move.r === 0 && move.c === 0));
  const pick = chooseAiMove(board, moves, 'hard', { timeBudgetMs: 0 });
  assert.deepEqual({ r: pick.r, c: pick.c }, { r: 0, c: 0 });
});

test('chooseAiMove for max is deterministic and returns a legal move', () => {
  const board = createOthelloBoard();
  const moves = getLegalMoves(board, OTHELLO_AI);
  const options = { timeBudgetMs: 40, maxDepth: 3 };
  const pick1 = chooseAiMove(board, moves, 'max', options);
  const pick2 = chooseAiMove(board, moves, 'max', options);
  assert.deepEqual(pick1, pick2, 'max should be deterministic for a given position');
  assert.ok(moves.some(move => move.r === pick1.r && move.c === pick1.c), 'picked move must be legal');
});

test('evaluateBoard scores from the AI white perspective', () => {
  const board = createOthelloBoard();
  const baseScore = evaluateBoard(board);
  const withPlayerCorner = createOthelloBoard();
  withPlayerCorner[0][0] = OTHELLO_PLAYER;
  const withAiCorner = createOthelloBoard();
  withAiCorner[0][0] = OTHELLO_AI;
  assert.equal(baseScore, 0);
  assert.ok(evaluateBoard(withPlayerCorner) < baseScore);
  assert.ok(evaluateBoard(withAiCorner) > baseScore);
});

test('terminal evaluation prioritizes the actual winner over position weights', () => {
  const board = [
    [1, 2, 2, 2, 2, 2, 2, 2],
    [1, 2, 2, 2, 2, 2, 2, 2],
    [1, 2, 1, 2, 2, 1, 1, 2],
    [1, 1, 2, 1, 2, 2, 1, 2],
    [1, 1, 2, 2, 1, 1, 2, 2],
    [1, 1, 2, 1, 2, 1, 2, 2],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];
  // White has 34 stones to black's 30, despite black owning many high-value
  // squares. Both sides have no legal move in this full terminal position.
  assert.equal(getLegalMoves(board, OTHELLO_PLAYER).length, 0);
  assert.equal(getLegalMoves(board, OTHELLO_AI).length, 0);
  assert.ok(evaluateBoard(board) >= OTHELLO_WIN_SCORE);
});

test('max selects the winning move in the A3 regression position', () => {
  const moves = getLegalMoves(A3_BOARD, OTHELLO_AI);
  const pick = chooseAiMove(A3_BOARD, moves, 'max', { timeBudgetMs: 250, maxDepth: 12 });
  assert.deepEqual({ r: pick.r, c: pick.c }, { r: 2, c: 0 });
});

test('applying the AI move keeps the board consistent', () => {
  const board = createOthelloBoard();
  const moves = getLegalMoves(board, OTHELLO_AI);
  const pick = chooseAiMove(board, moves, 'max', { timeBudgetMs: 40, maxDepth: 3 });
  applyMove(board, OTHELLO_AI, pick);
  assert.equal(board[pick.r][pick.c], OTHELLO_AI);
  assert.ok(pick.flips.length >= 1);
});
