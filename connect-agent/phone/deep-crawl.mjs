// connect-agent/phone/deep-crawl.mjs — aggressive READ-ONLY crawler: worklist -> first patient record
// -> every clinical sub-view. Captures TABLE / REPORT-BLOCK STRUCTURE ONLY (never patient values) as
// `observedViews` for connect-agent/manifest/infer-html.mjs. See connect-agent/phone/CONTRACT.md for the
// six-method client contract and connect-agent/phone/explore.mjs for the page-realm-function-as-string
// pattern this file reuses (PROBE_SOURCE: a real function, syntax-checked by Node, String()'d for evaluate()).
//
// Design: the browser-realm functions below (CRAWL_*) only WALK THE DOM and return raw, PHI-free facts
// (table id/class, <th> header text, per-row onclick attribute, click targets by index, label names and
// positional selectors of a label/value report block). They never compute a table selector or redact an
// onclick — that logic lives in `buildTableView` / `buildBlockView`, plain Node-side JS, so it is
// unit-testable without a browser and has one implementation, not two.
//
// Exploration is exhaustive, not keyword-gated: under the patient record every tab, button, accordion
// header, section header and menu item is clicked once (dedup by redacted label), clinical keywords only
// ORDER the walk. A read-only SKIP list keeps the crawler off anything that writes, prints, sends or
// signs out. A click that reveals neither a data table nor a report block yields no view.
//
// Panel attribution (accordion / tab SPAs): before a sub-view control is clicked, CRAWL_ARM_OBSERVER
// installs a page-realm MutationObserver that records every element subtree the click adds or
// re-styles, plus a visibility snapshot of every table. CRAWL_RAW_TABLE then prefers a table that is
// inside a recorded (changed) subtree, or newly added, or newly visible, over a lingering table from an
// earlier view. With no observer armed (the worklist) it degrades to the old global best-table pick.
// CRAWL_RAW_BLOCK reads the same changed set for label/value report blocks (radiology report, discharge
// summary, visit history) that render as label/value pairs rather than headed tables.
//
// Live-device facts this is hardened for (Pixel + GHIS probe): a LOCKED / backgrounded WebView reports
// zero client rects for EVERY table, so visibility is only a signal when the page has layout at all; an
// EXPIRED session leaves a dead shell (tiny text, layout tables under #patient_details_table plus a
// datepicker, no data table) whose digit-bearing layout rows must never pass for a patient row. The
// crawl reports these as stopReason 'login-required' / 'session-expired-or-shell' instead of silently
// producing zero views. Ids that embed a date or a visit number (`#hospital_accordion_<date>_<visit>`)
// are UNSTABLE and never used as selector anchors, and never leave the page.
const CAPS_DEFAULT = { maxViews: 40, maxClicks: 60, maxMs: 240000, waitMs: 1500 };
// A page with no <th>+row data table and less text than this is a dead shell, not a worklist.
const SHELL_TEXT_MAX = 600;

// ponytail: flat keyword list, no NLP/fuzzy matching — good enough for the GHIS-style nav labels this
// targets; widen the list (or move to a config) if a hospital's labels don't match.
const CLINICAL_KEYWORDS_SRC =
  'medic|drug|\\blabs?\\b|laborator|investigat|result|radiolog|imaging|x.?ray|scan|history|discharge|summary|' +
  'demographic|patient.?details|patient.?profile|profile|encounter|visit|\\bnote|report|diagnos|record';

// Never click anything that could write, print, send, sign out or leave the module. Matched against the
// control's visible label (case-insensitive). Read-only is the whole contract of this crawler.
const SKIP_SRC =
  'log.?out|sign.?out|log.?off|delete|remove|\\bsave|submit|update|\\bedit|\\badd\\b|\\bnew\\b|create|' +
  'order|prescri|upload|attach|send|\\bsms|whatsapp|mail|print|export|download|cancel|\\bclose|\\bback\\b|' +
  '\\bhome\\b|refresh|reload|\\bapps?\\b|switch|password|settings|transfer|admit|approve|reject|confirm|' +
  '\\bpay|bill|discharge\\s+(the\\s+)?patient|clear|reset|select\\s+all|verify|sign\\b|finali[sz]e|complete';

const HINT_RULES = [
  /* Indian hospital EMRs rarely say "medications": GHIS and its peers label the same chart
   * "Treatment chart", "Rx", "Prescription", "Pharmacy" or "MAR". Matching only medic|drug is why a
   * crawl that had already opened the chart still stopped to ask the doctor where medicines live
   * (seen on GHIS 2026-09-12). Order matters: this rule sits above labs so "drug sensitivity" does
   * not win the labs rule. */
  [/medic|drug|prescri|\brx\b|treatment.?(chart|sheet)|pharmac|\bmar\b|dosage|indent/i, 'medications'],
  [/\bnotes?\b|assessment|case.?sheet|progress|clinical/i, 'notes'],
  [/\blabs?\b|laborator|investigat|result/i, 'labs'],
  [/radiolog|imaging|x.?ray|scan/i, 'radiology'],
  [/history/i, 'history'],
  [/discharge|summary/i, 'discharge'],
  [/demographic|patient.?details|profile/i, 'patient'],
];

// What a captured view's own labels say it is. Used when the control's label is uninformative ('unknown')
// or a container ('Patient profile' holds radiology, discharge and history sections).
const HEADER_HINT_RULES = [
  [/impression|finding|study|modality|radiolog|imaging/i, 'radiology'],
  [/discharge|summary/i, 'discharge'],
  [/\bnotes?\b|assessment|complaint|diagnos/i, 'notes'],
  [/drug|medic|dosage|frequency|route/i, 'medications'],
  [/test|result|unit|range/i, 'labs'],
  [/uhid|mrn|gender|sex|\bage\b|patient.?name/i, 'patient'],
  [/visit|encounter|admission|history/i, 'history'],
];

export function hintFromHeaders(headers) {
  const text = (Array.isArray(headers) ? headers : []).join(' | ');
  for (const [re, hint] of HEADER_HINT_RULES) if (re.test(text)) return hint;
  return 'unknown';
}

/** The canonical set the crawl tries to cover; index.mjs asks the doctor for whatever is missing. */
export const TARGET_HINTS = Object.freeze(['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history']);

export function resourceHintFor(label) {
  for (const [re, hint] of HINT_RULES) if (re.test(label)) return hint;
  return 'unknown';
}

const GENERIC_CLASS = /^(table|table-bordered|table-striped|table-hover|table-sm|table-condensed|table-responsive|datatable|row|col(-\w+)*|container(-fluid)?|panel|panel-body|panel-collapse|collapse|in|show|active|tab-pane|tab-content|card|card-body|content|wrapper)$/i;
// Anchors go into a CSS selector verbatim; only plain identifier chars are accepted (see html.mjs IDENT).
const SAFE_IDENT = /^[A-Za-z][\w-]*$/;
// An id/class carrying a run of 3+ digits embeds a date, visit or record number: it changes per patient
// or per day and must never anchor a selector (the GHIS `#hospital_accordion_<date>_<visit>` defect).
const UNSTABLE = /\d{3,}/;
const stableIdent = (s) => !!s && SAFE_IDENT.test(s) && !UNSTABLE.test(s);
const MAX_SELECTOR = 200;
const STATIC_ASSET = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json)(\?|$)/i;
// Request-body FIELD NAMES (never values) carried alongside an endpoint, same PHI posture as the
// query-key/path redaction above: an identifier-shaped or email-shaped key never leaves the phone.
const BODY_KEY_HOSTILE = /\d{3,}|@/;
const REQUEST_KINDS = new Set(['form', 'json', 'multipart', 'other']);
export const CREDENTIAL_KEY = /passw|pwd|otp|\bpin\b|secret|captcha/i;
/* A MODE SWITCH IS NOT PATIENT DATA. GHIS asks for its ward list with Type=IPWorkList; drop that value
 * and the replayed call returns nothing. Only keys that name a mode (type, mode, view, tab, action,
 * list, kind, category, status, flag) keep their value, and only a short run of letters with no digit,
 * space or @: never an id, a date, a phone or a name typed into a search box. */
