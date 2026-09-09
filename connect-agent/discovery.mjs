import { createCamofoxClient } from './camofox-client.mjs';

const OBSERVER = `(() => {
  if (window.__SMD_CONNECT_OBSERVER__) return window.__SMD_CONNECT_OBSERVER__;
  const events = [];
  const safeUrl = (input) => { try { return new URL(String(input), location.href).toString(); } catch { return ''; } };
  const shape = (value, depth = 0) => {
    if (depth > 2 || value === null || value === undefined) return value === null ? 'null' : typeof value;
    if (Array.isArray(value)) return { type: 'array', sample: value.length ? shape(value[0], depth + 1) : null };
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).slice(0, 80)) {
        if (/password|passwd|token|secret|cookie|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address/i.test(key)) continue;
        out[key] = shape(value[key], depth + 1);
      }
      return { type: 'object', keys: out };
    }
    return typeof value;
  };
  const record = (method, input, init, status, contentType, responseShape) => {
    const url = safeUrl(input);
    if (!url || new URL(url).origin !== location.origin) return;
    const u = new URL(url);
    events.push({
      method: String(method || 'GET').toUpperCase(),
      path: u.pathname,
      queryKeys: [...u.searchParams.keys()].filter(k => !/token|secret|password|key|id/i.test(k)).slice(0, 50),
      status: Number(status || 0),
      contentType: contentType || '',
      responseShape: responseShape || null,
      at: Date.now(),
    });
    if (events.length > 300) events.splice(0, events.length - 300);
  };
  const nativeFetch = window.fetch;
  window.fetch = async function(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    let responseShape = null;
    try {
      const ct = response.headers.get('content-type') || '';
      if (/json/i.test(ct)) {
        const copy = response.clone();
        const data = await copy.json();
        responseShape = shape(data);
      }
    } catch {}
    record(init?.method || 'GET', input, init, response.status, response.headers.get('content-type') || '', responseShape);
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__smdMethod = method; this.__smdUrl = url;
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', () => {
      let responseShape = null;
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (/json/i.test(ct)) responseShape = shape(JSON.parse(this.responseText));
      } catch {}
      record(this.__smdMethod, this.__smdUrl, null, this.status, this.getResponseHeader('content-type') || '', responseShape);
    }, { once: true });
    return nativeSend.apply(this, arguments);
  };
  window.__SMD_CONNECT_OBSERVER__ = { events, version: 1 };
  return window.__SMD_CONNECT_OBSERVER__;
})()`;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value) { return new URL(value).origin; }

function normalizeEvents(raw, allowedOrigins) {
  const origins = new Set(allowedOrigins.map(originOf));
  return (Array.isArray(raw) ? raw : []).filter(e => {
    try { return origins.has(new URL(e.path, allowedOrigins[0]).origin); } catch { return false; }
  }).map(e => ({
    method: String(e.method || 'GET').toUpperCase(),
    path: String(e.path || '/'),
    queryKeys: Array.isArray(e.queryKeys) ? e.queryKeys.slice(0, 50) : [],
    status: Number(e.status || 0),
    contentType: String(e.contentType || '').slice(0, 100),
    responseShape: e.responseShape || null,
  })).filter(e => ALLOWED_METHODS.has(e.method));
}

export async function discoverAuthorizedEmr({
  startUrl,
  allowedOrigins = [originOf(startUrl)],
  userId,
  sessionKey,
  client = createCamofoxClient(),
  waitMs = 800,
  maxEvents = 200,
} = {}) {
  if (!startUrl || !userId || !sessionKey) throw new Error('startUrl, userId and sessionKey are required');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error('At least one allowed origin is required');
  const startOrigin = originOf(startUrl);
  if (!allowedOrigins.map(originOf).includes(startOrigin)) throw new Error('startUrl origin is not authorized');

  const tab = await client.createTab({ userId, sessionKey, url: startUrl });
  const tabId = tab?.tabId || tab?.id;
  if (!tabId) throw new Error('Camofox did not return a tab id');

  try {
    await client.evaluate({ tabId, userId, expression: OBSERVER });
    await client.wait({ tabId, userId, ms: waitMs });
    const snapshot = await client.snapshot({ tabId, userId, includeScreenshot: false });
    const observed = await client.evaluate({
      tabId,
      userId,
      expression: `JSON.stringify((window.__SMD_CONNECT_OBSERVER__?.events || []).slice(-${Math.max(1, maxEvents)}))`,
    });
    let events = [];
    try { events = JSON.parse(observed?.result || '[]'); } catch {}

    return Object.freeze({
      version: 1,
      browser: 'camofox',
      startOrigin,
      allowedOrigins: [...new Set(allowedOrigins.map(originOf))],
      tabId,
      snapshot: typeof snapshot?.snapshot === 'string' ? snapshot.snapshot : '',
      events: normalizeEvents(events, allowedOrigins).slice(-maxEvents),
      generatedAt: new Date().toISOString(),
    });
  } finally {
    await client.closeTab({ tabId, userId }).catch(() => {});
  }
}

export { OBSERVER };
