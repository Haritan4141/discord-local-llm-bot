import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  assertReferenceImageCount,
  validateReferenceImage,
} from './reference-images.mjs';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ROOT_DIR = path.join(PROJECT_ROOT, 'data', 'references');
const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_VERSION = 1;
const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const PROFILE_TEMP_PREFIXES = ['.staging-', '.backup-', '.deleting-'];

// All stores in this process share a queue by canonical configured root. This
// prevents two independently-created store instances from losing appends.
const operationQueues = new Map();

function queueKey(rootDir) {
  const resolved = path.resolve(rootDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function serialize(rootDir, operation) {
  const key = queueKey(rootDir);
  const previous = operationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  operationQueues.set(key, current);
  current.finally(() => {
    if (operationQueues.get(key) === current) operationQueues.delete(key);
  }).catch(() => {});
  return current;
}

function stringName(value) {
  return String(value ?? '');
}

function requireDisplayName(value) {
  const displayName = stringName(value);
  if (!displayName.trim()) throw new Error('Reference profile name is required.');
  if (displayName.includes('\0')) throw new Error('Reference profile name contains an invalid character.');
  return displayName;
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Convert a user-facing name into a deterministic, path-safe profile slug.
 * Unicode letters and numbers are retained so Japanese names remain useful.
 */
export function slugifyReferenceName(value) {
  const original = stringName(value);
  let normalized;
  try {
    normalized = original.normalize('NFKC').trim().toLowerCase();
  } catch {
    normalized = original.trim().toLowerCase();
  }

  let slug = normalized
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!slug) slug = `ref-${shortHash(original).slice(0, 12)}`;
  if (WINDOWS_RESERVED_NAMES.test(slug)) slug = `ref-${slug}`;

  // Keep directory names comfortably below Windows path limits while retaining
  // a deterministic suffix when truncation is needed.
  const slugChars = Array.from(slug);
  if (slugChars.length > 96) {
    slug = `${slugChars.slice(0, 84).join('')}-${shortHash(normalized).slice(0, 11)}`;
  }
  return slug;
}

function isSafeSlug(slug) {
  if (typeof slug !== 'string' || !slug || slug === '.' || slug === '..') return false;
  if (slug.length > 160 || slug.includes('\0') || /[\\/]/.test(slug)) return false;
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return false;
  return slugifyReferenceName(slug) === slug;
}

function isSafeFilename(filename) {
  if (typeof filename !== 'string' || !filename || filename === '.' || filename === '..') return false;
  if (filename.includes('\0') || /[\\/]/.test(filename)) return false;
  if (filename.length > 255 || filename.startsWith('.')) return false;
  return true;
}

function isInside(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(root, target);
  if (!relative) return allowRoot;
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function ensureLexicallyContained(root, target, label) {
  if (!path.isAbsolute(target) || !isInside(root, target)) {
    throw new Error(`${label} resolves outside the reference storage root.`);
  }
}

async function lstatIfExists(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureRoot(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  await fs.mkdir(absoluteRoot, { recursive: true });
  const rootStat = await fs.lstat(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Reference storage root must be a real directory.');
  }
  const realRoot = await fs.realpath(absoluteRoot);
  if (!path.isAbsolute(realRoot)) throw new Error('Reference storage root is invalid.');
  const rootInfo = { absoluteRoot, realRoot };
  await recoverBackupDirectories(rootInfo);
  return rootInfo;
}

async function ensureExistingPathContained(rootInfo, target, label, { directory = false } = {}) {
  ensureLexicallyContained(rootInfo.absoluteRoot, target, label);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`${label} may not be a symlink or junction.`);
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`${label} has an unexpected filesystem type.`);
  }
  const realTarget = await fs.realpath(target);
  if (!isInside(rootInfo.realRoot, realTarget)) {
    throw new Error(`${label} resolves outside the reference storage root.`);
  }
  return stat;
}

async function ensureProfileDirectory(rootInfo, slug, { mustExist = true } = {}) {
  if (!isSafeSlug(slug)) throw new Error(`Reference profile slug is unsafe: ${slug}`);
  const profileDir = path.resolve(rootInfo.absoluteRoot, slug);
  ensureLexicallyContained(rootInfo.absoluteRoot, profileDir, 'Reference profile directory');
  const stat = await lstatIfExists(profileDir);
  if (!stat) {
    if (mustExist) throw new Error(`Reference profile not found: ${slug}`);
    return profileDir;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Reference profile directory may not be a symlink or junction.');
  }
  const realProfile = await fs.realpath(profileDir);
  if (!isInside(rootInfo.realRoot, realProfile)) {
    throw new Error('Reference profile directory resolves outside the reference storage root.');
  }
  return profileDir;
}

async function ensureNoSymlinks(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`Reference profile contains a symlink or junction: ${target}`);
  if (!stat.isDirectory()) return;
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    const childStat = await fs.lstat(child);
    if (childStat.isSymbolicLink()) throw new Error(`Reference profile contains a symlink or junction: ${child}`);
    if (childStat.isDirectory()) await ensureNoSymlinks(child);
  }
}