// Query keys may start with an underscore (ASP.NET: __RequestVerificationToken); still no digits runs are checked by callers.
const QUERY_KEY = /^[A-Za-z_][\w-]{0,59}$/;
const CONSTANT_KEY = /^(type|mode|view|tab|action|list|listtype|kind|category|status|flag|module|screen|page_type)$/i;
const CONSTANT_VALUE = /^[A-Za-z_]{1,32}$/;
export function keyWithConstant(k, v) {
  return CONSTANT_KEY.test(k) && CONSTANT_VALUE.test(String(v || '')) ? k + '=' + v : k;
}
export function stripConstants(path) {
  return String(path || '').replace(/=[A-Za-z_]{1,32}(?=&|$)/g, '');
}
function sanitizeEndpointBodyKeys(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const k of raw) {
    if (typeof k !== 'string' || !k || k.length > 60 || BODY_KEY_HOSTILE.test(k)) continue;
    out.push(k);
    if (out.length >= 40) break;
  }
  return out;
}

function distinctClasses(cls) {
  return String(cls || '').split(/\s+/).filter((c) => c && stableIdent(c) && !GENERIC_CLASS.test(c));
}

/**
 * buildTableView(raw, resourceHint, pathTemplate) -> observedView
 * `raw` = { id, class, headers:[string], rows:[{isHeader, onclick}], container?:{id,class}, tableNth? }
 * | null, from CRAWL_RAW_TABLE. Pure and PHI-free by construction: `raw` never carries cell text, only
 * header labels + id/class + an onclick ATTRIBUTE VALUE (redacted to its call shape below, arguments
 * discarded). `container` is the nearest ancestor with an id/class; `tableNth` is the table's 1-based
 * position among its parent's <table> children when there are several (sibling header/data tables).
 */
export function buildTableView(raw, resourceHint, pathTemplate) {
  if (!raw) return { resourceHint, pathTemplate, method: 'GET', singleRecord: true };

  const classes = distinctClasses(raw.class);
  const container = raw.container || {};
  const cClasses = distinctClasses(container.class);
  const nth = Number.isInteger(raw.tableNth) && raw.tableNth > 1 ? `:nth-of-type(${raw.tableNth})` : '';
  const tableSel = `table${classes.length ? '.' + classes[0] : ''}${nth}`;
  let rowsSelector;
  let confidence;
  if (stableIdent(raw.id)) { rowsSelector = `#${raw.id} tbody tr`; confidence = 'high'; }
  else if (stableIdent(container.id)) { rowsSelector = `#${container.id} ${tableSel} tbody tr`; confidence = 'high'; }
  else if (classes.length) { rowsSelector = `${tableSel} tbody tr`; confidence = 'medium'; }
  else if (cClasses.length) { rowsSelector = `.${cClasses[0]} ${tableSel} tbody tr`; confidence = 'medium'; }
  else { rowsSelector = `${tableSel} tbody tr`; confidence = 'low'; }

  const headers = (raw.headers || []).filter(Boolean).slice(0, 24).map((h) => String(h).slice(0, 60));
  const dataRows = (raw.rows || []).filter((r) => !r.isHeader);

  let onclickTemplate = null;
  for (const row of dataRows) {
    if (!row.onclick) continue;
    const m = /^\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(row.onclick);
    if (!m) continue;
    const argsStr = m[2].trim();
    const argCount = argsStr ? argsStr.split(',').length : 0;
    onclickTemplate = `${m[1]}(${new Array(argCount).fill('#').join(',')})`;
    break;
  }

  const view = { resourceHint, pathTemplate, method: 'GET', rowsSelector, headers, singleRecord: dataRows.length < 1 };
  if (onclickTemplate) view.onclickTemplate = onclickTemplate;
  if (confidence === 'low') view.confidence = 'low';
  return view;
}

/**
 * buildBlockView(raw, resourceHint, pathTemplate) -> observedView | null
 * `raw` = { rootSelector, labels:[string], selectors:[string], repeated:boolean } from CRAWL_RAW_BLOCK:
 * a label/value report block (radiology report, discharge summary, visit history). `headers` carry the
 * label names (so infer-html classifies them like column headers) and `cellSelectors[i]` is the value
 * element's positional selector relative to `rowsSelector`. Values never leave the page.
 */
export function buildBlockView(raw, resourceHint, pathTemplate) {
  if (!raw || typeof raw.rootSelector !== 'string' || !raw.rootSelector || raw.rootSelector.length > MAX_SELECTOR) return null;
  if (UNSTABLE.test(raw.rootSelector.replace(/:nth-of-type\(\d+\)/g, ''))) return null;
  const headers = [];
  const cellSelectors = [];
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const selectors = Array.isArray(raw.selectors) ? raw.selectors : [];
  for (let i = 0; i < labels.length && headers.length < 24; i += 1) {
    const label = String(labels[i] || '').replace(/:\s*$/, '').trim().slice(0, 60);
    const sel = selectors[i];
    if (!label || typeof sel !== 'string' || !sel || sel.length > MAX_SELECTOR) continue;
    headers.push(label);
    cellSelectors.push(sel);
  }
  if (headers.length < 2) return null;
  return { resourceHint, pathTemplate, method: 'GET', rowsSelector: raw.rootSelector, headers, cellSelectors, singleRecord: !raw.repeated, block: true };
}

// Build a URL for a request-log entry: the native log (Android drainRequests) carries `.url`; an
// in-page observer event carries `.path` + `.origin` only (no query string - queryKeys is separate).
function requestUrlOf(r) {
  if (typeof r.url === 'string') return r.url;
  if (typeof r.path === 'string' && typeof r.origin === 'string') {
    try {
      const u = new URL(r.path, r.origin);
      if (Array.isArray(r.queryKeys)) for (const k of r.queryKeys) { if (typeof k === 'string') u.searchParams.set(k, ''); }
      return u.toString();
    } catch { return null; }
  }
  return null;
}

/**
 * redactEndpoints(requests, pageUrl) -> [{ method, path, bodyKeys?, requestKind?, xhr?, contentType? }]
 * : same-origin, non-asset requests the last click triggered, with query VALUES dropped (keys kept) and
 * digit runs of 3+ replaced by `#` so no patient/visit identifier leaves the phone. Capped at 8.
 * `requests` entries may be either the native request log's `{ method, url }` shape, or an in-page
 * observer event's `{ method, path, origin, bodyKeys, requestKind, xhr, contentType }` shape - the
 * latter's extra fields are sanitized and passed through onto the output entry when present.
 */
