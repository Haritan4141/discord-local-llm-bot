export const OTHELLO_SIZE = 8;
export const OTHELLO_EMPTY = 0;
export const OTHELLO_PLAYER = 1; // player (black)
export const OTHELLO_AI = 2; // AI (white)
export const OTHELLO_DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function createOthelloBoard() {
  const b = Array.from({ length: OTHELLO_SIZE }, () => Array(OTHELLO_SIZE).fill(OTHELLO_EMPTY));
  const mid = OTHELLO_SIZE / 2;
  b[mid - 1][mid - 1] = OTHELLO_AI;
  b[mid][mid] = OTHELLO_AI;
  b[mid - 1][mid] = OTHELLO_PLAYER;
  b[mid][mid - 1] = OTHELLO_PLAYER;
  return b;
}

export function inBounds(r, c) {
  return r >= 0 && r < OTHELLO_SIZE && c >= 0 && c < OTHELLO_SIZE;
}

export function otherColor(color) {
  return color === OTHELLO_PLAYER ? OTHELLO_AI : OTHELLO_PLAYER;
}

export function getFlips(board, r, c, color) {
  if (!inBounds(r, c) || board[r][c] !== OTHELLO_EMPTY) return [];
  const opp = otherColor(color);
  const flips = [];
  for (const [dr, dc] of OTHELLO_DIRS) {
    let rr = r + dr;
    let cc = c + dc;
    const line = [];
    while (inBounds(rr, cc) && board[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length && inBounds(rr, cc) && board[rr][cc] === color) {
      flips.push(...line);
    }
  }
  return flips;
}

export function getLegalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      const flips = getFlips(board, r, c, color);
      if (flips.length) moves.push({ r, c, flips });
    }
  }
  return moves;
}

export function applyMove(board, color, move) {
  board[move.r][move.c] = color;
  for (const [rr, cc] of move.flips) {
    board[rr][cc] = color;
  }
}

export function countPieces(board) {
  let black = 0;
  let white = 0;
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      if (board[r][c] === OTHELLO_PLAYER) black += 1;
      else if (board[r][c] === OTHELLO_AI) white += 1;
    }
  }
  return { black, white };
}

export function isBoardFull(board) {
  for (let r = 0; r < OTHELLO_SIZE; r++) {
    for (let c = 0; c < OTHELLO_SIZE; c++) {
      if (board[r][c] === OTHELLO_EMPTY) return false;
    }
  }
  return true;
}

export function cloneBoard(board) {
  return board.map(row => row.slice());
}
