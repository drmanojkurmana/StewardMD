// connect-agent/phone/ghis-shim.mjs - answers the hand-built GHIS proxy's endpoints from an agent-built
// adapter's views, so every screen that reads /api/ghis (Ward Sync drawers, the patient workspace and
// its Assess tab, medication review) works unchanged against ANY approved hospital adapter.
//
// Pure: `sections` is what runtime.mjs readPatientDetails() returned for one patient
// ([{ resource, rows: [{header: text}] }]) and `patients` the mapped ward rows. Cell text stays on the
// phone: this module only reshapes it for the app's own screens. Shapes mirror
// functions/api/ghis/[[path]].js field for field (see the survey in the Connect Agent vault note).

const RX = {
  name: /test|investigation|service|parameter|item|description|study|examination|procedure|title|subject/i,
  date: /date|time|reported|collected|\bon\b/i,
  status: /status/i,
  dept: /dept|department|section/i,
  result: /result|value|finding/i,
  units: /unit/i,
  range: /range|reference|normal|biological/i,
  low: /\blow\b|\bmin/i,
  high: /\bhigh\b|\bmax/i,
  drug: /drug|medicine|medication|product\s*name|item|generic|brand/i,
  code: /code/i,
  dosage: /dos/i,
  route: /route/i,
  freq: /freq/i,
  duration: /duration|days|period/i,
  text: /report|impression|finding|note|summary|text|remark|complaint|diagnos|plan|assessment|history/i,
  by: /doctor|\bby\b|author|consultant|physician|entered/i,
  visit: /visit|episode|admission|encounter|ip\s*no/i,
};

function col(row, re, not) {
  for (const k of Object.keys(row || {})) {
    if (k.charAt(0) === '_') continue;
    if (re.test(k) && !(not && not.test(k))) { const v = String(row[k] == null ? '' : row[k]).trim(); if (v) return v; }
  }
  return '';
}
function firstText(row) {
  for (const k of Object.keys(row || {})) { if (k.charAt(0) === '_') continue; const v = String(row[k] == null ? '' : row[k]).trim(); if (v && !/^\d+$/.test(v)) return v; }
  return '';
}
function rowsOf(sections, resource) {
  const s = (sections || []).find((x) => x && x.resource === resource && Array.isArray(x.rows));
  return s ? s.rows : [];
}
function looksLikeResultTable(rows) {
  return rows.some((r) => col(r, RX.result) && (col(r, RX.units) || col(r, RX.range) || col(r, RX.name)));
}

/** GET /lab -> { orders } and GET /lab-detail -> { group, tests } from the adapter's labs view. */
export function labOrders(sections, patient) {
  const rows = rowsOf(sections, 'labs');
  if (!rows.length) return { orders: [] };
  const episodeId = (patient && patient.episodeId) || '';
  if (looksLikeResultTable(rows)) {
    // A flat results table (test, result, units, range): one order per distinct group or date, all
    // its rows as tests. GHIS style two-level (order list -> detail) collapses to that.
    const groups = new Map();
    rows.forEach((r) => {
      const key = col(r, RX.dept) + '|' + col(r, RX.date);
      if (!groups.has(key)) groups.set(key, { key, date: col(r, RX.date), dept: col(r, RX.dept), rows: [] });
      groups.get(key).rows.push(r);
    });
    const orders = [...groups.values()].map((g, i) => ({
      serviceName: g.rows.length === 1 ? (col(g.rows[0], RX.name) || firstText(g.rows[0])) : (g.dept || 'Laboratory') + ' (' + g.rows.length + ' tests)',
      orderDate: g.date, department: g.dept, status: col(g.rows[0], RX.status) || 'Reported',
      renderId: 'a' + i, episodeId, orderId: 'a' + i, valueType: '',
    }));
    return { orders, detailOf: (renderId) => detailFor([...groups.values()][Number(String(renderId).slice(1))] || null) };
  }
  const orders = rows.map((r, i) => ({
    serviceName: col(r, RX.name) || firstText(r), orderDate: col(r, RX.date), department: col(r, RX.dept),
    status: col(r, RX.status), renderId: 'a' + i, episodeId, orderId: 'a' + i, valueType: '',
  }));
  /* The proven chain (runtime readPatientDetails): each order's own result rows, read through the
   * detail call with that order's render id, tagged `_of` with the order's title. */
  const detailRows = rowsOf(sections, 'labs-detail');
  return { orders, detailOf: (renderId) => {
    const i = Number(String(renderId).slice(1));
    const r = rows[i];
    if (!r) return null;
    const title = firstText(r);
    const own = detailRows.filter((d) => d._of === title);
    return detailFor({ dept: col(r, RX.dept), date: col(r, RX.date), rows: own.length ? own : [r] });
  } };
}
function detailFor(g) {
  if (!g) return null;
  return {
    group: g.rows.length === 1 ? (col(g.rows[0], RX.name) || firstText(g.rows[0])) : (g.dept || 'Laboratory'),
    department: g.dept || '', sampleType: '', collected: g.date || '', reported: g.date || '',
    tests: g.rows.map((r) => {
      const low = col(r, RX.low), high = col(r, RX.high), range = col(r, RX.range) || ((low || high) ? low + ' - ' + high : '');
      return { test: col(r, RX.name) || firstText(r), result: col(r, RX.result, RX.units), units: col(r, RX.units), low, high, range, critical: '', method: '', valueType: '', antibiogram: '' };
    }),
  };
}

