// scripts/edge/generate.mjs — canonical dataset for the Edge router (Edge-Master-Plan A0.4, section 6).
//
//   node scripts/edge/generate.mjs            -> vault/plans/edge-data/dataset/{canonical,train,val,test}.jsonl + manifest.json
//
// One canonical row per request:
//   { id, family_id, input_text, lang, kind, target, accept:[ids], candidates:[{kind,id,title}],
//     target_option, target_in_candidates, route_by, rules, schema_version, split, tags }
// route_by mirrors edge-router.js route(): "negated" and "rules" never reach the model, "empty" has no
// options, "model" is the only kind a model is trained or scored on. accept lists every id that is a
// correct answer (two calculators share a title, or an alias names several), so label noise from
// duplicates is not counted as a model error.
// Splits are fixed by hashing family_id, and whole PHRASING FAMILIES are held out for test, so no
// test phrasing (or a paraphrase of it) ever appears in training. 10% of targets are held out
// entirely, to measure generalisation to an option the model never saw. Synthetic data only: no
// patient data, ever (rule S11).
import path from "node:path";
import fs from "node:fs";
import { loadApp, OUT_DIR, SCHEMA_VERSION, sha, unit, writeJsonl } from "./lib.mjs";

const { E, M } = loadApp();
const rows = [];
let n = 0;

// Phrasing families. "test" families are never used for train/val rows.
const T = {
  calc: {
    train: ["open {t}", "{t}", "calculate {t}", "{t} calculator", "show {t}", "{a}", "need {t} for this patient", "{a} score"],
    test: ["can you pull up {t}", "{t} please", "i want to work out the {t}", "go to {a}"]
  },
  tool: {
    train: ["open {t}", "{t}", "go to {t}", "open the {t} screen", "{k}"],
    test: ["take me to {t}", "show me {t}", "where is {t}"]
  },
  icd: {
    train: ["icd code for {d}", "icd10 {d}", "icd for {d}"],
    test: ["what is the icd code of {d}", "diagnosis code for {d}"]
  },
  hinglish: { train: ["{a} kholo", "{a} dikhao"], test: ["{a} khol do"] },
  tenglish: { train: ["{a} open cheyyi", "{a} chupinchu"], test: ["{a} teruvu"] }
};

function add(text, lang, kind, target, family, tags, accept) {
  const cands = E.candidates(text);
  const ok = target ? (accept && accept.length ? accept : [target]).map(String) : [];
  const idx = target ? cands.findIndex((c) => c.kind === kind && ok.includes(String(c.id))) : -1;
  const rules = !!(cands[0] && ((cands[0].kind === "calculator" && cands[0].exact) || cands[0].kind === "icd"));
  const route_by = E.negated(text) ? "negated" : !cands.length ? "empty" : rules ? "rules" : "model";
  rows.push({
    id: "e" + String(++n).padStart(6, "0") + "-" + sha(text + "|" + target).slice(0, 6),
    family_id: family, input_text: text, lang, kind: kind || "none", target: target || null, accept: ok,
    candidates: cands.map((c) => ({ kind: c.kind, id: c.id, title: c.title })),
    target_option: target ? (idx >= 0 ? idx + 1 : 0) : 0,
    target_in_candidates: target ? idx >= 0 : true,
    route_by, rules, schema_version: SCHEMA_VERSION, split: null, tags: tags || []
  });
}
function fill(tpl, vars) { return tpl.replace(/\{(\w)\}/g, (_, k) => vars[k] || "").replace(/\s+/g, " ").trim(); }
const heldOutTarget = (key) => unit("target:" + key) < 0.10;

// ---- calculators ---------------------------------------------------------------------------
const calcs = M._calcs;
const nm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameOf = (c) => String(c.title).replace(/\s*\(.*\)\s*$/, "");
const byName = {}, byAlias = {};
calcs.forEach((c) => {
  (byName[nm(nameOf(c))] = byName[nm(nameOf(c))] || []).push(c.id);
  [c.id.replace(/_/g, " ")].concat(c.kw || []).forEach((k) => { const a = (byAlias[nm(k)] = byAlias[nm(k)] || []); if (!a.includes(c.id)) a.push(c.id); });
});
// Calculators that compute each other's score: opening either answers the request.
// "MELD & MELD-Na" (meld) shows MELD-Na, so it is a correct answer for a MELD-Na request and back.
const ALSO = { meld_na: ["meld"], meld: ["meld_na"] };
calcs.forEach((c) => {
  const title = nameOf(c);
  const alias = (c.kw && c.kw[0]) || c.id.replace(/_/g, " ");
  ["train", "test"].forEach((part) => T.calc[part].forEach((tpl, ti) => {
    const usesAlias = /\{a\}/.test(tpl);
    const accept = usesAlias ? byAlias[nm(alias)] || [c.id] : byName[nm(title)] || [c.id];
    add(fill(tpl, { t: title.toLowerCase(), a: String(alias).toLowerCase() }), "en", "calculator", c.id,
      `calc:${part}${ti}:${c.id}`, part === "test" ? ["heldout-phrasing"] : [], [...new Set([c.id].concat(accept, ALSO[c.id] || []))]);
  }));
});

