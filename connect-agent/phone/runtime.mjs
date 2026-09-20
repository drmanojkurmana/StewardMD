// connect-agent/phone/runtime.mjs - replays an APPROVED adapter on the phone for Ward Sync.
//
// The server keeps an adapter's observedViews (PHI-free selectors + column labels, see CONTRACT.md)
// and hands them back as `replay` on GET /versions/:id. This module walks them in the doctor's own
// ConnectBrowser session: navigate to the view, read the rows, map the cells by header label into
// the row shape ghis-ward.js renderPatients() already draws. Cell TEXT exists only here, on the phone.
// Reads are navigation + evaluate only; anything on the crawler's read-only SKIP list is never clicked.

import { captureView } from './deep-crawl.mjs';

export const GIMSR_HOSTS = ['gimsrlogin.gitam.edu', 'ghis.gitam.edu'];

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

/* REPAIR RE-PROVES, IT DOES NOT SCRAPE (owner, 2026-09-16). The doctor showed the patient list; the
 * requests their taps fired (fetch/XHR in the page buffer, and navigations injected from the native
 * log) are proven against the screen, exactly as discovery does. A proven view carries a backend
 * request the runtime replays; an unproven one is not saved. */
export async function reproveWorklist({ plugin, origin, view, parents = [] }) {
  const prove = await import('./prove.mjs');
  const client = { currentUrl: () => plugin.currentUrl(), evaluate: (a) => plugin.evaluate(a) };
  if (typeof plugin.drainRequests === 'function') {
    try {
      const drained = await plugin.drainRequests();
      let pageOrigin = null;
      try { const cur = await plugin.currentUrl(); pageOrigin = new URL(typeof cur === 'string' ? cur : cur && cur.url).origin; } catch { pageOrigin = null; }
      const nav = prove.navToReplayEntries(drained, { pageOrigin, allowedOrigins: [origin] });
      if (nav.length) await plugin.evaluate({ expression: '(' + prove.INJECT_REPLAY_SRC + ')(' + JSON.stringify(nav) + ')' }).catch(() => {});
    } catch { /* best effort */ }
  }
  const book = prove.createProofBook({ brain: null });
  await book.prove({ client, view, label: 'the doctor showed the patient list', since: -1 });
  return provenView(view) ? view : null;
}

