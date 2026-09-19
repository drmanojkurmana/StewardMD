// connect-agent/manifest/compile.mjs — deterministic discovery spec (v2) -> candidate manifest.
//
// Rules this file exists to enforce:
//  - Nothing is invented. Every operation in the output corresponds to a request the observer actually
//    saw. There is no "hospitals usually also expose /allergies" heuristic anywhere in here.
//  - Anything ambiguous becomes an explicit `unsupported` entry WITH a reason, never a guess. A missing
//    deployment time zone, a result shape with no unit key, an unrecognised path: all land there.
//  - Deterministic: same spec + same options -> byte-identical manifest (modulo the caller-supplied
//    `generatedAt`). Events are deduped and sorted before anything reads them.
//  - The optional `suggest` hook is an INTERFACE only. It performs no network call and loads no model;
//    a fixture-backed fake lives in the tests. Whatever it proposes is re-validated here and against
//    the sanitized shape before it can reach the manifest.
import { canonicalJson, sha256, manifestContentHash, validateManifest, CONST_ALLOWLIST } from './schema.mjs';

export const COMPILER_VERSION = '1.0.0';

// Path segment (after `{id}` redaction) -> operation type. Fixed table, no fuzzy matching: an
// unrecognised segment is an unsupported capability, not a nearest-neighbour guess.
const SEGMENT_TO_OPERATION = new Map(Object.entries({
  worklist: 'list_worklist', worklists: 'list_worklist', tasks: 'list_worklist', census: 'list_worklist',
  medications: 'list_medications', meds: 'list_medications', medication: 'list_medications', prescriptions: 'list_medications',
  allergies: 'list_allergies', allergy: 'list_allergies', intolerances: 'list_allergies',
  results: 'list_results', labresults: 'list_results', labs: 'list_results', observations: 'list_results',
  encounters: 'list_encounters', visits: 'list_encounters', admissions: 'list_encounters',
  notes: 'list_notes', documents: 'list_notes', reports: 'list_notes',
}));
// A trailing `{id}` under one of these collections is the single-patient read.
const PATIENT_COLLECTIONS = new Set(['patients', 'patient', 'persons', 'people']);

const OPERATION_RESOURCE = {
  list_worklist: 'worklist', get_patient_summary: 'patient', list_medications: 'medications',
  list_allergies: 'allergies', list_results: 'observations', list_encounters: 'encounters', list_notes: 'documents',
};

// Canonical field -> ordered candidate source keys. First key present in the observed shape wins, so the
// result is a function of the shape alone. `null` candidate lists mean "compiler never derives this".
const FIELD_CANDIDATES = {
  worklist: { id: ['id', 'identifier', 'uid', 'key'], name: ['name', 'displayName', 'label', 'title'] },
  patient: { id: ['id', 'identifier', 'uid', 'key'], name: ['name', 'displayName', 'fullName'], gender: ['gender', 'sex'] },
  medications: {
    id: ['id', 'identifier', 'uid', 'key'],
    'medication.text': ['drug', 'medication', 'medicationName', 'name', 'display', 'description'],
    status: ['status', 'state'],
    dosage: ['dose', 'dosage', 'sig', 'instructions'],
  },
  allergies: {
    id: ['id', 'identifier', 'uid', 'key'],
    'code.text': ['allergen', 'substance', 'name', 'display', 'description'],
    clinicalStatus: ['clinicalStatus', 'status'],
    criticality: ['criticality'],
  },
  observations: {
    id: ['id', 'identifier', 'uid', 'key'],
    'code.text': ['test', 'analyte', 'name', 'display', 'description', 'label'],
    'value.value': ['value', 'result', 'numericValue'],
    'value.unit': ['unit', 'units', 'uom'],
    'referenceRange.low': ['refLow', 'referenceLow', 'rangeLow', 'low'],
    'referenceRange.high': ['refHigh', 'referenceHigh', 'rangeHigh', 'high'],
    effectiveDateTime: ['resultedAt', 'collectedAt', 'observedAt', 'effectiveDateTime', 'reportedAt'],
    status: ['status'],
  },
  encounters: {
    id: ['id', 'identifier', 'uid', 'key'],
    status: ['status'],
    class: ['class', 'encounterType', 'visitType', 'type'],
    'period.start': ['start', 'startDate', 'admittedAt', 'admissionDate'],
    'period.end': ['end', 'endDate', 'dischargedAt', 'dischargeDate'],
  },
  documents: {
    id: ['id', 'identifier', 'uid', 'key'],
    'type.text': ['noteType', 'documentType', 'title', 'type', 'name'],
    status: ['status'],
    date: ['signedAt', 'authoredOn', 'createdAt', 'date'],
  },
};
// Fields that must be present or the operation is not compilable at all.
const REQUIRED_FIELDS = {
  worklist: ['id'], patient: ['id'], medications: ['id', 'medication.text'], allergies: ['id', 'code.text'],
  observations: ['id', 'code.text'], encounters: ['id'], documents: ['id', 'type.text'],
};
// Canonical fields that are timestamps: mapped with toDate, and only when a deployment zone is declared.
const DATE_FIELDS = new Set(['effectiveDateTime', 'period.start', 'period.end', 'date']);
const CONST_SET = new Set(CONST_ALLOWLIST);

