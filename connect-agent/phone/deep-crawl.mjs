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
const CAPS_DEFAULT = { maxViews: 12, maxMs: 120000, waitMs: 1500 };

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

const GENERIC_CLASS = /^(table|table-bordered|table-striped|table-hover|table-sm|table-condensed|table-responsive|datatable)$/i;

/**
 * buildTableView(raw, resourceHint, pathTemplate) -> observedView
 * `raw` = { id, class, headers:[string], rows:[{isHeader, onclick}] } | null, from CRAWL_RAW_TABLE.
 * Pure and PHI-free by construction: `raw` never carries cell text, only header labels + id/class +
 * an onclick ATTRIBUTE VALUE (redacted to its call shape below, arguments discarded).
 */
export function buildTableView(raw, resourceHint, pathTemplate) {
  if (!raw) return { resourceHint, pathTemplate, method: 'GET', singleRecord: true };

  const classes = String(raw.class || '').split(/\s+/).filter((c) => c && !GENERIC_CLASS.test(c));
  let rowsSelector;
  let confidence;
  if (raw.id) { rowsSelector = `#${raw.id} tbody tr`; confidence = 'high'; }
  else if (classes.length) { rowsSelector = `table.${classes[0]} tbody tr`; confidence = 'medium'; }
  else { rowsSelector = 'table tbody tr'; confidence = 'low'; }

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

// Picks the best data table on the current view and returns its raw facts, or null if there is none
// (a label/value detail page). Never returns <td> text.
function CRAWL_RAW_TABLE() {
  var tables = document.querySelectorAll('table');
  var best = null, bestScore = -1;
  var DAY = /^(su|mo|tu|we|th|fr|sa|sun|mon|tue|wed|thu|fri|sat)$/i;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    // Prefer a VISIBLE table (a sub-view that loaded into the active panel), but do not hard-exclude
    // laid-out-but-zero-rect tables: some legacy EMRs render a real data table with no client rects.
    // Visibility is a strong score bonus, not a filter, so the current view's table wins over a stale one
    // without dropping a table the layout reports oddly.
    var visible = t.getClientRects && t.getClientRects().length ? 1 : 0;
    var cls = (t.getAttribute('class') || '') + ' ' + (t.getAttribute('id') || '');
    // Skip a jQuery UI date-picker / calendar widget: it has <th> and rows but is chrome, not data.
    if (/datepicker|calendar/i.test(cls)) continue;
    var thEls0 = t.querySelectorAll('th');
    var dayHeaders = 0;
    for (var d = 0; d < thEls0.length; d++) { if (DAY.test((thEls0[d].textContent || '').trim())) dayHeaders++; }
    if (thEls0.length >= 3 && dayHeaders >= Math.ceil(thEls0.length / 2)) continue; // weekday header row = calendar
    var bodyRows = t.querySelectorAll('tbody tr');
    var dataRows = 0;
    var scan = bodyRows.length ? bodyRows : t.querySelectorAll('tr');
    for (var b = 0; b < scan.length; b++) { if (scan[b].querySelectorAll('td').length >= 1) dataRows++; }
    // Prefer a visible table with header labels AND real data rows; break ties by number of data rows.
    var score = (visible ? 100000 : 0) + (thEls0.length ? 1000 : 0) + Math.min(dataRows, 999);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best) return JSON.stringify(null);

  var headers = [];
  var thEls = best.querySelectorAll('th');
  for (var h = 0; h < thEls.length; h++) {
    var txt = (thEls[h].textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) headers.push(txt);
  }

  var rows2 = best.querySelectorAll('tbody tr');
  if (!rows2.length) rows2 = best.querySelectorAll('tr');
  var rowInfos = [];
  for (var r = 0; r < rows2.length; r++) {
    var row = rows2[r];
    rowInfos.push({ isHeader: row.querySelectorAll('th').length > 0, onclick: row.getAttribute('onclick') || null });
  }

  return JSON.stringify({ id: best.getAttribute('id') || '', class: best.getAttribute('class') || '', headers: headers, rows: rowInfos });
}

// Finds the first `<tr>` that looks like a patient row: >=2 `<td>`s and a redacted-id-shaped digit run
// in its text. Returns its index within `document.querySelectorAll('tr')`, or null.
function CRAWL_FIND_PATIENT_ROW() {
  var trs = document.querySelectorAll('tr');
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll('td');
    if (tds.length < 2) continue;
    if (!/\d{2,}/.test(trs[i].textContent || '')) continue;
    return JSON.stringify({ index: i });
  }
  return JSON.stringify(null);
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

const RAW_TABLE_SRC = String(CRAWL_RAW_TABLE);
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

  // 1. worklist (the client is already attached to it).
  await captureView('worklist');

  // Open the first patient row. Legacy worklists (e.g. GHIS DataTables) populate their rows by an AJAX
  // call AFTER the page and its headers render, so poll a few times before concluding there is no row.
  let row = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    row = await evalJson(client, `(${FIND_PATIENT_ROW_SRC})()`, null);
    if (row) break;
    if (Date.now() >= deadline) break;
    await client.wait({ ms: waitMs });
  }
  if (!row) return { observedViews, trail, stopReason: 'no-patient-row' };
  await client.evaluate({ expression: `(${CLICK_ROW_SRC})(${row.index})` });
  await client.wait({ ms: waitMs });
  trail.push('patient-record');

  // 2/3. Walk every clinical sub-view control, dedup by label, until a cap is hit.
  const visited = new Set();
  let stopReason = 'no-candidate';
  while (observedViews.length < maxViews) {
    if (Date.now() >= deadline) { stopReason = 'time-cap'; break; }

    const candidates = await evalJson(client, `(${FIND_CONTROLS_SRC})(${JSON.stringify(CLINICAL_KEYWORDS_SRC)})`, []);
    const next = Array.isArray(candidates) ? candidates.find((c) => c && c.label && !visited.has(c.label)) : null;
    if (!next) { stopReason = 'no-candidate'; break; }

    visited.add(next.label);
    await client.evaluate({ expression: `(${CLICK_CONTROL_SRC})(${next.index})` });
    await client.wait({ ms: waitMs });
    trail.push(next.label);
    await captureView(resourceHintFor(next.label));
  }
  if (observedViews.length >= maxViews) stopReason = 'max-views';

  return { observedViews, trail, stopReason };
}
