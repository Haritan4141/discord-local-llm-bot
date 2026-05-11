export function normalizeDirectUrl(url) {
  let normalized = String(url || '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(/^<+/, '').replace(/>+$/, '');
  normalized = normalized.replace(/[.,!?;:]+$/, '');
  // Only strip trailing ')' when the parentheses are unbalanced (i.e. it's
  // really sentence punctuation). URLs like Wikipedia ja/Foo_(bar) keep them.
  while (normalized.endsWith(')')) {
    const opens = (normalized.match(/\(/g) || []).length;
    const closes = (normalized.match(/\)/g) || []).length;
    if (closes <= opens) break;
    normalized = normalized.slice(0, -1);
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractDirectUrls(text) {
  const raw = String(text || '');
  const matches = raw.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const unique = new Set();
  for (const match of matches) {
    const normalized = normalizeDirectUrl(match);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function stripUrlsFromText(text) {
  return String(text || '').replace(/https?:\/\/[^\s<>"'`]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

const GENERIC_ONLY_QUERY_PATTERNS = [
  /^このu?r?l(の内容)?$/,
  /^このページ(の内容)?$/,
  /^このサイト(の内容)?$/,
  /^このリンク(の内容)?$/,
  /^この記事(の内容)?$/,
  /^これ(の内容)?$/,
  /^内容$/,
  /^要約$/,
  /^見て$/,
  /^教えて$/,
  /^どう$/,
  /^どうですか$/,
];

export function isUsefulSearchQuery(query) {
  const normalized = stripUrlsFromText(query);
  if (!normalized) return false;
  const compact = normalized.replace(/\s+/g, '').toLowerCase();
  if (compact.length < 4) return false;
  return !GENERIC_ONLY_QUERY_PATTERNS.some(pattern => pattern.test(compact));
}
