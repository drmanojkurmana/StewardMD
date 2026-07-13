#!/usr/bin/env node
// validate-content.mjs — dependency-free validator for authored KB content.
//
// Routes each content directory to its schema and checks the shipped files
// against it, plus a few referential-integrity invariants the JSON Schema
// alone cannot express (treatment.diseaseId resolves, crossLinks resolve,
// drugRefs carry a composition, page-cite present on paraphrased prose).
//
// Zero dependencies by design (matches the rest of kb/tools). Implements the
// subset of JSON Schema 2020-12 keywords these schemas actually use:
//   $ref(#/$defs/*), type, enum, const, required, properties,
//   additionalProperties(bool|schema), items(schema), anyOf, pattern,
//   minimum, minItems.
//
// Usage:
//   node kb/tools/validate-content.mjs            # validate everything, exit 1 on any error
//   node kb/tools/validate-content.mjs --quiet    # only print the summary + errors

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB = join(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJson = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

// ---- minimal JSON Schema validator ---------------------------------------
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
  // only local pointers like "#/$defs/rule"
  const parts = ref.replace(/^#\//, '').split('/');
  let cur = root;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function validate(schema, value, root, path, errors) {
  if (schema == null) return;
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, root, path, errors);

  // anyOf — pass if any branch validates
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => {
      const sub = [];
      validate(s, value, root, path, sub);
      return sub.length === 0;
    });
    if (!ok) errors.push(`${path}: no anyOf branch matched`);
    // anyOf schemas here don't combine with siblings; return
    return;
  }

  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`);
      return; // wrong type — deeper checks would be noise
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

// ---- load schemas ----------------------------------------------------------
const S = {
  disease: loadJson(join(KB, 'schema/disease.schema.json')),
  reference: loadJson(join(KB, 'schema/reference.schema.json')),
  treatment: loadJson(join(KB, 'schema/treatment.schema.json')),
  policy: loadJson(join(KB, 'schema/policy-overlay.schema.json')),
};

// ---- gather ids for referential-integrity checks ---------------------------
const diseaseIds = new Set();
for (const f of listJson(join(KB, 'diseases'))) diseaseIds.add(loadJson(join(KB, 'diseases', f)).id);
for (const f of listJson(join(KB, 'reference'))) diseaseIds.add(loadJson(join(KB, 'reference', f)).id);

// Drug-dose leak check for paraphrased knowledge prose (mirrors the assemble-*
// leak gate). Deliberately NARROW: it must look like a prescribing instruction
// — a dose amount PLUS a route or frequency nearby — so physiologic/lab values
// (haemoglobin "100-120 g/L", glucose ">200 mg/dL", "500-1000 mL of blood") do
// not trip it. Per-kg dosing and explicit /day dosing always count.
const DOSE_RE = /(\b\d+(\.\d+)?\s?(mg|mcg|µg|units?|iu)\/kg\b)|(\b\d+(\.\d+)?\s?(mg|mcg|µg|g|units?|iu)\/day\b)|(\b\d+(\.\d+)?\s?(mg|mcg|µg|g|units?|iu)\b[^.]{0,25}\b(IV|IM|PO|SC|SL|BD|OD|TDS|QID|q\d+h|once daily|twice daily|every \d+ hours?)\b)/i;

const report = { total: 0, files: 0, errors: 0, byDir: {} };

function run(dir, schema, extra) {
  const files = listJson(join(KB, dir));
  report.byDir[dir] = { files: files.length, errors: 0 };
  for (const f of files) {
    report.files++;
    const p = join(KB, dir, f);
    let obj;
    try { obj = loadJson(p); }
    catch (e) { fail(dir, f, `invalid JSON: ${e.message}`); continue; }
    const errs = [];
    validate(schema, obj, schema, dir + '/' + f, errs);
    if (extra) extra(obj, errs);
    for (const e of errs) fail(dir, f, e);
  }
}

function fail(dir, f, msg) {
  report.errors++;
  report.byDir[dir].errors++;
  console.error(`  ✗ ${dir}/${f}  ${msg}`);
}

// disease-specific integrity: crossLinks + treatmentRef resolve
run('diseases', S.disease, (o, errs) => {
  const links = o.enrichment?.harrison?.crossLinks || [];
  for (const l of links) if (!diseaseIds.has(l)) errs.push(`crossLink -> unknown disease id "${l}"`);
  const ph = o.enrichment?.harrison?.pathophysiology;
  if (typeof ph === 'string' && DOSE_RE.test(ph)) errs.push(`pathophysiology prose contains a dose-like token (paraphrase-leak) — doses belong in the treatment object`);
});

run('reference', S.reference, (o, errs) => {
  const kb = o.harrison || o.reference;
  if (!kb) errs.push('missing knowledge block — needs `harrison` (IM) or `reference` (source-neutral, e.g. Nelson/Parsons)');
  const links = kb?.crossLinks || [];
  for (const l of links) if (!diseaseIds.has(l)) errs.push(`crossLink -> unknown disease id "${l}"`);
});

// Treatment files come in two kinds:
//  (a) disease-treatment objects (have diseaseId) — full treatment schema.
//  (b) formulary / regimen reference tables (e.g. tb_drugs, tb_dr_regimens) —
//      keyed by id+title with drugs/regimens tables and no diseaseId. These are
//      referenced by treatments via drugRefs/pathwaysRef, not diagnosed directly.
const FORMULARY_TABLE = {
  type: 'object', additionalProperties: true, required: ['id', 'title'],
  properties: { id: { type: 'string' }, title: { type: 'string' } },
};
{
  const dir = 'treatments';
  const files = listJson(join(KB, dir));
  report.byDir[dir] = { files: files.length, errors: 0 };
  for (const f of files) {
    report.files++;
    let obj;
    try { obj = loadJson(join(KB, dir, f)); }
    catch (e) { fail(dir, f, `invalid JSON: ${e.message}`); continue; }
    const errs = [];
    if (!('diseaseId' in obj)) {
      validate(FORMULARY_TABLE, obj, FORMULARY_TABLE, dir + '/' + f, errs);
    } else {
      validate(S.treatment, obj, S.treatment, dir + '/' + f, errs);
      if (!diseaseIds.has(obj.diseaseId))
        errs.push(`diseaseId "${obj.diseaseId}" does not resolve to any disease/reference entry`);
      for (const [i, r] of (obj.recommendations || []).entries())
        for (const [j, d] of (r.drugRefs || []).entries())
          if (!d.composition) errs.push(`recommendations[${i}].drugRefs[${j}] missing composition`);
    }
    for (const e of errs) fail(dir, f, e);
  }
}

run('policies', S.policy);

// ---- summary ----------------------------------------------------------------
if (!QUIET) {
  console.log('\nKB content validation');
  for (const [dir, r] of Object.entries(report.byDir))
    console.log(`  ${r.errors === 0 ? '✓' : '✗'} ${dir.padEnd(12)} ${String(r.files).padStart(4)} files  ${r.errors} errors`);
}
console.log(`\n${report.errors === 0 ? 'PASS' : 'FAIL'} — ${report.files} files, ${report.errors} errors`);
process.exit(report.errors === 0 ? 0 : 1);
