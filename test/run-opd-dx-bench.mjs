/* run-opd-dx-bench.mjs — OPD disease-detection benchmark.
 * Measures how well the reasoning engine that powers OPD "Ask MaiK" ranks the correct diagnosis.
 * Two parts, both against the REAL engine + KB loaded headless (same files the app ships):
 *   A) SCORING: curated finding sets (test/vignettes.json) -> differential -> is the expected dx in top-1/3/5?
 *      (isolates the engine's ranking quality, given clean findings)
 *   B) END-TO-END: natural doctor complaint TEXT -> findingsFromText -> differential -> top-1/3/5.
 *      (what a doctor experiences in OPD Ask MaiK: extraction + ranking)
 * Not a unit test — a measurement. Prints a scorecard + the misses. Run: node test/run-opd-dx-bench.mjs
 */
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- headless DOM shim + engine load (mirrors run-maik-natural-bench) --------------------------
const el = () => ({ style: {}, dataset: {}, setAttribute() {}, getAttribute: () => null, appendChild() {}, append() {}, removeChild() {}, insertBefore() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, querySelector: () => null, querySelectorAll: () => [], closest: () => null, remove() {}, innerHTML: "", textContent: "" });
const shim = (k, v) => { try { globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: el, createElementNS: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, head: el(), body: el(), documentElement: el() });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
shim("matchMedia", () => ({ matches: false, addEventListener() {} }));
shim("navigator", { userAgent: "node", language: "en" });
const load = (r) => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) { console.log("LOAD ERR", r, String(e.message).slice(0, 80)); } };
["kb/ai/ambig-abbrev.js","kb/dist/kb.core.js","kb/dist/kb.clinical.js","kb/dist/kb.enrichment.js","kb/dist/kb.enrichment.2.js","kb/dist/kb.rag.js","kb/dist/kb.expanded.js","drugs.js","clinical-nlp.js","clinical-vocab.js","dxmgmt.js","reasoning.js","opd-emr.js"].forEach(load);
const DX = globalThis.DX;
if (!DX || !DX._differential) { console.error("engine failed to load"); process.exit(1); }
DX.findingCatalog();   // trigger the lazy ontology so VALID/LABEL/findingsFromText are populated
// the OPD path's clinical re-ranking (shared with opd-emr's askMaik). RERANK=0 disables it (baseline).
const RERANK = process.env.RERANK !== "0";
const rerank = (globalThis.OPDEMR && globalThis.OPDEMR._clinicalRerank) || ((l) => l.slice().sort((a, b) => (b.score || 0) - (a.score || 0)));

// ---- helpers -----------------------------------------------------------------------------------
function rank(findings) {
  const S = DX._state, saved = S.f;
  try { const f = {}; (findings || []).forEach((k) => { if (k) f[k] = true; }); S.f = f;
    const d = DX._differential() || {};
    const list = (d.inf || []).concat(d.ni || []).map((r) => ({ id: r.id, name: r.name, score: r.score }));
    return RERANK ? rerank(list, findings) : list.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  } finally { S.f = saved; }
}
const norm = (s) => String(s || "").toLowerCase();
// a hit = expected id matches, or the dx name contains the expected keyword(s)
function hit(entry, expect) {
  if (!entry) return false;
  if (entry.id && norm(entry.id) === norm(expect)) return true;
  const n = norm(entry.name);
  return norm(expect).split("|").some((kw) => kw && n.indexOf(kw) >= 0);
}
function rankOf(list, expect) { for (let i = 0; i < list.length; i++) if (hit(list[i], expect)) return i + 1; return 0; }

function scorecard(title, cases, getRanked) {
  let t1 = 0, t3 = 0, t5 = 0; const misses = [];
  for (const c of cases) {
    const list = getRanked(c);
    const pos = rankOf(list, c.expect);
    if (pos === 1) t1++; if (pos && pos <= 3) t3++; if (pos && pos <= 5) t5++;
    if (pos !== 1) misses.push({ label: c.label, expect: c.expect, pos, got: list.slice(0, 3).map((r) => r.name + " (" + Math.round(r.score) + ")") });
  }
  const n = cases.length, pct = (x) => (100 * x / n).toFixed(0) + "%";
  console.log("\n=== " + title + " (n=" + n + ") ===");
  console.log("  top-1: " + t1 + "/" + n + " (" + pct(t1) + ")   top-3: " + t3 + "/" + n + " (" + pct(t3) + ")   top-5: " + t5 + "/" + n + " (" + pct(t5) + ")");
  if (misses.length) {
    console.log("  not top-1 (" + misses.length + "):");
    misses.forEach((m) => console.log("   - [" + (m.pos || "MISS") + "] " + m.label + "  want=" + m.expect + "  got: " + m.got.join(" | ")));
  }
  return { t1, t3, t5, n };
}

// ---- Part A: curated finding sets (vignettes.json) ---------------------------------------------
const vig = JSON.parse(fs.readFileSync(path.join(ROOT, "test/vignettes.json"), "utf8")).vignettes || [];
const partA = vig.map((v) => ({ label: v.label || v.id, expect: v.id.replace(/_/g, "|"), findings: v.findings }));
scorecard("A. SCORING accuracy (curated findings -> differential)", partA, (c) => rank(c.findings));

