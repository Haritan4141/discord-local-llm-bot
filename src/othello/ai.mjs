import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  OTHELLO_SIZE,
  applyMove,
  cloneBoard,
  countPieces,
  getLegalMoves,
  isBoardFull,
  otherColor,
} from './board.mjs';

export const OTHELLO_POSITION_WEIGHT = [
  [120, -20,  20,   5,   5,  20, -20, 120],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [120, -20,  20,   5,   5,  20, -20, 120],
];

// Positive = good for the player (black). Higher absolute weights = stronger play.
export function evaluateBoard(board) {
  const { black, white } = countPieces(board);
  const diff = black - white;
  let positional = 0;
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      const v = board[r][c];
      if (v === OTHELLO_PLAYER) positional += OTHELLO_POSITION_WEIGHT[r][c];
      else if (v === OTHELLO_AI) positional -= OTHELLO_POSITION_WEIGHT[r][c];
    }
  }
  const mobility = getLegalMoves(board, OTHELLO_PLAYER).length - getLegalMoves(board, OTHELLO_AI).length;
  return diff + positional + mobility * 2;
}

export function chooseAiMove(board, moves, difficulty) {
  if (!moves.length) return null;

  if (difficulty === 'easy') {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (difficulty === 'normal') {
    return moves.reduce((best, m) => (m.flips.length > best.flips.length ? m : best), moves[0]);
  }

  if (difficulty === 'hard') {
    const corners = new Set([
      '0,0',
      `0,${OTHELLO_SIZE - 1}`,
      `${OTHELLO_SIZE - 1},0`,
      `${OTHELLO_SIZE - 1},${OTHELLO_SIZE - 1}`,
    ]);
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const key = `${m.r},${m.c}`;
      let score = m.flips.length;
      if (corners.has(key)) score += 20;
      if (m.r === 0 || m.r === OTHELLO_SIZE - 1 || m.c === 0 || m.c === OTHELLO_SIZE - 1) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  const maxDepth = 5;
  function minimax(boardState, color, depth, alpha, beta) {
    const legal = getLegalMoves(boardState, color);
    if (
      depth === 0
      || isBoardFull(boardState)
      || (legal.length === 0 && getLegalMoves(boardState, otherColor(color)).length === 0)
    ) {
      return evaluateBoard(boardState);
    }
    if (legal.length === 0) {
      return minimax(boardState, otherColor(color), depth - 1, alpha, beta);
    }
    if (color === OTHELLO_AI) {
      let best = -Infinity;
      for (const m of legal) {
        const next = cloneBoard(boardState);
        applyMove(next, color, m);
        best = Math.max(best, minimax(next, otherColor(color), depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of legal) {
      const next = cloneBoard(boardState);
      applyMove(next, color, m);
      best = Math.min(best, minimax(next, otherColor(color), depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = cloneBoard(board);
    applyMove(next, OTHELLO_AI, m);
    const score = minimax(next, OTHELLO_PLAYER, maxDepth - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}
