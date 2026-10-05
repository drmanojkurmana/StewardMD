#!/usr/bin/env node
// PrepNucleus module-mapping evaluation. Dev-only, never shipped, $0 (no model calls). Plan: vault/plans/PrepNucleus.md
// 5.1, exit criterion 1 (>= 90% agreement with hand labels).
//
// RUN
//   node tools/prep-map-eval.mjs --labels prep/eval/labels-anatomy.json[,<more>] --bank prep/bank/v1
//   node tools/prep-map-eval.mjs --labels prep/eval/labels-anatomy.json --llm prep/build/llm-anatomy.json [--high]
//       [--tax prep/taxonomy] [--json]
//
// LABELS  { subject?, labeller?, labels: [{ id, best, ok: [...] }] }: best is a module id, or "mixed" when the item is not
//         this subject's; ok lists other modules that are also right. The subject is the file's "subject" field, else
//         the subject whose code prefixes the labelled module ids.
// SOURCE  --bank: every item's t from the module files of EVERY subject in the bank; an item found under another
//         subject is "moved out", one under "<code>-mixed" is "mixed", one in no file is "missing" (dropped or deduped).
//         --llm: prep/build/llm-<subject>[.sample].json map; a subject id answer is "moved out". --high counts low
//         confidence answers as "mixed" (what a build that keeps only high confidence answers would do).
// SCORE   agreement = got is best or any ok; for best "mixed", a moved-out or mixed assignment also agrees. Missing never does.
//         Printed overall, per subject, split into labelled-in-subject and labelled-mixed, plus the confusions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTaxonomy, modulesOf } from "./prep-build-bank.mjs";
import { parseArgs } from "./prep-fill.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/* agrees(label, got) -> boolean. got = { kind: "module" | "mixed" | "moved" | "missing", m? } */
export function agrees(label, got) {
  if (!got || got.kind === "missing") return false;
  if (got.kind === "module" && (got.m === label.best || (label.ok || []).includes(got.m))) return true;
  return label.best === "mixed" && (got.kind === "mixed" || got.kind === "moved");
}
const gotName = (g) => (!g || g.kind === "missing" ? "missing" : g.kind === "module" ? g.m : g.kind === "moved" ? "moved:" + (g.to || "?") : "mixed");
/* scoreMapping(labels, assign) -> { n, agree, rate, inSubject, labelledMixed, missing, confusions, pairs }.
 * labels: [{ id, best, ok }]; assign: Map or object id -> { kind, m?, to? }. Pure. */