// Calculators with values (the W2 prefill workflow). Formats differ between train and test.
const VALUED = [
  ["crcl", ["crcl {age}{sx} {wt}kg cr {cr}", "creatinine clearance {age} yo {sex} {wt} kg creat {cr}"], ["cockcroft gault for a {age} year old {sex}, weight {wt} kg, s.cr {cr}"]],
  ["curb65", ["curb65 {age} yo rr {rr} bp {sbp}/{dbp} urea {urea}", "curb 65 {age} year old confused rr {rr} bp {sbp}/{dbp} urea {urea}"], ["pneumonia severity curb-65: {age} years, rr {rr}, bp {sbp} by {dbp}, urea {urea}"]],
  ["qsofa", ["qsofa rr {rr} bp {sbp}/{dbp}", "qsofa rr {rr} bp {sbp}/{dbp} confused"], ["quick sofa: resp rate {rr}, bp {sbp} over {dbp}"]],
  ["anion_gap", ["anion gap na {na} cl {cl} hco3 {hco3}"], ["ag: sodium {na}, chloride {cl}, bicarbonate {hco3}"]],
  ["meld3", ["meld 3.0 bili {bili} inr {inr} creat {cr} na {na} alb {alb}"], ["meld 3.0 with bilirubin {bili}, inr {inr}, creatinine {cr}, sodium {na}, albumin {alb}"]]
];
function rnd(key, lo, hi, d) { const v = lo + unit(key) * (hi - lo); return d ? Math.round(v * 10 ** d) / 10 ** d : Math.round(v); }
VALUED.forEach(([id, trainT, testT]) => {
  for (let k = 0; k < 12; k++) {
    const s = id + k, female = unit(s + "s") < 0.5;
    const v = { age: rnd(s + "a", 18, 90), wt: rnd(s + "w", 40, 110), cr: rnd(s + "c", 0.5, 4.5, 1), rr: rnd(s + "r", 12, 38),
      sbp: rnd(s + "b", 80, 170), dbp: rnd(s + "d", 45, 95), urea: rnd(s + "u", 3, 20), na: rnd(s + "n", 120, 150), cl: rnd(s + "l", 90, 112),
      hco3: rnd(s + "h", 8, 28), bili: rnd(s + "i", 0.4, 12, 1), inr: rnd(s + "j", 0.9, 3.5, 1), alb: rnd(s + "k", 1.8, 4.6, 1),
      sx: female ? "F" : "M", sex: female ? "female" : "male" };
    if (v.dbp >= v.sbp) v.dbp = v.sbp - 30;
    trainT.forEach((tpl, ti) => add(tpl.replace(/\{(\w+)\}/g, (_, x) => v[x]), "en", "calculator", id, `val:train${ti}:${id}`, ["values"]));
    testT.forEach((tpl, ti) => add(tpl.replace(/\{(\w+)\}/g, (_, x) => v[x]), "en", "calculator", id, `val:test${ti}:${id}`, ["values", "heldout-phrasing"]));
  }
});

// ---- tools (home tiles) --------------------------------------------------------------------
const TOOL_KW = { antibiogram: "resistance patterns", icu: "critical care dashboard", insulin: "sliding scale", electrolytes: "sodium correction",
  icdsearch: "diagnosis codes", interactions: "drug interactions", queue: "opd token queue", calculators: "clinical scores", dosecalc: "dose calculator", pglog: "logbook" };
loadApp().tools.forEach((t) => {
  ["train", "test"].forEach((part) => T.tool[part].forEach((tpl, ti) => {
    if (tpl === "{k}" && !TOOL_KW[t.act]) return;
    add(fill(tpl, { t: t.tt.toLowerCase(), k: TOOL_KW[t.act] }), "en", "tool", t.act, `tool:${part}${ti}:${t.act}`, part === "test" ? ["heldout-phrasing"] : []);
  }));
  ["hinglish", "tenglish"].forEach((lang) => ["train", "test"].forEach((part) => T[lang][part].forEach((tpl, ti) => {
    add(fill(tpl, { a: t.tt.toLowerCase() }), lang === "hinglish" ? "hi-Latn" : "te-Latn", "tool", t.act, `${lang}:${part}${ti}:${t.act}`, part === "test" ? ["heldout-phrasing"] : []);
  })));
});