/** GET /radiology -> { orders }; GET /radiology-report -> the report text of one row. */
export function radiologyOrders(sections, patient) {
  const rows = rowsOf(sections, 'radiology');
  const orders = rows.map((r, i) => ({
    resultid: 'a' + i, visitId: col(r, RX.visit) || ((patient && patient.episodeId) || ''), date: col(r, RX.date),
    description: col(r, RX.name) || firstText(r) || 'Radiology', printType: 'manual',
  }));
  return {
    orders,
    reportOf: (resultid) => {
      const r = rows[Number(String(resultid).slice(1))];
      if (!r) return { error: 'parse' };
      const own = rowsOf(sections, 'radiology-detail').filter((d) => d._of === firstText(r));
      if (own.length) return { testName: col(r, RX.name) || firstText(r), report: own.map((d) => col(d, RX.text) || Object.keys(d).filter((k) => k.charAt(0) !== '_').map((k) => k + ': ' + d[k]).join('\n')).join('\n'), orderDate: col(r, RX.date), reported: col(own[0], RX.date) || col(r, RX.date), doctor: col(own[0], RX.by) || col(r, RX.by), enteredBy: '' };
      return { testName: col(r, RX.name) || firstText(r), report: col(r, RX.text, RX.name) || Object.keys(r).filter((k) => k !== '_href' && k !== '_args').map((k) => k + ': ' + r[k]).join('\n'), orderDate: col(r, RX.date), reported: col(r, RX.date), doctor: col(r, RX.by), enteredBy: '' };
    },
  };
}

/** GET /medications -> { rows } in the proxy's row shape. */
export function medicationRows(sections) {
  return { rows: rowsOf(sections, 'medications').map((r) => ({
    productCode: col(r, RX.code), drugText: col(r, RX.drug, RX.code) || firstText(r), route: col(r, RX.route),
    dosage: col(r, RX.dosage), frequency: col(r, RX.freq), duration: col(r, RX.duration), dept: '', dateTime: col(r, RX.date),
  })).filter((m) => m.drugText) };
}

/** GET /history -> { entries } from notes, history and discharge views (each row one entry). */
export function historyEntries(sections, patient) {
  const entries = [];
  for (const res of ['notes', 'history', 'discharge']) {
    for (const r of rowsOf(sections, res)) {
      const text = col(r, RX.text) || Object.keys(r).filter((k) => k !== '_href' && k !== '_args').map((k) => k + ': ' + r[k]).join('. ');
      if (!text) continue;
      const date = col(r, RX.date);
      entries.push({ visitId: col(r, RX.visit) || ((patient && patient.episodeId) || ''), by: col(r, RX.by), text: ((date ? date + ' ' : '') + (res === 'discharge' ? 'Discharge summary: ' : '') + text).slice(0, 6000) });
    }
  }
  return { entries };
}

/**
 * serveGhisProxy({ method, path, patients, sections, patient }) -> { status, body } | null
 * `path` is the proxy path with query (e.g. "/lab?patientId=MR1"). null = not an endpoint this shim
 * answers (let the real proxy have it). `sections` may be null for endpoints that need no patient.
 */
export function serveGhisProxy({ method = 'GET', path, patients = [], sections = null, patient = null }) {
  const seg = String(path || '').replace(/^\//, '').split('?')[0];
  const q = new URLSearchParams(String(path || '').split('?')[1] || '');
  const M = String(method || 'GET').toUpperCase();
  if (M === 'POST') {
    if (seg === 'login' || seg === 'refresh' || seg === 'logout' || seg === 'staff-login') return null;
    return { status: 501, body: { error: 'emr_write_disabled', detail: 'This hospital is read through an approved adapter; writing back to its EMR is not enabled.' } };
  }
  switch (seg) {
    case 'status': return { status: 200, body: { connected: true, userId: 'adapter' } };
    case 'patients': return { status: 200, body: patients };
    case 'opd-patients': return { status: 200, body: { rows: [] } };
    case 'demographics': return { status: 200, body: { phone: '', region: '' } };
    case 'assessment': return { status: 200, body: { fields: [], authorized: null, raw: '', htmlLen: 0 } };
    case 'inv-search': case 'drug-search': return { status: 200, body: { rows: [] } };
    case 'lab': return { status: 200, body: { orders: labOrders(sections, patient).orders } };
    case 'lab-detail': { const d = labOrders(sections, patient); const det = d.detailOf ? d.detailOf(q.get('renderId')) : null; return { status: 200, body: det || { group: '', department: '', tests: [] } }; }
    case 'radiology': return { status: 200, body: { orders: radiologyOrders(sections, patient).orders } };
    case 'radiology-report': return { status: 200, body: radiologyOrders(sections, patient).reportOf(q.get('resultid')) };
    case 'medications': return { status: 200, body: medicationRows(sections) };
    case 'history': return { status: 200, body: historyEntries(sections, patient) };
    case 'profile': return { status: 200, body: { labs: labOrders(sections, patient).orders, radiology: radiologyOrders(sections, patient).orders, medications: medicationRows(sections).rows, phone: '' } };
    default: return null;
  }
}

/** Which endpoints need the patient's detail views read first. */
export function needsPatientSections(path) {
  const seg = String(path || '').replace(/^\//, '').split('?')[0];
  return ['lab', 'lab-detail', 'radiology', 'radiology-report', 'medications', 'history', 'profile'].includes(seg);
}
export function patientIdOf(path) {
  return new URLSearchParams(String(path || '').split('?')[1] || '').get('patientId') || '';
}
