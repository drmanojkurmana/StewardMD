// connect-agent/phone/deep-crawl.mjs — aggressive READ-ONLY crawler: worklist -> first patient record
// -> every clinical sub-view. Captures TABLE STRUCTURE ONLY (never patient values) as `observedViews`
// for connect-agent/manifest/infer-html.mjs. See connect-agent/phone/CONTRACT.md for the six-method
// client contract and connect-agent/phone/explore.mjs for the page-realm-function-as-string pattern
// this file reuses (PROBE_SOURCE: a real function, syntax-checked by Node, String()'d for evaluate()).
//
// Design: the browser-realm functions below (CRAWL_*) only WALK THE DOM and return raw, PHI-free facts
// (table id/class, <th> header text, per-row onclick attribute, click targets by index). They never
// compute a selector or redact an onclick — that logic lives in `buildTableView`, plain Node-side JS,
// so it is unit-testable without a browser and has one implementation, not two.
//
// Panel attribution (accordion / tab SPAs): before a sub-view control is clicked, CRAWL_ARM_OBSERVER
// installs a page-realm MutationObserver that records every element subtree the click adds or
// re-styles, plus a visibility snapshot of every table. CRAWL_RAW_TABLE then prefers a table that is
// inside a recorded (changed) subtree, or newly added, or newly visible, over a lingering table from an
// earlier view. With no observer armed (the worklist) it degrades to the old global best-table pick.
//
// Live-device facts this is hardened for (Pixel + GHIS probe): a LOCKED / backgrounded WebView reports
// zero client rects for EVERY table, so visibility is only a signal when the page has layout at all; an
// EXPIRED session leaves a dead shell (tiny text, layout tables under #patient_details_table plus a
// datepicker, no data table) whose digit-bearing layout rows must never pass for a patient row. The
// crawl reports these as stopReason 'login-required' / 'session-expired-or-shell' instead of silently
// producing zero views.
const CAPS_DEFAULT = { maxViews: 12, maxMs: 120000, waitMs: 1500 };
// A page with no <th>+row data table and less text than this is a dead shell, not a worklist.
const SHELL_TEXT_MAX = 600;

// ponytail: flat keyword list, no NLP/fuzzy matching — good enough for the GHIS-style nav labels this
// targets; widen the list (or move to a config) if a hospital's labels don't match.
const CLINICAL_KEYWORDS_SRC =
  'medic|drug|\\blabs?\\b|laborator|investigat|result|radiolog|imaging|history|discharge|summary|' +
  'demographic|patient.?details|encounter|visit|\\bnote\\b';

const HINT_RULES = [
  [/medic|drug/i, 'medications'],
  [/\blabs?\b|laborator|investigat|result/i, 'labs'],
  [/radiolog|imaging/i, 'radiology'],
  [/history/i, 'history'],
  [/discharge|summary/i, 'discharge'],
  [/demographic|patient.?details/i, 'patient'],
];

function resourceHintFor(label) {
  for (const [re, hint] of HINT_RULES) if (re.test(label)) return hint;
  return 'unknown';
}

const GENERIC_CLASS = /^(table|table-bordered|table-striped|table-hover|table-sm|table-condensed|table-responsive|datatable|row|col(-\w+)*|container(-fluid)?|panel|panel-body|panel-collapse|collapse|in|show|active|tab-pane|tab-content|card|card-body|content|wrapper)$/i;
// Anchors go into a CSS selector verbatim; only plain identifier chars are accepted (see html.mjs IDENT).
const SAFE_IDENT = /^[A-Za-z][\w-]*$/;

function distinctClasses(cls) {
  return String(cls || '').split(/\s+/).filter((c) => c && SAFE_IDENT.test(c) && !GENERIC_CLASS.test(c));
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
  if (raw.id && SAFE_IDENT.test(raw.id)) { rowsSelector = `#${raw.id} tbody tr`; confidence = 'high'; }
  else if (container.id && SAFE_IDENT.test(container.id)) { rowsSelector = `#${container.id} ${tableSel} tbody tr`; confidence = 'high'; }
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
            if (n.nodeType === 1) state.changed.push(n);
            else if (rec.target && rec.target.nodeType === 1) state.changed.push(rec.target);
          }
        } else if (rec.type === 'attributes' && rec.target && rec.target.nodeType === 1) {
          state.changed.push(rec.target);
        }
      }
      if (state.changed.length > 5000) state.changed.length = 5000;
    });
    state.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded'] });
  }
  window.__smdCrawlObs = state;
  return 'ok';
}

