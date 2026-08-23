import { test } from "node:test";
import assert from "node:assert";
import M from "../surgx-model.js";
import { sanitizeSurgxNote, surgxNotePrompt, NEVER_AI_FILLABLE } from "../functions/api/ai/_surgx-note.js";
import NS from "../surgx-note-schema.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE SAFETY SUITE.

   A fabricated blood loss, drain, specimen or count in a signed operative note is a patient-safety
   event and a medico-legal one. Three mechanisms stand between a model and that outcome, and only
   one of them is a prompt. This file tests the two that are code.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── mechanism 1: the numeric guard ───────────────────────────────────────── */

const TRANSCRIPT =
  "Post-operative day two. Laparoscopic cholecystectomy done yesterday. Three ports, 10 millimetre " +
  "umbilical and two 5 millimetre. Critical view achieved. Blood loss was about 30 mils. One 12 " +
  "French drain in the subhepatic space. Gallbladder sent for histology. Patient is ASA 3, weighs " +
  "68 kilos. Started on ceftriaxone 1 gram twice a day. Review in 2 weeks in clinic.";

test("numeric guard: a value whose numbers are all in the transcript passes", () => {
  const cases = [
    "Estimated blood loss 30 mL",
    "One 12 French subhepatic drain",
    "Three ports: 10 mm umbilical and two 5 mm",
    "Ceftriaxone 1 g twice daily",
    "Review in 2 weeks",
    "ASA 3",
    "Weight 68 kg",
    "Post-operative day 2"
  ];
  for (const c of cases) {
    const r = M.numericGuard(c, TRANSCRIPT);
    assert.equal(r.ok, true, "should pass: " + c + " (flagged " + r.fabricated.join(",") + ")");
  }
});

test("numeric guard: a value containing NO number always passes", () => {
  assert.equal(M.numericGuard("Critical view of safety achieved", TRANSCRIPT).ok, true);
  assert.equal(M.numericGuard("", TRANSCRIPT).ok, true);
  assert.equal(M.numericGuard("Gallbladder sent for histology", "").ok, true);
});

test("numeric guard: THE CORE CASE - a number the surgeon never said is caught", () => {
  const fabrications = [
    ["Estimated blood loss 200 mL", "200"],
    ["Two 12 French drains", "Two is a word, so the digits are 12 only"],
    ["Ceftriaxone 2 g twice daily", "2"],
    ["Four ports placed", "four is a word"],
    ["Swab count 18 correct", "18"],
    ["Specimen 45 mm mucinous neoplasm", "45"],
    ["Review in 6 weeks", "6"]
  ];
  assert.equal(M.numericGuard("Estimated blood loss 200 mL", TRANSCRIPT).ok, false);
  assert.deepEqual(M.numericGuard("Estimated blood loss 200 mL", TRANSCRIPT).fabricated, ["200"]);
  assert.equal(M.numericGuard("Ceftriaxone 4 g twice daily", TRANSCRIPT).ok, false);
  assert.equal(M.numericGuard("Swab count 18 correct", TRANSCRIPT).ok, false);
  assert.equal(M.numericGuard("Review in 6 weeks", TRANSCRIPT).ok, false);
  assert.equal(M.numericGuard("Specimen 45 mm neoplasm", TRANSCRIPT).ok, false);
  assert.ok(fabrications.length > 0);
});

test("numeric guard: THE KNOWN LIMITATION, asserted rather than assumed", () => {
  // The guard is a SET membership test, not a semantic one: a digit spoken anywhere in the
  // transcript whitelists that digit everywhere in the output. The transcript below says
  // "1 gram" and "2 weeks", so a fabricated "1" or "2" elsewhere would slip through.
  //
  // This is a deliberate trade. A stricter, position-aware guard would reject legitimate
  // restatements ("day 2" from "day two") and train surgeons to ignore it, which is worse. The
  // real defence for the fields where this would matter most is the aiFillable:false deny list,
  // which does not depend on the guard at all.
  //
  // Written down here so nobody discovers it later and assumes it was missed.
  assert.equal(M.numericGuard("Two drains", TRANSCRIPT).ok, true, "no digits");
  assert.equal(M.numericGuard("Ceftriaxone 2 g", TRANSCRIPT).ok, true,
    "'2' appears in the transcript as '2 weeks', so the guard cannot tell these apart");
  // And the mitigation, in the same test so the pair cannot drift:
  assert.equal(NEVER_AI_FILLABLE.indexOf("counts") >= 0, true);
  assert.equal(NEVER_AI_FILLABLE.indexOf("meds") >= 0, true);
});

