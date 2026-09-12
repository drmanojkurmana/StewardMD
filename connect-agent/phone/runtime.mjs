// connect-agent/phone/runtime.mjs - replays an APPROVED adapter on the phone for Ward Sync.
//
// The server keeps an adapter's observedViews (PHI-free selectors + column labels, see CONTRACT.md)
// and hands them back as `replay` on GET /versions/:id. This module walks them in the doctor's own
// ConnectBrowser session: navigate to the view, read the rows, map the cells by header label into
// the row shape ghis-ward.js renderPatients() already draws. Cell TEXT exists only here, on the phone.
// Reads are navigation + evaluate only; anything on the crawler's read-only SKIP list is never clicked.

import { captureView } from './deep-crawl.mjs';

const GIMSR_HOSTS = ['gimsrlogin.gitam.edu', 'ghis.gitam.edu'];

/* READ-TIME SELF-REPAIR. When an approved adapter reads zero rows, the doctor is asked this once, in
 * the browser header; the screen they land on is captured (structure only) and read right away, and
 * the same structure is posted as a corrected candidate so the next doctor is never asked. */
export const REPAIR_ASK = 'Show me the list of all your patients, then tap Done.';

export async function captureWorklist({ plugin }) {
  const client = {
    currentUrl: () => plugin.currentUrl(),
    evaluate: (a) => plugin.evaluate(a),
  };
  if (typeof plugin.drainRequests === 'function') client.drainRequests = () => plugin.drainRequests();
  const view = await captureView({ client, resourceHint: 'worklist' });
  if (!view || !view.rowsSelector || view.block) throw new Error('no patient table on the screen you showed me');
  view.guided = true;
  return view;
}