export function redactEndpoints(requests, pageUrl) {
  let origin = null;
  try { origin = new URL(pageUrl).origin; } catch { /* no page url: keep nothing */ }
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || typeof r !== 'object') continue;
    const rawUrl = requestUrlOf(r);
    if (typeof rawUrl !== 'string') continue;
    let u;
    try { u = new URL(rawUrl); } catch { continue; }
    if (!origin || u.origin !== origin || STATIC_ASSET.test(u.pathname)) continue;
    const keys = [...u.searchParams.keys()].filter((k) => QUERY_KEY.test(k)).slice(0, 12);
    const path = u.pathname.replace(/\d{3,}/g, '#') + (keys.length ? '?' + keys.map((k) => keyWithConstant(k, u.searchParams.get(k))).join('&') : '');
    const method = String(r.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const key = method + ' ' + path;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { method, path: path.slice(0, 512) };
    const bodyKeys = sanitizeEndpointBodyKeys(r.bodyKeys);
    // A request that carried a credential is a sign-in, never data: it is not an endpoint at all.
    if (bodyKeys.some((k) => CREDENTIAL_KEY.test(k))) continue;
    if (bodyKeys.length) entry.bodyKeys = bodyKeys;
    if (REQUEST_KINDS.has(r.requestKind)) entry.requestKind = r.requestKind;
    if (r.xhr) entry.xhr = true;
    if (typeof r.contentType === 'string' && r.contentType) entry.contentType = r.contentType.slice(0, 60);
    out.push(entry);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * mergeEndpointDetails(endpoints, observerEvents) -> endpoints, each augmented with
 * bodyKeys/requestKind/xhr/contentType from the matching in-page observer event (same method and the
 * same redacted path, computed the same way redactEndpoints computes it), when one drained during the
 * same click. Endpoints with no match are returned unchanged.
 */
export function mergeEndpointDetails(endpoints, observerEvents) {
  if (!Array.isArray(endpoints) || !endpoints.length || !Array.isArray(observerEvents) || !observerEvents.length) {
    return Array.isArray(endpoints) ? endpoints : [];
  }
  const byKey = new Map();
  for (const e of observerEvents) {
    if (!e || typeof e.method !== 'string' || typeof e.path !== 'string') continue;
    const method = e.method.toUpperCase() === 'POST' ? 'POST' : 'GET';
    const keys = Array.isArray(e.queryKeys) ? e.queryKeys.filter((k) => QUERY_KEY.test(k)).slice(0, 12) : [];
    const path = (e.path.replace(/\d{3,}/g, '#') + (keys.length ? '?' + keys.join('&') : '')).slice(0, 512);
    const key = `${method} ${path}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return endpoints.map((ep) => {
    if (!ep || typeof ep !== 'object') return ep;
    const match = byKey.get(`${ep.method} ${stripConstants(ep.path)}`);
    if (!match) return ep;
    const out = { ...ep };
    const bodyKeys = sanitizeEndpointBodyKeys(match.bodyKeys);
    if (bodyKeys.length) out.bodyKeys = bodyKeys;
    if (REQUEST_KINDS.has(match.requestKind)) out.requestKind = match.requestKind;
    if (match.xhr) out.xhr = true;
    if (typeof match.contentType === 'string' && match.contentType) out.contentType = match.contentType.slice(0, 60);
    return out;
  });
}

// --- browser-realm functions (String()'d below; must not close over anything from this module) -----

// Arms a MutationObserver on the document plus a visibility snapshot of every table, so the capture
// after the next click can tell which subtree the click populated. Everything stays in the page realm.
function CRAWL_ARM_OBSERVER() {
  var prev = window.__smdCrawlObs;
  if (prev && prev.mo) prev.mo.disconnect();
  var state = { changed: [], tables: [], mo: null };
  var all = document.querySelectorAll('table');
  for (var i = 0; i < all.length; i++) {
    state.tables.push({ el: all[i], visible: all[i].getClientRects && all[i].getClientRects().length > 0 });
  }
  if (typeof MutationObserver === 'function') {
    state.mo = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var rec = records[r];
        if (rec.type === 'childList') {
          for (var a = 0; a < rec.addedNodes.length; a++) {
            var n = rec.addedNodes[a];
            var el = n.nodeType === 1 ? n : (rec.target && rec.target.nodeType === 1 ? rec.target : null);
            if (el && state.changed[state.changed.length - 1] !== el) state.changed.push(el);
          }
        } else if (rec.type === 'attributes' && rec.target && rec.target.nodeType === 1) {
          if (state.changed[state.changed.length - 1] !== rec.target) state.changed.push(rec.target);
        }
      }
      if (state.changed.length > 20000) state.changed.length = 20000;
    });
    state.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded'] });
  }
  window.__smdCrawlObs = state;
  return 'ok';
}

// Picks the best data table on the current view and returns its raw facts, or null if there is none
// (a label/value detail page). Never returns <td> text (except a recovered LABEL row: short, digit-free
// cells that name columns). Prefers the table inside the subtree the last click changed. Leaves the
// observer state in place (disconnected) for CRAWL_RAW_BLOCK, which clears it.
function CRAWL_RAW_TABLE() {
  var obs = window.__smdCrawlObs || null;
  if (obs && obs.mo) { obs.mo.disconnect(); obs.mo = null; }
  var tables = document.querySelectorAll('table');
  var DAY = /^(su|mo|tu|we|th|fr|sa|sun|mon|tue|wed|thu|fri|sat)$/i;
  var FORM_HINT = /\b(entry|requisition)\b/i;
  var LABEL_WORD = /name|date|code|route|dos|qty|quant|freq|dur|test|result|unit|type|status|remark|desc|no\b|s\.?no|sl\b|#|time|value|range|method|dept|ward|bed|age|sex|gender|doctor|drug|medic|diagnos|advice|report|title|subject|category|notes?\b|comment/i;
  var UNSTABLE = /\d{3,}/;

  function isVisible(t) { return !!(t.getClientRects && t.getClientRects().length); }
  function thLabels(root, skip) {
    var out = [];
    var ths = root.querySelectorAll('th');
    for (var h = 0; h < ths.length; h++) {
      if (skip && skip.contains(ths[h])) continue;
      var txt = (ths[h].textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) out.push(txt);
    }
    return out;
  }
  function tableRows(t) {
    var rows = t.querySelectorAll('tbody tr');
    return rows.length ? rows : t.querySelectorAll('tr');
  }
  function isWriteForm(t) {
    var cls = (t.getAttribute('class') || '') + ' ' + (t.getAttribute('id') || '');
    if (FORM_HINT.test(cls)) return true;
    var controls = t.querySelectorAll('select,textarea,button,input:not([type=hidden])').length;
    if (!controls) return false;
    var tds = t.querySelectorAll('td').length;
    var rows = tableRows(t);
    var dataRows = 0;
    for (var b = 0; b < rows.length; b++) { if (rows[b].querySelectorAll('td').length >= 1) dataRows++; }
    return dataRows <= 2 || controls * 2 >= tds;
  }
  function isCalendar(t) {
    var cls = (t.getAttribute('class') || '') + ' ' + (t.getAttribute('id') || '');
    if (/datepicker|calendar/i.test(cls)) return true;
    var ths = t.querySelectorAll('th');
    var dayHeaders = 0;
    for (var d = 0; d < ths.length; d++) { if (DAY.test((ths[d].textContent || '').trim())) dayHeaders++; }
    return ths.length >= 3 && dayHeaders >= Math.ceil(ths.length / 2);
  }
  // A label/value GRID ("Diagnosis | X", "Admission date | Y"): no <th>, two cells per row, every first
  // cell a short digit-free label word. That is a report block (CRAWL_RAW_BLOCK), never a data table:
  // header recovery would otherwise take its first row's VALUE as a column header.
  function isLabelValueGrid(t) {
    if (t.querySelector('th')) return false;
    var rows = tableRows(t);
    if (rows.length < 2) return false;
    var hits = 0;
    for (var r = 0; r < rows.length; r++) {
      var tds = rows[r].children;
      if (tds.length !== 2) return false;
      var first = (tds[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!first || first.length > 40 || /\d/.test(first) || first.split(' ').length > 4) return false;
      if (LABEL_WORD.test(first)) hits++;
    }
    return hits * 2 >= rows.length;
  }
  // 1 = inside (or is) a subtree the last click added/re-styled, or newly added / newly visible.
  function changedBy(t) {
    if (!obs) return 0;
    for (var c = 0; c < obs.changed.length; c++) { if (obs.changed[c] === t || obs.changed[c].contains(t)) return 1; }
    for (var s = 0; s < obs.tables.length; s++) {
      if (obs.tables[s].el === t) return (!obs.tables[s].visible && isVisible(t)) ? 1 : 0;
    }
    return 1; // not in the pre-click snapshot: newly added
  }
  // Innermost recorded changed element containing the table, or the table's parent: the panel.
  function panelOf(t) {
    var best = t.parentElement || document.body;
    if (obs) {
      for (var c = 0; c < obs.changed.length; c++) {
        var el = obs.changed[c];
        if (el !== t && el.contains(t) && best.contains(el)) best = el;
      }
    }
    return best;
  }

  // A locked / backgrounded WebView lays out nothing: every table reports zero rects, so visibility
  // would only promote whichever table the tie-break favours. Use it as a signal only when some table
  // actually has layout.
  var anyVisible = false;
  for (var v = 0; v < tables.length && !anyVisible; v++) anyVisible = isVisible(tables[v]);

  var best = null, bestScore = -1, bestChanged = 0;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (isCalendar(t) || isWriteForm(t) || isLabelValueGrid(t)) continue;
    var rows = tableRows(t);
    var dataRows = 0;
    for (var b = 0; b < rows.length; b++) { if (rows[b].querySelectorAll('td').length >= 1) dataRows++; }
    // Changed-subtree, visibility, having data rows and header presence are score bonuses in that order,
    // not filters: some legacy EMRs render a real data table with no client rects or no <th> of its own,
    // and a header-only table (labels for a headerless sibling) must lose to the sibling with rows.
    var changed = changedBy(t);
    var score = changed * 1000000 + (anyVisible && isVisible(t) ? 100000 : 0) + (dataRows ? 10000 : 0) + (t.querySelectorAll('th').length ? 1000 : 0) + Math.min(dataRows, 999);
    if (score > bestScore) { bestScore = score; best = t; bestChanged = changed; }
  }
  // The click changed the page but no table lives in what changed: this view has no table (a narrative
  // or label/value panel). Returning a lingering table from an earlier panel would mis-map it. Without
  // layout (locked device) the recorded changes are unreliable, so fall back to the structural pick.
  if (best && obs && obs.changed.length && !bestChanged && anyVisible) best = null;
  if (!best) return JSON.stringify(null);

  var rows2 = tableRows(best);
  var rowInfos = [];
  for (var r = 0; r < rows2.length; r++) {
    rowInfos.push({ isHeader: rows2[r].querySelectorAll('th').length > 0, onclick: rows2[r].getAttribute('onclick') || null });
  }

  // Header recovery for a headerless data table: (a) <th> elsewhere in the panel (not in a write
  // form); (b) nearest preceding sibling table's <th>; (c) a first row of short, digit-free label <td>s.
  var headers = thLabels(best, null);
  var panel = panelOf(best);
  if (!headers.length) {
    // A <th> belongs to another DATA table (one with <td> rows) or a write form: not our labels.
    var otherTables = panel.querySelectorAll('table');
    var formTables = [];
    for (var o = 0; o < otherTables.length; o++) {
      if (otherTables[o] === best) continue;
      if (isWriteForm(otherTables[o]) || otherTables[o].querySelector('td')) formTables.push(otherTables[o]);
    }
    var panelThs = [];
    var ths = panel.querySelectorAll('th');
    for (var p = 0; p < ths.length; p++) {
      var th = ths[p];
      if (best.contains(th)) continue;
      var inForm = false;
      for (var o2 = 0; o2 < formTables.length; o2++) { if (formTables[o2].contains(th)) { inForm = true; break; } }
      if (inForm) continue;
      var txt = (th.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) panelThs.push(txt);
    }
    if (panelThs.length >= 2) headers = panelThs;
  }
  if (!headers.length) {
    for (var sib = best.previousElementSibling; sib; sib = sib.previousElementSibling) {
      var st = sib.tagName === 'TABLE' ? sib : sib.querySelector && sib.querySelector('table');
      if (!st) continue;
      var sibThs = thLabels(st, null);
      if (sibThs.length >= 2) { headers = sibThs; break; }
    }
  }
  if (!headers.length && rows2.length >= 2) {
    var first = rows2[0].querySelectorAll('td');
    var labels = [];
    var hit = 0;
    for (var f = 0; f < first.length; f++) {
      var lt = (first[f].textContent || '').replace(/\s+/g, ' ').trim();
      if (!lt || lt.length > 40 || /\d/.test(lt) || lt.split(' ').length > 3) { labels = []; break; }
      if (LABEL_WORD.test(lt)) hit++;
      labels.push(lt);
    }
    var second = rows2[1].querySelectorAll('td');
    var secondLabelLike = second.length > 0;
    for (var g = 0; g < second.length; g++) { if (/\d/.test(second[g].textContent || '')) { secondLabelLike = false; break; } }
    if (labels.length >= 2 && hit >= 1 && !secondLabelLike) { headers = labels; rowInfos[0].isHeader = true; }
  }

  // Selector anchors: nearest ancestor with a STABLE id (no date / visit number embedded; else a class),
  // and the table's position among its parent's <table> children when a sibling table (header table)
  // shares the parent. Unstable ids are skipped over, not returned.
  var container = { id: '', class: '' };
  for (var anc = best.parentElement; anc && anc !== document.body; anc = anc.parentElement) {
    if (anc.id && !UNSTABLE.test(anc.id)) { container = { id: anc.id, class: anc.getAttribute('class') || '' }; break; }
    if (!container.class && anc.getAttribute('class')) container.class = anc.getAttribute('class');
  }
  var tableNth = 0;
  var par = best.parentElement;
  if (par) {
    var kids = par.children, n = 0, tablesInParent = 0;
    for (var k = 0; k < kids.length; k++) { if (kids[k].tagName === 'TABLE') { tablesInParent++; if (kids[k] === best) n = tablesInParent; } }
    if (tablesInParent > 1) tableNth = n;
  }

  var ownId = best.getAttribute('id') || '';
  return JSON.stringify({ id: UNSTABLE.test(ownId) ? '' : ownId, class: best.getAttribute('class') || '', headers: headers, rows: rowInfos, container: container, tableNth: tableNth });
}

// Label/value REPORT BLOCK capture for a view with no data table (radiology report, discharge summary,
// visit history: "Study: ...", "Reported on: ...", "Impression: ..."). Reads the subtrees the last click
// changed, finds label elements (short, digit-free, label-shaped text) whose next cell/sibling holds a
// value, and returns ONLY the label names plus a positional selector (tag:nth-of-type chain, descendant
// combinators, no tbody so the server-side parser matches raw HTML) for each value element relative to
// the block root. Value text never leaves the page. Repeated sibling blocks of identical shape (several
// reports) are reported as `repeated` with the selectors relative to one block.
function CRAWL_RAW_BLOCK() {
  var obs = window.__smdCrawlObs || null;
  window.__smdCrawlObs = null;
  if (!obs || !obs.changed.length) return JSON.stringify(null);
  var LABEL_RE = /patient|name|date|age|sex|gender|uhid|mrn|\bid\b|\bno\b|number|ward|bed|doctor|consultant|department|dept|diagnos|study|modality|examination|exam|procedure|report|impression|finding|conclusion|advice|summary|history|complaint|allerg|medic|drug|dose|route|frequency|duration|result|unit|range|test|type|status|admission|admitted|discharge|visit|reported|performed|remark|comment|note|address|phone|blood|weight|height|bmi|\bbp\b|pulse|temp|spo2|reason|treatment|course|condition|follow|instruction|investigation|radiolog|imaging|clinical|referr|title|subject|description|indication|technique|comparison|site|side|region|contrast|hospital|unit|episode|outcome|plan|prognosis|specialty|category/i;
  var UNSTABLE = /\d{3,}/;
  var SAFE = /^[A-Za-z][\w-]*$/;

  function isVisible(e) { return !!(e.getClientRects && e.getClientRects().length); }
  function inChanged(e) {
    for (var c = 0; c < obs.changed.length; c++) { if (obs.changed[c] === e || obs.changed[c].contains(e)) return true; }
    return false;
  }
  var INLINE = /^(B|STRONG|LABEL|SPAN|I|EM|U|FONT)$/;
  // Direct text nodes only: "<p><b>Study:</b> CT BRAIN</p>" gives the <b> "Study:" and the <p> "CT BRAIN".
  function ownText(e) {
    var s = '';
    for (var n = e.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) s += n.nodeValue; }
    return s.replace(/\s+/g, ' ').trim();
  }
  // A label ends with a colon, or its FIRST or LAST word is a label word (a value like "Right side" or
  // "General Surgery" is not; "Admission date", "Reported on", "Blood group" are).
  function isLabelText(t) {
    if (!t || t.length < 2 || t.length > 40 || /\d/.test(t)) return false;
    if (/:\s*$/.test(t)) return true;
    var words = t.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
    return words.length <= 4 && (LABEL_RE.test(words[0]) || LABEL_RE.test(words[words.length - 1]));
  }
  function hasText(e) { return !!(e && (e.textContent || '').replace(/\s+/g, ' ').trim()); }
  function labelLike(e) { return e.children.length === 1 && INLINE.test(e.children[0].tagName) && !ownText(e) ? isLabelText(ownText(e.children[0])) : isLabelText(ownText(e)); }
  function valueOf(e, depth) {
    depth = depth || 0;
    var tag = e.tagName;
    var nx = e.nextElementSibling;
    if (tag === 'TD' || tag === 'TH') {
      if (nx && (nx.tagName === 'TD' || nx.tagName === 'TH') && hasText(nx) && !nx.querySelector('table') && !labelLike(nx)) return nx;
      return null;
    }
    if (tag === 'DT') return nx && nx.tagName === 'DD' && hasText(nx) ? nx : null;
    if (nx && hasText(nx) && !nx.querySelector('table') && !/^(SCRIPT|STYLE|INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(nx.tagName) && !labelLike(nx)) return nx;
    var p = e.parentElement;
    if (p && INLINE.test(tag)) {
      // "<b>Label:</b> value" inline: the parent's own text is the value (the label text rides along).
      if (ownText(p)) return p;
      // "<td><b>Label</b></td><td>value</td>": the wrapper's neighbour holds the value.
      if (!nx && p.children.length === 1 && depth < 3) return valueOf(p, depth + 1);
    }
    return null;
  }
  function nth(e) {
    var k = 0;
    for (var s = e; s; s = s.previousElementSibling) { if (s.tagName === e.tagName) k++; }
    return k;
  }
  function stepsBetween(anc, e) {
    var parts = [];
    for (var x = e; x && x !== anc; x = x.parentElement) {
      if (x.tagName === 'TBODY' || x.tagName === 'THEAD') continue;
      parts.unshift(x.tagName.toLowerCase() + ':nth-of-type(' + nth(x) + ')');
    }
    return parts.join(' ');
  }
  function rootSelector(root) {
    if (root.id && SAFE.test(root.id) && !UNSTABLE.test(root.id)) return '#' + root.id;
    for (var a = root.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.id && SAFE.test(a.id) && !UNSTABLE.test(a.id)) return '#' + a.id + ' ' + stepsBetween(a, root);
    }
    return 'body ' + stepsBetween(document.body, root);
  }

  var all = document.querySelectorAll('td,th,label,dt,b,strong,span,div,p,li,h1,h2,h3,h4,h5,h6');
  var anyVisible = false;
  for (var v = 0; v < all.length && !anyVisible; v++) anyVisible = isVisible(all[v]);
  var pairs = [];
  var seenValues = [];
  for (var i = 0; i < all.length && pairs.length < 60; i++) {
    var e = all[i];
    if (anyVisible && !isVisible(e)) continue;
    if (!inChanged(e)) continue;
    var t = ownText(e);
    if (!isLabelText(t)) continue;
    var val = valueOf(e, 0);
    if (!val || seenValues.indexOf(val) >= 0) continue;
    seenValues.push(val);
    pairs.push({ label: t, el: e, val: val });
  }
  if (pairs.length < 2) return JSON.stringify(null);

  // The click may have re-styled a big wrapper that still holds earlier panels' label/value grids. Take
  // the SMALLEST changed element holding >= 2 pairs (the freshly loaded panel), keep only its pairs, and
  // root the block at their lowest common ancestor.
  var scope = null, scopeSize = Infinity, tried = 0;
  for (var ci = 0; ci < obs.changed.length && tried < 2000; ci++) {
    var cand = obs.changed[ci];
    if (cand === document.documentElement || cand === document.body || obs.changed.indexOf(cand) !== ci) continue;
    tried++;
    var inside = 0;
    for (var pi = 0; pi < pairs.length; pi++) { if (cand.contains(pairs[pi].val)) inside++; }
    if (inside < 2) continue;
    var size = cand.getElementsByTagName('*').length;
    if (size < scopeSize) { scopeSize = size; scope = cand; }
  }
  if (!scope) return JSON.stringify(null);
  pairs = pairs.filter(function (pr) { return scope.contains(pr.val); });
  var root = pairs[0].val;
  for (var q = 1; q < pairs.length; q++) { while (root && !root.contains(pairs[q].val)) root = root.parentElement; }
  if (!root || root === document.documentElement) root = document.body;
  var rootSel = rootSelector(root);

  // Repeated blocks: several same-shaped direct children of root each holding >= 2 pairs.
  var groups = {};
  for (var g = 0; g < root.children.length; g++) {
    var ch = root.children[g];
    var cnt = 0;
    for (var pp = 0; pp < pairs.length; pp++) { if (ch.contains(pairs[pp].val)) cnt++; }
    if (cnt < 2) continue;
    var cls = (ch.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && SAFE.test(c) && !UNSTABLE.test(c); })[0] || '';
    var key = ch.tagName.toLowerCase() + (cls ? '.' + cls : '');
    (groups[key] = groups[key] || []).push(ch);
  }
  var repeated = false, block = root, blockSel = rootSel;
  for (var k in groups) {
    if (groups[k].length >= 2) { repeated = true; block = groups[k][0]; blockSel = rootSel + ' > ' + k; break; }
  }

  var labels = [], selectors = [];
  for (var z = 0; z < pairs.length && labels.length < 24; z++) {
    if (!block.contains(pairs[z].val)) continue;
    var sel = pairs[z].val === block ? '' : stepsBetween(block, pairs[z].val);
    if (!sel || sel.length > 200) continue;
    labels.push(pairs[z].label.replace(/\d{3,}/g, '#').slice(0, 60));
    selectors.push(sel);
  }
  if (labels.length < 2 || blockSel.length > 200) return JSON.stringify(null);
  return JSON.stringify({ rootSelector: blockSel, labels: labels, selectors: selectors, repeated: repeated });
}

// PHI-free page state, read before the walk: only booleans and counts leave the page.
// dataTableCount = tables with a <th> and at least one <td> row, calendars excluded.
function CRAWL_PAGE_STATE() {
  var tables = document.querySelectorAll('table');
  var dataTableCount = 0, anyVisible = false;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getClientRects && t.getClientRects().length) anyVisible = true;
    if (/datepicker|calendar/i.test((t.getAttribute('class') || '') + ' ' + (t.getAttribute('id') || ''))) continue;
    if (t.querySelector('th') && t.querySelector('tr td')) dataTableCount++;
  }
  return JSON.stringify({
    textLen: ((document.body && document.body.innerText) || '').length,
    hasPasswordInput: !!document.querySelector('input[type=password]'),
    dataTableCount: dataTableCount,
    anyVisible: anyVisible,
  });
}

// Finds the first `<tr>` that looks like a patient row: >=2 `<td>`s, a redacted-id-shaped digit run in
// its text, AND a home in a DATA table (one with <th> cells, an onclick handler on the row or table, an
// id, or a non-generic class). Rows of bare layout tables (#patient_details_table's label/value grids)
// carry digits too and must not be "opened". A row with an onclick handler wins over one without.
// Returns its index within `document.querySelectorAll('tr')`, or null.
function CRAWL_FIND_PATIENT_ROW(genericClassSrc) {
  var GENERIC = new RegExp(genericClassSrc, 'i');
  var trs = document.querySelectorAll('tr');
  var fallback = null;
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    if (tr.querySelectorAll('td').length < 2) continue;
    if (!/\d{2,}/.test(tr.textContent || '')) continue;
    var t = tr.parentElement;
    while (t && t.tagName !== 'TABLE') t = t.parentElement;
    if (!t) continue;
    var cls = t.getAttribute('class') || '';
    if (/datepicker|calendar/i.test(cls + ' ' + (t.getAttribute('id') || ''))) continue;
    var handler = tr.hasAttribute('onclick') || t.hasAttribute('onclick') || typeof tr.onclick === 'function';
    var distinctive = !!t.id;
    var classes = cls.split(/\s+/);
    for (var c = 0; c < classes.length && !distinctive; c++) distinctive = !!classes[c] && !GENERIC.test(classes[c]);
    if (!t.querySelector('th') && !handler && !distinctive) continue;
    if (handler) return JSON.stringify({ index: i });
    if (fallback === null) fallback = i;
  }
  return JSON.stringify(fallback === null ? null : { index: fallback });
}

function CRAWL_CLICK_ROW(idx) {
  var trs = document.querySelectorAll('tr');
  var el = trs[idx];
  if (!el) return 'no-el';
  el.click();
  return 'ok';
}

// Every clickable control on the page: links, buttons, tabs, accordion / section headers, menu items
// and anything with an onclick handler (table rows/cells excluded). Returns { index, label, clinical }
// (index within `document.querySelectorAll(CONTROL_QUERY)`), label redacted (digit runs of 3+ -> `#`)
// and truncated. Skips: anything on the read-only SKIP list, anchors that navigate to another page
// without a handler, submit buttons, invisible controls (when the page has layout), long text (a
// paragraph with an onclick is content, not a control), and wrappers whose inner link carries the same
// label (clicking the wrapper would not fire the child's handler and the label dedup would then skip the
// child). `clinical` = the label or an on* handler matches the clinical keyword list; it only ORDERS the
// walk.
function CRAWL_FIND_CONTROLS(keywordSrc, skipSrc, query) {
  var KW = new RegExp(keywordSrc, 'i');
  var SKIP = new RegExp(skipSrc, 'i');
  var els = document.querySelectorAll(query);
  var anyVisible = false;
  for (var v = 0; v < els.length && !anyVisible; v++) anyVisible = !!(els[v].getClientRects && els[v].getClientRects().length);
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var tag = el.tagName;
    if (/^(TR|TD|TH|TABLE|TBODY|THEAD|INPUT|SELECT|TEXTAREA|OPTION|FORM|BODY|HTML)$/.test(tag)) continue;
    if (tag === 'BUTTON' && (el.getAttribute('type') || '').toLowerCase() === 'submit') continue;
    if (anyVisible && !(el.getClientRects && el.getClientRects().length)) continue;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) continue;
    if (SKIP.test(text)) continue;
    if (tag === 'A') {
      var href = el.getAttribute('href') || '';
      if (href && !/^(#|javascript:)/i.test(href) && !el.hasAttribute('onclick')) continue;
      if (el.getAttribute('target') === '_blank') continue;
    }
    var onAttrs = '';
    var attrs = el.attributes;
    if (attrs) {
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].name.indexOf('on') === 0) onAttrs += ' ' + attrs[a].value;
      }
    }
    if (/^(LI|DIV|SPAN|P|LABEL|H[1-6])$/.test(tag) && !onAttrs) {
      // A bare section/list element (no handler attribute) only counts as a control when it is marked
      // up as one (role / toggle / aria) or styled as one (pointer cursor) inside a nav, tab or
      // accordion structure, or is a pointer-styled heading (a jQuery-bound accordion header).
      var marked = el.hasAttribute('role') || el.hasAttribute('data-toggle') || el.hasAttribute('data-bs-toggle') || el.hasAttribute('aria-controls') || el.hasAttribute('aria-expanded');
      var pointer = false;
      try { pointer = window.getComputedStyle(el).cursor === 'pointer'; } catch (e) { /* detached */ }
      if (!marked && !pointer) continue;
      var inNav = el.closest && el.closest('nav,ul.nav,ul.tabs,[role=tablist],.accordion,.panel-heading,.card-header,.accordion-toggle,[class*=accordion],[class*=collaps],[class*=tab]');
      if (!marked && !inNav && !/^H[1-6]$/.test(tag)) continue;
    }
    var inner = el.querySelector('a,button,[onclick]');
    if (inner && (inner.textContent || '').replace(/\s+/g, ' ').trim() === text) continue;
    out.push({ index: i, label: text.replace(/\d{3,}/g, '#').slice(0, 120), clinical: KW.test(text) || KW.test(onAttrs) });
  }
  return JSON.stringify(out);
}

