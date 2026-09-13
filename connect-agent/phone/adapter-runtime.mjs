// connect-agent/phone/adapter-runtime.mjs - executes an approved adapter's DISCOVERED ENDPOINTS from
// inside the doctor's own authenticated browser session on the phone.
//
// This is the restricted runtime the adapter runs on. It never evaluates generated code: every call is
// built from declarative facts discovery recorded (method, path, query keys, form field names, the
// selectors and column labels of the view that call fed) plus the patient being read. Cookies stay in
// the native browser; the request is issued by the hospital page itself (fetch with credentials) and
// only the response body comes back to the app, where it is parsed and mapped. Nothing here talks to
// StewardMD's servers.
//
// Order of preference for a view: the recorded data call(s) for it (endpoint replay), then the page the
// view lives on read from the DOM (runtime.mjs readView), which is the fallback, never the primary
// path once an endpoint is known.

import { READ_ROWS } from './runtime.mjs';

export const TOKEN_KEY = /token|verification|csrf|xsrf|antiforgery|nonce/i;
export const PATIENT_KEY = /record|mrn|uhid|patient|reg(no|istration)|hosp(ital)?(no|id)|umr|^id$/i;
export const VISIT_KEY = /visit|episode|encounter|admission|ip(no|number)/i;
export const PAGE_SIZE_KEY = /^(length|limit|pagesize|page_size|size|rows|per_page|count|top)$/i;
export const PAGE_START_KEY = /^(start|offset|skip)$/i;
export const PAGE_NUMBER_KEY = /^(page|pageno|page_no|pagenumber|p)$/i;
const NOISE_PATH = /checksession|keepalive|heartbeat|ping|payment|logout|login|signalr|analytics|\.(js|css|png|jpe?g|gif|svg|woff2?|ico)$/i;
const MAX_TEXT = 2 * 1024 * 1024;

/* ---- the primitive ------------------------------------------------------------------------------ */

