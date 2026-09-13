import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_MAX_KEYS = 64;
const DEFAULT_MAX_SAMPLES = 12;
const MAX_KEYS = 256;
const MAX_SAMPLES = 64;
const MAX_STAGES_PER_RECORD = 64;
const MAX_KEY_LENGTH = 128;
const MAX_STAGE_LENGTH = 128;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_BYTES = 1024 * 1024;
const SCHEMA_VERSION = 1;
const MIN_ESTIMATE_SAMPLES = 3;

function isSafeInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isSafeText(value, maxLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isSafeDuration(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_DURATION_MS;
}

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }

  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  if (!isSafeInteger(maxKeys, 1, MAX_KEYS)) {
    throw new RangeError(`maxKeys must be an integer from 1 to ${MAX_KEYS}`);
  }
  if (!isSafeInteger(maxSamples, 1, MAX_SAMPLES)) {
    throw new RangeError(`maxSamples must be an integer from 1 to ${MAX_SAMPLES}`);
  }

  let persistencePath = null;
  if (options.path !== null && options.path !== undefined && options.path !== '') {
    if (typeof options.path !== 'string' || options.path.length > 4096) {
      // Persistence is optional. A malformed path must not make a music request fail.
      persistencePath = null;
    } else {
      persistencePath = resolve(options.path);
    }
  }

  return { maxKeys, maxSamples, persistencePath };
}

function parsePersistedData(text, { maxKeys, maxSamples }) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PERSISTED_BYTES) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.version !== SCHEMA_VERSION
    || !parsed.samples || typeof parsed.samples !== 'object'
    || Array.isArray(parsed.samples)) {
    return [];
  }

  const restored = [];
  for (const key of Object.keys(parsed.samples)) {
    if (restored.length >= maxKeys) break;
    if (!isSafeText(key, MAX_KEY_LENGTH)) continue;
    const stagesValue = parsed.samples[key];
    if (!stagesValue || typeof stagesValue !== 'object' || Array.isArray(stagesValue)) continue;

    const stages = new Map();
    for (const stage of Object.keys(stagesValue)) {
      if (stages.size >= MAX_STAGES_PER_RECORD || !isSafeText(stage, MAX_STAGE_LENGTH)) continue;
      const values = stagesValue[stage];
      if (!Array.isArray(values)) continue;
      const validValues = values
        .filter(isSafeDuration)
        .slice(-maxSamples);
      if (validValues.length > 0) stages.set(stage, validValues);
    }
    if (stages.size > 0) restored.push([key, stages]);
  }
  return restored;
}

function serializeData(samples) {
  const persisted = Object.create(null);
  for (const [key, stages] of samples) {
    const persistedStages = Object.create(null);
    for (const [stage, values] of stages) {
      persistedStages[stage] = values.slice();
    }
    persisted[key] = persistedStages;
  }
  return JSON.stringify({ version: SCHEMA_VERSION, samples: persisted });
}

async function writeAtomically(filePath, text) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.mkdir(dirname(filePath), { recursive: true });
    if (Buffer.byteLength(text, 'utf8') > MAX_PERSISTED_BYTES) return;
    await fs.writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch {
    try {
      await fs.unlink(temporaryPath);
    } catch {
      // Persistence is best effort and must never affect a generation.
    }
  }
}

function loadPersistedData(filePath, options) {
  if (!filePath) return [];
  let fileDescriptor;
  try {
    fileDescriptor = openSync(filePath, 'r');
    // Read only one byte beyond the accepted limit. This avoids loading an
    // arbitrarily large or attacker-controlled file during startup.
    const buffer = Buffer.allocUnsafe(MAX_PERSISTED_BYTES + 1);
    const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PERSISTED_BYTES) return [];
    return parsePersistedData(buffer.subarray(0, bytesRead).toString('utf8'), options);
  } catch {
    return [];
  } finally {
    if (fileDescriptor !== undefined) {
      try { closeSync(fileDescriptor); } catch { /* fail-soft persistence */ }
    }
  }
}

