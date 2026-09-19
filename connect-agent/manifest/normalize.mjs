// connect-agent/manifest/normalize.mjs — mapping-language evaluation -> existing SCCM canonical model.
//
// There is no parallel patient model here: every resource is built with the factories in
// functions/_connect/canonical/*, and the result is checked by the existing validateBundle.
//
// Absent is not negative. Every transform returns { present, value }: a key the source never sent comes
// back `present:false` and the canonical field is OMITTED with a warning, while an explicit null / false /
// empty list is `present:true` and is kept as the negative finding it is. The same distinction is made at
// collection level: "this deployment exposes no allergy endpoint" and "this patient has no allergies" are
// two different warnings, never the same empty array.
import { patient as sccmPatient, encounter, medicationStatement, allergyIntolerance, observation, documentReference, bundle } from '../../functions/_connect/canonical/model.js';
import { codeable, quantity, period, provenance } from '../../functions/_connect/canonical/coding.js';
import { validateBundle } from '../../functions/_connect/canonical/validate.js';

const ABSENT = Object.freeze({ present: false });
const present = (value) => ({ present: true, value });

const OPERATION_RESOURCE = {
  list_worklist: 'worklist', get_patient_summary: 'patient', list_medications: 'medications',
  list_allergies: 'allergies', list_results: 'observations', list_encounters: 'encounters', list_notes: 'documents',
};
const COLLECTION_OF = { medications: 'medications', allergies: 'allergies', observations: 'observations', encounters: 'encounters', documents: 'documents' };

/** Offset of `timeZone` from UTC at `date`, in ms. Uses Intl only: no tz database dependency. */
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = {};
  for (const part of parts) if (part.type !== 'literal') p[part.type] = part.value;
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUTC - date.getTime();
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/** Interpret a source timestamp in an explicitly declared zone. Never guesses a zone. */
export function toInstant(raw, timeZone) {
  const s = String(raw).trim();
  if (HAS_OFFSET.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (!NAIVE.test(s)) return null;
  const dateOnly = !/[T ]/.test(s);
  const guess = Date.parse(`${s.replace(' ', 'T')}${dateOnly ? 'T00:00:00' : ''}${/\d{2}:\d{2}:\d{2}$/.test(s) || dateOnly ? '' : ':00'}Z`);
  if (Number.isNaN(guess)) return null;
  // One refinement pass handles the DST edge where the offset at the guessed instant differs from the
  // offset at the true instant.
  let instant = guess - tzOffsetMs(new Date(guess), timeZone);
  instant = guess - tzOffsetMs(new Date(instant), timeZone);
  return new Date(instant).toISOString();
}

function resolve(item, selector) {
  let node = item;
  for (const seg of selector.split('.')) {
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return ABSENT;
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) return ABSENT;
    node = node[seg];
  }
  return present(node);
}

/**
 * evaluate(expr, item, warn) -> { present, value }
 * Closed vocabulary; anything else is a programming error because the schema validator already rejected it.
 */
export function evaluate(expr, item, warn = () => {}) {
  switch (expr.op) {
    case 'const': return present(expr.value);
    case 'pick': return resolve(item, expr.path);
    case 'coalesce': {
      for (const sub of expr.of) {
        const r = evaluate(sub, item, warn);
        if (r.present && r.value !== null && r.value !== '') return r;
      }
      return ABSENT;
    }
    case 'map': {
      const r = resolve(item, expr.path);
      if (!r.present) return ABSENT;
      const key = String(r.value);
      if (Object.prototype.hasOwnProperty.call(expr.table, key)) return present(expr.table[key]);
      if (expr.default !== undefined) return present(expr.default);
      warn(`unmapped code '${key.slice(0, 32)}' for ${expr.path}`);
      return ABSENT;
    }
    case 'toDate': {
      const r = resolve(item, expr.path);
      if (!r.present || r.value === null || r.value === '') return r.present && r.value === null ? present(null) : ABSENT;
      const iso = toInstant(r.value, expr.timezone);
      if (!iso) { warn(`${expr.path} is not a timestamp this mapping can interpret; omitted`); return ABSENT; }
      return present(iso);
    }
    case 'toNumber': {
      const r = resolve(item, expr.path);
      if (!r.present) return ABSENT;
      if (r.value === null) return present(null);
      const num = typeof r.value === 'number' ? r.value : Number(String(r.value).trim());
      if (!Number.isFinite(num)) { warn(`${expr.path} is not numeric; omitted rather than coerced`); return ABSENT; }
      let unit = expr.unit;
      if (expr.unitPath) {
        const u = resolve(item, expr.unitPath);
        if (u.present && typeof u.value === 'string' && u.value.trim()) unit = u.value.trim();
        else { warn(`${expr.unitPath} carries no unit; value omitted rather than assumed ${expr.unit}`); return ABSENT; }
      }
      return present({ value: num, unit });
    }
    default: return ABSENT;
  }
}

function mapItem(op, item, warnings) {
  const out = {};
  const absent = [];
  for (const [field, expr] of Object.entries(op.mapping.fields)) {
    const r = evaluate(expr, item, (m) => warnings.push(`${op.type}: ${m}`));
    if (!r.present) { absent.push(field); continue; }
    out[field] = r.value;
  }
  return { fields: out, absent };
}

