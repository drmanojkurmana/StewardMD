// connect-agent/phone/prove.mjs - AN ENDPOINT IS SAVED ONLY ONCE IT IS PROVEN.
//
// Owner decision 2026-09-13 (docs/connect/agent-modes-plan.md "Proven endpoints"): per captured screen
//   OBSERVE  the requests the action fired (the page observer's replay buffer, discovery.mjs) and the
//            cell values on screen,
//   REASON   the brain ranks the candidates from STRUCTURE only (op pick-endpoint),
//   EXECUTE  each candidate is re-issued from inside the hospital page, in that order,
//   VERIFY   its answer must carry the values the screen shows; the first that does is the view's data
//            call, the rest are dropped,
//   LEARN    every field it sends is traced to where its value came from: a column of the ward list, a
//            column of the parent list (a lab order's render id), a mode constant, the page token.
//
// Values (screen cells, request urls, response bodies) stay in this app realm on the phone, exactly
// like the runtime's own replays. What leaves the phone: the redacted endpoint, the field-name mapping
// and counts (overlap, hits, cells, rows). The brain sees paths, key names and column labels only.

import { redactEndpoints, scrubForBrain } from './deep-crawl.mjs';
import { rowsFromJson, TOKEN_KEY, PAGE_SIZE_KEY, PAGE_START_KEY, PAGE_NUMBER_KEY } from './adapter-runtime.mjs';

export const ROLES = Object.freeze(['data', 'prerequisite', 'lookup', 'ping', 'shell']);
const WRITE_PATH = /save|update|insert|delete|remove|create|submit|approve|cancel|logout|logoff|signout/i;
const MAX_EXEC = 6;
const BRAIN_RESOURCES = ['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history'];
export const ACCEPT = Object.freeze({ ratio: 0.5, hits: 3 });

/* ---- page realm ---------------------------------------------------------------------------------- */

/* `since` < 0: everything after the mark the last armed action set (CRAWL_ARM_OBSERVER), or the whole
 * document when the action navigated (a new document has no mark and a fresh buffer). */
function PROVE_LIST(since) {
  var R = window.__SMD_REPLAY__ || { list: [] };
  var from = since >= 0 ? since : (window.__smdProveMark || 0);
  var out = [];
  for (var i = 0; i < R.list.length; i++) { if (R.list[i].seq > from) out.push(R.list[i]); }
  return JSON.stringify(out);
}

