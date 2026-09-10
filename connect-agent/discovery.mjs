import { createCamofoxClient } from './camofox-client.mjs';
import {
  PHASE_AGENT_READ, PHASE_CLINICIAN_LOGIN, createPolicy, decideNavigation, guardConfig,
} from './policy.mjs';

const SENSITIVE = /password|passwd|token|secret|cookie|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address|ssn|national.?id/i;
const HOSTILE_KEY = /^(?:__proto__|constructor|prototype)$/;

const LIMITS = { maxEvents: 200, maxDepth: 3, maxKeys: 40, maxNodes: 400, maxStringLen: 100 };

/**
 * The main-world observer + policy guard. Written as a real function so it is parsed (and therefore
 * syntax-checked) by Node, then serialized with String() and evaluated in the page realm via the
 * `mw:` prefix. It must not close over anything from this module: every input arrives in `config`.
 *
 * Two jobs:
 *  1. OBSERVE. Records every fetch/XHR the page makes, with the real origin of each request (no
 *     browser-side same-origin filter - the server filters against the allowlist and keeps the
 *     per-event origin, which is what multi-origin hospital deployments need).
 *  2. GUARD. When config.enforce is true (agent phase only), a request that does not match an
 *     approved template is REJECTED in the page realm before it reaches the network, and the block
 *     is recorded as an event. This is enforcement-in-depth, not the sole gate: a page could in
 *     principle bypass it (a fresh iframe's pristine `fetch`, a Worker, a `<script src>`/`<img>`
 *     subresource, a native module reference captured before install, a document-level navigation).
 *     The policy layer above it is the primary gate for anything the agent itself initiates.
 */