function shapeIsObject(s) { return s && typeof s === 'object' && s.type === 'object' && s.keys && typeof s.keys === 'object'; }
function shapeIsArray(s) { return s && typeof s === 'object' && s.type === 'array'; }

/** Find the array-of-objects container inside a value-free response shape. Deterministic key order. */
function findItemsContainer(shape, depth = 0, prefix = '') {
  if (shapeIsArray(shape)) return { selector: prefix || null, itemShape: shape.sample };
  if (!shapeIsObject(shape) || depth > 2) return null;
  const keys = Object.keys(shape.keys);
  const preferred = ['items', 'entry', 'entries', 'data', 'results', 'rows', 'records', 'list'];
  const ordered = [...preferred.filter((k) => keys.includes(k)), ...keys.filter((k) => !preferred.includes(k)).sort()];
  for (const k of ordered) {
    const child = shape.keys[k];
    if (shapeIsArray(child)) return { selector: prefix ? `${prefix}.${k}` : k, itemShape: child.sample };
  }
  for (const k of ordered) {
    const found = findItemsContainer(shape.keys[k], depth + 1, prefix ? `${prefix}.${k}` : k);
    if (found) return found;
  }
  return null;
}

function itemKeys(itemShape) {
  return shapeIsObject(itemShape) ? Object.keys(itemShape.keys) : [];
}

/** `/api/patients/{id}/medications` -> template with named placeholders derived from the parent segment. */
function templateFromRedactedPath(redactedPath) {
  const segments = String(redactedPath).split('/');
  const placeholders = {};
  const out = segments.map((seg, i) => {
    if (seg !== '{id}') return seg;
    const parent = segments[i - 1];
    if (!parent || !/^[a-z][a-z0-9]*$/i.test(parent)) return null; // ambiguous: no nameable parent
    const base = parent.replace(/ies$/i, 'y').replace(/s$/i, '');
    let name = `${base.charAt(0).toLowerCase()}${base.slice(1)}Id`;
    let n = 2;
    while (placeholders[name]) name = `${base.charAt(0).toLowerCase()}${base.slice(1)}Id${n++}`;
    placeholders[name] = { type: 'id' };
    return `{${name}}`;
  });
  if (out.includes(null)) return null;
  return { pathTemplate: out.join('/'), placeholders };
}

function classify(redactedPath) {
  const segments = String(redactedPath).split('/').filter(Boolean);
  if (!segments.length) return null;
  const last = segments[segments.length - 1].toLowerCase();
  if (SEGMENT_TO_OPERATION.has(last)) return SEGMENT_TO_OPERATION.get(last);
  if (last === '{id}' && segments.length >= 2 && PATIENT_COLLECTIONS.has(segments[segments.length - 2].toLowerCase())) return 'get_patient_summary';
  if (PATIENT_COLLECTIONS.has(last)) return 'list_worklist';
  return null;
}

