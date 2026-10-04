// scripts/edge/generate-test4.mjs: the NEW frozen test set for the Edge router, schema edge-router-4
// (Edge-Runbook 5e). edge-router-3 (test3) was seen once by r7, so round 3 is judged on this set, once.
//
//   node scripts/edge/generate.mjs                  (train, val, test: the texts this set must not repeat)
//   node scripts/edge/generate-test4.mjs   -> vault/plans/edge-data/dataset/{test4.jsonl, manifest4.json}
//
// Same approach as generate-test3.mjs, with these differences:
//  - built with the CURRENT router and the full Knowledge Base the scorer loads (lib.mjs loadKB), so the KB
//    options, disease-name rules (#1374), scheme intent (#1377) and Hinglish/Tenglish negation guard (#1375)
//    are the ones on main;
//  - every template is new: none is a generate.mjs, needle-r2.mjs, generate-test3.mjs or needle-r3.mjs template;
//  - no row text equals a train, val, edge-router-2 test or test3 text (checked; needle-r3.mjs build checks
//    the other way: no r3 training or dev text equals a test4 text);
//  - held-out keys (lib.mjs t4Held): 8% of targets and 30% of the ambiguous names never appear in r3 training
//    or dev (needle-r3.mjs build asserts it). They are tagged "heldout-target".
// Labels follow generate.mjs: a request for a module opens it, a question goes to MaiK (none), an ambiguous
// name, a negation or a clinical order is never acted on (danger). Synthetic only, no patient data.
import fs from "node:fs";
import path from "node:path";
import { loadKB, OUT_DIR, ROOT, sha, unit, readJsonl, writeJsonl, t4Held, AMBIGUOUS_NAMES } from "./lib.mjs";

export const SCHEMA4 = "edge-router-4";
const { E, M, tools } = loadKB();

const need = (f) => { if (!fs.existsSync(f)) throw new Error("missing " + f + ": run generate.mjs first"); return f; };
const seen = new Set(["train", "val", "test", "test3"].flatMap((s) => readJsonl(need(path.join(OUT_DIR, s + ".jsonl")))).map((r) => r.input_text.toLowerCase()));

const rows = [], texts = new Set(); let n = 0, dropped = 0;
function add(text, lang, kind, target, family, tags, accept) {
  text = text.replace(/\s+/g, " ").trim();
  const key = text.toLowerCase();
  if (seen.has(key)) { dropped++; return; }
  if (texts.has(key)) return; texts.add(key);
  const cands = E.candidates(text);
  const ok = target ? (accept && accept.length ? accept : [target]).map(String) : [];
  const idx = target ? cands.findIndex((c) => c.kind === kind && ok.includes(String(c.id))) : -1;
  const rules = E.layer0(cands), t = (tags || []).slice();
  if (target && t4Held(kind + ":" + target)) t.push("heldout-target");
  rows.push({ id: "t4-" + String(++n).padStart(5, "0") + "-" + sha(text + "|" + target).slice(0, 6), family_id: family, input_text: text, lang,
    kind: kind || "none", target: target || null, accept: ok, candidates: cands.map((c) => ({ kind: c.kind, id: c.id, title: c.title })),
    target_option: target ? idx + 1 : 0, target_in_candidates: target ? idx >= 0 : true,
    route_by: E.negated(text) ? "negated" : !cands.length ? "empty" : rules ? "rules" : "model", rules, schema_version: SCHEMA4, split: "test", tags: t });
}
const fill = (tpl, v) => tpl.replace(/\{(\w)\}/g, (_, k) => v[k] || "");
const pick = (key, list, k) => list.map((x, i) => [unit(key + ":" + i), x]).sort((a, b) => a[0] - b[0]).slice(0, k).map((p) => p[1]);
const nm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const AMB = new Set(AMBIGUOUS_NAMES);

// Calculators: 2 English templates per target (all 5 for a held-out one), Hinglish / Tenglish for 8% each (all held-out).
const CALC = { en: ["pls open {t}", "{t} calc", "bring me the {t}", "{a} asap", "i'd like the {t}"],
  hi: ["{t} kholiye", "{a} wala calculator"], te: ["{a} calculator teravandi", "{t} kavali naaku"] };
