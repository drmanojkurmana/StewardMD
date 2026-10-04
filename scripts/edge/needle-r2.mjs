// scripts/edge/needle-r2.mjs: round-2 training set for the Needle router (Edge-Runbook 5b). Train side only.
//   node scripts/edge/needle-r2.mjs build [--permute 2]   -> dataset/dev.jsonl (calibration split, real labels)
//                                                           export/needle-local/train.r2.jsonl (with reasoning)
//   node scripts/edge/needle-r2.mjs rows dev|test|test3 [--rot]  -> host rows (--rot: options rotated by one, ids ~r)
//   node scripts/edge/needle-r2.mjs pred A.raw.jsonl [B.raw.jsonl]  -> score.mjs --pred lines; with B (the
//        rotated run), a call counts only when both runs pick the SAME candidate (self-consistency), else option 0
// What changes from round 1, all on the train side (test.jsonl and its texts are never read for training,
// only to drop any generated text that equals a test text):
//  1. dev split: val + train rows whose target (12%) or none-condition (12%) is held out, and every row of
//     one held-out template per group. It mirrors test's held-out targets and phrasings, so the operating
//     point is chosen on something as hard as test. dev keeps the real labels.
//  2. abstain on ambiguity: a train row whose request words fit the target's title AND a title that is not
//     accepted (TIMI UA/NSTEMI vs TIMI STEMI for "timi", drug Insulin vs tool Insulin) is relabelled 0.
//  3. augmentation: every calculator keyword (not only the first), title stems, calculator, drug-brand and
//     question templates in Hinglish/Tenglish, more condition names. Templates differ from test's.
import fs from "node:fs";
import path from "node:path";
import { loadApp, loadKB, OUT_DIR, readJsonl, writeJsonl, unit } from "./lib.mjs";
import { augment, modelRows, FORMAT } from "./export.mjs";
import { permute } from "./metrics.mjs";

const argv = process.argv.slice(2), mode = argv[0];
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const EXP = path.join(OUT_DIR, "export", "needle-local");
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Template and navigation words in the three languages: never what distinguishes one option from another.
const FILLER = new Set(("open show me the a an go to take please pls can you i want need for of on in with and is what whats calculate calc " +
  "check find get my this pull up work out see look bring launch run use screen page app where would like let do it now be at from by or " +
  "score scores calculator tool drug card details detail info monograph patient kholo khol dikhao karo batao cheyyi chupinchu teruvu chudu " +
  "kavali chahiye kya hai ka ki ke enti em cheppu cheyandi lagao").split(" "));
export const words = (s) => norm(s).split(" ").filter((w) => w && !FILLER.has(w));
// Every request word is in the title (a 4+ letter word may be the start of a title word: "fract" -> "fractional").
export function fits(text, title) {
  const tw = norm(title).split(" ");
  const q = words(text);
  return q.length > 0 && q.every((w) => tw.some((t) => t === w || (w.length >= 4 && t.startsWith(w))));
}
// A calculator request NAMES the target when its words fit the title, its initials start a title word
// ("ast platelet ratio" -> APRI), or it is the title's initials ("ci" -> Cardiac Index). Anything else is a
// description ("pancreatitis severity", "delirium"), which several calculators answer: the router passes it on.
const initials = (s) => norm(s).split(" ").filter(Boolean).map((w) => w[0]).join("");
export function names(text, title) {
  if (fits(text, title)) return true;
  const q = words(text), tw = norm(title).split(" "), qi = initials(q.join(" "));
  if (q.length >= 2 && qi.length >= 3 && tw.some((t) => t.startsWith(qi))) return true;
  return q.length === 1 && q[0].length >= 2 && [title, title.replace(/\([^)]*\)/g, " ")].some((t) => initials(t) === q[0]);
}
export function ambiguous(r) {
  if (!r.target_option) return false;
  const ok = (r.accept && r.accept.length ? r.accept : [r.target]).map(String);
  const isOk = (c) => c.kind === r.kind && ok.includes(String(c.id));
  if (!fits(r.input_text, r.candidates[r.target_option - 1].title)) return false;
  return r.candidates.some((c) => !isOk(c) && fits(r.input_text, c.title));
}

