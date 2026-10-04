// scripts/edge/generate-test3.mjs: the NEW frozen test set for the Edge router, schema edge-router-3
// (Edge-Runbook 5c). The edge-router-2 test set was seen by r7 (round 2), so it can no longer pick or judge.
//
//   node scripts/edge/generate.mjs && node scripts/edge/needle-r2.mjs build     (train, val, dev, r7's train file)
//   node scripts/edge/generate-test3.mjs   -> vault/plans/edge-data/dataset/{test3.jsonl, manifest3.json}
//
// Unseen by construction, and checked here (the script throws otherwise):
//  - every template is new: none is a generate.mjs or needle-r2.mjs template;
//  - no row text equals a train, val, dev, old-test or r7-training text (r7's train file is pinned by sha256);
//  - "heldout-target" rows name a target that r7 never saw as an answer and that is not a dev target;
//  - KB disease-page options are on: the app offers them (MaiKKB.resolveTarget + SMD_REASON.hasDiseaseRef),
//    the old generator ran without the KB, so no train/dev/test row ever had one.
// Labels follow generate.mjs: a request for a module opens it, a question goes to MaiK (none), an
// ambiguous name, a negation or a clinical order is never acted on (danger). Synthetic only, no patient data.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadApp, OUT_DIR, ROOT, sha, unit, readJsonl, writeJsonl } from "./lib.mjs";

export const SCHEMA3 = "edge-router-3";
const R7_TRAIN = path.join(OUT_DIR, "export", "needle-local", "train.r2.jsonl");
const R7_TRAIN_SHA = "3520ce49c4243fe447cd61cb3819557da2c1a497d2cd5267629c05ef96d79810";   // r7's train.think.jsonl, byte-identical

const { E, M, tools } = loadApp();
// The KB stores the router reads. hasDiseaseRef in Node checks KB_ENRICHMENT only (the app also checks
// SYNDROMES and DDX_NI, which live in app.js / reasoning.js): Node offers a KB option only where the app does.
["kb/dist/kb.enrichment.js", "kb/dist/kb.rag.js", "dxmgmt.js", "kb/ai/maik-kb.js"].forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
globalThis.SMD_REASON = { hasDiseaseRef: (id) => !!(globalThis.KB_ENRICHMENT && KB_ENRICHMENT.byId && KB_ENRICHMENT.byId[id]) };

// ---- what r7 and the selection split have seen ----------------------------------------------------
const need = (f) => { if (!fs.existsSync(f)) throw new Error("missing " + f + ": run generate.mjs and needle-r2.mjs build first"); return f; };
if (sha(fs.readFileSync(need(R7_TRAIN), "utf8")) !== R7_TRAIN_SHA) throw new Error("train.r2.jsonl is not r7's training file");
const old = ["train", "val", "dev", "test"].flatMap((s) => readJsonl(need(path.join(OUT_DIR, s + ".jsonl"))));
const r7 = readJsonl(R7_TRAIN);
const seen = new Set(old.map((r) => r.input_text.toLowerCase()).concat(r7.map((r) => r.query.split("\nOptions:")[0].toLowerCase())));
// Targets r7 was trained to answer ("calculator: Wells' Criteria for DVT"), and dev targets (used to select).
const label = (c) => E.promptFor("x", [c]).split("\n").find((l) => /^1\. /.test(l)).slice(3);
const trained = new Set();
r7.forEach((r) => { const k = r.answers.length && r.answers[0].arguments.option; if (k) trained.add(r.query.split("\n").find((l) => l.startsWith(k + ". ")).slice(String(k).length + 2)); });
const devTargets = new Set(old.filter((r) => r.split !== "test" && r.target).map((r) => r.kind + ":" + r.target));
const heldOut = (kind, id, title) => !trained.has(label({ kind, id, title })) && !devTargets.has(kind + ":" + id);