function SMD_CONNECT_OBSERVER(config) {
  var W = window;
  if (W.__SMD_CONNECT_OBSERVER__) {
    W.__SMD_CONNECT_OBSERVER__.config = config;
    return JSON.stringify({ installed: true, fresh: false, installId: W.__SMD_CONNECT_OBSERVER__.installId });
  }

  var installId = String(Date.now()) + '-' + String(Math.random()).slice(2, 10);
  var state = { events: [], config: config, installId: installId, version: 3 };
  var SENSITIVE_RE = new RegExp(config.sensitive, 'i');
  var HOSTILE_RE = /^(?:__proto__|constructor|prototype)$/;
  var L = config.limits;

  var safeUrl = function (input) {
    try { return new URL(String(input), location.href); } catch (e) { return null; }
  };

  var shape = function (value, depth, budget) {
    if (budget.n++ > L.maxNodes) return 'truncated';
    if (value === null) return 'null';
    var t = typeof value;
    if (t !== 'object') return t;
    if (depth >= L.maxDepth) return 'object';
    if (Array.isArray(value)) {
      return { type: 'array', sample: value.length ? shape(value[0], depth + 1, budget) : null };
    }
    var out = Object.create(null);
    var keys = Object.keys(value).slice(0, L.maxKeys);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (HOSTILE_RE.test(k)) continue;
      if (SENSITIVE_RE.test(k)) continue;
      if (k.length > L.maxStringLen) continue;
      out[k] = shape(value[k], depth + 1, budget);
    }
    return { type: 'object', keys: out };
  };

  var safeShape = function (value) {
    try {
      var s = shape(value, 0, { n: 0 });
      JSON.stringify(s); // an unsanitizable observation is dropped, never partially persisted
      return s;
    } catch (e) { return null; }
  };

  var push = function (event) {
    state.events.push(event);
    if (state.events.length > L.maxEvents) state.events.splice(0, state.events.length - L.maxEvents);
  };

  var record = function (method, url, status, contentType, responseShape) {
    if (!url) return;
    // forEach, NOT [...searchParams.keys()]: inside Camofox/Firefox's evaluate() realm the iterator
    // keys() returns is dead - spreading it throws "is not iterable" and Array.from() yields []
    // even with params present (verified live against camofox-browser 1.14.0).
    var queryKeys = [];
    url.searchParams.forEach(function (v, k) { queryKeys.push(k); });
    push({
      method: String(method || 'GET').toUpperCase(), path: url.pathname, origin: url.origin,
      queryKeys: queryKeys.slice(0, 50), status: Number(status || 0),
      contentType: String(contentType || '').slice(0, L.maxStringLen),
      responseShape: responseShape || null, blocked: false,
    });
  };

  var recordBlock = function (method, url, reason, rawTarget) {
    push({
      method: String(method || 'GET').toUpperCase(),
      path: url ? url.pathname : '/', origin: url ? url.origin : 'unknown',
      queryKeys: [], status: 0, contentType: '', responseShape: null,
      blocked: true, reason: reason, via: rawTarget,
    });
  };

  var rules = [];
  var compileRules = function () {
    rules = [];
    var list = (state.config && state.config.allow) || [];
    for (var i = 0; i < list.length; i++) {
      rules.push({ method: list[i].method, origin: list[i].origin, re: new RegExp(list[i].re) });
    }
  };
  compileRules();

  var permitted = function (method, url) {
    if (!state.config || !state.config.enforce) return true;
    if (!url) return false;
    if (rules.length !== ((state.config.allow || []).length)) compileRules();
    var m = String(method || 'GET').toUpperCase();
    if (state.config.origins.indexOf(url.origin) < 0) return false;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].method === m && rules[i].origin === url.origin && rules[i].re.test(url.pathname)) return true;
    }
    return false;
  };

  var nativeFetch = W.fetch;
  W.fetch = function (input, init) {
    // fetch(Request) carries its own method and url; fetch(url, init) carries them separately.
    var isRequest = input && typeof input === 'object' && typeof input.url === 'string';
    var method = (init && init.method) || (isRequest ? input.method : null) || 'GET';
    var url = safeUrl(isRequest ? input.url : input);
    if (!permitted(method, url)) {
      recordBlock(method, url, 'policy-block', 'fetch');
      return Promise.reject(new TypeError('StewardMD Connect policy blocked this request'));
    }
    var self = this; var args = arguments;
    return nativeFetch.apply(self, args).then(function (response) {
      var responseShape = null;
      var ct = '';
      try { ct = response.headers.get('content-type') || ''; } catch (e) { ct = ''; }
      if (/json/i.test(ct)) {
        return response.clone().json().then(function (body) {
          record(method, url, response.status, ct, safeShape(body));
          return response;
        }, function () { record(method, url, response.status, ct, null); return response; });
      }
      record(method, url, response.status, ct, responseShape);
      return response;
    });
  };

  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__smdMethod = method; this.__smdUrl = safeUrl(url);
    this.__smdBlocked = !permitted(method, this.__smdUrl);
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__smdBlocked) {
      recordBlock(this.__smdMethod, this.__smdUrl, 'policy-block', 'xhr');
      throw new Error('StewardMD Connect policy blocked this request');
    }
    var self = this;
    this.addEventListener('load', function () {
      var ct = '';
      try { ct = self.getResponseHeader('content-type') || ''; } catch (e) { ct = ''; }
      var responseShape = null;
      if (/json/i.test(ct)) { try { responseShape = safeShape(JSON.parse(self.responseText)); } catch (e) { responseShape = null; } }
      record(self.__smdMethod, self.__smdUrl, self.status, ct, responseShape);
    }, { once: true });
    return nativeSend.apply(this, arguments);
  };

  if (W.navigator && typeof W.navigator.sendBeacon === 'function') {
    var nativeBeacon = W.navigator.sendBeacon.bind(W.navigator);
    W.navigator.sendBeacon = function (url) {
      var target = safeUrl(url);
      if (!permitted('POST', target)) { recordBlock('POST', target, 'policy-block', 'sendBeacon'); return false; }
      return nativeBeacon.apply(null, arguments);
    };
  }

  var formCheck = function (form) {
    var target = safeUrl(form.action || location.href);
    var method = String(form.method || 'GET').toUpperCase();
    if (permitted(method, target)) return true;
    recordBlock(method, target, 'policy-block', 'form-submit');
    return false;
  };
  document.addEventListener('submit', function (e) {
    if (!e.target || !formCheck(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  var nativeFormSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!formCheck(this)) return;
    return nativeFormSubmit.apply(this, arguments);
  };

  W.__SMD_CONNECT_OBSERVER__ = state;
  return JSON.stringify({ installed: true, fresh: true, installId: installId });
}

const OBSERVER_SOURCE = String(SMD_CONNECT_OBSERVER);
/** Legacy export name kept so existing importers do not break. */
const OBSERVER = OBSERVER_SOURCE;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
function originOf(value) { return new URL(value).origin; }

// A path segment shaped like an identifier (numeric id, UUID, Mongo-style 24-hex, a long opaque
// token, or a prefixed id like pt-482910 / MRN00123 - anything carrying 4+ consecutive digits) can
// itself be a patient/record identifier even though no query value was ever stored. Collapse it to a
// typed placeholder rather than persisting it verbatim. The 4-digit rule also catches a bare year
// segment; that is accepted over-redaction, not a bug. Caught live: `pt-482910` reached the spec.
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|[A-Za-z0-9_-]{16,}|.*\d{4,}.*)$/i;
function redactPath(pathname) {
  return String(pathname || '/').split('/').map(seg => (seg && ID_SEGMENT.test(seg) ? '{id}' : seg)).join('/');
}