function derivePagination(queryKeys, { maxPages, maxItems }) {
  const has = (k) => queryKeys.includes(k);
  const size = ['pageSize', 'per_page', 'limit', 'count'].find(has) || null;
  if (has('page')) return { style: 'page', param: 'page', ...(size ? { sizeParam: size } : {}), maxPages, maxItems };
  if (has('offset')) return { style: 'offset', param: 'offset', ...(size ? { sizeParam: size } : {}), maxPages, maxItems };
  // No observed pagination control means one page. Inventing `?page=` here would be exactly the kind of
  // unseen-endpoint guess this compiler refuses to make.
  return { style: 'none', maxPages: 1, maxItems };
}

function deriveMapping(resource, itemShape, { timezone, unsupported, operationType, observedPath }) {
  const keys = itemKeys(itemShape);
  const fields = {};
  const candidates = FIELD_CANDIDATES[resource];
  for (const canonical of Object.keys(candidates)) {
    const src = candidates[canonical].find((k) => keys.includes(k));
    if (!src) continue;
    if (DATE_FIELDS.has(canonical)) {
      if (!timezone) {
        unsupported.push({ capability: `${operationType}.${canonical}`, reason: 'no deployment time zone declared; timestamp omitted rather than assumed', observedPath });
        continue;
      }
      fields[canonical] = { op: 'toDate', path: src, timezone };
      continue;
    }
    if (canonical === 'value.value') {
      const unitKey = candidates['value.unit'].find((k) => keys.includes(k));
      if (!unitKey) {
        unsupported.push({ capability: `${operationType}.value`, reason: 'observed result shape carries no unit key; numeric values omitted rather than assumed unitless', observedPath });
        continue;
      }
      // `unit: '1'` is UCUM dimensionless and means "the manifest asserts no unit"; the real unit is read
      // from `unitPath` at run time and cross-checked by validate.mjs.
      fields[canonical] = { op: 'toNumber', path: src, unit: '1', unitPath: unitKey };
      continue;
    }
    if (canonical === 'value.unit') continue; // carried by the toNumber above, never mapped on its own
    fields[canonical] = { op: 'pick', path: src };
  }
  // SCCM requires a category on every Observation and validateBundle rejects a bundle without one. The
  // operation type itself is the evidence (a `/results` or `/labs` read is laboratory), the literal comes
  // from the const allowlist, and it carries no observed value.
  if (resource === 'observations' && !fields.category && CONST_SET.has('laboratory')) fields.category = { op: 'const', value: 'laboratory' };
  return fields;
}