// Picks the best data table on the current view and returns its raw facts, or null if there is none
// (a label/value detail page). Never returns <td> text (except a recovered LABEL row: short, digit-free
// cells that name columns). Prefers the table inside the subtree the last click changed.
function CRAWL_RAW_TABLE() {
  var obs = window.__smdCrawlObs || null;
  if (obs && obs.mo) { obs.mo.disconnect(); obs.mo = null; }
  window.__smdCrawlObs = null;
  var tables = document.querySelectorAll('table');
  var DAY = /^(su|mo|tu|we|th|fr|sa|sun|mon|tue|wed|thu|fri|sat)$/i;
  var FORM_HINT = /\b(entry|requisition)\b/i;
  var LABEL_WORD = /name|date|code|route|dos|qty|quant|freq|dur|test|result|unit|type|status|remark|desc|no\b|s\.?no|sl\b|#|time|value|range|method|dept|ward|bed|age|sex|gender|doctor|drug|medic|diagnos|advice|report|title|subject|category|notes?\b|comment/i;

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
    if (isCalendar(t) || isWriteForm(t)) continue;
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

  // Selector anchors: nearest ancestor with an id (else a class), and the table's position among its
  // parent's <table> children when a sibling table (header table) shares the parent.
  var container = { id: '', class: '' };
  for (var anc = best.parentElement; anc && anc !== document.body; anc = anc.parentElement) {
    if (anc.id) { container = { id: anc.id, class: anc.getAttribute('class') || '' }; break; }
    if (!container.class && anc.getAttribute('class')) container.class = anc.getAttribute('class');
  }
  var tableNth = 0;
  var par = best.parentElement;
  if (par) {
    var kids = par.children, n = 0, tablesInParent = 0;
    for (var k = 0; k < kids.length; k++) { if (kids[k].tagName === 'TABLE') { tablesInParent++; if (kids[k] === best) n = tablesInParent; } }
    if (tablesInParent > 1) tableNth = n;
  }

  return JSON.stringify({ id: best.getAttribute('id') || '', class: best.getAttribute('class') || '', headers: headers, rows: rowInfos, container: container, tableNth: tableNth });
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

// Finds every `<a>/<button>/<li>` whose visible text OR any on* handler attribute matches the clinical
// keyword list. Returns { index, label } pairs (index within `document.querySelectorAll('a,button,li')`).
function CRAWL_FIND_CONTROLS(keywordSrc) {
  var RE = new RegExp(keywordSrc, 'i');
  var els = document.querySelectorAll('a,button,li');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var onAttrs = '';
    var attrs = el.attributes;
    if (attrs) {
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].name.indexOf('on') === 0) onAttrs += ' ' + attrs[a].value;
      }
    }
    if (!RE.test(text) && !RE.test(onAttrs)) continue;
    // A wrapper (<li> around the real <a>) carries the same label; clicking it would not fire the
    // child's handler and the label dedup would then skip the child. Prefer the innermost control.
    var inner = el.querySelector('a,button');
    if (inner && RE.test((inner.textContent || '').replace(/\s+/g, ' ').trim())) continue;
    out.push({ index: i, label: text.slice(0, 120) });
  }
  return JSON.stringify(out);
}

function CRAWL_CLICK_CONTROL(idx) {
  var els = document.querySelectorAll('a,button,li');
  var el = els[idx];
  if (!el) return 'no-el';
  el.click();
  return 'ok';
}

const ARM_OBSERVER_SRC = String(CRAWL_ARM_OBSERVER);
const RAW_TABLE_SRC = String(CRAWL_RAW_TABLE);
const PAGE_STATE_SRC = String(CRAWL_PAGE_STATE);
const FIND_PATIENT_ROW_SRC = String(CRAWL_FIND_PATIENT_ROW);
const CLICK_ROW_SRC = String(CRAWL_CLICK_ROW);
const FIND_CONTROLS_SRC = String(CRAWL_FIND_CONTROLS);
const CLICK_CONTROL_SRC = String(CRAWL_CLICK_CONTROL);

async function evalJson(client, expression, fallback) {
  const res = await client.evaluate({ expression });
  try { return JSON.parse(res?.result ?? 'null'); } catch { return fallback; }
}

