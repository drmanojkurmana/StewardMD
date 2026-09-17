// connect-agent/phone/gold-audit.mjs - THE HAND-BUILT GHIS INTEGRATION IS THE GOLD STANDARD.
//
// VERIFICATION ONLY. Discovery never imports this file and never sees GOLD_UPSTREAM: the agent finds
// its endpoints on its own (prove.mjs); this module only grades the result, for the same patients,
// against functions/api/ghis/[[path]].js (the owner's reverse-engineered proxy):
//   endpoint by endpoint  the adapter's proven call per view vs the call the proxy makes upstream,
//   field by field        the adapter's answer (reshaped by ghis-shim.mjs, as every app screen sees it)
//                         vs the proxy's answer, row matched to row.
// The report carries counts and names only, never a value, so it can be pasted anywhere.

/* What the hand-built proxy calls upstream for each view (read from functions/api/ghis/[[path]].js). */
export const GOLD_UPSTREAM = Object.freeze({
  worklist: 'GET /Doctor/Home/GetIPWL',
  patient: 'POST /Doctor/Home/Searchnew',
  labs: 'POST /Lab/Home/GetSearchPatientId',
  'labs-detail': 'POST /Lab/Home/GetPrintLabResultDetailsAuth',
  radiology: 'GET /Radio/Home',
  'radiology-detail': 'GET /Radiology/Home/GetRadiologyResultPrint',
  medications: 'GET /Doctor/Home/GetMedicines/',
  history: 'GET /Doctor/Home/Getopcard',
});

/* Each proxy endpoint: the view it comes from, how rows are listed, the key a row is matched on, and
 * the fields graded. Shapes as functions/api/ghis returns them. */
export const GOLD_ENDPOINTS = Object.freeze([
  { endpoint: 'patients', view: 'worklist', list: (b) => (Array.isArray(b) ? b : []), key: ['patientId'], fields: ['patientId', 'episodeId', 'patientFirstName', 'gender', 'bedName', 'deptDescription', 'employeeFirstName'] },
  { endpoint: 'medications', view: 'medications', list: (b) => (b && b.rows) || [], key: ['drugText'], fields: ['productCode', 'drugText', 'route', 'dosage', 'frequency', 'duration', 'dateTime'] },
  { endpoint: 'lab', view: 'labs', list: (b) => (b && b.orders) || [], key: ['serviceName', 'orderDate'], fields: ['serviceName', 'orderDate', 'department', 'status'] },
  { endpoint: 'lab-detail', view: 'labs-detail', list: (b) => (b && b.tests) || [], key: ['test'], fields: ['test', 'result', 'units', 'range'] },
  { endpoint: 'radiology', view: 'radiology', list: (b) => (b && b.orders) || [], key: ['description', 'date'], fields: ['description', 'date', 'visitId'] },
  { endpoint: 'radiology-report', view: 'radiology-detail', list: (b) => (b && !b.error ? [b] : []), key: ['testName'], fields: ['testName', 'report', 'reported', 'doctor'] },
  { endpoint: 'history', view: 'history', list: (b) => (b && b.entries) || [], key: ['text'], fields: ['visitId', 'by', 'text'] },
]);

