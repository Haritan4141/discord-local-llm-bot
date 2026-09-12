import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  createOthelloBoard,
  getLegalMoves,
} from '../src/othello/board.mjs';
import { OTHELLO_RENDER, renderOthelloPng } from '../src/othello/render.mjs';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let value = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crc = (crc >>> 8) ^ value;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePng(png) {
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);

  let offset = PNG_SIGNATURE.length;
  const chunks = [];
  const idat = [];
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'truncated PNG chunk');
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    assert.ok(crcOffset + 4 <= png.length, 'truncated ' + type + ' chunk');
    const data = png.subarray(dataStart, dataEnd);
    const storedCrc = png.readUInt32BE(crcOffset);
    const calculatedCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    assert.equal(storedCrc, calculatedCrc, type + ' CRC must be valid');
    chunks.push({ type, data });
    if (type === 'IDAT') idat.push(data);
    offset = crcOffset + 4;
  }

  assert.equal(offset, png.length);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR')?.data;
  assert.ok(ihdr && ihdr.length === 13, 'PNG must have a valid IHDR');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  assert.equal(ihdr[8], 8, 'renderer uses 8-bit channels');
  assert.equal(ihdr[9], 6, 'renderer uses RGBA PNG');
  assert.equal(ihdr[10], 0);
  assert.equal(ihdr[11], 0);
  assert.equal(ihdr[12], 0);

  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 4;
  assert.equal(raw.length, (rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (rowBytes + 1)], 0, 'renderer uses no PNG row filter');
  }

  return {
    width,
    height,
    chunks,
    pixel(x, y) {
      assert.ok(Number.isInteger(x) && Number.isInteger(y));
      assert.ok(x >= 0 && x < width && y >= 0 && y < height);
      const start = y * (rowBytes + 1) + 1 + x * 4;
      return Array.from(raw.subarray(start, start + 4));
    },
  };
}

function countColor(decoded, color, x0, y0, x1, y1) {
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (decoded.pixel(x, y).every((value, index) => value === color[index])) {
        count += 1;
      }
    }
  }
  return count;
}

function center(r, c) {
  return {
    x: OTHELLO_RENDER.pad
      + OTHELLO_RENDER.axis
      + c * OTHELLO_RENDER.cell
      + Math.floor(OTHELLO_RENDER.cell / 2),
    y: OTHELLO_RENDER.pad
      + OTHELLO_RENDER.axis
      + r * OTHELLO_RENDER.cell
      + Math.floor(OTHELLO_RENDER.cell / 2),
  };
}

test('renderOthelloPng emits a valid RGBA PNG with readable axes', () => {
  const decoded = decodePng(renderOthelloPng(createOthelloBoard()));
  const outerPad = OTHELLO_RENDER.pad + OTHELLO_RENDER.axis;
  const expectedSize = outerPad * 2 + OTHELLO_RENDER.cell * OTHELLO_RENDER.size;

  assert.equal(decoded.width, expectedSize);
  assert.equal(decoded.height, expectedSize);
  assert.deepEqual(decoded.chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND']);

  const axisText = [235, 248, 237, 255];
  assert.ok(countColor(decoded, axisText, 0, 0, decoded.width, outerPad) > 0);
  assert.ok(countColor(decoded, axisText, 0, outerPad + OTHELLO_RENDER.cell * OTHELLO_RENDER.size, decoded.width, decoded.height) > 0);
  assert.ok(countColor(decoded, axisText, 0, outerPad, outerPad, decoded.height) > 0);
  assert.ok(countColor(decoded, axisText, outerPad + OTHELLO_RENDER.cell * OTHELLO_RENDER.size, outerPad, decoded.width, decoded.height) > 0);
});

test('legal dots are limited to empty cells and last-move rings preserve the stone', () => {
  const board = createOthelloBoard();
  const legalMoves = getLegalMoves(board, OTHELLO_PLAYER);
  const image = decodePng(renderOthelloPng(board, {
    legalMoves: [
      ...legalMoves,
      { r: 3, c: 3 }, // occupied: must not receive a legal dot
      { r: -1, c: 0 },
      { r: 8, c: 0 },
      { r: 0, c: 8 },
      { r: 1.5, c: 1 },
    ],
    lastMove: { r: 2, c: 3, color: OTHELLO_PLAYER },
  }));

  const legalCenter = center(3, 2);
  assert.deepEqual(image.pixel(legalCenter.x, legalCenter.y), [255, 214, 64, 255]);

  const occupiedCenter = center(3, 3);
  assert.deepEqual(image.pixel(occupiedCenter.x, occupiedCenter.y), [187, 187, 187, 255]);

  const blackLastCenter = center(2, 3);
  assert.deepEqual(image.pixel(blackLastCenter.x, blackLastCenter.y - 18), [255, 193, 7, 255]);
  assert.deepEqual(image.pixel(blackLastCenter.x, blackLastCenter.y), [255, 193, 7, 255]);
});

test('AI last-move ring is visible on a white stone', () => {
  const image = decodePng(renderOthelloPng(createOthelloBoard(), {
    lastMove: { r: 3, c: 3, color: OTHELLO_AI },
  }));
  const last = center(3, 3);
  assert.deepEqual(image.pixel(last.x, last.y), [187, 187, 187, 255]);
  assert.deepEqual(image.pixel(last.x, last.y - 18), [0, 188, 212, 255]);
});

test('invalid options and coordinates are ignored safely', () => {
  const board = createOthelloBoard();
  const baseline = renderOthelloPng(board);
  const invalid = renderOthelloPng(board, {
    legalMoves: [
      null,
      {},
      { r: -1, c: 0 },
      { r: 0, c: 8 },
      { r: 8, c: 0 },
      { r: 0.25, c: 1 },
    ],
    lastMove: { r: 99, c: 99, color: OTHELLO_PLAYER },
  });

  assert.deepEqual(invalid, baseline);
  assert.doesNotThrow(() => renderOthelloPng(board, null));
  assert.doesNotThrow(() => renderOthelloPng(undefined, { legalMoves: [{ r: 0, c: 0 }] }));
});
