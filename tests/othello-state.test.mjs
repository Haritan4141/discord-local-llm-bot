import test from 'node:test';
import assert from 'node:assert/strict';
import { countPieces, getFlips, getLegalMoves, inBounds } from '../src/othello/board.mjs';
import { createGameState, finishGame, playMove, settleTurn, snapshotGame } from '../src/othello/state.mjs';

const state = () => createGameState({ id: 'testgame01', playerId: 'p', channelId: 'c', guildId: 'g' });
const board = text => text.split('/').map(row => [...row].map(Number));

test('external coordinates and flips cannot corrupt the board', () => {
  const game = state();
  const before = snapshotGame(game);
  for (const move of [{ r: -1, c: 0 }, { r: 2.5, c: 3 }, { r: '2', c: 3 }, { r: 0, c: 0 }]) {
    assert.equal(playMove(game, move), false);
    assert.deepEqual(game, before);
  }
  assert.equal(playMove(game, { r: 2, c: 3, flips: [[0, 0]] }), true);
  assert.equal(game.board[0][0], 0);
  assert.deepEqual(countPieces(game.board), { black: 4, white: 1 });
  assert.equal(inBounds(NaN, 2), false);
  assert.deepEqual(getFlips(game.board, 0, 0, 0), []);
});

test('snapshot remains unchanged when a move is applied', () => {
  const game = state();
  const snapshot = snapshotGame(game);
  playMove(game, { r: 2, c: 3 });
  assert.deepEqual(countPieces(snapshot.board), { black: 2, white: 2 });
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.lastMove, null);
  assert.equal(game.current, 2);
});

test('pass notices cannot overwrite the result of a game with empty squares', () => {
  const game = state();
  const path = 'D3 B3 B1 D2 F3 B4 B5 D1 F4 D6 H2 C4 A5 G5 A4 C7 D8 E7 B7 F6'.split(' ');
  for (const coord of path) {
    assert.equal(playMove(game, { r: Number(coord[1]) - 1, c: coord.charCodeAt(0) - 65 }, 1), true);
    while (game.status === 'playing' && game.current === 2) {
      const legal = getLegalMoves(game.board, 2);
      const ai = legal.reduce((a, b) => b.flips.length > a.flips.length ? b : a);
      assert.equal(playMove(game, ai, 2), true);
    }
  }
  assert.equal(game.status, 'finished');
  assert.deepEqual(game.result, { black: 2, white: 44, winner: 2 });
  assert.ok(game.passes.includes(1));
  const before = snapshotGame(game);
  assert.equal(playMove(game, { r: 0, c: 5 }), false);
  finishGame(game, 'expired');
  assert.deepEqual(game, before);
});

test('both colors pass correctly and terminal ties do not show a new turn', () => {
  for (const current of [1, 2]) {
    const game = state();
    game.current = current;
    // White can play A1; black cannot play anywhere.
    game.board = board('01222222/22222222/22222222/22222222/22222222/22222222/22222222/22222222');
    if (current === 2) game.board = game.board.map(row => row.map(v => v ? 3 - v : 0));
    settleTurn(game);
    assert.equal(game.current, 3 - current);
    assert.deepEqual(game.passes, [current]);
    assert.equal(game.status, 'playing');
  }
  const game = state();
  game.board = Array.from({ length: 8 }, (_, r) => Array(8).fill(r < 4 ? 1 : 2));
  settleTurn(game);
  assert.deepEqual(game.result, { black: 32, white: 32, winner: 0 });
});

test('automatic passes and many consecutive AI moves reach the actual end', () => {
  const game = state();
  game.board = board('22222222/22222220/22222201/22222211/22222121/22221200/11212121/00122222');
  assert.equal(playMove(game, { r: 5, c: 6 }, 1), true);
  let aiMoves = 0;
  while (game.status === 'playing' && game.current === 2) {
    const legal = getLegalMoves(game.board, 2);
    playMove(game, legal.reduce((a, b) => b.flips.length > a.flips.length ? b : a), 2);
    aiMoves++;
  }
  assert.equal(aiMoves, 5);
  assert.equal(game.status, 'finished');
  assert.deepEqual(game.result, { black: 3, white: 61, winner: 2 });
});

test('complete seeded games preserve piece counts and always offer a legal turn', () => {
  let seed = 5678;
  for (let trial = 0; trial < 200; trial++) {
    const game = state();
    let placements = 0;
    while (game.status === 'playing') {
      const legal = getLegalMoves(game.board, game.current);
      assert.ok(legal.length > 0);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      assert.equal(playMove(game, legal[seed % legal.length]), true);
      placements++;
      const pieces = countPieces(game.board);
      assert.equal(pieces.black + pieces.white, 4 + placements);
      assert.ok(placements <= 60);
    }
    assert.equal(getLegalMoves(game.board, 1).length + getLegalMoves(game.board, 2).length, 0);
    assert.equal(game.result.winner, game.result.black === game.result.white ? 0 : game.result.black > game.result.white ? 1 : 2);
  }
});