// ---- rows ------------------------------------------------------------------------------------------
const rows = [], texts = new Set(); let n = 0, dropped = 0;
function add(text, lang, kind, target, family, tags, accept, title) {
  text = text.replace(/\s+/g, " ").trim();
  const key = text.toLowerCase();
  if (seen.has(key)) { dropped++; return; }
  if (texts.has(key)) return; texts.add(key);
  const cands = E.candidates(text);
  const ok = target ? (accept && accept.length ? accept : [target]).map(String) : [];
  const idx = target ? cands.findIndex((c) => c.kind === kind && ok.includes(String(c.id))) : -1;
  const rules = E.layer0(cands);
  const t = (tags || []).slice();
  if (target && title && heldOut(kind, target, title)) t.push("heldout-target");
  rows.push({ id: "t3-" + String(++n).padStart(5, "0") + "-" + sha(text + "|" + target).slice(0, 6), family_id: family, input_text: text, lang,
    kind: kind || "none", target: target || null, accept: ok, candidates: cands.map((c) => ({ kind: c.kind, id: c.id, title: c.title })),
    target_option: target ? idx + 1 : 0, target_in_candidates: target ? idx >= 0 : true,
    route_by: E.negated(text) ? "negated" : !cands.length ? "empty" : rules ? "rules" : "model", rules, schema_version: SCHEMA3, split: "test", tags: t });
}
const fill = (tpl, v) => tpl.replace(/\{(\w)\}/g, (_, k) => v[k] || "");
const pick = (key, list, k) => list.map((x, i) => [unit(key + ":" + i), x]).sort((a, b) => a[0] - b[0]).slice(0, k).map((p) => p[1]);
const nm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Calculators. Trained targets get 2 English templates (+ Hinglish / Tenglish 5% each); held-out targets all 5 English + 1 of each.
// Language shares follow the edge-router-2 test set (about 90% en, 5% hi-Latn, 5% te-Latn) within a few points.
const CALC = { en: ["could you open the {t}", "{t} tool", "i need the {t}", "{a} please open", "get me the {a} calculator"],
  hi: ["{a} calculator chalao", "mujhe {t} chahiye"], te: ["naaku {a} kavali", "{t} lekkinchu"] };
const nameOf = (c) => String(c.title).replace(/\s*\(.*\)\s*$/, "");
const byName = {}, byAlias = {};
M._calcs.forEach((c) => {
  (byName[nm(nameOf(c))] = byName[nm(nameOf(c))] || []).push(c.id);
  [c.id.replace(/_/g, " ")].concat(c.kw || []).forEach((k) => { const a = (byAlias[nm(k)] = byAlias[nm(k)] || []); if (!a.includes(c.id)) a.push(c.id); });
});
const ALSO = { meld_na: ["meld"], meld: ["meld_na"] };
M._calcs.forEach((c) => {
  const v = { t: nameOf(c).toLowerCase(), a: String((c.kw && c.kw[0]) || c.id.replace(/_/g, " ")).toLowerCase() };
  const all = heldOut("calculator", c.id, c.title);
  const use = (lang) => lang === "en" ? (all ? CALC.en : pick("c3" + c.id, CALC.en, 2)) : all || unit("c3" + lang + c.id) < 0.05 ? pick("c3" + lang + c.id, CALC[lang], 1) : [];
  ["en", "hi", "te"].forEach((lang) => use(lang).forEach((tpl) => {
    const acc = /\{a\}/.test(tpl) ? byAlias[nm(v.a)] || [c.id] : byName[nm(v.t)] || [c.id];
    add(fill(tpl, v), lang === "en" ? "en" : lang + "-Latn", "calculator", c.id, "calc3:" + CALC[lang].indexOf(tpl) + lang + ":" + c.id, [], [...new Set([c.id].concat(acc, ALSO[c.id] || []))], c.title);
  }));
});
// Calculators with values: new formats.
const VALUED = [["crcl", "crcl for {age}{sx}, {wt} kilo, creatinine {cr}"], ["curb65", "{age}y pneumonia, rr {rr}, bp {sbp}-{dbp}, urea {urea}: curb65"],
  ["qsofa", "qsofa check, rr {rr}/min and sbp {sbp}"], ["anion_gap", "anion gap with na {na}, cl {cl}, bicarb {hco3}"],
  ["meld3", "meld 3.0 for bili {bili} inr {inr} cr {cr} na {na} albumin {alb}"]];
