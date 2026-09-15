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
  low: /\blow\b|^low(value|limit|range)?$|\bmin|lower/i,
  high: /\bhigh\b|^high(value|limit|range)?$|\bmax|upper/i,
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

/* EXACT BEATS FUZZY. A payload that carries ResultDate, Result_Type and Result answers "result" with
 * the key named exactly `result`, not whichever fuzzy match came first in key order (that is how a
 * live adapter read 0 of 14 lab values right, 2026-09-15). Exact match on the bare word first, then the
 * fuzzy fallback for views no brain mapped. */
function col(row, re, not) {
  const keys = Object.keys(row || {}).filter((k) => k.charAt(0) !== '_');
  const word = String(re.source).replace(/^[^a-z]*/i, '').match(/^[a-z]+/i);
  if (word) {
    const exact = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === word[0].toLowerCase() && !(not && not.test(k)));
    if (exact) { const v = String(row[exact] == null ? '' : row[exact]).trim(); if (v) return v; }
  }
  for (const k of keys) {
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
/* LEARNED BEFORE GUESSED. A section carries the column roles the brain named for the screen the rows
 * came from (role -> header, runtime rolesOf). pick() reads that header first; the key-name regex is
 * only the fallback for a view no brain mapped. A payload whose ValueType or LowValue precedes Result
 * cannot pass one of them off as the result once "Result" is a learned column. */
function rolesFor(sections, resource) {
  const s = (sections || []).find((x) => x && x.resource === resource);
  return s && s.roles && typeof s.roles === 'object' ? s.roles : {};
}
function pick(row, roles, role, re, not) {
  const h = roles && roles[role];
  if (h && row && row[h] != null) { const v = String(row[h]).trim(); if (v) return v; }
  return re ? col(row, re, not) : '';
}
function looksLikeResultTable(rows, roles) {
  return rows.some((r) => pick(r, roles, 'result', RX.result) && (pick(r, roles, 'unit', RX.units) || pick(r, roles, 'reference', RX.range) || pick(r, roles, 'testName', RX.name)));
}

/** GET /lab -> { orders } and GET /lab-detail -> { group, tests } from the adapter's labs view. */
export function labOrders(sections, patient) {
  const rows = rowsOf(sections, 'labs');
  if (!rows.length) return { orders: [] };
  const roles = rolesFor(sections, 'labs');
  const droles = rolesFor(sections, 'labs-detail');
  const episodeId = (patient && patient.episodeId) || '';
  if (looksLikeResultTable(rows, roles)) {
    // A flat results table (test, result, units, range): one order per distinct group or date, all
    // its rows as tests. GHIS style two-level (order list -> detail) collapses to that.
    const groups = new Map();
    rows.forEach((r) => {
      const key = pick(r, roles, 'department', RX.dept) + '|' + pick(r, roles, 'date', RX.date);
      if (!groups.has(key)) groups.set(key, { key, date: pick(r, roles, 'date', RX.date), dept: pick(r, roles, 'department', RX.dept), rows: [], roles });
      groups.get(key).rows.push(r);
    });
    const orders = [...groups.values()].map((g, i) => ({
      serviceName: g.rows.length === 1 ? (pick(g.rows[0], roles, 'testName', RX.name) || firstText(g.rows[0])) : (g.dept || 'Laboratory') + ' (' + g.rows.length + ' tests)',
      orderDate: g.date, department: g.dept, status: col(g.rows[0], RX.status) || 'Reported',
      renderId: 'a' + i, episodeId, orderId: 'a' + i, valueType: '',
    }));
    return { orders, detailOf: (renderId) => detailFor([...groups.values()][Number(String(renderId).slice(1))] || null) };
  }
  const orders = rows.map((r, i) => ({
    serviceName: pick(r, roles, 'testName', RX.name, /\bid\b|code/i) || pick(r, roles, 'title') || firstText(r), orderDate: pick(r, roles, 'date', RX.date), department: pick(r, roles, 'department', RX.dept),
    status: col(r, RX.status), renderId: 'a' + i, episodeId, orderId: 'a' + i, valueType: '',
  }));
  /* The proven chain (runtime readPatientDetails): each order's own result rows, read through the
   * detail call with that order's render id, tagged with the order's index (`_rowIndex`), its traced
   * key (`_key`) and its title (`_of`). Index first: two orders of the same panel on different days
   * share a title, and matching on it once lumped 42 tests under a 14-test order (2026-09-14). */
  const detailRows = rowsOf(sections, 'labs-detail');
  return { orders, detailOf: (renderId) => {
    const i = Number(String(renderId).slice(1));
    const r = rows[i];
    if (!r) return null;
    const title = pick(r, roles, 'testName', RX.name, /\bid\b|code/i) || firstText(r);
    const byIndex = detailRows.filter((d) => d._rowIndex === i);
    const own = byIndex.length ? byIndex : detailRows.filter((d) => d._of === title);
    return detailFor({ dept: pick(r, roles, 'department', RX.dept), date: pick(r, roles, 'date', RX.date), rows: own.length ? own : [r], roles: own.length ? droles : roles });
  } };
}
/* ANALYTE NORMALIZATION. Hospitals label the same test many ways ("Hb", "HB%", "PLT",
 * "K+", "Sr Creatinine"); the Ward Sync drawers, the ICU dashboard, the clinical calculators
 * and Dx "Import Patient" all match on full analyte names, so a short form would silently
 * drop the value and force manual entry. Each canonical name below is exactly a string
 * those consumers already match. Every rule is anchored (a longer panel name never matches)
 * with an exclusion guard (MCH, HbA1c, plateletcrit/MPV, urine/clearance, vitamin K are never
 * renamed): anything doubtful passes through untouched. */
const ANALYTE_ALIASES = [
  [/^(hb|hgb|haemoglobin|hemoglobin)(\s*%|\s*\([^)]*\))?$/i, 'Haemoglobin', /a1c|glycosylated|glycated|corpuscular|\bmchc?\b|reticulocyte|electrophoresis|fetal|\bhbf\b|thalassemia|variant/i],
  [/^(plt|platelets?(\s*count)?|thrombocytes?(\s*count)?)$/i, 'Platelet Count', /crit|mpv|pdw|volume|distribution|width|immature|fraction|large|mean/i],
  [/^.*\bwbc\b.*$/i, 'WBC', /differential|urine|urin|csf|vaginal|cervical|stool|hpf|pus/i],
  [/^(w\.?\s*b\.?\s*c\.?|white\s*blood\s*(cell|corpuscle)s?\s*(count)?|total\s*(leukocyte|leucocyte|white\s*(cell|blood))s?\s*(count)?)$/i, 'WBC', /differential|urine|urin|csf|hpf/i],
  [/^(k\+?|potassium|serum\s*k\+?|s\.?\s*(sr\.?\s*)?potassium)$/i, 'Potassium', /vitamin|urine|urin|spot|24|clearance|ratio/i],
  [/^(na\+?|sodium|serum\s*na\+?|s\.?\s*(sr\.?\s*)?sodium)$/i, 'Sodium', /urine|urin|spot|fractional|24|clearance|ratio/i],
  [/^((s|sr|serum)\.?\s+)?creatinine(\s*\([^)]*\))?$/i, 'Creatinine', /urin|clearance|ratio|egfr|24\s*h/i],
];

