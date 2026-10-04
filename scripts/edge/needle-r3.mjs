// scripts/edge/needle-r3.mjs: round-3 training set for the Needle router (Edge-Runbook 5e). Train side only.
//   node scripts/edge/generate.mjs                       train/val (then: git checkout the frozen test.jsonl/manifest.json)
//   node scripts/edge/generate-test4.mjs                 the frozen test4 set (committed BEFORE this runs)
//   node scripts/edge/needle-r3.mjs build [--permute 1]  -> dataset/dev3.jsonl (selection split, real labels)
//                                                           export/needle-local/train.r3.jsonl (with reasoning)
// Host rows / predictions: needle-r2.mjs rows dev3|test4 [--rot], needle-r2.mjs pred A.raw.jsonl [B.raw.jsonl].
// What changes from round 2 (needle-r2.mjs build runs with these options):
//  1. Candidates come from the CURRENT router with the Knowledge Base loaded (lib.mjs loadKB), so every row
//     offers the KB options the app offers. train/val rows are re-derived (score.mjs relive).
//  2. Labels: a question about a disease is "none" (MaiK answers it) even when its KB page is offered; a disease
//     name with a navigation word opens the KB page; a clinical order ("continue metformin") is "none"; an
//     ambiguous name (lib.mjs AMBIGUOUS_NAMES) is "none"; a negation the guard does not know is "none".
//  3. More hard negatives and near-neighbour contrasts (calculators whose names overlap: GOS / GOS-E, ISS /
//     R-ISS; a calculator named after a disease next to that disease's page), from train-side targets only.
//  4. Never trained on, and asserted at the end: any test, test3 or test4 text; a test4 held-out target as an
//     answer; a test4 held-out ambiguous name (lib.mjs t4Held). They are kept out of dev3 as well.
import fs from "node:fs";
import path from "node:path";
import { loadKB, OUT_DIR, readJsonl, unit, t4Held, AMBIGUOUS_NAMES } from "./lib.mjs";
import { build, fits, words } from "./needle-r2.mjs";
import { relive } from "./score.mjs";

