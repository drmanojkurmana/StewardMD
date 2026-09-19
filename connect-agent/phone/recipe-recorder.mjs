// connect-agent/phone/recipe-recorder.mjs - record the sign-in as DATA, not code.
//
// The hand-built adapter knows GHIS's sign-in by heart: GET the SSO page for the antiforgery
// token, POST /Index with USER_ID+PASSWORD, check JSON param1 == 200, find the Doctor tile in
// /apps, follow route?id= through to /Doctor/Home, then read the CSRF token off the worklist
// page. None of that can be hard-coded for a hospital nobody has seen, so it is RECORDED here
// during the doctor's own sign-in and replayed server-side by
// functions/_connect/agent/session.js loginWithRecipe.
//
// What goes in: observed login sequence events captured while the doctor signs in on the
// hospital's own page (method, url, body, responseBody). Values never leave this module except
// as {{userId}} / {{password}} / {{token}} / {{route}} placeholders: the template carries key
// names, never the doctor's credentials.
// What comes out: the clean JSON recipe loginWithRecipe replays:
//   { origin, cookieHost, referer, steps: [...], csrf: { fromStep, regex } }

const TOKEN_KEY = /token|verification|csrf|xsrf|antiforgery|nonce/i;
const TOKEN_REGEX = 'name="__RequestVerificationToken"[^>]*value="([^"]+)"';
const GENERIC_TOKEN_REGEX = 'name="[^"]*(?:token|verification|csrf|xsrf|antiforgery)[^"]*"[^>]*value="([^"]+)"';
const ROUTE_REGEX = 'href="(route\\?id=[^"]+)"';
const USER_KEY = /user|login|email|account|^id$|userid|username/i;
const PASS_KEY = /passw|pwd|otp|\bpin\b|secret|captcha/i;

function str(v) { return v == null ? '' : String(v); }

function normOrigin(v) {
  if (!v) return null;
  try { return new URL(str(v)).origin; } catch { /* maybe a bare host */ }
  try { return new URL('https://' + str(v)).origin; } catch { return null; }
}

function hostOf(url) {
  try { return new URL(str(url)).hostname; } catch { return ''; }
}

function originOf(url) {
  try { return new URL(str(url)).origin; } catch { return ''; }
}

/* One observed event, whatever field names the caller used, -> { method, url, body, response }. */
function normalizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const method = str(e.method || e.verb || 'GET').toUpperCase();
  const url = str(e.url || e.href || e.path || '');
  if (!url) return null;
  const body = e.body !== undefined ? e.body : (e.requestBody !== undefined ? e.requestBody : (e.postData !== undefined ? e.postData : null));
  const response = e.responseBody !== undefined ? e.responseBody
    : e.responseText !== undefined ? e.responseText
    : e.text !== undefined && typeof e.text === 'string' ? e.text
    : e.response !== undefined && typeof e.response === 'string' ? e.response
    : e.response && typeof e.response.body === 'string' ? e.response.body
    : '';
  const status = Number(e.status || (e.response && e.response.status) || 200) || 0;
  const bodyKeys = Array.isArray(e.bodyKeys) ? e.bodyKeys.slice(0, 40) : null;
  return { method, url, body, response: str(response), status, bodyKeys, raw: e };
}

function bodyKeysOf(body, fallbackKeys) {
  if (Array.isArray(fallbackKeys) && fallbackKeys.length) return fallbackKeys.slice(0, 40);
  const b = str(body);
  if (!b) return [];
  if (b.trim()[0] === '{') {
    try {
      const j = JSON.parse(b);
      if (j && typeof j === 'object' && !Array.isArray(j)) return Object.keys(j).slice(0, 40);
    } catch { /* not json */ }
    return [];
  }
  const out = [];
  for (const part of b.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    let k = i >= 0 ? part.slice(0, i) : part;
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    if (k) out.push(k);
    if (out.length >= 40) break;
  }
  return out;
}

function pickUserKey(keys) {
  for (const k of keys) {
    if (TOKEN_KEY.test(k)) continue;
    if (USER_KEY.test(k)) return k;
  }
  return null;
}

function pickPassKey(keys) {
  for (const k of keys) {
    if (PASS_KEY.test(k)) return k;
  }
  return null;
}

/* The body template: credential values become placeholders, token values become {{token}},
 * every other field keeps its recorded value (a mode constant, never an id). */