function PROVE_EXEC(seq) {
  var R = window.__SMD_REPLAY__ || { list: [] };
  var e = null;
  for (var i = 0; i < R.list.length; i++) { if (R.list[i].seq === seq) e = R.list[i]; }
  if (!e) return JSON.stringify({ status: 0, error: 'gone' });
  var headers = { Accept: 'application/json, text/html, */*' };
  if (e.xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  var init = { method: e.method, credentials: 'include', headers: headers, redirect: 'follow' };
  if (e.body != null && e.method !== 'GET' && e.method !== 'HEAD') {
    init.body = e.body;
    headers['Content-Type'] = e.reqCt || 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  return fetch(e.url, init).then(function (r) {
    return r.text().then(function (t) {
      return JSON.stringify({ status: r.status, contentType: r.headers.get('content-type') || '', url: r.url, text: t.length > 2097152 ? t.slice(0, 2097152) : t });
    });
  }).catch(function (x) { return JSON.stringify({ status: 0, error: String(x && x.message || x) }); });
}

/* The texts of the cells the screen shows for the captured view: the table the doctor pointed at, the
 * block's value elements, or the view's rows. */
function PROVE_SCREEN(spec) {
  var out = [];
  var add = function (el) { var t = (el && el.textContent || '').replace(/\s+/g, ' ').trim(); if (t) out.push(t.slice(0, 400)); };
  try {
    var p = window.__smdPointed;
    if (p && p.isConnected && p.tagName === 'TABLE') {
      var tds = p.querySelectorAll('td');
      for (var i = 0; i < tds.length && out.length < 400; i++) add(tds[i]);
    } else if (spec.block) {
      var roots = document.querySelectorAll(spec.rowsSelector);
      for (var r = 0; r < roots.length && out.length < 400; r++) {
        for (var c = 0; c < (spec.cellSelectors || []).length; c++) add(roots[r].querySelector(spec.cellSelectors[c]));
      }
    } else if (spec.rowsSelector) {
      var rows = document.querySelectorAll(spec.rowsSelector);
      // A generic selector also matches the hidden ward list behind the panel: only rows the screen shows.
      var laidOut = false;
      for (var v = 0; v < rows.length && !laidOut; v++) laidOut = rows[v].getClientRects().length > 0;
      for (var k = 0, n = 0; k < rows.length && n < 60; k++) {
        if (laidOut && !rows[k].getClientRects().length) continue;
        n++;
        var cells = rows[k].querySelectorAll('td');
        for (var j = 0; j < cells.length; j++) add(cells[j]);
      }
    }
  } catch (x) { /* an unreadable screen proves nothing */ }
  return JSON.stringify(out);
}

export const PROVE_SOURCES = Object.freeze({
  list: (since) => `(${String(PROVE_LIST)})(${Number.isInteger(since) ? since : -1})`,
  exec: (seq) => `(${String(PROVE_EXEC)})(${Number(seq) || 0})`,
  screen: (spec) => `(${String(PROVE_SCREEN)})(${JSON.stringify({ rowsSelector: spec.rowsSelector || '', cellSelectors: spec.cellSelectors || [], block: !!spec.block })})`,
});

/* ---- pure: verify ------------------------------------------------------------------------------- */

export function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/&nbsp;|&amp;/g, ' ').replace(/[^a-z0-9]/g, ''); }

const FILLER = /^(yes|no|nil|null|none|na|nan|true|false|active|pending|done|normal|male|female|select|view|open|more|details?)$/;
/** The screen values worth matching: distinct, with a letter and 3+ characters, or a 5+ digit number. */
export function consideredCells(texts) {
  const out = [];
  for (const t of Array.isArray(texts) ? texts : []) {
    const n = norm(t).slice(0, 48);
    if (!n || out.includes(n) || FILLER.test(n)) continue;
    if (/[a-z]/.test(n) ? n.length >= 3 : n.length >= 5) out.push(n);
    if (out.length >= 80) break;
  }
  return out;
}

function stripHtml(t) { return String(t || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' '); }

function jsonValues(v, out) {
  if (v == null) return out;
  if (typeof v !== 'object') { out.push(String(v)); return out; }
  for (const k of Object.keys(v)) jsonValues(v[k], out);
  return out;
}

/** The response as one normalised haystack: JSON values, or HTML text (tags gone). */
export function haystack(text, contentType) {
  const t = String(text || '').trim();
  if (/json/i.test(contentType || '') || t[0] === '{' || t[0] === '[') {
    try { return jsonValues(JSON.parse(t), []).map(norm).join('|'); } catch { /* html that starts oddly */ }
  }
  return norm(stripHtml(t).replace(/\s+/g, '|'));
}

/** overlapOf(cells, text, ct) -> { hits, cells, ratio }: how many screen values the response carries. */
export function overlapOf(cells, text, contentType) {
  const hay = haystack(text, contentType);
  let hits = 0;
  for (const c of cells) if (hay.includes(c)) hits += 1;
  return { hits, cells: cells.length, ratio: cells.length ? Math.round((hits / cells.length) * 100) / 100 : 0 };
}

export function accepted(o) { return o.cells > 0 && o.hits >= Math.min(ACCEPT.hits, o.cells) && o.ratio >= ACCEPT.ratio; }

