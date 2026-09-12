import { Buffer } from 'node:buffer';

/**
 * Reference images are intentionally kept small and bounded. Eight images is
 * this bot's cap for one saved profile or one combined /draw request.
 */
export const MAX_REFERENCE_IMAGES = 8;
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DEFAULT_TIMEOUT_MS = 30_000;
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function normalizeMime(value) {
  const mime = String(value || '').toLowerCase().split(';', 1)[0].trim();
  return SUPPORTED_MIMES.has(mime) ? mime : null;
}

function mimeFromFilename(name) {
  const value = String(name || '').split(/[?#]/, 1)[0].toLowerCase();
  if (/\.png$/.test(value)) return 'image/png';
  if (/\.jpe?g$/.test(value)) return 'image/jpeg';
  if (/\.webp$/.test(value)) return 'image/webp';
  return null;
}

function sniffMime(data) {
  if (data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 12
    && data.toString('ascii', 0, 4) === 'RIFF'
    && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function cleanOriginalName(value, mime) {
  const fallback = `reference.${MIME_EXTENSIONS[mime] || 'bin'}`;
  const name = String(value ?? '').trim();
  return name || fallback;
}

function cleanOptionalFilename(value) {
  if (value == null) return null;
  const filename = String(value).trim();
  if (!filename) return null;
  // A caller may pass a storage filename.  Do not allow it to become a path.
  if (filename === '.' || filename === '..' || filename.includes('\0') || /[\\/]/.test(filename)) {
    throw new Error('Reference image filename must be a single safe filename.');
  }
  return filename;
}

/**
 * Validate an image binary and its declared type before it enters reference
 * storage or an external image API request.
 */
export function validateReferenceImage({ data, mime, originalName, filename } = {}) {
  if (!Buffer.isBuffer(data)) {
    throw new Error('Reference image data must be a Buffer.');
  }
  if (data.length < 1 || data.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(
      `Reference image must be between 1 byte and ${MAX_REFERENCE_IMAGE_BYTES} bytes.`,
    );
  }

  const declaredMime = normalizeMime(mime);
  if (!declaredMime) {
    throw new Error('Reference image MIME must be image/png, image/jpeg, or image/webp.');
  }

  const actualMime = sniffMime(data);
  if (!actualMime) {
    throw new Error('Reference image has an unsupported or invalid image signature.');
  }
  if (actualMime !== declaredMime) {
    throw new Error(`Reference image MIME ${declaredMime} does not match its binary signature.`);
  }

  const result = {
    data,
    mime: declaredMime,
    originalName: cleanOriginalName(originalName, declaredMime),
  };
  const safeFilename = cleanOptionalFilename(filename);
  if (safeFilename) result.filename = safeFilename;
  return result;
}

export function assertReferenceImageCount(count) {
  if (!Number.isInteger(count) || count < 0 || count > MAX_REFERENCE_IMAGES) {
    throw new Error(`参照画像はprofileと/drawの合計で最大${MAX_REFERENCE_IMAGES}枚まで指定できます。`);
  }
  return count;
}

function parseSize(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function attachmentUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('Reference image URL is invalid.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const validPort = parsed.port === '' || parsed.port === '443';
  const validPath = parsed.pathname.startsWith('/attachments/') && parsed.pathname.length > '/attachments/'.length;
  if (parsed.protocol !== 'https:'
    || !CDN_HOSTS.has(hostname)
    || !validPort
    || parsed.username
    || parsed.password
    || !validPath) {
    throw new Error('Reference image URL must be a Discord CDN HTTPS attachment URL.');
  }
  return parsed;
}

function responseHeader(response, name) {
  if (!response?.headers) return '';
  if (typeof response.headers.get === 'function') return String(response.headers.get(name) || '');
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (String(key).toLowerCase() === wanted) return String(value || '');
  }
  return '';
}

function abortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

async function readResponseBody(response, maxBytes, signal) {
  const chunks = [];
  let total = 0;

  const append = chunk => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Reference image is too large; maximum is ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  };

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const cancelReader = () => {
      // Cancellation is best effort; the original size/abort error is more
      // useful to the caller than a stream implementation's cancel error.
      Promise.resolve(reader.cancel?.()).catch(() => {});
    };
    signal?.addEventListener('abort', cancelReader, { once: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value != null) append(value);
      }
    } catch (error) {
      cancelReader();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelReader);
      reader.releaseLock?.();
    }
  } else if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) append(chunk);
  } else if (typeof response?.arrayBuffer === 'function') {
    // Some small test/mocked responses do not expose a stream.  The declared
    // content length is checked before this fallback, and the resulting body
    // is bounded immediately after it is materialized.
    append(Buffer.from(await response.arrayBuffer()));
  } else {
    throw new Error('Reference image response did not contain a readable body.');
  }

  return Buffer.concat(chunks, total);
}