function bodyTemplate(body, keys, userKey, passKey) {
  const b = str(body);
  const isJson = b.trim()[0] === '{';
  if (isJson) {
    let j = null;
    try { j = JSON.parse(b); } catch { j = null; }
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const out = {};
      for (const k of Object.keys(j)) {
        if (k === userKey) out[k] = '{{userId}}';
        else if (k === passKey) out[k] = '{{password}}';
        else if (TOKEN_KEY.test(k)) out[k] = '{{token}}';
        else out[k] = j[k];
      }
      return JSON.stringify(out);
    }
  }
  const parts = [];
  const seen = new Set();
  for (const part of b.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    let k = i >= 0 ? part.slice(0, i) : part;
    let v = i >= 0 ? part.slice(i + 1) : '';
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (k === userKey) parts.push(encodeURIComponent(k) + '={{userId}}');
    else if (k === passKey) parts.push(encodeURIComponent(k) + '={{password}}');
    else if (TOKEN_KEY.test(k)) parts.push(encodeURIComponent(k) + '={{token}}');
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  // A redacted log (keys only, no values): still a faithful template.
  if (!parts.length && Array.isArray(keys)) {
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (k === userKey) parts.push(encodeURIComponent(k) + '={{userId}}');
      else if (k === passKey) parts.push(encodeURIComponent(k) + '={{password}}');
      else if (TOKEN_KEY.test(k)) parts.push(encodeURIComponent(k) + '={{token}}');
      else parts.push(encodeURIComponent(k) + '=');
    }
  }
  return parts.join('&');
}

/* The success assertion: the JSON field whose value reads as an ok (GHIS: param1 == 200). */
function successExpect(responseBody) {
  let j = null;
  try {
    j = JSON.parse(str(responseBody));
    if (typeof j === 'string') j = JSON.parse(j);
  } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const preferred = ['param1', 'code', 'status', 'success', 'result', 'ok'];
  const keys = [...preferred.filter((k) => k in j), ...Object.keys(j).filter((k) => !preferred.includes(k))];
  for (const k of keys) {
    const v = j[k];
    if (v === 200 || v === '200') return { json: k, equals: 200 };
    if (v === true) return { json: k, equals: true };
    if (typeof v === 'string' && /^(ok|success|authenticated)$/i.test(v.trim())) return { json: k, equals: v };
  }
  return null;
}

function tokenRegexFor(responseBody) {
  const b = str(responseBody);
  if (/__RequestVerificationToken/.test(b)) return TOKEN_REGEX;
  return GENERIC_TOKEN_REGEX;
}

/**
 * synthesizeLoginRecipe({ observedRequests, origin, dataHost }) -> recipe for loginWithRecipe.
 *
 * observedRequests: login sequence events in order (GET sign-in page, POST credentials,
 * GET /apps launcher, GET route?id= hop, GET worklist/CSRF page). Each event carries at
 * least { method, url } plus body/responseBody where observed.
 * origin / dataHost: the data host (https://hospital.example); the recipe's origin and
 * cookieHost derive from it, falling back to the last data-host-like observed URL.
 */
