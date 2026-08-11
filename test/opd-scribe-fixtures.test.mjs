/* test/opd-scribe-fixtures.test.mjs — Telugu / English / code-switch transcript fixtures (Task 6, Step 2).
 * Text-level only: drives the SAME two-layer pipeline the app uses --
 *   1. deterministic layer (voice-vitals.extract -> voice-emr-map.merge) for vitals/exam, speaker-gated
 *   2. LLM layer (sanitizeScribeOutput on a FIXTURE llm response -> voice-scribe-ground.ground)
 *      for narrative EMR fields + grounded Dx/differential/investigations suggestions
 * Each fixture asserts the resulting emrFields, and that ddx/investigations never contain anything
 * beyond what the injected engine differential or the fixture LLM output actually named (no
 * fabrication), regardless of language mix. A real on-device Whisper transcription benchmark
 * (Telugu accuracy, latency) is device-gated -- see docs/superpowers/reports/2026-08-11-ambient-scribe-report.md.
 * node --test test/opd-scribe-fixtures.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const VV = require(join(HERE, "..", "voice-vitals.js"));
const MAP = require(join(HERE, "..", "voice-emr-map.js"));
const G = require(join(HERE, "..", "voice-scribe-ground.js"));
import { sanitizeScribeOutput } from "../functions/api/ai/_opd-scribe.js";

function detFields(transcript, speaker) {
  const recs = VV.extract(transcript);
  const res = MAP.merge(recs, { speaker: speaker || "doctor", state: {} });
  const out = {};
  res.updates.forEach((u) => { if (u.applied) out[u.field] = u.value; });
  return { fields: out, dropped: res.dropped };
}

// ── Fixture 1: English consult -- vitals fill deterministically, ddx/investigations are engine-anchored ──
test("FIXTURE (English): fever+cough consult -- vitals fill, no dx invented beyond what's grounded", () => {
  const transcript = "Patient came with fever and cough for three days. BP is 128 by 82, pulse 84 regular, " +
    "temperature 100.4 F. Bilateral air entry equal, no added sounds, no wheeze. This looks like a viral upper " +
    "respiratory infection. Let's get a CBC and chest X-ray.";
  const det = detFields(transcript, "doctor");
  assert.equal(det.fields.bpSys, 128); assert.equal(det.fields.bpDia, 82);
  assert.equal(det.fields.pulse, 84); assert.equal(det.fields.temp, 100.4);
  assert.equal(det.fields.adventitious, "None"); assert.equal(det.fields.wheeze, "No");

  // simulated LLM extract response for this transcript (fixture, no network call)
  const llmRaw = { emrFields: { cc: "fever and cough x3 days", presentHx: "fever and cough for three days" },
    suggestions: { provisionalDx: "Viral URI", ddx: ["Viral URI"], investigations: ["CBC", "Chest X-ray"] } };
  const sanitized = sanitizeScribeOutput(llmRaw);
  assert.equal(sanitized.emrFields.cc, "fever and cough x3 days");
  assert.equal("bpSys" in sanitized.emrFields, false, "vitals never travel via the LLM emrFields path");

  const grounded = G.ground(transcript, sanitized.suggestions, {
    findings: ["fever", "cough"],
    differential: () => [{ dx: "Viral URI", score: 0.7 }],
    investigationsFor: (dx) => ({ "Viral URI": ["CBC"] }[dx] || [])
  });
  const ddxLabels = grounded.ddx.map((d) => d.label.toLowerCase());
  assert.ok(!ddxLabels.includes("pneumonia"), "pneumonia not invented -- nobody (engine or clinician) named it");
  assert.deepEqual(ddxLabels, ["viral uri"]);
  assert.equal(grounded.ddx[0].source, "engine");
  const invLabels = grounded.investigations.map((i) => i.label);
  assert.ok(invLabels.includes("CBC") && invLabels.includes("Chest X-ray"));
});

// ── Fixture 2: Telugu / English code-switch -- deterministic numbers still parse; no fabrication ──
test("FIXTURE (Telugu code-switch): vitals parse across the language mix; unstated dx never appears", () => {
  // "fever for three days ... BP 130/85 ... pulse 78 regular ... no pallor no icterus ... chest clear"
  // spoken with Telugu connective words interleaved (as the on-device multilingual model would transcribe it).
  const transcript = "జ్వరం మూడు రోజులు నుండి ఉంది, BP 130/85 ఉంది, pulse 78 regular ga undi, " +
    "no pallor no icterus, chest clear ga undi.";
  const det = detFields(transcript, "doctor");
  assert.equal(det.fields.bpSys, 130); assert.equal(det.fields.bpDia, 85);
  assert.equal(det.fields.pulse, 78); assert.equal(det.fields.pulseRhythm, "Regular");
  assert.equal(det.fields.pallor, false); assert.equal(det.fields.icterus, false);
  assert.equal(det.fields.adventitious, "None");

  // no diagnosis was stated in Telugu or English -- the LLM fixture correctly returns none,
  // and grounding with a real (empty-for-this-picture) engine differential stays empty too.
  const llmRaw = { emrFields: { cc: "fever x3 days (జ్వరం మూడు రోజులు)" }, suggestions: { ddx: [], investigations: [] } };
  const sanitized = sanitizeScribeOutput(llmRaw);
  assert.match(sanitized.emrFields.cc, /fever x3 days/);
  const grounded = G.ground(transcript, sanitized.suggestions, { findings: ["fever"], differential: () => [], investigationsFor: () => [] });
  assert.deepEqual(grounded.ddx, [], "no dx invented when neither engine nor clinician named one, in any language");
  assert.deepEqual(grounded.investigations, []);
});

// ── Fixture 3: patient-reported vital, code-switched -- dropped regardless of language ──
test("FIXTURE (Telugu code-switch, patient speech): 'naaku BP 150 undi' (my BP is 150) never becomes a measured vital", () => {
  const transcript = "naaku BP 150 by 90 undi, thala noppi kuda ఉంది";   // patient: "I have BP 150 by 90, also headache"
  const det = detFields(transcript, "patient");
  assert.equal(det.fields.bpSys, undefined, "patient-reported BP must not fill the objective vital");
  assert.equal(det.fields.bpDia, undefined);
  assert.ok(det.dropped.some((d) => d.field === "bpSys" && d.reason === "patient_reported_objective"));
});

// ── Fixture 4: "start metformin" narrated in a code-switch transcript -- no dose invented ──
test("FIXTURE (code-switch): 'metformin start cheddam' (let's start metformin) -- no dose reaches emrFields or suggestions", () => {
  const transcript = "sugar control ga ledu, metformin start cheddam, follow up two weeks lo.";
  // even a (hallucinating) fixture LLM response that smuggled a dose is structurally dropped
  const llmRaw = { emrFields: { cc: "poor sugar control", drug: "metformin", dose: "500mg BD" },
    suggestions: { ddx: [], investigations: [], drug: "metformin", dose: "500mg BD" } };
  const sanitized = sanitizeScribeOutput(llmRaw);
  assert.equal(sanitized.emrFields.cc, "poor sugar control");
  assert.equal("drug" in sanitized.emrFields, false); assert.equal("dose" in sanitized.emrFields, false);
  assert.equal("drug" in sanitized.suggestions, false); assert.equal("dose" in sanitized.suggestions, false);
});