/**
 * deepCrawlClinical({ client, caps }) -> { observedViews, trail, stopReason }
 * stopReason: 'login-required' | 'session-expired-or-shell' | 'no-patient-row' | 'no-candidate' |
 * 'max-views' | 'time-cap'. The first two mean the doctor must sign in again (index.mjs / UI surface it).
 * See connect-agent/phone/deep-crawl.mjs module doc and the task spec for behavior.
 */
export async function deepCrawlClinical({ client, caps = {} } = {}) {
  if (!client) throw new Error('deepCrawlClinical requires a client');

  const maxViews = Math.min(Math.max(caps.maxViews ?? CAPS_DEFAULT.maxViews, 1), CAPS_DEFAULT.maxViews);
  const maxMs = Math.min(Math.max(caps.maxMs ?? CAPS_DEFAULT.maxMs, 0), CAPS_DEFAULT.maxMs);
  const waitMs = caps.waitMs ?? CAPS_DEFAULT.waitMs;
  const deadline = Date.now() + maxMs;

  const observedViews = [];
  const trail = [];

  const currentUrl = async () => (await client.currentUrl().catch(() => ({})))?.url || null;

  const captureView = async (resourceHint) => {
    const raw = await evalJson(client, `(${RAW_TABLE_SRC})()`, null);
    observedViews.push(buildTableView(raw, resourceHint, await currentUrl()));
  };

  // 0. Is this a page worth walking? A login form or a dead post-expiry shell yields nothing; report it
  // instead of "no patient row". A slow worklist can look shell-like for a moment (rows arrive by AJAX
  // after the frame), so a shell verdict is confirmed once after one wait. A null state (evaluate
  // failed) is treated as unknown and the walk proceeds.
  const pageState = () => evalJson(client, `(${PAGE_STATE_SRC})()`, null);
  const isShell = (s) => !!s && s.dataTableCount === 0 && s.textLen < SHELL_TEXT_MAX;
  let state = await pageState();
  if (state && state.hasPasswordInput) return { observedViews, trail, stopReason: 'login-required' };
  if (isShell(state)) {
    await client.wait({ ms: waitMs });
    state = await pageState();
    if (state && state.hasPasswordInput) return { observedViews, trail, stopReason: 'login-required' };
    if (isShell(state)) return { observedViews, trail, stopReason: 'session-expired-or-shell' };
  }

  // 1. worklist (the client is already attached to it).
  await captureView('worklist');

  // Open the first patient row. Legacy worklists (e.g. GHIS DataTables) populate their rows by an AJAX
  // call AFTER the page and its headers render, so poll a few times before concluding there is no row.
  let row = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    row = await evalJson(client, `(${FIND_PATIENT_ROW_SRC})(${JSON.stringify(GENERIC_CLASS.source)})`, null);
    if (row) break;
    if (Date.now() >= deadline) break;
    await client.wait({ ms: waitMs });
  }
  if (!row) return { observedViews, trail, stopReason: 'no-patient-row' };
  await client.evaluate({ expression: `(${CLICK_ROW_SRC})(${row.index})` });
  await client.wait({ ms: waitMs });
  trail.push('patient-record');

  // 2/3. Walk every clinical sub-view control, dedup by label, until a cap is hit. The observer is armed
  // before each click so the capture can attribute the table to the panel the click populated.
  const visited = new Set();
  let stopReason = 'no-candidate';
  while (observedViews.length < maxViews) {
    if (Date.now() >= deadline) { stopReason = 'time-cap'; break; }

    const candidates = await evalJson(client, `(${FIND_CONTROLS_SRC})(${JSON.stringify(CLINICAL_KEYWORDS_SRC)})`, []);
    const next = Array.isArray(candidates) ? candidates.find((c) => c && c.label && !visited.has(c.label)) : null;
    if (!next) { stopReason = 'no-candidate'; break; }

    visited.add(next.label);
    await client.evaluate({ expression: `(${ARM_OBSERVER_SRC})()` });
    await client.evaluate({ expression: `(${CLICK_CONTROL_SRC})(${next.index})` });
    await client.wait({ ms: waitMs });
    trail.push(next.label);
    await captureView(resourceHintFor(next.label));
  }
  if (observedViews.length >= maxViews) stopReason = 'max-views';

  return { observedViews, trail, stopReason };
}
