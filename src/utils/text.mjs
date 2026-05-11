export function truncateText(text, maxChars = 2000) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export function stripInvisibleCharacters(text) {
  return String(text || '')
    .replace(/﻿/g, '')
    .replace(/[​-‍⁠]/g, '');
}

export function previewValueForLog(value, maxChars = 240) {
  if (typeof value === 'string') return truncateText(value, maxChars);
  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

export function codePointPreview(text, maxChars = 24) {
  return Array.from(String(text || '').slice(0, maxChars))
    .map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

export function splitForDiscord(text, chunkSize = 1800) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks.length ? chunks : ['(empty)'];
}