const HEADER_MAP = [
  ['mrn', /\b(mrn?|uhid|mr\.?\s*no|patient\s*(id|no)|reg(istration)?\s*(no|#)|hosp(ital)?\s*(id|no)|ip\s*(no|#)|umr)\b/i],
  ['episode', /\b(visit|episode|admission|encounter|ip\s*number)\b/i],
  ['name', /\b(patient\s*)?name\b/i],
  ['age', /\b(age|dob|date\s*of\s*birth|age\s*\/\s*sex)\b/i],
  ['gender', /\b(sex|gender)\b/i],
  ['bed', /\b(bed|room|cot)\b/i],
  ['dept', /\b(ward|dept|department|unit|speciality|specialty|branch)\b/i],
  ['doctor', /\b(doctor|consultant|physician|treating|dr\.?)\b/i],
  ['status', /\b(status|state)\b/i],
];

// Which patient field a column label feeds, or null. Exported for the unit test.
export function fieldForHeader(label) {
  const l = String(label || '').trim();
  if (!l) return null;
  for (const [field, re] of HEADER_MAP) if (re.test(l)) return field;
  return null;
}

// One extracted row ({header: text}) -> the shape renderPatients() reads. "Age / Sex" style columns
// split into both. Rows with neither a name nor an id are dropped by the caller.
function isMeta(k) { return k === '_href' || k === '_args'; }

export function mapRow(row) {
  const out = { patientId: '', episodeId: '', patientFirstName: '', dob: '', gender: '', bedName: '', deptDescription: '', employeeFirstName: '', queueStatus: '' };
  const dest = { mrn: 'patientId', episode: 'episodeId', name: 'patientFirstName', age: 'dob', gender: 'gender', bed: 'bedName', dept: 'deptDescription', doctor: 'employeeFirstName', status: 'queueStatus' };
  for (const key of Object.keys(row || {})) {
    if (isMeta(key)) continue;
    const f = fieldForHeader(key);
    const v = String(row[key] == null ? '' : row[key]).replace(/\s+/g, ' ').trim();
    if (!f || !v) continue;
    if (f === 'age' && /\//.test(v) && /(m|f|male|female)\s*$/i.test(v)) {
      const [a, s] = v.split('/');
      if (!out.dob) out.dob = a.trim();
      if (!out.gender) out.gender = s.trim();
      continue;
    }
    if (f === 'gender' && out.gender) continue;
    if (!out[dest[f]]) out[dest[f]] = v;
  }
  if (!out.episodeId) out.episodeId = out.patientId;
  return out;
}

export function mapRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(mapRow).filter((p) => p.patientFirstName || p.patientId);
}

// Page-side reader. Runs INSIDE the hospital page via plugin.evaluate and returns a JSON string of
// [{header: text}]. Table view: rows = rowsSelector, cells = td/th in order, labels = headers or the
// table's own th. Block view: cellSelectors[i] resolved relative to each row. Written against the
// smallest DOM surface (querySelectorAll, querySelector, textContent) so a stub can unit test it.
export function READ_ROWS(doc, view) {
  var rows = doc.querySelectorAll(view.rowsSelector || 'table tr');
  var headers = (view.headers || []).slice();
  var sels = view.cellSelectors || null;
  function txt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  if (!sels && !headers.length) {
    var ths = doc.querySelectorAll('th');
    for (var h = 0; h < ths.length; h++) headers.push(txt(ths[h]));
  }
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r], rec = {}, filled = 0;
    if (sels) {
      for (var s = 0; s < sels.length; s++) {
        var v = txt(row.querySelector(sels[s]));
        if (v) { rec[headers[s] || ('col' + s)] = v; filled++; }
      }
    } else {
      var cells = row.querySelectorAll('td');
      if (!cells.length) continue;
      /* A DataTables placeholder ("No data available in table", one cell spanning the row) is not a
       * patient. Counting it as one stopped the wait loop on an empty table and rendered a patient
       * called "(no name)" on the live hospital (2026-09-12). */
      if (cells.length < 2 || /no (data|records|matching records)/i.test(txt(row))) continue;
      for (var c = 0; c < cells.length; c++) {
        var t = txt(cells[c]);
        if (t) { rec[headers[c] || ('col' + c)] = t; filled++; }
      }
    }
    /* ROW-LEVEL IDENTIFIERS stay with the row (on the phone only): the first link's href and the
     * arguments of the row's onclick, so a detail call (a lab render, a radiology report) can be
     * keyed from the list the way the hospital's own page keys it. */
    if (filled) {
      try {
        var a = row.querySelector ? row.querySelector('a[href]') : null;
        if (a && a.getAttribute) { var href = a.getAttribute('href') || ''; if (href && href.charAt(0) !== '#' && !/^javascript:/i.test(href)) rec._href = href; }
        var oc = (row.getAttribute && row.getAttribute('onclick')) || '';
        if (!oc && row.querySelector) { var el = row.querySelector('[onclick]'); oc = (el && el.getAttribute('onclick')) || ''; }
        var m = /\(([^)]*)\)/.exec(oc);
        if (m && m[1].trim()) rec._args = m[1].split(',').map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ''); });
      } catch (e) {}
    }
    if (filled) out.push(rec);
  }
  return JSON.stringify(out);
}

export function readRowsExpression(view) {
  const safe = { rowsSelector: view.rowsSelector, headers: view.headers || [], cellSelectors: view.cellSelectors || null };
  return `(${String(READ_ROWS)})(document,${JSON.stringify(safe)})`;
}

// Picker label: short name from the tenant ("KIMS Hospital" -> "KIMS"), else the origin host's
// own label ("emr.kims.example" -> "KIMS"). Subtitle: "<tenant name> · sign in with <host>".
export function hospitalLabel(tenantName, origin) {
  let host = '';
  try { host = new URL(origin).host; } catch { host = String(origin || ''); }
  const full = String(tenantName || '').trim();
  let short = full.replace(/\b(hospitals?|medical\s+(college|centre|center|sciences)|institute|of|and|&|multi.?speciality|multispecialty|trust)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!short) {
    const parts = host.split('.').filter((p) => !/^(www|emr|his|hims|portal|login|app)$/i.test(p));
    short = (parts.length > 1 ? parts[parts.length - 2] : parts[0] || host).toUpperCase();
  }
  return { name: short, subtitle: (full || host) + ' · sign in with ' + host };
}

