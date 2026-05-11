import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  applyMove,
  createOthelloBoard,
  getLegalMoves,
} from '../src/othello/board.mjs';
import { chooseAiMove, evaluateBoard } from '../src/othello/ai.mjs';

test('chooseAiMove returns null when there are no legal moves', () => {
  assert.equal(chooseAiMove(createOthelloBoard(), [], 'max'), null);
});

test('chooseAiMove for "normal" prefers the move with the most flips', () => {
  // Construct a contrived position where one move flips many more pieces.
  const board = createOthelloBoard();
  // Pretend it's AI to move at the opening (it has 4 legal moves, each flipping 1).
  const moves = getLegalMoves(board, OTHELLO_AI);
  // Manually add a fake move with more flips to confirm the helper picks it.
  const fakeMove = { r: 7, c: 7, flips: [[6, 6], [5, 5], [4, 4]] };
  const pick = chooseAiMove(board, [...moves, fakeMove], 'normal');
  assert.equal(pick, fakeMove);
});

test('chooseAiMove for "hard" prefers corners over flip count', () => {
  const board = createOthelloBoard();
  const cornerMove = { r: 0, c: 0, flips: [[1, 1]] };
  const fatMove = { r: 4, c: 5, flips: [[3, 4], [2, 3]] };
  const pick = chooseAiMove(board, [cornerMove, fatMove], 'hard');
  assert.equal(pick, cornerMove);
});

test('chooseAiMove for "max" is deterministic and returns a legal move', () => {
  const board = createOthelloBoard();
  const moves = getLegalMoves(board, OTHELLO_AI);
  const pick1 = chooseAiMove(board, moves, 'max');
  const pick2 = chooseAiMove(board, moves, 'max');
  assert.deepEqual(pick1, pick2, '"max" should be deterministic for a given position');
  assert.ok(moves.some(m => m.r === pick1.r && m.c === pick1.c), 'picked move must be legal');
});

test('evaluateBoard scores corner ownership strongly', () => {
  const board = createOthelloBoard();
  const baseScore = evaluateBoard(board);
  const withPlayerCorner = createOthelloBoard();
  withPlayerCorner[0][0] = OTHELLO_PLAYER;
  const withAiCorner = createOthelloBoard();
  withAiCorner[0][0] = OTHELLO_AI;
  assert.ok(evaluateBoard(withPlayerCorner) > baseScore);
  assert.ok(evaluateBoard(withAiCorner) < baseScore);
});

test('applying the AI move keeps the board consistent', () => {
  const board = createOthelloBoard();
  const moves = getLegalMoves(board, OTHELLO_AI);
  const pick = chooseAiMove(board, moves, 'max');
  applyMove(board, OTHELLO_AI, pick);
  // The chosen square is now AI and at least one piece was flipped.
  assert.equal(board[pick.r][pick.c], OTHELLO_AI);
  assert.ok(pick.flips.length >= 1);
});
