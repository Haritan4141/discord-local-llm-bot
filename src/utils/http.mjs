export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text().catch(() => '');

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}\n${text}`);
      }
      throw new Error(`Invalid JSON response from ${url}`);
    }

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}\n${text}`);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}