/**
 * Re-sanitize a response shape that came back over the wire. The browser already bounded and
 * filtered it, but the transport is not trusted: a hostile page can hand back any JSON at all, so
 * depth/keys/nodes are re-bounded here and hostile keys (__proto__, constructor, prototype) are
 * dropped into a null-prototype object so a crafted key can never reach Object.prototype.
 * Returns `undefined` for an observation that cannot be sanitized; the caller drops the event.
 */
function sanitizeShape(value, depth = 0, budget = { n: 0 }) {
  if (budget.n++ > LIMITS.maxNodes) return 'truncated';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length <= LIMITS.maxStringLen ? value : 'truncated';
  if (typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return undefined;
  const type = value.type;
  if (depth >= LIMITS.maxDepth) return 'object';
  if (type === 'array') {
    const sample = value.sample === null || value.sample === undefined ? null : sanitizeShape(value.sample, depth + 1, budget);
    if (sample === undefined) return undefined;
    return { type: 'array', sample };
  }
  if (type !== 'object' || typeof value.keys !== 'object' || value.keys === null) return undefined;
  const keys = Object.create(null);
  for (const key of Object.keys(value.keys).slice(0, LIMITS.maxKeys)) {
    if (HOSTILE_KEY.test(key) || SENSITIVE.test(key) || key.length > LIMITS.maxStringLen) continue;
    const child = sanitizeShape(value.keys[key], depth + 1, budget);
    if (child === undefined) return undefined;
    keys[key] = child;
  }
  return { type: 'object', keys };
}

function baseEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const method = String(e.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return null;
  let origin = null;
  if (typeof e.origin === 'string') { try { origin = originOf(e.origin); } catch { origin = null; } }
  return {
    method, path: redactPath(e.path), origin,
    queryKeys: Array.isArray(e.queryKeys) ? e.queryKeys.filter(k => typeof k === 'string' && !SENSITIVE.test(k) && !/key|id/i.test(k)).slice(0, 50) : [],
    status: Number(e.status || 0),
    contentType: String(e.contentType || '').slice(0, LIMITS.maxStringLen),
  };
}

function normalizeEvents(raw, allowedOrigins, maxEvents = LIMITS.maxEvents) {
  const origins = new Set(allowedOrigins.map(originOf));
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (e && e.blocked) continue;
    const base = baseEvent(e);
    if (!base) continue;
    // Prefer the origin the browser observed directly on the request; only fall back to resolving
    // the (possibly relative) path against the first allowed origin for older artifacts that never
    // recorded one. That fallback is unreliable across multi-origin deployments, so it is legacy-only.
    let origin = base.origin;
    if (!origin) { try { origin = originOf(new URL(e.path, allowedOrigins[0]).href); } catch { continue; } }
    if (!origins.has(origin)) continue;
    const responseShape = e.responseShape === null || e.responseShape === undefined ? null : sanitizeShape(e.responseShape);
    if (responseShape === undefined) continue; // unsanitizable observation: rejected, not partially kept
    out.push({ ...base, origin, responseShape });
    if (out.length >= maxEvents) break;
  }
  return out;
}

