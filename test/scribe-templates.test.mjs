/* Item 17: specialty templates for MaiK Scribe (scribe-templates.js, window.SMD_SCRIBETPL). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SMD_SCRIBETPL = require("../scribe-templates.js");

const IDS = ["general", "paediatrics", "obgyn", "surgery-followup", "orthopaedics", "ophthalmology", "ent", "dermatology", "psychiatry", "dental",
  "general-surgery", "anaesthesia", "emergency", "cardiology", "pulmonology", "neurology", "nephrology-urology", "diabetes-endocrine",
  "gastro-hepatology", "rheumatology", "geriatrics", "palliative"];

test("list() returns every template as {id, label, description}, general first", () => {
  const rows = SMD_SCRIBETPL.list();
  assert.equal(rows.length, IDS.length);
  assert.deepEqual(rows.map((r) => r.id), IDS);
  rows.forEach((r) => {
    assert.equal(typeof r.id, "string");
    assert.equal(typeof r.label, "string");
    assert.equal(typeof r.description, "string");
    assert.ok(r.id && r.label && r.description);
  });
});

test("get(id) returns the documented shape for every known template", () => {
  IDS.forEach((id) => {
    const t = SMD_SCRIBETPL.get(id);
    assert.equal(t.id, id);
    assert.equal(typeof t.label, "string");
    assert.ok(Array.isArray(t.promptLines));
    assert.ok(Array.isArray(t.requiredFields) && t.requiredFields.length > 0);
    assert.ok(Array.isArray(t.checklist) && t.checklist.length > 0);
    t.promptLines.forEach((l) => assert.equal(typeof l, "string"));
    t.requiredFields.forEach((f) => assert.equal(typeof f, "string"));
  });
});

test("general is the default: no extra prompt lines, still has required fields and a checklist", () => {
  const t = SMD_SCRIBETPL.get("general");
  assert.deepEqual(t.promptLines, []);
  assert.ok(t.requiredFields.length > 0);
});

test("paediatrics covers weight/dose-per-kg, feeding, immunisation and milestones", () => {
  const t = SMD_SCRIBETPL.get("paediatrics");
  const joined = t.promptLines.join(" ").toLowerCase();
  assert.match(joined, /per kilogram|mg\/kg/);
  assert.match(joined, /feeding/);
  assert.match(joined, /immunisation status|vaccination/);
  assert.match(joined, /developmental milestones/);
  assert.ok(t.requiredFields.includes("diet"));
  assert.ok(t.requiredFields.includes("immunization"));
});

test("obgyn covers LMP, gravida/para, EDD and obstetric history", () => {
  const t = SMD_SCRIBETPL.get("obgyn");
  const joined = t.promptLines.join(" ").toLowerCase();
  assert.match(joined, /last menstrual period/);
  assert.match(joined, /gravida and para/);
  assert.match(joined, /estimated date of delivery|edd/);
  assert.match(joined, /obstetric history/);
  assert.ok(t.requiredFields.includes("lmp"));
});

test("surgery follow-up covers wound, drain, suture removal and pathology", () => {
  const t = SMD_SCRIBETPL.get("surgery-followup");
  const joined = t.promptLines.join(" ").toLowerCase();
  assert.match(joined, /wound condition/);
  assert.match(joined, /drain/);
  assert.match(joined, /suture or staple status/);
  assert.match(joined, /pathology/);
});

test("an unknown or falsy id returns the general/default template, not null or a throw", () => {
  assert.equal(SMD_SCRIBETPL.get("cardiology-not-a-real-id").id, "general");
  assert.equal(SMD_SCRIBETPL.get("").id, "general");
  assert.equal(SMD_SCRIBETPL.get(undefined).id, "general");
  assert.equal(SMD_SCRIBETPL.get(null).id, "general");
});

test("get() never returns a live reference into the registry -- callers can mutate freely", () => {
  const a = SMD_SCRIBETPL.get("paediatrics");
  a.promptLines.push("mutated");
  a.requiredFields.push("mutated");
  const b = SMD_SCRIBETPL.get("paediatrics");
  assert.ok(!b.promptLines.includes("mutated"));
  assert.ok(!b.requiredFields.includes("mutated"));
});

test("specialty-kit templates: every requiredField is a real voice field, and none prompts a guess", async () => {
  const { createRequire } = await import("node:module");
  const OE = createRequire(import.meta.url)("../opd-emr.js");
  ["orthopaedics", "ophthalmology", "ent", "dermatology", "psychiatry", "dental", "general-surgery", "anaesthesia", "emergency", "cardiology", "pulmonology", "neurology",
    "nephrology-urology", "diabetes-endocrine", "gastro-hepatology", "rheumatology", "geriatrics", "palliative"].forEach((id) => {
    const t = SMD_SCRIBETPL.get(id);
    assert.equal(t.id, id);
    t.requiredFields.forEach((f) => assert.ok(OE.VOICE_MAP[f], `${id}: ${f} is a VOICE_MAP key`));
    t.promptLines.slice(1).forEach((l) => {
      const key = l.replace(/^- /, "").split(":")[0];
      key.split(/\s*[\/,]\s*/).forEach((k) => assert.ok(OE.VOICE_MAP[k.trim()], `${id}: prompt names ${k} as a field`));
    });
    assert.match(t.promptLines.join(" "), /as stated|as dictated|exactly/);
    assert.doesNotMatch(t.promptLines.join(" ") + t.description + t.checklist.join(" "), /[\u2013\u2014]/);
  });
  assert.match(SMD_SCRIBETPL.get("psychiatry").promptLines.join(" "), /Never omit a stated risk/);
});
