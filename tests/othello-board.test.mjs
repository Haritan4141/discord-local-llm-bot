import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHELLO_AI,
  OTHELLO_EMPTY,
  OTHELLO_PLAYER,
  OTHELLO_SIZE,
  applyMove,
  cloneBoard,
  countPieces,
  createOthelloBoard,
  getFlips,
  getLegalMoves,
  inBounds,
  isBoardFull,
  otherColor,
} from '../src/othello/board.mjs';

test('createOthelloBoard sets the standard opening', () => {
  const b = createOthelloBoard();
  assert.equal(b.length, OTHELLO_SIZE);
  assert.equal(b[0].length, OTHELLO_SIZE);
  // Standard starting position: center 2x2 is two pairs of diagonally opposite pieces.
  assert.equal(b[3][3], OTHELLO_AI);
  assert.equal(b[4][4], OTHELLO_AI);
  assert.equal(b[3][4], OTHELLO_PLAYER);
  assert.equal(b[4][3], OTHELLO_PLAYER);
  // Empty corners.
  assert.equal(b[0][0], OTHELLO_EMPTY);
});

test('inBounds / otherColor sanity', () => {
  assert.equal(inBounds(0, 0), true);
  assert.equal(inBounds(7, 7), true);
  assert.equal(inBounds(-1, 0), false);
  assert.equal(inBounds(0, 8), false);
  assert.equal(otherColor(OTHELLO_PLAYER), OTHELLO_AI);
  assert.equal(otherColor(OTHELLO_AI), OTHELLO_PLAYER);
});

test('getLegalMoves on starting position returns 4 player moves', () => {
  const b = createOthelloBoard();
  const playerMoves = getLegalMoves(b, OTHELLO_PLAYER);
  assert.equal(playerMoves.length, 4);
  const aiMoves = getLegalMoves(b, OTHELLO_AI);
  assert.equal(aiMoves.length, 4);
  // Each move must flip at least one piece.
  for (const m of playerMoves) {
    assert.ok(m.flips.length >= 1);
  }
});

test('getFlips returns empty for occupied cells and for non-flipping squares', () => {
  const b = createOthelloBoard();
  assert.deepEqual(getFlips(b, 3, 3, OTHELLO_PLAYER), []);
  assert.deepEqual(getFlips(b, 0, 0, OTHELLO_PLAYER), []);
});

test('applyMove flips the captured pieces and places the new stone', () => {
  const b = createOthelloBoard();
  // Standard opening: black plays D3 (r=2, c=3) flipping the white at D4 (3,3).
  const move = getLegalMoves(b, OTHELLO_PLAYER).find(m => m.r === 2 && m.c === 3);
  assert.ok(move, 'expected D3 to be legal');
  applyMove(b, OTHELLO_PLAYER, move);
  assert.equal(b[2][3], OTHELLO_PLAYER);
  assert.equal(b[3][3], OTHELLO_PLAYER); // flipped
});

test('countPieces / isBoardFull / cloneBoard', () => {
  const b = createOthelloBoard();
  const { black, white } = countPieces(b);
  assert.equal(black, 2);
  assert.equal(white, 2);
  assert.equal(isBoardFull(b), false);

  const copy = cloneBoard(b);
  copy[0][0] = OTHELLO_AI;
  assert.equal(b[0][0], OTHELLO_EMPTY, 'cloneBoard must produce an independent copy');
});

test('isBoardFull returns true for a fully populated board', () => {
  const b = Array.from({ length: OTHELLO_SIZE }, () => Array(OTHELLO_SIZE).fill(OTHELLO_PLAYER));
  assert.equal(isBoardFull(b), true);
});
