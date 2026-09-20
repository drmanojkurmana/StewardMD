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

import { redactEndpoints, scrubForBrain, scrubExcerpt } from './deep-crawl.mjs';
import { rowsFromJson, TOKEN_KEY, PAGE_SIZE_KEY, PAGE_START_KEY, PAGE_NUMBER_KEY, PATIENT_KEY, VISIT_KEY } from './adapter-runtime.mjs';

export const ROLES = Object.freeze(['data', 'prerequisite', 'lookup', 'ping', 'shell']);
const WRITE_PATH = /save|update|insert|delete|remove|create|submit|approve|cancel|logout|logoff|signout/i;
const MAX_EXEC = 6;
export const CONSTANT_VALUE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,31}$/;
const NOT_A_VALUE = /^(undefined|null|nan)$/i;
const BRAIN_RESOURCES =['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history'];
/* Resources whose truth is PROSE, not columns. A radiology call can carry the right column names and
 * still hand back the demographics header; only the words tell the two apart, so for these the brain is
 * shown a redacted excerpt as well (connect-agent/phone/deep-crawl.mjs scrubExcerpt). */
const NARRATIVE = ['radiology', 'notes', 'discharge', 'history'];
export const ACCEPT = Object.freeze({ ratio: 0.5, hits: 3 });

/* A "-detail" view of a NARRATIVE resource: its cells are the report's demographic header, not the
 * report itself, so a low cell-overlap does not mean the candidate is wrong (owner, 2026-09-16;
 * ver_05ce2f04: radiology-detail's real answer carried the report prose at ratio 0.14 on cells alone). */
const isNarrativeDetail = (v) => !!(v && v.detailOf && NARRATIVE.includes(String(v.resourceHint || '').replace(/-detail$/, '')));

/** The distinct 5+ letter words in the longest string PROVE_SCREEN captured (its narrative branch), or
 *  [] when there are too few to be a report: a demographic header reads short, a report body does not. */
export function reportWords(shown) {
  let best = '';
  for (const row of Array.isArray(shown) ? shown : []) {
    for (const c of Array.isArray(row) ? row : []) {
      const s = String(c == null ? '' : c);
      if (s.length > best.length) best = s;
    }
  }
  const words = [...new Set((best.toLowerCase().match(/[a-z]{5,}/g) || []))];
  return words.length >= 8 ? words.slice(0, 120) : [];
}

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

/* Execute a request the page did not make as recorded: the widened form of a list call. Same session,
 * same cookies, same realm as PROVE_EXEC; only the url and body differ. */
function PROVE_EXEC_REQ(req) {
  var headers = { Accept: 'application/json, text/html, */*' };
  if (req.xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  var init = { method: req.method, credentials: 'include', headers: headers, redirect: 'follow' };
  if (req.body != null && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    headers['Content-Type'] = req.reqCt || 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  return fetch(req.url, init).then(function (r) {
    return r.text().then(function (t) {
      return JSON.stringify({ status: r.status, contentType: r.headers.get('content-type') || '', url: r.url, text: t.length > 2097152 ? t.slice(0, 2097152) : t });
    });
  }).catch(function (x) { return JSON.stringify({ status: 0, error: String(x && x.message || x) }); });
}

/* The cells the screen shows for the captured view, ROW BY ROW (one array of cell texts per row, in
 * column order): the table the doctor pointed at, the block's value elements, or the view's rows. Row
 * order and column order are what lets a response key be traced to a screen column (learnColumns). */
function PROVE_SCREEN(spec) {
  var out = [];
  var total = 0;
  var text = function (el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400); };
  var addRow = function (els) {
    var row = [];
    for (var i = 0; i < els.length; i++) row.push(text(els[i]));
    if (row.some(function (t) { return t; })) { out.push(row); total += row.length; }
  };
  try {
    var p = window.__smdPointed;
    if (p && p.isConnected && p.tagName === 'TABLE') {
      var trs = p.querySelectorAll('tr');
      for (var i = 0; i < trs.length && total < 400; i++) { var tds = trs[i].querySelectorAll('td'); if (tds.length) addRow(tds); }
    } else if (spec.block) {
      var roots = document.querySelectorAll(spec.rowsSelector);
      for (var r = 0; r < roots.length && total < 400; r++) {
        var vals = [];
        for (var c = 0; c < (spec.cellSelectors || []).length; c++) vals.push(roots[r].querySelector(spec.cellSelectors[c]));
        addRow(vals);
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
        if (cells.length) addRow(cells);
      }
    }
    if (spec.narrative) {
      var own = function (el) {
        var t = '';
        for (var ci = 0; ci < el.childNodes.length; ci++) { var kid = el.childNodes[ci]; if (kid.nodeType === 3) t += kid.nodeValue; }
        return t.replace(/\s+/g, ' ').trim();
      };
      var cands = document.querySelectorAll('td,p,div,pre,span,li');
      var bestText = '';
      for (var ni = 0; ni < cands.length; ni++) {
        if (!cands[ni].getClientRects().length) continue;
        var t2 = own(cands[ni]);
        if (t2.length > bestText.length) bestText = t2;
      }
      if (bestText.length >= 80) out.push([bestText.slice(0, 4000)]);
    }
  } catch (x) { /* an unreadable screen proves nothing */ }
  return JSON.stringify(out);
}

/**
 * narrativeExcerpt(rows, identity) -> the longest piece of prose those rows carry, redacted, or ''.
 * Short cells are labels and codes; a report is the long one. Nothing here is stored or displayed: it
 * goes to the brain to answer "is this a report at all" and is dropped with the answer.
 */
export function narrativeExcerpt(rows, identity = []) {
  let best = '';
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, 8)) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      if (k.charAt(0) === '_') continue;
      const v = row[k];
      if (typeof v !== 'string' || v.length <= best.length) continue;
      best = v;
    }
  }
  return best.length >= 40 ? scrubExcerpt(best, identity) : '';
}

