function normalizeForMatch(value) {
  return String(value).normalize('NFKC').toLowerCase();
}

/** Match registered display names without changing the user's original prompt. */
export function detectReferenceProfiles(prompt, profiles) {
  const text = normalizeForMatch(prompt);
  const byName = new Map();
  for (const profile of profiles) {
    if (typeof profile?.displayName !== 'string' || typeof profile.slug !== 'string' || !profile.slug) {
      throw new Error('Invalid reference profile metadata.');
    }
    const name = normalizeForMatch(profile.displayName);
    if (!name.trim()) throw new Error('Invalid reference profile metadata.');
    if (!byName.has(name)) byName.set(name, new Map());
    byName.get(name).set(profile.slug, profile);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const selected = [];
  const seen = new Set();
  for (let position = 0; position < text.length;) {
    // At the same position, prefer the longest registered name. This avoids
    // selecting both "Alice" and "Alice Smith" for one occurrence. Consume
    // the whole matched name so another overlapping name is not auto-added.
    const name = names.find(candidate => text.startsWith(candidate, position));
    if (!name) { position++; continue; }
    const matches = byName.get(name);
    if (matches.size !== 1) {
      throw new Error('自動参照の登録名が重複しています。reference欄で使う名前を指定してください。');
    }
    const profile = matches.values().next().value;
    if (!seen.has(profile.slug)) {
      selected.push(profile);
      seen.add(profile.slug);
    }
    position += name.length;
  }
  return selected;
}