function cancelResponseBody(response) {
  const body = response?.body;
  if (!body) return;
  try {
    if (typeof body.cancel === 'function') {
      Promise.resolve(body.cancel()).catch(() => {});
    } else if (typeof body.destroy === 'function') {
      body.destroy();
    } else if (typeof body.return === 'function') {
      Promise.resolve(body.return()).catch(() => {});
    }
  } catch {
    // Cancellation is best effort; keep the original validation/download
    // error for the caller.
  }
}

function timeoutValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.trunc(number);
}

/**
 * Fetch one Discord attachment with URL, redirect, size, timeout, MIME, and
 * image-signature checks.  The returned value is ready for reference storage
 * or multipart upload.
 */
export async function fetchReferenceImage(
  attachment,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_REFERENCE_IMAGE_BYTES } = {},
) {
  if (!attachment || typeof attachment !== 'object') {
    throw new Error('A Discord image attachment is required.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const requestedUrl = attachmentUrl(attachment.url);
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`Reference image maxBytes must be between 1 and ${MAX_REFERENCE_IMAGE_BYTES}.`);
  }

  const declaredSize = parseSize(attachment.size);
  if (declaredSize != null && declaredSize > limit) {
    throw new Error(`Reference image is too large; maximum is ${limit} bytes.`);
  }

  const timeout = timeoutValue(timeoutMs);
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  let response;
  const operation = (async () => {
    response = await fetchImpl(requestedUrl.href, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });

    if (response?.redirected === true) {
      throw new Error('Reference image redirects are not allowed.');
    }
    if (response?.url) {
      let responseUrl;
      try {
        responseUrl = new URL(response.url);
      } catch {
        throw new Error('Reference image response URL is invalid.');
      }
      if (responseUrl.href !== requestedUrl.href) {
        throw new Error('Reference image redirects are not allowed.');
      }
    }
    const status = Number(response?.status || 0);
    if (response?.ok === false || (status >= 400 && status > 0)) {
      throw new Error(`Reference image download failed: ${status || 'unknown'} ${response?.statusText || ''}`.trim());
    }

    const contentLength = parseSize(responseHeader(response, 'content-length'));
    if (contentLength != null && contentLength > limit) {
      throw new Error(`Reference image is too large; maximum is ${limit} bytes.`);
    }

    const attachmentMime = String(attachment.contentType || '').trim();
    const responseMime = String(responseHeader(response, 'content-type') || '').trim();
    const declaredMime = normalizeMime(attachmentMime);
    const headerMime = normalizeMime(responseMime);
    if (attachmentMime && !declaredMime) {
      throw new Error('Reference image MIME must be image/png, image/jpeg, or image/webp.');
    }
    if (responseMime && !headerMime) {
      throw new Error('Reference image response MIME must be image/png, image/jpeg, or image/webp.');
    }
    if (declaredMime && headerMime && declaredMime !== headerMime) {
      throw new Error('Reference image MIME metadata does not match the download response.');
    }

    const data = await readResponseBody(response, limit, controller.signal);
    const mime = declaredMime || headerMime || mimeFromFilename(attachment.name) || sniffMime(data);
    if (!mime) throw new Error('Reference image MIME could not be determined.');
    return validateReferenceImage({
      data,
      mime,
      originalName: attachment.name || attachment.filename || requestedUrl.pathname.split('/').pop(),
    });
  })();

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Reference image download timed out after ${Math.round(timeout / 1000)} seconds.`));
    }, timeout);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } catch (error) {
    if (timedOut || abortError(error)) {
      throw new Error(`Reference image download timed out after ${Math.round(timeout / 1000)} seconds.`);
    }
    cancelResponseBody(response);
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    // Promise.race observes both branches, so a late fetch rejection is not an
    // unhandled rejection. Successful callers leave the completed stream alone;
    // timeout and failure paths above cancel unfinished downloads.
  }
}
