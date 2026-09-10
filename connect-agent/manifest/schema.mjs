// connect-agent/manifest/schema.mjs — hand-written validator for schema.json (manifest schemaVersion 3).
//
// Why hand-written: `ls node_modules | grep -E 'ajv|json-schema'` finds nothing, and the constraints
// say no new dependency and no `npm install`. This is a targeted structural checker, not a general
// JSON Schema engine; it reads every enum/limit FROM schema.json so the schema document stays the one
// source of truth and the two cannot drift.
//
// Fail-closed posture: unknown keys are errors (not ignored), every object is checked for hostile keys
// (`__proto__`, `constructor`, `prototype`) and for a tampered prototype, and `parseManifest()` strips
// `__proto__` during JSON.parse so a hostile artifact cannot pollute Object.prototype just by being read.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SCHEMA = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const X = SCHEMA['x-stewardmd'];
export const MANIFEST_SCHEMA_VERSION = X.schemaVersion;
export const OPERATION_TYPES = Object.freeze([...X.operationTypes]);
export const TRANSFORMS = Object.freeze([...X.transforms]);
export const RESOURCES = Object.freeze([...X.resources]);
export const CONST_ALLOWLIST = Object.freeze([...X.constAllowlist]);
export const LIMITS = Object.freeze({ ...X.limits });
const METHODS = new Set(X.methods);
const PLACEHOLDER_TYPES = new Set(X.placeholderTypes);
const PAGINATION_STYLES = new Set(X.paginationStyles);
const FORBIDDEN_KEYS = new Set(X.forbiddenKeys);
const CONST_SET = new Set(CONST_ALLOWLIST);
const OP_SET = new Set(OPERATION_TYPES);
const RESOURCE_SET = new Set(RESOURCES);

const SELECTOR_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const ORIGIN_ID_RE = /^origin:[a-z0-9][a-z0-9._-]{0,31}$/;
const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PATH_RE = /^\/[^?#\s]*$/;
const PLACEHOLDER_NAME_RE = /^[a-z][A-Za-z0-9]{0,39}$/;
const QUERY_KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/** JSON.parse that drops a literal `__proto__` member instead of letting it reach the object. */
export function parseManifest(text) {
  return JSON.parse(text, function reviver(key, value) {
    if (key === '__proto__') return undefined;
    return value;
  });
}

/** Deterministic serialization: object keys sorted, arrays in order. Used for every hash we emit. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(text) { return `sha256:${createHash('sha256').update(text).digest('hex')}`; }

/** Content hash of a manifest = sha256 over the canonical JSON of everything EXCEPT contentHash. */
export function manifestContentHash(manifest) {
  const { contentHash, ...rest } = manifest || {};
  return sha256(canonicalJson(rest));
}

function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Recursive hostile-key / tampered-prototype sweep. Runs before any structural check. */
export function findHostileKeys(value, path = '$', found = []) {
  if (found.length >= 20 || !value || typeof value !== 'object') return found;
  if (!Array.isArray(value) && !isPlainObject(value)) { found.push(`${path} has a non-plain prototype`); return found; }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_KEYS.has(key)) { found.push(`${path}.${key}`); continue; }
    findHostileKeys(value[key], `${path}.${key}`, found);
  }
  return found;
}