function parseManifestText(text, expectedSlug, sourcePath) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`Reference manifest is not valid JSON: ${sourcePath}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Reference manifest has an invalid shape: ${sourcePath}`);
  }
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`Reference manifest version is unsupported: ${sourcePath}`);
  }
  if (!isSafeSlug(manifest.slug) || manifest.slug !== expectedSlug) {
    throw new Error(`Reference manifest slug is unsafe or mismatched: ${sourcePath}`);
  }
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim() || manifest.displayName.includes('\0')) {
    throw new Error(`Reference manifest displayName is invalid: ${sourcePath}`);
  }
  for (const field of ['createdAt', 'updatedAt']) {
    if (typeof manifest[field] !== 'string' || !Number.isFinite(Date.parse(manifest[field]))) {
      throw new Error(`Reference manifest ${field} is invalid: ${sourcePath}`);
    }
  }
  if (!Array.isArray(manifest.images)) throw new Error(`Reference manifest images is invalid: ${sourcePath}`);
  assertReferenceImageCount(manifest.images.length);

  const seenIds = new Set();
  const seenFilenames = new Set();
  const images = manifest.images.map(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error(`Reference manifest contains an invalid image entry: ${sourcePath}`);
    }
    const id = String(image.id || '');
    const filename = String(image.filename || '');
    const originalName = String(image.originalName || '');
    const mime = String(image.mime || '').toLowerCase().split(';', 1)[0].trim();
    const size = Number(image.size);
    const sha256 = String(image.sha256 || '').toLowerCase();
    if (!id || id.length > 160 || id.includes('\0') || /[\\/]/.test(id) || seenIds.has(id)) {
      throw new Error(`Reference manifest image id is invalid: ${sourcePath}`);
    }
    if (!isSafeFilename(filename) || seenFilenames.has(filename)) {
      throw new Error(`Reference manifest image filename is invalid: ${sourcePath}`);
    }
    if (!originalName || originalName.includes('\0') || originalName.length > 1024) {
      throw new Error(`Reference manifest image originalName is invalid: ${sourcePath}`);
    }
    if (!SUPPORTED_MIMES.has(mime)) throw new Error(`Reference manifest image MIME is invalid: ${sourcePath}`);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error(`Reference manifest image size is invalid: ${sourcePath}`);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Reference manifest image hash is invalid: ${sourcePath}`);
    seenIds.add(id);
    seenFilenames.add(filename);
    return { id, filename, originalName, mime, size, sha256 };
  });

  return {
    version: MANIFEST_VERSION,
    slug: manifest.slug,
    displayName: manifest.displayName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    images,
  };
}

async function readManifest(rootInfo, slug) {
  const profileDir = await ensureProfileDirectory(rootInfo, slug);
  await ensureNoSymlinks(profileDir);
  const manifestPath = path.join(profileDir, MANIFEST_FILENAME);
  await ensureExistingPathContained(rootInfo, manifestPath, 'Reference manifest');
  const text = await fs.readFile(manifestPath, 'utf8');
  const manifest = parseManifestText(text, slug, manifestPath);
  return { profileDir, manifest, manifestPath };
}

/**
 * A directory swap has a short window between moving the old profile aside
 * and moving the staged profile into place. If the process is interrupted in
 * that window, restore the old profile before serving the next operation.
 */
async function recoverBackupDirectories(rootInfo) {
  const entries = await fs.readdir(rootInfo.absoluteRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith('.backup-')) continue;
    const backupDir = path.join(rootInfo.absoluteRoot, entry.name);
    const backupStat = await lstatIfExists(backupDir);
    if (!backupStat) continue;
    if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) {
      throw new Error(`Reference backup is not a real directory: ${entry.name}`);
    }
    ensureLexicallyContained(rootInfo.absoluteRoot, backupDir, 'Reference backup directory');
    const realBackup = await fs.realpath(backupDir);
    if (!isInside(rootInfo.realRoot, realBackup)) {
      throw new Error('Reference backup resolves outside the reference storage root.');
    }
    await ensureNoSymlinks(backupDir);
    const manifestPath = path.join(backupDir, MANIFEST_FILENAME);
    await ensureExistingPathContained(rootInfo, manifestPath, 'Reference backup manifest');
    const text = await fs.readFile(manifestPath, 'utf8');
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Reference backup manifest is not valid JSON: ${manifestPath}`);
    }
    const slug = raw?.slug;
    if (!isSafeSlug(slug)) throw new Error(`Reference backup manifest slug is unsafe: ${manifestPath}`);
    const manifest = parseManifestText(text, slug, manifestPath);
    const targetDir = await ensureProfileDirectory(rootInfo, manifest.slug, { mustExist: false });
    const targetStat = await lstatIfExists(targetDir);
    if (targetStat) {
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error(`Reference profile directory is unsafe during backup recovery: ${manifest.slug}`);
      }
      await ensureNoSymlinks(targetDir);
      await fs.rm(backupDir, { recursive: true, force: true });
      continue;
    }
    await fs.rename(backupDir, targetDir);
  }
}