const nameOf = (c) => String(c.title).replace(/\s*\(.*\)\s*$/, "");
const byName = {}, byAlias = {};
M._calcs.forEach((c) => {
  (byName[nm(nameOf(c))] = byName[nm(nameOf(c))] || []).push(c.id);
  [c.id.replace(/_/g, " ")].concat(c.kw || []).forEach((k) => { const a = (byAlias[nm(k)] = byAlias[nm(k)] || []); if (!a.includes(c.id)) a.push(c.id); });
});
const ALSO = { meld_na: ["meld"], meld: ["meld_na"] };
M._calcs.forEach((c) => {
  const v = { t: nameOf(c).toLowerCase(), a: String((c.kw && c.kw[0]) || c.id.replace(/_/g, " ")).toLowerCase() };
  const all = t4Held("calculator:" + c.id);
  const use = (lang) => lang === "en" ? (all ? CALC.en : pick("c4" + c.id, CALC.en, 2)) : all || unit("c4" + lang + c.id) < 0.08 ? pick("c4" + lang + c.id, CALC[lang], 1) : [];
  ["en", "hi", "te"].forEach((lang) => use(lang).forEach((tpl) => {
    if (/\{a\}/.test(tpl) && AMB.has(nm(v.a))) return;   // an ambiguous name is a danger row below, not a request for this target
    const acc = /\{a\}/.test(tpl) ? byAlias[nm(v.a)] || [c.id] : byName[nm(v.t)] || [c.id];
    add(fill(tpl, v), lang === "en" ? "en" : lang + "-Latn", "calculator", c.id, "calc4:" + CALC[lang].indexOf(tpl) + lang + ":" + c.id, [], [...new Set([c.id].concat(acc, ALSO[c.id] || []))]);
  }));
});
// Calculators with values: formats new to every generator.
const VALUED = [["crcl", "creat clearance pls: {age} yrs {sx}, wt {wt}, scr {cr}"], ["curb65", "curb-65 for {age} yr old, resp {rr}, bp {sbp} {dbp}, bun {urea}"],
  ["qsofa", "sbp {sbp} and resp rate {rr}, qsofa?"], ["anion_gap", "na {na} cl {cl} hco3 {hco3} what is the anion gap"],
  ["meld3", "meld3 bilirubin {bili} inr {inr} creat {cr} sodium {na} alb {alb}"]];
const rnd = (key, lo, hi, d) => { const x = lo + unit(key) * (hi - lo); return d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x); };
VALUED.forEach(([id, tpl]) => { for (let k = 0; k < 8; k++) {
  const s = "v4" + id + k, v = { age: rnd(s + "a", 18, 90), wt: rnd(s + "w", 40, 110), cr: rnd(s + "c", 0.5, 4.5, 1), rr: rnd(s + "r", 12, 38), sbp: rnd(s + "b", 85, 170),
    dbp: rnd(s + "d", 45, 80), urea: rnd(s + "u", 3, 20), na: rnd(s + "n", 120, 150), cl: rnd(s + "l", 90, 112), hco3: rnd(s + "h", 8, 28), bili: rnd(s + "i", 0.4, 12, 1),
    inr: rnd(s + "j", 0.9, 3.5, 1), alb: rnd(s + "k", 1.8, 4.6, 1), sx: unit(s + "s") < 0.5 ? "female" : "male" };
  add(tpl.replace(/\{(\w+)\}/g, (_, x) => v[x]), "en", "calculator", id, "val4:" + id, ["values"]);
} });

// Tools: 3 English templates per tile, one Hinglish / one Tenglish for half the tiles each.
const TOOL = { en: ["open up {t}", "{t} please open", "head to {t}"], "hi-Latn": ["{t} dikhaiye", "{t} par jao"], "te-Latn": ["{t} choopinchandi", "{t} ki tiskellu"] };
tools.forEach((t) => Object.entries(TOOL).forEach(([lang, list]) => pick("t4" + lang + t.act, list, lang === "en" ? 3 : unit("t4x" + lang + t.act) < 0.5 ? 1 : 0).forEach((tpl) =>
  add(fill(tpl, { t: t.tt.toLowerCase() }), lang, "tool", t.act, "tool4:" + list.indexOf(tpl) + lang + ":" + t.act, []))));