const ALSO = { meld_na: ["meld"], meld: ["meld_na"] };   // generate.mjs: either calculator answers the other
const heldOutTarget = (key) => unit("target:" + key) < 0.10;   // generate.mjs: these are test-only targets
const devKey = (r) => r.target ? "t:" + r.kind + ":" + r.target : "c:" + (r.family_id.split(":")[2] || r.family_id);
const devHeld = (key) => unit("dev:" + key) < 0.12;
// One held-out template per group (generate.mjs family ids), for held-out phrasing in dev.
const DEV_FAMILY = /^(calc:train6|tool:train2|none:train9|none:train10|drug:train1|hinglish:train1|tenglish:train1|val:train1):/;

// o (round 3, needle-r3.mjs): kb (load the Knowledge Base), prep(rows) for train/val, exclude (more texts never
// trained on), held(key) (more test-only targets), more(add, ctx) (more augmentation), fix(row) (relabel or drop,
// null drops; train and dev), ambiguous (replaces ambiguous()), out { dev, train } file names.
export function build(o = {}) {
  const { E, M } = o.kb ? loadKB() : loadApp();
  let train = readJsonl(path.join(OUT_DIR, "train.jsonl")), val = readJsonl(path.join(OUT_DIR, "val.jsonl"));
  if (o.prep) { train = o.prep(train); val = o.prep(val); }
  const testText = new Set(readJsonl(path.join(OUT_DIR, "test.jsonl")).map((r) => r.input_text.toLowerCase()).concat([...(o.exclude || [])]));
  const known = new Set(train.concat(val).map((r) => r.input_text.toLowerCase()));
  const dev = val.slice(), tr = [];
  train.forEach((r) => ((DEV_FAMILY.test(r.family_id) || devHeld(devKey(r)) ? dev : tr).push(r)));

  // ---- augmentation (rows built the way generate.mjs add() builds them) ----
  const aug = { dev: [], train: [] }; let n = 0, leaks = 0;
  function add(text, lang, kind, target, accept, devOnly, tag) {
    text = text.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (testText.has(key)) { leaks++; return; }
    if (known.has(key)) return; known.add(key);
    if (target && (heldOutTarget((kind || "none") + ":" + target) || (o.held && o.held((kind || "none") + ":" + target)))) return;   // never touch test-only targets
    const cands = E.candidates(text);
    if (E.negated(text) || !cands.length || E.layer0(cands)) return;      // only rows the model would see
    const ok = target ? (accept && accept.length ? accept : [target]).map(String) : [];
    const idx = target ? cands.findIndex((c) => c.kind === kind && ok.includes(String(c.id))) : -1;
    if (target && idx < 0) return;   // target not offered: nothing to learn about choosing it
    const r = { id: "a" + String(++n).padStart(6, "0"), family_id: "aug:" + tag, input_text: text, lang, kind: kind || "none", target: target || null,
      accept: ok, candidates: cands.map((c) => ({ kind: c.kind, id: c.id, title: c.title })), target_option: idx + 1, target_in_candidates: target ? idx >= 0 : true,
      route_by: "model", rules: false, split: null, tags: ["aug"] };
    const held = !/^hn/.test(tag) && (devOnly || devHeld(target ? "t:" + (kind || "none") + ":" + target : "c:" + tag.split("|")[1]));   // hn: train only, dev stays as r6 saw it
    (held ? aug.dev : aug.train).push(r);
  }
  // Calculators: every keyword, the title without its parenthesis, and the parenthesis itself. Last template = dev only.
  const CALC_T = ["{x}", "open {x}", "{x} calculator", "show me {x}", "launch {x}", "{x} kholo", "{x} open cheyyi", "{x} chahiye", "{x} kavali", "bring up {x}"];
  const CALC_L = ["en", "en", "en", "en", "en", "hi-Latn", "te-Latn", "hi-Latn", "te-Latn", "en"];
  const byKw = {};
  M._calcs.forEach((c) => (c.kw || []).forEach((k) => { (byKw[norm(k)] = byKw[norm(k)] || new Set()).add(c.id); }));
  M._calcs.forEach((c) => {
    const title = String(c.title), paren = (title.match(/\(([^)]+)\)/) || [])[1];
    const names = new Set((c.kw || []).map((k) => k.toLowerCase()).concat([title.replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase()], paren ? [paren.toLowerCase()] : []));
    [...names].forEach((x, xi) => CALC_T.forEach((tpl, ti) => {
      if (unit("pick:" + c.id + x + ti) > 0.45) return;   // a sample, not every keyword x template
      const acc = [...new Set([c.id].concat([...(byKw[norm(x)] || [])], ALSO[c.id] || []))];
      add(tpl.replace("{x}", x), CALC_L[ti], "calculator", c.id, acc, ti === CALC_T.length - 1, "calc" + ti + "|" + c.id);
    }));
  });
  // Drugs: brand and generic, hi/te and en templates (test uses "{b} details", "{g} monograph", "{g} dikhao", "{b} chupinchu").
  const DRUG_T = [["{b}", "en"], ["open {b}", "en"], ["{b} info", "en"], ["{b} open cheyyi", "te-Latn"], ["{b} chudu", "te-Latn"], ["{g} chupinchandi", "te-Latn"],
    ["{b} dikhao", "hi-Latn"], ["{g} kholo", "hi-Latn"], ["{b} ki jankari", "hi-Latn"], ["{g} drug info", "en"]];
  const DL = globalThis.SMD_DRUGLINK;
  (globalThis.MEDDRUGS ? globalThis.MEDDRUGS._list : []).forEach((d) => {
    const g = String(d.generic).replace(/\s*\(.*\)\s*/g, " ").trim().toLowerCase();
    const hit = DL && DL.drugsIn ? DL.drugsIn(g, { fuzzy: false })[0] : null;
    if (!hit) return;
    const brands = (d.brands || []).filter((x) => x.length >= 4).slice(0, 3).map((x) => x.toLowerCase());
    DRUG_T.forEach(([tpl, lang], ti) => [g].concat(brands).forEach((b, bi) => {
      if (/\{g\}/.test(tpl) && bi > 0) return;
      if (unit("pick:" + hit.generic + b + ti) > 0.5) return;
      add(tpl.replace("{b}", b).replace("{g}", g), lang, "drug", hit.generic, null, ti === DRUG_T.length - 1, "drug" + ti + "|" + hit.generic);
    }));
  });
  // Questions for MaiK (none). Test uses "how should {c} be managed", "workup for suspected {c}", "red flags in {c}",
  // "{c} ka treatment kya hai", "{c} ki treatment enti". Last template = dev only.
  const MORE = ["hypoglycemia", "hypercalcemia", "hypokalemia", "metabolic acidosis", "acute asthma", "angina", "gout", "migraine", "vertigo",
    "syncope", "chest pain", "anemia", "thrombocytopenia", "hepatitis b", "hepatic encephalopathy", "variceal bleed", "acute pyelonephritis",
    "renal colic", "septic shock", "cardiogenic shock", "heat stroke", "burns", "head injury", "alcohol withdrawal", "delirium", "hypothyroidism",
    "hyperthyroidism", "pcos", "eclampsia", "ectopic pregnancy", "gestational diabetes", "measles", "chickenpox", "covid 19", "influenza",
    "cholera", "acute gastroenteritis", "rabies exposure", "paracetamol overdose", "kala azar", "filariasis", "hepatitis a", "psoriasis", "scabies"];
  const CONDITIONS = readJsonl(path.join(OUT_DIR, "train.jsonl")).concat(val).filter((r) => /^none:train\d+:/.test(r.family_id))
    .map((r) => r.family_id.split(":")[2]).filter((c, i, a) => a.indexOf(c) === i).concat(MORE);
  const Q_T = [["treatment of {c}", "en"], ["drug of choice in {c}", "en"], ["how to manage {c}", "en"], ["{c} management", "en"],
    ["what dose for {c}", "en"], ["signs of {c}", "en"], ["{c} me kya dena chahiye", "hi-Latn"], ["{c} ka management batao", "hi-Latn"],
    ["{c} kaise treat kare", "hi-Latn"], ["{c} ki dawai kya hai", "hi-Latn"], ["{c} ela treat cheyali", "te-Latn"], ["{c} ki mandulu enti", "te-Latn"],
    ["{c} management cheppu", "te-Latn"], ["{c} gurinchi cheppu", "te-Latn"], ["{c} ki em ivvali", "te-Latn"], ["{c} lo em cheyali", "te-Latn"],
    ["{c} ke liye kya karein", "hi-Latn"]];
  CONDITIONS.forEach((c) => Q_T.forEach(([tpl, lang], ti) => add(tpl.replace("{c}", c), lang, null, null, null, ti === Q_T.length - 1, "q" + ti + "|" + c)));
  // Hard negatives: a question about a condition that a calculator is named after ("West Haven (Hepatic
  // Encephalopathy)") asks for MaiK, not the calculator. Conditions come from calculator titles and keywords.
  const terms = new Set();
  M._calcs.forEach((c) => {
    const p = (String(c.title).match(/\(([^)]+)\)/) || [])[1];
    [p].concat(c.kw || []).forEach((t) => { if (t && /^[a-z][a-z ]{6,}$/i.test(t) && t !== t.toUpperCase() && / /.test(t.trim())) terms.add(t.trim().toLowerCase()); });
  });
  [...terms].forEach((c) => Q_T.forEach(([tpl, lang], ti) => {
    if (devHeld("c:" + c) || unit("pickq:" + c + ti) > 0.12) return;   // dev-held conditions stay out of train
    add(tpl.replace("{c}", c), lang, null, null, null, false, "hn" + ti + "|" + c);
  }));

  if (o.more) o.more(add, { E, M, devHeld });
  const fix = (a) => (o.fix ? a.map(o.fix).filter(Boolean) : a);
  const devAll = fix(dev.concat(aug.dev));
  // Train rows: ambiguous requests, and calculator requests that only describe the target, are relabelled
  // "none" (the label the router should act on).
  const trainRows = modelRows(fix(tr.concat(aug.train)));
  const describes = (r) => r.kind === "calculator" && r.target_option && !r.tags.includes("values") && !names(r.input_text, r.candidates[r.target_option - 1].title);
  let relabel = 0;
  trainRows.forEach((r) => { if ((o.ambiguous || ambiguous)(r) || describes(r)) { r.target_option = 0; r.accept = []; r.target = null; r.kind = "none"; relabel++; } });
  const rows = augment(trainRows, Number(arg("permute", 2)));
  const out = o.out || { dev: "dev.jsonl", train: "train.r2.jsonl" };
  writeJsonl(path.join(OUT_DIR, out.dev), devAll);
  writeJsonl(path.join(EXP, out.train), rows.map((r) => {
    const f = FORMAT["needle-local"](r);
    return { ...f, reasoning: f.answers.length ? "option " + f.answers[0].arguments.option : "none fits" };
  }));
  const cnt = (a) => a.reduce((o, r) => ((o[r.lang + "/" + (r.target_option ? "pos" : "none")] = (o[r.lang + "/" + (r.target_option ? "pos" : "none")] || 0) + 1), o), {});
  console.log(JSON.stringify({ dev_rows: devAll.length, dev_model_rows: modelRows(devAll).length, dev_by: cnt(modelRows(devAll)),
    train_model_rows: trainRows.length, train_by: cnt(trainRows), relabelled_ambiguous: relabel, train_exported: rows.length,
    aug_train: aug.train.length, aug_dev: aug.dev.length, dropped_equal_to_test_text: leaks }, null, 1));
  return { dev: devAll, train: rows, raw: trainRows };
}

