import { performance } from 'node:perf_hooks';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  OTHELLO_SIZE,
  applyMove,
  cloneBoard,
  countPieces,
  getLegalMoves,
  otherColor,
} from './board.mjs';

export const OTHELLO_POSITION_WEIGHT = [
  [120, -20,  20,   5,   5,  20, -20, 120],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [-20, -40,  -5,  -5,  -5, -5, -40, -20],
  [120, -20,  20,   5,   5,  20, -20, 120],
];

// Every non-terminal positional score is far smaller than this value. The
// sign is from the AI (white) point of view: positive means good for white.
export const OTHELLO_WIN_SCORE = 1_000_000;

export const AI_SEARCH_PROFILES = Object.freeze({
  normal: Object.freeze({ timeBudgetMs: 40, maxDepth: 3 }),
  hard: Object.freeze({ timeBudgetMs: 160, maxDepth: 6 }),
  max: Object.freeze({ timeBudgetMs: 600, maxDepth: 12 }),
});

const MAX_TIME_BUDGET_MS = 30_000;
const SEARCH_CHECK_INTERVAL = 64;

class SearchAborted extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SearchAborted';
  }
}

function terminalScore(pieceDiff) {
  if (pieceDiff > 0) return OTHELLO_WIN_SCORE + pieceDiff;
  if (pieceDiff < 0) return -OTHELLO_WIN_SCORE + pieceDiff;
  return 0;
}

// Positive values are good for the AI (white). Terminal wins are deliberately
// much stronger than positional or mobility terms.
export function evaluateBoard(board) {
  const { black, white } = countPieces(board);
  const playerMoves = getLegalMoves(board, OTHELLO_PLAYER);
  const aiMoves = getLegalMoves(board, OTHELLO_AI);
  const pieceDiff = white - black;

  if (playerMoves.length === 0 && aiMoves.length === 0) {
    return terminalScore(pieceDiff);
  }

  let positional = 0;
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      const v = board[r][c];
      if (v === OTHELLO_AI) positional += OTHELLO_POSITION_WEIGHT[r][c];
      else if (v === OTHELLO_PLAYER) positional -= OTHELLO_POSITION_WEIGHT[r][c];
    }
  }

  const mobility = aiMoves.length - playerMoves.length;
  return pieceDiff + positional + mobility * 2;
}

function moveKey(move) {
  return `${move.r},${move.c}`;
}

function isCorner(move) {
  return (
    (move.r === 0 || move.r === OTHELLO_SIZE - 1)
    && (move.c === 0 || move.c === OTHELLO_SIZE - 1)
  );
}

function isEdge(move) {
  return move.r === 0
    || move.r === OTHELLO_SIZE - 1
    || move.c === 0
    || move.c === OTHELLO_SIZE - 1;
}

function moveOrderingScore(move) {
  if (isCorner(move)) return 100_000 + move.flips.length;
  if (isEdge(move)) return 10_000 + move.flips.length;
  return move.flips.length;
}

function orderMoves(moves) {
  return moves
    .map((move, index) => ({ move, index }))
    .sort((a, b) => moveOrderingScore(b.move) - moveOrderingScore(a.move) || a.index - b.index)
    .map(item => item.move);
}

function normalizeTimeBudget(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  return Math.min(MAX_TIME_BUDGET_MS, Math.max(1, value));
}

function normalizeMaxDepth(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(32, Math.max(1, Math.floor(value)));
}

export function getAiSearchProfile(difficulty) {
  const profile = AI_SEARCH_PROFILES[difficulty] || AI_SEARCH_PROFILES.max;
  return { ...profile };
}

function resolveSearchOptions(difficulty, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const profile = getAiSearchProfile(difficulty);
  return {
    timeBudgetMs: normalizeTimeBudget(safeOptions.timeBudgetMs, profile.timeBudgetMs),
    maxDepth: normalizeMaxDepth(safeOptions.maxDepth, profile.maxDepth),
    signal: safeOptions.signal || null,
    cancelView: safeOptions.cancelView || null,
  };
}

function boardKey(board) {
  return board.map(row => row.join('')).join('');
}

function checkSearchBudget(context) {
  context.nodes += 1;
  if ((context.nodes % SEARCH_CHECK_INTERVAL) !== 0) return;

  if (context.signal?.aborted || (context.cancelView && Atomics.load(context.cancelView, 0) !== 0)) {
    context.cancelled = true;
    throw new SearchAborted('cancelled');
  }
  if (performance.now() >= context.deadline) {
    throw new SearchAborted('time budget exceeded');
  }
}