// ---- ICD -------------------------------------------------------------------------------------
const icd = JSON.parse(fs.readFileSync(path.join(path.dirname(OUT_DIR), "..", "..", "..", "icd", "icd10.min.json"), "utf8"));
icd.filter((_, i) => i % 40 === 0).slice(0, 250).forEach(([code, title]) => {
  const d = String(title).toLowerCase();
  ["train", "test"].forEach((part) => T.icd[part].forEach((tpl, ti) => {
    const text = fill(tpl, { d });
    const cands = E.candidates(text);
    const target = cands[0] && cands[0].kind === "icd" ? cands[0].id : null;
    add(text, "en", target ? "icd" : null, target, `icd:${part}${ti}:${code}`, part === "test" ? ["heldout-phrasing"] : []);
  }));
});

// ---- drugs (the drug card) -------------------------------------------------------------------
const DRUG_T = {
  train: [["open {g}", "en"], ["{g} drug card", "en"], ["show {g}", "en"], ["{b} kholo", "hi-Latn"], ["{g} open cheyyi", "te-Latn"]],
  test: [["{g} monograph", "en"], ["{b} details", "en"], ["{g} dikhao", "hi-Latn"], ["{b} chupinchu", "te-Latn"]]
};
(globalThis.MEDDRUGS ? globalThis.MEDDRUGS._list : []).forEach((d) => {
  // The label is the app's own drug id (SMD_DRUGLINK generic), not the monograph's display name.
  const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase(), b = String((d.brands || []).find((x) => x.length >= 4) || g).toLowerCase();
  const DL = globalThis.SMD_DRUGLINK, hit = DL && DL.drugsIn ? DL.drugsIn(g, { fuzzy: false })[0] : null;
  if (!hit) return;
  ["train", "test"].forEach((part) => DRUG_T[part].forEach(([tpl, lang], ti) => {
    add(fill(tpl, { g, b }), lang, "drug", hit.generic, `drug:${part}${ti}:${hit.generic}`, part === "test" ? ["heldout-phrasing"] : []);
  }));
});

// ---- none: clinical questions for MaiK, and off-topic ----------------------------------------
// A question goes to MaiK even when an option shares a word with it ("management of pneumonia" vs
// CURB-65): the router opens a module only when the module was asked for.
const CONDITIONS = ["pneumonia", "sepsis", "diabetic ketoacidosis", "hyperkalemia", "hyponatremia", "acute kidney injury", "dengue",
  "malaria", "typhoid", "tuberculosis", "heart failure", "atrial fibrillation", "acute coronary syndrome", "stroke", "status epilepticus",
  "asthma exacerbation", "copd exacerbation", "upper gi bleed", "cirrhosis with ascites", "pancreatitis", "snake bite",
  "organophosphate poisoning", "preeclampsia", "postpartum haemorrhage", "neonatal jaundice", "bronchiolitis", "febrile seizure",
  "meningitis", "cellulitis", "urinary tract infection", "thyroid storm", "adrenal crisis", "anaphylaxis", "hypertensive emergency",
  "pulmonary embolism", "deep vein thrombosis", "nephrotic syndrome", "rheumatic fever", "scrub typhus", "leptospirosis"];
const NONE_T = {
  train: [["how do i treat {c}", "en"], ["management of {c}", "en"], ["what causes {c}", "en"], ["first line treatment for {c}", "en"],
    ["investigations for {c}", "en"], ["approach to {c}", "en"], ["complications of {c}", "en"], ["differential diagnosis of {c}", "en"],
    ["when to refer {c}", "en"], ["pathophysiology of {c}", "en"], ["{c} ka ilaj batao", "hi-Latn"], ["{c} ki em cheyali", "te-Latn"]],
  test: [["how should {c} be managed", "en"], ["workup for suspected {c}", "en"], ["red flags in {c}", "en"],
    ["{c} ka treatment kya hai", "hi-Latn"], ["{c} ki treatment enti", "te-Latn"]]
};
CONDITIONS.forEach((c) => ["train", "test"].forEach((part) => NONE_T[part].forEach(([tpl, lang], ti) =>
  add(fill(tpl, { c }), lang, null, null, `none:${part}${ti}:${c}`, part === "test" ? ["heldout-phrasing"] : []))));
const NONE = [
  "what is the differential for fever with rash and thrombocytopenia", "why is my patient hypokalemic", "side effects of amiodarone",
  "when to start insulin in type 2 diabetes", "is it safe to give ceftriaxone in pregnancy", "what antibiotics cover pseudomonas",
  "book a cab to the airport", "what's the cricket score", "tell me a joke", "play some music", "set an alarm for 6", "write me a poem",
  "patient denies fever", "no cough no breathlessness", "ms", "pt", "ok thanks"
];
NONE.forEach((q, i) => add(q, "en", null, null, `none:misc${i % 5 === 0 ? "test" : "train"}${i}`, i % 5 === 0 ? ["heldout-phrasing"] : []));