/** A raw hospital test label -> the canonical analyte name every consumer matches, or itself. */
export function normalizeAnalyte(name) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  for (const [re, canonical, ex] of ANALYTE_ALIASES) {
    if (re.test(s) && !ex.test(s)) return canonical;
  }
  return s;
}

/* VALUE NORMALIZATION. Indian reports group thousands ("1,41,000"): parseFloat reads that as
 * 1, so a platelet count would file as profound thrombocytopenia. Strip thousand-separator
 * commas only when what remains is a plain number; narrative results ("NEGATIVE", "5-8/hpf")
 * pass through untouched. */
export function normalizeResult(value) {
  const s = String(value == null ? '' : value).trim();
  if (s.indexOf(',') >= 0 && /^[\d,]+(\.\d+)?$/.test(s)) {
    const plain = s.replace(/,/g, '');
    if (plain && isFinite(Number(plain))) return plain;
  }
  return s;
}

/* CANONICAL LAB NAMES. StewardMD's 130+ risk calculators (MELD, Child-Pugh, AKI, CURB-65, NEWS2,
 * qSOFA, ...) and the ICU Lab Watch look for standard analyte keys or common synonyms, so every
 * test object carries BOTH the hospital's own label (`test`, untouched) and the canonical key
 * (`canonical`). This is separate from normalizeAnalyte above (which renames only the few short
 * forms the Ward Sync drawers prove they need and deliberately passes lookalikes such as TC and
 * Urea through): canonicalLabName maps the full clinical synonym sets the calculators accept.
 * Lookup is on the whole label only, never a substring, so a panel name never misfires; anything
 * unrecognized passes through trimmed, never dropped. */
