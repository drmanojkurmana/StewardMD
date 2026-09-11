// connect-agent/manifest/infer-html.mjs -- auto-generate responseFormat:'html' adapter operations from
// crawler-observed server-rendered EMR views, so no human hand-authors the extraction rules.
//
// The whole job is deterministic and closed: a header-label -> canonical-field map (mirroring the
// hand-built fieldFor in functions/api/ghis/[[path]].js), turned into htmlExtract cell/onclick rules plus
// a closed-transform mapping. It NEVER invents a field: a resource whose required canonical fields cannot
// all be sourced is reported in `unsupported` instead of emitted as a broken operation, and it never
// emits regex/code (only pick/map/toNumber/const) or a write method. Everything it emits is built to pass
// validateOperation/validateManifest and to feed extractRecords/normalizeOperation unchanged.
//
// No prototype pollution: emitted object keys are drawn only from a fixed vocabulary of role/canonical
// names, never from raw (attacker-influenced) header text, and hostile labels are dropped.
import { isValidSelector } from './html.mjs';
import { templatePlaceholders } from './schema.mjs';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Assign only vetted keys onto an emitted object. Header text never reaches here as a key -- roles and
// canonical field names are fixed literals -- but this refuses a forbidden key as defense in depth.
// The schema requires pathTemplate to be an absolute path (no scheme/host/query/fragment). The crawler
// reports a view's location as a full URL, so reduce it to its pathname; anything unparseable falls to '/'.
function toPathTemplate(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  if (raw[0] === '/' && !/[?#]/.test(raw)) return raw;
  try { return new URL(raw).pathname || '/'; } catch { return '/'; }
}

function addKey(obj, key, value) {
  if (FORBIDDEN_KEYS.has(key)) return;
  obj[key] = value;
}

// Header-label classifier, mirroring functions/api/ghis/[[path]].js#fieldFor: lowercase, strip to a-z,
// then first matching rule wins. 'doctor' is FIRST so "Doctor name" is a guard, never the patient name.
// Resource-specific columns (drug/lab) are matched before the generic demographic columns.
const HEADER_RULES = [
  [/doctor|consultant|physician|practitioner/, 'doctor'],
  [/prod.*code/, 'prodCode'],
  [/drugname|drug|medicine/, 'drugName'],
  [/route/, 'route'],
  [/dosage|^dose/, 'dosage'],
  [/frequency|^freq/, 'frequency'],
  [/duration/, 'duration'],
  [/testname/, 'testName'],
  [/method/, 'method'],
  [/result/, 'result'],
  [/unit/, 'unit'],
  [/reference|biological/, 'reference'],
  [/patientid|^mrn|uhid/, 'patientId'],
  [/visitid|episode|opno|visitno/, 'visitId'],
  [/patientname|^name$|^pname/, 'name'],
  [/department|dept/, 'department'],
  [/^age/, 'age'],
  [/gender|^sex/, 'sex'],
  [/bed/, 'bed'],
  [/visittype|optype/, 'visitType'],
  [/report|impression|finding/, 'report'],
  [/title|subject/, 'title'],
  [/date/, 'date'],
];

function classify(label) {
  if (typeof label !== 'string' || FORBIDDEN_KEYS.has(label)) return null;
  const t = label.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  for (const [re, role] of HEADER_RULES) if (re.test(t)) return role;
  return null;
}

// headers[] -> { role: firstColumnIndex }. First column to claim a role wins (matches the fieldFor row
// builder), so a later "Doctor name" cannot overwrite an earlier patient name.
function roleIndex(headers) {
  const map = Object.create(null);
  headers.forEach((label, i) => {
    const role = classify(label);
    if (role && !(role in map)) map[role] = i;
  });
  return map;
}

function sexMap() {
  const table = Object.create(null);
  for (const k of ['Male', 'MALE', 'male', 'M', 'm']) table[k] = 'male';
  for (const k of ['Female', 'FEMALE', 'female', 'F', 'f']) table[k] = 'female';
  return { op: 'map', path: 'sex', table, default: 'other' };
}

function classMap() {
  const table = Object.create(null);
  for (const k of ['IP', 'ip', 'Inpatient', 'INPATIENT', 'inpatient']) table[k] = 'inpatient';
  for (const k of ['OP', 'op', 'OPD', 'opd', 'Outpatient', 'outpatient']) table[k] = 'outpatient';
  for (const k of ['ER', 'Emergency', 'EMERGENCY', 'emergency']) table[k] = 'emergency';
  return { op: 'map', path: 'visitType', table, default: 'ambulatory' };
}

// resourceHint -> { type, resource }. radiology is decided at build time (structured vs narrative).
function planFor(hint) {
  switch (hint) {
    case 'worklist': return { type: 'list_worklist', resource: 'worklist' };
    case 'patient': return { type: 'get_patient_summary', resource: 'patient' };
    case 'medications': return { type: 'list_medications', resource: 'medications' };
    case 'labs': return { type: 'list_results', resource: 'observations' };
    case 'history': case 'discharge': return { type: 'list_notes', resource: 'documents' };
    case 'encounters': return { type: 'list_encounters', resource: 'encounters' };
    default: return null;
  }
}

// Build mapping.fields for a resource from the recognized roles. Returns { fields, missing, idField }:
//   missing[] = required canonical fields that could not be sourced (view then becomes unsupported).
//   idField   = an htmlExtract rule to add/override for the id source (e.g. onclickArg for a worklist).
function buildMapping(resource, roles, onclick, type, notes) {
  const fields = Object.create(null);
  const missing = [];
  let idField = null;
  const has = (r) => r in roles;

  if (resource === 'worklist' || resource === 'patient') {
    if (onclick) { addKey(fields, 'id', { op: 'pick', path: 'patientId' }); idField = { name: 'patientId', rule: { onclickArg: 0 } }; }
    else if (has('patientId')) addKey(fields, 'id', { op: 'pick', path: 'patientId' });
    else missing.push('id');
    if (has('name')) addKey(fields, 'name', { op: 'pick', path: 'name' });
    else if (resource === 'patient') missing.push('name');
    if (has('age')) addKey(fields, 'age', { op: 'toNumber', path: 'age', unit: 'a' });
    if (has('sex')) addKey(fields, 'gender', sexMap());
    else if (resource === 'patient') missing.push('gender');
    if (has('bed')) addKey(fields, 'bed', { op: 'pick', path: 'bed' });
    if (has('visitId')) addKey(fields, 'visitId', { op: 'pick', path: 'visitId' });
    if (has('department')) addKey(fields, 'department', { op: 'pick', path: 'department' });
  } else if (resource === 'medications') {
    if (has('prodCode')) addKey(fields, 'id', { op: 'pick', path: 'prodCode' }); else missing.push('id');
    if (has('drugName')) addKey(fields, 'medication.text', { op: 'pick', path: 'drugName' }); else missing.push('medication.text');
    addKey(fields, 'status', { op: 'const', value: 'active' });
    if (has('dosage')) addKey(fields, 'dosage', { op: 'pick', path: 'dosage' });
    // route/frequency/duration are recognized (extracted) but have no canonical field, so unmapped.
  } else if (resource === 'observations') {
    if (has('testName')) {
      // No dedicated identifier column on a lab report; the test-name text is the only stable id source.
      addKey(fields, 'id', { op: 'pick', path: 'testName' });
      addKey(fields, 'code.text', { op: 'pick', path: 'testName' });
      notes.push(`${type}: no identifier column; using the test-name text as the record id`);
    } else { missing.push('id'); missing.push('code.text'); }
    if (has('result')) {
      const expr = { op: 'toNumber', path: 'result', unit: '1' };
      if (has('unit')) expr.unitPath = 'unit';
      addKey(fields, 'value.value', expr);
    } else missing.push('value.value');
    addKey(fields, 'category', { op: 'const', value: 'laboratory' });
    addKey(fields, 'status', { op: 'const', value: 'final' });
    if (has('reference')) notes.push(`${type}: reference-range column present but a combined "low - high" string cannot be split by the closed transforms; referenceRange omitted`);
  } else if (resource === 'documents') {
    const titleRole = has('title') ? 'title' : (has('report') ? 'report' : null);
    if (titleRole) { addKey(fields, 'id', { op: 'pick', path: titleRole }); addKey(fields, 'type.text', { op: 'pick', path: titleRole }); }
    else { missing.push('id'); missing.push('type.text'); }
    addKey(fields, 'status', { op: 'const', value: 'final' });
    if (has('date')) addKey(fields, 'date', { op: 'pick', path: 'date' });
  } else if (resource === 'encounters') {
    if (has('visitId')) addKey(fields, 'id', { op: 'pick', path: 'visitId' }); else missing.push('id');
    if (has('visitType')) addKey(fields, 'class', classMap()); else missing.push('class');
    addKey(fields, 'status', { op: 'const', value: 'unknown' });
    if (has('date')) addKey(fields, 'period.start', { op: 'pick', path: 'date' }); else missing.push('period.start');
  }
  return { fields, missing, idField };
}

function uns(capability, reason, observedPath) {
  const u = { capability: String(capability || 'unknown'), reason: String(reason) };
  if (observedPath) u.observedPath = String(observedPath);
  return u;
}

function normalizeSessionExpiry(se) {
  if (se && typeof se === 'object' && Array.isArray(se.statusCodes) && se.statusCodes.length) {
    const out = { statusCodes: se.statusCodes.slice() };
    if (Array.isArray(se.redirectPatterns)) out.redirectPatterns = se.redirectPatterns.slice();
    return out;
  }
  return { statusCodes: [401, 403] };
}

function clampItems(v) {
  const n = Number.isInteger(v) ? v : 500;
  return Math.min(2000, Math.max(1, n));
}

function buildForView(view, ctx) {
  const observedPath = (view && typeof view.pathTemplate === 'string') ? view.pathTemplate : '';
  if (!view || typeof view !== 'object') return { unsupported: uns('unknown', 'view is not an object', observedPath) };

  const headers = Array.isArray(view.headers) ? view.headers : [];
  const roles = roleIndex(headers);

  let plan = planFor(view.resourceHint);
  if (view.resourceHint === 'radiology') {
    plan = ('result' in roles && 'testName' in roles)
      ? { type: 'list_results', resource: 'observations' }
      : { type: 'list_notes', resource: 'documents' };
  }
  if (!plan) return { unsupported: uns(view.resourceHint || 'unknown', `resourceHint '${view.resourceHint}' has no canonical operation`, observedPath) };

  const rows = view.rowsSelector;
  if (typeof rows !== 'string' || !isValidSelector(rows)) return { unsupported: uns(plan.type, `row selector ${JSON.stringify(rows)} is not a supported selector`, observedPath) };

  const onclick = typeof view.onclickTemplate === 'string' && view.onclickTemplate.length > 0;
  const m = buildMapping(plan.resource, roles, onclick, plan.type, ctx.notes);
  if (m.missing.length) return { unsupported: uns(plan.type, `cannot produce required canonical field(s): ${m.missing.join(', ')}`, observedPath) };

  // htmlExtract: one {cell:i} per recognized column (the 'doctor' guard is not extracted), then the id
  // override (onclickArg) where the id comes from an on-click handler rather than a cell.
  const hxFields = Object.create(null);
  for (const role of Object.keys(roles)) {
    if (role === 'doctor') continue;
    addKey(hxFields, role, { cell: roles[role] });
  }
  if (m.idField) addKey(hxFields, m.idField.name, m.idField.rule);

  // The crawler reports a view's location as a full URL; the schema wants an absolute PATH only (no
  // scheme/host/query/fragment). Reduce it here so an inferred op always validates.
  const pathTemplate = toPathTemplate(view.pathTemplate);
  const placeholders = Object.create(null);
  for (const name of templatePlaceholders(pathTemplate)) addKey(placeholders, name, { type: 'id' });

  const op = {
    type: plan.type,
    method: view.method === 'HEAD' ? 'HEAD' : 'GET',
    responseFormat: 'html',
    originId: ctx.originId,
    pathTemplate,
    placeholders,
    allowedQueryKeys: [],
    pagination: { style: 'none', maxPages: 1, maxItems: ctx.maxItems },
    htmlExtract: { rows, fields: hxFields },
    mapping: { resource: plan.resource, fields: m.fields },
    sessionExpiry: ctx.sessionExpiry,
  };
  return { op };
}

/**
 * inferHtmlOperations(observedViews, opts) -> { operations, unsupported, notes }
 * opts: { originId (required), sessionExpiry?, maxItems? }
 * Each operation is a fully-formed, schema-valid responseFormat:'html' operation. Views that cannot be
 * mapped deterministically land in `unsupported`; duplicate operation types are de-duped (richer kept).
 */
export function inferHtmlOperations(observedViews, opts = {}) {
  const ctx = {
    originId: opts.originId,
    sessionExpiry: normalizeSessionExpiry(opts.sessionExpiry),
    maxItems: clampItems(opts.maxItems),
    notes: [],
  };
  const operations = [];
  const unsupported = [];
  const byType = new Map();

  for (const view of Array.isArray(observedViews) ? observedViews : []) {
    const built = buildForView(view, ctx);
    if (built.unsupported) { unsupported.push(built.unsupported); continue; }
    const op = built.op;
    if (byType.has(op.type)) {
      const idx = byType.get(op.type);
      const prev = operations[idx];
      const prevCount = Object.keys(prev.mapping.fields).length;
      const curCount = Object.keys(op.mapping.fields).length;
      if (curCount > prevCount) {
        operations[idx] = op;
        ctx.notes.push(`duplicate ${op.type}: dropped ${prev.pathTemplate}, kept richer ${op.pathTemplate}`);
      } else {
        ctx.notes.push(`duplicate ${op.type}: dropped ${op.pathTemplate}, kept ${prev.pathTemplate}`);
      }
      continue;
    }
    byType.set(op.type, operations.length);
    operations.push(op);
  }
  return { operations, unsupported, notes: ctx.notes };
}