function minimax(board, color, depth, alpha, beta, context) {
  checkSearchBudget(context);

  const legal = getLegalMoves(board, color);
  const opponent = otherColor(color);
  const opponentLegal = legal.length === 0 ? getLegalMoves(board, opponent) : null;

  // A pass is not a move. If both sides have no move, evaluate the actual
  // result; otherwise keep the same depth for the opponent's turn.
  if (legal.length === 0 && opponentLegal.length === 0) return evaluateBoard(board);
  if (depth <= 0) return evaluateBoard(board);
  if (legal.length === 0) return minimax(board, opponent, depth, alpha, beta, context);

  const cacheKey = `${boardKey(board)}|${color}|${depth}`;
  const alphaStart = alpha;
  const betaStart = beta;
  const cached = context.table.get(cacheKey);
  if (cached) {
    if (cached.bound === 'exact') return cached.value;
    if (cached.bound === 'lower') alpha = Math.max(alpha, cached.value);
    else if (cached.bound === 'upper') beta = Math.min(beta, cached.value);
    if (beta <= alpha) return cached.value;
  }

  const ordered = orderMoves(legal);
  let best;
  if (color === OTHELLO_AI) {
    best = -Infinity;
    for (const move of ordered) {
      const next = cloneBoard(board);
      applyMove(next, color, move);
      best = Math.max(best, minimax(next, opponent, depth - 1, alpha, beta, context));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) {
        break;
      }
    }
  } else {
    best = Infinity;
    for (const move of ordered) {
      const next = cloneBoard(board);
      applyMove(next, color, move);
      best = Math.min(best, minimax(next, opponent, depth - 1, alpha, beta, context));
      beta = Math.min(beta, best);
      if (beta <= alpha) {
        break;
      }
    }
  }

  // Preserve the alpha-beta bound type. A cut-off value is not necessarily an
  // exact score and must not be reused as one on another branch.
  const bound = best <= alphaStart ? 'upper' : best >= betaStart ? 'lower' : 'exact';
  context.table.set(cacheKey, { value: best, bound });
  return best;
}

function searchAtDepth(board, moves, depth, context) {
  let bestMove = null;
  let bestScore = -Infinity;
  for (const move of orderMoves(moves)) {
    checkSearchBudget(context);
    const next = cloneBoard(board);
    applyMove(next, OTHELLO_AI, move);
    const score = minimax(next, OTHELLO_PLAYER, depth - 1, -Infinity, Infinity, context);
    if (bestMove === null || score > bestScore) {
      bestMove = move;
      bestScore = score;
    }
  }
  return { move: bestMove, score: bestScore };
}

function fallbackMove(moves) {
  return orderMoves(moves)[0] || null;
}

function searchBestMove(board, moves, difficulty, options = {}) {
  if (!moves.length) return null;
  if (difficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];

  const settings = resolveSearchOptions(difficulty, options);
  let bestMove = fallbackMove(moves);
  if (settings.timeBudgetMs <= 0) return bestMove;

  const context = {
    deadline: performance.now() + settings.timeBudgetMs,
    signal: settings.signal,
    cancelView: settings.cancelView,
    nodes: 0,
    cancelled: false,
    table: new Map(),
  };

  for (let depth = 1; depth <= settings.maxDepth; depth++) {
    try {
      const result = searchAtDepth(board, moves, depth, context);
      if (result.move) bestMove = result.move;
    } catch (error) {
      if (error instanceof SearchAborted) break;
      throw error;
    }
  }
  return bestMove;
}

function normalizeCandidateMoves(board, moves) {
  // An explicitly empty list is the caller's statement that there is no move.
  // This preserves the historical synchronous API behavior.
  if (Array.isArray(moves) && moves.length === 0) return [];

  const legal = getLegalMoves(board, OTHELLO_AI);
  if (!Array.isArray(moves)) return legal;

  const byKey = new Map(legal.map(move => [moveKey(move), move]));
  const selected = [];
  const seen = new Set();
  for (const candidate of moves) {
    const move = candidate && byKey.get(moveKey(candidate));
    if (move && !seen.has(moveKey(move))) {
      selected.push(move);
      seen.add(moveKey(move));
    }
  }

  // A stale list should never permit an illegal move. Recompute the legal list
  // when every supplied candidate is stale or malformed.
  return selected.length ? selected : legal;
}

// Synchronous compatibility API. The async worker API in ai-client.mjs should
// be used by Discord request handlers so search cannot block the main thread.
export function chooseAiMove(board, moves, difficulty = 'normal', options = {}) {
  const candidates = normalizeCandidateMoves(board, moves);
  return searchBestMove(board, candidates, difficulty, options);
}