// ---- Part B: natural doctor complaint text -> findingsFromText -> differential ------------------
// realistic OPD/ED one-liners; expect = keyword(s) that must appear in the ranked dx name (| = any).
const partB = [
  { label: "Exertional chest pain, diabetic/HTN", text: "55 y male, exertional retrosternal chest pain radiating to left arm, sweating, known diabetic and hypertensive", expect: "coronary" },
  { label: "Fever, productive cough, SOB", text: "high fever with productive purulent cough and breathlessness for 3 days, right sided chest pain", expect: "pneumonia" },
  { label: "Headache, neck stiffness, photophobia", text: "severe headache with fever, neck stiffness, photophobia and vomiting for 1 day", expect: "meningitis" },
  { label: "Thunderclap headache", text: "sudden worst ever headache, thunderclap, with neck stiffness and vomiting", expect: "subarachnoid" },
  { label: "Acute focal weakness", text: "sudden onset right sided weakness and slurred speech 2 hours ago, hypertensive", expect: "stroke|ischemic" },
  { label: "Dyspnea, orthopnea, edema", text: "progressive breathlessness, orthopnea, PND and bilateral pedal edema, raised JVP", expect: "heart failure|pulmonary edema" },
  { label: "Pleuritic pain, DVT", text: "acute pleuritic chest pain and breathlessness with hypoxia, unilateral calf swelling", expect: "embolism" },
  { label: "Diabetic ketoacidosis", text: "known diabetic, vomiting, abdominal pain, deep rapid breathing, polyuria and drowsy", expect: "ketoacidosis|hyperosmolar" },
  { label: "Dysuria, flank pain, fever", text: "fever with dysuria, left flank pain and vomiting for 2 days", expect: "pyelonephritis|urinary" },
  { label: "RUQ pain, jaundice, fever", text: "fever with right upper quadrant pain, jaundice and vomiting, Murphy positive", expect: "cholangitis|cholecystitis" },
  { label: "Septic shock", text: "fever, hypotension, tachycardia, confusion and high lactate", expect: "sepsis|septic" },
  { label: "Asthma exacerbation", text: "known asthmatic, acute breathlessness with wheeze, using accessory muscles", expect: "asthma" },
  { label: "COPD exacerbation", text: "known COPD smoker, increased breathlessness and cough with sputum", expect: "copd" },
  { label: "Upper GI bleed", text: "hematemesis and melena, giddiness, known alcoholic with chronic liver disease", expect: "bleed|variceal|peptic" },
  { label: "Acute pancreatitis", text: "severe epigastric pain radiating to back with vomiting, alcohol binge", expect: "pancreatitis" },
  { label: "Aortic dissection", text: "sudden tearing chest and back pain, hypertensive, unequal pulses", expect: "dissection" },
  { label: "Migraine", text: "recurrent throbbing unilateral headache with photophobia and nausea, no fever", expect: "migraine" },
  { label: "Dengue", text: "high fever, severe body ache, retro-orbital pain, rash and low platelets", expect: "dengue" },
  { label: "Malaria", text: "intermittent high fever with chills and rigors, sweating, splenomegaly", expect: "malaria" },
  { label: "Acute MI (inferior)", text: "central crushing chest pain with sweating and nausea, ECG ST elevation", expect: "coronary" },
  { label: "Status/seizure", text: "witnessed generalized tonic clonic seizure with frothing and tongue bite, now drowsy", expect: "seizure|epilep" },
  { label: "Organophosphate poisoning", text: "pinpoint pupils, hypersalivation, sweating, vomiting after pesticide ingestion", expect: "organophosphate|poison|cholinergic" },
  { label: "Anaphylaxis", text: "acute facial and lip swelling, breathlessness and rash after a bee sting", expect: "anaphylax" },
  { label: "Nephrotic syndrome", text: "frothy urine, generalized swelling, periorbital puffiness, heavy proteinuria", expect: "nephrotic" },
  { label: "Hyperkalemia", text: "known CKD, weakness, palpitations, ECG peaked T waves, high potassium", expect: "hyperkal|potassium" },
  { label: "Pneumothorax", text: "sudden pleuritic chest pain and breathlessness, reduced breath sounds one side", expect: "pneumothorax" },
  { label: "GI: acute appendicitis", text: "periumbilical pain shifting to right iliac fossa, fever, anorexia, vomiting", expect: "appendicitis" },
  { label: "Stroke (hemorrhagic)", text: "sudden severe headache, vomiting, right hemiparesis, very high BP, on warfarin", expect: "hemorrhage|stroke|intracerebral" },
  { label: "Thyroid storm / hyperthyroid", text: "palpitations, tremor, heat intolerance, weight loss, neck swelling, tachycardia", expect: "thyro|thyroid" },
  { label: "TB (pulmonary)", text: "chronic cough for 3 weeks with evening fever, weight loss and night sweats, hemoptysis", expect: "tuberculosis|tb" }
];
// SANITY: does the on-device NLP vocabulary actually run headless? A canonical case must extract fever+cough.
const sane = (DX.findingsFromText("high fever with cough and breathlessness") || []).length >= 2;
if (!sane) {
  console.log("\n=== B. END-TO-END (natural text) — SKIPPED ===");
  console.log("  SMD_NLP's base vocabulary does not run under Node (only FT_SYN synonyms extract), so text->findings");
  console.log("  is crippled here and any Part-B score would be a false LOWER BOUND. Measure end-to-end ON-DEVICE");
  console.log("  (CDP: DX.findingsFromText -> differential) for the true figure. Part A below is environment-independent.");
} else {
  scorecard("B. END-TO-END accuracy (natural complaint text -> findingsFromText -> differential)", partB,
    (c) => rank(DX.findingsFromText(c.text)));
  let extractedTotal = 0, extractedZero = 0;
  partB.forEach((c) => { const k = DX.findingsFromText(c.text) || []; extractedTotal += k.length; if (!k.length) extractedZero++; });
  console.log("\n  extraction: avg " + (extractedTotal / partB.length).toFixed(1) + " findings/complaint; " + extractedZero + " complaints yielded 0 findings");
}
