#!/usr/bin/env node
// validate-protocols.mjs — dependency-free validator for ONCO v2 Standard
// Protocols + optional hospital-implementation overlays.
//
// Separate from validate-content.mjs on purpose: that one owns the shipped
// 4959-file KB build and must stay untouched. This one is scoped to the
// oncology protocol authoring dirs and layers the ONCQIS safety rules on top.
//
// Reuses the same JSON-Schema subset as validate-content.mjs (type, $ref,
// enum, const, required, properties, additionalProperties(bool|schema),
// items, anyOf, pattern, minimum, minItems) plus oneOf — the protocol schema's
// `verifiable` def uses oneOf.
//
// Usage:
//   node kb/tools/validate-protocols.mjs [protocolsDir]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // worktree root (kb/tools -> kb -> root)
const KB = join(__dirname, '..');

const DEFAULT_PROTOCOLS_DIR = join(ROOT, 'docs/superpowers/onco-protocols-v2');
const HOSPITALS_DIR = join(KB, 'protocols/hospitals');

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJson = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.verify.md') && !f.endsWith('.r1.md'))
        .sort()
    : [];

// ---- minimal JSON Schema validator (mirrors validate-content.mjs) ----------
function typeOk(v, t) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

function resolveRef(root, ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let cur = root;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function validate(schema, value, root, path, errors) {
  if (schema == null) return;
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, root, path, errors);

  // anyOf / oneOf — pass if any branch validates (we don't enforce oneOf's
  // exactly-one; for the `verifiable` def the branches overlap by design).
  const branches = schema.anyOf || schema.oneOf;
  if (branches) {
    const ok = branches.some((s) => {
      const sub = [];
      validate(s, value, root, path, sub);
      return sub.length === 0;
    });
    if (!ok) errors.push(`${path}: no ${schema.anyOf ? 'anyOf' : 'oneOf'} branch matched`);
    return;
  }

  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${path}: ${JSON.stringify(value)} not in enum [${schema.enum.join(', ')}]`);

  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value))
    errors.push(`${path}: "${value}" does not match /${schema.pattern}/`);

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum)
    errors.push(`${path}: ${value} < minimum ${schema.minimum}`);

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path}: ${value.length} items < minItems ${schema.minItems}`);
    if (schema.items) value.forEach((it, i) => validate(schema.items, it, root, `${path}[${i}]`, errors));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required || [])
      if (!(req in value)) errors.push(`${path}: missing required "${req}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validate(props[k], v, root, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false)
        errors.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        validate(schema.additionalProperties, v, root, `${path}.${k}`, errors);
    }
  }
}

// ---- ONCQIS safety rules ---------------------------------------------------
const ENDORSEMENTS = ['nccn-approved', 'nccn-certified', 'endorsed by', 'fda-approved protocol'];
const DASH_RE = /[–—]/; // en-dash, em-dash
const ANTHRACYCLINES = ['doxorubicin', 'daunorubicin', 'epirubicin', 'idarubicin', 'mitoxantrone', 'valrubicin'];

// Walk every string value, running a visitor(str, dottedPath).
function walkStrings(v, path, visit) {
  if (typeof v === 'string') return visit(v, path);
  if (Array.isArray(v)) return v.forEach((it, i) => walkStrings(it, `${path}[${i}]`, visit));
  if (v !== null && typeof v === 'object')
    for (const [k, val] of Object.entries(v)) walkStrings(val, path ? `${path}.${k}` : k, visit);
}

function oncqis(obj, errs) {
  // (a) ACTIVE => no unresolved VERIFY
  if (obj.status === 'ACTIVE') {
    if (Array.isArray(obj.verifyFields) && obj.verifyFields.length)
      errs.push(`ACTIVE but verifyFields is non-empty: [${obj.verifyFields.join(', ')}]`);
    walkStrings(obj, '', (s, p) => {
      if (s === 'VERIFY') errs.push(`ACTIVE but field "${p}" is still VERIFY`);
    });
  }

  // (b) endorsement claims + (c) dashes — anywhere in any string value
  walkStrings(obj, '', (s, p) => {
    const lc = s.toLowerCase();
    for (const e of ENDORSEMENTS)
      if (lc.includes(e)) errs.push(`endorsement claim "${e}" in "${p}"`);
    if (DASH_RE.test(s)) errs.push(`em/en dash in string value "${p}"`);
  });

  // (d) anthracycline cumulativeLifetime cap + vincristine perDose:2
  for (const [i, d] of (obj.regimen?.drugs || []).entries()) {
    const nm = String(d.name || '').toLowerCase();
    if (ANTHRACYCLINES.some((a) => nm.includes(a)) && !nm.includes("liposomal") && !d.caps?.cumulativeLifetime)
      errs.push(`regimen.drugs[${i}] "${d.name}" is an anthracycline but has no caps.cumulativeLifetime`);
    if (nm.includes('vincristine') && d.caps?.perDose !== 2)
      errs.push(`regimen.drugs[${i}] "${d.name}" (vincristine) must have caps.perDose: 2, got ${JSON.stringify(d.caps?.perDose)}`);
  }
}

// Exported for the test file: full check of one already-parsed object.
export function checkProtocol(schema, obj) {
  const errs = [];
  validate(schema, obj, schema, 'protocol', errs);
  oncqis(obj, errs);
  return errs;
}

// ---- run -------------------------------------------------------------------
function main() {
  const protocolsDir = process.argv[2] || DEFAULT_PROTOCOLS_DIR;
  const protoSchema = loadJson(join(KB, 'schema/standard-protocol.schema.json'));
  const hospSchema = loadJson(join(KB, 'schema/hospital-implementation.schema.json'));

  const report = { files: 0, errors: 0 };
  const fail = (rel, msg) => { report.errors++; console.error(`  x ${rel}  ${msg}`); };

  const runDir = (dir, schema, withOncqis) => {
    const files = listJson(dir);
    for (const f of files) {
      report.files++;
      let obj;
      try { obj = loadJson(join(dir, f)); }
      catch (e) { fail(f, `invalid JSON: ${e.message}`); continue; }
      const errs = [];
      validate(schema, obj, schema, f, errs);
      if (withOncqis) oncqis(obj, errs);
      for (const e of errs) fail(f, e);
    }
    return files.length;
  };

  const nProto = runDir(protocolsDir, protoSchema, true);
  console.log(`\nProtocol validation — ${protocolsDir}`);
  console.log(`  standard protocols: ${nProto} files`);

  if (existsSync(HOSPITALS_DIR)) {
    const nHosp = runDir(HOSPITALS_DIR, hospSchema, true);
    console.log(`  hospital overlays:  ${nHosp} files`);
  }

  console.log(`\n${report.errors === 0 ? 'PASS' : 'FAIL'} — ${report.files} files, ${report.errors} errors`);
  process.exit(report.errors === 0 ? 0 : 1);
}

// Only run when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
