import { test } from "node:test"; import assert from "node:assert/strict";
import { scribeExtractPrompt, sanitizeScribeOutput, verifySources, flagContradictions } from "../functions/api/ai/_opd-scribe.js";
test("whitelist: only emrFields + suggestions{provisionalDx,ddx,investigations}; drops injected keys", () => {
  const o = sanitizeScribeOutput({ emrFields:{ cc:"fever x3d", Temp:"101", vitals:{x:1} },
    suggestions:{ provisionalDx:"viral fever", ddx:["dengue","enteric fever"], investigations:["CBC","NS1"], drug:"metformin" },
    foo:"bar" });
  assert.deepEqual(Object.keys(o).sort(), ["emrFields","suggestions"]);
  assert.equal(o.emrFields.cc, "fever x3d");
  assert.equal("Temp" in o.emrFields, false);             // vital dropped — vitals are on-device only
  assert.equal("vitals" in o.emrFields, false);           // non-string dropped
  assert.equal(o.suggestions.provisionalDx, "viral fever");
  assert.deepEqual(o.suggestions.ddx, ["dengue","enteric fever"]);
  assert.deepEqual(o.suggestions.investigations, ["CBC","NS1"]);
  assert.equal("drug" in o.suggestions, false);
});
test("caps arrays + strings, drops empties, null-safe", () => {
  const o = sanitizeScribeOutput({ suggestions:{ ddx:Array(50).fill("x"), investigations:["", "  ", "CBC"] } });
  assert.ok(o.suggestions.ddx.length <= 12); assert.deepEqual(o.suggestions.investigations, ["CBC"]);
  assert.deepEqual(sanitizeScribeOutput(null), { emrFields:{}, suggestions:{ ddx:[], investigations:[] } });
});
test("prompt carries the hard safety rules", () => {
  const p = scribeExtractPrompt("patient with fever");
  assert.match(p, /never invent/i); assert.match(p, /provisional.*only if.*stated/i);
  assert.match(p, /patient-reported/i); assert.match(p, /=== TRANSCRIPT ===\npatient with fever$/);
});

// ── Task 6: safety suite (opd-scribe LLM extraction path) ──────────────────────────────────
test("SAFETY: 'start metformin' -- no drug/dose field exists anywhere in the whitelist to invent a dose into", () => {
  // Even if a (hallucinating) LLM response smuggled a drug/dose, the whitelist has no such key
  // in either emrFields or suggestions -- structurally impossible for a dose to reach the app.
  const o = sanitizeScribeOutput({
    emrFields: { cc: "diabetes follow-up", drug: "metformin", dose: "500mg BD", Rx: "metformin 500mg" },
    suggestions: { provisionalDx: "T2DM", ddx: ["T2DM"], investigations: ["HbA1c"], drug: "metformin", dose: "1000mg OD" }
  });
  assert.equal("drug" in o.emrFields, false);
  assert.equal("dose" in o.emrFields, false);
  assert.equal("Rx" in o.emrFields, false);
  assert.equal("drug" in o.suggestions, false);
  assert.equal("dose" in o.suggestions, false);
  assert.deepEqual(Object.keys(o.suggestions).sort(), ["ddx", "investigations", "provisionalDx"]);
  assert.equal(o.emrFields.cc, "diabetes follow-up");                 // narrative still lands
});

test("prompt explicitly forbids inventing a drug or dose", () => {
  const p = scribeExtractPrompt("doctor says start metformin");
  assert.match(p, /never invent a diagnosis, symptom, finding, drug, dose/i);
});

test("SAFETY: a patient-reported vital (e.g. 'my BP was 150') can never reach emrFields via opd-scribe -- no vital keys whitelisted", () => {
  // EMR_FIELD_KEYS is narrative-only (cc/presentHx/pastHx/comorbids); bpSys/bpDia/temp/etc are
  // NEVER in the list, so a spoken vital -- doctor-measured OR patient-reported -- can only reach
  // the assessment via the deterministic voice-vitals+voice-emr-map path (which speaker-gates
  // patient speech; see test/voice-emr.test.mjs), never via this LLM path.
  const o = sanitizeScribeOutput({
    emrFields: { bpSys: "150", bpDia: "90", BP: "150/90", Temp: "101", cc: "fever, patient reports BP was 150 at home" }
  });
  assert.equal("bpSys" in o.emrFields, false);
  assert.equal("bpDia" in o.emrFields, false);
  assert.equal("BP" in o.emrFields, false);
  assert.equal("Temp" in o.emrFields, false);
  assert.equal(o.emrFields.cc, "fever, patient reports BP was 150 at home");   // the REPORT of it, as narrative history -- not a measured vital
});

// ── Task 6: sources (every extracted fact must cite the transcript) ────────────────────────
test("sanitizeScribeOutput: sources whitelisted, cleaned + capped like emrFields; omitted when empty", () => {
  const o1 = sanitizeScribeOutput({ emrFields: { cc: "fever" } });
  assert.equal("sources" in o1, false, "no sources key at all when the model gave none");
  const o2 = sanitizeScribeOutput({
    emrFields: { cc: "fever" },
    sources: { cc: "  patient   has fever  ", bogusKey: "not a real field", Temp: "should be dropped (not in whitelist)", pastHx: 5 }
  });
  assert.equal(o2.sources.cc, "patient has fever");
  assert.equal("bogusKey" in o2.sources, false);
  assert.equal("Temp" in o2.sources, false);
  assert.equal(o2.sources.pastHx, "5");   // numeric source value coerced to string, same as emrFields
  assert.equal(sanitizeScribeOutput({ emrFields: {}, sources: { cc: "x".repeat(3000) } }).sources.cc.length, 2000);
});