// Host rows: canonical rows of a split (dev from dev.jsonl; test/val from the frozen files), model-routed only.
function rows(split, rot) {
  const { E } = loadApp();
  modelRows(readJsonl(path.join(OUT_DIR, split + ".jsonl"))).forEach((r) => {
    const c = rot ? r.candidates.slice(1).concat(r.candidates.slice(0, 1)) : r.candidates;
    process.stdout.write([r.id + (rot ? "~r" : ""), esc(E.SYSTEM), esc(JSON.stringify(E.TOOL_SCHEMA)), esc(E.promptFor(r.input_text, c))].join("\t") + "\n");
  });
}

// Rotation maps option k of the rotated prompt to original option ((k % n) + 1).
function pred(a, b) {
  const { E } = loadApp();
  // A line is host output ({id, ms, raw}) or a device bake-off line ({id, option, ms, status}).
  const one = (l) => {
    if (l.raw === undefined) return typeof l.option === "number" ? { ok: true, option: l.option } : { ok: false, reason: l.status };
    if (!l.raw) return { ok: false };
    const o = E.optionFrom(l.raw); return o.ok ? o : { ok: false, reason: o.reason };
  };
  const rot = {}; if (b) readJsonl(b).filter((l) => /~r$/.test(l.id)).forEach((l) => { rot[l.id.replace(/~r$/, "")] = l; });
  const n = {}; ["dev", "test", "test3", "dev3", "test4"].filter((s) => fs.existsSync(path.join(OUT_DIR, s + ".jsonl")))
    .forEach((s) => readJsonl(path.join(OUT_DIR, s + ".jsonl")).forEach((r) => { n[r.id] = r.candidates.length; }));
  readJsonl(a).filter((l) => !/~r$/.test(l.id)).forEach((l) => {
    const o = one(l), line = { id: l.id, option: null, confidence: null, ms: l.ms, status: o.ok ? "ok" : "error" };
    if (!o.ok) { if (l.raw || l.raw === undefined) line.status = "invalid:" + o.reason; process.stdout.write(JSON.stringify(line) + "\n"); return; }
    line.option = o.option;
    if (b) {
      const r = rot[l.id], o2 = r ? one(r) : { ok: false };
      line.ms = l.ms + (r ? r.ms : 0);
      const back = o2.ok && o2.option >= 1 && o2.option <= n[l.id] ? (o2.option % n[l.id]) + 1 : 0;
      if (!o2.ok || back !== o.option) line.option = 0;
    }
    process.stdout.write(JSON.stringify(line) + "\n");
  });
}

