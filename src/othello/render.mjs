import { deflateSync } from 'node:zlib';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
} from './board.mjs';

export const OTHELLO_RENDER = { size: 8, cell: 48, pad: 8 };
export const OTHELLO_DIGITS = [
  ['111', '101', '101', '101', '111'],
  ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'],
  ['111', '001', '111', '001', '111'],
  ['101', '101', '111', '001', '001'],
  ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'],
  ['111', '001', '001', '001', '001'],
  ['111', '101', '111', '101', '111'],
  ['111', '101', '111', '001', '111'],
];

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

function setPixel(buf, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function fillRect(buf, width, height, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      setPixel(buf, width, xx, yy, color[0], color[1], color[2], color[3]);
    }
  }
}

function drawCircle(buf, width, height, cx, cy, r, color) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) {
          setPixel(buf, width, x, y, color[0], color[1], color[2], color[3]);
        }
      }
    }
  }
}

function drawDigit(buf, width, height, cx, cy, digit, color) {
  const pattern = OTHELLO_DIGITS[digit];
  if (!pattern) return;
  const scale = 4;
  const w = 3 * scale;
  const h = 5 * scale;
  const startX = Math.round(cx - w / 2);
  const startY = Math.round(cy - h / 2);
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (pattern[r][c] === '1') {
        fillRect(buf, width, height, startX + c * scale, startY + r * scale, scale, scale, color);
      }
    }
  }
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

export function renderOthelloPng(board, moveLabels = new Map()) {
  const size = OTHELLO_RENDER.size;
  const cell = OTHELLO_RENDER.cell;
  const pad = OTHELLO_RENDER.pad;
  const width = pad * 2 + cell * size;
  const height = pad * 2 + cell * size;
  const bg = [46, 125, 50, 255];
  const grid = [27, 94, 32, 255];
  const black = [17, 17, 17, 255];
  const white = [245, 245, 245, 255];
  const whiteStroke = [187, 187, 187, 255];
  const mark = [25, 118, 210, 255];
  const markText = [255, 255, 255, 255];
  const img = Buffer.alloc(width * height * 4);
  fillRect(img, width, height, 0, 0, width, height, bg);

  const boardSize = cell * size;
  const x0 = pad;
  const y0 = pad;
  const line = 2;
  for (let i = 0; i <= size; i++) {
    const y = y0 + i * cell;
    fillRect(img, width, height, x0, y, boardSize, line, grid);
    const x = x0 + i * cell;
    fillRect(img, width, height, x, y0, line, boardSize, grid);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cx = x0 + c * cell + Math.floor(cell / 2);
      const cy = y0 + r * cell + Math.floor(cell / 2);
      const v = board[r][c];
      if (v === OTHELLO_PLAYER) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), black);
      } else if (v === OTHELLO_AI) {
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35), white);
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.35) - 2, whiteStroke);
      }
      const key = `${r},${c}`;
      if (moveLabels.has(key)) {
        const label = String(moveLabels.get(key));
        drawCircle(img, width, height, cx, cy, Math.floor(cell * 0.28), mark);
        if (/^[0-9]$/.test(label)) {
          drawDigit(img, width, height, cx, cy, Number(label), markText);
        }
      }
    }
  }

  return encodePng(width, height, img);
}
