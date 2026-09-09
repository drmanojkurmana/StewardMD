/**
 * StewardMD Connect — Camofox browser transport.
 *
 * This module talks to a locally/self-hosted Camofox server over its REST API.
 * It deliberately does not accept, persist, or log EMR passwords/cookies.
 * Authentication is performed by the clinician in the controlled browser session.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:9377';
const REQUIRED_OPENAPI_PATHS = ['/tabs', '/tabs/{tabId}/evaluate', '/tabs/{tabId}/wait', '/tabs/{tabId}'];

function assertUrl(value, name) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must be http(s)`);
  return url.toString();
}

function headers(accessKey) {
  const out = { 'content-type': 'application/json' };
  if (accessKey) out.authorization = `Bearer ${accessKey}`;
  return out;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers(options.accessKey), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Camofox ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

export function createCamofoxClient({
  baseUrl = process.env.CAMOFOX_URL || DEFAULT_BASE_URL,
  accessKey = process.env.CAMOFOX_ACCESS_KEY || '',
  timeoutMs = 30000,
} = {}) {
  const root = assertUrl(baseUrl, 'baseUrl').replace(/\/$/, '');
  const call = async (path, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await request(root, path, { ...options, accessKey, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };

  return Object.freeze({
    health: () => call('/health'),
    openApi: () => call('/openapi.json'),
    preflight: async () => {
      const health = await call('/health');
      if (health?.ok !== true) throw new Error('Camofox health check failed');
      const openapi = await call('/openapi.json');
      const paths = new Set(Object.keys(openapi?.paths || {}));
      const missing = REQUIRED_OPENAPI_PATHS.filter(path => !paths.has(path));
      if (missing.length) throw new Error(`Unsupported Camofox API: missing ${missing.join(', ')}`);
      return { ok: true, api: openapi?.info?.version || null };
    },
    createTab: ({ userId, sessionKey, url }) => call('/tabs', {
      method: 'POST',
      body: JSON.stringify({ userId, sessionKey, url, trace: false }),
    }),
    snapshot: ({ tabId, userId, includeScreenshot = false }) => call(
      `/tabs/${encodeURIComponent(tabId)}/snapshot?userId=${encodeURIComponent(userId)}&includeScreenshot=${includeScreenshot ? 'true' : 'false'}`,
    ),
    click: ({ tabId, userId, ref }) => call(`/tabs/${encodeURIComponent(tabId)}/click`, {
      method: 'POST', body: JSON.stringify({ userId, ref }),
    }),
    type: ({ tabId, userId, ref, text, pressEnter = false }) => call(`/tabs/${encodeURIComponent(tabId)}/type`, {
      method: 'POST', body: JSON.stringify({ userId, ref, text, pressEnter }),
    }),
    navigate: ({ tabId, userId, url }) => call(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
      method: 'POST', body: JSON.stringify({ userId, url: assertUrl(url, 'url') }),
    }),
    wait: ({ tabId, userId, ms = 500 }) => call(`/tabs/${encodeURIComponent(tabId)}/wait`, {
      method: 'POST', body: JSON.stringify({ userId, ms: Math.min(Math.max(ms, 0), 30000) }),
    }),
    evaluate: ({ tabId, userId, expression }) => call(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
      method: 'POST', body: JSON.stringify({ userId, expression }),
    }),
    closeTab: ({ tabId, userId }) => call(`/tabs/${encodeURIComponent(tabId)}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
    closeSession: ({ userId }) => call(`/sessions/${encodeURIComponent(userId)}`, {
      method: 'DELETE', body: JSON.stringify({ userId }),
    }),
  });
}