export function isGimsrOrigin(origin) {
  try { return GIMSR_HOSTS.indexOf(new URL(origin).host) >= 0; } catch { return false; }
}

// Pick the replay views by resource. The worklist is the one the ward list is read from.
export function viewsByResource(replay) {
  const by = {};
  for (const v of Array.isArray(replay) ? replay : []) {
    const r = String(v.resourceHint || v.resource || 'unknown');
    if (!by[r]) by[r] = v;
  }
  return by;
}

function pathToUrl(origin, path) {
  if (!path) return origin;
  if (/^https?:/i.test(path)) return path;
  return origin.replace(/\/$/, '') + (path.charAt(0) === '/' ? '' : '/') + path;
}

async function settle(ms) { await new Promise((r) => setTimeout(r, ms)); }

/* A DataTables page length control: pick its largest option (or "All", value -1) so ONE read sees the
 * whole list rather than the first ten rows. Silent when the page has no such control. */
export const EXPAND_PAGE_LENGTH = "(function(){try{var s=document.querySelector('select[name$=\"_length\"]');if(!s)return '0';var best=null;[].forEach.call(s.options,function(o){var n=parseInt(o.value,10);if(isNaN(n))return;if(n===-1){best=-1;return;}if(best!==-1&&(best===null||n>best))best=n;});if(best===null)return '0';s.value=String(best);s.dispatchEvent(new Event('change',{bubbles:true}));return '1'}catch(e){return 'e'}})()";

/* WAIT FOR THE ROWS, DO NOT ASSUME THEM.
 *
 * GHIS draws its worklist with an AJAX DataTable: the page is "loaded" long before the tbody has a
 * single patient in it. A fixed 1.5 s settle read an empty table on the live hospital and reported
 * zero patients where the same screen showed three (owner, 2026-09-12). The reader now polls the
 * recorded selector until rows appear or maxWaitMs passes, and first widens the page length so a
 * ward of thirty is not truncated to ten. */
function hostOf(u) { try { return new URL(u).host; } catch { return String(u || ''); } }
function samePage(a, b) { try { const x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, ''); } catch { return false; } }

/* AN EMPTY WORKLIST MAY BE A FILTER, NOT AN EMPTY WARD. GHIS lists only the signed-in doctor's own
 * patients until "All patients" is ticked (owner's screen, 2026-09-13, 0 of 0 entries). When a list
 * reads empty, tick a toggle labelled like that once and read again. */
export const TOGGLE_ALL = "(function(){try{var els=[].slice.call(document.querySelectorAll('label,input[type=\"checkbox\"],a,button,span,div'));for(var i=0;i<els.length;i++){var el=els[i];var t=(el.textContent||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();if(!/^(all patients|show all( patients)?|all)$/i.test(t))continue;var box=el.tagName==='INPUT'?el:(el.querySelector&&el.querySelector('input[type=\"checkbox\"]'))||(el.htmlFor&&document.getElementById(el.htmlFor))||null;if(!box&&el.previousElementSibling&&el.previousElementSibling.tagName==='INPUT')box=el.previousElementSibling;if(!box&&el.parentElement)box=el.parentElement.querySelector('input[type=\"checkbox\"]');if(box){if(box.checked)return 'already';box.click();return 'ticked'}el.click();return 'clicked'}return 'none'}catch(e){return 'e'}})()";