export function scoreMapping(labels, assign) {
  const get = (id) => (assign instanceof Map ? assign.get(id) : assign[id]);
  const part = () => ({ n: 0, agree: 0, rate: null });
  const res = { n: 0, agree: 0, rate: null, inSubject: part(), labelledMixed: part(), missing: 0, confusions: [], pairs: {} };
  for (const l of labels) {
    const g = get(l.id), ok = agrees(l, g), side = l.best === "mixed" ? res.labelledMixed : res.inSubject;
    res.n++; side.n++;
    if (ok) { res.agree++; side.agree++; continue; }
    if (!g || g.kind === "missing") res.missing++;
    const k = `${l.best} -> ${gotName(g)}`;
    res.pairs[k] = (res.pairs[k] || 0) + 1;
    res.confusions.push({ id: l.id, best: l.best, ok: l.ok || [], got: gotName(g) });
  }
  for (const x of [res, res.inSubject, res.labelledMixed]) x.rate = x.n ? x.agree / x.n : null;
  return res;
}
/* fromBank(bankDir, subjectId, codeOf) -> Map id -> { kind, m, to } over every subject's module files. */
export function fromBank(bankDir, subject) {
  const out = new Map();
  for (const sid of fs.readdirSync(bankDir)) {
    const mdir = path.join(bankDir, sid, "mcq");
    if (!fs.existsSync(mdir)) continue;
    for (const f of fs.readdirSync(mdir).filter((x) => x.endsWith(".json"))) {
      for (const it of readJson(path.join(mdir, f)).items || []) {
        if (sid !== subject.id) { if (!out.has(it.id)) out.set(it.id, { kind: "moved", to: sid }); continue; }
        out.set(it.id, it.t === subject.code + "-mixed" ? { kind: "mixed" } : { kind: "module", m: it.t });
      }
    }
  }
  return out;
}
/* fromLlm(file, subject, { high }) -> Map id -> { kind, m, to, conf }. */
export function fromLlm(j, subject, opts = {}) {
  const mods = new Set(modulesOf(subject).map((m) => m.id)), out = new Map();
  for (const [id, v] of Object.entries(j.map || {})) {
    const [m, conf] = Array.isArray(v) ? v : [v, "high"];
    if (opts.high && conf !== "high") { out.set(id, { kind: "mixed", conf }); continue; }
    out.set(id, mods.has(m) ? { kind: "module", m, conf } : { kind: "moved", to: m, conf });
  }
  return out;
}
export function subjectOfLabels(lab, subjects) {
  if (lab.subject) { const s = subjects.find((x) => x.id === lab.subject); if (s) return s; }
  const codes = new Map(subjects.map((s) => [s.code, s]));
  for (const l of lab.labels || []) { const c = String(l.best || "").split("-")[0]; if (l.best !== "mixed" && codes.has(c)) return codes.get(c); }
  throw new Error("cannot tell which subject the labels are for; add a \"subject\" field");
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const root = deps.root || ROOT, log = deps.log || console.log;
  if (!args.labels || (!args.bank && !args.llm)) throw new Error("usage: --labels <file>[,<file>] (--bank <dir> | --llm <file>[,<file>])");
  const subjects = loadTaxonomy(path.resolve(root, args.tax || "prep/taxonomy"));
  const llms = args.llm ? String(args.llm).split(",").map((p) => readJson(path.resolve(root, p))) : [];
  const per = [];
  let all = [], assignAll = new Map();
  for (const lp of String(args.labels).split(",")) {
    const lab = readJson(path.resolve(root, lp));
    const s = subjectOfLabels(lab, subjects);
    let assign;
    if (args.bank) assign = fromBank(path.resolve(root, args.bank), s);
    else {
      const j = llms.find((x) => x.subject === s.id) || (llms.length === 1 ? llms[0] : null);
      if (!j) throw new Error("no --llm file for subject " + s.id);
      assign = fromLlm(j, s, { high: args.flags.has("high") });
    }
    const r = scoreMapping(lab.labels, assign);
    per.push({ subject: s.id, ...r });
    all = all.concat(lab.labels);
    for (const l of lab.labels) assignAll.set(l.id, assign.get(l.id));
  }
  const overall = scoreMapping(all, assignAll);
  const pct = (x) => (x.rate == null ? "n/a" : (x.rate * 100).toFixed(1) + "%");
  if (args.flags.has("json")) log(JSON.stringify({ overall, subjects: per }, null, 1));
  else {
    log(`overall: ${overall.agree} of ${overall.n} agree (${pct(overall)}); in-subject labels ${overall.inSubject.agree}/${overall.inSubject.n} (${pct(overall.inSubject)}), mixed labels ${overall.labelledMixed.agree}/${overall.labelledMixed.n} (${pct(overall.labelledMixed)}); missing ${overall.missing}`);
    for (const r of per) {
      log(`  ${r.subject}: ${r.agree}/${r.n} (${pct(r)}); in-subject ${pct(r.inSubject)}, mixed ${pct(r.labelledMixed)}`);
      for (const [k, n] of Object.entries(r.pairs).sort((a, b) => b[1] - a[1])) log(`    ${String(n).padStart(3)} x ${k}`);
    }
    log(`target: >= 90% (plan 5.1 exit criterion 1)`);
  }
  return { overall, subjects: per };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