/** The patient's own values, so they can be masked out of the excerpt wherever they appear inline. */
export function identityValues(parents) {
  const out = [];
  for (const p of (Array.isArray(parents) ? parents : []).slice(0, 4)) {
    if (!p || typeof p !== 'object') continue;
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (typeof v === 'string' && v.trim().length >= 3 && v.length <= 60) out.push(v.trim());
    }
  }
  return out;
}

/** What PROVE_SCREEN returned, as rows of cell texts (an older page build answered a flat list: one row). */
export function screenRows(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length && raw.every((x) => typeof x === 'string')) return [raw];
  return raw.filter(Array.isArray).map((r) => r.map((c) => String(c == null ? '' : c)));
}

export const PROVE_SOURCES = Object.freeze({
  list: (since) => `(${String(PROVE_LIST)})(${Number.isInteger(since) ? since : -1})`,
  exec: (seq) => `(${String(PROVE_EXEC)})(${Number(seq) || 0})`,
  execRequest: (req) => `(${String(PROVE_EXEC_REQ)})(${JSON.stringify(req)})`,
  screen: (spec) => `(${String(PROVE_SCREEN)})(${JSON.stringify({ rowsSelector: spec.rowsSelector || '', cellSelectors: spec.cellSelectors || [], block: !!spec.block, narrative: !!spec.narrative })})`,
});

/* ---- pure: verify ------------------------------------------------------------------------------- */

/* NUMERIC ENTITIES ARE NEWLINES, NOT TEXT. GHIS returns every newline as &#xA; and a middot as
 * &#xB7;: without decoding, a value read back never string-matched what the screen showed and the
 * overlap guard never fired (the documented &#xA; newline trap). Decoded before norm() so text
 * containing numeric entities matches raw screen text faithfully. */
export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&nbsp;/gi, ' ').replace(/&ndash;/gi, '-').replace(/&mdash;/gi, '-')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
}

export function norm(s) { return decodeEntities(String(s == null ? '' : s)).toLowerCase().replace(/[^a-z0-9]/g, ''); }

const FILLER = /^(yes|no|nil|null|none|na|nan|true|false|active|pending|done|normal|male|female|select|view|open|more|details?)$/;
/** The screen values worth matching: distinct, with a letter and 3+ characters, or a 5+ digit number. */
/* A cell that merely names the patient (a header block's "Patient ID", "Visit ID", "Age / Gender"). */
const IDENTITY_LABEL = /^\s*(patient|visit|episode|mrn?|uhid|ip\s*no|admission|name|age|gender|sex|dob|bed|ward|room|doctor|consultant|department|dept)(\s*(id|no|number|name|type|\/\s*(sex|gender)))?\s*:?\s*$/i;

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
    try { return jsonValues(JSON.parse(t), []).map((v) => norm(stripHtml(v))).join('|'); } catch { /* html that starts oddly */ }
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

/* HALF THE SCREEN, AT LEAST TWO CELLS, AT MOST THREE REQUIRED. A one-result screen (a single lab report:
 * three cells) needed every cell to hit; one cell printed differently by the page ("10^3/uL") and the
 * result print behind the order was never proven (browser replica of GHIS Lab reports, 2026-09-17). */