function n(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* THE SAME DAY WRITTEN TWO WAYS IS THE SAME DAY. Two adapters reading one hospital field print it
 * however their own code prints it: 01/02/2026, 2026-02-01, 1-Feb-2026. Stripping punctuation is not
 * enough, and parsing is worse than useless here - 01/02/2026 is January 2nd to Date.parse and
 * February 1st to the hospital that wrote it, so a parse would call two identical dates different
 * and, occasionally, two different dates the same. Comparing the NUMBERS PRESENT, without caring
 * which is the day and which the month, is the honest test: it cannot be fooled by field order and
 * it never invents a match between dates that do not share their parts. A time, when both carry one,
 * has to agree too. Used only after the plain comparison has already failed. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateParts(v) {
  let s = String(v == null ? '' : v);
  // "1-Feb-2026" is the same day as "2026-02-01"; a month name carries a number, it just does not show it.
  s = s.replace(/[a-z]+/gi, (w) => {
    const i = MONTHS.indexOf(w.slice(0, 3).toLowerCase());
    return i >= 0 && w.length <= 9 ? ' ' + (i + 1) + ' ' : ' ';
  });
  // A zero part says nothing: "10:30:00" is the moment "10:30" is, and midnight is the day itself.
  const nums = (s.match(/\d+/g) || []).map((x) => Number(x)).filter((x) => x !== 0);
  if (nums.length < 3) return null;                       // not a date: two numbers cannot be one
  if (!nums.some((x) => x >= 1000 && x <= 3000)) return null; // no year, no date
  return nums.slice().sort((a, b) => a - b).join('.');
}

/** Same value, allowing for one adapter writing a date in a different order than the other. */
function sameValue(x, y, rawX, rawY) {
  if (x && x === y) return true;
  if (x && y && x.length > 40 && y.length > 40 && (x.includes(y.slice(0, 40)) || y.includes(x.slice(0, 40)))) return true;
  if (!x || !y) return false;
  const dx = dateParts(rawX), dy = dateParts(rawY);
  return !!dx && dx === dy;
}
function keyOf(row, key) { return key.map((k) => n(row[k]).slice(0, 60)).join('|'); }

/** compareRows(spec, goldBody, adapterBody) -> PHI-free grade for one endpoint and one patient. */
export function compareRows(spec, goldBody, adapterBody) {
  const gold = spec.list(goldBody);
  const mine = spec.list(adapterBody);
  const byKey = new Map();
  for (const r of mine) { const k = keyOf(r, spec.key); if (!byKey.has(k)) byKey.set(k, r); }
  const fields = {};
  // Per field, how many of the rows the adapter DID return carried a gold value: the yardstick for
  // "the rows it returned are right", which fields[f].gold (every gold row) can never be on a short list.
  const matchedGold = {};
  for (const f of spec.fields) { fields[f] = { gold: 0, adapter: 0, equal: 0 }; matchedGold[f] = 0; }
  let matched = 0;
  for (const g of gold) {
    const a = byKey.get(keyOf(g, spec.key));
    for (const f of spec.fields) if (n(g[f])) fields[f].gold += 1;
    if (!a) continue;
    matched += 1;
    for (const f of spec.fields) {
      if (n(g[f])) matchedGold[f] += 1;
      if (n(a[f])) fields[f].adapter += 1;
      // A long text field (a report) counts as equal when one contains the other.
      const x = n(g[f]), y = n(a[f]);
      if (sameValue(x, y, g[f], a[f])) fields[f].equal += 1;
    }
  }
  const filled = spec.fields.filter((f) => fields[f].gold > 0);
  const fieldsSame = filled.every((f) => fields[f].equal === fields[f].gold);
  // A short list is only a clean subset when every row it DID return agrees field for field.
  const matchedFieldsSame = spec.fields.every((f) => fields[f].equal === matchedGold[f]);
  /* A SUBSET IS A FAILURE WITH ITS OWN NAME (owner, 2026-09-16). An adapter that returns some of the
   * ward is more dangerous than one that returns none: the missing patients look like patients who do
   * not exist. It is never folded into "partial". */
  let verdict;
  if (!gold.length && !mine.length) verdict = 'both-empty';
  else if (!mine.length) verdict = 'missing';
  else if (matched === gold.length && mine.length === gold.length && fieldsSame) verdict = 'same';
  else if (mine.length < gold.length && matched === mine.length && matchedFieldsSame) verdict = 'subset';
  else verdict = 'partial';
  return { endpoint: spec.endpoint, gold: gold.length, adapter: mine.length, matched, missing: Math.max(0, gold.length - matched), fields, verdict };
}

function callOf(view) {
  const d = view && Array.isArray(view.endpoints) ? view.endpoints.find((e) => e && e.role === 'data') || view.endpoints[view.endpoints.length - 1] : null;
  return d ? d.method + ' ' + String(d.path || '').split('?')[0] : null;
}
function sameCall(a, b) { return !!a && !!b && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase(); }

/** endpointAudit(replay) -> [{ view, gold, adapter, same, proof }]: which call the adapter proved per view. */
export function endpointAudit(replay) {
  const views = Array.isArray(replay) ? replay : [];
  return Object.keys(GOLD_UPSTREAM).map((name) => {
    const cands = views.filter((v) => v && v.resourceHint === name);
    const view = cands.find((v) => v.proof && v.proof.status === 'proven') || cands[0] || null;
    const adapter = callOf(view);
    return { view: name, gold: GOLD_UPSTREAM[name], adapter, same: sameCall(adapter, GOLD_UPSTREAM[name]), proof: view && view.proof ? { status: view.proof.status, overlap: view.proof.overlap, brain: view.proof.brain, model: view.proof.model } : null };
  });
}

/**
 * runGoldAudit({ replay, gold, adapter, patientIds }) -> { endpoints, patients: [{ fields per endpoint }] }
 * `gold(path)` fetches the hand-built proxy (e.g. "/lab?patientId=..."); `adapter(path)` answers the same
 * path from the approved adapter (ghis-shim serveGhisProxy over runtime reads). Both run on the phone.
 */
export async function runGoldAudit({ replay, gold, adapter, patientIds = [] }) {
  const report = { endpoints: endpointAudit(replay), worklist: null, patients: [] };
  const [gp, ap] = await Promise.all([gold('/patients').catch(() => []), adapter('/patients').catch(() => [])]);
  report.worklist = compareRows(GOLD_ENDPOINTS[0], gp, ap);
  const pids = patientIds.length ? patientIds : (Array.isArray(gp) ? gp.slice(0, 2).map((p) => p.patientId) : []);
  for (let i = 0; i < pids.length; i += 1) {
    const pid = encodeURIComponent(pids[i]);
    const g = Array.isArray(gp) ? gp.find((p) => String(p.patientId) === String(pids[i])) : null;
    const q = 'patientId=' + pid + (g && g.episodeId ? '&episodeId=' + encodeURIComponent(g.episodeId) : '') + (g && g.visitId ? '&visitId=' + encodeURIComponent(g.visitId) : '');
    const grades = [];
    const pair = async (path) => Promise.all([gold(path).catch(() => null), adapter(path).catch(() => null)]);
    for (const spec of GOLD_ENDPOINTS.slice(1)) {
      if (spec.endpoint === 'lab-detail' || spec.endpoint === 'radiology-report') continue;
      const [gb, ab] = await pair('/' + spec.endpoint + '?' + q);
      grades.push(compareRows(spec, gb, ab));
      // The chains: the first order's detail, matched by title across the two sides.
      if (spec.endpoint === 'lab' || spec.endpoint === 'radiology') {
        const detail = GOLD_ENDPOINTS.find((s) => s.endpoint === (spec.endpoint === 'lab' ? 'lab-detail' : 'radiology-report'));
        const go = spec.list(gb)[0];
        const ao = go ? spec.list(ab).find((o) => keyOf(o, spec.key) === keyOf(go, spec.key)) : null;
        if (!go) { grades.push({ endpoint: detail.endpoint, gold: 0, adapter: 0, matched: 0, fields: {}, verdict: 'both-empty' }); continue; }
        const gPath = spec.endpoint === 'lab' ? '/lab-detail?renderId=' + encodeURIComponent(go.renderId) + '&episodeId=' + encodeURIComponent(go.episodeId || '') : '/radiology-report?resultid=' + encodeURIComponent(go.resultid) + '&type=' + encodeURIComponent(go.printType || '');
        const aPath = !ao ? null : (spec.endpoint === 'lab' ? '/lab-detail?' + q + '&renderId=' + encodeURIComponent(ao.renderId) : '/radiology-report?' + q + '&resultid=' + encodeURIComponent(ao.resultid));
        const [gd, ad] = await Promise.all([gold(gPath).catch(() => null), aPath ? adapter(aPath).catch(() => null) : null]);
        grades.push(compareRows(detail, gd, ad));
      }
    }
    report.patients.push({ patient: i + 1, grades });
  }
  return report;
}
