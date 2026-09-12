import { deflateSync } from 'node:zlib';
import {
  OTHELLO_AI,
  OTHELLO_EMPTY,
  OTHELLO_PLAYER,
  OTHELLO_SIZE,
} from './board.mjs';

// The board geometry is intentionally kept here so callers only need the PNG
// renderer. The number of rows/columns itself comes from board.mjs.
export const OTHELLO_RENDER = {
  size: OTHELLO_SIZE,
  cell: 48,
  pad: 8,
  axis: 20,
  line: 2,
};

// A small, dependency-free 5x7 bitmap font is enough for the coordinate axes.
// Keeping the glyphs in the renderer avoids relying on installed OS fonts.
const OTHELLO_GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
};

let OTHELLO_CRC_TABLE = null;
function crc32(buf) {
  if (!OTHELLO_CRC_TABLE) {
    OTHELLO_CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      OTHELLO_CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ OTHELLO_CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcBuf);
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc >>> 0);
  return Buffer.concat([len, typeBuf, data, crcOut]);
}

function setPixel(buf, width, height, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function fillRect(buf, width, height, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      setPixel(buf, width, height, xx, yy, color[0], color[1], color[2], color[3]);
    }
  }
}

function drawCircle(buf, width, height, cx, cy, r, color) {
  if (!Number.isFinite(r) || r < 0) return;
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        setPixel(
          buf,
          width,
          height,
          cx + dx,
          cy + dy,
          color[0],
          color[1],
          color[2],
          color[3],
        );
      }
    }
  }
}

function drawGlyph(buf, width, height, cx, cy, glyph, color, scale = 2) {
  const pattern = OTHELLO_GLYPHS[glyph];
  if (!pattern) return;
  const glyphWidth = pattern[0].length * scale;
  const glyphHeight = pattern.length * scale;
  const startX = Math.round(cx - glyphWidth / 2);
  const startY = Math.round(cy - glyphHeight / 2);
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (pattern[r][c] === '1') {
        fillRect(
          buf,
          width,
          height,
          startX + c * scale,
          startY + r * scale,
          scale,
          scale,
          color,
        );
      }
    }
  }
}

function drawGlyphWithShadow(buf, width, height, cx, cy, glyph, color, shadow) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx !== 0 || dy !== 0) {
        drawGlyph(buf, width, height, cx + dx, cy + dy, glyph, shadow);
      }
    }
  }
  drawGlyph(buf, width, height, cx, cy, glyph, color);
}

function encodePng(width, height, rgba) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = deflateSync(raw);
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat([header, ...chunks]);
}

function isValidCoordinate(move, size) {
  return Boolean(
    move
    && Number.isInteger(move.r)
    && Number.isInteger(move.c)
    && move.r >= 0
    && move.r < size
    && move.c >= 0
    && move.c < size,
  );
}

function collectLegalMoveKeys(board, legalMoves, size) {
  if (!Array.isArray(legalMoves)) return new Set();
  const keys = new Set();
  for (const move of legalMoves) {
    if (!isValidCoordinate(move, size)) continue;
    if (board?.[move.r]?.[move.c] !== OTHELLO_EMPTY) continue;
    keys.add(move.r + ',' + move.c);
  }
  return keys;
}

function getLastMove(options, size) {
  return isValidCoordinate(options.lastMove, size) ? options.lastMove : null;
}

function lastMoveRingColor(color) {
  if (color === OTHELLO_PLAYER || color === 'black' || color === 'player') {
    return [255, 193, 7, 255];
  }
  if (color === OTHELLO_AI || color === 'white' || color === 'ai') {
    return [0, 188, 212, 255];
  }
  return [233, 30, 99, 255];
}

export function renderOthelloPng(board, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const size = OTHELLO_SIZE;
  const cell = OTHELLO_RENDER.cell;
  const pad = OTHELLO_RENDER.pad;
  const axis = OTHELLO_RENDER.axis;
  const line = OTHELLO_RENDER.line;
  const boardPixels = cell * size;
  const outerPad = pad + axis;
  const width = outerPad * 2 + boardPixels;
  const height = outerPad * 2 + boardPixels;
  const bg = [46, 125, 50, 255];
  const grid = [27, 94, 32, 255];
  const black = [17, 17, 17, 255];
  const white = [245, 245, 245, 255];
  const whiteStroke = [187, 187, 187, 255];
  const axisText = [235, 248, 237, 255];
  const axisShadow = [12, 53, 21, 255];
  const legalOuter = [10, 63, 29, 255];
  const legalInner = [255, 214, 64, 255];
  const lastOuter = [8, 28, 18, 255];
  const img = Buffer.alloc(width * height * 4);
  fillRect(img, width, height, 0, 0, width, height, bg);

  const x0 = outerPad;
  const y0 = outerPad;
  for (let i = 0; i <= size; i++) {
    // Keep both outer margins equal by drawing the final border inside the
    // board rectangle instead of extending past its calculated width.
    const x = x0 + i * cell - (i === size ? line : 0);
    const y = y0 + i * cell - (i === size ? line : 0);
    fillRect(img, width, height, x, y0, line, boardPixels, grid);
    fillRect(img, width, height, x0, y, boardPixels, line, grid);
  }

  for (let c = 0; c < size; c++) {
    const cx = x0 + c * cell + Math.floor(cell / 2);
    drawGlyphWithShadow(
      img,
      width,
      height,
      cx,
      y0 - Math.floor(axis / 2),
      String.fromCharCode(65 + c),
      axisText,
      axisShadow,
    );
    drawGlyphWithShadow(
      img,
      width,
      height,
      cx,
      y0 + boardPixels + Math.floor(axis / 2),
      String.fromCharCode(65 + c),
      axisText,
      axisShadow,
    );
  }
  for (let r = 0; r < size; r++) {
    const cy = y0 + r * cell + Math.floor(cell / 2);
    const label = String(r + 1);
    drawGlyphWithShadow(
      img,
      width,
      height,
      x0 - Math.floor(axis / 2),
      cy,
      label,
      axisText,
      axisShadow,
    );
    drawGlyphWithShadow(
      img,
      width,
      height,
      x0 + boardPixels + Math.floor(axis / 2),
      cy,
      label,
      axisText,
      axisShadow,
    );
  }

  const legalMoveKeys = collectLegalMoveKeys(board, opts.legalMoves, size);
  const lastMove = getLastMove(opts, size);
  const lastMoveKey = lastMove ? lastMove.r + ',' + lastMove.c : null;
  if (lastMove) {
    const cx = x0 + lastMove.c * cell + Math.floor(cell / 2);
    const cy = y0 + lastMove.r * cell + Math.floor(cell / 2);
    // The inner circle is intentionally drawn before the stone. The stone
    // then remains visible while the outer ring stays visible around it.
    drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.44), lastOuter);
    drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.38), lastMoveRingColor(lastMove.color));
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cx = x0 + c * cell + Math.floor(cell / 2);
      const cy = y0 + r * cell + Math.floor(cell / 2);
      const v = board?.[r]?.[c];
      if (v === OTHELLO_PLAYER) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), black);
      } else if (v === OTHELLO_AI) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), white);
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35) - 2, whiteStroke);
      }

      const key = r + ',' + c;
      if (legalMoveKeys.has(key) && key !== lastMoveKey) {
        drawCircle(img, width, height, cx, cy, 8, legalOuter);
        drawCircle(img, width, height, cx, cy, 5, legalInner);
      }
    }
  }

  return encodePng(width, height, img);
}