/** Blocked attempts are kept whatever their origin - an unapproved origin IS the signal. */
function normalizeBlocked(raw, maxEvents = LIMITS.maxEvents) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || !e.blocked) continue;
    const base = baseEvent(e);
    if (!base) continue;
    out.push({
      method: base.method, path: base.path, origin: base.origin || 'unknown',
      reason: String(e.reason || 'policy-block').slice(0, 64),
      via: String(e.via || 'unknown').slice(0, 32),
    });
    if (out.length >= maxEvents) break;
  }
  return out;
}

function installExpression(config) {
  return `mw:(${OBSERVER_SOURCE})(${JSON.stringify(config)})`;
}
function drainExpression(max) {
  return `mw:JSON.stringify(window.__SMD_CONNECT_OBSERVER__ ? window.__SMD_CONNECT_OBSERVER__.events.splice(0, ${max}) : null)`;
}

/**
 * Explicit discovery lifecycle: attach / start / observe / collect / pause / detach.
 *
 * Session ownership controls cleanup. A collector created by `attachToTab()` owns NOTHING: detaching
 * it never closes the doctor's tab and never closes their browser session. Only the collector that
 * created the tab (discoverAuthorizedEmr) closes what it created.
 */
export function createCollector({
  client, tabId, userId, policy, phase = PHASE_AGENT_READ,
  maxEvents = LIMITS.maxEvents, chunkMs = 400, ownsTab = false, ownsSession = false,
} = {}) {
  if (!client || !tabId || !userId) throw new Error('client, tabId and userId are required');
  const cap = Math.min(Math.max(maxEvents, 1), 500);
  const buffer = [];
  let currentPhase = phase;
  let paused = false;
  let detached = false;
  let installId = null;
  let reinstalls = 0;

  const config = () => (policy
    ? guardConfig(policy, currentPhase, { sensitive: SENSITIVE.source, limits: LIMITS })
    // Legacy compatibility mode: no policy supplied means observe-only. The guard is inert, so
    // discoverAuthorizedEmr() behaves exactly as it did before this refactor. Pass a policy to
    // get in-page enforcement.
    : { phase: currentPhase, enforce: false, origins: [], allow: [], sensitive: SENSITIVE.source, limits: LIMITS });

  const install = async () => {
    const res = await client.evaluate({ tabId, userId, expression: installExpression(config()) });
    let info = null;
    try { info = JSON.parse(res?.result ?? 'null'); } catch { info = null; }
    if (!info?.installed) throw new Error('Camofox did not install the discovery observer');
    if (installId && info.installId !== installId) reinstalls += 1;
    installId = info.installId;
    return info;
  };

  const drain = async () => {
    const res = await client.evaluate({ tabId, userId, expression: drainExpression(cap) });
    let batch = null;
    try { batch = JSON.parse(res?.result ?? 'null'); } catch { throw new Error('Camofox returned invalid discovery data'); }
    if (batch === null) return { fresh: true, count: 0 }; // document replaced: observer is gone
    if (!Array.isArray(batch)) throw new Error('Camofox returned invalid discovery data');
    for (const event of batch) { buffer.push(event); }
    if (buffer.length > cap * 4) buffer.splice(0, buffer.length - cap * 4);
    return { fresh: false, count: batch.length };
  };

  return Object.freeze({
    get tabId() { return tabId; },
    get userId() { return userId; },
    get phase() { return currentPhase; },
    get reinstalls() { return reinstalls; },
    get ownsSession() { return ownsSession; },

    /** Install (or refresh the config of) the observer in the page's own realm. */
    async start(nextPhase = currentPhase) {
      if (detached) throw new Error('collector is detached');
      currentPhase = nextPhase;
      paused = false;
      return install();
    },

    /**
     * Reinstall after a navigation. The page's document is replaced on navigation and the observer
     * with it; there is no init-script primitive in the Camofox REST API, so the requests a fresh
     * document fires inline during its own load are a guaranteed miss. Draining in short chunks
     * keeps that window as small as the chunk size and preserves what was already seen.
     */
    async ensureInstalled() {
      if (detached) throw new Error('collector is detached');
      const { fresh } = await drain();
      if (fresh) { installId = null; await install(); return { reinstalled: true }; }
      return { reinstalled: false };
    },

    async observe({ ms = 1200 } = {}) {
      if (detached) throw new Error('collector is detached');
      if (paused) throw new Error('collector is paused');
      const budget = Math.min(Math.max(ms, 0), 60000);
      const chunk = Math.min(Math.max(chunkMs, 50), budget || 50);
      const deadline = Date.now() + budget;
      do {
        await this.ensureInstalled();
        await client.wait({ tabId, userId, ms: Math.min(chunk, Math.max(deadline - Date.now(), 0)) || 1 });
        await drain();
      } while (Date.now() < deadline);
      return { events: buffer.length };
    },

    /** Hand control back to the clinician: stop observing, leave the tab and session untouched. */
    pause() { paused = true; return { paused: true }; },
    resume() { paused = false; return { paused: false }; },

    raw() { return [...buffer]; },

    collect({ allowedOrigins } = {}) {
      const origins = allowedOrigins || (policy ? [...policy.origins] : []);
      if (!origins.length) throw new Error('collect() needs an origin allowlist');
      return Object.freeze({
        version: 3, browser: 'camofox', allowedOrigins: [...origins],
        events: normalizeEvents(buffer, origins, cap),
        blockedEvents: normalizeBlocked(buffer, cap),
        reinstalls, generatedAt: new Date().toISOString(), discoveryMode: 'read-observe-only',
      });
    },

    /** Ownership decides cleanup. Never closes a session this collector did not create. */
    async detach() {
      if (detached) return { detached: true };
      detached = true;
      await drain().catch(() => {});
      if (ownsTab) await client.closeTab({ tabId, userId }).catch(() => {});
      if (ownsSession && typeof client.closeSession === 'function') await client.closeSession({ userId }).catch(() => {});
      return { detached: true, closedTab: ownsTab, closedSession: ownsSession };
    },
  });
}

