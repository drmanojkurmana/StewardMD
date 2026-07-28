// FollowCare AI — DiagnosisMapper unit tests (deterministic ICD-10 + normalized text → pathway).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-diagnosis.js"); load("followcare-pathways.js");
const DX = globalThis.FollowCareDiagnosis;
const PW = globalThis.FollowCarePathways;

test("spec examples: many diagnosis names → one curated pathway (free text)", () => {
  assert.equal(DX.map("Alcoholic Liver Disease"), "cld");
  assert.equal(DX.map("HCV Cirrhosis"), "cld");
  assert.equal(DX.map("Decompensated CLD"), "cld");
  assert.equal(DX.map("Community Acquired Pneumonia"), "pneumonia");
  assert.equal(DX.map("Aspiration Pneumonia"), "pneumonia");
  assert.equal(DX.map("Acute LV Failure"), "heart_failure");
  assert.equal(DX.map("NSTEMI"), "acs");
  assert.equal(DX.map("Cellulitis Right Leg"), "cellulitis");
  assert.equal(DX.map("Acute Kidney Injury"), "aki");
  assert.equal(DX.map("DKA"), "diabetes");
});

test("ICD-10 codes map (when present), and take precedence over text", () => {
  assert.equal(DX.map("", "J18.9"), "pneumonia");
  assert.equal(DX.map("", "I50.9"), "heart_failure");
  assert.equal(DX.map("", "I21.4"), "acs");        // NSTEMI code
  assert.equal(DX.map("", "K70.30"), "cld");       // alcoholic cirrhosis
  assert.equal(DX.map("", "N17.9"), "aki");
  assert.equal(DX.map("", "E11.9"), "diabetes");
  assert.equal(DX.map("", "A90"), "dengue");
  assert.equal(DX.map("", "L03.115"), "cellulitis");
  assert.equal(DX.map("", "J44.1"), "copd");
  assert.equal(DX.map("", "A15.0"), "tuberculosis");
  // ICD wins over conflicting text
  assert.equal(DX.map("looks like pneumonia clinically", "I50.9"), "heart_failure");
});

test("more disease families resolve from text", () => {
  assert.equal(DX.map("COPD exacerbation"), "copd");
  assert.equal(DX.map("Bronchial asthma"), "asthma");
  assert.equal(DX.map("Sputum positive pulmonary TB"), "tuberculosis");
  assert.equal(DX.map("Left sided pleural effusion"), "pleural_effusion");
  assert.equal(DX.map("Acute ischemic stroke"), "stroke");
  assert.equal(DX.map("Status epilepticus"), "seizure");
  assert.equal(DX.map("CKD stage 5 on dialysis"), "ckd");
  assert.equal(DX.map("Nephrotic syndrome"), "nephrotic");
  assert.equal(DX.map("Acute viral hepatitis"), "hepatitis");
  assert.equal(DX.map("Acute pancreatitis"), "pancreatitis");
  assert.equal(DX.map("Upper GI bleed - variceal"), "ugib");
  assert.equal(DX.map("Falciparum malaria"), "malaria");
  assert.equal(DX.map("Septic shock"), "sepsis");
  assert.equal(DX.map("Organophosphate poisoning"), "poisoning");
  assert.equal(DX.map("Atrial fibrillation with RVR"), "arrhythmia");
  assert.equal(DX.map("Essential hypertension"), "hypertension");
  assert.equal(DX.map("POD-2 laparotomy"), "post_op");
  assert.equal(DX.map("Dengue fever with warning signs"), "dengue");
});

test("unmatched → generic (never null, never blocks enrolment)", () => {
  assert.equal(DX.map("Some rare undocumented condition"), "generic");
  assert.equal(DX.map(""), "generic");
  assert.equal(DX.map(null), "generic");
  assert.equal(DX.map("", ""), "generic");
});

test("mapDetail carries provenance (icd / text / fallback)", () => {
  assert.equal(DX.mapDetail("", "J18.9").matchedBy, "icd");
  assert.equal(DX.mapDetail("Pneumonia").matchedBy, "text");
  assert.equal(DX.mapDetail("xyz").matchedBy, "fallback");
});

test("normalize + normIcd", () => {
  assert.equal(DX.normalize("  Acute  LV-Failure!! "), "acute lv failure");
  assert.equal(DX.normIcd("j18.9 "), "J18.9");
  assert.equal(DX.normIcd("i-21.4"), "I21.4");
});

test("INTEGRITY: every pathway the mapper can return actually exists in the pathway catalog", () => {
  const targets = new Set();
  DX.ICD10_MAP.forEach(row => targets.add(row[1]));
  DX.TEXT_MAP.forEach(row => targets.add(row[1]));
  targets.add("generic"); // the guaranteed fallback
  const missing = [];
  targets.forEach(id => { if (!PW.get(id)) missing.push(id); });
  assert.deepEqual(missing, [], "mapper targets with no matching pathway: " + missing.join(", "));
});