export function accepted(o) {
  if (!(o.cells > 0)) return false;
  const need = Math.min(ACCEPT.hits, Math.max(Math.min(2, o.cells), Math.ceil(o.cells * ACCEPT.ratio)));
  return o.hits >= need && o.ratio >= ACCEPT.ratio;
}

/**
 * learnColumns(headers, screenRows, respRows) -> { header: { key } | { keys: [a, b], join } }
 * Which response field feeds each screen column, decided by VALUE EQUALITY against the cells the doctor
 * sees, never by what a key is called: a payload whose `ValueType` or `LowValue` comes before `Result`
 * still maps the "Result" column to `Result`. A column the response shows as two fields joined
 * ("13 - 17" from LowValue and HighValue) maps to both with the joiner the screen used. A column no
 * field reproduces in at least half of its cells stays unmapped, and the consumer must not guess it.
 * Names only leave the phone (header labels and key names); the cells never do.
 */
export function learnColumns(headers, screen, resp) {
  const H = Array.isArray(headers) ? headers : [];
  const rows = (Array.isArray(resp) ? resp : []).slice(0, 200);
  const S = (Array.isArray(screen) ? screen : []).slice(0, 200);
  const out = {};
  if (!H.length || !rows.length || !S.length) return out;
  /* PHONE BUDGET. This runs synchronously on the app WebView's only thread, right after a proof, on
   * lists the size of a ward (GHIS: 668 rows, ~30 fields). The first version paired every key with
   * every other key over every row with an array `includes` inside: tens of millions of string
   * compares, a 30-40s freeze per view on an iPhone that read as "stuck" (2026-09-15). Now: Set
   * membership, the pair pass only over keys whose values actually begin or end some screen cell,
   * and a smaller row sample for the pair pass. Same answers on every test, milliseconds instead. */
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (k.charAt(0) !== '_' && !keys.includes(k)) keys.push(k);
  const nv = (v) => norm(v);
  const normed = rows.map((r) => { const o = {}; for (const k of keys) o[k] = nv(r[k]); return o; });
  const byKey = new Map(keys.map((k) => [k, new Set(normed.map((r) => r[k]).filter((x) => x.length >= 2))]));
  const PAIR_ROWS = 60;
  for (let i = 0; i < H.length; i += 1) {
    const cells = S.map((r) => r[i]).filter((c) => c != null && String(c).trim());
    const cellsN = cells.map(nv).filter((x) => x.length >= 2);
    if (!cellsN.length) continue;
    const cellSet = new Set(cellsN);
    const need = Math.max(1, Math.ceil(cellsN.length * 0.5));
    let best = null, bestHits = 0;
    for (const k of keys) {
      const set = byKey.get(k);
      let hits = 0;
      for (const c of cellsN) if (set.has(c)) hits += 1;
      if (hits > bestHits) { best = k; bestHits = hits; }
    }
    if (best && bestHits >= need) { out[H[i]] = { key: best }; continue; }
    // Composite: only keys whose values start or end some cell can be half of a joined column.
    const sample = normed.slice(0, PAIR_ROWS);
    const starts = [], ends = [];
    for (const k of keys) {
      let s = false, e = false;
      for (const r of sample) { const v = r[k]; if (!v) continue; for (const c of cellsN) { if (!s && c.startsWith(v) && v.length < c.length) s = true; if (!e && c.endsWith(v) && v.length < c.length) e = true; if (s && e) break; } if (s && e) break; }
      if (s) starts.push(k);
      if (e) ends.push(k);
    }
    let pair = null, pairHits = 0;
    for (const a of starts) for (const b of ends) {
      if (a === b) continue;
      let hits = 0;
      for (const r of sample) { const j = r[a] + r[b]; if (j.length >= 2 && cellSet.has(j)) hits += 1; }
      if (hits > pairHits) { pair = [a, b]; pairHits = hits; }
    }
    const needPair = Math.max(1, Math.ceil(Math.min(cellsN.length, sample.length) * 0.5));
    if (!pair || pairHits < needPair) continue;
    let join = ' ';
    for (const r of rows) {
      const a = String(r[pair[0]] == null ? '' : r[pair[0]]).trim(), b = String(r[pair[1]] == null ? '' : r[pair[1]]).trim();
      const raw = cells.map((c) => String(c).trim()).find((c) => nv(c) === nv(a) + nv(b));
      if (!raw) continue;
      if (a && b && raw.startsWith(a) && raw.endsWith(b) && raw.length > a.length + b.length) join = raw.slice(a.length, raw.length - b.length);
      break;
    }
    out[H[i]] = { keys: pair, join: join.slice(0, 8) };
  }
  return out;
}

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
/**
 * dataRowCount(html, headers) -> how many DATA rows the reply carries under the view's own columns: rows
 * of the table whose header row shares the view's labels, with two or more cells and no nested table.
 * A print shell has that header row and zero such rows; its patient-header block is a nested table.
 * Nesting-aware string scan (no DOM here).
 */