function isTemporaryDirectory(name) {
  return PROFILE_TEMP_PREFIXES.some(prefix => name.startsWith(prefix));
}

async function readAllManifests(rootInfo) {
  const entries = await fs.readdir(rootInfo.absoluteRoot, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    const entryPath = path.join(rootInfo.absoluteRoot, entry.name);
    const entryStat = await fs.lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Reference storage contains a symlink or junction: ${entry.name}`);
    }
    if (!entry.isDirectory() || isTemporaryDirectory(entry.name)) continue;
    if (!isSafeSlug(entry.name)) {
      // Unrelated directories are ignored, but a directory that advertises a
      // manifest is part of this store and must pass strict validation.
      const possibleManifest = path.join(rootInfo.absoluteRoot, entry.name, MANIFEST_FILENAME);
      if (await lstatIfExists(possibleManifest)) {
        throw new Error(`Reference profile directory name is unsafe: ${entry.name}`);
      }
      continue;
    }
    const possibleManifest = path.join(rootInfo.absoluteRoot, entry.name, MANIFEST_FILENAME);
    if (!(await lstatIfExists(possibleManifest))) continue;
    records.push(await readManifest(rootInfo, entry.name));
  }
  records.sort((a, b) => a.manifest.slug.localeCompare(b.manifest.slug));
  return records;
}

function cloneManifest(manifest) {
  return {
    version: manifest.version,
    slug: manifest.slug,
    displayName: manifest.displayName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    images: manifest.images.map(image => ({ ...image })),
  };
}

async function resolveExisting(rootInfo, name) {
  const requested = stringName(name);
  const records = await readAllManifests(rootInfo);
  const matches = records.filter(record => (
    record.manifest.displayName === requested || record.manifest.slug === requested
  ));
  if (matches.length > 1) throw new Error(`Reference profile name is ambiguous: ${requested}`);
  return matches[0] || null;
}

async function readStoredImages(rootInfo, record) {
  const output = [];
  for (const metadata of record.manifest.images) {
    const imagePath = path.resolve(record.profileDir, metadata.filename);
    ensureLexicallyContained(rootInfo.absoluteRoot, imagePath, 'Reference image file');
    ensureLexicallyContained(record.profileDir, imagePath, 'Reference image file');
    const stat = await ensureExistingPathContained(rootInfo, imagePath, 'Reference image file');
    if (stat.size !== metadata.size) {
      throw new Error(`Reference image size does not match its manifest: ${metadata.filename}`);
    }
    const data = await fs.readFile(imagePath);
    if (data.length !== metadata.size) {
      throw new Error(`Reference image size does not match its manifest: ${metadata.filename}`);
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== metadata.sha256) {
      throw new Error(`Reference image hash does not match its manifest: ${metadata.filename}`);
    }
    const validated = validateReferenceImage({
      data,
      mime: metadata.mime,
      originalName: metadata.originalName,
      filename: metadata.filename,
    });
    output.push({ metadata, image: validated });
  }
  return output;
}

function randomSafeName(prefix) {
  return `${prefix}${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function writeManifestStage(rootInfo, slug, manifest, imageEntries) {
  const stageDir = path.join(rootInfo.absoluteRoot, randomSafeName('.staging-'));
  ensureLexicallyContained(rootInfo.absoluteRoot, stageDir, 'Reference staging directory');
  await fs.mkdir(stageDir);
  try {
    const filenames = new Set();
    const manifestImages = [];
    for (const entry of imageEntries) {
      const validated = validateReferenceImage(entry.image);
      const id = entry.metadata?.id || randomUUID();
      const extension = MIME_EXTENSIONS[validated.mime];
      const requestedFilename = validated.filename;
      let filename = requestedFilename && isSafeFilename(requestedFilename)
        ? requestedFilename
        : `${id}.${extension}`;
      if (!filename.toLowerCase().endsWith(`.${extension}`) || filenames.has(filename)) {
        filename = `${id}.${extension}`;
      }
      if (!isSafeFilename(filename) || filenames.has(filename)) {
        throw new Error('Reference image storage filename could not be made safe and unique.');
      }
      filenames.add(filename);
      const imagePath = path.resolve(stageDir, filename);
      ensureLexicallyContained(rootInfo.absoluteRoot, imagePath, 'Reference image file');
      ensureLexicallyContained(stageDir, imagePath, 'Reference image file');
      await fs.writeFile(imagePath, validated.data, { flag: 'wx' });
      manifestImages.push({
        id,
        filename,
        originalName: validated.originalName,
        mime: validated.mime,
        size: validated.data.length,
        sha256: createHash('sha256').update(validated.data).digest('hex'),
      });
    }

    const finalManifest = {
      version: MANIFEST_VERSION,
      slug,
      displayName: manifest.displayName,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      images: manifestImages,
    };
    const manifestPath = path.join(stageDir, MANIFEST_FILENAME);
    await fs.writeFile(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return { stageDir, manifest: parseManifestText(JSON.stringify(finalManifest), slug, manifestPath) };
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function commitStage(rootInfo, slug, stageDir) {
  const targetDir = await ensureProfileDirectory(rootInfo, slug, { mustExist: false });
  const targetStat = await lstatIfExists(targetDir);
  if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
    throw new Error('Reference profile directory may not be replaced because it is not a real directory.');
  }
  if (targetStat) {
    await ensureNoSymlinks(targetDir);
    const realTarget = await fs.realpath(targetDir);
    if (!isInside(rootInfo.realRoot, realTarget)) {
      throw new Error('Reference profile directory resolves outside the reference storage root.');
    }
  }

  let backupDir = null;
  if (targetStat) {
    backupDir = path.join(rootInfo.absoluteRoot, randomSafeName('.backup-'));
    ensureLexicallyContained(rootInfo.absoluteRoot, backupDir, 'Reference backup directory');
    await fs.rename(targetDir, backupDir);
  }
  try {
    await fs.rename(stageDir, targetDir);
  } catch (error) {
    if (backupDir) {
      await fs.rename(backupDir, targetDir).catch(() => {});
    }
    throw error;
  }
  // A successful swap is already committed. Cleanup is best effort so a
  // transient removal failure cannot be reported as a failed replacement.
  if (backupDir) await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

function validateIncomingImages(images) {
  if (!Array.isArray(images) || images.length < 1) {
    throw new Error('At least one reference image is required.');
  }
  return images.map(image => validateReferenceImage(image));
}

function defaultRootDir() {
  return DEFAULT_ROOT_DIR;
}

/**
 * Create a persistent, per-process serialized reference profile store.
 */
export function createReferenceStore({ rootDir = defaultRootDir() } = {}) {
  const configuredRoot = path.resolve(String(rootDir));

  return {
    async add(name, images, { replace = false } = {}) {
      return serialize(configuredRoot, async () => {
        const displayName = requireDisplayName(name);
        const rootInfo = await ensureRoot(configuredRoot);
        const slug = slugifyReferenceName(displayName);
        const existing = await resolveExisting(rootInfo, displayName);

        if (!existing) {
          const collision = (await readAllManifests(rootInfo)).find(record => record.manifest.slug === slug);
          if (collision) {
            throw new Error(
              `Reference profile name collides with existing slug "${slug}"; use the existing display name or another name.`,
            );
          }
        }

        const incoming = validateIncomingImages(images);
        const priorImages = existing && !replace ? await readStoredImages(rootInfo, existing) : [];
        assertReferenceImageCount(priorImages.length + incoming.length);
        const imageEntries = [
          ...priorImages.map(entry => ({
            metadata: entry.metadata,
            image: entry.image,
          })),
          ...incoming.map(image => ({ image })),
        ];
        const now = new Date().toISOString();
        const staged = await writeManifestStage(rootInfo, existing?.manifest.slug || slug, {
          displayName: existing?.manifest.displayName || displayName,
          createdAt: existing?.manifest.createdAt || now,
          updatedAt: now,
        }, imageEntries);
        try {
          await commitStage(rootInfo, existing?.manifest.slug || slug, staged.stageDir);
        } catch (error) {
          await fs.rm(staged.stageDir, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
        return cloneManifest(staged.manifest);
      });
    },

    async list() {
      return serialize(configuredRoot, async () => {
        const rootInfo = await ensureRoot(configuredRoot);
        const records = await readAllManifests(rootInfo);
        return records.map(record => cloneManifest(record.manifest));
      });
    },

    async show(name) {
      return serialize(configuredRoot, async () => {
        const rootInfo = await ensureRoot(configuredRoot);
        const record = await resolveExisting(rootInfo, name);
        if (!record) throw new Error(`Reference profile not found: ${stringName(name)}`);
        return cloneManifest(record.manifest);
      });
    },

    async loadImages(name) {
      return serialize(configuredRoot, async () => {
        const rootInfo = await ensureRoot(configuredRoot);
        const record = await resolveExisting(rootInfo, name);
        if (!record) throw new Error(`Reference profile not found: ${stringName(name)}`);
        const stored = await readStoredImages(rootInfo, record);
        return stored.map(entry => entry.image);
      });
    },

    async delete(name) {
      return serialize(configuredRoot, async () => {
        const rootInfo = await ensureRoot(configuredRoot);
        const record = await resolveExisting(rootInfo, name);
        if (!record) throw new Error(`Reference profile not found: ${stringName(name)}`);
        const targetDir = await ensureProfileDirectory(rootInfo, record.manifest.slug);
        await ensureNoSymlinks(targetDir);
        await ensureExistingPathContained(rootInfo, targetDir, 'Reference profile directory', { directory: true });

        const deletingDir = path.join(rootInfo.absoluteRoot, randomSafeName('.deleting-'));
        ensureLexicallyContained(rootInfo.absoluteRoot, deletingDir, 'Reference deletion directory');
        await fs.rename(targetDir, deletingDir);
        try {
          await fs.rm(deletingDir, { recursive: true, force: false });
        } catch (error) {
          await fs.rename(deletingDir, targetDir).catch(() => {});
          throw error;
        }
        return cloneManifest(record.manifest);
      });
    },
  };
}

export { MAX_REFERENCE_IMAGES };