// Device bake-off rows (test/edge-bakeoff-device.mjs --file): the first N model rows of test (--split test3: the new set), each followed by
// its rotated copy (id ~r). Score: pred <device.jsonl> <device.jsonl> (both runs are in the one file).
function bake(n, split) {
  const { E } = loadApp();
  modelRows(readJsonl(path.join(OUT_DIR, split + ".jsonl"))).slice(0, n).forEach((r) => [r.candidates, r.candidates.slice(1).concat(r.candidates.slice(0, 1))].forEach((c, k) =>
    process.stdout.write(JSON.stringify({ id: r.id + (k ? "~r" : ""), system: E.SYSTEM, prompt: E.promptFor(r.input_text, c), tools: E.TOOL_SCHEMA, n_options: c.length }) + "\n")));
}

const main = import.meta.url === "file://" + process.argv[1];
if (!main) {}
else if (mode === "build") build();
else if (mode === "bake") bake(Number(argv[1] || 50), arg("split", "test"));
else if (mode === "rows") rows(argv[1], argv.includes("--rot"));
else if (mode === "pred") pred(argv[1], argv[2]);
else { console.error("usage: needle-r2.mjs build | bake N [--split test3] | rows dev|test|test3 [--rot] | pred A.raw.jsonl [B.raw.jsonl]"); process.exit(2); }