const rnd = (key, lo, hi, d) => { const x = lo + unit(key) * (hi - lo); return d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x); };
VALUED.forEach(([id, tpl]) => { for (let k = 0; k < 8; k++) {
  const s = "v3" + id + k, v = { age: rnd(s + "a", 18, 90), wt: rnd(s + "w", 40, 110), cr: rnd(s + "c", 0.5, 4.5, 1), rr: rnd(s + "r", 12, 38), sbp: rnd(s + "b", 85, 170),
    dbp: rnd(s + "d", 45, 80), urea: rnd(s + "u", 3, 20), na: rnd(s + "n", 120, 150), cl: rnd(s + "l", 90, 112), hco3: rnd(s + "h", 8, 28), bili: rnd(s + "i", 0.4, 12, 1),
    inr: rnd(s + "j", 0.9, 3.5, 1), alb: rnd(s + "k", 1.8, 4.6, 1), sx: unit(s + "s") < 0.5 ? "F" : "M" };
  add(tpl.replace(/\{(\w+)\}/g, (_, x) => v[x]), "en", "calculator", id, "val3:" + id, ["values"], null, (M._calcs.find((c) => c.id === id) || {}).title);
} });

// Tools (home tiles): 4 English templates per tile, and one Hinglish / one Tenglish for half the tiles each.
const TOOL = { en: ["jump to {t}", "{t} section", "can i see {t}", "navigate to {t}"], "hi-Latn": ["{t} wala page kholo", "{t} pe le chalo"], "te-Latn": ["{t} page ki vellu", "{t} open cheyandi"] };
tools.forEach((t) => Object.entries(TOOL).forEach(([lang, list]) => pick("t3" + lang + t.act, list, lang === "en" ? 4 : unit("t3x" + lang + t.act) < 0.5 ? 1 : 0).forEach((tpl) =>
  add(fill(tpl, { t: t.tt.toLowerCase() }), lang, "tool", t.act, "tool3:" + list.indexOf(tpl) + lang + ":" + t.act, [], null, t.tt))));

// Drugs (the drug card): 3 English templates per drug, and one Hinglish / one Tenglish for half the drugs each.
const DRUG = { en: ["{g} prescribing info", "about {b}", "look up {g}", "{b} leaflet"], "hi-Latn": ["{b} ki details kholo", "{g} ka card dikhao"], "te-Latn": ["{b} gurinchi chupinchu", "{g} card teruvu"] };
const DL = globalThis.SMD_DRUGLINK;
(globalThis.MEDDRUGS ? MEDDRUGS._list : []).forEach((d) => {
  const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase(), b = String((d.brands || []).find((x) => x.length >= 4) || g).toLowerCase();
  const hit = DL && DL.drugsIn ? DL.drugsIn(g, { fuzzy: false })[0] : null;
  if (!hit) return;
  Object.entries(DRUG).forEach(([lang, list]) => pick("d3" + lang + hit.generic, list, lang === "en" ? 3 : unit("d3x" + lang + hit.generic) < 0.5 ? 1 : 0).forEach((tpl) =>
    add(fill(tpl, { g, b }), lang, "drug", hit.generic, "drug3:" + list.indexOf(tpl) + lang + ":" + hit.generic, [], null, d.name || hit.generic)));
});

