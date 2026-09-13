import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { createReferenceStore, slugifyReferenceName } from '../src/image/references.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function image(data, mime, originalName) {
  return { data, mime, originalName };
}

async function withRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discord-reference-test-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('slugifyReferenceName is deterministic, safe, and nonempty for Japanese names', () => {
  assert.equal(slugifyReferenceName('Akaya 01'), 'akaya-01');
  assert.equal(slugifyReferenceName('赤 夜'), '赤-夜');
  assert.equal(slugifyReferenceName('赤 夜'), slugifyReferenceName('赤 夜'));
  assert.match(slugifyReferenceName('...'), /^ref-[a-f0-9]{12}$/);
  assert.doesNotMatch(slugifyReferenceName('../outside'), /[\\/]/);
});

test('reference store supports add/list/show/load after a fresh store instance', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const created = await store.add('赤 夜', [image(PNG, 'image/png', 'cat.png')]);
    assert.equal(created.displayName, '赤 夜');
    assert.equal(created.images.length, 1);
    assert.equal(created.images[0].size, PNG.length);
    assert.match(created.images[0].sha256, /^[a-f0-9]{64}$/);

    assert.deepEqual((await store.list()).map(item => item.slug), [created.slug]);
    assert.equal((await store.show(created.slug)).displayName, '赤 夜');
    const loaded = await createReferenceStore({ rootDir: root }).loadImages('赤 夜');
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].data, PNG);
    assert.equal(loaded[0].mime, 'image/png');
    assert.equal(loaded[0].originalName, 'cat.png');

    const manifestText = await readFile(path.join(root, created.slug, 'manifest.json'), 'utf8');
    assert.equal(JSON.parse(manifestText).images.length, 1);
  });
});

test('reference store rejects multiple-image creates and replacements without changing saved data', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    for (const count of [0, 2, 8, 9]) {
      await assert.rejects(store.add('new', Array.from({ length: count }, () => image(PNG, 'image/png', 'a.png'))), /1枚/);
      assert.deepEqual(await store.list(), []);
    }
    await store.add('profile', [image(PNG, 'image/png', 'original.png')]);
    const beforeOverflow = await store.show('profile');
    const beforeFiles = await Promise.all(beforeOverflow.images.map(item =>
      readFile(path.join(root, beforeOverflow.slug, item.filename))));

    for (const count of [0, 2, 8, 9]) {
      await assert.rejects(store.add('profile', Array.from({ length: count }, () => image(PNG, 'image/png', 'new.png')), { replace: true }), /1枚/);
    }
    assert.deepEqual(await store.show('profile'), beforeOverflow);
    const afterFiles = await Promise.all(beforeOverflow.images.map(item =>
      readFile(path.join(root, beforeOverflow.slug, item.filename))));
    assert.deepEqual(afterFiles, beforeFiles);

    await assert.rejects(
      store.add('profile', [image(PNG, 'image/png', 'overflow-append.png')], { replace: false }),
      /登録済み.*replace: true/,
    );
    assert.deepEqual(await store.show('profile'), beforeOverflow);
  });
});

test('normalized/case variants cannot overwrite and exact slug aliases require explicit replacement', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const created = await store.add('Akaya', [image(PNG, 'image/png', 'one.png')]);
    await assert.rejects(
      store.add('AKAYA', [image(JPEG, 'image/jpeg', 'wrong.jpg')]),
      /collides|slug/i,
    );
    assert.deepEqual(await store.show('Akaya'), created);
    await assert.rejects(store.add('akaya', [image(JPEG, 'image/jpeg', 'two.jpg')]), /登録済み.*replace: true/);
    assert.deepEqual(await store.show('Akaya'), created);
    const replaced = await store.add('akaya', [image(JPEG, 'image/jpeg', 'two.jpg')], { replace: true });
    assert.equal(replaced.images.length, 1);
    assert.equal(replaced.displayName, 'Akaya');
    assert.equal((await store.loadImages('akaya'))[0].originalName, 'two.jpg');
  });
});

test('a failed profile swap preserves the old profile and interrupted backups recover on restart', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const created = await store.add('profile', [image(PNG, 'image/png', 'old.png')]);
    const originalRename = fs.rename;
    fs.rename = async (source, target) => {
      if (String(source).includes('.staging-') && String(target).endsWith(`${path.sep}profile`)) {
        throw new Error('injected profile swap failure');
      }
      return originalRename(source, target);
    };
    try {
      await assert.rejects(
        store.add('profile', [image(JPEG, 'image/jpeg', 'new.jpg')], { replace: true }),
        /injected profile swap failure/,
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.deepEqual(await store.show('profile'), created);
    assert.equal((await store.loadImages('profile'))[0].originalName, 'old.png');

    const backupDir = path.join(root, '.backup-interrupted');
    await fs.rename(path.join(root, 'profile'), backupDir);
    const restarted = createReferenceStore({ rootDir: root });
    assert.deepEqual(await restarted.show('profile'), created);
    assert.equal((await restarted.loadImages('profile'))[0].originalName, 'old.png');
  });
});

