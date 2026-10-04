// scripts/edge/needle-calibrate.mjs: choose the router's minConfidence for a Needle build on the VALIDATION split
// only, from needle-host raw output (train-needle.sh predict NAME validation).
//   node scripts/edge/needle-calibrate.mjs <NAME.validation.raw.jsonl>
//   node scripts/edge/needle-calibrate.mjs <NAME.test.raw.jsonl> --split test --at 0.98 [--json out]   apply a chosen t
// For every threshold t it rebuilds the pred lines the router would act on (a call the engine suppressed counts as
// its call; any call with confidence < t passes to the safe path) and scores them with score.mjs's own metrics.
// Picks the lowest t whose val result meets the 7.4 marks (wrong shown < 0.5%, accepted acc >= 99%, danger 100%).
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, readJsonl } from "./lib.mjs";
import { scoreRouter } from "./metrics.mjs";

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const rows = readJsonl(path.join(OUT_DIR, opt("--split", "val") + ".jsonl"));
const raw = readJsonl(argv[0]);
const calls = raw.map((l) => {
  const r = l.raw || {}, c = (r.function_calls && r.function_calls[0]) || (r.suppressed_calls && r.suppressed_calls[0]);
  const opt = c && c.name === "choose_option" && c.arguments ? c.arguments.option : 0;
  return { id: l.id, option: opt, confidence: r.confidence == null ? null : r.confidence, ms: l.ms, status: l.raw ? "ok" : "error" };
});
const pct = (x) => (x * 100).toFixed(1);
const at = opt("--at", null), ts = [];
if (at != null) ts.push(Number(at)); else for (let t = 0.5; t <= 0.991; t += 0.01) ts.push(t);
for (const t of ts) {
  const preds = {};
  calls.forEach((c) => { preds[c.id] = { ...c, option: c.confidence != null && c.confidence < t ? 0 : c.option, confidence: null }; });
  const rep = scoreRouter(rows, "pred", preds), o = rep.overall;
  if (opt("--json", null)) fs.writeFileSync(opt("--json"), JSON.stringify(rep, null, 1));
  if (at != null) Object.entries(rep.by.lang).forEach(([k, b]) => console.log(`  lang ${k}  cover ${pct(b.coverage)}  acc ${b.accepted_route_accuracy == null ? "-" : pct(b.accepted_route_accuracy)}  wrong ${pct(b.wrong_tool_shown)}  missed ${pct(b.missed_rate)}`));
  if (at != null) console.log(`  danger ${pct(rep.danger_pass)} of ${rep.danger_n}, recall@5 ${pct(o.recall_at_5 || 0)}`);
  console.log(`t ${t.toFixed(2)}  cover ${pct(o.coverage)}  acc ${o.accepted_route_accuracy == null ? "-" : pct(o.accepted_route_accuracy)}  wrong ${pct(o.wrong_tool_shown)}  ${rep.pass && rep.pass.all ? "PASS" : "fail"}`);
}
