// scripts/edge/score.mjs — the bake-off scorer (Edge-Master-Plan 7.2, 7.4, 7.5).
//
//   node scripts/edge/score.mjs                         rules and top1 baselines + oracle ceiling on the frozen test set
//   node scripts/edge/score.mjs --pred needle.jsonl     a model's device output ({id, option, confidence, ms} per line)
//   node scripts/edge/score.mjs --live                  recompute candidates with today's edge-router.js first
//   node scripts/edge/score.mjs --human labels.tsv      the owner + doctors set (text<TAB>label, label = kind:id or none)
//   node scripts/edge/score.mjs --draft owner-requests.txt   write a TSV to label (label column left EMPTY on purpose)
//   node scripts/edge/score.mjs --extraction            SMD_CPARAMS against gold/cparams-gold.jsonl
//   node scripts/edge/score.mjs --kb                    load the Knowledge Base too (KB page rules); with --live, the frozen set re-scored
//   node scripts/edge/score.mjs --kb-eval               the KB navigation set (vault/plans/edge-data/kb/kb-nav.jsonl), live, KB loaded
//   --split val|test (default test)  --json out.json  --errors (list every miss, not only wrong opens)
//
// Every metric is printed separately and by language, kind, route and danger tag; nothing is merged
// into one number. Edge ships only if a model beats the RULES baseline on an outcome at the same
// safety marks (7.5); the oracle line shows how much the candidates themselves allow.
import fs from "node:fs";
import path from "node:path";
import { loadApp, loadKB, KB_EVAL, OUT_DIR, readJsonl } from "./lib.mjs";
import { scoreRouter, scoreExtraction, PASS_MARKS } from "./metrics.mjs";

const argv = process.argv.slice(2);
const has = (k) => argv.includes("--" + k);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const GOLD = path.join(path.dirname(OUT_DIR), "gold", "cparams-gold.jsonl");

// Re-derive candidates and route_by from the live router: the frozen part of a row is its text and
// its label, and the options may legitimately change when candidate code improves.
export function relive(rows, E) {
  return rows.map((r) => {
    const cands = E.candidates(r.input_text).map((c) => ({ kind: c.kind, id: c.id, title: c.title, exact: !!c.exact }));
    const ok = r.target ? (r.accept && r.accept.length ? r.accept : [r.target]).map(String) : [];
    const idx = r.target ? cands.findIndex((c) => c.kind === r.kind && ok.includes(String(c.id))) : -1;
    const rules = E.layer0(cands);   // the router's own Layer 0
    return { ...r, candidates: cands, target_option: idx + 1, target_in_candidates: r.target ? idx >= 0 : true,
      route_by: E.negated(r.input_text) ? "negated" : !cands.length ? "empty" : rules ? "rules" : "model", rules };
  });
}

// Human set: "text<TAB>label". label: "calculator:crcl", "tool:icu", "drug:amoxicillin", "icd", "kb:<id>" or "none".
export function parseHuman(tsv) {
  return tsv.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() && !l.startsWith("#")).map((l, i) => {
    const [text, label] = l.split("\t");
    if (!label || !label.trim()) throw new Error(`human set line ${i + 1}: label is empty ("${text}")`);
    const lab = label.trim().toLowerCase(), m = lab.match(/^(calculator|tool|drug|kb|icd)(?::(.+))?$/);
    if (lab !== "none" && !m) throw new Error(`human set line ${i + 1}: bad label "${label}"`);
    const lang = /\b(kholo|dikhao|karo|batao|hai|kya|ka|ki)\b/i.test(text) ? "hi-Latn" : /\b(cheyyi|chupinchu|enti|undi|teruvu|cheyali)\b/i.test(text) ? "te-Latn" : "en";
    return { id: "h" + String(i + 1).padStart(4, "0"), input_text: text.trim(), lang, kind: lab === "none" ? "none" : m[1],
      target: lab === "none" ? null : m[1] === "icd" ? "*" : m[2], accept: [], tags: ["human"], route_by: null, candidates: [] };
  });
}