test('stored image hash corruption is rejected when loading', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const created = await store.add('profile', [image(PNG, 'image/png', 'one.png')]);
    await writeFile(path.join(root, created.slug, created.images[0].filename), Buffer.concat([PNG, Buffer.from([0]) ]));
    await assert.rejects(store.loadImages('profile'), /hash|size|signature/i);
  });
});

test('replace still removes old images after a successful replacement', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const old = await store.add('profile', [image(PNG, 'image/png', 'old.png')]);
    const replaced = await store.add('profile', [image(PNG, 'image/png', 'new.png')], { replace: true });
    assert.equal(replaced.images.length, 1);
    await assert.rejects(readFile(path.join(root, old.slug, old.images[0].filename)));
    assert.equal((await store.loadImages('profile'))[0].originalName, 'new.png');

  });
});

test('reference store rejects profile slug collisions and traversal metadata', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    await store.add('My Cat', [image(PNG, 'image/png', 'a.png')]);
    await assert.rejects(store.add('My+Cat', [image(PNG, 'image/png', 'b.png')]), /collides|slug/i);
    await assert.rejects(store.show('../my-cat'), /not found/i);

    const manifestPath = path.join(root, 'my-cat', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.images[0].filename = '../outside.png';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(store.loadImages('My Cat'), /filename|manifest/i);
  });
});

test('reference store rejects profile symlink/junctions and deletes safely', async t => {
  await withRoot(async root => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'discord-reference-outside-'));
    try {
      const store = createReferenceStore({ rootDir: root });
      await store.add('safe', [image(PNG, 'image/png', 'safe.png')]);
      const deleted = await store.delete('safe');
      assert.equal(deleted.displayName, 'safe');
      await assert.rejects(store.show('safe'), /not found/i);

      try {
        await symlink(outside, path.join(root, 'unsafe'), 'junction');
      } catch (error) {
        if (error?.code === 'EPERM') {
          t.skip('symlink creation requires Windows developer mode or elevated privileges');
          return;
        }
        throw error;
      }
      await assert.rejects(store.list(), /symlink|junction/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('reference store serializes concurrent creates and replacements without growing a profile', async () => {
  await withRoot(async root => {
    const first = createReferenceStore({ rootDir: root });
    const second = createReferenceStore({ rootDir: root });
    const results = await Promise.allSettled([
      first.add('concurrent', [image(PNG, 'image/png', 'one.png')]),
      second.add('concurrent', [image(JPEG, 'image/jpeg', 'two.jpg')]),
    ]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.match(results[1].reason.message, /登録済み/);
    const manifest = await first.show('concurrent');
    assert.equal(manifest.images.length, 1);
    assert.deepEqual(
      (await first.loadImages('concurrent')).map(item => item.originalName),
      ['one.png'],
    );
    await Promise.all([
      first.add('concurrent', [image(PNG, 'image/png', 'replacement.png')], { replace: true }),
      second.add('concurrent', [image(JPEG, 'image/jpeg', 'last.jpg')], { replace: true }),
    ]);
    assert.deepEqual((await first.loadImages('concurrent')).map(item => item.originalName), ['last.jpg']);
  });
});

test('legacy eight-image profiles remain inspectable but cannot generate until replaced with one image', async () => {
  await withRoot(async root => {
    const store = createReferenceStore({ rootDir: root });
    const legacy = await store.add('legacy', [image(PNG, 'image/png', 'first.png')]);
    const profileDir = path.join(root, legacy.slug);
    for (let index = 2; index <= 8; index++) {
      const filename = `legacy-${index}.jpg`;
      await writeFile(path.join(profileDir, filename), JPEG);
      legacy.images.push({ id: `legacy-${index}`, filename, originalName: filename, mime: 'image/jpeg', size: JPEG.length, sha256: createHash('sha256').update(JPEG).digest('hex') });
    }
    const manifestPath = path.join(profileDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(legacy));
    assert.deepEqual(await store.show('legacy'), legacy);
    assert.equal((await store.list())[0].images.length, 8);
    await assert.rejects(store.loadImages('legacy'), /旧形式.*replace: true/);
    await assert.rejects(store.add('legacy', [image(PNG, 'image/png', 'append.png')]), /登録済み/);
    await assert.rejects(store.add('legacy', [image(PNG, 'image/png', 'a.png'), image(JPEG, 'image/jpeg', 'b.jpg')], { replace: true }), /1枚/);
    assert.deepEqual(await store.show('legacy'), legacy);
    for (const item of legacy.images) assert.equal((await readFile(path.join(profileDir, item.filename))).length, item.size);
    await store.add('legacy', [image(JPEG, 'image/jpeg', 'selected.jpg')], { replace: true });
    assert.deepEqual((await store.loadImages('legacy')).map(item => item.originalName), ['selected.jpg']);
    for (const item of legacy.images) await assert.rejects(readFile(path.join(profileDir, item.filename)), { code: 'ENOENT' });
  });
});
