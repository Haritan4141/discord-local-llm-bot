import {
  OTHELLO_AI, OTHELLO_PLAYER, applyMove, cloneBoard, countPieces,
  createOthelloBoard, getLegalMoves, inBounds, otherColor,
} from './board.mjs';

export const DIFFICULTY_LABELS = Object.freeze({ easy: '弱め', normal: '普通', hard: '強め', max: '最強' });

export function createGameState({ id, playerId, channelId, guildId, difficulty = 'normal' }) {
  return {
    id, playerId, channelId, guildId,
    difficulty: Object.hasOwn(DIFFICULTY_LABELS, difficulty) ? difficulty : 'normal',
    board: createOthelloBoard(), current: OTHELLO_PLAYER, status: 'playing',
    revision: 0, page: 0, confirmResign: false,
    lastMove: null, lastPlayerMove: null, lastAiMove: null, passes: [], result: null,
  };
}

export function snapshotGame(state) {
  return {
    ...state, board: cloneBoard(state.board), passes: [...state.passes],
    lastMove: state.lastMove && { ...state.lastMove },
    lastPlayerMove: state.lastPlayerMove && { ...state.lastPlayerMove },
    lastAiMove: state.lastAiMove && { ...state.lastAiMove },
    result: state.result && { ...state.result },
  };
}

// Each move fills one empty square. Passes resolve here without an arbitrary
// iteration limit, including games that finish while empty squares remain.
export function settleTurn(state) {
  if (state.status !== 'playing') return;
  const currentMoves = getLegalMoves(state.board, state.current);
  const nextColor = otherColor(state.current);
  const nextMoves = getLegalMoves(state.board, nextColor);
  if (!currentMoves.length && !nextMoves.length) {
    finishGame(state, 'finished');
  } else if (!currentMoves.length) {
    state.passes.push(state.current);
    state.current = nextColor;
  }
}

export function finishGame(state, status) {
  if (state.status !== 'playing') return;
  const pieces = countPieces(state.board);
  state.status = status;
  state.confirmResign = false;
  state.result = {
    ...pieces,
    winner: status === 'resigned' ? OTHELLO_AI
      : status !== 'finished' ? null
        : pieces.black === pieces.white ? 0
          : pieces.black > pieces.white ? OTHELLO_PLAYER : OTHELLO_AI,
  };
  state.revision += 1;
}

// The boundary accepts coordinates only; never trust flips from the client or
// an AI worker. Recompute against the current board before mutating anything.
export function playMove(state, { r, c }, color = state.current) {
  if (state.status !== 'playing' || color !== state.current || !inBounds(r, c)) return false;
  const move = getLegalMoves(state.board, color).find(m => m.r === r && m.c === c);
  if (!move) return false;
  if (color === OTHELLO_PLAYER) state.passes = [];
  applyMove(state.board, color, move);
  const recorded = { r, c, color };
  state.lastMove = recorded;
  if (color === OTHELLO_PLAYER) state.lastPlayerMove = recorded;
  else state.lastAiMove = recorded;
  state.current = otherColor(color);
  state.page = 0;
  state.confirmResign = false;
  state.revision += 1;
  settleTurn(state);
  return true;
}

export function coordinate({ r, c }) {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}