/**
 * Attach to an EXISTING authenticated tab. No createTab, no login, no session takeover: the doctor
 * already has this tab open and signed in. Detaching leaves both alive.
 */
export async function attachToTab({ tabId, userId, policy, client = createCamofoxClient(), phase = PHASE_AGENT_READ, maxEvents = LIMITS.maxEvents, chunkMs = 400 } = {}) {
  if (!tabId || !userId) throw new Error('tabId and userId are required');
  const collector = createCollector({ client, tabId, userId, policy, phase, maxEvents, chunkMs, ownsTab: false, ownsSession: false });
  await collector.start(phase);
  return collector;
}

export async function discoverAuthorizedEmr({ startUrl, allowedOrigins = [originOf(startUrl)], userId, sessionKey,
  client = createCamofoxClient(), waitMs = 1200, maxEvents = 200, policy = null, phase = PHASE_AGENT_READ } = {}) {
  if (!startUrl || !userId || !sessionKey) throw new Error('startUrl, userId and sessionKey are required');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error('At least one allowed origin is required');
  const normalizedOrigins = [...new Set(allowedOrigins.map(originOf))];
  const startOrigin = originOf(startUrl);
  if (!normalizedOrigins.includes(startOrigin)) throw new Error('startUrl origin is not authorized');
  if (policy && !policy.origins.includes(startOrigin)) throw new Error('startUrl origin is not authorized');
  if (typeof client.preflight === 'function') await client.preflight();

  // NOT fixable by reordering client calls, verified against a real running Camofox server (not
  // assumed): createTab({url}) already waits for that navigation to finish before returning, and
  // a create-blank/evaluate/navigate sequence doesn't help either - evaluate() runs in the CURRENT
  // document, and navigate() replaces that document, wiping anything evaluate() just set. The REST
  // API has no init-script primitive, so this observer can only see requests made AFTER it installs.
  const tab = await client.createTab({ userId, sessionKey, url: startUrl });
  const tabId = tab?.tabId || tab?.id;
  if (!tabId) throw new Error('Camofox did not return a tab id');
  // This collector CREATED the tab and the session, so it owns and closes both. A collector from
  // attachToTab() owns neither and closes neither.
  const collector = createCollector({
    client, tabId, userId, policy, phase, maxEvents,
    ownsTab: true, ownsSession: typeof client.closeSession === 'function',
  });
  try {
    // "mw:" (main world) on BOTH calls, not optional. Camoufox runs evaluate() in an isolated realm
    // by design, so a `window.fetch` patched from the plain realm is invisible to page scripts.
    await collector.start(phase);
    await collector.observe({ ms: Math.min(Math.max(waitMs, 0), 30000) });
    const collected = collector.collect({ allowedOrigins: normalizedOrigins });
    return Object.freeze({
      version: 2, browser: 'camofox', startOrigin, allowedOrigins: normalizedOrigins,
      events: collected.events, blockedEvents: collected.blockedEvents, reinstalls: collected.reinstalls,
      generatedAt: collected.generatedAt, discoveryMode: 'read-observe-only',
    });
  } finally {
    await collector.detach().catch(() => {});
  }
}