const CANONICAL_LAB_SYNONYMS = [
  ['Haemoglobin', ['hb', 'hgb', 'haemoglobin', 'hemoglobin']],
  ['Platelet Count', ['plt', 'platelet', 'platelets', 'platelet count', 'platelets count', 'platelets counts', 'thrombocyte', 'thrombocytes', 'thrombocyte count', 'thrombocytes count']],
  ['WBC', ['wbc', 'w b c', 'white blood cell', 'white blood cells', 'white blood cell count', 'white blood cells count', 'total count', 'total leukocyte count', 'total leucocyte count', 'total leucocytes count', 'total leukocytes count', 'tc']],
  ['Creatinine', ['creatinine', 'serum creatinine', 's creatinine', 'sr creatinine', 'blood creatinine']],
  ['Urea', ['urea', 'serum urea', 's urea', 'blood urea', 'blood urea nitrogen', 'bun']],
  ['Sodium', ['sodium', 'serum sodium', 's sodium', 'sr sodium', 'na', 'na+']],
  ['Potassium', ['potassium', 'serum potassium', 's potassium', 'sr potassium', 'k', 'k+']],
  ['Total Bilirubin', ['bilirubin', 'total bilirubin', 'bilirubin total', 'tbil', 't bil', 'serum bilirubin']],
  ['Direct Bilirubin', ['direct bilirubin', 'dbil', 'd bil', 'conjugated bilirubin']],
  ['AST', ['ast', 'sgot']],
  ['ALT', ['alt', 'sgpt']],
  ['Albumin', ['albumin', 'serum albumin', 's albumin', 'sr albumin']],
  ['INR', ['inr', 'pt/inr', 'pt inr', 'prothrombin time']],
];
const CANONICAL_LAB_LOOKUP = new Map();
for (const [canonical, synonyms] of CANONICAL_LAB_SYNONYMS) {
  for (const synonym of synonyms) CANONICAL_LAB_LOOKUP.set(synonym, canonical);
}

/** Fold a raw hospital test label to the lookup form: lowercased, parentheticals and stray
 * punctuation dropped, whitespace collapsed. `+` and `/` survive (Na+, K+, PT/INR). */
function labLookupKey(name) {
  return String(name == null ? '' : name).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9+/]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** A raw hospital test label -> the canonical analyte key calculators match, or the label itself
 * (trimmed) when it names no known analyte. Pure. */
export function canonicalLabName(name) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return CANONICAL_LAB_LOOKUP.get(labLookupKey(s)) || s;
}

/* NUMERIC RESULTS. Reports arrive with units or comparison prefixes ("12.4 gm/dl", "< 0.1",
 * "> 400", "1,41,000"), which calculators cannot compare until the number is out. numResult
 * returns that number, or null when the result is narrative ("NEGATIVE") or a range ("5-8/hpf"):
 * a range is not a value and must never file as its first number. Pure. */
export function numResult(val) {
  if (typeof val === 'number') return isFinite(val) ? val : null;
  let s = String(val == null ? '' : val).trim();
  if (!s) return null;
  s = s.replace(/^[<>=≤≥~≈\s]+/, '').replace(/,/g, '');
  const m = /^(-?\d+(?:\.\d+)?)([\s\S]*)$/.exec(s);
  if (!m) return null;
  if (/\d/.test(m[2])) return null;
  const n = Number(m[1]);
  return isFinite(n) ? n : null;
}