const HEADER_MAP = [
  ['mrn', /\b(mrn?|uhid|mr\.?\s*no|patient\s*(id|no)|reg(istration)?\s*(no|#)|hosp(ital)?\s*(id|no)|ip\s*(no|#)|umr)\b|^patient_?id$/i],
  ['episode', /\b(visit|episode|admission|encounter|ip\s*number)\b|^episode_?id$/i],
  ['name', /\b(patient\s*)?name\b|^patient_?first_?name$/i],
  ['age', /\b(age|dob|date\s*of\s*birth|age\s*\/\s*sex)\b|^dob$/i],
  ['gender', /\b(sex|gender)\b|^gender$/i],
  ['bed', /\b(bed|room|cot)\b|^bed_?name$/i],
  ['dept', /\b(ward|dept|department|unit|speciality|specialty|branch)\b|^dept_?description$/i],
  ['doctor', /\b(doctor|consultant|physician|treating|dr\.?)\b|^employee_?first_?name$/i],
  ['status', /\b(status|state)\b|^queue_?status$/i],
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
  /* THE ROW'S OWN FIELD WINS. A hospital's JSON row that already carries patientId, episodeId or bedName
   * is the truth for that field; a screen column mapped onto it by value can be wrong (GHIS GetIPWL:
   * "Visit ID" learned as generatedDate, "Bed" as rateTypeDesc, and the gold audit graded episodeId
   * 0 of 769 and bedName 0 of 768 equal, 2026-09-17). The hand-built adapter returns the row's own
   * fields; so does this. */
  const DIRECT = ['patientId', 'episodeId', 'patientFirstName', 'dob', 'gender', 'bedName', 'deptDescription', 'employeeFirstName', 'queueStatus'];
  for (const k of DIRECT) {
    if (row[k] != null && String(row[k]).trim()) out[k] = String(row[k]).trim();
  }
  if (!out.episodeId) out.episodeId = out.patientId;
  return out;
}

/* Each patient keeps the list row it came from (non-enumerable: never serialised) so a proven call can
 * send the exact field discovery traced its value to (prove.mjs paramsOf). */
export function mapRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => { const p = mapRow(r); Object.defineProperty(p, '_row', { value: r, enumerable: false }); return p; }).filter((p) => p.patientFirstName || p.patientId);
}

// Page-side reader. Runs INSIDE the hospital page via plugin.evaluate and returns a JSON string of
// [{header: text}]. Table view: rows = rowsSelector, cells = td/th in order, labels = headers or the
// table's own th. Block view: cellSelectors[i] resolved relative to each row. Written against the
// smallest DOM surface (querySelectorAll, querySelector, textContent) so a stub can unit test it.
export function READ_ROWS(doc, view) {
  var rows = doc.querySelectorAll(view.rowsSelector || 'table tr');
  var headers = (view.headers || []).slice();
  var sels = view.cellSelectors || null;
  function txt(el) {
    if (!el) return '';
    try {
      if (typeof el.cloneNode === 'function') {
        var clone = el.cloneNode(true);
        var junk = clone.querySelectorAll ? clone.querySelectorAll('script, style, noscript, template') : [];
        for (var j = 0; j < junk.length; j++) junk[j].remove();
        return String(clone.textContent || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
      }
    } catch (e) {}
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }
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
      /* A HEADER ROW RENDERED IN CELLS IS NOT DATA. Some tables (DataTables' fixed header, a
       * radiology list) repeat their column labels as a row of <td>s; read as a record it became
       * eight "studies" called Patient ID, Age / Gender, ... (iPhone, 2026-09-15). When every cell
       * of a row is one of the table's own labels, skip it. */
      if (filled && headers.length) {
        var labelHits = 0, labelNorm = headers.map(function (h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); });
        for (var lk in rec) { if (lk.charAt(0) !== '_' && labelNorm.indexOf(String(rec[lk]).toLowerCase().replace(/[^a-z0-9]/g, '')) >= 0) labelHits++; }
        if (labelHits === filled) continue;
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

/* THE DOCUMENT THE TABLE IS ACTUALLY IN. A frameset EMR keeps every clinical screen in a child frame,
 * so reading `document` there reads the <frameset> itself and finds nothing. `framePath` is the list
 * of frame indexes the crawl recorded when it captured the view; an absent or unreachable path falls
 * back to the top document, which is what almost every EMR needs. */
export function FRAME_DOC(path) {
  var win = window;
  var list = path || [];
  for (var i = 0; i < list.length; i++) {
    try {
      var next = win.frames[list[i]];
      if (!next || !next.document) return document;
      win = next;
    } catch (e) { return document; } // cross-origin: not ours to read
  }
  try { return win.document || document; } catch (e) { return document; }
}

export function readRowsExpression(view) {
  const safe = { rowsSelector: view.rowsSelector, headers: view.headers || [], cellSelectors: view.cellSelectors || null };
  const path = Array.isArray(view.framePath) ? view.framePath.slice(0, 3) : [];
  return `(${String(READ_ROWS)})((${String(FRAME_DOC)})(${JSON.stringify(path)}),${JSON.stringify(safe)})`;
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
// A view whose data call was proven wins over an unproven one for the same resource.
/* THE VIEW THAT ACTUALLY READ ROWS WINS. A run can end with two views claiming the same resource: the
 * owner's live run produced two worklists (762 rows and 3), two patient-details and two lab views, one
 * of which had read nothing (2026-09-18). Keeping whichever came first would show the doctor three
 * patients instead of the whole ward, or an empty lab list, from an adapter that looks approved.
 * Verification already recorded what each view read for real patients (view.verified), so that decides;
 * proof only breaks the tie when nothing was verified. */
export function viewRank(view) {
  if (!view) return -1;
  const v = view.verified;
  const rows = v ? Math.max(0, Number(v.rows) || 0) : 0;
  let tier = 0;
  if (v && v.ok && rows > 0) tier = 3;              // read real rows for a real patient
  else if (view.proof && view.proof.status === 'proven') tier = 2;
  else if (rows > 0) tier = 1;
  // Within a tier the view that read MORE real rows wins: the ward list that answered 762 patients is
  // the adapter, not the one that answered 3.
  return tier * 1e9 + Math.min(rows, 1e9 - 1);
}

export function viewsByResource(replay) {
  const by = {};
  for (const v of Array.isArray(replay) ? replay : []) {
    const r = String(v.resourceHint || v.resource || 'unknown');
    if (!by[r] || viewRank(v) > viewRank(by[r])) by[r] = v;
  }
  return by;
}

/**
 * activationEndpoints(replay) -> { view, endpoints }: every proven prerequisite that is keyed on the
 * patient alone (its fields come from the ward list, a token, a constant, or nothing), one per
 * method+path, in replay order. A prerequisite keyed on a detail row (a result id) is a chain step of
 * that view, not a patient activation, and stays with its view.
 */
export function endpointKey(e) { return String((e && e.method) || 'GET') + ' ' + String((e && e.path) || '').split('?')[0]; }

export function activationEndpoints(replay) {
  const seen = new Set();
  const endpoints = [];
  let view = null;
  for (const v of Array.isArray(replay) ? replay : []) {
    if (!provenView(v)) continue;
    for (const e of v.endpoints || []) {
      if (!e || e.role !== 'prerequisite') continue;
      if (Object.values(e.params || {}).some((src) => src && src.from && src.from !== 'worklist')) continue;
      const k = endpointKey(e);
      if (seen.has(k)) continue;
      seen.add(k);
      endpoints.push(e);
      if (!view) view = v;
    }
  }
  return { view, endpoints };
}

/** A view discovery proved: its data call is known and was replayed against the screen. */
export function provenView(v) {
  return !!(v && v.proof && v.proof.status === 'proven' && Array.isArray(v.endpoints) && v.endpoints.some((e) => e && e.role === 'data'));
}

function pathToUrl(origin, path) {
  if (!path) return origin;
  if (/^https?:/i.test(path)) return path;
  return origin.replace(/\/$/, '') + (path.charAt(0) === '/' ? '' : '/') + path;
}

async function settle(ms) { await new Promise((r) => setTimeout(r, ms)); }

/* A DataTables page length control: pick its largest option (or "All", value -1) so ONE read sees the
 * whole list rather than the first ten rows. Silent when the page has no such control. */
export const EXPAND_PAGE_LENGTH = "(function(){try{var dt=window.jQuery&&window.jQuery('table.dataTable, #data_tables1').DataTable?window.jQuery('table.dataTable, #data_tables1').DataTable():null;if(dt){try{dt.page.len(-1).draw();return 'dt-all';}catch(e){}}var s=document.querySelector('select[name$=\"_length\"]');if(!s)return '0';var best=null;[].forEach.call(s.options,function(o){var n=parseInt(o.value,10);if(isNaN(n))return;if(n===-1){best=-1;return;}if(best!==-1&&(best===null||n>best))best=n;});if(best===null)return '0';s.value=String(best);s.dispatchEvent(new Event('change',{bubbles:true}));return '1'}catch(e){return 'e'}})()";

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

/* THE DATA HOST IS WHERE THE VIEW WAS SEEN, NOT WHERE THE DOCTOR SIGNED IN. GHIS signs in on
 * gimsrlogin.gitam.edu and serves every screen from ghis.gitam.edu; joining the recorded calls to the
 * login host failed every replay in Ward Sync and in verification (Pixel, 2026-09-13). */
export function viewOrigin(view, fallback) {
  try { const u = new URL(String(view && (view.pathTemplate || view.path) || '')); if (/^https:$/.test(u.protocol)) return u.origin; } catch { /* relative */ }
  return fallback;
}

/* MULTI-HOSPITAL DATA ORIGIN. An approved adapter may declare where its data lives:
 * view.dataOrigin (the data host outright) or view.redirectOriginMap ({ loginHost: dataHost }).
 * Either wins over the recorded path; otherwise the view's own host stands, with the standing
 * GIMSR alias (sign-in on gimsrlogin, data on ghis) preserved. viewOrigin() above is unchanged
 * for backwards compatibility; this is the resolver the read paths use. */
export function resolveDataOrigin(view, origins, fallback) {
  try {
    const d = view && (view.dataOrigin || view.data_origin);
    if (d) {
      try { return new URL(String(d)).origin; } catch { /* relative-ish: fall through */ }
      if (typeof d === 'string' && d) return d.replace(/\/$/, '');
    }
    const map = view && (view.redirectOriginMap || view.redirect_origin_map);
    if (map && typeof map === 'object') {
      const cands = [];
      if (fallback) cands.push(fallback);
      if (Array.isArray(origins)) cands.push(...origins);
      else if (origins) cands.push(origins);
      try { cands.push(new URL(String((view && (view.pathTemplate || view.path)) || '')).origin); } catch { /* relative */ }
      for (const c of cands) {
        let h = '';
        try { h = new URL(String(c)).host; } catch { h = String(c || ''); }
        if (h && map[h]) {
          try { return new URL(String(map[h])).origin; } catch { return String(map[h]); }
        }
      }
    }
  } catch { /* fall through to the default below */ }
  const base = viewOrigin(view, fallback);
  if (isGimsrOrigin(base)) return 'https://ghis.gitam.edu';
  return base;
}

export async function readView({ plugin, origin, view, settleMs = 1500, maxWaitMs = 20000, pollMs = 1000, navigate = true, toggleAll = false }) {
  origin = resolveDataOrigin(view, null, origin);
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
      if (t === 'ticked' || t === 'clicked') {
        await settle(settleMs);
        try { await plugin.evaluate({ expression: EXPAND_PAGE_LENGTH }); } catch {}
        await settle(settleMs);
        continue;
      }
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
export async function readWorklist({ plugin, origin, replay, settleMs, onRead, maxWaitMs }) {
  const views = viewsByResource(replay);
  const view = views.worklist || views.patient;
  if (!view) throw new Error('the approved adapter has no worklist view');
  if (view.block) throw new Error('the worklist view is a report block, not a table');
  let rows = null;
  /* Every worklist view with a data call is tried (a crawl can record the OPD list and the ward list
   * both). Rows that are not patients (a doctor list, a dashboard count) are not a ward: next call,
   * then the page. */
  const candidates = (Array.isArray(replay) ? replay : []).filter((v) => v && v.resourceHint === 'worklist' && !v.block && Array.isArray(v.endpoints) && v.endpoints.length)
    .sort((a, b) => viewRank(b) - viewRank(a));
  for (const cand of candidates.length ? candidates : [view]) {
    let got = null;
    try { got = await replayFirst({ plugin, origin, view: cand, patient: {}, onRead }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; got = null; }
    if (got && mapRows(got).length) { rows = got; break; }
  }
  if (!rows) {
    /* NO SCRAPE FOR AN ENDPOINT ADAPTER (owner, 2026-09-16). A proven worklist, or one that recorded
     * any endpoint, that returns nothing is a drift, not a licence to read the page: it goes to repair,
     * which re-proves a backend request. Only a worklist with no endpoint at all (a DOM-only EMR) is
     * read from its page, the one labeled last resort. */
    if (provenView(view) || (Array.isArray(view.endpoints) && view.endpoints.length)) {
      throw new Error('no patient rows found at ' + (view.pathTemplate || view.path || origin) + ' through the proven request; the hospital layout may have changed');
    }
    rows = await readView({ plugin, origin, view, settleMs, toggleAll: true, maxWaitMs: maxWaitMs || 20000 });
    if (onRead) onRead({ resource: 'worklist', via: 'page', url: view.pathTemplate || view.path });
  }
  const patients = mapRows(rows);
  if (!patients.length) throw new Error('no patient rows found at ' + (view.pathTemplate || view.path || origin) + ' (' + rows.length + ' rows read, none with a name or id)');
  return patients;
}

// A patient's views (medications, labs, radiology, history, discharge): each becomes a titled section
// of [{header: text}] rows. Path placeholders ({id}, {mrn}, :id, #) are filled with the patient id.
export const DETAIL_RESOURCES = Object.freeze(['medications', 'labs', 'radiology', 'history', 'discharge', 'patient']);
const MAX_DETAIL_ROWS = 15;
const DETAIL_CHAIN_WIDTH = 4;   // detail rows read at once; one session carries them (hand-built getOpdProfile)

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

export async function readPatientDetails({ plugin, origin, replay, patient, settleMs, maxWaitMs = 8000, onRead }) {
  /* NO HOSPITAL IS SPECIAL HERE. The views are exactly what discovery proved for this hospital; the
   * runtime never injects an endpoint it knows from elsewhere (owner, 2026-09-13: GHIS is the test,
   * not the target). What discovery did not prove is read from the page or reported missing. */
  const views = viewsByResource(replay);
  const sections = [];
  /* THE PATIENT IS ACTIVATED FIRST, ONCE. GHIS keeps the current patient in its server-side session: the
   * hand-built adapter posts Searchnew (recordNo=MR-visit) before every read. Discovery proved that POST
   * as a prerequisite of whichever view the crawl or the doctor happened to open first (ver_64609954:
   * the 'patient' view and the guided labs view only), while the labs and medicines views picked for
   * reading carry none, so every read went out unactivated and the drawer showed empty tables for
   * every patient (owner's iPhone, 2026-09-17). Every proven, patient-level prerequisite of this adapter
   * runs once here, before the reads, exactly as the page ran it. */
  const activation = activationEndpoints(replay);
  const activated = new Set(activation.endpoints.map(endpointKey));
  // A view's own copy of an activation already posted is not posted again: once per patient.
  const afterActivation = (v) => (activated.size && Array.isArray(v.endpoints))
    ? Object.assign({}, v, { endpoints: v.endpoints.filter((e) => !(e && e.role === 'prerequisite' && activated.has(endpointKey(e)))) })
    : v;
  if (activation.endpoints.length) {
    const ar = await import('./adapter-runtime.mjs');
    try {
      await ar.executeProven({ plugin, origin: resolveDataOrigin(activation.view, null, origin), view: { pathTemplate: activation.view.pathTemplate, resourceHint: 'patient', proof: { status: 'proven' }, endpoints: activation.endpoints }, patient });
    } catch (e) {
      /* An activation this patient's row cannot fill (UnscopedRequest), or one the hospital refused or
       * redirected: the reads still go out and answer for themselves. A session that is really gone
       * refuses every read below, which is where it is said. */
    }
  }
  /* THE THREE READS RUN TOGETHER. The hand-built adapter's getOpdProfile issues labs, radiology and
   * medicines in parallel from its one session; the doctor waits for the slowest read, not the sum.
   * Each resource is one task; the sections come back in the fixed DETAIL_RESOURCES order. */
  async function readOne(r) {
    const out = [];
    const v = views[r];
    if (!v) return out;
    /* NEVER A PAGE. A screen discovery could not prove is reported unreadable, never loaded and scraped:
     * reading GHIS pages for one patient sat on a two-link menu for 30 minutes on the owner's iPhone
     * (2026-09-15). The hand-built adapter never loads a page either. */
    if (!provenView(v)) { out.push({ resource: r, unreadable: 'not-proven' }); return out; }
    let replayed = null;
    const vo = resolveDataOrigin(v, null, origin);
    try { replayed = await replayFirst({ plugin, origin: vo, view: afterActivation(v), patient, onRead }); } catch (e) {
      /* A REDIRECT FROM ONE CALL IS THAT CALL'S ANSWER. GHIS answers GetInitialAssessmentnew with a 302
       * to SSO in every session (the hand-built adapter notes it and reads the rest regardless). One
       * resource's login answer is recorded on that resource; the session is gone only when every
       * read says so (checked after all of them). */
      if (e && e.name === 'NotSignedIn') { out.push({ resource: r, error: String(e.message || e), login: true }); return out; }
      if (e && e.name === 'UnscopedRequest') { out.push({ resource: r, unreadable: 'not-scoped' }); return out; }
      out.push({ resource: r, error: String((e && e.message) || e) });
      return out;
    }
    if (replayed) {
      out.push(withRoles({ resource: r, rows: replayed, via: 'endpoint' }, v));
      /* THE CHAIN: a proven detail view (one lab result, one radiology report) is read for each row of
       * this list, its fields filled from that row (render id, result id). */
      const d = views[r + '-detail'];
      if (d && d.detailOf === r && d.proof && d.proof.status === 'proven') {
        const ar = await import('./adapter-runtime.mjs');
        const detailRows = [];
        /* The list field the detail call was proven to send (its render id, its result id): the key
         * that ties each detail row back to its list row. Learned, never a guessed column name. */
        const keyField = (d.endpoints || []).flatMap((e) => Object.values(e.params || {})).map((s) => s && s.field).find((f) => typeof f === 'string' && f) || null;
        /* THE CHAIN FANS OUT. Up to 15 rows were read one after the other (15 round trips per resource
         * per patient); they are read DETAIL_CHAIN_WIDTH at a time now, and the rows keep the list order. */
        const readRow = async (row, rowIndex) => {
          let got = null;
          /* A row whose chain key is missing is skipped, not guessed at and not fatal: the other rows
           * of this list are still read (adapter-runtime brokenChainField). */
          try { got = await ar.executeView({ plugin, origin: resolveDataOrigin(d, null, origin), view: d, patient, parentRow: row }); } catch (e) {
            if (e && e.name === 'NotSignedIn') return { stop: true };   // the detail chain stops; the list itself was read
            got = null;
          }
          // The row's title: prefer description / study / parameter / test name over IDs / numeric strings
          let title = '';
          for (const k of Object.keys(row)) {
            if (k.charAt(0) === '_') continue;
            if (/description|study|test_?desc|examination|procedure|parameter|service_?name/i.test(k)) {
              const val = String(row[k] == null ? '' : row[k]).trim();
              if (val) { title = val; break; }
            }
          }
          if (!title) {
            title = Object.keys(row).filter((k) => k.charAt(0) !== '_' && !/\bid\b|code|visit|mrn/i.test(k))
              .map((k) => String(row[k] == null ? '' : row[k]).trim())
              .find((v) => v && !/^\d+$/.test(v)) || '';
          }
          const rowKey = keyField ? String(row[keyField] == null ? '' : row[keyField]) : '';
          return { rows: ((got && got.rows) || []).map((dr) => Object.assign({ _of: title, _key: rowKey, _rowIndex: rowIndex }, dr)) };
        };
        const chainRows = replayed.slice(0, MAX_DETAIL_ROWS);
        for (let at = 0; at < chainRows.length; at += DETAIL_CHAIN_WIDTH) {
          const batch = await Promise.all(chainRows.slice(at, at + DETAIL_CHAIN_WIDTH).map((row, i) => readRow(row, at + i)));
          for (const b of batch) if (b.rows) detailRows.push(...b.rows);
          if (batch.some((b) => b.stop)) break;
        }
        if (detailRows.length) { out.push(withRoles({ resource: r + '-detail', rows: detailRows, via: 'endpoint' }, d)); if (onRead) onRead({ resource: r + '-detail', via: 'endpoint' }); }
      }
      return out;
    }
    // Proven, and this patient has none (no medicines charted): an empty answer, not a missing one.
    out.push(withRoles({ resource: r, rows: [], via: 'endpoint' }, v));
    return out;
  }
  const results = await Promise.all(DETAIL_RESOURCES.map(readOne));
  for (const part of results) sections.push(...part);
  const attempted = sections.filter((x) => x.rows || x.error);
  if (attempted.length && attempted.every((x) => x.login)) {
    const ar = await import('./adapter-runtime.mjs');
    throw new ar.NotSignedIn(attempted[0].error);
  }
  return sections;
}

/** role -> screen header, from the brain's column roles the view recorded (view.fieldHints: header -> role). */
export function rolesOf(view) {
  const fh = view && view.fieldHints && typeof view.fieldHints === 'object' ? view.fieldHints : null;
  const out = {};
  if (!fh) return out;
  for (const h of Object.keys(fh)) { const role = fh[h]; if (typeof role === 'string' && role && !(role in out)) out[role] = h; }
  return out;
}

/** Attach the section's column roles only when the view carried some (an empty map is left off). */
function withRoles(section, view) {
  const roles = rolesOf(view);
  if (Object.keys(roles).length) section.roles = roles;
  return section;
}