function checkKeys(obj, where, required, optional, errors) {
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${where}: unknown key '${k}'`);
  for (const k of required) if (obj[k] === undefined) errors.push(`${where}: missing '${k}'`);
}

function selectorDepth(sel) { return sel.split('.').length; }

function validateExpr(expr, where, errors, depth = 0) {
  if (!isPlainObject(expr)) { errors.push(`${where}: expression must be an object`); return; }
  const op = expr.op;
  if (!TRANSFORMS.includes(op)) { errors.push(`${where}: unknown transform '${String(op)}'`); return; }
  const sel = (key = 'path') => {
    const v = expr[key];
    if (typeof v !== 'string' || !SELECTOR_RE.test(v)) errors.push(`${where}.${key}: invalid selector`);
    else if (selectorDepth(v) > LIMITS.maxSelectorDepth) errors.push(`${where}.${key}: selector too deep`);
    else if (v.split('.').some((s) => FORBIDDEN_KEYS.has(s))) errors.push(`${where}.${key}: selector targets a forbidden key`);
  };
  if (op === 'pick') { checkKeys(expr, where, ['op', 'path'], [], errors); sel(); return; }
  if (op === 'const') {
    checkKeys(expr, where, ['op', 'value'], [], errors);
    // A `const` is the only place a literal string enters the manifest, so it is restricted to the
    // canonical vocabulary. Without this an observed patient value could be parked in a const and
    // ride along as "just a default".
    if (!CONST_SET.has(expr.value)) errors.push(`${where}.value: literal is not in the const allowlist`);
    return;
  }
  if (op === 'map') {
    checkKeys(expr, where, ['op', 'path', 'table'], ['default'], errors);
    sel();
    if (!isPlainObject(expr.table)) errors.push(`${where}.table: must be an object`);
    else {
      const entries = Object.entries(expr.table);
      if (entries.length > LIMITS.maxMapTableEntries) errors.push(`${where}.table: too many entries`);
      for (const [k, v] of entries) {
        if (FORBIDDEN_KEYS.has(k)) errors.push(`${where}.table: forbidden key '${k}'`);
        if (typeof v !== 'string' || !CONST_SET.has(v)) errors.push(`${where}.table['${k}']: target is not in the const allowlist`);
      }
    }
    if (expr.default !== undefined && expr.default !== null && !CONST_SET.has(expr.default)) errors.push(`${where}.default: not in the const allowlist`);
    return;
  }
  if (op === 'toDate') {
    checkKeys(expr, where, ['op', 'path', 'timezone'], [], errors);
    sel();
    if (typeof expr.timezone !== 'string' || !expr.timezone) errors.push(`${where}.timezone: required`);
    else if (!isKnownTimeZone(expr.timezone)) errors.push(`${where}.timezone: '${expr.timezone}' is not a known IANA zone`);
    return;
  }
  if (op === 'toNumber') {
    checkKeys(expr, where, ['op', 'path', 'unit'], ['unitPath'], errors);
    sel();
    if (typeof expr.unit !== 'string' || !expr.unit) errors.push(`${where}.unit: required`);
    if (expr.unitPath !== undefined) sel('unitPath');
    return;
  }
  if (op === 'coalesce') {
    checkKeys(expr, where, ['op', 'of'], [], errors);
    if (depth >= 2) { errors.push(`${where}: coalesce nested too deeply`); return; }
    if (!Array.isArray(expr.of) || expr.of.length === 0) { errors.push(`${where}.of: must be a non-empty array`); return; }
    if (expr.of.length > LIMITS.maxCoalesceBranches) errors.push(`${where}.of: too many branches`);
    expr.of.forEach((sub, i) => validateExpr(sub, `${where}.of[${i}]`, errors, depth + 1));
  }
}

export function isKnownTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Placeholder names used by a path template, in order of appearance. */
export function templatePlaceholders(pathTemplate) {
  return [...String(pathTemplate).matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
}

/**
 * validateManifest(manifest) -> string[] of errors (empty === valid).
 * Never throws on hostile input; a non-object, a null prototype chain or a poisoned key all come back
 * as errors so callers can fail closed on the list rather than on an exception.
 */
export function validateManifest(manifest, { requireContentHash = true } = {}) {
  const errors = [];
  if (!isPlainObject(manifest)) return ['manifest must be a plain object'];
  const hostile = findHostileKeys(manifest);
  if (hostile.length) return hostile.map((p) => `hostile key at ${p}`);

  checkKeys(manifest, 'manifest',
    ['schemaVersion', 'manifestId', 'origins', 'operations', 'unsupported', 'capabilityProbes', 'provenance', 'contentHash'],
    ['deployment'], errors);

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  if (typeof manifest.manifestId !== 'string' || !MANIFEST_ID_RE.test(manifest.manifestId)) errors.push('manifestId: invalid');

  const originIds = new Set();
  if (!Array.isArray(manifest.origins) || manifest.origins.length === 0) errors.push('origins: must be a non-empty array');
  else manifest.origins.forEach((o, i) => {
    const where = `origins[${i}]`;
    if (!isPlainObject(o)) { errors.push(`${where}: must be an object`); return; }
    checkKeys(o, where, ['id', 'origin'], ['role'], errors);
    if (typeof o.id !== 'string' || !ORIGIN_ID_RE.test(o.id)) errors.push(`${where}.id: invalid origin reference id`);
    else if (originIds.has(o.id)) errors.push(`${where}.id: duplicate`);
    else originIds.add(o.id);
    let parsed = null;
    try { parsed = new URL(String(o.origin)); } catch { /* handled below */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) errors.push(`${where}.origin: must be an http(s) origin`);
    else if (parsed.origin !== String(o.origin).replace(/\/$/, '')) errors.push(`${where}.origin: must be a bare origin (no path, query or userinfo)`);
    if (o.role !== undefined && o.role !== 'ui' && o.role !== 'api') errors.push(`${where}.role: must be ui or api`);
  });

  if (!Array.isArray(manifest.operations)) errors.push('operations: must be an array');
  else {
    if (manifest.operations.length > LIMITS.maxOperations) errors.push('operations: too many');
    const seen = new Set();
    manifest.operations.forEach((op, i) => validateOperation(op, `operations[${i}]`, originIds, seen, errors));
  }

  if (!Array.isArray(manifest.unsupported)) errors.push('unsupported: must be an array');
  else manifest.unsupported.forEach((u, i) => {
    const where = `unsupported[${i}]`;
    if (!isPlainObject(u)) { errors.push(`${where}: must be an object`); return; }
    checkKeys(u, where, ['capability', 'reason'], ['observedPath'], errors);
    if (typeof u.capability !== 'string' || !u.capability) errors.push(`${where}.capability: required`);
    if (typeof u.reason !== 'string' || !u.reason) errors.push(`${where}.reason: required`);
  });

  if (!Array.isArray(manifest.capabilityProbes)) errors.push('capabilityProbes: must be an array');
  else manifest.capabilityProbes.forEach((p, i) => {
    const where = `capabilityProbes[${i}]`;
    if (!isPlainObject(p)) { errors.push(`${where}: must be an object`); return; }
    checkKeys(p, where, ['operationType', 'expect'], [], errors);
    if (!OP_SET.has(p.operationType)) errors.push(`${where}.operationType: unknown operation type`);
    if (!isPlainObject(p.expect)) errors.push(`${where}.expect: must be an object`);
    else {
      checkKeys(p.expect, `${where}.expect`, [], ['minItems', 'requiredFields'], errors);
      if (p.expect.minItems !== undefined && !Number.isInteger(p.expect.minItems)) errors.push(`${where}.expect.minItems: must be an integer`);
      if (p.expect.requiredFields !== undefined && !Array.isArray(p.expect.requiredFields)) errors.push(`${where}.expect.requiredFields: must be an array`);
    }
  });

  const prov = manifest.provenance;
  if (!isPlainObject(prov)) errors.push('provenance: must be an object');
  else {
    checkKeys(prov, 'provenance', ['discoverySpecHash', 'compilerVersion', 'generatedAt'], ['discoverySchemaVersion'], errors);
    if (typeof prov.discoverySpecHash !== 'string' || !HASH_RE.test(prov.discoverySpecHash)) errors.push('provenance.discoverySpecHash: must be sha256:<64 hex>');
    if (typeof prov.compilerVersion !== 'string' || !SEMVER_RE.test(prov.compilerVersion)) errors.push('provenance.compilerVersion: must be semver');
    if (typeof prov.generatedAt !== 'string' || Number.isNaN(Date.parse(prov.generatedAt))) errors.push('provenance.generatedAt: must be a parseable timestamp');
  }

  if (requireContentHash) {
    if (typeof manifest.contentHash !== 'string' || !HASH_RE.test(manifest.contentHash)) errors.push('contentHash: must be sha256:<64 hex>');
    else if (manifest.contentHash !== manifestContentHash(manifest)) errors.push('contentHash: does not match manifest content');
  }
  return [...new Set(errors)];
}

function validateOperation(op, where, originIds, seen, errors) {
  if (!isPlainObject(op)) { errors.push(`${where}: must be an object`); return; }
  checkKeys(op, where,
    ['type', 'method', 'originId', 'pathTemplate', 'placeholders', 'allowedQueryKeys', 'pagination', 'mapping', 'sessionExpiry'],
    ['suggested'], errors);

  if (!OP_SET.has(op.type)) errors.push(`${where}.type: '${String(op.type)}' is not a declared operation type`);
  else if (seen.has(op.type)) errors.push(`${where}.type: duplicate operation type`);
  else seen.add(op.type);

  // Read-only by construction: the schema has no write method at all, so an adapter cannot express one.
  if (!METHODS.has(op.method)) errors.push(`${where}.method: only GET and HEAD are executable`);
  if (!originIds.has(op.originId)) errors.push(`${where}.originId: not an approved origin reference`);

  const tpl = op.pathTemplate;
  if (typeof tpl !== 'string' || !PATH_RE.test(tpl)) errors.push(`${where}.pathTemplate: must be an absolute path with no query or fragment`);
  else if (tpl.length > LIMITS.maxPathTemplateLength) errors.push(`${where}.pathTemplate: too long`);
  else if (tpl.split('/').some((s) => s === '.' || s === '..')) errors.push(`${where}.pathTemplate: dot segments are not allowed`);
  else if (/[{}]/.test(tpl.replace(/\{[^}]*\}/g, ''))) errors.push(`${where}.pathTemplate: unbalanced placeholder braces`);

  if (!isPlainObject(op.placeholders)) errors.push(`${where}.placeholders: must be an object`);
  else {
    const declared = Object.keys(op.placeholders);
    for (const name of declared) {
      const spec = op.placeholders[name];
      if (!PLACEHOLDER_NAME_RE.test(name)) errors.push(`${where}.placeholders: invalid name '${name}'`);
      if (!isPlainObject(spec)) { errors.push(`${where}.placeholders.${name}: must be an object`); continue; }
      checkKeys(spec, `${where}.placeholders.${name}`, ['type'], ['description'], errors);
      if (!PLACEHOLDER_TYPES.has(spec.type)) errors.push(`${where}.placeholders.${name}.type: unknown placeholder type`);
    }
    if (typeof tpl === 'string') {
      const used = templatePlaceholders(tpl);
      for (const u of used) if (!declared.includes(u)) errors.push(`${where}: path placeholder '{${u}}' is not declared`);
      for (const d of declared) if (!used.includes(d)) errors.push(`${where}: declared placeholder '${d}' is unused`);
      if (new Set(used).size !== used.length) errors.push(`${where}.pathTemplate: repeated placeholder name`);
    }
  }

  if (!Array.isArray(op.allowedQueryKeys)) errors.push(`${where}.allowedQueryKeys: must be an array`);
  else {
    if (op.allowedQueryKeys.length > LIMITS.maxQueryKeys) errors.push(`${where}.allowedQueryKeys: too many`);
    for (const k of op.allowedQueryKeys) if (typeof k !== 'string' || !QUERY_KEY_RE.test(k)) errors.push(`${where}.allowedQueryKeys: invalid key`);
  }

  const pg = op.pagination;
  if (!isPlainObject(pg)) errors.push(`${where}.pagination: must be an object`);
  else {
    checkKeys(pg, `${where}.pagination`, ['style', 'maxPages', 'maxItems'], ['param', 'sizeParam', 'pageSize', 'startAt'], errors);
    if (!PAGINATION_STYLES.has(pg.style)) errors.push(`${where}.pagination.style: unknown style`);
    if (!Number.isInteger(pg.maxPages) || pg.maxPages < 1 || pg.maxPages > LIMITS.maxPagesCeiling) errors.push(`${where}.pagination.maxPages: out of range`);
    if (!Number.isInteger(pg.maxItems) || pg.maxItems < 1 || pg.maxItems > LIMITS.maxItemsCeiling) errors.push(`${where}.pagination.maxItems: out of range`);
    if (pg.style !== 'none') {
      if (typeof pg.param !== 'string' || !QUERY_KEY_RE.test(pg.param)) errors.push(`${where}.pagination.param: required for a paginated style`);
      else if (Array.isArray(op.allowedQueryKeys) && !op.allowedQueryKeys.includes(pg.param)) errors.push(`${where}.pagination.param: must also be an allowed query key`);
      if (pg.sizeParam !== undefined) {
        if (!QUERY_KEY_RE.test(String(pg.sizeParam))) errors.push(`${where}.pagination.sizeParam: invalid`);
        else if (Array.isArray(op.allowedQueryKeys) && !op.allowedQueryKeys.includes(pg.sizeParam)) errors.push(`${where}.pagination.sizeParam: must also be an allowed query key`);
      }
    } else if (pg.param !== undefined) errors.push(`${where}.pagination.param: not allowed when style is none`);
    if (pg.pageSize !== undefined && (!Number.isInteger(pg.pageSize) || pg.pageSize < 1 || pg.pageSize > 500)) errors.push(`${where}.pagination.pageSize: out of range`);
    if (pg.startAt !== undefined && (!Number.isInteger(pg.startAt) || pg.startAt < 0)) errors.push(`${where}.pagination.startAt: out of range`);
  }

  const map = op.mapping;
  if (!isPlainObject(map)) errors.push(`${where}.mapping: must be an object`);
  else {
    checkKeys(map, `${where}.mapping`, ['resource', 'fields'], ['itemsSelector'], errors);
    if (!RESOURCE_SET.has(map.resource)) errors.push(`${where}.mapping.resource: unknown canonical resource`);
    if (map.itemsSelector !== undefined && (typeof map.itemsSelector !== 'string' || !SELECTOR_RE.test(map.itemsSelector))) errors.push(`${where}.mapping.itemsSelector: invalid selector`);
    if (!isPlainObject(map.fields)) errors.push(`${where}.mapping.fields: must be an object`);
    else {
      const names = Object.keys(map.fields);
      if (names.length === 0) errors.push(`${where}.mapping.fields: at least one field mapping is required`);
      if (names.length > LIMITS.maxFieldsPerOperation) errors.push(`${where}.mapping.fields: too many fields`);
      // Every canonical resource is keyed by a stable source-derived id; without one we cannot emit an
      // SCCM resource at all, and inventing an id would break cross-page identity.
      if (!names.includes('id')) errors.push(`${where}.mapping.fields: no 'id' mapping (a canonical resource needs a stable source id)`);
      for (const name of names) {
        if (!/^[a-zA-Z][A-Za-z0-9]*(\.[a-zA-Z][A-Za-z0-9]*)*$/.test(name)) errors.push(`${where}.mapping.fields: invalid canonical field name '${name}'`);
        validateExpr(map.fields[name], `${where}.mapping.fields['${name}']`, errors);
      }
    }
  }

  const se = op.sessionExpiry;
  if (!isPlainObject(se)) errors.push(`${where}.sessionExpiry: must be an object`);
  else {
    checkKeys(se, `${where}.sessionExpiry`, ['statusCodes'], ['redirectPatterns'], errors);
    if (!Array.isArray(se.statusCodes) || se.statusCodes.length === 0) errors.push(`${where}.sessionExpiry.statusCodes: must be a non-empty array`);
    else for (const c of se.statusCodes) if (!Number.isInteger(c) || c < 100 || c > 599) errors.push(`${where}.sessionExpiry.statusCodes: invalid status`);
    if (se.redirectPatterns !== undefined) {
      if (!Array.isArray(se.redirectPatterns)) errors.push(`${where}.sessionExpiry.redirectPatterns: must be an array`);
      // Literal substrings, never regular expressions: a compiled pattern from an untrusted artifact is
      // both a ReDoS surface and a small expression language we would then have to audit.
      else for (const p of se.redirectPatterns) if (typeof p !== 'string' || p.length > 120) errors.push(`${where}.sessionExpiry.redirectPatterns: must be short literal substrings`);
    }
  }

  if (op.suggested !== undefined && typeof op.suggested !== 'boolean') errors.push(`${where}.suggested: must be a boolean`);
}

export function assertValidManifest(manifest, opts) {
  const errors = validateManifest(manifest, opts);
  if (errors.length) throw new Error(`Invalid adapter manifest:\n- ${errors.join('\n- ')}`);
  return manifest;
}