export function detailFor(g) {
  if (!g) return null;
  const R = g.roles || {};
  return {
    group: g.rows.length === 1 ? (pick(g.rows[0], R, 'testName', RX.name, /\bid\b|code/i) || firstText(g.rows[0])) : (g.dept || 'Laboratory'),
    department: g.dept || '', sampleType: '', collected: g.date || '', reported: g.date || '',
    tests: g.rows.map((r) => {
      const low = col(r, RX.low), high = col(r, RX.high), range = pick(r, R, 'reference', RX.range) || ((low || high) ? low + ' - ' + high : '');
      const name = pick(r, R, 'testName', RX.name, /\bid\b|code/i) || firstText(r);
      const result = normalizeResult(pick(r, R, 'result', RX.result, RX.units));
      return { test: name, canonical: canonicalLabName(name), result, numValue: numResult(result), units: pick(r, R, 'unit', RX.units), low, high, range, critical: '', method: pick(r, R, 'method'), valueType: '', antibiogram: '' };
    }),
  };
}
/* detailFor answers GET /lab-detail through labOrders().detailOf; getLabDetail is the same shape
 * under the name adapter authors reach for first. */
export { detailFor as getLabDetail };

/* RADIOLOGY REPORT SECTIONS. Hospital reports arrive as one flat text block; on a phone the
 * doctor needs the answer (IMPRESSION) and the evidence (FINDINGS) as separate readable
 * sections. Headings are matched case-insensitively on their own line ("IMPRESSION:"), with
 * an inline fallback ("... FINDINGS: ... IMPRESSION: ...") for single-line manual prints.
 * The raw `report` field is untouched: Dx and ICU keep reading it as context. */
const REPORT_HEADINGS = [
  [/^(clinical\s*(history|details|information|presentation)|history|indications?|clinical\s*notes?)$/i, 'History'],
  [/^(technique|protocol|method|procedure|examination|study\s*protocol)$/i, 'Technique'],
  [/^(comparison|priors?|previous( study)?)$/i, 'Comparison'],
  [/^(findings?|observations?|description|radiological\s*findings?)$/i, 'Findings'],
  [/^(impression|conclusion|opinion|diagnos(is|tic impression)|summary)$/i, 'Impression'],
  [/^(advice|recommendations?|follow[\s-]?up|notes?|remarks?)$/i, 'Advice'],
];

function headingOf(line) {
  const s = String(line || '').replace(/\s+/g, ' ').trim().replace(/:\s*$/, '').trim();
  if (!s || s.length > 40) return null;
  for (const [re, canonical] of REPORT_HEADINGS) if (re.test(s)) return canonical;
  return null;
}