const argv = process.argv.slice(2), V2 = argv.includes("--v2");   // v2: r9 data (decoys, more orders)
const { E, M } = loadKB();
const NEVER = new Set(["test", "test3", "test4"].flatMap((s) => {
  const f = path.join(OUT_DIR, s + ".jsonl");
  if (!fs.existsSync(f)) throw new Error("missing " + f + " (test4: run generate-test4.mjs first)");
  return readJsonl(f).map((r) => r.input_text.toLowerCase());
}));
const core = (t) => words(t).join(" ");
const AMB = new Map(AMBIGUOUS_NAMES.map((x) => [core(x), x]));
const nameOf = (c) => String(c.title).replace(/\s*\(.*\)\s*$/, "");
const nm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Ambiguity (round 2's rule, two changes for KB options): a KB page counts as a second fit only when the request
// IS its name ("insulin" vs every page that mentions insulin is not one name, two things), and an explicit
// calculator word ("dic score") or page word ("dic page") settles which kind was asked for.
const CALC_W = /\b(calculator|calc|score|scale|criteria|index)\b/i, KB_W = /\b(page|reference|kb|disease)\b/i;
function ambiguous3(r) {
  if (!r.target_option) return false;
  const ok = (r.accept && r.accept.length ? r.accept : [r.target]).map(String), t = r.candidates[r.target_option - 1], x = r.input_text;
  if (!fits(x, t.title)) return false;
  return r.candidates.some((c) => {
    if (c.kind === t.kind && ok.includes(String(c.id))) return false;
    if (t.kind === "kb" && KB_W.test(x) && c.kind !== "kb") return false;
    if (c.kind === "kb") return !(t.kind === "calculator" && CALC_W.test(x)) && fits(x, c.title) && fits(c.title, x);
    return fits(x, c.title);
  });
}

// Every row, train and dev: drop test4-held keys; ambiguous names become "none" (danger); tags for new families.
const TAGS = { ord: ["danger", "not-a-tool"], negx: ["danger", "negation"], amb: ["danger", "ambiguous"], kbq: ["kb", "kb-question"], kbr: ["kb"] };
function fix(r) {
  if (r.target && t4Held(r.kind + ":" + r.target)) return null;
  const opt = r.target_option && r.candidates[r.target_option - 1];   // an accepted alternative can be held too
  if (opt && t4Held(opt.kind + ":" + opt.id)) return null;
  const a = AMB.get(core(r.input_text));
  if (a) {
    if (t4Held("amb:" + a)) return null;
    r = { ...r, kind: "none", target: null, accept: [], target_option: 0, target_in_candidates: true, tags: [...new Set(r.tags.concat(TAGS.amb))] };
  }
  const fam = (String(r.family_id).match(/^aug:([a-z]+)/) || [])[1];
  if (TAGS[fam]) r = { ...r, tags: [...new Set(r.tags.concat(TAGS[fam]))] };
  return r;
}

function more(add, { devHeld }) {
  const pickT = (key, list, k) => list.map((x, i) => [unit(key + ":" + i), x, i]).sort((a, b) => a[0] - b[0]).slice(0, k);
  // KB pages: requests (target kb:<id>) and questions (none). Last template of each list = dev only.
  const KB_REQ = [["open {k}", "en"], ["{k} page", "en"], ["show {k}", "en"], ["{k} reference", "en"], ["{k} kb page", "en"], ["go to {k} page", "en"],
    ["{k} info page", "en"], ["{k} kholo", "hi-Latn"], ["{k} ka page", "hi-Latn"], ["{k} chupinchu", "te-Latn"], ["{k} page teruvu", "te-Latn"], ["{k} topic", "en"]];
  const KB_Q = [["what is {k}", "en"], ["causes of {k}", "en"], ["how to treat {k}", "en"], ["{k} symptoms", "en"], ["diagnosis of {k}", "en"],
    ["{k} kya hai", "hi-Latn"], ["{k} kyun hota hai", "hi-Latn"], ["{k} ante enti", "te-Latn"], ["{k} ela vastundi", "te-Latn"], ["is {k} serious", "en"]];
  const calcKw = new Set(M._calcs.flatMap((c) => (c.kw || []).map(nm).concat([nm(nameOf(c))])));
  Object.keys(KB_ENRICHMENT.byId).sort().forEach((id) => {
    const name = String(KB_ENRICHMENT.byId[id].name || "").toLowerCase().replace(/\s*\(.*\)\s*/g, " ").trim();
    const contrast = calcKw.has(nm(name));   // a disease a calculator is named after: always in
    if (!name || name.length > 40 || (!contrast && unit("kb3:" + id) > 0.2)) return;
    const t = MaiKKB.resolveTarget(name, { question: name, grounding: [], topicMatch: { matched: false } });
    if (!t || t.id !== id) return;
    pickT("kbr3" + id, KB_REQ, contrast ? 6 : 3).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{k}", name), lang, "kb", id, null, ti === KB_REQ.length - 1, "kbr" + ti + "|" + id));
    pickT("kbq3" + id, KB_Q, 2).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{k}", name), lang, null, null, null, ti === KB_Q.length - 1, "kbq" + ti + "|" + id));
  });
  // Drugs: clinical orders (none), and requests for the card next to calculators and pages that share the name.
  const ORD = [["start {g}", "en"], ["continue {g}", "en"], ["give {g}", "en"], ["increase {g} dose", "en"], ["reduce {g} dose", "en"], ["switch to {g}", "en"],
    ["add {g}", "en"], ["{g} 500 mg bd", "en"], ["{g} chalu karo", "hi-Latn"], ["{g} continue karo", "hi-Latn"], ["{g} dose kam karo", "hi-Latn"],
    ["{g} start cheyyi", "te-Latn"], ["{g} ivvu", "te-Latn"], ["change to {g}", "en"]];
  const DRUG = [["{g} dose", "en"], ["{b} tablet info", "en"], ["{g} card", "en"], ["{b} card kholo", "hi-Latn"], ["{g} card chupinchu", "te-Latn"]];
  const DL = globalThis.SMD_DRUGLINK, negT = [];
  (globalThis.MEDDRUGS ? MEDDRUGS._list : []).forEach((d, i) => {
    const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase(), b = String((d.brands || []).find((x) => x.length >= 4) || g).toLowerCase();
    const hit = DL && DL.drugsIn ? DL.drugsIn(g, { fuzzy: false })[0] : null;
    if (!hit) return;
    if (i % 6 === 1) negT.push(g);
    if (unit("ord3" + g) < 0.5) pickT("ord3" + g, ORD, 3).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{g}", g), lang, null, null, null, ti === ORD.length - 1, "ord" + ti + "|" + g));
    pickT("drug3" + g, DRUG, 2).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{g}", g).replace("{b}", b), lang, "drug", hit.generic, null, false, "drug3" + ti + "|" + hit.generic));
  });
  // Negations the guard does not know (they reach the model): none. Last template = dev only.
  const NEGX = [["{t} band kar do", "hi-Latn"], ["{t} rehne do", "hi-Latn"], ["{t} kholne ki zaroorat nahi", "hi-Latn"], ["{t} aapeyyi", "te-Latn"],
    ["{t} akkarledu", "te-Latn"], ["{t} skip karo", "hi-Latn"]];
  const tl = globalThis.SMD_HOME_TOOLS().map((t) => t.tt.toLowerCase()).concat(M._calcs.filter((_, i) => i % 7 === 3).map((c) => nameOf(c).toLowerCase()), negT);
  tl.forEach((t, i) => pickT("negx" + t, NEGX, 2).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{t}", t), lang, null, null, null, ti === NEGX.length - 1, "negx" + ti + "|" + i)));
  // Ambiguous names (train-side ones; test4-held names are dropped by fix()). Last template = dev only.
  const AMB_T = [["{x}", "en"], ["open {x}", "en"], ["need {x}", "en"], ["show {x}", "en"], ["{x} calculator", "en"], ["{x} kholo", "hi-Latn"], ["{x} chahiye", "hi-Latn"],
    ["{x} chupinchu", "te-Latn"], ["{x} kavali", "te-Latn"], ["{x} lagao", "hi-Latn"]];
  AMBIGUOUS_NAMES.forEach((x) => AMB_T.forEach(([tpl, lang], ti) => add(tpl.replace("{x}", x), lang, null, null, null, ti === AMB_T.length - 1, "amb" + ti + "|" + x)));
  // Near neighbours: calculators whose names overlap with another calculator in their own options get every
  // name x template (round 2 sampled 45%). Accepted ids as in round 2.
  const CT = [["{x}", "en"], ["open {x}", "en"], ["{x} calculator", "en"], ["{x} score please", "en"], ["use the {x}", "en"], ["{x} kholo", "hi-Latn"],
    ["{x} chupinchu", "te-Latn"], ["{x} lagao", "hi-Latn"], ["{x} cheyyi", "te-Latn"], ["calculate the {x}", "en"]];
  const byKw = {};
  M._calcs.forEach((c) => (c.kw || []).forEach((k) => { (byKw[nm(k)] = byKw[nm(k)] || new Set()).add(c.id); }));
  const ALSO = { meld_na: ["meld"], meld: ["meld_na"] };
  M._calcs.forEach((c) => {
    const tw = nm(nameOf(c)).split(" ");
    const near = E.candidates(nameOf(c)).some((o) => o.kind === "calculator" && o.id !== c.id && nm(nameOf(o)).split(" ").filter((w) => tw.includes(w)).length >= Math.min(2, tw.length));
    if (!near) return;
    const paren = (String(c.title).match(/\(([^)]+)\)/) || [])[1];
    [nm(nameOf(c))].concat(paren ? [paren.toLowerCase()] : [], (c.kw || []).slice(0, 3).map((k) => k.toLowerCase())).forEach((x) => CT.forEach(([tpl, lang], ti) => {
      const acc = [...new Set([c.id].concat([...(byKw[nm(x)] || [])], ALSO[c.id] || []))];
      add(tpl.replace("{x}", x), lang, "calculator", c.id, acc, ti === CT.length - 1, "nb" + ti + "|" + c.id);
    }));
  });
  if (!V2) return;
  // v2 (r9, chosen from r8's dev3 errors): more order forms, train only (added last, so dev3 is unchanged).
  const ORD2 = [["shift to {g}", "en"], ["begin {g}", "en"], ["put him on {g}", "en"], ["{g} iv stat", "en"], ["{g} de do", "hi-Latn"], ["{g} chalu rakho", "hi-Latn"],
    ["{g} pettu", "te-Latn"], ["{g} ivvali", "te-Latn"]];
  (globalThis.MEDDRUGS ? MEDDRUGS._list : []).forEach((d) => {
    const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase();
    if (unit("ord4x" + g) < 0.6) pickT("ord4x" + g, ORD2, 2).forEach(([, [tpl, lang], ti]) => add(tpl.replace("{g}", g), lang, null, null, null, false, "hnord" + ti + "|" + g));
  });
}

// v2: decoy contrasts. A request that names its target gets a copy with one more option whose title EXTENDS the
// target's name ("Glasgow Outcome Scale" next to "Glasgow Outcome Scale Extended", "CI" next to "CIWA score"): the
// label stays the named target. And the reverse: the request names the longer title, which is then the answer.
// Decoy titles are synthetic (train only); they teach the exact-name preference that unseen targets need.
const MODS = [" Extended", " Revised", " Modified", " Simplified", " II", " Pediatric"];
function decoys(rows) {
  const out = [];
  rows.forEach((r, i) => {
    if (!r.target_option || !/^(calculator|tool|drug)$/.test(r.kind) || unit("decoy:" + r.id) > 0.35) return;
    const t = r.candidates[r.target_option - 1], base = nameOf(t), mod = MODS[i % MODS.length];
    const short = words(r.input_text).join(" ");
    const abbr = short.length <= 4 && !/ /.test(short);
    const ext = abbr ? (unit("dx" + r.id) < 0.5 ? short.toUpperCase() + "WA" : "FL" + short.toUpperCase()) + " score" : base + mod;
    const d = { kind: t.kind, id: "decoy:" + ext.toLowerCase(), title: ext };
    const keep = r.candidates.filter((c) => c !== t).slice(0, 3).concat([t]).sort((a, b) => r.candidates.indexOf(a) - r.candidates.indexOf(b));
    const c1 = keep.slice(); c1.splice(Math.floor(unit("dp" + r.id) * (c1.length + 1)), 0, d);
    out.push({ ...r, id: r.id + "~d", candidates: c1, target_option: c1.indexOf(t) + 1, tags: r.tags.concat(["decoy"]) });
    const last = base.split(" ").pop();
    if (!abbr && fits(r.input_text, base) && new RegExp("\\b" + last.replace(/[^a-z0-9]/gi, "") + "\\b", "i").test(r.input_text)) {
      const text = r.input_text.replace(new RegExp("\\b" + last.replace(/[^a-z0-9]/gi, "") + "\\b", "i"), (m) => m + mod.toLowerCase());
      if (text !== r.input_text && !NEVER.has(text.toLowerCase())) out.push({ ...r, id: r.id + "~e", input_text: text, candidates: c1, target: d.id, accept: [d.id], target_option: c1.indexOf(d) + 1, tags: r.tags.concat(["decoy"]) });
    }
  });
  return out;
}

const prep = (rows) => relive(rows, E);
const { dev, train, raw } = build({ kb: true, prep, exclude: NEVER, held: t4Held, more, fix, ambiguous: ambiguous3, extra: V2 ? decoys : null,
  out: { dev: V2 ? "dev3.v2.jsonl" : "dev3.jsonl", train: V2 ? "train.r3v2.jsonl" : "train.r3.jsonl" } });

// ---- asserts: nothing from any test set, no test4-held key, in training or dev ----
train.forEach((r) => { if (NEVER.has(r.input_text.toLowerCase())) throw new Error("training text is a test/test3/test4 text: " + r.input_text); });
const out = readJsonl(path.join(OUT_DIR, "export", "needle-local", V2 ? "train.r3v2.jsonl" : "train.r3.jsonl"));   // the file that is uploaded
if (out.length !== train.length) throw new Error("train.r3.jsonl does not match the built rows");
out.forEach((r) => { const t = r.query.split("\nOptions:")[0].toLowerCase(); if (NEVER.has(t)) throw new Error("train.r3.jsonl has a test text: " + t); });
raw.forEach((r) => {   // the rows the export was made from (same rows, before the shuffled copies)
  const a = AMB.get(core(r.input_text)); if (a && t4Held("amb:" + a)) throw new Error("test4-held ambiguous name in training: " + r.input_text);
  const c = r.target_option && r.candidates[r.target_option - 1];
  if (c && t4Held(c.kind + ":" + c.id)) throw new Error("test4-held target answered in training: " + r.input_text + " -> " + c.kind + ":" + c.id);
});
dev.forEach((r) => {
  if (NEVER.has(r.input_text.toLowerCase())) throw new Error("dev text is a test text: " + r.input_text);
  if (r.target && t4Held(r.kind + ":" + r.target)) throw new Error("test4-held target in dev: " + r.input_text);
});
console.log("asserts ok: no test/test3/test4 text and no test4-held key in train (" + train.length + ") or dev3 (" + dev.length + ")");
if (argv.includes("--sample")) raw.filter((_, i) => i % 300 === 0).forEach((r) => console.log(r.input_text, "=>", r.target_option ? r.candidates[r.target_option - 1].kind + ":" + r.candidates[r.target_option - 1].id : "none"));