function CRAWL_CLICK_CONTROL(idx, query) {
  var els = document.querySelectorAll(query);
  var el = els[idx];
  if (!el) return 'no-el';
  el.click();
  return 'ok';
}

// Guided step: while the doctor taps their way to a screen, record what they tapped (tag, stable id /
// class, redacted label) into window.__smdGuidePath so the pattern can be replayed later. Values never
// recorded: only the control's own short label with digit runs replaced.
function CRAWL_ARM_GUIDE() {
  window.__smdGuidePath = [];
  if (window.__smdGuideOff) { try { window.__smdGuideOff(); } catch (e) { /* ignore */ } }
  var handler = function (ev) {
    var el = ev.target && ev.target.nodeType === 1 ? ev.target : null;
    if (!el) return;
    var ctl = el.closest ? (el.closest('a,button,li,[role=tab],[role=button],[onclick],h1,h2,h3,h4,h5,h6,td,th,tr') || el) : el;
    var id = ctl.id && /^[A-Za-z][\w-]*$/.test(ctl.id) && !/\d{3,}/.test(ctl.id) ? '#' + ctl.id : '';
    var cls = (ctl.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && /^[A-Za-z][\w-]*$/.test(c) && !/\d{3,}/.test(c); })[0] || '';
    var label = (ctl.textContent || '').replace(/\s+/g, ' ').trim().replace(/\d{3,}/g, '#').slice(0, 60);
    var entry = ctl.tagName.toLowerCase() + id + (cls ? '.' + cls : '') + (label ? ' "' + label + '"' : '');
    if (window.__smdGuidePath.length < 20) window.__smdGuidePath.push(entry);
  };
  document.addEventListener('click', handler, true);
  window.__smdGuideOff = function () { document.removeEventListener('click', handler, true); };
  return 'ok';
}