export function dataRowCount(html, headers) {
  const want = (Array.isArray(headers) ? headers : []).map((h) => norm(h)).filter(Boolean);
  if (want.length < 2) return -1;
  const src = String(html || '');
  const re = /<(\/?)table\b[^>]*>/gi;
  const stack = [];
  const blocks = [];
  let m;
  while ((m = re.exec(src))) {
    if (!m[1]) stack.push(m.index);
    else if (stack.length) blocks.push([stack.pop(), m.index + m[0].length]);
  }
  let best = 0;
  for (const [a, b] of blocks) {
    let inner = src.slice(a, b);
    // drop nested tables, innermost first
    for (;;) { const n = inner.replace(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/i, (x, off) => (off === 0 ? x : ' ')); if (n === inner) break; inner = n; }
    const labels = [...inner.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => norm(stripHtml(x[1])));
    if (labels.filter((l) => l && want.includes(l)).length < Math.min(2, want.length)) continue;
    let rows = 0;
    for (const tr of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tds = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripHtml(x[1]).replace(/&nbsp;/g, ' ').trim()).filter(Boolean);
      if (tds.length >= 2) rows += 1;
    }
    if (rows > best) best = rows;
  }
  return best;
}

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

/* VALUE -> KEY, OVER EVERY ROW. findField used to stop looking past the first 200 rows, so a widened
 * hospital-wide worklist (757 rows on a live run) left any row past #200 unmapped: the doctor's
 * radiology patient sat at row 600 and its recordNo/resultid never traced to the ward list, so the
 * server marked radiology "unscoped". Built once per rows array and cached on the array itself (a
 * WeakMap keyed on identity, guarded by length too since createProofBook.prove replaces - never
 * mutates - a resource's rows with a fresh concat().slice() array each time more are proven, so a
 * stale index is never reused for a grown or replaced list). */
const fieldIndexCache = new WeakMap();
function fieldIndexFor(rows) {
  const cached = fieldIndexCache.get(rows);
  if (cached && cached.length === rows.length) return cached.index;
  const index = new Map();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) {
      if (k.charAt(0) === '_' && k.indexOf('.') <= 0) continue;
      const v = String(r[k]).trim();
      if (!index.has(v)) index.set(v, k); // first row in order, first key in order wins
    }
  }
  fieldIndexCache.set(rows, { length: rows.length, index });
  return index;
}
function findField(rows, value) {
  return fieldIndexFor(rows).get(String(value)) || null;
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
    // A page-side JS bug can literally stringify the missing value ('?id=undefined'): not a value,
    // never a {constant} — recorded as one it would replay the same wrong id for every patient forever.
    if (v === '' || v == null || NOT_A_VALUE.test(String(v).trim())) { out[k] = { empty: true }; continue; }
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
    // A mode value (Type=IPWorkList, type=Arrived and Occupied, checkbox=0): short, no identifier-shaped
    // digit run, and not any row's field (checked above). Sent as recorded.
    if (!src && CONSTANT_VALUE.test(v) && !/\d{3,}/.test(v)) src = { constant: v };
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

/* A page-load candidate whose query names a patient or visit field at all (traced or not - {unmapped}
 * still counts, {empty} does not): the doctor's own navigation to a report IS the patient-bound call
 * even when there is no parent row to trace it against (GHIS radiology, unreachable by the crawl, has
 * no worklist row to chain to). */
export function patientKeyed(params) {
  return Object.keys(params || {}).some((k) => (PATIENT_KEY.test(k) || VISIT_KEY.test(k)) && !(params[k] && params[k].empty));
}

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

const NAV_NOISE = /checksession|keepalive|heartbeat|signalr|analytics|\/collect$|\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map|pdf)$/i;
/* Main-frame reports the hospital opens by navigation or popup (GHIS radiology/lab/visit reports) are
 * logged natively (decidePolicyFor) but never enter the page fetch/XHR buffer, so proof could not see
 * them (adapter ver_b16da370: labs-detail, radiology-detail, history no-requests). Drained native GETs
 * on the hospital origin become proof candidates, re-issued as fetch() with the doctor's cookies. */