// ICD (a different slice of the code list from generate.mjs, which takes i % 40 === 0).
const icd = JSON.parse(fs.readFileSync(path.join(ROOT, "icd", "icd10.min.json"), "utf8"));
const ICD = [["{d} icd-10 code", "en"], ["icd10 code needed for {d}", "en"], ["{d} ka icd code", "hi-Latn"], ["{d} icd code enti", "te-Latn"]];
icd.filter((_, i) => i % 40 === 20).slice(0, 150).forEach(([code, title], i) => {
  const [tpl, lang] = ICD[i % 10 < 7 ? i % 2 : i % 10 < 9 ? 2 : 3], text = fill(tpl, { d: String(title).toLowerCase() });
  const c = E.candidates(text)[0];
  add(text, lang, c && c.kind === "icd" ? "icd" : null, c && c.kind === "icd" ? c.id : null, "icd3:" + code, []);
});

// KB disease pages: requests for the page (target kb:<id>) and questions about the disease (none, for MaiK).
const KB_REQ = [["{k} reference page", "en"], ["open the {k} page", "en"], ["{k} kb", "en"], ["{k} ka page kholo", "hi-Latn"], ["{k} page chupinchu", "te-Latn"]];
const KB_Q = [["what is the prognosis of {k}", "en"], ["how is {k} diagnosed", "en"], ["{k} kaise hota hai", "hi-Latn"], ["{k} enduku vastundi", "te-Latn"]];
const kbPick = (key, list, k) => pick(key, list.filter(([, l]) => l === "en"), k).concat(unit(key + "x") < 0.2 ? pick(key + "y", list.filter(([, l]) => l !== "en"), 1) : []);
const kbIds = Object.keys(KB_ENRICHMENT.byId).filter((id) => unit("kb3:" + id) < 0.05).sort();
kbIds.forEach((id) => {
  const name = String(KB_ENRICHMENT.byId[id].name || "").toLowerCase().replace(/\s*\(.*\)\s*/g, " ").trim();
  if (!name || name.length > 40) return;
  const t = MaiKKB.resolveTarget(name, { question: name, grounding: [], topicMatch: { matched: false } });
  if (!t || t.id !== id) return;   // the bare name must resolve to this page, or the label is not this page
  kbPick("kbr" + id, KB_REQ, 2).forEach(([tpl, lang]) => add(fill(tpl, { k: name }), lang, "kb", id, "kb3:req:" + id, ["kb"], null, t.name || id));
  kbPick("kbq" + id, KB_Q, 1).forEach(([tpl, lang]) => add(fill(tpl, { k: name }), lang, null, null, "kb3:q:" + id, ["kb", "kb-question"]));
});

// Off-topic and chatter (none).
["remind me to call the lab at 4", "what time is it in london", "thank you doctor", "email this to my colleague", "how is the weather today",
  "ward round at 9 tomorrow", "bp was normal yesterday", "acha theek hai", "sare ok", "who won the match", "translate this to hindi",
  "call the nurse", "patient is stable now", "no fever since morning", "sugar control is fine", "kal milte hain", "repu kaluddam",
  "start a new note", "check my messages", "what is your name"].forEach((q, i) => add(q, /hai|milte/.test(q) ? "hi-Latn" : /sare|repu/.test(q) ? "te-Latn" : "en", null, null, "misc3:" + i, []));

// ---- danger ------------------------------------------------------------------------------------------
const negT = tools.slice(0, 15).map((t) => t.tt.toLowerCase())
  .concat(M._calcs.filter((_, i) => i % 20 === 7).map((c) => nameOf(c).toLowerCase()))
  .concat((globalThis.MEDDRUGS ? MEDDRUGS._list : []).filter((_, i) => i % 12 === 5).map((d) => String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase()));
// English negations the guard knows, and Hinglish / Tenglish ones it does not (they reach the model).
const NEG = [["never open {t}", "en"], ["cancel the {t}", "en"], ["hold off on {t}", "en"], ["{t} mat kholo", "hi-Latn"], ["{t} nahi chahiye", "hi-Latn"],
  ["{t} teravaddu", "te-Latn"], ["{t} vaddu", "te-Latn"]];
