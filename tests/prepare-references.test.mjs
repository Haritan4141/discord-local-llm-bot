import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareReferenceImages, resolveReferenceMaxEdge } from '../src/image/prepare-references.mjs';

const create = (width, height) => sharp({ create: { width, height, channels: 4, background: '#4080c080' } });
const reference = (data, mime = 'image/png') => ({ data, mime, originalName: 'original' });

test('reference size defaults to 768 and accepts only bounded integer settings', () => {
  for (const value of [undefined, null, '', '  ']) assert.equal(resolveReferenceMaxEdge(value), 768);
  for (const value of [256, 512, 768, 1024, 2048]) assert.equal(resolveReferenceMaxEdge(String(value)), value);
  for (const value of [0, 255, 2049, -1, 'auto', 768.5, Infinity]) {
    assert.throws(() => resolveReferenceMaxEdge(value), /256〜2048/);
  }
});

test('PNG, JPEG and WebP preserve aspect ratio and order within the longest-edge cap', async () => {
  const sources = [
    reference(await create(3840, 2160).png().toBuffer()),
    reference(await create(1000, 2000).jpeg().toBuffer(), 'image/jpeg'),
    reference(await create(1500, 1500).webp().toBuffer(), 'image/webp'),
  ];
  const originalCopies = sources.map(source => Buffer.from(source.data));
  const prepared = await prepareReferenceImages(sources);
  assert.deepEqual(prepared.map(({ width, height }) => [width, height]), [[768, 432], [384, 768], [768, 768]]);
  for (const [index, output] of prepared.entries()) {
    const metadata = await sharp(output.data).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(output.mime, 'image/png');
    assert.equal(output.originalName, sources[index].originalName);
    assert.equal(metadata.width, output.width);
    assert.equal(metadata.height, output.height);
    assert.deepEqual(sources[index].data, originalCopies[index]);
    assert.notEqual(output.data, sources[index].data);
  }
});

test('small images are not enlarged, alpha is retained and EXIF orientation is applied', async () => {
  const small = await create(128, 64).png().toBuffer();
  const rotated = await create(1600, 800).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const [a, b] = await prepareReferenceImages([reference(small), reference(rotated, 'image/jpeg')]);
  assert.deepEqual([a.width, a.height, b.width, b.height], [128, 64, 384, 768]);
  const { data, info } = await sharp(a.data).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 128);
  assert.equal((await sharp(b.data).metadata()).orientation, undefined);
  const [lower] = await prepareReferenceImages([reference(rotated, 'image/jpeg')], { maxEdge: 512 });
  assert.deepEqual([lower.width, lower.height], [256, 512]);
});

test('corrupt data and inputs above 40 million pixels are rejected without a full-size fallback', async () => {
  const corrupt = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  await assert.rejects(prepareReferenceImages([reference(corrupt)]), /参照画像1を縮小できません/);
  const oversized = await create(6500, 6500).png().toBuffer();
  await assert.rejects(prepareReferenceImages([reference(oversized)]), error => {
    assert.match(error.message, /4,000万画素以下/);
    assert.match(error.cause.message, /pixel limit/);
    return true;
  });
});

test('animated WebP is rejected instead of silently selecting its first frame', async () => {
  const data = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), {
    raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
  }).webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await sharp(data).metadata()).pages, 2);
  await assert.rejects(prepareReferenceImages([reference(data, 'image/webp')]), /縮小できません/);
});

test('no references stay empty and requests over the existing eight-image cap fail', async () => {
  assert.deepEqual(await prepareReferenceImages([]), []);
  await assert.rejects(prepareReferenceImages(Array(9).fill({})), /最大8枚/);
});