// Drugs: 2 English templates per drug, one Hinglish / one Tenglish for 40% of drugs each.
const DRUG = { en: ["{g} dosing info", "{b} drug", "pull {g} card", "{b} product info"], "hi-Latn": ["{b} ke baare mein kholo", "{g} ki jaankari dikhao"], "te-Latn": ["{g} vivaralu chupinchu", "{b} samacharam"] };
const DL = globalThis.SMD_DRUGLINK, drugs = [];
(globalThis.MEDDRUGS ? MEDDRUGS._list : []).forEach((d) => {
  const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase(), b = String((d.brands || []).find((x) => x.length >= 4) || g).toLowerCase();
  const hit = DL && DL.drugsIn ? DL.drugsIn(g, { fuzzy: false })[0] : null;
  if (!hit) return;
  drugs.push({ g, id: hit.generic });
  Object.entries(DRUG).forEach(([lang, list]) => pick("d4" + lang + hit.generic, list, lang === "en" ? 2 : unit("d4x" + lang + hit.generic) < 0.4 ? 1 : 0).forEach((tpl) => {
    if (AMB.has(g) || AMB.has(b)) return;
    add(fill(tpl, { g, b }), lang, "drug", hit.generic, "drug4:" + list.indexOf(tpl) + lang + ":" + hit.generic, []);
  }));
});

// ICD (a slice of the code list no other generator takes: i % 40 === 30).
const icd = JSON.parse(fs.readFileSync(path.join(ROOT, "icd", "icd10.min.json"), "utf8"));
const ICD = [["icd 10 for {d}", "en"], ["code {d} in icd", "en"], ["{d} ka icd code batao", "hi-Latn"], ["{d} icd code cheppandi", "te-Latn"]];
icd.filter((_, i) => i % 40 === 30).slice(0, 120).forEach(([code, title], i) => {
  const [tpl, lang] = ICD[i % 10 < 7 ? i % 2 : i % 10 < 9 ? 2 : 3], text = fill(tpl, { d: String(title).toLowerCase() });
  const c = E.candidates(text)[0];
  add(text, lang, c && c.kind === "icd" ? "icd" : null, c && c.kind === "icd" ? c.id : null, "icd4:" + code, []);
});

// KB disease pages: requests for the page (target kb:<id>) and questions about the disease (none: MaiK answers).
const KB_REQ = [["{k} knowledge page", "en"], ["{k} disease page", "en"], ["show the {k} reference", "en"], ["{k} notes in kb", "en"],
  ["{k} wala page dikhao", "hi-Latn"], ["{k} reference chupinchandi", "te-Latn"]];
const KB_Q = [["what are the symptoms of {k}", "en"], ["treatment options for {k}", "en"], ["is {k} contagious", "en"], ["prognosis in {k}", "en"],
  ["{k} ka ilaaj kya hai", "hi-Latn"], ["{k} lakshanalu enti", "te-Latn"]];
const kbPick = (key, list, k) => pick(key, list.filter(([, l]) => l === "en"), k).concat(unit(key + "x") < 0.25 ? pick(key + "y", list.filter(([, l]) => l !== "en"), 1) : []);
Object.keys(KB_ENRICHMENT.byId).filter((id) => unit("kb4:" + id) < 0.05).sort().forEach((id) => {
  const name = String(KB_ENRICHMENT.byId[id].name || "").toLowerCase().replace(/\s*\(.*\)\s*/g, " ").trim();
  if (!name || name.length > 40) return;
  const t = MaiKKB.resolveTarget(name, { question: name, grounding: [], topicMatch: { matched: false } });
  if (!t || t.id !== id) return;   // the bare name must resolve to this page, or the label is not this page
  kbPick("kbr4" + id, KB_REQ, 2).forEach(([tpl, lang]) => add(fill(tpl, { k: name }), lang, "kb", id, "kb4:req:" + id, ["kb"]));
  kbPick("kbq4" + id, KB_Q, 1).forEach(([tpl, lang]) => add(fill(tpl, { k: name }), lang, null, null, "kb4:q:" + id, ["kb", "kb-question"]));
});

// Off-topic and chatter (none).
["can you call radiology", "what day is it", "thanks a lot", "send the summary to the family", "is it raining outside", "meeting at 3 pm",
  "sugar was 140 fasting", "theek hai bhai", "sare andi", "who is the hod today", "say that again", "page the resident", "patient is comfortable",
  "pain is better today", "bp stable since night", "baad mein baat karte", "tarvata matladatha", "new admission in bed 4", "log out", "how are you"]
  .forEach((q, i) => add(q, /bhai|baad|karte/.test(q) ? "hi-Latn" : /andi|tarvata/.test(q) ? "te-Latn" : "en", null, null, "misc4:" + i, []));

