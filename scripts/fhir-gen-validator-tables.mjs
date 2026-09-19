#!/usr/bin/env node
/* scripts/fhir-gen-validator-tables.mjs - generates a version's validator tables (functions/_wardsynq/
 * fhir-validate-r5.js) from that version's published StructureDefinitions, so the tables are the
 * spec's own element lists rather than somebody's memory of them.
 *
 *   node scripts/fhir-gen-validator-tables.mjs <sdDir> <cacheDir> > functions/_wardsynq/fhir-validate-r5.js
 *
 * <sdDir> holds <name>.profile.json files downloaded from https://hl7.org/fhir/R5/<name>.profile.json for
 * every resource and datatype in scope. REQUIRED bindings on a code are expanded from the spec's own
 * ValueSet and CodeSystem JSON (fetched into <cacheDir>); a value set that cannot be enumerated (a
 * filter, an external grammar such as BCP-47 or MIME types) is left as a plain code and listed in the
 * generated file's header, never guessed. A datatype with no downloaded profile is accepted as an object
 * ("any") and listed too.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [sdDir, cacheDir] = process.argv.slice(2);
const BASE = "https://hl7.org/fhir/R5";
const PRIMS = new Set(["boolean", "integer", "integer64", "string", "decimal", "uri", "url", "canonical", "base64Binary", "instant", "date", "dateTime", "time", "code", "oid", "id", "markdown", "unsignedInt", "positiveInt", "uuid", "xhtml"]);
const QUANTITY_PROFILES = new Set(["Age", "Duration", "Count", "Distance", "SimpleQuantity", "MoneyQuantity"]);
/* terminology.hl7.org code systems used by REQUIRED bindings in scope, written down from the R5 value
 * sets (R5 added "unknown" to condition-clinical and "presumed" to allergy verification). */
const THO = {
  "http://terminology.hl7.org/CodeSystem/condition-clinical": ["active", "recurrence", "relapse", "inactive", "remission", "resolved", "unknown"],
  "http://terminology.hl7.org/CodeSystem/condition-ver-status": ["unconfirmed", "provisional", "differential", "confirmed", "refuted", "entered-in-error"],
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical": ["active", "inactive", "resolved"],
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification": ["unconfirmed", "presumed", "confirmed", "refuted", "entered-in-error"],
};
const notes = [];

const sds = {};
for (const f of readdirSync(sdDir)) if (f.endsWith(".profile.json")) { const s = JSON.parse(readFileSync(join(sdDir, f), "utf8")); sds[s.type] = s; }

async function getJson(name) {
  const p = join(cacheDir, name);
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) return null;
  const t = await r.text();
  writeFileSync(p, t);
  return JSON.parse(t);
}
const flat = (concepts) => (concepts || []).flatMap((c) => [c.code, ...flat(c.concept)]);
async function codesOf(vsUrl) {
  const [url] = String(vsUrl).split("|");
  const id = url.split("/").pop();
  const vs = await getJson(`valueset-${id}.json`);
  if (!vs || !vs.compose) return null;
  const out = [];
  for (const inc of vs.compose.include || []) {
    if (inc.filter || inc.valueSet) return null;
    if (inc.concept) { out.push(...inc.concept.map((c) => c.code)); continue; }
    if (THO[inc.system]) { out.push(...THO[inc.system]); continue; }
    if (!String(inc.system).startsWith("http://hl7.org/fhir/")) return null;
    const cs = await getJson(`codesystem-${String(inc.system).split("/").pop()}.json`);
    if (!cs || !cs.concept) return null;
    out.push(...flat(cs.concept));
  }
  if (vs.compose.exclude) return null;
  return out.length ? [...new Set(out)] : null;
}

const typeName = (t) => {
  if (String(t.code).startsWith("http://hl7.org/fhirpath/System.")) {
    const ext = (t.extension || []).find((e) => /structuredefinition-fhir-type$/.test(e.url));
    return ext ? ext.valueUrl : "string";
  }
  return t.code;
};
const requiredCc = {};
const usedTypes = new Set(["Reference", "CodeableConcept", "Coding", "Extension"]);   // the walker needs these whatever the resources name

async function typeExpr(el) {
  const types = el.type || [];
  if (types.length !== 1) throw new Error(`not one type: ${el.path}`);
  const t = types[0], name = typeName(t);
  const req = el.binding && el.binding.strength === "required" ? el.binding.valueSet : null;
  if (name === "code" && req) {
    const codes = await codesOf(req);
    if (codes) return `code:${codes.join("|")}`;
    notes.push(`${el.path}: required binding ${req} not enumerable, checked as a code only`);
    return "code";
  }
  if (name === "CodeableConcept" && req) {
    const codes = await codesOf(req);
    const id = String(req).split("|")[0].split("/").pop();
    const vs = await getJson(`valueset-${id}.json`);
    const system = vs && vs.compose && vs.compose.include && vs.compose.include[0] && vs.compose.include[0].system;
    if (codes && system) { requiredCc[id] = { system, codes: codes.join("|") }; return `cc:${id}`; }
    notes.push(`${el.path}: required CodeableConcept binding ${req} not enumerable, checked as a CodeableConcept only`);
    return "CodeableConcept";
  }
  if (name === "Reference") {
    const targets = (t.targetProfile || []).map((x) => x.split("/").pop());
    return targets.length && !targets.includes("Resource") ? `Reference(${targets.join("|")})` : "Reference";
  }
  if (PRIMS.has(name) || name === "Resource") return name;
  if (QUANTITY_PROFILES.has(name)) { usedTypes.add("Quantity"); return "Quantity"; }
  usedTypes.add(name);
  return name;
}

