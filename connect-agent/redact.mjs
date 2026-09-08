const SENSITIVE_HEADERS = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|session|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token)/i;

export function sameOrigin(url, root) {
  try {
    const a = new URL(url);
    const b = new URL(root);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

export function safeHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SENSITIVE_HEADERS.test(k)) out[k.toLowerCase()] = String(v).slice(0, 300);
  }
  return out;
}

function shape(value, depth = 0) {
  if (depth > 5) return { type: 'truncated' };
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return { type: 'array', item: value.length ? shape(value[0], depth + 1) : { type: 'unknown' } };
  }
  if (typeof value !== 'object') return { type: typeof value };
  const fields = {};
  for (const [k, v] of Object.entries(value).slice(0, 200)) {
    fields[k] = SENSITIVE_KEY.test(k) ? { type: 'redacted' } : shape(v, depth + 1);
  }
  return { type: 'object', fields };
}

export function responseSchema(body) {
  try {
    return shape(JSON.parse(body));
  } catch {
    return { type: 'non-json' };
  }
}

export function safeUrl(raw, root) {
  try {
    const u = new URL(raw, root);
    if (!sameOrigin(u.href, root)) return null;
    return `${u.origin}${u.pathname}${u.search ? '?<query>' : ''}`;
  } catch {
    return null;
  }
}