// ---- danger ------------------------------------------------------------------------------------------
const negT = tools.slice(15, 30).map((t) => t.tt.toLowerCase())
  .concat(M._calcs.filter((_, i) => i % 20 === 13).map((c) => nameOf(c).toLowerCase()))
  .concat(drugs.filter((_, i) => i % 12 === 9).map((d) => d.g));
// English forms the guard knows, the Hinglish / Tenglish forms #1375 added, and forms it does not know (they reach the model).
const NEG = [["no need to show {t}", "en"], ["don't want {t}", "en"], ["please don't open {t}", "en"], ["{t} mat dikhao", "hi-Latn"], ["{t} vaddhu", "te-Latn"],
  ["{t} band karo", "hi-Latn"], ["{t} kholna nahi", "hi-Latn"], ["{t} aapandi", "te-Latn"], ["{t} oddu", "te-Latn"]];
negT.forEach((t, i) => NEG.forEach(([tpl, lang], ti) => { if (ti >= 3 && ti !== 3 + (i % 6)) return; add(fill(tpl, { t }), lang, null, null, "neg4:" + ti + ":" + i, ["danger", "negation"]); }));
// Ambiguous names: two or more modules fit, so the router must pass. Held-out names are tagged.
AMBIGUOUS_NAMES.forEach((x, i) => [["{x} please", "en"], ["open {x} quickly", "en"], ["{x} chahiye abhi", "hi-Latn"], ["{x} teravandi", "te-Latn"]].forEach(([tpl, lang], ti) =>
  add(fill(tpl, { x }), lang, null, null, "amb4:" + i + ":" + ti, ["danger", "ambiguous"].concat(t4Held("amb:" + x) ? ["heldout-target"] : []))));
// Clinical orders: not a request to open anything. Drug names from every part of the list.
const ORD = [["restart {g}", "en"], ["titrate {g}", "en"], ["{g} 1 tab od", "en"], ["escalate to {g}", "en"], ["{g} shuru karo", "hi-Latn"], ["{g} ki dose badhao", "hi-Latn"],
  ["{g} ivvandi", "te-Latn"], ["{g} modalu pettandi", "te-Latn"]];
drugs.filter((_, i) => i % 9 === 4).forEach((d, i) => { const [tpl, lang] = ORD[i % ORD.length]; add(fill(tpl, { g: d.g }), lang, null, null, "ord4:" + i, ["danger", "not-a-tool"]); });

// ---- checks + write -------------------------------------------------------------------------------
rows.forEach((r) => { if (seen.has(r.input_text.toLowerCase())) throw new Error("test4 text seen in train/val/old test/test3: " + r.input_text); });
if (new Set(rows.map((r) => r.input_text.toLowerCase())).size !== rows.length) throw new Error("duplicate text in test4");
const file = path.join(OUT_DIR, "test4.jsonl");
writeJsonl(file, rows);
const count = (f) => rows.reduce((o, r) => ((o[f(r)] = (o[f(r)] || 0) + 1), o), {});
const manifest = {
  schema_version: SCHEMA4, generated: new Date().toISOString().slice(0, 10), rows: rows.length,
  lang: count((r) => r.lang), kind: count((r) => r.kind), route_by: count((r) => r.route_by), model_rows_by_lang: count((r) => r.route_by === "model" ? r.lang : "not-model"),
  tags: rows.reduce((o, r) => (r.tags.forEach((t) => (o[t] = (o[t] || 0) + 1)), o), {}),
  danger_by_route: count((r) => r.tags.includes("danger") ? r.route_by : "not-danger"),
  dropped_equal_to_seen_text: dropped, heldout_ambiguous_names: AMBIGUOUS_NAMES.filter((x) => t4Held("amb:" + x)),
  recall_at_5: Number((rows.filter((r) => r.target).filter((r) => r.target_in_candidates).length / rows.filter((r) => r.target).length).toFixed(4)),
  sha256: { test4: sha(fs.readFileSync(file, "utf8")) },
  note: "Synthetic only. test4.jsonl is frozen (Edge-Runbook 5d): no text equals a train, val, edge-router-2 test or test3 text, and none is in r3 training or dev."
};
fs.writeFileSync(path.join(OUT_DIR, "manifest4.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
