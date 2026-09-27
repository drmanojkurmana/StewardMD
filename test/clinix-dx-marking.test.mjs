/* test/clinix-dx-marking.test.mjs - regressions for CliniX differential / diagnosis / plan marking.
 *
 * 2026-09-27 audit. Marking matched an accept term as a whole-word SUBSTRING of the pick, so a
 * generic accept term marked wrong picks right ("attack" passed Transient ischaemic attack for
 * asthma, "idiopathic" passed Idiopathic pulmonary fibrosis for Parkinson disease). Marking is now
 * by CONCEPT: the pick and each accept term resolve to vocabulary entries and must be the same one.
 * The same audit found breadth counted picks rather than ideas, the plan MCQ passed anyone who
 * ticked every non-harmful option, the level-1 hint named the module's system rather than the
 * answer's, hyphenated action keys never matched, and three plan options were medically wrong.
 *
 * Runs against the real shipped content and vocabulary.
 * node --test test/clinix-dx-marking.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DX from "../clinix-dx.js";
import M from "../clinix-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VOCAB = JSON.parse(readFileSync(join(ROOT, "clinix/dx-vocabulary.json"), "utf8"));
const ALL = [];      // every case in every disease file
const BY = {};       // disease id -> its first case
for (const f of readdirSync(join(ROOT, "clinix/diseases")).sort()) {
  const d = JSON.parse(readFileSync(join(ROOT, "clinix/diseases", f), "utf8"));
  for (const c of (d.cases || [])) {
    const cd = { ...c, system: d.system || c.system, _disease: d.id };
    ALL.push(cd);
    if (!BY[d.id]) BY[d.id] = cd;
  }
}
const caseOf = (id) => { assert.ok(BY[id], "case content missing: " + id); return BY[id]; };
const entry = (n) => { const e = VOCAB.dx.find((d) => d.n === n); assert.ok(e, "vocabulary lacks " + n); return e.n; };

/* ── 1. a shared word is not a shared diagnosis ──────────────────────────────────────────────── */

const WRONG_PICKS = {
  "bronchial-asthma": ["Transient ischaemic attack", "Acute exacerbation of COPD"],
  "parkinsonism": ["Idiopathic pulmonary fibrosis"],
  "chronic-liver-disease": ["Wernicke encephalopathy", "Birth asphyxia"],
  "ascites": ["Non alcoholic fatty liver disease", "Acute decompensated heart failure"],
  "ischaemic-heart-disease": ["Non ST elevation myocardial infarction"],
  "congestive-cardiac-failure": ["Cor pulmonale"],
  "cord-compression": ["Tuberculous meningitis"],
  "pleural-effusion": ["Tuberculous meningitis", "Abdominal tuberculosis"],
  "ataxia": ["Megaloblastic anaemia"]
};