export function responseKind(resp) {
  if (!resp) return 'empty';
  const t = String(resp.text || '');
  if (resp.status === 401 || resp.status === 403 || /<input[^>]+type=["']?password/i.test(t)) return 'login';
  if (!t.trim()) return 'empty';
  const s = t.trim();
  if (/json/i.test(resp.contentType || '') || s[0] === '{' || s[0] === '[') { try { JSON.parse(s); return 'json'; } catch { /* html */ } }
  return 'html';
}

/* ---- pure: learn -------------------------------------------------------------------------------- */

/** Parent rows as the runtime will hold them: JSON rows by key (rowsFromJson), HTML rows by header label
 *  plus `_args.N` (the row's onclick arguments) and `_href.KEY` (its link's query values). */
export function rowsForChain(text, contentType) {
  const t = String(text || '').trim();
  if (/json/i.test(contentType || '') || t[0] === '{' || t[0] === '[') {
    try { return rowsFromJson(JSON.parse(t)); } catch { /* html */ }
  }
  const rows = [];
  const labels = [];
  const txt = (s) => stripHtml(s).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  for (const m of String(t).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)) labels.push(txt(m[1]));
  for (const m of String(t).matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const rec = {};
    const tds = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => txt(x[1]));
    tds.forEach((v, i) => { if (v) rec[labels[i] || 'col' + i] = v; });
    const oc = /onclick\s*=\s*"([^"]*)"|onclick\s*=\s*'([^']*)'/i.exec(m[0]);
    const args = oc && /\(([^)]*)\)/.exec(oc[1] || oc[2]);
    if (args) args[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '').replace(/&#39;|&quot;/g, '')).forEach((v, i) => { if (v) rec['_args.' + i] = v; });
    const href = /href\s*=\s*["']([^"'#]+\?[^"']*)["']/i.exec(m[0]);
    if (href) { try { new URL(href[1].replace(/&amp;/g, '&'), 'https://x.invalid').searchParams.forEach((v, k) => { if (v) rec['_href.' + k] = v; }); } catch { /* not a url */ } }
    if (Object.keys(rec).length) rows.push(rec);
  }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The date format a value has when it is today (the phone's day, give or take one), else null. */
export function todayFormat(value, now = new Date()) {
  const v = String(value || '').trim();
  for (let d = -1; d <= 1; d += 1) {
    const x = new Date(now.getTime() + d * 86400000);
    const dd = String(x.getDate()).padStart(2, '0'), mm = String(x.getMonth() + 1).padStart(2, '0'), yyyy = String(x.getFullYear());
    const mon = MONTHS[x.getMonth()];
    const forms = { 'DD-MM-YYYY': `${dd}-${mm}-${yyyy}`, 'DD/MM/YYYY': `${dd}/${mm}/${yyyy}`, 'YYYY-MM-DD': `${yyyy}-${mm}-${dd}`, 'MM/DD/YYYY': `${mm}/${dd}/${yyyy}`, 'DD-Mon-YYYY': `${dd}-${mon}-${yyyy}` };
    for (const f of Object.keys(forms)) if (v.toLowerCase() === forms[f].toLowerCase()) return f;
  }
  return null;
}

function findField(rows, value) {
  const want = String(value);
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) if (k.charAt(0) !== '_' || k.indexOf('.') > 0) { if (String(r[k]).trim() === want) return k; }
  return null;
}

/**
 * paramsOf(request, parents) -> { key: source }
 * source: { token: true } | { page: 'size'|'start'|'number' } | { from, field } | { from, fields, join } |
 * { today: format } | { constant } | { empty: true } | { unmapped: true }.
 * `parents` = [{ label, rows }] nearest first (the list this row came from, then the ward list).
 */