// ---- negation (danger): never acted on, by the guard, so never trained -------------------------
const NEG_T = ["don't open {t}", "do not calculate {t}", "no need to open {t}", "stop {t}"];
const negTargets = loadApp().tools.slice(0, 20).map((t) => t.tt.toLowerCase())
  .concat(calcs.filter((_, i) => i % 15 === 0).map((c) => nameOf(c).toLowerCase()))
  .concat((globalThis.MEDDRUGS ? globalThis.MEDDRUGS._list : []).filter((_, i) => i % 10 === 0).map((d) => String(d.generic).toLowerCase()));
negTargets.forEach((t, i) => NEG_T.forEach((tpl, ti) => add(fill(tpl, { t }), "en", null, null, `neg:test${ti}:${i}`, ["danger", "negation"])));

// ---- hard cases (danger set for the router) -------------------------------------------------
const HARD = [
  ["meld 3.0", "calculator", "meld3", "version"], ["meld na score", "calculator", "meld_na", "version"],
  ["open curb-65", "calculator", "curb65", "exact"], ["wells score", null, null, "ambiguous"], ["ms", null, null, "ambiguous"],
  ["stop metformin", null, null, "not-a-tool"], ["do not open the icu", null, null, "negation"]
];
HARD.forEach(([q, kind, target, why], i) => add(q, "en", kind, target, `hard:test${i}`, ["danger", why], target && ALSO[target] ? [target].concat(ALSO[target]) : null));
add("iss score", "en", "calculator", "iss_myeloma", "hard:test-iss", ["danger", "version"]);
add("ipi", "en", "calculator", "ipi", "hard:test-ipi", ["danger", "version"]);

// ---- splits ----------------------------------------------------------------------------------
rows.forEach((r) => {
  const fam = r.family_id, target = (r.kind || "none") + ":" + (r.target || "");
  if (/:test\d*:/.test(fam) || /^(none:misc|hard:)test/.test(fam) || r.tags.includes("danger")) r.split = "test";
  else if (r.target && heldOutTarget(target)) { r.split = "test"; r.tags.push("heldout-target"); }
  else r.split = unit("split:" + fam) < 0.1 ? "val" : "train";
});

// No family may straddle splits.
const famSplit = {};
rows.forEach((r) => { if (famSplit[r.family_id] && famSplit[r.family_id] !== r.split) throw new Error("family straddles splits: " + r.family_id); famSplit[r.family_id] = r.split; });

// No test text may appear in train/val under another family (two templates can render the same words).
// The copy outside test is dropped, so the frozen test set stays untouched.
const testText = new Set(rows.filter((r) => r.split === "test").map((r) => r.input_text.toLowerCase()));
const leaked = rows.filter((r) => r.split !== "test" && testText.has(r.input_text.toLowerCase()));
leaked.forEach((r) => { r.split = "dropped"; });
for (let i = rows.length - 1; i >= 0; i--) if (rows[i].split === "dropped") rows.splice(i, 1);

fs.mkdirSync(OUT_DIR, { recursive: true });
writeJsonl(path.join(OUT_DIR, "canonical.jsonl"), rows);
const bySplit = { train: [], val: [], test: [] };
rows.forEach((r) => bySplit[r.split].push(r));
Object.keys(bySplit).forEach((k) => writeJsonl(path.join(OUT_DIR, k + ".jsonl"), bySplit[k]));
const manifest = {
  schema_version: SCHEMA_VERSION, generated: new Date().toISOString().slice(0, 10),
  counts: Object.fromEntries(Object.entries(bySplit).map(([k, v]) => [k, v.length])),
  dropped_as_leaks: leaked.length,
  route_by: rows.reduce((a, r) => ((a[r.route_by] = (a[r.route_by] || 0) + 1), a), {}),
  model_rows: Object.fromEntries(Object.entries(bySplit).map(([k, v]) => [k, v.filter((r) => r.route_by === "model").length])),
  recall_at_5: Number((rows.filter((r) => r.target).filter((r) => r.target_in_candidates).length / rows.filter((r) => r.target).length).toFixed(4)),
  sha256: Object.fromEntries(["canonical", "train", "val", "test"].map((k) => [k, sha(fs.readFileSync(path.join(OUT_DIR, k + ".jsonl"), "utf8"))])),
  note: "Synthetic only. test.jsonl is frozen: changing it requires a new schema_version and a note in the plan."
};
fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