/** The expression the hospital page runs: an authenticated same-origin request, answered as JSON text. */
export function fetchExpression(req) {
  const safe = {
    method: req.method === 'POST' ? 'POST' : 'GET',
    url: String(req.url || ''),
    headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/html, */*' }, req.headers || {}),
    body: req.body == null ? null : String(req.body),
    max: MAX_TEXT,
  };
  return '(function(){var req=' + JSON.stringify(safe) + ';' +
    'var init={method:req.method,credentials:"include",headers:req.headers,redirect:"follow"};' +
    'if(req.body!=null){init.body=req.body;if(!init.headers["Content-Type"])init.headers["Content-Type"]="application/x-www-form-urlencoded; charset=UTF-8";}' +
    'return fetch(req.url,init).then(function(r){return r.text().then(function(t){return JSON.stringify({status:r.status,contentType:r.headers.get("content-type")||"",url:r.url,text:t.length>req.max?t.slice(0,req.max):t,truncated:t.length>req.max});});})' +
    '.catch(function(e){return JSON.stringify({status:0,contentType:"",url:req.url,text:"",error:String(e&&e.message||e)});});})()';
}

/** Test seam: the request a fetchExpression() carries, or null. */
export function parseFetchExpression(expr) {
  const m = /^\(function\(\)\{var req=(\{[\s\S]*?\});var init=/.exec(String(expr || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** fetchInPage(plugin, req) -> { status, contentType, url, text, error? }. Throws only if the bridge fails. */
export async function fetchInPage(plugin, req) {
  const res = await plugin.evaluate({ expression: fetchExpression(req) });
  const raw = res && res.result;
  let out = null;
  try { out = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); } catch { out = null; }
  if (!out || typeof out !== 'object') throw new Error('the page returned no response for ' + (req.method || 'GET') + ' ' + req.url);
  if (out.error) throw new Error('request failed in the page: ' + out.error);
  return out;
}

/* ---- tokens ------------------------------------------------------------------------------------- */

/** Reads anti-forgery style tokens from the CURRENT page: hidden inputs and meta tags whose name matches. */
export const PAGE_TOKENS = "(function(){var out={};try{var ins=document.querySelectorAll('input[type=\"hidden\"],input[name*=\"oken\"],input[name*=\"erification\"]');for(var i=0;i<ins.length;i++){var n=ins[i].getAttribute('name')||'';if(/token|verification|csrf|xsrf|antiforgery|nonce/i.test(n)&&ins[i].value&&!out[n])out[n]=ins[i].value;}var ms=document.querySelectorAll('meta[name]');for(var j=0;j<ms.length;j++){var mn=ms[j].getAttribute('name')||'';if(/token|verification|csrf|xsrf|antiforgery|nonce/i.test(mn)&&ms[j].getAttribute('content')&&!out[mn])out[mn]=ms[j].getAttribute('content');}}catch(e){}return JSON.stringify(out)})()";

export async function pageTokens(plugin) {
  try {
    const res = await plugin.evaluate({ expression: PAGE_TOKENS });
    const t = JSON.parse((res && res.result) || '{}');
    return t && typeof t === 'object' ? t : {};
  } catch { return {}; }
}

/** A token by name, or any token whose name resembles the wanted field (GHIS: __RequestVerificationToken). */
export function tokenFor(field, tokens) {
  if (!tokens) return '';
  if (tokens[field]) return tokens[field];
  const want = field.toLowerCase().replace(/[^a-z]/g, '');
  for (const k of Object.keys(tokens)) {
    const have = k.toLowerCase().replace(/[^a-z]/g, '');
    if (have === want || have.includes(want) || want.includes(have)) return tokens[k];
  }
  const names = Object.keys(tokens);
  return names.length === 1 ? tokens[names[0]] : '';
}

/* ---- filling discovered field names ------------------------------------------------------------- */

/**
 * idCandidates(key, patient) -> the values worth trying for one discovered field name, best first.
 * A visit-ish key wants the visit id; a record/patient key wants the hospital number, and, when the
 * EMR keys its visit activation on both (GHIS: recordNo=MR-visit), the joined form is tried too.
 */
export function idCandidates(key, patient) {
  const p = patient || {};
  const pid = String(p.patientId || ''), eid = String(p.episodeId || '');
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  if (VISIT_KEY.test(key)) { push(eid); push(pid); }
  else if (/record/i.test(key)) { push(pid); if (eid && eid !== pid) { push(pid + '-' + eid); push(eid); } }
  else if (PATIENT_KEY.test(key)) { push(pid); if (eid && eid !== pid) push(eid); }
  return out;
}

/** fillFields(bodyKeys, { patient, tokens, pick }) -> { name: value } for a discovered POST; pick(key) chooses among candidates. */
export function fillFields(bodyKeys, { patient, tokens, pick } = {}) {
  const out = {};
  for (const key of Array.isArray(bodyKeys) ? bodyKeys : []) {
    if (TOKEN_KEY.test(key)) { out[key] = tokenFor(key, tokens); continue; }
    const c = idCandidates(key, patient);
    const chosen = typeof pick === 'function' ? pick(key, c) : c[0];
    out[key] = chosen == null ? '' : chosen;
  }
  return out;
}

export function formEncode(fields) {
  return Object.keys(fields).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k] == null ? '' : fields[k])).join('&');
}

/* ---- the replay plan ---------------------------------------------------------------------------- */

function splitPath(path) {
  const m = /^([^?]*)(?:\?(.*))?$/.exec(String(path || ''));
  const keys = [];
  const constants = {};
  if (m && m[2]) for (const part of m[2].split('&')) {
    const i = part.indexOf('=');
    const k = i >= 0 ? part.slice(0, i) : part;
    if (!k) continue;
    keys.push(k);
    // A value discovery kept is a mode constant (Type=IPWorkList), never an identifier: send it as recorded.
    if (i >= 0 && /^[A-Za-z_]{1,32}$/.test(part.slice(i + 1))) constants[k] = part.slice(i + 1);
  }
  return { path: m ? m[1] : String(path || ''), keys, constants };
}

/**
 * replayPlan(view, patient) -> { prerequisites: [{ method:'POST', path, bodyKeys, requestKind }], calls: [{ path, url }] }
 * From the requests discovery saw the view make, in order: the POSTs with field names are the
 * prerequisites (visit activation and the like); the keyed GETs that look like data are the calls,
 * each expanded over the id candidates for its keys. Session pings, the page shell and assets are
 * ignored. Pagination keys are widened so one call covers the list.
 */
export function replayPlan(view, patient, tokens = null) {
  const prerequisites = [];
  const calls = [];
  const eps = Array.isArray(view && view.endpoints) ? view.endpoints : [];
  for (const e of eps) {
    if (!e || typeof e.path !== 'string') continue;
    const { path, keys, constants } = splitPath(e.path);
    if (NOISE_PATH.test(path)) continue;
    if (e.method === 'POST') {
      if (Array.isArray(e.bodyKeys) && e.bodyKeys.length) prerequisites.push({ method: 'POST', path, bodyKeys: e.bodyKeys.slice(), requestKind: e.requestKind || 'form', queryKeys: keys });
      continue;
    }
    if (e.method !== 'GET' || !keys.length) continue;
    // Expand id keys over their candidates (best first), cartesian only across distinct id keys.
    let variants = [{}];
    for (const k of keys) {
      if (constants && constants[k] !== undefined) { variants = variants.map((v) => Object.assign({}, v, { [k]: constants[k] })); continue; }
      if (PAGE_SIZE_KEY.test(k)) { variants = variants.map((v) => Object.assign({}, v, { [k]: '1000' })); continue; }
      if (PAGE_START_KEY.test(k)) { variants = variants.map((v) => Object.assign({}, v, { [k]: '0' })); continue; }
      if (PAGE_NUMBER_KEY.test(k)) { variants = variants.map((v) => Object.assign({}, v, { [k]: '1' })); continue; }
      // GHIS sends its anti-forgery token in the worklist query too: same page token, same rule.
      if (TOKEN_KEY.test(k)) { variants = variants.map((v) => Object.assign({}, v, { [k]: tokenFor(k, tokens) })); continue; }
      const c = idCandidates(k, patient);
      if (!c.length) { variants = variants.map((v) => Object.assign({}, v, { [k]: '' })); continue; }
      const next = [];
      for (const v of variants) for (const val of c) next.push(Object.assign({}, v, { [k]: val }));
      variants = next.slice(0, 6);
    }
    for (const v of variants) {
      const url = path + '?' + formEncode(v);
      if (!calls.some((c) => c.url === url)) calls.push({ path, url, query: v });
    }
  }
  return { prerequisites, calls };
}

/* ---- responses ---------------------------------------------------------------------------------- */

/** 'login' | 'json' | 'html' | 'empty' */
export function classifyResponse(resp) {
  if (!resp) return 'empty';
  if (resp.status === 401 || resp.status === 403) return 'login';
  const text = String(resp.text || '');
  if (!text.trim()) return 'empty';
  if (/<input[^>]+type=["']?password/i.test(text) || /\/(login|signin|account\/login)\b/i.test(String(resp.url || '')) && /<form/i.test(text)) return 'login';
  if (/json/i.test(resp.contentType || '')) return 'json';
  const t = text.trim();
  if ((t[0] === '{' || t[0] === '[')) { try { JSON.parse(t); return 'json'; } catch { /* html that starts oddly */ } }
  return 'html';
}

function flatten(obj, prefix, out, depth) {
  if (depth > 2 || obj == null) return out;
  if (typeof obj !== 'object' || Array.isArray(obj)) { out[prefix || 'value'] = Array.isArray(obj) ? JSON.stringify(obj) : String(obj); return out; }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const name = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, name, out, depth + 1);
    else out[name] = v == null ? '' : (Array.isArray(v) ? JSON.stringify(v) : String(v));
  }
  return out;
}

/** JSON payload -> rows [{ field: text }]. Finds the first array of objects (top level or one level down). */
export function rowsFromJson(payload) {
  let list = null;
  if (Array.isArray(payload)) list = payload;
  else if (payload && typeof payload === 'object') {
    for (const k of ['data', 'rows', 'items', 'result', 'results', 'records', 'list', 'value', 'aaData', 'd']) {
      const v = payload[k];
      if (Array.isArray(v)) { list = v; break; }
      if (v && typeof v === 'object') { for (const kk of Object.keys(v)) if (Array.isArray(v[kk])) { list = v[kk]; break; } if (list) break; }
    }
    if (!list) for (const k of Object.keys(payload)) if (Array.isArray(payload[k])) { list = payload[k]; break; }
    if (!list) return Object.keys(payload).length ? [flatten(payload, '', {}, 0)] : [];
  }
  if (!list) return [];
  return list.map((it) => (it && typeof it === 'object') ? flatten(it, '', {}, 0) : { value: String(it) }).filter((r) => Object.keys(r).length);
}

/** HTML text -> rows through the same reader the DOM path uses, first with the view's selector, then any table. */
export function rowsFromHtml(text, view, parse) {
  const parser = parse || ((html) => new DOMParser().parseFromString(html, 'text/html'));
  let doc;
  try { doc = parser(String(text || '')); } catch { return []; }
  const tryView = (v) => { try { return JSON.parse(READ_ROWS(doc, v) || '[]'); } catch { return []; } };
  /* THE TABLE WITH THE VIEW'S OWN COLUMNS. A data call can answer a whole page of tables (GHIS: the
   * assessment form has six); reading them all passed an assessment form off as a medication chart.
   * When the view recorded its column labels, only the table whose header row shares them is read. */
  const headers = view && Array.isArray(view.headers) ? view.headers : [];
  if (headers.length >= 2 && doc && typeof doc.querySelectorAll === 'function') {
    const want = headers.map(normLabel);
    let best = null, bestScore = 0;
    for (const t of Array.from(doc.querySelectorAll('table'))) {
      const labels = Array.from(t.querySelectorAll ? t.querySelectorAll('th') : []).map((th) => normLabel(th.textContent));
      const score = labels.filter((l) => l && want.includes(l)).length;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    if (best && bestScore >= Math.min(2, want.length)) {
      const out = tableRows(best);
      if (out.length) return out;
    }
  }
  let rows = view && view.rowsSelector ? tryView(view) : [];
  if (!rows.length && view && view.block && view.rowsSelector) rows = tryView(Object.assign({}, view, { rowsSelector: view.rowsSelector.replace(/^#[\w-]+\s+/, '') }));
  // A bare fragment has no header row: the view's own column labels name the cells by position.
  // Only for a single-table fragment: labelling cells by position across a page of several tables is
  // how a six-table assessment form once passed for a medication chart.
  if (!rows.length && !(view && view.block) && (String(text || '').match(/<table/gi) || []).length <= 1) rows = tryView({ rowsSelector: 'table tbody tr, table tr', headers: (view && Array.isArray(view.headers)) ? view.headers : [] });
  return Array.isArray(rows) ? rows : [];
}

/** Rows worth calling data: at least two real columns (one column per row is a heading list, not results). */
export function usableRows(rows) {
  const r = Array.isArray(rows) ? rows[0] : null;
  return !!r && Object.keys(r).filter((k) => k.charAt(0) !== '_').length >= 2;
}

export function normLabel(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

/** One table's data rows keyed by its own header labels (row-level link and onclick kept, as READ_ROWS does). */
function tableRows(table) {
  const txt = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const labels = Array.from(table.querySelectorAll('th')).map(txt);
  const out = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (cells.length < 2 || /no (data|records|matching records)/i.test(txt(tr))) continue;
    const rec = {};
    let filled = 0;
    cells.forEach((c, i) => { const t = txt(c); if (t) { rec[labels[i] || ('col' + i)] = t; filled += 1; } });
    if (!filled) continue;
    const a = tr.querySelector ? tr.querySelector('a[href]') : null;
    const href = a && a.getAttribute ? a.getAttribute('href') || '' : '';
    if (href && href.charAt(0) !== '#' && !/^javascript:/i.test(href)) rec._href = href;
    const oc = (tr.getAttribute && tr.getAttribute('onclick')) || ((tr.querySelector && tr.querySelector('[onclick]')) || { getAttribute: () => '' }).getAttribute('onclick') || '';
    const m = /\(([^)]*)\)/.exec(oc);
    if (m && m[1].trim()) rec._args = m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''));
    out.push(rec);
  }
  return out;
}

/* WHICH CALL IS THIS VIEW'S DATA. A tap fires several calls (visit activation, the assessment form, a
 * session ping, then the medicines list); the first that answers anything is often not the one wanted.
 * Calls whose name fits the resource come first, then the later-recorded ones (the tap's own call is
 * usually last); a call is only accepted when its rows carry the view's recorded columns. */
const RESOURCE_WORDS = Object.freeze({
  medications: /medic|drug|rx|prescri|pharm|indent|treatment/i,
  labs: /lab|investig|result|patho|biochem|haemat|hemat/i,
  radiology: /radio|imag|xray|x-ray|scan|pacs|rad\b/i,
  notes: /note|assess|clinic|progress|casesheet/i,
  patient: /demograph|patientdetail|profile|patientinfo/i,
  history: /visit|history|opcard|encounter|episode/i,
  discharge: /discharge|summary|\bds\b/i,
  worklist: /ipwl|worklist|ward|patients|patlist|census/i,
});
export function rankCalls(calls, resource) {
  const re = RESOURCE_WORDS[resource];
  const paths = [];
  for (const c of calls) if (!paths.includes(c.path)) paths.push(c.path);
  // Later-recorded CALLS first, but a call's id variants keep their best-first order.
  return calls.map((c, i) => ({ c, i, p: paths.indexOf(c.path), fit: re && re.test(c.path) ? 1 : 0 }))
    .sort((a, b) => (b.fit - a.fit) || (b.p - a.p) || (a.i - b.i))
    .map((x) => x.c);
}
export function headerFit(rows, headers) {
  const want = (Array.isArray(headers) ? headers : []).map(normLabel).filter(Boolean);
  if (!want.length || !rows.length) return 0;
  const have = new Set();
  for (const r of rows.slice(0, 5)) for (const k of Object.keys(r)) have.add(normLabel(k));
  return want.filter((w) => have.has(w)).length;
}

export class NotSignedIn extends Error { constructor(m) { super(m); this.name = 'NotSignedIn'; } }

/**
 * executeView({ plugin, origin, view, patient, tokens, parseHtml }) -> { rows, via, url } | null
 * null means the view has no replayable call (caller falls back to the page). Throws NotSignedIn when
 * the hospital answered with its login page or 401/403.
 */
export async function executeView({ plugin, origin, view, patient, tokens = null, parseHtml = null, onCall = null }) {
  let plan = replayPlan(view, patient);
  if (!plan.calls.length && !plan.prerequisites.length) return null;   // a POST-only view (form search) is replayable too
  let viewHost = origin;
  try { const u = new URL(String(view.pathTemplate || '')); if (u.protocol === 'https:') viewHost = u.origin; } catch { /* relative */ }
  const base = String(viewHost || '').replace(/\/$/, '');
  /* SAME SITE OR NO COOKIES. The page issues the call, so it must BE on the data host: a browser left
   * on the sign-in host (gimsrlogin) calling ghis.gitam.edu sends no session and gets the login form
   * (Pixel, 2026-09-13). Move onto the view's own page first when the hosts differ. */
  try {
    const cur = typeof plugin.currentUrl === 'function' ? await plugin.currentUrl() : null;
    const curUrl = typeof cur === 'string' ? cur : cur && cur.url;
    const here = curUrl ? new URL(curUrl).origin : '';
    if (base && here !== base && typeof plugin.navigate === 'function') {
      const page = /^https?:/i.test(String(view.pathTemplate || '')) ? String(view.pathTemplate).replace(/\{[^}]*\}/g, encodeURIComponent((patient && patient.patientId) || '')) : base + '/';
      await plugin.navigate({ url: page });
      await new Promise((r) => setTimeout(r, 2500));
    }
  } catch { /* stay where we are */ }
  const wantsToken = plan.prerequisites.some((p) => p.bodyKeys.some((k) => TOKEN_KEY.test(k))) || plan.calls.some((c) => Object.keys(c.query).some((k) => TOKEN_KEY.test(k)));
  const toks = tokens || (wantsToken ? await pageTokens(plugin) : {});
  if (wantsToken) plan = replayPlan(view, patient, toks);
  let loginSeen = false;
  const run = async (req) => {
    if (typeof onCall === 'function') onCall(req);
    const resp = await fetchInPage(plugin, req);
    const kind = classifyResponse(resp);
    if (kind === 'login') { loginSeen = true; return { kind, resp, rows: [] }; }
    if (kind === 'empty') return { kind, resp, rows: [] };
    let rows = [];
    if (kind === 'json') { try { rows = rowsFromJson(JSON.parse(resp.text)); } catch { rows = []; } }
    else rows = rowsFromHtml(resp.text, view, parseHtml);
    return { kind, resp, rows };
  };
  // Prerequisites, in order, with the first id candidate; a second pass tries the alternatives when the
  // data call answered nothing (the joined record-visit form, the visit id alone).
  const attempts = plan.prerequisites.length ? [0, 1, 2] : [0];
  for (const attempt of attempts) {
    let any = false;
    for (const pre of plan.prerequisites) {
      const fields = fillFields(pre.bodyKeys, { patient, tokens: toks, pick: (k, c) => (c[Math.min(attempt, c.length - 1)] != null ? c[Math.min(attempt, c.length - 1)] : '') });
      if (attempt > 0 && !pre.bodyKeys.some((k) => idCandidates(k, patient).length > attempt)) continue;
      any = true;
      const body = pre.requestKind === 'json' ? JSON.stringify(fields) : formEncode(fields);
      const headers = pre.requestKind === 'json' ? { 'Content-Type': 'application/json' } : {};
      const r = await run({ method: 'POST', url: base + pre.path, body, headers });
      if (r.kind === 'login') throw new NotSignedIn('not signed in: ' + hostOf(base) + ' answered its login page to ' + pre.path);
      /* A POST CAN BE THE DATA. Many EMRs search by form post (GHIS labs: a patient-id search that
       * answers JSON). When the answer fits the view by name or columns, it is the view's data. */
      if (r.rows.length && usableRows(r.rows)) {
        const pFits = !!(RESOURCE_WORDS[view.resourceHint] && RESOURCE_WORDS[view.resourceHint].test(pre.path));
        const pWant = Array.isArray(view.headers) ? view.headers.filter(Boolean) : [];
        if (r.kind === 'json' ? (pFits || headerFit(r.rows, pWant) >= 1) : (pWant.length >= 2 ? headerFit(r.rows, pWant) >= 2 : pFits)) {
          return { rows: r.rows, via: 'endpoint', url: pre.path, kind: r.kind, method: 'POST' };
        }
      }
    }
    if (attempt > 0 && !any) break;
    const want = Array.isArray(view.headers) ? view.headers.filter(Boolean) : [];
    const needFit = Math.min(2, want.length);
    let fallback = null;
    for (const call of rankCalls(plan.calls, view.resourceHint).slice(0, 6)) {
      const r = await run({ method: 'GET', url: base + call.url });
      if (r.kind === 'login') throw new NotSignedIn('not signed in: ' + hostOf(base) + ' answered its login page to ' + call.path);
      if (!r.rows.length) continue;
      const fits = !!(RESOURCE_WORDS[view.resourceHint] && RESOURCE_WORDS[view.resourceHint].test(call.path));
      const got = { rows: r.rows, via: 'endpoint', url: call.url, kind: r.kind };
      // JSON keys rarely equal the screen's column labels (patientFirstName vs "Patient name"): a name
      // fit or any shared label will do, and a JSON answer can still be the fallback. An HTML answer
      // must carry the view's own columns when it recorded them; a page of other tables never counts.
      if (r.kind === 'json') {
        if (fits || headerFit(r.rows, want) >= 1) return got;
        if (!fallback) fallback = got;
        continue;
      }
      if (needFit ? headerFit(r.rows, want) >= needFit : fits) return got;
      if (!fallback && !needFit) fallback = got;
    }
    if (fallback) return fallback;
    if (!plan.prerequisites.length) break;
  }
  if (loginSeen) throw new NotSignedIn('not signed in: ' + hostOf(base) + ' answered its login page');
  return { rows: [], via: 'endpoint', url: plan.calls.length ? plan.calls[0].url : plan.prerequisites[0].path, kind: 'empty' };
}

function hostOf(u) { try { return new URL(u).host; } catch { return String(u || ''); } }