export function paramsOf(request, parents = [], now = new Date()) {
  const pairs = [];
  try { new URL(request.url).searchParams.forEach((v, k) => pairs.push([k, v])); } catch { /* no query */ }
  const b = request.body;
  if (typeof b === 'string' && b) {
    if (b.trim()[0] === '{') { try { const j = JSON.parse(b); for (const k of Object.keys(j)) if (j[k] == null || typeof j[k] !== 'object') pairs.push([k, j[k] == null ? '' : String(j[k])]); } catch { /* not json */ } }
    else new URLSearchParams(b).forEach((v, k) => pairs.push([k, v]));
  }
  const out = {};
  for (const [k, v] of pairs) {
    if (out[k]) continue;
    if (TOKEN_KEY.test(k)) { out[k] = { token: true }; continue; }
    if (v === '' || v == null) { out[k] = { empty: true }; continue; }
    let src = null;
    if (PAGE_SIZE_KEY.test(k)) src = { page: 'size' };
    else if (PAGE_START_KEY.test(k)) src = { page: 'start' };
    else if (PAGE_NUMBER_KEY.test(k)) src = { page: 'number' };
    // A one- or two-character value ('0', 'a') matches some column by accident: never a row's field.
    if (!src && String(v).length >= 3) {
      for (const p of parents) {
        const f = findField(p.rows || [], v);
        if (f) { src = { from: p.label, field: f }; break; }
      }
      // A joined id (GHIS recordNo = MR + '-' + visit): try every separator position.
      for (let i = 1; !src && i < v.length - 1; i += 1) {
        if (!/[-_/|]/.test(v[i])) continue;
        for (const p of parents) {
          const a = findField(p.rows || [], v.slice(0, i)), c = findField(p.rows || [], v.slice(i + 1));
          if (a && c) { src = { from: p.label, fields: [a, c], join: v[i] }; break; }
        }
      }
    }
    if (!src) { const f = todayFormat(v, now); if (f) src = { today: f }; }
    if (!src && /^[A-Za-z_]{1,32}$/.test(v)) src = { constant: v };
    out[k] = src || { unmapped: true };
  }
  return out;
}

/* What the server accepts (functions/api/connect/agent cleanProvenParams): a field name with an
 * identifier-shaped digit run or an @ is never uploaded, so its source degrades to unmapped. */
const NAME_OK = (s) => typeof s === 'string' && s.length <= 80 && !/\d{3,}|@/.test(s);
export function safeParams(params) {
  const out = {};
  for (const k of Object.keys(params || {})) {
    if (!NAME_OK(k) || k.length > 60 || Object.keys(out).length >= 40) continue;
    const s = params[k];
    out[k] = (s.field !== undefined && !NAME_OK(s.field)) || (s.fields && !s.fields.every(NAME_OK)) ? { unmapped: true } : s;
  }
  return out;
}

/** The fields a proven request sends that trace to a patient or a row: what makes a prerequisite patient-bound. */
export function chained(params) { return Object.values(params || {}).some((s) => s && s.from); }

/* ---- the brain ---------------------------------------------------------------------------------- */

function candidateStructure(e) {
  let path = '', queryKeys = [];
  try { const u = new URL(e.url); path = u.pathname; u.searchParams.forEach((_, k) => queryKeys.push(k)); } catch { /* keep empty */ }
  const s = e.shape || {};
  let bodyKeys = [];
  if (typeof e.body === 'string' && e.body) {
    if (e.body.trim()[0] === '{') { try { bodyKeys = Object.keys(JSON.parse(e.body)); } catch { bodyKeys = []; } }
    else new URLSearchParams(e.body).forEach((_, k) => bodyKeys.push(k));
  }
  return { method: e.method, path, queryKeys: queryKeys.slice(0, 20), bodyKeys: bodyKeys.slice(0, 20), kind: s.kind || 'unknown', keys: (s.keys || []).slice(0, 30), rows: Math.min(Number(s.rows) || 0, 100000), page: !!s.page, xhr: !!e.xhr };
}