export function navToReplayEntries(drained, { pageOrigin, allowedOrigins = [] } = {}) {
  const reqs = drained && Array.isArray(drained.requests) ? drained.requests : (Array.isArray(drained) ? drained : []);
  const out = [];
  const seen = new Set();
  for (const r of reqs) {
    if (!r || String(r.method || 'GET').toUpperCase() !== 'GET' || typeof r.url !== 'string') continue;
    let u; try { u = new URL(r.url); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    if (pageOrigin && u.origin !== pageOrigin && allowedOrigins.indexOf(u.origin) < 0) continue;
    if (NAV_NOISE.test(u.pathname) || WRITE_PATH.test(u.pathname)) continue;
    const sig = 'GET ' + u.href;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ method: 'GET', url: u.href });
    if (out.length >= 8) break;
  }
  return out;
}

/* Push nav GETs into the page's replay buffer using the real seq, so PROVE_LIST offers them and
 * PROVE_EXEC re-issues them by seq like any observed request. shape.page marks them shell-ranked; a
 * report is usually the only candidate, so it is still executed and accepted on overlap. */
export const INJECT_REPLAY_SRC = "(function(entries){try{var R=window.__SMD_REPLAY__=window.__SMD_REPLAY__||{seq:0,list:[]};for(var i=0;i<entries.length;i++){var e=entries[i];R.seq+=1;R.list.push({seq:R.seq,sig:'GET '+e.url,method:'GET',url:e.url,body:null,reqCt:'',xhr:false,status:200,shape:{kind:'unknown',page:true}});}if(R.list.length>60)R.list.splice(0,R.list.length-60);return R.seq;}catch(x){return 0;}})";

/* THE WIDEST FORM THAT STILL SHOWS THIS DOCTOR'S PATIENTS (owner, 2026-09-16). A ward list request can
 * carry filters the hospital's own page filled in (the signed-in doctor, their unit): replayed as
 * recorded it returns a subset forever and patients silently vanish. Only a parameter nothing could be
 * traced to (`unmapped`) is emptied. A value traced to the worklist or a parent row is the patient's
 * own identity and is never touched: emptying it would turn this patient's labs into everyone's.
 * SAFE FOR THE WARD LIST ONLY. Never call this for a patient-scoped resource: a key that names neither
 * a patient nor a visit (a lab's `resultid`, a report id) would still be emptied. */
export function widenRequest(entry, params) {
  const src = params || {};
  /* `unmapped` is paramsOf's FAILURE state, not proof that a key is a filter: with no proven worklist
   * there are no parent rows, so a real patient id traces to nothing and looks exactly like one
   * (reviewer reproduction, 2026-09-16). A patient- or visit-keyed name is never emptied. */
  const loose = (k, v) => !!v && !!src[k] && src[k].unmapped === true && !PATIENT_KEY.test(k) && !VISIT_KEY.test(k);
  let u;
  try { u = new URL(entry.url); } catch { return null; }
  let changed = false;
  const q = [];
  u.searchParams.forEach((v, k) => { q.push([k, loose(k, v) ? '' : v]); if (loose(k, v)) changed = true; });
  let body = entry.body == null ? null : String(entry.body);
  if (body && /urlencoded|^$/i.test(String(entry.reqCt || '')) && body.indexOf('=') >= 0) {
    const parts = body.split('&').map((p) => {
      const i = p.indexOf('=');
      const k = i >= 0 ? p.slice(0, i) : p;
      const v = i >= 0 ? decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' ')) : '';
      if (loose(k, v)) { changed = true; return k + '='; }
      return p;
    });
    body = parts.join('&');
  }
  if (!changed) return null;
  const search = q.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  return { url: u.origin + u.pathname + (search ? '?' + search : ''), body };
}

/* THE LIST, NOT THE PAGE THAT CONTAINS IT. A whole patient page carries every lab name and every
 * radiology line the screen shows, so "carries the screen's values" accepted GHIS's visit page
 * (POST Searchnew) as the labs call and the visits page as radiology (adapter ver_b16da370,
 * 2026-09-15), where the hand-built adapter calls the lab search and the radiology list. Every answer
 * that carries the screen is scored: rows that fit the screen win, a whole HTML document and a large
 * answer lose. */