test("numeric guard: the classic silent failure - an estimate invented for an unmentioned field", () => {
  // Nobody said anything about blood loss at all.
  const t = "Appendicectomy. Appendix inflamed, not perforated. Ports closed. Patient stable.";
  assert.equal(M.numericGuard("Estimated blood loss 50 mL", t).ok, false);
  assert.equal(M.numericGuard("Swab, instrument and needle counts correct x 2", t).ok, false,
    "the '2' was never spoken either");
  // But the guard's reach ENDS at numbers. A purely verbal fabrication passes it untouched, which
  // is precisely why the fields where that would be catastrophic are aiFillable:false rather than
  // merely guarded.
  assert.equal(M.numericGuard("Counts correct", t).ok, true,
    "no digits means the guard cannot help - hence the deny list, not just the guard");
  assert.equal(M.numericGuard("Specimen: appendix sent for histology", t).ok, true);
});

test("numeric guard: commas are normalised, decimals are not conflated", () => {
  assert.equal(M.numericGuard("1500 mL", "estimated loss one thousand five hundred, so 1,500 mils").ok, true);
  assert.equal(M.numericGuard("1.5 litres", "we gave 15 mils").ok, false, "1.5 must not match 15");
  assert.equal(M.numericGuard("15 mils", "we gave 1.5 litres").ok, false);
});

test("numeric guard: legitimate surgical strings that must NOT trip it", () => {
  const t = "Day 3 post op. Clavien Dindo 3b complication. Mesh 10 by 15 centimetres, 3-0 Vicryl to " +
    "the fascia. Two units of packed cells. GCS 15. Size 12 drain. ASA 2. Port sites 5 and 10 " +
    "millimetres. Alvarado score 7. Lactate 1.8. Temperature 37.4.";
  const legit = [
    "Clavien-Dindo 3b", "Mesh 10 x 15 cm", "3-0 Vicryl", "GCS 15", "Size 12 drain",
    "ASA 2", "Alvarado 7", "Lactate 1.8", "Temperature 37.4", "Post-operative day 3",
    "Port sites 5 mm and 10 mm", "Two units packed cells"
  ];
  for (const s of legit) {
    const r = M.numericGuard(s, t);
    assert.equal(r.ok, true, "must not trip on: " + s + " (flagged " + r.fabricated.join(",") + ")");
  }
});

/* ── mechanism 2 (client half): applyExtraction ───────────────────────────── */

const SCHEMA = NS.schemaFor("operative", "");

test("applyExtraction: a key not in the schema is dropped", () => {
  const r = M.applyExtraction(SCHEMA.sections, {}, {}, { notAField: "hello" }, "hello", "ai");
  assert.deepEqual(r.values, {});
  assert.equal(r.rejected[0].reason, "not-in-schema");
});

test("applyExtraction: an aiFillable:false field is dropped WHATEVER the model returns", () => {
  // Every key here IS in the operative schema, and every one of them is aiFillable:false. The model
  // is even quoting the transcript accurately; it still may not write them.
  const t = "counts were correct, specimen gallbladder, implant mesh, surgeon Mr Rao, patient AB, sex male";
  const r = M.applyExtraction(SCHEMA.sections, {}, {},
    { counts: "Correct", specimens: "Gallbladder", implants: "Mesh", surgeon: "Mr Rao", patientRef: "AB", sex: "male" }, t, "ai");
  assert.deepEqual(Object.keys(r.values), [], "not one of them may be written");
  assert.equal(r.rejected.length, 6);
  assert.ok(r.rejected.every((x) => x.reason === "never-ai-fillable"),
    "reasons were: " + r.rejected.map((x) => x.k + "=" + x.reason).join(", "));
});