/** Deterministic order when there is no brain: XHR data answers first, whole pages last, newest first. */
export function localRank(entries) {
  const score = (e) => { const s = e.shape || {}; return (e.xhr ? 4 : 0) + (s.kind === 'json' ? 2 : 0) + (s.page ? -6 : 0) + (s.kind === 'empty' ? -8 : 0); };
  return entries.map((e, i) => ({ index: i, role: (e.shape || {}).page ? 'shell' : 'data', s: score(e), seq: e.seq }))
    .sort((a, b) => (b.s - a.s) || (b.seq - a.seq)).map(({ index, role }) => ({ index, role }));
}

/* ---- the loop ----------------------------------------------------------------------------------- */

async function evalJson(client, expression, fallback) {
  try { const r = await client.evaluate({ expression }); return JSON.parse(r && r.result != null ? r.result : 'null') ?? fallback; } catch { return fallback; }
}

/**
 * proveView({ client, view, brain, since, label, parents, pageUrl }) -> { proven, trace }
 * Mutates `view`: `endpoints` becomes the proven data call (and the patient-bound prerequisites the
 * page fired before it), each with role, params and proof; `view.proof` records the outcome. An
 * unproven view keeps no endpoints (it is read from its page). `proven` carries the response text
 * and rows for the children to chain from; it never leaves the phone.
 */
export async function proveView({ client, view, brain = null, since = -1, label = '', parents = [], pageUrl = null }) {
  const trace = { tried: [], model: null, brain: false };
  const done = (status, extra = {}) => { view.proof = Object.assign({ status, tried: trace.tried.length, brain: trace.brain }, trace.model ? { model: trace.model } : {}, extra); delete view.endpoints; return { proven: null, trace }; };
  if (!view || !client) return { proven: null, trace };
  let pageOrigin = null;
  try { pageOrigin = new URL(pageUrl || view.pathTemplate).origin; } catch { pageOrigin = null; }

  const all = await evalJson(client, PROVE_SOURCES.list(since), []);
  const entries = (Array.isArray(all) ? all : []).filter((e) => {
    if (!e || (e.method !== 'GET' && e.method !== 'POST')) return false;
    let u; try { u = new URL(e.url); } catch { return false; }
    return (!pageOrigin || u.origin === pageOrigin) && !WRITE_PATH.test(u.pathname) && e.status >= 200 && e.status < 400;
  }).slice(-12);
  if (!entries.length) return done('no-requests');

  const cells = consideredCells(await evalJson(client, PROVE_SOURCES.screen(view), []));
  if (!cells.length) return done('no-screen-values');

  // REASON: the brain ranks from structure; its order is the execution order.
  let order = null;
  if (brain && typeof brain.pickEndpoint === 'function') {
    let a = null;
    try {
      a = await brain.pickEndpoint(scrubForBrain({
        ...(BRAIN_RESOURCES.includes(String(view.resourceHint).replace(/-detail$/, '')) ? { resource: String(view.resourceHint).replace(/-detail$/, '') } : {}),
        action: String(label || view.resourceHint || 'opened a screen').replace(/-/g, ' '), headers: (view.headers || []).slice(0, 24),
        candidates: entries.map(candidateStructure),
      }));
    } catch { a = null; }
    if (a && Array.isArray(a.ranked) && a.ranked.length) {
      trace.brain = true; trace.model = a.model || null;
      order = a.ranked.filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < entries.length && ROLES.includes(r.role));
    }
  }
  if (!order || !order.length) order = localRank(entries);
  const roleOf = new Map(order.map((r) => [r.index, r.role]));
  const tryFirst = order.filter((r) => r.role === 'data' || r.role === 'lookup').concat(order.filter((r) => r.role === 'shell'));

  // EXECUTE + VERIFY, in that order, until one answers with what the screen shows.
  let hit = null;
  for (const r of tryFirst.slice(0, MAX_EXEC)) {
    const e = entries[r.index];
    const resp = await evalJson(client, PROVE_SOURCES.exec(e.seq), null);
    const kind = responseKind(resp);
    const o = kind === 'login' || kind === 'empty' ? { hits: 0, cells: cells.length, ratio: 0 } : overlapOf(cells, resp.text, resp.contentType);
    trace.tried.push({ method: e.method, path: candidateStructure(e).path.replace(/\d{3,}/g, '#'), role: r.role, kind, hits: o.hits, ratio: o.ratio });
    if (kind === 'login') return done('signed-out');
    // A whole page that happens to carry the table is where the view lives, not a data call.
    if (accepted(o) && !(r.role === 'shell' && (e.shape || {}).page && !e.xhr)) { hit = { e, resp, kind, o, role: r.role === 'shell' ? 'data' : r.role }; break; }
  }
  if (!hit) return done('unproven');

  // LEARN: where every field the proven call sends comes from; the page-fired prerequisites that are
  // patient-bound ride along, in the order the page sent them.
  const endpointOf = (e, role, proof) => {
    const [red] = redactEndpoints([{ method: e.method, url: e.url, bodyKeys: candidateStructure(e).bodyKeys, requestKind: /json/i.test(e.reqCt) ? 'json' : (e.body ? 'form' : undefined), xhr: e.xhr }], e.url);
    if (!red) return null;
    return Object.assign(red, { role, params: safeParams(paramsOf(e, parents)), proof });
  };
  const eps = [];
  for (const e of entries) {
    if (e.seq >= hit.e.seq || e.method !== 'POST') continue;
    // Patient-bound (its fields trace to a row) and not what the brain called a ping or a lookup.
    const role = roleOf.get(entries.indexOf(e));
    if (role === 'ping' || role === 'lookup' || !chained(paramsOf(e, parents))) continue;
    const ep = endpointOf(e, 'prerequisite', { kind: 'fired-before' });
    if (ep) eps.push(ep);
  }
  const dataEp = endpointOf(hit.e, 'data', { kind: hit.kind, hits: hit.o.hits, cells: hit.o.cells, overlap: hit.o.ratio, rows: rowsForChain(hit.resp.text, hit.resp.contentType).length });
  if (!dataEp) return done('unproven');
  eps.push(dataEp);
  view.endpoints = eps.slice(-8);
  view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: hit.o.ratio, hits: hit.o.hits, cells: hit.o.cells, kind: hit.kind }, trace.model ? { model: trace.model } : {});
  return { proven: { label: view.resourceHint, rows: rowsForChain(hit.resp.text, hit.resp.contentType) }, trace };
}