export async function readView({ plugin, origin, view, settleMs = 1500, maxWaitMs = 20000, pollMs = 1000, navigate = true, toggleAll = false }) {
  if (navigate) {
    /* Already on the page (the doctor signed in and landed on it): reading it as it stands keeps the
     * context the EMR set for them; a reload from the address bar can lose it. */
    let here = null;
    try { const cur = await plugin.currentUrl(); here = typeof cur === 'string' ? cur : cur && cur.url; } catch { here = null; }
    const target = pathToUrl(origin, view.pathTemplate || view.path);
    if (!here || !samePage(here, target)) {
      await plugin.navigate({ url: target });
      await settle(settleMs);
    }
  }
  /* NOT SIGNED IN IS A NAMED FAILURE, NOT AN EMPTY WARD. If the hospital answered this path with
   * its login form, reading on would report "no patients" for a session that never existed. Seen
   * on GHIS when the read began before the sign-in redirect had landed (2026-09-12). */
  try {
    const gate = await plugin.evaluate({ expression: "(function(){return document.querySelector('input[type=\"password\"]')?'login':'ok'})()" });
    if (gate && String(gate.result).indexOf('login') >= 0) {
      throw new Error('not signed in: ' + hostOf(origin) + ' returned its login page at ' + (view.pathTemplate || view.path) + '. Sign in and try again');
    }
  } catch (e) { if (/not signed in/.test(String(e && e.message))) throw e; }
  try { await plugin.evaluate({ expression: EXPAND_PAGE_LENGTH }); } catch { /* not a DataTable: read as is */ }
  const started = Date.now();
  let rows = [];
  let toggled = !toggleAll;
  for (;;) {
    const res = await plugin.evaluate({ expression: readRowsExpression(view) });
    try { rows = JSON.parse((res && res.result) || '[]'); } catch { throw new Error('the page returned no readable rows (bad JSON from the reader)'); }
    rows = Array.isArray(rows) ? rows : [];
    if (rows.length || Date.now() - started >= maxWaitMs) break;
    if (!toggled && Date.now() - started >= Math.min(4000, maxWaitMs / 3)) {
      toggled = true;
      let t = 'none';
      try { t = String((await plugin.evaluate({ expression: TOGGLE_ALL }))?.result || 'none'); } catch { t = 'none'; }
      if (t === 'ticked' || t === 'clicked') { await settle(settleMs); continue; }
    }
    await settle(pollMs);
  }
  return rows;
}

/* ENDPOINT REPLAY FIRST. Once discovery recorded the data call a view makes, that call is the primary
 * path (issued inside the doctor's browser session by adapter-runtime.mjs); the rendered page is the
 * fallback for views whose call was never seen. `onRead` reports which path served each view. */
async function replayFirst({ plugin, origin, view, patient, onRead }) {
  const ar = await import('./adapter-runtime.mjs');
  const out = await ar.executeView({ plugin, origin, view, patient });
  if (out && out.rows.length) { if (onRead) onRead({ resource: view.resourceHint, via: 'endpoint', url: out.url, kind: out.kind }); return out.rows; }
  return null;
}