const CANDIDATE_REF = /\[ref=([A-Za-z0-9_-]{1,32})\]/;
const SKIP_LABEL = /sign\s?out|log\s?out|logout|delete|remove|discharge|export|download|order|prescribe|submit|save|new\b|create/i;
const CLICKABLE = /\b(link|button|menuitem|tab|option)\b/i;

/** Deterministically pick clickable refs from an accessibility snapshot. Page text can only ever
 *  NARROW this list, never widen it - every resulting action is still policy-checked, and the
 *  in-page guard still blocks whatever the click actually tries to fetch. */
function candidateRefs(snapshotText) {
  return String(snapshotText || '').split('\n').map((line) => {
    const ref = CANDIDATE_REF.exec(line);
    if (!ref || !CLICKABLE.test(line) || SKIP_LABEL.test(line)) return null;
    return ref[1];
  }).filter(Boolean);
}

/**
 * Bounded read-only exploration. Walks accessibility-snapshot refs under the policy with hard step
 * and time caps, producing observed events only.
 *
 * HONEST LIMIT: a click is opaque to this transport - there is no pre-click URL and no request
 * interception in the Camofox REST API - so a click cannot be policy-decided before it happens.
 * What bounds it is: hard step/time caps, a skip list, a location check against the policy after
 * every step, an immediate stop on the first in-page policy block, and the in-page guard rejecting
 * any non-approved fetch/XHR/beacon/form-submit the click triggers.
 */
export async function exploreReadWorkflows({
  client = createCamofoxClient(), tabId, userId, policy, collector,
  phase = PHASE_AGENT_READ, maxSteps = 6, maxMs = 20000, stepWaitMs = 400,
} = {}) {
  if (!policy) throw new Error('exploreReadWorkflows requires a policy');
  const active = collector || await attachToTab({ tabId, userId, policy, client, phase });
  const steps = [];
  const visited = new Set();
  const deadline = Date.now() + Math.min(Math.max(maxMs, 0), 120000);
  let stopReason = 'step-cap';

  while (steps.length < maxSteps) {
    if (Date.now() >= deadline) { stopReason = 'time-cap'; break; }

    const here = await client.evaluate({ tabId: active.tabId, userId: active.userId, expression: 'mw:location.href' });
    const nav = decideNavigation(policy, phase, { url: here?.result });
    if (!nav.allowed) { stopReason = `left-approved-scope:${nav.reason}`; break; }

    const snap = await client.snapshot({ tabId: active.tabId, userId: active.userId });
    const ref = candidateRefs(snap?.snapshot ?? snap?.result ?? '').find(r => !visited.has(r));
    if (!ref) { stopReason = 'no-candidate'; break; }
    visited.add(ref);

    await client.click({ tabId: active.tabId, userId: active.userId, ref }).catch(() => {});
    await active.observe({ ms: stepWaitMs });
    steps.push({ ref, at: nav.reason });

    if (active.raw().some(e => e && e.blocked)) { stopReason = 'policy-block-observed'; break; }
  }

  return Object.freeze({
    steps, stopReason,
    ...active.collect({ allowedOrigins: [...policy.origins] }),
  });
}

export { OBSERVER, OBSERVER_SOURCE, PHASE_AGENT_READ, PHASE_CLINICIAN_LOGIN, createPolicy, LIMITS };