function text(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }

function buildResource(resource, f) {
  const id = text(f.id) || (typeof f.id === 'number' ? String(f.id) : null);
  if (!id) return null;
  if (resource === 'worklist') return { id, ...(text(f.name) ? { name: text(f.name) } : {}) };
  if (resource === 'patient') return sccmPatient({ id, name: text(f.name), gender: text(f.gender) || 'unknown' });
  if (resource === 'medications') {
    const label = text(f['medication.text']);
    if (!label) return null;
    return medicationStatement({ id, medication: codeable({ text: label }), status: text(f.status) || 'unknown', dosage: f.dosage ?? null });
  }
  if (resource === 'allergies') {
    const label = text(f['code.text']);
    if (!label) return null;
    return allergyIntolerance({ id, code: codeable({ text: label }), clinicalStatus: text(f.clinicalStatus) || 'active', criticality: text(f.criticality) || 'unable-to-assess' });
  }
  if (resource === 'observations') {
    const label = text(f['code.text']);
    if (!label) return null;
    const q = f['value.value'];
    const low = f['referenceRange.low'];
    const high = f['referenceRange.high'];
    const range = (low != null || high != null) ? { low: low ?? null, high: high ?? null } : null;
    return observation({
      id, category: text(f.category) || null, code: codeable({ text: label }),
      value: q && typeof q === 'object' ? quantity({ value: q.value, unit: q.unit, code: q.unit }) : (q ?? null),
      referenceRange: range, effectiveDateTime: f.effectiveDateTime ?? null, status: text(f.status) || 'unknown',
    });
  }
  if (resource === 'encounters') {
    const start = f['period.start'] ?? null;
    const end = f['period.end'] ?? null;
    return encounter({ id, status: text(f.status) || 'unknown', class: text(f.class), period: (start || end) ? period(start, end) : null });
  }
  if (resource === 'documents') {
    const label = text(f['type.text']);
    if (!label) return null;
    return documentReference({ id, type: codeable({ text: label }), status: text(f.status) || 'unknown', date: f.date ?? null });
  }
  return null;
}

/**
 * normalizeOperation({ manifest, result }) -> { resource, items, warnings }
 * `result` is an executeOperation() return value.
 */
export function normalizeOperation({ manifest, result }) {
  const op = manifest.operations.find((o) => o.type === result.operationType);
  if (!op) throw new Error(`operation '${result.operationType}' is not declared by this manifest`);
  const warnings = [];
  const items = [];
  const seen = new Set();
  for (const page of result.pages) {
    for (const raw of page.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warnings.push(`${op.type}: non-object item skipped`); continue; }
      const { fields, absent } = mapItem(op, raw, warnings);
      const built = buildResource(op.mapping.resource, fields);
      if (!built) { warnings.push(`${op.type}: item omitted (no usable identifier or coded text; nothing is fabricated)`); continue; }
      if (seen.has(built.id)) { warnings.push(`${op.type}: duplicate id '${built.id}' across pages; first kept`); continue; }
      seen.add(built.id);
      for (const field of absent) warnings.push(`${op.type}[${built.id}]: '${field}' absent in source; omitted`);
      items.push(built);
    }
  }
  if (result.partial) warnings.push(`${op.type}: PARTIAL read (${result.warnings.join('; ') || 'stopped early'})`);
  return { resource: op.mapping.resource, items, warnings };
}

/**
 * buildBundle({ manifest, results, tenantId, generatedAt, scope })
 *   -> { bundle, worklist, warnings, validation }
 *
 * `validation` is the existing canonical validateBundle report. A bundle that does not pass is returned
 * with `validation.ok === false` so the caller fails closed; it is never quietly patched up.
 */
export function buildBundle({ manifest, results = [], tenantId = null, generatedAt = null, scope = [], sourceConnector = 'browser-session' }) {
  const warnings = [];
  const collections = { encounters: [], medications: [], allergies: [], observations: [], documents: [] };
  const prov = [];
  let worklist = [];
  let patientResource = null;

  for (const result of results) {
    const { resource, items, warnings: w } = normalizeOperation({ manifest, result });
    warnings.push(...w);
    if (resource === 'worklist') { worklist = items; }
    else if (resource === 'patient') { patientResource = items[0] || null; }
    else collections[COLLECTION_OF[resource]] = items;
    prov.push(provenance({ resource, sourceConnector, sourceId: `${manifest.contentHash}:${result.operationType}` }));
    // A declared endpoint that legitimately returned nothing is a NEGATIVE finding, not a gap.
    if (items.length === 0 && !result.partial) warnings.push(`negative: '${result.operationType}' returned no items for this patient`);
  }

  // A collection with no declared operation at all is ABSENT: unknown, not empty.
  const declared = new Set(manifest.operations.map((o) => OPERATION_RESOURCE[o.type]));
  for (const resource of Object.keys(collections)) {
    if (!declared.has(resource)) warnings.push(`absent: '${resource}' is not readable from this deployment (no declared operation); an empty list here means unknown, not none`);
  }

  const out = bundle({
    tenantId, patient: patientResource, ...collections,
    generatedAt, sourceConnector, scope, provenance: prov, warnings,
  });
  return { bundle: out, worklist, warnings, validation: validateBundle(out) };
}