/** The spec object for the children of `root` within `els`. */
async function build(els, root, byPath) {
  const spec = {};
  const direct = els.filter((e) => e.path.startsWith(root + ".") && !e.path.slice(root.length + 1).includes("."));
  for (const el of direct) {
    const name = el.path.slice(root.length + 1);
    const many = el.max === "*" || Number(el.max) > 1;
    if (el.max === "0") continue;
    const req = el.min >= 1;
    const suffix = `${many ? "[]" : ""}${req ? "!" : ""}`;
    if (name.endsWith("[x]")) {
      const base = name.slice(0, -3);
      const opts = {};
      for (const t of el.type) {
        const tn = typeName(t);
        const key = base + tn[0].toUpperCase() + tn.slice(1);
        opts[key] = await typeExpr({ ...el, type: [t], binding: tn === "code" || tn === "CodeableConcept" ? el.binding : null });
      }
      spec[`${base}[x]${req ? "!" : ""}`] = opts;
      continue;
    }
    if (el.contentReference) {
      const target = el.contentReference.replace(/^.*#/, "");
      spec[name + suffix] = { $ref: target };
      continue;
    }
    const tn = el.type && el.type.length === 1 ? typeName(el.type[0]) : null;
    if (tn === "BackboneElement" || (tn === "Element" && els.some((e) => e.path.startsWith(el.path + ".")))) {
      spec[name + suffix] = await build(els, el.path, byPath);
      continue;
    }
    spec[name + suffix] = await typeExpr(el);
  }
  return spec;
}

function resolveRefs(spec, all) {
  for (const [k, v] of Object.entries(spec)) {
    if (v && typeof v === "object" && v.$ref) spec[k] = all[v.$ref];
    else if (v && typeof v === "object") resolveRefs(v, all);
  }
}

async function specFor(sd) {
  const els = sd.snapshot.element;
  const byPath = {};
  const spec = await build(els, sd.type, byPath);
  // contentReference targets, built by path.
  const refs = {};
  const collect = async (s, path) => {
    for (const [k, v] of Object.entries(s)) {
      if (v && typeof v === "object" && v.$ref && !refs[v.$ref]) refs[v.$ref] = await build(els, v.$ref, byPath);
      else if (v && typeof v === "object" && !v.$ref) await collect(v, path);
    }
  };
  await collect(spec);
  resolveRefs(spec, refs);
  return spec;
}

const RESOURCES = ["Patient", "Encounter", "Observation", "Condition", "AllergyIntolerance", "MedicationRequest", "Immunization", "Bundle", "OperationOutcome"];
const out = { resources: {}, types: {} };
for (const r of RESOURCES) {
  if (!sds[r]) throw new Error(`missing ${r}.profile.json`);
  out.resources[r] = await specFor(sds[r]);
}
const done = new Set();
while ([...usedTypes].some((t) => !done.has(t))) {
  for (const t of [...usedTypes]) {
    if (done.has(t)) continue;
    done.add(t);
    if (["Extension"].includes(t) && sds[t]) { out.types[t] = await specFor(sds[t]); continue; }
    if (!sds[t]) { out.types[t] = "any"; notes.push(`${t}: no profile downloaded, accepted as an object`); continue; }
    out.types[t] = await specFor(sds[t]);
  }
}

const json = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, " ");
process.stdout.write(`/* functions/_wardsynq/fhir-validate-r5.js - FHIR R5 (5.0.0) validator tables. GENERATED, do not hand-edit.
 *
 * Generated by scripts/fhir-gen-validator-tables.mjs from the R5 StructureDefinitions at
 * ${BASE}/<name>.profile.json. Same grammar as the R4 tables in fhir-validate.js ("name[]!": "Type").
 * Only the resources WardSynQ transforms to R5 are here: ${RESOURCES.join(", ")}.
 *
 * Not enumerated, and so checked by type only:
${notes.map((n) => ` *   ${n}`).join("\n")}
 */

const TYPES_R5 = Object.freeze(${json(out.types)});

const RESOURCES_R5 = Object.freeze(${json(out.resources)});

const REQUIRED_CC_R5 = Object.freeze(${json(requiredCc)});

export { TYPES_R5, RESOURCES_R5, REQUIRED_CC_R5 };
`);
