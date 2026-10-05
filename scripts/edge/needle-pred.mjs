// scripts/edge/needle-pred.mjs: glue between the exported needle-local split and scripts/edge/needle-host.cpp.
//   node scripts/edge/needle-pred.mjs rows validation|test > rows.tsv     prompts for the host runner
//   node scripts/edge/needle-pred.mjs pred raw.jsonl [--uncalibrated] > pred.jsonl
//   node scripts/edge/needle-pred.mjs think train > train.think.jsonl   training rows with a reasoning line
// `think`: the pinned engine opens a <think> block before every call (the tuned model kept writing base-style
// reasoning that its no-reasoning targets never had), so each target gets the short line "option K" ("none fits" for an empty call list) in front
// of the call. render_example() in cactus-needle puts `reasoning` there; 26 target tokens of the 48-token cap.
// pred lines are what `score.mjs --pred` reads: {id, option, confidence, ms, status}. The engine reply is
// parsed by the router's own optionFrom(); --uncalibrated drops confidence as needleAdapter({calibrated:false}) does.
import path from "node:path";
import { loadApp, OUT_DIR, readJsonl } from "./lib.mjs";

const [mode, a1] = process.argv.slice(2);
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
if (mode === "rows") {
  const dir = path.join(OUT_DIR, "export", "needle-local");
  const rows = readJsonl(path.join(dir, a1 + ".jsonl")), idx = readJsonl(path.join(dir, a1 + ".index.jsonl"));
  rows.forEach((r, i) => process.stdout.write([idx[i].id, esc(r.system), esc(JSON.stringify(r.tools)), esc(r.query)].join("\t") + "\n"));
} else if (mode === "think") {
  readJsonl(path.join(OUT_DIR, "export", "needle-local", a1 + ".jsonl")).forEach((r) =>
    process.stdout.write(JSON.stringify({ ...r, reasoning: r.answers.length ? "option " + r.answers[0].arguments.option : "none fits" }) + "\n"));
} else if (mode === "pred") {
  const { E } = loadApp(), uncal = process.argv.includes("--uncalibrated");
  readJsonl(a1).forEach((l) => {
    const line = { id: l.id, option: null, confidence: null, ms: l.ms, status: l.raw ? "ok" : "error" };
    if (l.raw) {
      const o = E.optionFrom(l.raw);
      if (o.ok) { line.option = o.option; line.confidence = uncal ? null : o.confidence; } else line.status = "invalid:" + o.reason;
    }
    process.stdout.write(JSON.stringify(line) + "\n");
  });
} else {
  console.error("usage: needle-pred.mjs rows <split> | think <split> | pred <raw.jsonl> [--uncalibrated]");
  process.exit(2);
}