function dedupeEvents(events) {
  const byKey = new Map();
  for (const e of events) {
    const key = `${e.method} ${e.origin} ${e.path}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => `${a.origin}${a.path}${a.method}`.localeCompare(`${b.origin}${b.path}${b.method}`));
}

/**
 * compileManifest(spec, options) -> { manifest, report }
 *
 * options:
 *   manifestId   required, [a-z0-9._-]
 *   timezone     IANA zone for the deployment. Without it, every timestamp field is dropped into
 *                `unsupported` instead of being interpreted in an assumed zone.
 *   maxPages/maxItems  pagination ceilings written into every operation.
 *   generatedAt  timestamp stamped into provenance (injected so the output is reproducible in tests).
 *   suggest      optional async ({operationType, resource, sanitizedShape, fixture, unmappedFields})
 *                -> { fields }. See the LLM boundary note in docs/connect/agent-manifest.md.
 *   fixtures     synthetic fixtures, keyed by operation type, handed to `suggest`. Never real records.
 */
export async function compileManifest(spec, {
  manifestId, timezone = null, maxPages = 3, maxItems = 200,
  generatedAt = new Date().toISOString(), suggest = null, fixtures = {},
} = {}) {
  if (!manifestId) throw new Error('manifestId is required');
  // Versions 2 and 3 carry the identical fields this compiler reads (allowedOrigins/startOrigin/events,
  // same per-event shape); v3 (connect-agent/discovery.mjs's createCollector().collect(), also the
  // phone-runner spec shape per connect-agent/phone/CONTRACT.md) additionally carries blockedEvents/
  // reinstalls, which this compiler has never read. Accepting both is a label match, not a behavior
  // change for either.
  if (!spec || typeof spec !== 'object' || [2, 3].indexOf(Number(spec.version)) === -1) {
    throw new Error('compileManifest requires a discovery spec of version 2 or 3');
  }
  if (!Array.isArray(spec.allowedOrigins) || spec.allowedOrigins.length === 0) throw new Error('discovery spec carries no allowed origins');

  const discoverySpecHash = sha256(canonicalJson(spec));
  const startOrigin = spec.startOrigin || spec.allowedOrigins[0];
  const orderedOrigins = [startOrigin, ...spec.allowedOrigins.filter((o) => o !== startOrigin).sort()];
  const origins = orderedOrigins.map((origin, i) => ({ id: i === 0 ? 'origin:primary' : `origin:api-${i}`, origin, role: i === 0 ? 'ui' : 'api' }));
  const originIdOf = new Map(origins.map((o) => [o.origin, o.id]));

  const unsupported = [];
  const operations = [];
  const claimed = new Set();
  const report = { accepted: [], rejected: [] };

  for (const e of dedupeEvents(Array.isArray(spec.events) ? spec.events : [])) {
    const observedPath = e.path;
    const method = String(e.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      unsupported.push({ capability: 'non_read_endpoint', reason: `observed with method ${method}; only GET and HEAD are executable`, observedPath });
      continue;
    }
    if (!(e.status >= 200 && e.status < 300)) {
      unsupported.push({ capability: 'unverified_endpoint', reason: `observed only with status ${e.status}; a non-2xx observation is not evidence of a working read`, observedPath });
      continue;
    }
    if (!/json/i.test(String(e.contentType || ''))) {
      unsupported.push({ capability: 'non_json_endpoint', reason: `content type '${e.contentType || 'unknown'}' is not machine-readable by this mapping language`, observedPath });
      continue;
    }
    const type = classify(observedPath);
    if (!type) {
      unsupported.push({ capability: 'unclassified_endpoint', reason: 'path does not match a declared operation type; a guess is not made', observedPath });
      continue;
    }
    if (claimed.has(type)) {
      unsupported.push({ capability: type, reason: 'a second candidate endpoint was observed for this operation type; the first is used and this one is left unsupported', observedPath });
      continue;
    }
    const tpl = templateFromRedactedPath(observedPath);
    if (!tpl) {
      unsupported.push({ capability: type, reason: 'an identifier segment has no nameable parent segment, so its placeholder cannot be typed', observedPath });
      continue;
    }
    const resource = OPERATION_RESOURCE[type];
    const single = type === 'get_patient_summary';
    const container = single ? null : findItemsContainer(e.responseShape);
    const itemShape = single ? e.responseShape : container?.itemShape;
    if (!single && !container) {
      unsupported.push({ capability: type, reason: 'observed response shape carries no array container, so a list mapping cannot be derived', observedPath });
      continue;
    }
    if (!shapeIsObject(itemShape)) {
      unsupported.push({ capability: type, reason: 'observed items are not objects, so no field mapping can be derived', observedPath });
      continue;
    }

    const fields = deriveMapping(resource, itemShape, { timezone, unsupported, operationType: type, observedPath });
    // The suggest hook only ever sees the value-free shape plus the caller's synthetic fixture, and only
    // for fields the deterministic pass could not fill.
    if (typeof suggest === 'function') {
      const unmapped = Object.keys(FIELD_CANDIDATES[resource]).filter((f) => !(f in fields) && f !== 'value.unit');
      if (unmapped.length) {
        const proposed = await suggest({ operationType: type, resource, sanitizedShape: itemShape, fixture: fixtures[type] ?? null, unmappedFields: [...unmapped] });
        applySuggestions({ proposed, fields, resource, itemShape, unmapped, operationType: type, report });
      }
    }
    const missing = REQUIRED_FIELDS[resource].filter((f) => !(f in fields));
    if (missing.length) {
      unsupported.push({ capability: type, reason: `observed shape has no source for required field(s): ${missing.join(', ')}`, observedPath });
      continue;
    }

    const pagination = derivePagination(e.queryKeys || [], { maxPages, maxItems });
    const allowedQueryKeys = [...new Set([...(e.queryKeys || []), pagination.param, pagination.sizeParam].filter(Boolean))].sort().slice(0, 12);
    const mapping = { resource, fields: sortKeys(fields) };
    if (container?.selector) mapping.itemsSelector = container.selector;
    const operation = {
      type, method, originId: originIdOf.get(e.origin) || origins[0].id,
      pathTemplate: tpl.pathTemplate, placeholders: tpl.placeholders,
      allowedQueryKeys, pagination, mapping, sessionExpiry: deriveSessionExpiry(spec),
    };
    if (report.accepted.some((a) => a.operationType === type)) operation.suggested = true;
    operations.push(operation);
    claimed.add(type);
  }

  operations.sort((a, b) => a.type.localeCompare(b.type));
  const capabilityProbes = operations.map((op) => ({
    operationType: op.type,
    expect: { minItems: op.mapping.resource === 'patient' ? 0 : 1, requiredFields: REQUIRED_FIELDS[op.mapping.resource] },
  }));

  const manifest = {
    schemaVersion: 3, manifestId, origins, operations,
    capabilityProbes, unsupported: dedupeUnsupported(unsupported),
    provenance: { discoverySpecHash, compilerVersion: COMPILER_VERSION, generatedAt, discoverySchemaVersion: Number(spec.version) },
    contentHash: 'sha256:'.padEnd(71, '0'),
  };
  manifest.contentHash = manifestContentHash(manifest);
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Compiler produced an invalid manifest (this is a compiler bug, fail closed):\n- ${errors.join('\n- ')}`);
  return { manifest, report };
}