function table(rep) {
  const o = rep.overall, pct = (x) => (x == null ? "  -  " : (x * 100).toFixed(1).padStart(5) + "%");
  const line = (name, m) => `${name.padEnd(28)} n=${String(m.n).padStart(5)}  recall@5 ${pct(m.recall_at_5)}  cover ${pct(m.coverage)}  acc ${pct(m.accepted_route_accuracy)}  wrong ${pct(m.wrong_tool_shown)}  fallback ${pct(m.fallback_rate)}  missed ${pct(m.missed_rate)}  e2e ${pct(m.end_to_end)}`;
  const verdict = rep.pass.all ? "PASS" : !rep.pass.complete ? `INCOMPLETE (${rep.missing_predictions} rows without a prediction)` : "FAIL";
  const out = [`== ${rep.policy}  ${verdict} (acc>=${PASS_MARKS.accepted_route_accuracy * 100}%, wrong<${PASS_MARKS.wrong_tool_shown * 100}%, danger ${pct(rep.danger_pass)} of ${rep.danger_n})`, line("overall", o)];
  ["lang", "kind", "route_by", "tag"].forEach((k) => Object.entries(rep.by[k]).forEach(([v, m]) => out.push(line("  " + k + ":" + v, m))));
  if (rep.errors.length) {
    out.push(`  errors (${rep.errors.length}, first 25):`);
    rep.errors.slice(0, 25).forEach((e) => out.push(`    [${e.outcome}] ${e.input_text}  expected ${e.expected}  got ${e.got} (${e.source})`));
  }
  return out.join("\n");
}

function main() {
  const report = {};
  if (has("draft")) {
    const { E } = loadApp(), src = arg("draft");
    const lines = fs.readFileSync(src, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const out = ["# Fill the 2nd column for every line: calculator:<id>, tool:<id>, drug:<generic>, icd, kb:<id> or none.",
      "# The options column is only a reminder of what the app can open; label what the doctor MEANT, even if it is not listed."];
    lines.forEach((t) => out.push(t + "\t\t" + E.candidates(t).map((c, i) => `${i + 1}. ${c.kind}:${c.id}`).join(" | ")));
    const dst = src.replace(/\.txt$/, "") + ".labels.tsv";
    fs.writeFileSync(dst, out.join("\n") + "\n");
    console.log("wrote " + dst + " (" + lines.length + " lines). Label column is empty: fill it before --human.");
    return;
  }
  if (has("extraction")) {
    const { P } = loadApp();
    const rep = scoreExtraction(readJsonl(arg("gold", GOLD)), (t) => P.parse(t));
    report.extraction = rep;
    console.log(`== extraction  ${rep.pass ? "PASS" : "FAIL"}  rows ${rep.n}, exact ${rep.exact_rows}, unsafe fields ${rep.unsafe_fields}`);
    Object.entries(rep.fields).forEach(([k, f]) => console.log(`  ${k.padEnd(18)} precision ${f.precision}  recall ${f.recall}  (tp ${f.tp} missed ${f.fn} wrong ${f.wrong} extra ${f.extra})`));
    Object.entries(rep.by_lang).forEach(([k, b]) => console.log(`  lang:${k.padEnd(10)} n ${b.n} exact ${b.exact} unsafe ${b.unsafe}`));
    Object.entries(rep.by_tag).forEach(([k, b]) => console.log(`  tag:${k.padEnd(22)} n ${b.n} exact ${b.exact} unsafe ${b.unsafe}`));
    rep.errors.forEach((e) => console.log(`  [${e.kind}] ${e.id} "${e.text}" ${e.field}: want ${e.want} got ${e.got}`));
  } else {
    const { E } = has("kb") || has("kb-eval") ? loadKB() : loadApp();
    let rows;
    if (has("human")) rows = relive(parseHuman(fs.readFileSync(arg("human"), "utf8")), E).map((r) => {
      // "icd" labels accept whatever ICD request the router built from the text.
      if (r.kind === "icd" && r.target === "*") { const c = r.candidates.find((x) => x.kind === "icd"); return { ...r, target: c ? c.id : "*", target_in_candidates: !!c, target_option: c ? r.candidates.indexOf(c) + 1 : 0 }; }
      return r;
    });
    else if (has("kb-eval")) rows = relive(readJsonl(KB_EVAL), E);
    else {
      rows = readJsonl(path.join(OUT_DIR, arg("split", "test") + ".jsonl"));
      if (has("live")) rows = relive(rows, E);
    }
    const opts = { listMissed: has("errors") };
    const policies = has("pred") ? ["rules", "pred"] : ["rules", "top1", "oracle"];
    let preds = null;
    if (has("pred")) { preds = {}; readJsonl(arg("pred")).forEach((p) => { preds[p.id] = p; }); }
    policies.forEach((p) => { const rep = scoreRouter(rows, p, preds, opts); report[p] = rep; console.log(table(rep) + "\n"); });
    if (preds) {
      const ms = Object.values(preds).map((p) => p.ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
      if (ms.length) console.log(`latency ms: p50 ${ms[Math.floor(ms.length * 0.5)]}  p95 ${ms[Math.floor(ms.length * 0.95)]}  max ${ms[ms.length - 1]}  (n ${ms.length})`);
      const missing = rows.filter((r) => r.route_by === "model" && !preds[r.id]).length;
      if (missing) console.log(`WARNING: ${missing} model-routed rows have no prediction (scored as pass)`);
    }
  }
  if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify(report, null, 2) + "\n");
}
if (import.meta.url === "file://" + process.argv[1]) main();