function CRAWL_GUIDE_PATH() {
  if (window.__smdGuideOff) { try { window.__smdGuideOff(); } catch (e) { /* ignore */ } }
  var p = window.__smdGuidePath || [];
  window.__smdGuidePath = null;
  return JSON.stringify(p.slice(0, 20));
}

const CONTROL_QUERY = 'a,button,li,div,span,p,label,h1,h2,h3,h4,h5,h6,[role=tab],[role=button],[data-toggle],[data-bs-toggle],[onclick]';
const ARM_OBSERVER_SRC = String(CRAWL_ARM_OBSERVER);
const RAW_TABLE_SRC = String(CRAWL_RAW_TABLE);
const RAW_BLOCK_SRC = String(CRAWL_RAW_BLOCK);
const PAGE_STATE_SRC = String(CRAWL_PAGE_STATE);
const FIND_PATIENT_ROW_SRC = String(CRAWL_FIND_PATIENT_ROW);
const CLICK_ROW_SRC = String(CRAWL_CLICK_ROW);

/* Click the first data row of a captured list (its first link when it has one, else the row itself)
 * so the call that opens a single report or result is observed. Page realm; returns what it did. */
function CRAWL_CLICK_FIRST_ROW(selector) {
  try {
    var rows = document.querySelectorAll(selector);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var tds = row.querySelectorAll ? row.querySelectorAll('td') : [];
      if (tds.length < 2) continue;
      var a = row.querySelector('a[href]:not([href^="#"]), a[onclick], button, [onclick]');
      if (a) { a.click(); return 'link'; }
      row.click();
      return 'row';
    }
    return 'none';
  } catch (e) { return 'e'; }
}
const CLICK_FIRST_ROW_SRC = String(CRAWL_CLICK_FIRST_ROW);
/** Lists whose single record is worth a look: the call behind one lab result or one radiology report. */
export const DETAIL_PARENTS = Object.freeze(['labs', 'radiology', 'history', 'discharge', 'notes']);
const FIND_CONTROLS_SRC = String(CRAWL_FIND_CONTROLS);
const CLICK_CONTROL_SRC = String(CRAWL_CLICK_CONTROL);
const ARM_GUIDE_SRC = String(CRAWL_ARM_GUIDE);
const GUIDE_PATH_SRC = String(CRAWL_GUIDE_PATH);