function deriveSessionExpiry(spec) {
  const statusCodes = [401, 403];
  // Only claim a login redirect pattern if a login-shaped path was actually observed.
  const observed = (Array.isArray(spec.events) ? spec.events : []).map((e) => String(e.path || ''));
  const patterns = [...new Set(observed.filter((p) => /\/(login|signin|sign-in|auth)(\/|$)/i.test(p)))].sort().slice(0, 8);
  return patterns.length ? { statusCodes, redirectPatterns: patterns } : { statusCodes };
}

function sortKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function dedupeUnsupported(list) {
  const seen = new Set();
  return list.filter((u) => {
    const k = canonicalJson(u);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))).slice(0, 64);
}

/**
 * Gate for anything the suggest hook proposes. A proposal is accepted only when it is for a field the
 * deterministic pass left empty, is a field this resource actually has, uses a transform whose selectors
 * all exist in the sanitized shape, and survives the schema's expression rules. Everything else is
 * rejected with a reason. The hook cannot introduce an endpoint, a method, an origin or a const literal
 * outside the allowlist, because it is never asked for any of those.
 */
function applySuggestions({ proposed, fields, resource, itemShape, unmapped, operationType, report }) {
  const suggestedFields = proposed && typeof proposed === 'object' && !Array.isArray(proposed) ? proposed.fields : null;
  if (!suggestedFields || typeof suggestedFields !== 'object' || Array.isArray(suggestedFields)) return;
  const keys = itemKeys(itemShape);
  for (const name of Object.keys(suggestedFields).sort()) {
    const reject = (reason) => report.rejected.push({ operationType, field: name, reason });
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') { reject('hostile field name'); continue; }
    if (!unmapped.includes(name)) { reject('field is not an unmapped canonical field of this resource'); continue; }
    const expr = suggestedFields[name];
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) { reject('proposal is not an expression object'); continue; }
    const selectors = collectSelectors(expr);
    if (selectors === null) { reject('proposal uses an unsupported transform'); continue; }
    const unknown = selectors.filter((s) => !keys.includes(String(s).split('.')[0]));
    if (unknown.length) { reject(`proposal references key(s) not present in the observed shape: ${unknown.join(', ')}`); continue; }
    if (expr.op === 'const' && !CONST_SET.has(expr.value)) { reject('proposed literal is not in the const allowlist'); continue; }
    fields[name] = expr;
    report.accepted.push({ operationType, field: name, resource });
  }
}

function collectSelectors(expr, out = [], depth = 0) {
  if (depth > 3 || !expr || typeof expr !== 'object') return null;
  if (expr.op === 'coalesce') {
    if (!Array.isArray(expr.of)) return null;
    for (const sub of expr.of) if (collectSelectors(sub, out, depth + 1) === null) return null;
    return out;
  }
  if (!['pick', 'map', 'toDate', 'toNumber', 'const'].includes(expr.op)) return null;
  if (expr.op !== 'const') {
    if (typeof expr.path !== 'string') return null;
    out.push(expr.path);
    if (typeof expr.unitPath === 'string') out.push(expr.unitPath);
  }
  return out;
}