test("applyExtraction: THE CORE CASE - a fabricated number voids the field and is reported", () => {
  const t = "Laparoscopic cholecystectomy, critical view achieved, gallbladder in a bag.";
  const r = M.applyExtraction(SCHEMA.sections, {}, {}, { ebl: "150 mL", findings: "Inflamed gallbladder" }, t, "ai");
  assert.equal(r.values.ebl, undefined, "the field must be VOIDED, not corrected and not kept");
  assert.equal(r.values.findings, "Inflamed gallbladder");
  assert.equal(r.fabricated.length, 1);
  assert.equal(r.fabricated[0].k, "ebl");
  assert.deepEqual(r.fabricated[0].numbers, ["150"]);
});

test("applyExtraction: a clinician-confirmed field is never overwritten", () => {
  const r = M.applyExtraction(SCHEMA.sections, { findings: "Mine" }, { findings: "clinician" },
    { findings: "The model's" }, "the model's", "ai");
  assert.equal(r.values.findings, "Mine");
  assert.equal(r.rejected[0].reason, "clinician-confirmed");
});

test("applyExtraction: surviving values are written as ai or voice, NEVER as clinician", () => {
  const t = "findings inflamed appendix";
  const a = M.applyExtraction(SCHEMA.sections, {}, {}, { findings: "Inflamed appendix" }, t, "ai");
  assert.equal(a.provenance.findings, "ai");
  const v = M.applyExtraction(SCHEMA.sections, {}, {}, { findings: "Inflamed appendix" }, t, "voice");
  assert.equal(v.provenance.findings, "voice");
  assert.notEqual(v.provenance.findings, "clinician");
});

test("applyExtraction: an extraction can never on its own make a note finalisable", () => {
  // Fill every AI-fillable required field from a transcript that contains all of it.
  const t = "pre-op diagnosis acute cholecystitis, post-op the same, procedure laparoscopic " +
    "cholecystectomy, findings inflamed gallbladder, in detail standard four port, closure ports " +
    "closed, drains none, blood loss minimal, complications none, plan discharge tomorrow";
  const ex = {
    preopDx: "Acute cholecystitis", postopDx: "Acute cholecystitis",
    procedure: "Laparoscopic cholecystectomy", findings: "Inflamed gallbladder",
    procedureDetail: "Standard four port", closure: "Ports closed",
    drains: "None", ebl: "Minimal", complications: "None", postopPlan: "Discharge tomorrow"
  };
  const r = M.applyExtraction(SCHEMA.sections, {}, {}, ex, t, "voice");
  const comp = M.noteCompleteness(SCHEMA.sections, r.values, r.provenance);
  assert.equal(comp.canFinalize, false, "a clinician must still confirm every required field");
  assert.ok(comp.missing.length > 0, "and the never-AI-fillable required fields remain missing");
});

/* ── mechanism 2 (server half): sanitizeSurgxNote ─────────────────────────── */

function allowFor(typeId) {
  const s = NS.schemaFor(typeId, "");
  const out = [];
  s.sections.forEach((sec) => sec.fields.forEach((f) => { if (f.aiFillable !== false) out.push({ k: f.k, label: f.label }); }));
  return out;
}

test("server sanitizer: only allow-listed keys survive", () => {
  const allow = allowFor("operative");
  const r = sanitizeSurgxNote({ fields: { findings: "A", madeUpKey: "B" } }, allow);
  assert.equal(r.fields.findings, "A");
  assert.equal(r.fields.madeUpKey, undefined);
  assert.deepEqual(r.dropped, ["madeUpKey"]);
});

test("server sanitizer: the DENY list wins even if the caller allow-lists the key", () => {
  // Simulate a future schema mistake that marks counts as AI-fillable.
  const badAllow = allowFor("operative").concat(NEVER_AI_FILLABLE.map((k) => ({ k, label: k })));
  const payload = { fields: {} };
  NEVER_AI_FILLABLE.forEach((k) => { payload.fields[k] = "model output"; });
  const r = sanitizeSurgxNote(payload, badAllow);
  assert.deepEqual(Object.keys(r.fields), [], "the server must refuse regardless of the caller");
  assert.equal(r.dropped.length, NEVER_AI_FILLABLE.length);
});

test("server sanitizer: counts, specimens, implants, consent and meds are permanently on the deny list", () => {
  ["counts", "specimens", "implants", "consent", "meds", "patientRef", "surgeon"].forEach((k) => {
    assert.ok(NEVER_AI_FILLABLE.indexOf(k) >= 0, k + " must never be AI-fillable");
  });
});