async function evalJson(client, expression, fallback) {
  const res = await client.evaluate({ expression });
  try { return JSON.parse(res?.result ?? 'null'); } catch { return fallback; }
}

/**
 * captureView({ client, resourceHint }) -> observedView | null
 * Reads the panel the last (armed) click populated: a data table first, else a label/value report block.
 * Attaches the same-origin endpoints the click triggered (Android drainRequests; redacted). Null when the
 * click revealed nothing. Also used for the guided step (index.mjs) after the doctor taps Done.
 */
/* A PAGE URL IS STRUCTURE ONLY ONCE ITS VALUES ARE GONE. GHIS opens a patient's labs at
 * /LabResults/Home?recordNo=<MRN>; stored as is, the adapter would carry a hospital number (seen in a
 * live adapter, 2026-09-13). Every query value that looks like an identifier becomes the {id}
 * placeholder the runtime fills with the patient it is reading. */
export function redactPageUrl(u) {
  if (!u) return u;
  try {
    const x = new URL(u);
    const keys = [...x.searchParams.keys()];
    for (const k of keys) {
      const v = x.searchParams.get(k) || '';
      if (/\d{3,}/.test(v) || /^[A-Za-z]{1,6}\d{2,}[A-Za-z0-9-]*$/.test(v)) x.searchParams.set(k, '{id}');
    }
    x.hash = '';
    return x.toString().replace(/%7Bid%7D/g, '{id}');
  } catch { return String(u).replace(/=([A-Za-z]{0,6}\d{3,}[A-Za-z0-9-]*)/g, '={id}'); }
}