test("a pick that merely shares a word with an accept term is not the diagnosis", () => {
  const bad = [];
  for (const id in WRONG_PICKS) {
    const c = caseOf(id);
    for (const pick of WRONG_PICKS[id]) {
      entry(pick);
      if (DX.scoreDiagnosis(c, pick, VOCAB).correct) bad.push(`${id}: "${pick}" marked as the diagnosis`);
      if (DX.scoreDifferential(c, [pick], VOCAB).hasTruth) bad.push(`${id}: "${pick}" counted as the true diagnosis in the differential`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the screen's keyword marker cannot re-open the hole: no wrong vocabulary pick passes markAnswer either", () => {
  // clinix-screens.js marks the picked NAME with clinix-model markAnswer as well, and only ever
  // upgrades the result with the picker's verdict. So a diagnosis accept list must never let the
  // keyword marker pass a wrong vocabulary entry on its own.
  const bad = [];
  for (const c of ALL) {
    const accept = (c.diagnosis && c.diagnosis.accept) || [];
    if (!accept.length) continue;
    for (const d of VOCAB.dx) {
      if (DX.scoreDiagnosis(c, d.n, VOCAB).correct) continue;
      if (M.markAnswer({ accept }, d.n).correct === true) bad.push(`${c._disease}: "${d.n}"`);
    }
  }
  assert.deepEqual(bad, [], "wrong picks the keyword marker would pass");
});

test("every diagnosis accept term names a concept, and the case's own answer scores correct", () => {
  const bad = [];
  for (const c of ALL) {
    const accept = (c.diagnosis && c.diagnosis.accept) || [];
    assert.ok(accept.length, c._disease + ": no diagnosis accept list");
    for (const t of accept) if (!DX.findByTerm(VOCAB, t)) bad.push(`${c._disease}: "${t}" resolves to nothing`);
    const canon = DX.canonicalConcept(c, VOCAB);
    if (!canon) { bad.push(c._disease + ": no canonical concept"); continue; }
    if (!DX.scoreDiagnosis(c, canon.n, VOCAB).correct) bad.push(`${c._disease}: its own answer "${canon.n}" scores incorrect`);
    if (!DX.scoreDifferential(c, [canon.n], VOCAB).hasTruth) bad.push(`${c._disease}: "${canon.n}" is not the truth in the differential`);
  }
  assert.deepEqual(bad, []);
});

test("every differential accept term names a concept or a family of them, so every idea is reachable", () => {
  const bad = [];
  for (const c of ALL) {
    for (const t of ((c.differentialModel && c.differentialModel.accept) || [])) {
      if (!DX.conceptsFor(VOCAB, t, { differential: true }).length) bad.push(`${c._disease}: "${t}"`);
    }
    const need = c.differentialModel && c.differentialModel.minMatch;
    if (need) assert.ok(DX.differentialItems(c, VOCAB).length >= need, c._disease + ": fewer distinct ideas than minMatch");
  }
  assert.deepEqual(bad, [], "differential terms no vocabulary entry can satisfy");
});

test("the specific cases named in the audit resolve to the right concept", () => {
  assert.equal(DX.findByTerm(VOCAB, "b12 deficiency").n, "Vitamin B12 deficiency", "not megaloblastic anaemia");
  assert.equal(DX.scoreDiagnosis(caseOf("ataxia"), entry("Subacute combined degeneration of the cord"), VOCAB).correct, true);
  assert.equal(DX.findByTerm(VOCAB, "parkinson").n, "Parkinson disease");
  assert.equal(DX.findByTerm(VOCAB, "Parkinson's disease").n, "Parkinson disease");
  assert.equal(DX.findByTerm(VOCAB, "tuberculosis").n, "Pulmonary tuberculosis");
  assert.equal(DX.findByTerm(VOCAB, "ischemic stroke").n, "Ischaemic stroke", "American spelling");
  const tb = caseOf("tuberculosis");
  assert.equal(DX.scoreDiagnosis(tb, "Pulmonary tuberculosis", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(tb, "Multidrug resistant tuberculosis", VOCAB).correct, false, "the case is rifampicin sensitive");
  assert.equal(DX.scoreDiagnosis(caseOf("parkinsonism"), "Parkinson disease", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(caseOf("ischaemic-heart-disease"), "ST elevation myocardial infarction", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(caseOf("congestive-cardiac-failure"), "Heart failure with reduced ejection fraction", VOCAB).correct, true, "the case says HFrEF");
});

test("pleural effusion: the syndrome and the tuberculous cause both score, and both land on the differential", () => {
  const c = caseOf("pleural-effusion");
  for (const pick of ["Pleural effusion", "Tuberculous pleural effusion"]) {
    entry(pick);
    assert.equal(DX.scoreDiagnosis(c, pick, VOCAB).correct, true, pick + " as the diagnosis");
    const r = DX.scoreDifferential(c, [pick], VOCAB);
    assert.deepEqual(r.matched, [pick], pick + " matches the model differential");
    assert.equal(r.hasTruth, true);
  }
  assert.equal(DX.scoreDiagnosis(c, "Malignant pleural effusion", VOCAB).correct, false);
});

test("an ambiguous abbreviation names no concept, whichever entry comes first in the file", () => {
  const reversed = { ...VOCAB, dx: VOCAB.dx.slice().reverse() };
  for (const v of [VOCAB, reversed]) {
    for (const abbr of ["ms", "as"]) assert.equal(DX.findByTerm(v, abbr), null, abbr + " is ambiguous");
    for (const pick of ["Mitral stenosis", "Multiple sclerosis", "Aortic stenosis", "Ankylosing spondylitis"]) {
      assert.equal(DX.satisfies(v, pick, "ms"), false);
      assert.equal(DX.satisfies(v, pick, "as"), false);
    }
    assert.equal(DX.findByTerm(v, "mitral stenosis").n, "Mitral stenosis");
  }
  // A name outranks another entry's synonym: that is not an ambiguity.
  assert.equal(DX.findByTerm(VOCAB, "amoebiasis").n, "Amoebiasis");
});

test("a term the vocabulary does not know falls back to text, but never on a generic word", () => {
  const fake = (accept) => ({ id: "x", diagnosis: { accept, answer: "x" } });
  assert.equal(DX.scoreDiagnosis(fake(["attack"]), "Transient ischaemic attack", VOCAB).correct, false);
  assert.equal(DX.scoreDiagnosis(fake(["idiopathic"]), "Idiopathic pulmonary fibrosis", VOCAB).correct, false);
  assert.equal(DX.scoreDiagnosis(fake(["decompensated"]), "Acute decompensated heart failure", VOCAB).correct, false);
  assert.equal(DX.scoreDiagnosis(fake(["chronic disease"]), "Anaemia of chronic disease", VOCAB).correct, false, "two generic words are still generic");
  assert.equal(DX.scoreDiagnosis(fake(["combined degeneration"]), "Subacute combined degeneration of the cord", VOCAB).correct, true, "a specific phrase still lands");
  assert.equal(DX.scoreDiagnosis(fake(["Some unlisted syndrome"]), "Some unlisted syndrome", VOCAB).correct, true, "an exact free-text match lands");
});

/* ── 2. breadth counts ideas, not picks ──────────────────────────────────────────────────────── */

test("two variants of one idea are one idea", () => {
  const ccf = caseOf("congestive-cardiac-failure");
  const hf = DX.scoreDifferential(ccf, ["Congestive cardiac failure", "Heart failure with reduced ejection fraction"], VOCAB);
  assert.equal(hf.ideas, 1);
  assert.equal(hf.correct, false, "CCF + HFrEF is one idea, minMatch is " + hf.need);
  const pn = DX.scoreDifferential(ccf, ["Community acquired pneumonia", "Aspiration pneumonia"], VOCAB);
  assert.equal(pn.ideas, 1);
  const tb = caseOf("tuberculosis");
  const two = DX.scoreDifferential(tb, ["Pulmonary tuberculosis", "Miliary tuberculosis"], VOCAB);
  assert.equal(two.ideas, 1);
  assert.equal(two.correct, false);
  const real = DX.scoreDifferential(ccf, ["Congestive cardiac failure", "Community acquired pneumonia"], VOCAB);
  assert.equal(real.ideas, 2);
  assert.equal(real.correct, true);
  assert.equal(DX.scoreDifferential(tb, ["Pulmonary tuberculosis", "Lung abscess"], VOCAB).correct, true);
});

test("the missed list names each idea once", () => {
  const tb = DX.scoreDifferential(caseOf("tuberculosis"), ["Lung abscess"], VOCAB);
  assert.equal(tb.missed.filter((m) => /tuberc|^tb$/i.test(m)).length, 1, tb.missed.join(", "));
  const ccf = DX.scoreDifferential(caseOf("congestive-cardiac-failure"), ["Congestive cardiac failure"], VOCAB);
  assert.equal(ccf.missed.filter((m) => /liver|cirrho/i.test(m)).length, 1, ccf.missed.join(", "));
  assert.equal(ccf.missed.filter((m) => /an(a)?emia/i.test(m)).length, 1, ccf.missed.join(", "));
  for (const c of ALL) {
    const r = DX.scoreDifferential(c, [], VOCAB);
    assert.equal(new Set(r.missed.map((m) => m.toLowerCase())).size, r.missed.length, c._disease + ": " + r.missed.join(", "));
  }
});

/* ── 3. the management MCQ ───────────────────────────────────────────────────────────────────── */

test("ticking every option that is not harmful does not pass any case", () => {
  const passed = [];
  let n = 0;
  for (const c of ALL) {
    const opts = DX.planOptions(c);
    if (!opts.length) continue;
    n++;
    const safe = opts.filter((o) => !o.harm).map((o) => o.id);
    const r = DX.scorePlan(c, safe, opts);
    if (r.correct) passed.push(c._disease);
    assert.ok(r.wrong.length >= 2, c._disease + ": at least two plain wrong options are on offer");
    for (const w of r.wrong) assert.ok(w.reason && w.reason.length > 10, "a wrong pick says why: " + w.text);
  }
  assert.ok(n >= 15, "most cases have an MCQ plan");
  assert.deepEqual(passed, []);
});

test("one plain slip beside a complete plan still passes; two do not", () => {
  const c = caseOf("copd");
  const opts = DX.planOptions(c);
  const right = opts.filter((o) => o.correct).map((o) => o.id);
  const plain = opts.filter((o) => !o.correct && !o.harm).map((o) => o.id);
  const one = DX.scorePlan(c, right.concat(plain.slice(0, 1)), opts);
  assert.equal(one.correct, true);
  assert.equal(one.wrong.length, 1);
  assert.ok(one.precision < 100);
  const two = DX.scorePlan(c, right.concat(plain.slice(0, 2)), opts);
  assert.equal(two.correct, false);
});

/* ── 4. hints point at the answer's system ───────────────────────────────────────────────────── */

test("the level-1 hint names the system the answer is filed under", () => {
  const want = { ascites: "hepbil", "chronic-liver-disease": "hepbil", jaundice: "hepbil", hepatomegaly: "cvs", splenomegaly: "heme", anemia: "heme" };
  for (const id in want) {
    const c = caseOf(id);
    const h1 = DX.hints(c, VOCAB, c.system).find((h) => h.level === 1);
    assert.ok(h1, id + ": no level-1 hint");
    assert.equal(h1.system, want[id], id + ": " + h1.text);
    assert.doesNotMatch(h1.text, /gastrointestinal|general and multisystem/i, id);
  }
  for (const c of ALL) {
    const h1 = DX.hints(c, VOCAB, c.system).find((h) => h.level === 1);
    assert.equal(h1.system, DX.canonicalConcept(c, VOCAB).s, c._disease);
    // Filtering to the hinted system must actually show the answer.
    assert.ok(DX.bySystem(VOCAB, h1.system).some((e) => DX.scoreDiagnosis(c, e.n, VOCAB).correct), c._disease + ": the answer is not in the hinted system");
  }
});

/* ── 5. action text ──────────────────────────────────────────────────────────────────────────── */

test("every action key is written the way an accept term normalises, and none is declared twice", () => {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const k of Object.keys(DX.ACTION_TEXT)) assert.equal(k, norm(k), "unreachable key: " + k);
  const src = readFileSync(join(ROOT, "clinix-dx.js"), "utf8");
  const block = src.slice(src.indexOf("var ACTION_TEXT = {"), src.indexOf("};", src.indexOf("var ACTION_TEXT = {")));
  const keys = [...block.matchAll(/^\s*"([^"]+)":/gm)].map((m) => norm(m[1]));
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, [], "duplicate ACTION_TEXT keys (the later one silently wins)");
});

test("hyphenated accept terms get their written action, not the raw fragment", () => {
  const texts = (id) => DX.planOptions(caseOf(id)).map((o) => o.text);
  assert.ok(texts("tuberculosis").includes("Arrange follow up sputum examination to confirm conversion"));
  assert.ok(texts("parkinsonism").includes("Ask about and treat the non motor symptoms"));
  for (const c of ALL) for (const o of DX.planOptions(c)) assert.doesNotMatch(o.text, /^(Follow|Non|Anti)-/, c._disease + ": " + o.text);
});

test("plan wording is right for the case it appears in", () => {
  const chd = DX.planOptions(caseOf("congenital-heart-disease")).filter((o) => o.correct);
  for (const o of chd) assert.doesNotMatch(o.text, /\badmit/i, "a small asymptomatic VSD is not admitted: " + o.text);
  for (const id of ["ascites", "chronic-liver-disease"]) {
    const diu = DX.planOptions(caseOf(id)).find((o) => o.correct && o.term === "diuretic");
    assert.ok(diu, id + ": the diuretic option is offered");
    assert.match(diu.text, /aldosterone antagonist first in cirrhotic ascites/i, id);
    assert.doesNotMatch(diu.text, /^Start an intravenous loop/i, id);
  }
  const drain = DX.planOptions(caseOf("jaundice")).find((o) => o.correct && o.term === "drainage");
  assert.ok(drain);
  assert.doesNotMatch(drain.text, /collection/i, "cholangitis has an obstructed biliary tree, not a collection");
});

test("no plan option carries a dose, a frequency or an em-dash", () => {
  const DOSE = /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|kg|ml|l|units?|iu|mmol|meq)\b|\b\d+\s*(g|mg)\s*\/|\b(od|bd|tds|qds|qid|tid|bid|prn|stat)\b|once daily|twice daily|three times a day/i;
  const all = Object.values(DX.ACTION_TEXT).concat(DX.DISTRACTORS.map((d) => d.t));
  for (const c of ALL) for (const o of DX.planOptions(c)) all.push(o.text);
  for (const t of all) {
    assert.doesNotMatch(t, DOSE, "dose in option: " + t);
    assert.equal(t.indexOf("—"), -1, "em-dash in option: " + t);
  }
  for (const d of DX.DISTRACTORS) assert.equal((d.why || "").indexOf("—"), -1);
});