/**
 * createProofBook({ brain }) -> book
 * One per discovery run, shared by the crawl, the guided asks and verification. It remembers each
 * proven view's rows (on the phone only) so a detail view's fields can be traced to its parent list and
 * the ward list, and keeps the PHI-free trace the final report shows.
 */
export function createProofBook({ brain = null } = {}) {
  const rowsBy = new Map();
  const trace = [];
  return {
    trace,
    has: (resource) => rowsBy.has(resource),
    async prove({ client, view, label = '', parent = null, since = -1 }) {
      if (!view) return null;
      const parents = [];
      if (parent && rowsBy.has(parent)) parents.push(rowsBy.get(parent));
      if (view.resourceHint !== 'worklist' && rowsBy.has('worklist')) parents.push(rowsBy.get('worklist'));
      let pageUrl = null;
      try { const cur = await client.currentUrl(); pageUrl = typeof cur === 'string' ? cur : cur && cur.url; } catch { pageUrl = null; }
      let out = { proven: null, trace: { tried: [] } };
      try { out = await proveView({ client, view, brain, since, label, parents, pageUrl }); } catch { view.proof = { status: 'error', tried: 0, brain: false }; delete view.endpoints; }
      if (out.proven) rowsBy.set(view.resourceHint, out.proven);
      trace.push(Object.assign({ resource: view.resourceHint }, view.proof || {}, { attempts: out.trace.tried }));
      return view.proof || null;
    },
  };
}