export async function captureView({ client, resourceHint, blockOnly = false }) {
  const url = redactPageUrl((await client.currentUrl().catch(() => ({})))?.url || null);
  const raw = blockOnly ? null : await evalJson(client, `(${RAW_TABLE_SRC})()`, null);
  let view = raw ? buildTableView(raw, resourceHint, url) : null;
  const block = await evalJson(client, `(${RAW_BLOCK_SRC})()`, null);
  if (!view) view = buildBlockView(block, resourceHint, url);
  if (!view) return null;
  if (typeof client.drainRequests === 'function') {
    const drained = await client.drainRequests().catch(() => null);
    let endpoints = redactEndpoints(drained?.requests, url);
    // Optional: the in-page observer (connect-agent/discovery.mjs) drained separately from the native
    // log, so a phone plugin client without this method just gets the plain {method,path} endpoints.
    if (endpoints.length && typeof client.drainObserverEvents === 'function') {
      const observed = await client.drainObserverEvents().catch(() => null);
      if (observed && Array.isArray(observed.events) && observed.events.length) {
        endpoints = mergeEndpointDetails(endpoints, observed.events);
      }
    }
    if (endpoints.length) view.endpoints = endpoints;
  }
  return view;
}

/* WHAT MAY LEAVE THE PHONE FOR THE BRAIN: structure with every digit run of 3+ replaced and any
 * string carrying an @ dropped. The server refuses anything else (functions/_connect/agent/brain.js);
 * this keeps an honest phone from ever tripping that refusal. */
export function scrubForBrain(value) {
  if (typeof value === 'string') return value.indexOf('@') >= 0 ? '' : value.replace(/\d{3,}/g, '#').slice(0, 120);
  if (Array.isArray(value)) return value.map(scrubForBrain).filter((v) => v !== '').slice(0, 60);
  if (value && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = scrubForBrain(value[k]); return o; }
  return value;
}

function pathOnly(u) { try { return new URL(u).pathname; } catch { return String(u || '').split('?')[0]; } }

/**
 * enrichView(view, brain, { label, ask, keepHint }) -> the brain's classify answer or null.
 * Classifies an 'unknown' view (or checks it against `ask`), and maps its column headers to canonical
 * roles as `view.fieldHints`. Advisory: the deterministic rules already ran; a brain that is absent,
 * slow or wrong changes nothing but the hint. Never throws.
 */
export async function enrichView(view, brain, ctx = {}) {
  if (!view || !brain) return null;
  let verdict = null;
  const labels = ctx.label ? [ctx.label] : [];
  if (typeof brain.classify === 'function' && (ctx.ask || view.resourceHint === 'unknown' || !view.resourceHint)) {
    const payload = scrubForBrain({ path: pathOnly(view.pathTemplate), headers: view.headers || [], labels });
    if (ctx.ask) payload.ask = ctx.ask;
    try { verdict = await brain.classify(payload); } catch { verdict = null; }
    if (verdict && !ctx.keepHint && verdict.resource && verdict.resource !== 'none' && Number(verdict.confidence) >= 0.6 && TARGET_HINTS.includes(verdict.resource)) {
      view.resourceHint = verdict.resource;
    }
  }
  if (typeof brain.mapColumns === 'function' && Array.isArray(view.headers) && view.headers.length && TARGET_HINTS.includes(view.resourceHint)) {
    let m = null;
    try { m = await brain.mapColumns(scrubForBrain({ resource: view.resourceHint, headers: view.headers })); } catch { m = null; }
    const fields = m && m.fields && typeof m.fields === 'object' ? m.fields : null;
    if (fields) {
      const fh = {};
      for (const k of Object.keys(fields)) if (view.headers.includes(k) && typeof fields[k] === 'string') fh[k] = fields[k];
      if (Object.keys(fh).length) view.fieldHints = fh;
    }
  }
  return verdict;
}

export const GUIDE_SOURCES = Object.freeze({ arm: `(${ARM_OBSERVER_SRC})()`, armGuide: `(${ARM_GUIDE_SRC})()`, guidePath: `(${GUIDE_PATH_SRC})()` });

/**
 * deepCrawlClinical({ client, caps, onProgress, stopSignal }) -> { observedViews, trail, stopReason, found }
 * stopReason: 'login-required' | 'session-expired-or-shell' | 'no-patient-row' | 'no-candidate' |
 * 'max-views' | 'max-clicks' | 'time-cap' | 'stop-signal'. The first two mean the doctor must sign in
 * again (index.mjs / UI surface it). onProgress({ opening, found, looking, clicks }) fires before each
 * click; stopSignal() true ends the walk (wired to the plugin's native Stop).
 */
