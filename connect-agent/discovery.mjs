import { createCamofoxClient } from './camofox-client.mjs';

const SENSITIVE = /password|passwd|token|secret|cookie|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address|ssn|national.?id/i;
const OBSERVER = `(() => {
  if (window.__SMD_CONNECT_OBSERVER__) return window.__SMD_CONNECT_OBSERVER__;
  const events = [];
  const safeUrl = (input) => { try { return new URL(String(input), location.href); } catch { return null; } };
  const shape = (value, depth = 0) => {
    if (depth > 2 || value === null || value === undefined) return value === null ? 'null' : typeof value;
    if (Array.isArray(value)) return { type: 'array', sample: value.length ? shape(value[0], depth + 1) : null };
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).slice(0, 80)) {
        if (/${SENSITIVE.source}/i.test(key)) continue;
        out[key] = shape(value[key], depth + 1);
      }
      return { type: 'object', keys: out };
    }
    return typeof value;
  };
  const record = (method, input, status, contentType, responseShape) => {
    const url = safeUrl(input);
    if (!url || url.origin !== location.origin) return;
    events.push({ method: String(method || 'GET').toUpperCase(), path: url.pathname, origin: url.origin,
      queryKeys: [...url.searchParams.keys()].filter(k => !/${SENSITIVE.source}|key|id/i.test(k)).slice(0, 50),
      status: Number(status || 0), contentType: String(contentType || '').slice(0, 100), responseShape: responseShape || null });
    if (events.length > 500) events.splice(0, events.length - 500);
  };
  const nativeFetch = window.fetch;
  window.fetch = async function(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    let responseShape = null;
    try { const ct = response.headers.get('content-type') || ''; if (/json/i.test(ct)) responseShape = shape(await response.clone().json()); } catch {}
    record(init?.method || 'GET', input, response.status, response.headers.get('content-type') || '', responseShape);
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) { this.__smdMethod = method; this.__smdUrl = url; return nativeOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', () => {
      let responseShape = null;
      try { const ct = this.getResponseHeader('content-type') || ''; if (/json/i.test(ct)) responseShape = shape(JSON.parse(this.responseText)); } catch {}
      record(this.__smdMethod, this.__smdUrl, this.status, this.getResponseHeader('content-type') || '', responseShape);
    }, { once: true });
    return nativeSend.apply(this, arguments);
  };
  window.__SMD_CONNECT_OBSERVER__ = { events, version: 2 };
  return window.__SMD_CONNECT_OBSERVER__;
})()`;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
function originOf(value) { return new URL(value).origin; }

// A path segment shaped like an identifier (numeric id, UUID, Mongo-style 24-hex, or a long opaque
// token) can itself be a patient/record identifier even though no query value was ever stored.
// Collapse it to a typed placeholder rather than persisting it verbatim.
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|[A-Za-z0-9_-]{16,})$/i;
function redactPath(pathname) {
  return String(pathname || '/').split('/').map(seg => (seg && ID_SEGMENT.test(seg) ? '{id}' : seg)).join('/');
}

function normalizeEvents(raw, allowedOrigins) {
  const origins = new Set(allowedOrigins.map(originOf));
  return (Array.isArray(raw) ? raw : []).filter(e => {
    // Prefer the origin the browser observed directly on the request; only fall back to resolving
    // the (possibly relative) path against the first allowed origin for older artifacts that never
    // recorded one. That fallback is unreliable across multi-origin deployments, so it is legacy-only.
    if (e && typeof e.origin === 'string') { try { return origins.has(new URL(e.origin).origin); } catch { return false; } }
    try { return origins.has(new URL(e.path, allowedOrigins[0]).origin); } catch { return false; }
  }).map(e => ({
    method: String(e.method || 'GET').toUpperCase(), path: redactPath(e.path),
    origin: typeof e.origin === 'string' ? originOf(e.origin) : allowedOrigins[0],
    queryKeys: Array.isArray(e.queryKeys) ? e.queryKeys.filter(k => !SENSITIVE.test(String(k))).slice(0, 50) : [],
    status: Number(e.status || 0), contentType: String(e.contentType || '').slice(0, 100), responseShape: e.responseShape || null,
  })).filter(e => ALLOWED_METHODS.has(e.method));
}

export async function discoverAuthorizedEmr({ startUrl, allowedOrigins = [originOf(startUrl)], userId, sessionKey,
  client = createCamofoxClient(), waitMs = 1200, maxEvents = 200 } = {}) {
  if (!startUrl || !userId || !sessionKey) throw new Error('startUrl, userId and sessionKey are required');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error('At least one allowed origin is required');
  const normalizedOrigins = [...new Set(allowedOrigins.map(originOf))];
  const startOrigin = originOf(startUrl);
  if (!normalizedOrigins.includes(startOrigin)) throw new Error('startUrl origin is not authorized');
  if (typeof client.preflight === 'function') await client.preflight();

  const tab = await client.createTab({ userId, sessionKey, url: startUrl });
  const tabId = tab?.tabId || tab?.id;
  if (!tabId) throw new Error('Camofox did not return a tab id');
  try {
    await client.evaluate({ tabId, userId, expression: OBSERVER });
    await client.wait({ tabId, userId, ms: Math.min(Math.max(waitMs, 0), 30000) });
    const observed = await client.evaluate({ tabId, userId,
      expression: `JSON.stringify((window.__SMD_CONNECT_OBSERVER__?.events || []).slice(-${Math.min(Math.max(maxEvents, 1), 500)}))` });
    let events = [];
    try { events = JSON.parse(observed?.result || '[]'); } catch { throw new Error('Camofox returned invalid discovery data'); }
    const safeEvents = normalizeEvents(events, normalizedOrigins).slice(-maxEvents);
    return Object.freeze({ version: 2, browser: 'camofox', startOrigin, allowedOrigins: normalizedOrigins,
      events: safeEvents, generatedAt: new Date().toISOString(), discoveryMode: 'read-observe-only' });
  } finally {
    await client.closeTab({ tabId, userId }).catch(() => {});
    if (typeof client.closeSession === 'function') await client.closeSession({ userId }).catch(() => {});
  }
}

export { OBSERVER };
