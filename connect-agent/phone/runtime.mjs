// connect-agent/phone/runtime.mjs - replays an APPROVED adapter on the phone for Ward Sync.
//
// The server keeps an adapter's observedViews (PHI-free selectors + column labels, see CONTRACT.md)
// and hands them back as `replay` on GET /versions/:id. This module walks them in the doctor's own
// ConnectBrowser session: navigate to the view, read the rows, map the cells by header label into
// the row shape ghis-ward.js renderPatients() already draws. Cell TEXT exists only here, on the phone.
// Reads are navigation + evaluate only; anything on the crawler's read-only SKIP list is never clicked.

const GIMSR_HOSTS = ['gimsrlogin.gitam.edu', 'ghis.gitam.edu'];

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
export function mapRow(row) {
  const out = { patientId: '', episodeId: '', patientFirstName: '', dob: '', gender: '', bedName: '', deptDescription: '', employeeFirstName: '', queueStatus: '' };
  const dest = { mrn: 'patientId', episode: 'episodeId', name: 'patientFirstName', age: 'dob', gender: 'gender', bed: 'bedName', dept: 'deptDescription', doctor: 'employeeFirstName', status: 'queueStatus' };
  for (const key of Object.keys(row || {})) {
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
export async function readView({ plugin, origin, view, settleMs = 1500, maxWaitMs = 20000, pollMs = 1000 }) {
  await plugin.navigate({ url: pathToUrl(origin, view.pathTemplate || view.path) });
  await settle(settleMs);
  try { await plugin.evaluate({ expression: EXPAND_PAGE_LENGTH }); } catch { /* not a DataTable: read as is */ }
  const started = Date.now();
  let rows = [];
  for (;;) {
    const res = await plugin.evaluate({ expression: readRowsExpression(view) });
    try { rows = JSON.parse((res && res.result) || '[]'); } catch { throw new Error('the page returned no readable rows (bad JSON from the reader)'); }
    rows = Array.isArray(rows) ? rows : [];
    if (rows.length || Date.now() - started >= maxWaitMs) break;
    await settle(pollMs);
  }
  return rows;
}

// The ward list. Throws with a reason the UI can show verbatim.
export async function readWorklist({ plugin, origin, replay, settleMs }) {
  const views = viewsByResource(replay);
  const view = views.worklist || views.patient;
  if (!view) throw new Error('the approved adapter has no worklist view');
  if (view.block) throw new Error('the worklist view is a report block, not a table');
  const rows = await readView({ plugin, origin, view, settleMs });
  const patients = mapRows(rows);
  if (!patients.length) throw new Error('no patient rows found at ' + (view.pathTemplate || view.path || origin) + ' (' + rows.length + ' rows read, none with a name or id)');
  return patients;
}

// A patient's views (medications, labs, radiology, history, discharge): each becomes a titled section
// of [{header: text}] rows. Path placeholders ({id}, {mrn}, :id, #) are filled with the patient id.
export const DETAIL_RESOURCES = Object.freeze(['medications', 'labs', 'radiology', 'history', 'discharge', 'patient']);

export function fillPath(path, patient) {
  const id = encodeURIComponent(patient.patientId || '');
  return String(path || '').replace(/\{[^}]*\}|:[a-z_]+id\b|#+/gi, id);
}

export async function readPatientDetails({ plugin, origin, replay, patient, settleMs }) {
  const views = viewsByResource(replay);
  const sections = [];
  for (const r of DETAIL_RESOURCES) {
    const v = views[r];
    if (!v) continue;
    const view = Object.assign({}, v, { pathTemplate: fillPath(v.pathTemplate || v.path, patient) });
    let rows = [];
    try { rows = await readView({ plugin, origin, view, settleMs }); } catch (e) { sections.push({ resource: r, error: e.message }); continue; }
    sections.push({ resource: r, rows });
  }
  return sections;
}
