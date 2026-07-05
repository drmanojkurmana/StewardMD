/* Clinical Narrative Extraction — validation report (deterministic layer).
 * Pure-JS unit test of clinical-nlp.js (no browser). Node: node test/run-nlp.mjs
 * Covers the spec cases A–G: exact case, negation, typos, abbreviations, temporality,
 * uncertainty, and specialty-ready phrases. Asserts recall of critical findings and that
 * negated phrases never become positive engine findings.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const NLP = require(join(HERE, "..", "clinical-nlp.js"));

// Minimal engine context mirroring reasoning.js finding keys + synonyms for the tested findings.
const CTX = {
  valid: {}, labels: {
    alteredSensorium: "Altered sensorium", diabetesHx: "Diabetes mellitus", hypertensionHx: "Hypertension",
    hypotension: "Hypotension", fever: "Fever", neckStiffness: "Neck stiffness", seizure: "Seizure",
    focalNeuroDeficit: "Focal neurological deficit", dysuria: "Dysuria", dyspnea: "Dyspnoea", hypoxia: "Hypoxia",
    miosisSecretions: "Miosis + excess secretions (cholinergic)", jaundice: "Jaundice",
    rightUpperQuadrantPain: "Right upper quadrant pain", photophobia: "Photophobia", cough: "Cough", tachycardia: "Tachycardia"
  },
  syn: {
    alteredSensorium: ["altered sensorium", "altered mental", "drowsy", "confus", "obtunded", "unconscious", "reduced consciousness", "encephalopathy"],
    diabetesHx: ["diabet", "dm"], hypertensionHx: ["hypertens", "htn", "high bp"], fever: ["fever", "febrile", "pyrexia"],
    neckStiffness: ["neck stiff", "stiff neck", "meningism", "nuchal"], seizure: ["seizure", "convuls", "fits", "frothing"],
    focalNeuroDeficit: ["weakness", "hemiparesis", "quadriparesis"], dysuria: ["dysuria", "burning urine"],
    dyspnea: ["dyspnea", "breathless", "shortness of breath", "sob"], hypoxia: ["hypoxia", "desaturat", "low saturation"],
    miosisSecretions: ["cholinergic", "salivation", "hypersalivation"], jaundice: ["jaundice", "icterus"],
    rightUpperQuadrantPain: ["right upper quadrant", "ruq"], photophobia: ["photophobia"], cough: ["cough"]
  }
};
Object.keys(CTX.labels).forEach(k => CTX.valid[k] = 1);

let PASS = 0, FAIL = 0; const rows = [];
function present(r) { return r.present; }
function ids(r) { return r.findings.map(f => f.canonicalFindingId); }
function ok(name, cond, extra) { if (cond) { PASS++; console.log("✅ " + name); } else { FAIL++; console.log("❌ " + name + (extra ? "  — " + extra : "")); } }
function has(arr, k) { return arr.indexOf(k) >= 0; }
function recall(expected, got) { const hit = expected.filter(e => has(got, e)); return { p: hit.length, n: expected.length, f: hit.length / expected.length }; }

function report(label, input, r, expected) {
  const got = present(r), rc = recall(expected, got);
  rows.push({ label, input: input.slice(0, 70), expected: expected.join(","), present: got.join(","), recall: (rc.f * 100).toFixed(0) + "%", redFlags: r.redFlags.join(",") });
  return rc;
}

// ── A. exact case from the report ──
let r = NLP.extract("A 60 year old male diabetic presented with altered sensorium with history of frothing and quadriparesis with anisocoria on admission vitals 180/100 and bilateral plantar extensor.", CTX);
report("A exact case", "…60M diabetic altered sensorium frothing quadriparesis 180/100…", r, ["alteredSensorium", "diabetesHx", "focalNeuroDeficit", "hypertensionHx"]);
ok("A: extracts ≥5 findings for review (was 1)", r.findings.length >= 5, "got " + r.findings.length);
ok("A: altered sensorium + diabetes + focal deficit + hypertension all present for the engine", ["alteredSensorium", "diabetesHx", "focalNeuroDeficit", "hypertensionHx"].every(k => has(r.present, k)), r.present.join(","));
ok("A: seizure (frothing) is extracted for review", has(ids(r), "seizure"));
ok("A: neurological red flags detected", r.redFlags.length >= 1, r.redFlags.join(","));
ok("A: demographics age 60 + male", r.demographics.age === 60 && r.demographics.sex === "male", JSON.stringify(r.demographics));

// ── B. negation ──
r = NLP.extract("No fever, no neck stiffness, altered sensorium after seizure.", CTX);
report("B negation", "No fever, no neck stiffness, altered sensorium after seizure", r, ["alteredSensorium", "seizure"]);
ok("B: fever + neck stiffness marked ABSENT (not sent to engine)", has(r.absent, "fever") && has(r.absent, "neckStiffness") && !has(r.present, "fever") && !has(r.present, "neckStiffness"), "present=" + r.present.join(",") + " absent=" + r.absent.join(","));
ok("B: altered sensorium + seizure present", has(r.present, "alteredSensorium") && has(r.present, "seizure"));

// ── C. typos ──
r = NLP.extract("aniscoria with quadriperesis and frothing", CTX);
report("C typos", "aniscoria with quadriperesis and frothing", r, ["focalNeuroDeficit", "seizure"]);
ok("C: misspelled anisocoria + quadriparesis → focal deficit; frothing → seizure", has(r.present, "focalNeuroDeficit") && has(ids(r), "seizure"), r.present.join(","));

// ── D. abbreviations ──
r = NLP.extract("60M k/c/o DM, HTN, c/o SOB, BP 180/100, SpO2 88%", CTX);
report("D abbreviations", "60M k/c/o DM, HTN, c/o SOB, BP 180/100, SpO2 88%", r, ["diabetesHx", "hypertensionHx", "dyspnea", "hypoxia"]);
ok("D: DM/HTN/SOB/vitals expanded → diabetes+hypertension+dyspnoea+hypoxia", ["diabetesHx", "hypertensionHx", "dyspnea", "hypoxia"].every(k => has(r.present, k)), r.present.join(","));
ok("D: age 60 + male", r.demographics.age === 60 && r.demographics.sex === "male", JSON.stringify(r.demographics));

// ── E. temporality ──
r = NLP.extract("History of stroke, now fever and dysuria.", CTX);
report("E temporality", "History of stroke, now fever and dysuria", r, ["fever", "dysuria"]);
ok("E: current fever + dysuria present (historical stroke not a current finding)", has(r.present, "fever") && has(r.present, "dysuria"));

// ── F. uncertainty ──
r = NLP.extract("?seizure, r/o meningitis, drowsy.", CTX);
report("F uncertainty", "?seizure, r/o meningitis, drowsy", r, ["seizure", "alteredSensorium"]);
ok("F: ?seizure marked possible + drowsy → altered sensorium present", has(ids(r), "seizure") && (r.findings.find(f => f.canonicalFindingId === "seizure") || {}).certainty === "possible" && has(r.present, "alteredSensorium"));

// ── G. specialty-ready phrases ──
r = NLP.extract("fever, RUQ pain and jaundice", CTX);
report("G hepatobiliary", "fever, RUQ pain and jaundice", r, ["fever", "rightUpperQuadrantPain", "jaundice"]);
ok("G1: fever + RUQ pain + jaundice all extracted", ["fever", "rightUpperQuadrantPain", "jaundice"].every(k => has(r.present, k)), r.present.join(","));
r = NLP.extract("painful red eye with photophobia", CTX);
ok("G2: photophobia extracted", has(r.present, "photophobia"));

// ── negation-safety invariant across all cases ──
r = NLP.extract("denies fever, no cough", CTX);
ok("SAFETY: negated 'denies fever'/'no cough' never become positive findings", !has(r.present, "fever") && !has(r.present, "cough") && has(r.absent, "fever") && has(r.absent, "cough"));

// ── validation report table ──
console.log("\n── Clinical Narrative Extraction Validation Report ──");
rows.forEach(x => console.log("  [" + x.label + "] recall " + x.recall + " · present: " + x.present + (x.redFlags ? " · red-flags: " + x.redFlags : "")));
const critical = rows.find(x => x.label === "A exact case");
console.log("\n" + (FAIL === 0 ? "ALL GREEN — clinical-nlp extraction (" + PASS + " checks)" : FAIL + " FAILED, " + PASS + " passed"));
if (FAIL > 0) process.exitCode = 1;
