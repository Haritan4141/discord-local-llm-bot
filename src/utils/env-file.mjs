// .env parsing / writing helpers shared between the GUI server and tests.

export function parseEnvValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' && last === '"') {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  if (first === "'" && last === "'") return value.slice(1, -1);
  return value;
}

export function parseEnvContent(content) {
  const values = {};
  const orderedKeys = [];
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    values[key] = parseEnvValue(match[2]);
    orderedKeys.push(key);
  }

  return { values, orderedKeys };
}

export function formatEnvValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (/[\r\n#="'`]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}
