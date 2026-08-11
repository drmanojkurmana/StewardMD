import { test } from "node:test"; import assert from "node:assert/strict";
import { scribeExtractPrompt, sanitizeScribeOutput } from "../functions/api/ai/_opd-scribe.js";
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