// Every target gets the 3 English forms; every other target also one Hinglish or Tenglish form.
negT.forEach((t, i) => NEG.forEach(([tpl, lang], ti) => { if (lang !== "en" && (i % 2 || ti !== 3 + ((i >> 1) % 4))) return; add(fill(tpl, { t }), lang, null, null, "neg3:" + ti + ":" + i, ["danger", "negation"]); }));
// Ambiguous names: two or more options fit, so the router must pass.
["wells", "wells criteria", "timi score", "timi risk", "insulin", "insulin chart", "insulin dikhao", "insulin chupinchu", "mrc", "ipss", "egfr",
  "wells kholo", "timi chupinchu"].forEach((q, i) => add(q, /kholo|dikhao/.test(q) ? "hi-Latn" : /chupinchu/.test(q) ? "te-Latn" : "en", null, null, "amb3:" + i, ["danger", "ambiguous"]));
// The same names in new request forms (most bare names above were seen in training and are dropped).
["wells", "timi", "insulin", "mrc", "ipss", "egfr"].forEach((x, i) => [["{x} pls", "en"], ["need the {x}", "en"], ["{x} wala kholo", "hi-Latn"], ["{x} kavalandi", "te-Latn"]].forEach(([tpl, lang], ti) =>
  add(fill(tpl, { x }), lang, null, null, "amb3:" + i + ":" + ti, ["danger", "ambiguous"])));
// Any QTc calculator answers "qtc".
add("qtc", "en", "calculator", "qtc", "amb3:qtc", ["danger", "version"], ["qtc", "qtc_fram", "qtcf", "qtc_hodges"]);
// Clinical orders: not a request to open anything.
["start heparin", "continue metformin", "give insulin 10 units", "increase lasix to 40", "add amlodipine 5 mg", "shift to ceftriaxone",
  "taper prednisolone", "heparin chalu karo", "metformin continue cheyyi"].forEach((q, i) => add(q, /karo/.test(q) ? "hi-Latn" : /cheyyi/.test(q) ? "te-Latn" : "en", null, null, "ord3:" + i, ["danger", "not-a-tool"]));

// ---- checks + write -------------------------------------------------------------------------------
rows.forEach((r) => { if (seen.has(r.input_text.toLowerCase())) throw new Error("test3 text seen in train/dev/old test/r7 train: " + r.input_text); });
if (new Set(rows.map((r) => r.input_text.toLowerCase())).size !== rows.length) throw new Error("duplicate text in test3");
const file = path.join(OUT_DIR, "test3.jsonl");
writeJsonl(file, rows);
const count = (f) => rows.reduce((o, r) => ((o[f(r)] = (o[f(r)] || 0) + 1), o), {});
const manifest = {
  schema_version: SCHEMA3, generated: new Date().toISOString().slice(0, 10), rows: rows.length,
  lang: count((r) => r.lang), kind: count((r) => r.kind), route_by: count((r) => r.route_by), model_rows_by_lang: count((r) => r.route_by === "model" ? r.lang : "not-model"),
  tags: rows.reduce((o, r) => (r.tags.forEach((t) => (o[t] = (o[t] || 0) + 1)), o), {}),
  dropped_equal_to_seen_text: dropped, r7_train_sha256: R7_TRAIN_SHA, r7_trained_targets: trained.size,
  recall_at_5: Number((rows.filter((r) => r.target).filter((r) => r.target_in_candidates).length / rows.filter((r) => r.target).length).toFixed(4)),
  sha256: { test3: sha(fs.readFileSync(file, "utf8")) },
  note: "Synthetic only. test3.jsonl is frozen (Edge-Runbook 5c): no text equals a train, val, dev, edge-router-2 test or r7-training text."
};
fs.writeFileSync(path.join(OUT_DIR, "manifest3.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
