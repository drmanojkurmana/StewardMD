/* test/voice-emr.test.mjs — deterministic voice→GHIS-assessment extraction + safety gate.
 * The core promise: spoken vitals/exam fill the RIGHT assessment fields, and the system
 * NEVER invents a diagnosis/finding/value, never lets patient speech become an objective
 * finding, and never silently overwrites a doctor's manual edit.  node --test test/voice-emr.test.mjs
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

// helper: extract → {field: value}
function fields(text) {
  const o = {};
  VV.extract(text).forEach((r) => { o[r.field] = r.value; });
  return o;
}

test("vitals: BP slash + labeled 'by' both parse to systolic/diastolic", () => {
  assert.deepEqual(pick(fields("BP 100/60"), ["bpSys", "bpDia"]), { bpSys: 100, bpDia: 60 });
  assert.deepEqual(pick(fields("blood pressure 130 by 80, pulse 88"), ["bpSys", "bpDia", "pulse"]),
    { bpSys: 130, bpDia: 80, pulse: 88 });
});

test("vitals: pulse / RR / GCS / temperature", () => {
  const f = fields("pulse rate 77 regular, respiratory rate 18, GCS 15, temperature 101 F");
  assert.equal(f.pulse, 77);
  assert.equal(f.pulseRhythm, "Regular");
  assert.equal(f.rr, 18);
  assert.equal(f.gcs, 15);
  assert.equal(f.temp, 101);
});

test("vitals: Celsius temperature is converted to °F (GHIS unit)", () => {
  const f = fields("temp 38 C");            // 38°C = 100.4°F
  assert.equal(f.temp, 100.4);
});

test("safety: 'afebrile' does NOT invent a temperature number", () => {
  const f = fields("patient is afebrile");
  assert.equal(f.temp, undefined);          // no fabricated 98.6
  assert.equal(f.systemicExam, "Afebrile"); // documented as a note instead
});

test("exam phrases map to GHIS enums (the PRD examples)", () => {
  const f = fields(
    "per abdomen soft non-tender, bowel sounds present, no organomegaly; " +
    "S1 S2 normal no murmur; bilateral air entry equal no added sounds, no wheeze; " +
    "conscious oriented, no neck stiffness; no pallor, no icterus, no pedal edema"
  );
  assert.equal(f.tenderness, "No");
  assert.equal(f.bowelSounds, "Normal");
  assert.equal(f.liver, "Not palpable");
  assert.equal(f.spleen, "Not palpable");
  assert.equal(f.murmurs, "No");
  assert.equal(f.breathSounds, "Vesicular");
  assert.equal(f.adventitious, "None");
  assert.equal(f.wheeze, "No");
  assert.equal(f.loc, "Conscious");
  assert.equal(f.orientation, "Yes");
  assert.equal(f.neckStiffness, "No");
  assert.equal(f.pallor, false);
  assert.equal(f.icterus, false);
  assert.equal(f.oedema, false);
});

test("exam phrases: positive findings", () => {
  const f = fields("abdomen distended and tender, hepatomegaly, free fluid present, " +
    "cardiac murmur heard, wheeze present with rhonchi, drowsy and disoriented, neck stiffness positive, pallor present");
  assert.equal(f.abdoShape, "Distended");
  assert.equal(f.tenderness, "Yes");
  assert.equal(f.liver, "Palpable");
  assert.equal(f.freeFluid, "Yes");
  assert.equal(f.murmurs, "Yes");
  assert.equal(f.wheeze, "Yes");
  assert.equal(f.adventitious, "Rhonchi");
  assert.equal(f.loc, "Drowsy");
  assert.equal(f.orientation, "No");
  assert.equal(f.neckStiffness, "Yes");
  assert.equal(f.pallor, true);
});

test("shorthand: abbreviations still parse (b/l air entry, P/A soft)", () => {
  const f = fields("b/l air entry equal; P/A soft non tender");
  assert.equal(f.breathSounds, "Vesicular");
  assert.equal(f.tenderness, "No");
});

test("code-switch: numbers survive surrounding non-English tokens", () => {
  // Telugu-English mix — the numbers/keywords are still English clinical tokens
  const f = fields("BP 120/80 undi, pulse 72 regular ga undi, temperature 99 F");
  assert.equal(f.bpSys, 120);
  assert.equal(f.bpDia, 80);
  assert.equal(f.pulse, 72);
  assert.equal(f.temp, 99);
});

test("HALLUCINATION GUARD: nothing is emitted that wasn't spoken", () => {
  // "fever and cough" must NOT become pneumonia, nor invent any vital/exam value
  const recs = VV.extract("patient has fever and cough for three days");
  assert.equal(recs.length, 0, "no numeric/exam field should be fabricated from a bare complaint");
});

test("SAFETY GATE: patient-reported objective value is dropped, subjective kept", () => {
  const recs = VV.extract("my BP was 150 by 90");   // spoken by the patient
  assert.ok(recs.length >= 2);                       // extractor still parses it...
  const res = MAP.merge(recs, { speaker: "patient", state: {} });
  assert.equal(res.updates.length, 0, "patient-reported BP must NOT fill objective vitals");
  assert.ok(res.dropped.some((d) => d.field === "bpSys" && d.reason === "patient_reported_objective"));
});

test("SAFETY GATE: doctor-edited field is not silently overwritten", () => {
  const recs = VV.extract("BP 100/60");
  const res = MAP.merge(recs, { speaker: "doctor", state: { bpSys: { value: 120, manual: true } } });
  const sys = res.updates.find((u) => u.field === "bpSys");
  assert.equal(sys.applied, false, "must not overwrite the manual edit");
  assert.deepEqual(sys.conflict, { existing: 120, incoming: 100 });
  const dia = res.updates.find((u) => u.field === "bpDia");
  assert.equal(dia.applied, true, "untouched field still fills");
  assert.equal(dia.source, "voice");
});

function pick(o, keys) { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