// The ward list. Throws with a reason the UI can show verbatim.
export async function readWorklist({ plugin, origin, replay, settleMs, onRead }) {
  const views = viewsByResource(replay);
  const view = views.worklist || views.patient;
  if (!view) throw new Error('the approved adapter has no worklist view');
  if (view.block) throw new Error('the worklist view is a report block, not a table');
  let rows = null;
  try { rows = await replayFirst({ plugin, origin, view, patient: {}, onRead }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; rows = null; }
  if (!rows) {
    rows = await readView({ plugin, origin, view, settleMs, toggleAll: true });
    if (onRead) onRead({ resource: 'worklist', via: 'page', url: view.pathTemplate || view.path });
  }
  const patients = mapRows(rows);
  if (!patients.length) throw new Error('no patient rows found at ' + (view.pathTemplate || view.path || origin) + ' (' + rows.length + ' rows read, none with a name or id)');
  return patients;
}

// A patient's views (medications, labs, radiology, history, discharge): each becomes a titled section
// of [{header: text}] rows. Path placeholders ({id}, {mrn}, :id, #) are filled with the patient id.
export const DETAIL_RESOURCES = Object.freeze(['medications', 'labs', 'radiology', 'history', 'discharge', 'patient']);

export function fillPath(path, patient, which = 'patientId') {
  const id = encodeURIComponent((which === 'episodeId' ? patient.episodeId : patient.patientId) || patient.patientId || '');
  return String(path || '')
    .replace(/\{[^}]*\}|%7B[^%]*%7D|:[a-z_]+id\b|#+/gi, id)
    // an identifier value an older capture left in a query (recordNo=MR25168764) is the patient's slot
    .replace(/=([A-Za-z]{0,6}\d{3,}[A-Za-z0-9-]*)(?=&|$)/g, '=' + id);
}

/* THE SAME CALLS THE HOSPITAL'S OWN PAGES MAKE, replayed inside the doctor's browser session (same
 * cookies, nothing leaves the phone). Discovery recorded each view's same-origin requests with their
 * query keys and no values: "/Doctor/Home/GetMedicines/?id". A key with no value is the patient's
 * slot. Only GET, only keyed, only paths that look like data (not the page shell or a session ping). */
const NOISE_ENDPOINT = /checksession|payment|login|logout|keepalive|heartbeat|\/home\/?$/i;
export function endpointCandidates(view, patient) {
  const out = [];
  for (const e of Array.isArray(view && view.endpoints) ? view.endpoints : []) {
    if (!e || e.method !== 'GET' || typeof e.path !== 'string') continue;
    const m = /^([^?]*)\?([A-Za-z_][\w-]*)(=[^&]*)?$/.exec(e.path);
    if (!m || NOISE_ENDPOINT.test(m[1])) continue;
    const key = m[2];
    const ids = /visit|episode|encounter|admission/i.test(key) ? ['episodeId', 'patientId'] : ['patientId', 'episodeId'];
    for (const which of ids) {
      const val = (patient && patient[which]) || '';
      if (!val) continue;
      const url = m[1] + '?' + key + '=' + encodeURIComponent(val);
      if (!out.includes(url)) out.push(url);
    }
  }
  return out;
}

/* A recorded selector names a panel inside the full page ("#accordionEx table ... tr"); the data call
 * answers with the fragment alone, where that container is missing. Fall back to any table's rows,
 * or the block's own root, before concluding there is nothing. */
function fallbackView(view) {
  if (view.block) return Object.assign({}, view, { rowsSelector: view.rowsSelector.replace(/^#[\w-]+\s+/, '') });
  return Object.assign({}, view, { rowsSelector: 'table tbody tr', headers: [] });
}

export async function readPatientDetails({ plugin, origin, replay, patient, settleMs, maxWaitMs = 8000, onRead }) {
  const views = viewsByResource(replay);
  const sections = [];
  for (const r of DETAIL_RESOURCES) {
    const v = views[r];
    if (!v) continue;
    /* Where to look, in order: the view's own page with the patient filled in (a labs page by
     * recordNo), then the data calls that page made (the medicines fragment by id). A page shared with
     * the worklist (the single-page Doctor Home) is skipped: it never shows this patient's panel on
     * its own. Each place is read with the recorded selector, then with the fallback. */
    let replayed = null;
    try { replayed = await replayFirst({ plugin, origin, view: v, patient, onRead }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; replayed = null; }
    if (replayed) { sections.push({ resource: r, rows: replayed, via: 'endpoint' }); continue; }
    const own = fillPath(v.pathTemplate || v.path, patient);
    const shared = views.worklist && samePage(pathToUrl(origin, own), pathToUrl(origin, views.worklist.pathTemplate || views.worklist.path));
    const places = [];
    if (!shared) places.push(own);
    for (const c of endpointCandidates(v, patient)) places.push(c);
    let rows = [];
    let lastErr = null;
    for (const place of places) {
      for (const candidate of [Object.assign({}, v, { pathTemplate: place }), Object.assign(fallbackView(v), { pathTemplate: place })]) {
        try { rows = await readView({ plugin, origin, view: candidate, settleMs, maxWaitMs }); } catch (e) { lastErr = e; rows = []; }
        if (rows.length) break;
      }
      if (rows.length) break;
    }
    if (!rows.length && lastErr) { sections.push({ resource: r, error: lastErr.message }); continue; }
    if (rows.length && onRead) onRead({ resource: r, via: 'page' });
    sections.push({ resource: r, rows, via: 'page' });
  }
  return sections;
}