export async function deepCrawlClinical({ client, caps = {}, onProgress, stopSignal, brain = null } = {}) {
  if (!client) throw new Error('deepCrawlClinical requires a client');

  const maxViews = Math.min(Math.max(caps.maxViews ?? CAPS_DEFAULT.maxViews, 1), CAPS_DEFAULT.maxViews);
  const maxClicks = Math.min(Math.max(caps.maxClicks ?? CAPS_DEFAULT.maxClicks, 1), CAPS_DEFAULT.maxClicks);
  const maxMs = Math.min(Math.max(caps.maxMs ?? CAPS_DEFAULT.maxMs, 0), CAPS_DEFAULT.maxMs);
  const waitMs = caps.waitMs ?? CAPS_DEFAULT.waitMs;
  const deadline = Date.now() + maxMs;

  const observedViews = [];
  const trail = [];
  const found = new Set();
  const stopped = () => typeof stopSignal === 'function' && !!stopSignal();
  const looking = () => TARGET_HINTS.filter((h) => !found.has(h));
  const progress = (opening, clicks) => { try { onProgress?.({ opening, found: [...found], looking: looking(), clicks }); } catch { /* UI must never break the walk */ } };

  const currentUrl = async () => (await client.currentUrl().catch(() => ({})))?.url || null;
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

  const record = (view) => {
    if (!view) return false;
    observedViews.push(view);
    if (view.rowsSelector) found.add(view.resourceHint);
    return true;
  };

  // 0. Is this a page worth walking? A login form or a dead post-expiry shell yields nothing; report it
  // instead of "no patient row". A slow worklist can look shell-like for a moment (rows arrive by AJAX
  // after the frame), so a shell verdict is confirmed once after one wait. A null state (evaluate
  // failed) is treated as unknown and the walk proceeds.
  const pageState = () => evalJson(client, `(${PAGE_STATE_SRC})()`, null);
  const isShell = (s) => !!s && s.dataTableCount === 0 && s.textLen < SHELL_TEXT_MAX;
  let state = await pageState();
  if (state && state.hasPasswordInput) return { observedViews, trail, stopReason: 'login-required', found: [] };
  if (isShell(state)) {
    await client.wait({ ms: waitMs });
    state = await pageState();
    if (state && state.hasPasswordInput) return { observedViews, trail, stopReason: 'login-required', found: [] };
    if (isShell(state)) return { observedViews, trail, stopReason: 'session-expired-or-shell', found: [] };
  }

  // 1. worklist (the client is already attached to it). No observer armed: global best table.
  progress('worklist', 0);
  const worklistRaw = await evalJson(client, `(${RAW_TABLE_SRC})()`, null);
  {
    /* THE WORKLIST'S OWN DATA CALL. A DataTables ward list fills itself on page load (GHIS: GetIPWL),
     * before the crawl clicks anything, so the native log since open and the observer's events so
     * far are the worklist's endpoints. Login-host requests are other-origin and drop out here. */
    const wlView = buildTableView(worklistRaw, 'worklist', redactPageUrl(await currentUrl()));
    if (wlView) {
      const pageUrl = await currentUrl();
      const drained = typeof client.drainRequests === 'function' ? await client.drainRequests().catch(() => null) : null;
      let endpoints = redactEndpoints(drained?.requests, pageUrl);
      if (typeof client.drainObserverEvents === 'function') {
        const observed = await client.drainObserverEvents().catch(() => null);
        if (observed && Array.isArray(observed.events) && observed.events.length) {
          if (!endpoints.length) endpoints = redactEndpoints(observed.events, pageUrl);
          else endpoints = mergeEndpointDetails(endpoints, observed.events);
        }
      }
      if (endpoints.length) wlView.endpoints = endpoints;
    }
    record(wlView);
  }
  await evalJson(client, `(${RAW_BLOCK_SRC})()`, null); // clears any stale observer state

  // Open the first patient row. Legacy worklists (e.g. GHIS DataTables) populate their rows by an AJAX
  // call AFTER the page and its headers render, so poll a few times before concluding there is no row.
  let row = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    row = await evalJson(client, `(${FIND_PATIENT_ROW_SRC})(${JSON.stringify(GENERIC_CLASS.source)})`, null);
    if (row) break;
    if (Date.now() >= deadline || stopped()) break;
    await client.wait({ ms: waitMs });
  }
  if (!row) return { observedViews, trail, stopReason: stopped() ? 'stop-signal' : 'no-patient-row', found: [...found] };
  if (typeof client.drainRequests === 'function') await client.drainRequests().catch(() => null); // fresh per-click log
  await client.evaluate({ expression: `(${ARM_OBSERVER_SRC})()` });
  await client.evaluate({ expression: `(${CLICK_ROW_SRC})(${row.index})` });
  await client.wait({ ms: waitMs });
  trail.push('patient-record');
  // The patient hub itself often shows demographics as a label/value block: capture it as 'patient'.
  // Block only: the worklist table just hidden by the click would otherwise pass for it.
  record(await captureView({ client, resourceHint: 'patient', blockOnly: true }));

  // 2/3. Walk EVERY control under the record, clinical keywords first, dedup by redacted label, until a
  // cap is hit. The observer is armed before each click so the capture can attribute the table or block
  // to the panel the click populated. A click that navigates to another page is undone with history.back().
  const visited = new Set();
  const detailSeen = new Set();
  let stopReason = 'no-candidate';
  let clicks = 0;
  const homePath = pathOf(await currentUrl());
  while (observedViews.length < maxViews) {
    if (Date.now() >= deadline) { stopReason = 'time-cap'; break; }
    if (stopped()) { stopReason = 'stop-signal'; break; }
    if (clicks >= maxClicks) { stopReason = 'max-clicks'; break; }

    const candidates = await evalJson(client, `(${FIND_CONTROLS_SRC})(${JSON.stringify(CLINICAL_KEYWORDS_SRC)},${JSON.stringify(SKIP_SRC)},${JSON.stringify(CONTROL_QUERY)})`, []);
    const fresh = Array.isArray(candidates) ? candidates.filter((c) => c && c.label && !visited.has(c.label)) : [];
    /* THE BRAIN PICKS THE NEXT TAP when there is one to consult: given the control labels and what is
     * still missing, it names the control most likely to open it. The keyword rule is the fallback
     * and the answer is only ever an index into the SAME candidate list (never a free target). */
    let next = null;
    if (brain && typeof brain.next === 'function' && fresh.length > 1 && looking().length) {
      const pool = fresh.slice(0, 60);
      let a = null;
      try { a = await brain.next(scrubForBrain({ controls: pool.map((c) => c.label), looking: looking(), path: pathOf(await currentUrl()) })); } catch { a = null; }
      if (a && Number.isInteger(a.index) && a.index >= 0 && a.index < pool.length) next = pool[a.index];
    }
    if (!next) next = fresh.find((c) => c.clinical) || fresh[0];
    if (!next) { stopReason = 'no-candidate'; break; }

    visited.add(next.label);
    clicks += 1;
    progress(next.label, clicks);
    await client.evaluate({ expression: `(${ARM_OBSERVER_SRC})()` });
    await client.evaluate({ expression: `(${CLICK_CONTROL_SRC})(${next.index},${JSON.stringify(CONTROL_QUERY)})` });
    await client.wait({ ms: waitMs });
    trail.push(next.label);
    const hint = resourceHintFor(next.label);
    const view = await captureView({ client, resourceHint: hint });
    if (view && (hint === 'unknown' || hint === 'patient')) {
      const byHeaders = hintFromHeaders(view.headers);
      if (byHeaders !== 'unknown') view.resourceHint = byHeaders;
    }
    if (view) await enrichView(view, brain, { label: next.label });
    record(view);

    /* ONE LEVEL DEEPER. A list of lab orders or radiology studies is not the result: the hospital
     * opens one on tap and that tap is the call the runtime needs (GHIS: a render id, a result id).
     * Open the first row once per list kind, capture what it shows as "<kind>-detail" with the
     * call it made, and come back. */
    if (caps.exploreDetails === true && view && view.rowsSelector && !view.block && DETAIL_PARENTS.includes(view.resourceHint) && !detailSeen.has(view.resourceHint) && clicks < maxClicks) {
      detailSeen.add(view.resourceHint);
      const beforePath = pathOf(await currentUrl());
      await client.evaluate({ expression: `(${ARM_OBSERVER_SRC})()` }).catch(() => {});
      const how = await client.evaluate({ expression: `(${CLICK_FIRST_ROW_SRC})(${JSON.stringify(view.rowsSelector)})` }).catch(() => ({ result: 'e' }));
      if (how && (how.result === 'link' || how.result === 'row')) {
        clicks += 1;
        await client.wait({ ms: waitMs });
        trail.push(view.resourceHint + ' row');
        let detail = null;
        try { detail = await captureView({ client, resourceHint: view.resourceHint + '-detail' }); } catch { detail = null; }
        if (detail && detail.rowsSelector) { detail.detailOf = view.resourceHint; observedViews.push(detail); }
        if (pathOf(await currentUrl()) !== beforePath) {
          await client.evaluate({ expression: 'history.back()' }).catch(() => {});
          await client.wait({ ms: waitMs });
          trail.push('back');
        }
      }
    }

    // Drifted to another page (a link with a handler that navigated): come back to the record.
    if (pathOf(await currentUrl()) !== homePath) {
      await client.evaluate({ expression: 'history.back()' }).catch(() => {});
      await client.wait({ ms: waitMs });
      trail.push('back');
    }
  }
  if (observedViews.length >= maxViews) stopReason = 'max-views';
  progress(null, clicks);

  return { observedViews, trail, stopReason, found: [...found] };
}