export function synthesizeLoginRecipe({ observedRequests, origin, dataHost } = {}) {
  const events = (Array.isArray(observedRequests) ? observedRequests : []).map(normalizeEvent).filter(Boolean);
  if (!events.length) throw new Error('no_login_recipe');

  // The data host is where the cookie jar lives; the login dance may start elsewhere (SSO).
  let dataOrigin = normOrigin(dataHost) || normOrigin(origin) || null;
  const posts = events.filter((e) => e.method === 'POST');
  const gets = events.filter((e) => e.method === 'GET');

  // The login POST is the anchor: the only POST carrying a password-shaped field name.
  let loginIdx = -1;
  let userKey = null;
  let passKey = null;
  let loginKeys = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.method !== 'POST') continue;
    const keys = bodyKeysOf(e.body, e.bodyKeys);
    const u = pickUserKey(keys);
    const p = pickPassKey(keys);
    if (p && (u || keys.length)) { loginIdx = i; userKey = u; passKey = p; loginKeys = keys; break; }
  }
  if (loginIdx < 0) {
    // A redacted log may name the password key without values: same pick, looser guard.
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.method !== 'POST') continue;
      const keys = bodyKeysOf(e.body, e.bodyKeys);
      const p = pickPassKey(keys);
      if (p) { loginIdx = i; userKey = pickUserKey(keys); passKey = p; loginKeys = keys; break; }
    }
  }
  if (loginIdx < 0) throw new Error('no_login_recipe');

  const login = events[loginIdx];
  const ssoOrigin = originOf(login.url) || normOrigin(origin) || null;

  // The initial GET is the sign-in page whose response carries the antiforgery token.
  let page = null;
  for (let i = loginIdx - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.method !== 'GET') continue;
    if (/token|verification|csrf|xsrf|antiforgery|nonce/i.test(e.response) || /__RequestVerificationToken/.test(e.response)) { page = e; break; }
    if (!page) page = e;
  }
  if (!page) {
    for (let i = 0; i < loginIdx; i += 1) {
      if (events[i].method === 'GET') { page = events[i]; break; }
    }
  }

  // The launcher hop: /apps whose tile link is the only route to a data-capable session.
  let apps = null;
  for (let i = loginIdx + 1; i < events.length; i += 1) {
    const e = events[i];
    if (e.method !== 'GET') continue;
    try {
      if (/\/apps\/?(\?|$)/.test(new URL(e.url).pathname) || /route\?id=/.test(e.response)) { apps = e; break; }
    } catch { if (/\/apps/.test(e.url) || /route\?id=/.test(e.response)) { apps = e; break; } }
  }

  // A route hop: the captured launcher tile followed across hosts.
  let routeHop = null;
  if (apps) {
    const ai = events.indexOf(apps);
    for (let i = ai + 1; i < events.length; i += 1) {
      const e = events[i];
      if (e.method !== 'GET') continue;
      if (/route\?id=/.test(e.url)) { routeHop = e; break; }
    }
  }

  // The CSRF page is the last data-host GET whose response carries a token.
  const dataGets = gets.filter((e) => {
    const o = originOf(e.url);
    if (dataOrigin) return o === dataOrigin;
    return true;
  });
  let csrfPage = null;
  for (let i = dataGets.length - 1; i >= 0; i -= 1) {
    if (/token|verification|csrf|xsrf|antiforgery|nonce/i.test(dataGets[i].response)) { csrfPage = dataGets[i]; break; }
  }
  if (!csrfPage && dataGets.length) csrfPage = dataGets[dataGets.length - 1];
  if (!csrfPage) {
    for (let i = events.length - 1; i > loginIdx; i -= 1) {
      if (events[i].method === 'GET') { csrfPage = events[i]; break; }
    }
  }

  if (!dataOrigin) {
    dataOrigin = (csrfPage && originOf(csrfPage.url)) || (routeHop && originOf(routeHop.url)) || ssoOrigin;
  }
  if (!dataOrigin) throw new Error('no_login_recipe');
  const cookieHost = hostOf(dataOrigin);

  const steps = [];
  if (page) {
    steps.push({
      name: 'page',
      method: 'GET',
      url: page.url,
      capture: { token: { regex: tokenRegexFor(page.response) } },
    });
  }
  const tpl = bodyTemplate(login.body, loginKeys, userKey, passKey);
  const postStep = { name: 'post', method: 'POST', url: login.url, body: tpl };
  const rawLogin = login.raw || {};
  if (rawLogin.xhr || /xmlhttprequest/i.test(str(rawLogin.reqCt) + str(rawLogin.contentType) + str((rawLogin.headers || {})['x-requested-with']))) {
    postStep.headers = { 'X-Requested-With': 'XMLHttpRequest' };
  } else if (/Index|login|signin/i.test(login.url)) {
    postStep.headers = { 'X-Requested-With': 'XMLHttpRequest' };
  }
  const expect = successExpect(login.response);
  if (expect) postStep.expect = expect;
  steps.push(postStep);

  if (apps) {
    steps.push({
      name: 'apps',
      method: 'GET',
      url: apps.url,
      capture: { route: { regex: ROUTE_REGEX } },
    });
    // The tile route is followed by hand across hosts (the SSO -> EMR handoff): only that
    // hop yields a data-capable session, so it is replayed with follow, never hard-coded.
    const appsOrigin = originOf(apps.url) || ssoOrigin || dataOrigin;
    steps.push({ name: 'home', method: 'GET', url: appsOrigin + '/{{route}}', follow: true });
  } else if (routeHop) {
    steps.push({ name: 'home', method: 'GET', url: routeHop.url, follow: true });
  }

  let csrfFrom = null;
  if (csrfPage && csrfPage.url !== (page && page.url)) {
    steps.push({ name: 'wl', method: 'GET', url: csrfPage.url });
    csrfFrom = 'wl';
  }

  const recipe = {
    origin: dataOrigin,
    cookieHost,
    referer: '/Doctor/Home',
    steps,
  };
  if (csrfFrom && csrfPage) {
    recipe.csrf = { fromStep: csrfFrom, regex: tokenRegexFor(csrfPage.response) };
  } else if (page) {
    recipe.csrf = { fromStep: 'page', regex: tokenRegexFor(page.response) };
  }
  return recipe;
}