/** Flat report text -> [{ heading, body }]. [] when the text carries no headings. Pure. */
export function parseReportSections(report) {
  const text = String(report || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const headAt = lines.map(headingOf);
  if (!headAt.some(Boolean)) {
    // Single-line manual print: split on inline "HEADING:" markers when present.
    const marks = [];
    const re = /(impression|findings?|observations?|conclusion|opinion|advice|recommendations?|technique|comparison|history|indications?)\s*:/gi;
    let m;
    while ((m = re.exec(text)) && marks.length < 12) marks.push({ index: m.index, heading: headingOf(m[1]) || m[1], end: m.index + m[0].length });
    if (!marks.length) return [];
    const out = [];
    const pre = text.slice(0, marks[0].index).trim();
    if (pre) out.push({ heading: 'Details', body: pre });
    marks.forEach((k, i) => {
      const body = text.slice(k.end, i + 1 < marks.length ? marks[i + 1].index : text.length).trim();
      if (body) out.push({ heading: k.heading, body });
    });
    return out;
  }
  const out = [];
  let pre = [];
  let cur = null;
  lines.forEach((line, i) => {
    const h = headAt[i];
    if (h) {
      if (cur && cur.body.length) out.push({ heading: cur.heading, body: cur.body.join('\n').trim() });
      else if (!cur && pre.join('\n').trim()) out.push({ heading: 'Details', body: pre.join('\n').trim() });
      cur = { heading: h, body: [] };
      pre = [];
    } else if (cur) cur.body.push(line);
    else pre.push(line);
  });
  if (cur && cur.body.join('\n').trim()) out.push({ heading: cur.heading, body: cur.body.join('\n').trim() });
  return out.filter((s) => s.body);
}

/** One named section's body from parseReportSections(), or ''. */
export function sectionBody(sections, heading) {
  const s = (Array.isArray(sections) ? sections : []).find((x) => x && x.heading === heading);
  return s ? s.body : '';
}

/** GET /radiology -> { orders }; GET /radiology-report -> the report text of one row. */
/* A HEADER ROW IS NOT A STUDY. A radiology list read from a page can leak its column labels as a row
 * ({col0:'Patient ID'}, {col1:'Age / Gender'}, ...): every value is a label that also names a column
 * somewhere in the rows. Those rows are dropped, as is any "order" with neither a date nor a title
 * beyond a label - the live drawer once showed eight such "studies" for a patient with none. */
function dropHeaderRows(rows) {
  const labels = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (k.charAt(0) !== '_') labels.add(String(k).toLowerCase().replace(/[^a-z0-9]/g, ''));
  return rows.filter((r) => {
    const vals = Object.keys(r).filter((k) => k.charAt(0) !== '_').map((k) => String(r[k] == null ? '' : r[k]).trim()).filter(Boolean);
    if (!vals.length) return false;
    return !vals.every((v) => labels.has(v.toLowerCase().replace(/[^a-z0-9]/g, '')));
  });
}

export function radiologyOrders(sections, patient) {
  const rows = dropHeaderRows(rowsOf(sections, 'radiology'));
  const titleOf = (r) => col(r, /description|study|test_?desc|examination|procedure/i) || col(r, RX.name, /\bid\b|code/i) || firstText(r) || 'Radiology';
  /* The hand-built proxy's radiology orders carry no status field: mirror it exactly. */
  const orders = rows.map((r, i) => ({
    resultid: 'a' + i, visitId: col(r, RX.visit) || ((patient && patient.episodeId) || ''), date: col(r, RX.date),
    description: titleOf(r), printType: 'manual',
  }));
  return {
    orders,
    reportOf: (resultid) => {
      const r = rows[Number(String(resultid).slice(1))];
      if (!r) return { error: 'parse' };
      const title = titleOf(r);
      const own = rowsOf(sections, 'radiology-detail').filter((d) => d._of === title || d._of === firstText(r) || d.testdesc === title || d.test_desc === title || (r['Service ID'] && (d._key === String(r['Service ID']) || d.resultid === String(r['Service ID']))) || d._rowIndex === Number(String(resultid).slice(1)));
      if (own.length) {
        const d = own[0];
        const rep = d.report || d.result || d.final_rad_result || col(d, RX.text) || '';
        const raw = rep || Object.keys(d).filter((k) => k.charAt(0) !== '_').map((k) => k + ': ' + d[k]).join('\n');
        const parts = parseReportSections(raw);
        return {
          testName: title,
          report: raw,
          impression: sectionBody(parts, 'Impression'),
          findings: sectionBody(parts, 'Findings'),
          sections: parts,
          orderDate: d.orderDate || d.order_date || col(d, RX.date) || col(r, RX.date),
          reported: d.reported || d.result_enteredtime || d.entered_time || col(d, RX.date) || col(r, RX.date),
          doctor: d.doctor || d.doctor_name || col(d, RX.by) || col(r, RX.by),
          enteredBy: d.enteredBy || d.generated_by_name || ''
        };
      }
      const rep = r.report || r.result || r.final_rad_result || col(r, RX.text, /description|service|visit/i);
      const raw = rep || Object.keys(r).filter((k) => k !== '_href' && k !== '_args' && !/id$|code/i.test(k)).map((k) => k + ': ' + r[k]).join('\n');
      const parts = parseReportSections(raw);
      return {
        testName: title,
        report: raw,
        impression: sectionBody(parts, 'Impression'),
        findings: sectionBody(parts, 'Findings'),
        sections: parts,
        orderDate: col(r, RX.date),
        reported: col(r, RX.date),
        doctor: col(r, RX.by),
        enteredBy: ''
      };
    },
  };
}

/** GET /medications -> { rows } in the proxy's row shape. */
export function medicationRows(sections) {
  /* The hand-built proxy's medication rows carry no status field: mirror it exactly. */
  const R = rolesFor(sections, 'medications');
  return { rows: rowsOf(sections, 'medications').map((r) => ({
    productCode: pick(r, R, 'prodCode', RX.code), drugText: pick(r, R, 'drugName', RX.drug, RX.code) || firstText(r), route: pick(r, R, 'route', RX.route),
    dosage: pick(r, R, 'dosage', RX.dosage), frequency: pick(r, R, 'frequency', RX.freq), duration: pick(r, R, 'duration', RX.duration), dept: '', dateTime: pick(r, R, 'date', RX.date),
  })).filter((m) => m.drugText) };
}

/**
 * Strips script tags, JS code remnants, unrendered jQuery template interpolation strings,
 * comments, and HTML tags from raw clinical text scraped from hospital pages.
 */
export function cleanClinicalText(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  s = s.replace(/\$\([^)]*\)[^;\n]*/g, ' ');
  s = s.replace(/function\s+[a-zA-Z0-9_$]*\s*\([^)]*\)\s*\{[\s\S]*?\}/g, ' ');
  s = s.replace(/\bvar\s+[a-zA-Z0-9_$]+\s*=[\s\S]*?;/g, ' ');
  s = s.replace(/["']\s*\+\s*[a-zA-Z0-9_$.[\]()]+\s*\+\s*["']/g, ' ');
  s = s.replace(/["']\s*\+\s*[a-zA-Z0-9_$.[\]()]+/g, ' ');
  s = s.replace(/[a-zA-Z0-9_$.[\]()]+\s*\+\s*["']/g, ' ');
  s = s.replace(/window\.(location|replace|open|parent|top)[^;\n]*/gi, ' ');
  s = s.replace(/document\.(getElementById|querySelector|querySelectorAll)[^;\n]*/gi, ' ');
  s = s.replace(/console\.[a-z]+\([^)]*\)/g, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (/^[;{}(),.=\-_+/\\]+$/.test(s) || s.length < 2) return '';
  return s;
}

/** GET /history -> { entries } from notes, history and discharge views (each row one entry). */
export function historyEntries(sections, patient) {
  const entries = [];
  for (const res of ['notes', 'history', 'discharge']) {
    for (const r of rowsOf(sections, res)) {
      const rawText = col(r, RX.text) || Object.keys(r).filter((k) => k !== '_href' && k !== '_args').map((k) => k + ': ' + r[k]).join('. ');
      const text = cleanClinicalText(rawText);
      if (!text || text.length < 3) continue;
      const date = col(r, RX.date);
      entries.push({ visitId: col(r, RX.visit) || ((patient && patient.episodeId) || ''), by: col(r, RX.by), date: date || '', text: ((date ? date + ' ' : '') + (res === 'discharge' ? 'Discharge summary: ' : '') + text).slice(0, 6000) });
    }
  }
  return { entries };
}

/* ABSENT IS NOT NEGATIVE (rulebook 5.2). A resource the adapter could not read says so, so "no
 * medicines" on screen always means the hospital has none. */
export function notRead(sections, resource, label) {
  const own = (Array.isArray(sections) ? sections : []).filter((s) => s && s.resource === resource);
  if (own.some((s) => Array.isArray(s.rows))) return {};
  const why = own.some((s) => s.unreadable === 'not-scoped')
    ? 'the agent never learned which field carries the patient, so the request could not be limited to this patient.'
    : own.some((s) => s.error) ? 'the hospital did not answer.' : 'the agent never learned this screen for this hospital. Run Connect Hospital again to teach it.';
  return { unreadable: label + ' were not read: ' + why };
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
    case 'lab': return { status: 200, body: Object.assign({ orders: labOrders(sections, patient).orders }, notRead(sections, 'labs', 'Lab results')) };
    case 'lab-detail': { const d = labOrders(sections, patient); const det = d.detailOf ? d.detailOf(q.get('renderId')) : null; return { status: 200, body: det || { group: '', department: '', tests: [] } }; }
    case 'radiology': return { status: 200, body: Object.assign({ orders: radiologyOrders(sections, patient).orders }, notRead(sections, 'radiology', 'Radiology reports')) };
    case 'radiology-report': return { status: 200, body: radiologyOrders(sections, patient).reportOf(q.get('resultid')) };
    case 'medications': return { status: 200, body: Object.assign(medicationRows(sections), notRead(sections, 'medications', 'Medications')) };
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