function copySamples(samples) {
  return new Map(Array.from(samples, ([key, stages]) => [
    key,
    new Map(Array.from(stages, ([stage, values]) => [stage, values.slice()])),
  ]));
}

/**
 * Keep bounded, prompt-free timing observations for music stage ETA estimates.
 *
 * `remainingMs` is measured from the beginning of a stage to successful final
 * Discord delivery. The caller supplies an opaque, configuration-derived key;
 * this module intentionally stores no prompt, lyrics, Discord ID, or job ID.
 */
export function createMusicTimingHistory(options = {}) {
  const { maxKeys, maxSamples, persistencePath } = normalizeOptions(options);
  const samples = new Map(loadPersistedData(persistencePath, { maxKeys, maxSamples }));
  let writeChain = Promise.resolve();

  function estimateStatus(key, stage, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return { status: 'unavailable' };
    const { elapsedMs = 0 } = options;
    if (!isSafeText(key, MAX_KEY_LENGTH) || !isSafeText(stage, MAX_STAGE_LENGTH)
      || !isSafeDuration(elapsedMs)) {
      return { status: 'unavailable' };
    }

    const values = samples.get(key)?.get(stage);
    const sampleCount = values?.length ?? 0;
    if (sampleCount < MIN_ESTIMATE_SAMPLES) {
      return { status: 'collecting', samples: sampleCount, requiredSamples: MIN_ESTIMATE_SAMPLES };
    }

    const observedMinimum = Math.min(...values);
    const observedMaximum = Math.max(...values);
    // A deliberately broad range avoids presenting a noisy sample as a promise.
    const lowerBound = observedMinimum * 0.7;
    const upperBound = observedMaximum * 1.3;
    if (!Number.isFinite(upperBound) || upperBound <= 0) return { status: 'unavailable' };
    if (elapsedMs >= upperBound) return { status: 'overrun', samples: sampleCount };

    const minMs = Math.max(0, Math.round(lowerBound - elapsedMs));
    const maxMs = Math.max(1, Math.round(upperBound - elapsedMs));
    return { status: 'ready', estimate: { minMs: Math.min(minMs, maxMs), maxMs, samples: sampleCount } };
  }

  function estimate(key, stage, options = {}) {
    return estimateStatus(key, stage, options).estimate ?? null;
  }

  function record(key, observations) {
    if (!isSafeText(key, MAX_KEY_LENGTH) || !Array.isArray(observations)
      || observations.length === 0 || observations.length > MAX_STAGES_PER_RECORD) {
      return false;
    }

    const validated = [];
    const seenStages = new Set();
    for (const observation of observations) {
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)
        || !isSafeText(observation.stage, MAX_STAGE_LENGTH)
        || !isSafeDuration(observation.remainingMs)
        || seenStages.has(observation.stage)) {
        return false;
      }
      seenStages.add(observation.stage);
      validated.push({ stage: observation.stage, remainingMs: observation.remainingMs });
    }

    const existing = samples.get(key) || new Map();
    for (const { stage, remainingMs } of validated) {
      const values = existing.get(stage) || [];
      values.push(remainingMs);
      existing.set(stage, values.slice(-maxSamples));
    }
    while (existing.size > MAX_STAGES_PER_RECORD) {
      existing.delete(existing.keys().next().value);
    }

    // Map insertion order is the bounded-key eviction order. Refreshing a key
    // makes it recent without changing any individual stage's sample order.
    samples.delete(key);
    samples.set(key, existing);
    while (samples.size > maxKeys) samples.delete(samples.keys().next().value);
    return true;
  }

  function flush() {
    if (!persistencePath) return Promise.resolve();

    let text;
    try {
      text = serializeData(copySamples(samples));
    } catch {
      return Promise.resolve();
    }

    // Every call gets a place in the same chain. Each snapshot is captured at
    // call time, so a later flush cannot be lost behind an earlier slow write.
    writeChain = writeChain
      .catch(() => undefined)
      .then(() => writeAtomically(persistencePath, text))
      .catch(() => undefined);
    return writeChain;
  }

  return { estimate, estimateStatus, record, flush };
}