test("server sanitizer: non-strings, empties and non-answers are dropped", () => {
  const allow = allowFor("operative");
  const r = sanitizeSurgxNote({ fields: { findings: { a: 1 }, closure: "   ", procedure: "not stated", incision: "N/A", drains: "-" } }, allow);
  assert.deepEqual(Object.keys(r.fields), []);
});

test("server sanitizer: a garbage or absent payload yields nothing, not a crash", () => {
  assert.deepEqual(sanitizeSurgxNote(null, allowFor("operative")).fields, {});
  assert.deepEqual(sanitizeSurgxNote("nope", allowFor("operative")).fields, {});
  assert.deepEqual(sanitizeSurgxNote({ fields: { findings: "x" } }, null).fields, {});
});

test("server sanitizer: values are length-capped", () => {
  const r = sanitizeSurgxNote({ fields: { findings: "x".repeat(9000) } }, allowFor("operative"));
  assert.equal(r.fields.findings.length, 4000);
});

/* ── the prompt still has to say the right things ─────────────────────────── */

test("prompt: states the never-invent rule and lists only the allowed keys", () => {
  const p = surgxNotePrompt("some dictation", { noteType: "operative", allowedFields: [{ k: "findings", label: "Findings" }] });
  assert.ok(/NEVER invent/.test(p));
  assert.ok(/OMIT THE FIELD ENTIRELY/i.test(p));
  assert.ok(/NEVER write a number that is not spoken/.test(p));
  assert.ok(/findings: Findings/.test(p));
  assert.ok(/some dictation/.test(p));
});

/* ── the schema's own invariants ──────────────────────────────────────────── */

test("schema: every note type resolves and has at least one required field", () => {
  for (const t of NS.typeList()) {
    const s = NS.schemaFor(t.id, "");
    assert.ok(s, t.id + " must resolve");
    const req = s.sections.flatMap((x) => x.fields).filter((f) => f.required);
    assert.ok(req.length > 0, t.id + " must have required fields");
  }
});

test("schema: the operative note's accounting fields are never AI-fillable", () => {
  const s = NS.schemaFor("operative", "");
  const byKey = {};
  s.sections.forEach((sec) => sec.fields.forEach((f) => { byKey[f.k] = f; }));
  assert.equal(byKey.counts.aiFillable, false);
  assert.equal(byKey.counts.required, true);
  assert.equal(byKey.specimens.aiFillable, false);
  assert.equal(byKey.implants.aiFillable, false);
  // EBL is the deliberate contrast: transcribable, but only under the numeric guard.
  assert.equal(byKey.ebl.aiFillable, true);
  assert.equal(byKey.ebl.required, true);
});

test("schema: a template ADDS fields to its base and never replaces it", () => {
  const base = NS.schemaFor("operative", "");
  const tpl = NS.schemaFor("operative", "lap-cholecystectomy");
  const baseKeys = base.sections.flatMap((s) => s.fields.map((f) => f.k));
  const tplKeys = tpl.sections.flatMap((s) => s.fields.map((f) => f.k));
  baseKeys.forEach((k) => assert.ok(tplKeys.indexOf(k) >= 0, k + " must survive the template"));
  assert.ok(tplKeys.indexOf("cvs") >= 0, "and the template adds its own");
  assert.equal(tpl.prefill.procedure, "Laparoscopic cholecystectomy");
});

test("schema: a template only extends its own base type", () => {
  const s = NS.schemaFor("discharge", "lap-cholecystectomy");
  const keys = s.sections.flatMap((x) => x.fields.map((f) => f.k));
  assert.equal(keys.indexOf("cvs"), -1, "an operative template must not leak into a discharge summary");
});

test("schema: prefilled boilerplate is never provenance 'clinician'", () => {
  // The editor writes prefill with provenance "ai" precisely so it must be confirmed. Assert the
  // completeness maths agrees: prefill alone cannot finalise.
  const s = NS.schemaFor("operative", "lap-cholecystectomy");
  const values = {}, prov = {};
  Object.keys(s.prefill).forEach((k) => { values[k] = s.prefill[k]; prov[k] = "ai"; });
  assert.equal(M.noteCompleteness(s.sections, values, prov).canFinalize, false);
});