export function specificity(hit, screenRowCount) {
  const text = String((hit && hit.resp && hit.resp.text) || '');
  const rows = Array.isArray(hit && hit.rows) ? hit.rows.length : 0;
  const fit = screenRowCount > 0 && rows > 0 ? Math.min(rows, screenRowCount) / Math.max(rows, screenRowCount) : 0;
  const wholePage = /<html[\s>]/i.test(text.slice(0, 2000)) ? 1 : 0;
  const size = Math.min(1, text.length / 200000);
  return ((hit && hit.o && hit.o.ratio) || 0) + fit - wholePage - size;
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

  /* A LIST RESOURCE HAS COLUMNS. A medicines chart, a lab list or a radiology list is a table with named
   * columns; a block of label/value cells with no header row is a patient details panel, whatever the
   * crawl hinted. Proving such a block as "medications" against the visit-activation reply (Searchnew,
   * an assessment page with tables) passed the gate on the live run (candidate ver_6918814c, 2026-09-17)
   * and would have put the assessment form in the medicines drawer. */
  if (['medications', 'labs', 'radiology'].includes(String(view.resourceHint || '')) && !view.block && (!Array.isArray(view.headers) || view.headers.filter(Boolean).length < 1)) return done('no-headers');
  const all = await evalJson(client, PROVE_SOURCES.list(since), []);
  const entries = (Array.isArray(all) ? all : []).filter((e) => {
    if (!e || (e.method !== 'GET' && e.method !== 'POST')) return false;
    let u; try { u = new URL(e.url); } catch { return false; }
    return (!pageOrigin || u.origin === pageOrigin) && !WRITE_PATH.test(u.pathname) && e.status >= 200 && e.status < 400;
  }).slice(-12);
  if (!entries.length) return done('no-requests');

  const shown = screenRows(await evalJson(client, PROVE_SOURCES.screen(Object.assign({}, view, { narrative: isNarrativeDetail(view) })), []));
  let cells = consideredCells(shown.flat());
  /* IDENTITY CELLS PROVE NOTHING ABOUT A RESOURCE. A print shell carries the patient's id, name and
   * visit in a header block plus the column labels, and every one of those is on the screen too:
   * GHIS's lab print page reached the overlap bar that way with zero result rows, was approved as
   * "labs", and every patient's labs read empty (owner's iPhone, 2026-09-17). For any resource but
   * the ward list, the patient's own identifiers and the view's labels are left out: only the
   * resource's own values (a test name, a result, a drug) can prove its call. */
  if (String(view.resourceHint || '') !== 'worklist') {
    const parentRows = parents.flatMap((p) => (p && Array.isArray(p.rows) ? p.rows.slice(0, 4) : [p]));
    const skip = new Set(consideredCells(identityValues(parentRows).concat(Array.isArray(view.headers) ? view.headers : [])));
    cells = consideredCells(shown.flat().filter((t) => !IDENTITY_LABEL.test(String(t || '')))).filter((c) => !skip.has(c));
  }
  const prose = isNarrativeDetail(view) ? reportWords(shown) : [];
  /* A DETAIL THAT LEAVES THE SCREEN IS PROVEN BY ITS TRACE. GHIS opens a lab result from the order list
   * through a print icon: the result call answers, the page writes it into an off-screen print frame,
   * and nothing on the screen can be matched (live run, 2026-09-17). The call is still the row's own:
   * its fields trace to the parent row (render id, episode) and its reply carries rows. That is the
   * same guard the runtime replays it under, so it is accepted as the chained detail. */
  if (!cells.length && !prose.length && view.detailOf && parents.length) {
    for (const e of entries.slice().reverse()) {
      const p = paramsOf(e, parents);
      if (!chained(p)) continue;
      const resp = await evalJson(client, PROVE_SOURCES.exec(e.seq), null);
      const kind = responseKind(resp);
      if (kind === 'login') return done('signed-out');
      if (kind !== 'json' && kind !== 'html') continue;
      const rows = rowsForChain(resp.text, resp.contentType);
      if (!rows.length) continue;
      trace.tried.push({ method: e.method, path: candidateStructure(e).path.replace(/\d{3,}/g, '#'), role: 'data', kind, hits: 0, ratio: 0, chained: true });
      const [red] = redactEndpoints([{ method: e.method, url: e.url, bodyKeys: candidateStructure(e).bodyKeys, requestKind: /json/i.test(e.reqCt) ? 'json' : (e.body ? 'form' : undefined), xhr: e.xhr }], e.url);
      if (!red) continue;
      view.endpoints = [Object.assign(red, { role: 'data', params: safeParams(p), proof: { kind, hits: 0, cells: 0, overlap: 0, rows: rows.length, chained: true } })];
      view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: 0, hits: 0, cells: 0, kind, population: rows.length, chained: true }, trace.model ? { model: trace.model } : {});
      return { proven: { label: view.resourceHint, rows }, trace };
    }
  }
  if (!cells.length && !prose.length) return done('no-screen-values');

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

  // EXECUTE + VERIFY every candidate (up to MAX_EXEC): keep each answer that carries the screen and that
  // Gemini did not confidently reject, then take the most specific of them.
  const hits = [];
  for (const r of tryFirst.slice(0, MAX_EXEC)) {
    const e = entries[r.index];
    const resp = await evalJson(client, PROVE_SOURCES.exec(e.seq), null);
    const kind = responseKind(resp);
    let o = kind === 'login' || kind === 'empty' ? { hits: 0, cells: cells.length, ratio: 0 } : overlapOf(cells, resp.text, resp.contentType);
    // A narrative detail's cells are its demographic header, not the report: a candidate the cells
    // reject can still be the right one if its words are the report itself (owner, 2026-09-16).
    if (prose.length && !accepted(o) && kind !== 'login' && kind !== 'empty') {
      const w = overlapOf(prose, resp.text, resp.contentType);
      if (accepted(w)) o = w;
    }
    trace.tried.push({ method: e.method, path: candidateStructure(e).path.replace(/\d{3,}/g, '#'), role: r.role, kind, hits: o.hits, ratio: o.ratio });
    if (kind === 'login') return done('signed-out');
    // A whole page is layout, unless it is keyed on this patient (a report opened by navigation) - traced
    // to a parent row, or (no parent to trace against, e.g. GHIS radiology) its query names a patient or
    // visit field at all.
    const p = paramsOf(e, parents);
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr && !chained(p) && !patientKeyed(p))) continue;
    const rows = rowsForChain(resp.text, resp.contentType);
    /* A SHELL IS NOT DATA. An HTML reply that carries the view's header row but no data row under it (a
     * print page's empty result table over a patient-header block) proves nothing, whatever else on the
     * screen it happens to contain (GHIS OTLabPrintsSecretary, approved as labs, 2026-09-17). */
    if (kind === 'html' && String(view.resourceHint || '') !== 'worklist' && dataRowCount(resp.text, view.headers) === 0) {
      trace.tried[trace.tried.length - 1].shell = true;
      continue;
    }
    /* GEMINI JUDGES THE REPLY, the ward list included: an out-patient queue carries patients too, and
     * was proven as the ward list on the live run (DashboardUnit, 2026-09-15). Only column names, a row
     * count and the redacted path go to the model. A confident "no" rejects it. */
    const resource = String(view.resourceHint || '').replace(/-detail$/, '');
    if (brain && typeof brain.verify === 'function' && BRAIN_RESOURCES.includes(resource)) {
      const cols = [];
      for (const row of rows.slice(0, 5)) for (const k of Object.keys(row)) if (k.charAt(0) !== '_' && !cols.includes(k)) cols.push(k);
      const payload = scrubForBrain({ resource, headers: cols.slice(0, 24), rowCount: rows.length, kind: kind === 'json' ? 'json' : 'html', path: candidateStructure(e).path });
      if (NARRATIVE.includes(resource)) {
        const ex = narrativeExcerpt(rows, identityValues(parents));
        if (ex) payload.excerpt = ex;
      }
      let v = null;
      try { v = await brain.verify(payload); } catch { v = null; }
      const last = trace.tried[trace.tried.length - 1];
      if (v && typeof v.ok === 'boolean') { trace.brain = true; trace.model = trace.model || v.model || null; last.gemini = v.ok ? 'ok' : 'rejected'; }
      if (v && v.ok === false && Number(v.confidence) >= 0.7) continue;
    }
    hits.push({ e, resp, kind, o, rows, role: r.role === 'shell' ? 'data' : r.role });
  }
  const hit = hits.slice().sort((a, b) => specificity(b, shown.length) - specificity(a, shown.length))[0] || null;
  if (!hit) {
    /* DIRECT ENTITY CHAINING. The report can render off-screen (GHIS lab result into a print frame):
     * standard cell overlap then finds nothing, but the call is still the row's own. When proving a
     * detail view (labs-detail, radiology-detail), a candidate whose parameters trace to parent row
     * fields (Render_ID from labs.ServiceRenderId, Episode_Id from episode_id) and whose replay
     * answers rows is accepted directly, without requiring DOM matching. */
    if (view.detailOf && parents.length) {
      for (const e of entries.slice().reverse()) {
        const p = paramsOf(e, parents);
        if (!chained(p)) continue;
        const resp = await evalJson(client, PROVE_SOURCES.exec(e.seq), null);
        const kind = responseKind(resp);
        if (kind === 'login') return done('signed-out');
        if (kind !== 'json' && kind !== 'html') continue;
        const rows = rowsForChain(resp.text, resp.contentType);
        if (!rows.length) continue;
        trace.tried.push({ method: e.method, path: candidateStructure(e).path.replace(/\d{3,}/g, '#'), role: 'data', kind, hits: 0, ratio: 0, chained: true });
        const [red] = redactEndpoints([{ method: e.method, url: e.url, bodyKeys: candidateStructure(e).bodyKeys, requestKind: /json/i.test(e.reqCt) ? 'json' : (e.body ? 'form' : undefined), xhr: e.xhr }], e.url);
        if (!red) continue;
        view.endpoints = [Object.assign(red, { role: 'data', params: safeParams(p), proof: { kind, hits: 0, cells: 0, overlap: 0, rows: rows.length, chained: true } })];
        view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: 0, hits: 0, cells: 0, kind, population: rows.length, chained: true }, trace.model ? { model: trace.model } : {});
        return { proven: { label: view.resourceHint, rows }, trace };
      }
    }
    return done('unproven');
  }

  /* VERIFY THE POPULATION, NOT JUST THE SCREEN. The screen can be a filtered view of the ward, so the
   * request that matches it can still be a subset. The same call with its untraceable filters emptied
   * is replayed in the doctor's session; when it answers with MORE rows, the same kind, and still
   * carries the screen, THAT is the request saved (owner, 2026-09-16). */
  /* THE WARD LIST, AND NOTHING ELSE. The whole population is the goal for the ward list alone. For a
   * patient's labs, medications or radiology, MORE rows is a red flag, not a win: it means the request
   * stopped being about this patient. `unmapped` cannot tell an untraceable identifier from a filter
   * (reviewer reproduction, 2026-09-16), so resource scope is the guard that actually holds. */
  if (String(view.resourceHint || '') === 'worklist') {
    const wide = widenRequest(hit.e, paramsOf(hit.e, parents));
    if (wide) {
      const resp2 = await evalJson(client, PROVE_SOURCES.execRequest({ method: hit.e.method, url: wide.url, body: wide.body, reqCt: hit.e.reqCt, xhr: hit.e.xhr }), null);
      const kind2 = responseKind(resp2);
      if (resp2 && kind2 !== 'login' && kind2 !== 'empty') {
        const rows2 = rowsForChain(resp2.text, resp2.contentType);
        const o2 = overlapOf(cells, resp2.text, resp2.contentType);
        trace.tried.push({ method: hit.e.method, path: candidateStructure(hit.e).path.replace(/\d{3,}/g, '#'), role: 'data', kind: kind2, hits: o2.hits, ratio: o2.ratio, widened: true });
        if (kind2 === hit.kind && rows2.length > hit.rows.length && accepted(o2)) {
          hit.e = Object.assign({}, hit.e, { url: wide.url, body: wide.body });
          hit.resp = resp2;
          hit.rows = rows2;
          hit.o = o2;
        }
      }
    }
  }

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
  const dataRows = rowsForChain(hit.resp.text, hit.resp.contentType);
  const dataEp = endpointOf(hit.e, 'data', { kind: hit.kind, hits: hit.o.hits, cells: hit.o.cells, overlap: hit.o.ratio, rows: dataRows.length });
  if (!dataEp) return done('unproven');
  eps.push(dataEp);
  view.endpoints = eps.slice(-8);
  // LEARN the columns too: which response field the screen shows under each header, by value.
  const columns = learnColumns(view.headers, shown, dataRows);
  if (Object.keys(columns).length) view.columns = columns; else delete view.columns;
  view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: hit.o.ratio, hits: hit.o.hits, cells: hit.o.cells, kind: hit.kind, population: dataRows.length }, trace.model ? { model: trace.model } : {});
  return { proven: { label: view.resourceHint, rows: dataRows }, trace };
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
      // Several proven lists of one kind (the doctor's own list and the ward-wide list): a field is
      // traced against all of their rows.
      if (out.proven) {
        const prev = rowsBy.get(view.resourceHint);
        rowsBy.set(view.resourceHint, prev ? { label: prev.label, rows: prev.rows.concat(out.proven.rows).slice(0, 3000) } : out.proven);
      }
      trace.push(Object.assign({ resource: view.resourceHint }, view.proof || {}, { attempts: out.trace.tried }));
      return view.proof || null;
    },
  };
}