test("verifySources: populated field with no source at all is ungrounded", () => {
  const { grounded, ungrounded } = verifySources("some transcript text", { emrFields: { cc: "Fever" } });
  assert.deepEqual(grounded, []);
  assert.deepEqual(ungrounded, ["cc"]);
});

test("verifySources: a fabricated field with no transcript support is ungrounded; a real one is grounded", () => {
  const transcript = "Patient came with fever and cough for three days.";
  const sanitized = {
    emrFields: { cc: "Fever and cough x3 days", allergies: "Penicillin allergy with anaphylaxis" },
    sources: {
      cc: "Patient came with fever and cough for three days.",
      allergies: "Patient reports a severe penicillin allergy with anaphylaxis"   // never said -- fabricated
    }
  };
  const { grounded, ungrounded } = verifySources(transcript, sanitized);
  assert.ok(grounded.includes("cc"));
  assert.ok(ungrounded.includes("allergies"));
});

test("verifySources: normalises case/punctuation so a lightly-cleaned verbatim quote still grounds", () => {
  const transcript = "Patient says: 'BP was 150 at home, Doctor!'";
  const sanitized = { emrFields: { cc: "reports BP 150 at home" }, sources: { cc: "bp was 150 at home doctor" } };
  assert.ok(verifySources(transcript, sanitized).grounded.includes("cc"));
});

// ── Task 10: negation / stopped-medicine contradictions ─────────────────────────────────────
test("scribeExtractPrompt: carries the negation/duration and sources rules", () => {
  const p = scribeExtractPrompt("x");
  assert.match(p, /denies/i);
  assert.match(p, /never be written as present/i);
  assert.match(p, /duration and onset/i);
  assert.match(p, /stopped/i);
  assert.match(p, /verbatim from the transcript/i);
});

test("flagContradictions: 'no fever'/'denies fever' in the transcript must not become an asserted fever field", () => {
  const transcript = "Patient denies fever, has cough for 2 days.";
  const badExtraction = { emrFields: { cc: "Fever, cough x 2 days" } };   // a bad/hallucinated extraction
  const flags = flagContradictions(transcript, badExtraction);
  assert.ok(flags.some(f => f.field === "cc" && f.term === "fever"));
});

test("flagContradictions: a correctly recorded pertinent negative is never flagged", () => {
  const transcript = "Patient denies fever, has cough for 2 days.";
  const goodExtraction = { emrFields: { presentHx: "Denies fever, cough x 2 days" } };
  assert.deepEqual(flagContradictions(transcript, goodExtraction), []);
});

test("flagContradictions: 'fever for 3 days' keeps its duration and is not itself flagged", () => {
  const transcript = "Patient has had fever for 3 days, denies vomiting.";
  const extraction = { emrFields: { cc: "Fever for 3 days" } };
  assert.deepEqual(flagContradictions(transcript, extraction), [], "a truthfully-asserted, undenied symptom is not a contradiction");
  assert.equal(sanitizeScribeOutput({ emrFields: extraction.emrFields }).emrFields.cc, "Fever for 3 days");
});

test("flagContradictions: a stopped drug must not land as a current medicine", () => {
  const transcript = "Patient was on metformin but stopped metformin last month due to GI upset.";
  const badExtraction = { emrFields: { treatmentReceived: "Metformin 500mg BD" } };   // should have been marked discontinued
  const flags = flagContradictions(transcript, badExtraction);
  assert.ok(flags.some(f => f.field === "treatmentReceived" && f.term === "metformin"));
});

test("flagContradictions: a discontinued medicine correctly recorded as such is never flagged", () => {
  const transcript = "Patient was on metformin but stopped metformin last month due to GI upset.";
  const goodExtraction = { emrFields: { pastHx: "Stopped metformin last month (GI upset)" } };
  assert.deepEqual(flagContradictions(transcript, goodExtraction), []);
});

// ── Task 17 support: scribeExtractPrompt(transcript, opts) ─────────────────────────────────
test("scribeExtractPrompt: opts is optional; omitting it (or passing {}/undefined) is byte-identical", () => {
  const t = "patient with fever";
  const a = scribeExtractPrompt(t);
  assert.equal(a, scribeExtractPrompt(t, undefined));
  assert.equal(a, scribeExtractPrompt(t, {}));
  assert.equal(a, scribeExtractPrompt(t, { specialtyPrompt: "" }));
});

test("scribeExtractPrompt: opts.specialtyPrompt is appended to the STRUCTURED EMR FIELDS section only", () => {
  const t = "patient with chest pain";
  const withSpecialty = scribeExtractPrompt(t, { specialtyPrompt: "- ecgFindings: any stated ECG findings" });
  assert.match(withSpecialty, /- ecgFindings: any stated ECG findings/);
  assert.ok(withSpecialty.indexOf("ecgFindings") > withSpecialty.indexOf("STRUCTURED EMR FIELDS"));
  assert.ok(withSpecialty.indexOf("ecgFindings") < withSpecialty.indexOf("NEGATION AND TIME"));
  assert.equal(withSpecialty.replace("- ecgFindings: any stated ECG findings\n", ""), scribeExtractPrompt(t));
});
