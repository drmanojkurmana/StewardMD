/* SURGX across every surgical specialty (2026-11-04).
 *
 * The 2026-11-04 audit scored SURGX 2/10 on specialty coverage: everything was general and
 * emergency surgery. This file makes the breadth a tested claim rather than a hope:
 *   - every specialty the app names has emergencies to open, and every operating specialty has
 *     at least one procedure;
 *   - every protocol, procedure and case declares a specialty the manifest knows;
 *   - every procedure has an operative note template, and nothing that is a physical act or a
 *     record of one (counts, specimens, implants, consent, the WHO checklist) can be AI-filled.
 * The per-file clinical validation (evidence gate, seven bands, step reuse) stays in
 * surgx-content.test.mjs, which already walks the whole manifest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import NS from "../surgx-note-schema.js";
import { NEVER_AI_FILLABLE } from "../functions/api/ai/_surgx-note.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, "surgx", p), "utf8"));
const manifest = read("manifest.json");
const SPEC_IDS = (manifest.specialties || []).map((s) => s.id);

// The specialties the audit named. Removing one is a product decision, so it fails here.
const MUST_HAVE_PROTOCOLS = ["general", "trauma", "periop", "ent", "urology", "neurosurgery", "orthopaedics",
  "plastics", "vascular", "cardiothoracic", "paediatric", "obgyn", "ophthalmology", "oncology", "breast", "endocrine"];
// Ophthalmology here is the on-call non-ophthalmologist's emergencies; peri-operative care is not
// an operation; breast and oncology share the cancer operations below.
const MUST_HAVE_PROCEDURES = ["general", "ent", "urology", "neurosurgery", "orthopaedics", "plastics", "vascular",
  "cardiothoracic", "paediatric", "obgyn", "endocrine"];

test("manifest declares its specialties, each with an id and a title, no duplicates", () => {
  assert.ok(SPEC_IDS.length >= MUST_HAVE_PROTOCOLS.length);
  assert.equal(new Set(SPEC_IDS).size, SPEC_IDS.length);
  manifest.specialties.forEach((s) => assert.ok(s.id && s.title, JSON.stringify(s)));
});

test("every protocol, procedure and case declares a known specialty", () => {
  for (const coll of ["protocols", "procedures", "cases"]) {
    for (const e of manifest[coll]) {
      assert.ok(SPEC_IDS.includes(e.specialty), coll + "/" + e.id + ": unknown specialty '" + e.specialty + "'");
    }
  }
});

test("coverage: every named specialty has protocols, every operating specialty has procedures", () => {
  const count = (coll, s) => manifest[coll].filter((e) => e.specialty === s).length;
  MUST_HAVE_PROTOCOLS.forEach((s) => assert.ok(count("protocols", s) > 0, "no protocols for " + s));
  MUST_HAVE_PROCEDURES.forEach((s) => assert.ok(count("procedures", s) > 0, "no procedures for " + s));
  // Breadth, not a token entry per specialty.
  assert.ok(manifest.protocols.length >= 80, "protocols: " + manifest.protocols.length);
  assert.ok(manifest.procedures.length >= 30, "procedures: " + manifest.procedures.length);
  assert.ok(manifest.cases.length >= 15, "cases: " + manifest.cases.length);
});

test("every protocol category has a title, so no raw id reaches the list header", () => {
  const titled = new Set((manifest.categories || []).map((c) => c.id));
  for (const p of manifest.protocols) assert.ok(titled.has(p.category), p.id + ": category '" + p.category + "' has no title");
});

test("every procedure has an operative note template that resolves", () => {
  for (const e of manifest.procedures) {
    const t = NS.TEMPLATES[e.id];
    assert.ok(t, e.id + " has no note template");
    assert.equal(t.base, "operative", e.id + " template must extend the operative note");
    const s = NS.schemaFor("operative", e.id);
    assert.equal(s.templateId, e.id);
    const keys = s.sections.flatMap((x) => x.fields.map((f) => f.k));
    assert.equal(new Set(keys).size, keys.length, e.id + ": a template field collides with a base field key");
  }
});

test("template fields that record a physical act or an implant are never AI-fillable", () => {
  const PHYSICAL = /\b(count|counts|specimen|implant|serial|lot number|consent|batch)\b/i;
  for (const [id, t] of Object.entries(NS.TEMPLATES)) {
    for (const fields of Object.values(t.extra || {})) {
      for (const f of fields) {
        if (PHYSICAL.test(f.label)) assert.equal(f.aiFillable, false, id + "." + f.k + " (" + f.label + ") must be aiFillable:false");
      }
    }
  }
});

test("WHO checklist: in the operative note, every item a tap, none AI-fillable, three required", () => {
  const s = NS.schemaFor("operative");
  const who = s.sections.find((x) => x.title === "WHO Surgical Safety Checklist");
  assert.ok(who, "the operative note must carry the WHO checklist");
  assert.ok(who.fields.length >= 10);
  who.fields.forEach((f) => {
    assert.equal(f.type, "choice", f.k);
    assert.equal(f.aiFillable, false, f.k + " is a team act and must never be AI-filled");
    assert.ok(f.options.includes("Not done"), f.k + ": 'Not done' must be recordable");
    assert.ok(NEVER_AI_FILLABLE.includes(f.k), f.k + " must also be on the server deny list");
  });
  assert.deepEqual(who.fields.filter((f) => f.required).map((f) => f.k).sort(), ["whoSignInIdentity", "whoSignOut", "whoTimeOut"]);
});

test("Clavien-Dindo grade is recorded on post-op and discharge notes, never AI-filled", () => {
  for (const type of ["postop", "discharge"]) {
    const f = NS.schemaFor(type).sections.flatMap((x) => x.fields).find((x) => x.k === "clavienDindo");
    assert.ok(f, type + " must carry the Clavien-Dindo grade");
    assert.deepEqual(f.options, ["None", "I", "II", "IIIa", "IIIb", "IVa", "IVb", "V"]);
    assert.equal(f.aiFillable, false);
  }
  assert.ok(NEVER_AI_FILLABLE.includes("clavienDindo"));
});

test("no em-dash anywhere in SURGX content (app-facing text rule)", () => {
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
    return out;
  };
  for (const f of walk(join(ROOT, "surgx")).filter((p) => p.endsWith(".json"))) {
    assert.equal(/—/.test(readFileSync(f, "utf8")), false, f + " contains an em-dash");
  }
});
