// scripts/edge/export.mjs — one canonical dataset, one exporter per trainer (Edge-Master-Plan A0.4).
//
//   node scripts/edge/export.mjs [--targets cactus,needle-local,llama-json,bakeoff] [--permute 2] [--cap 10000]
//
// Reads vault/plans/edge-data/dataset/{train,val,test}.jsonl, writes dataset/export/<target>/.
// Only route_by === "model" rows are exported: rules and negation rows never reach a model at runtime,
// so training on them only teaches "always pick 1". The prompt, system line and tool schema are the
// ones edge-router.js sends on the phone (promptFor, SYSTEM, TOOL_SCHEMA), so train == serve.
//
// Formats (checked against the cactus-needle 3.0.6 source, needle/model/finetune.py, and llms.txt):
//   cactus       platform chat JSONL: messages (system, user, assistant with tool_calls whose arguments
//                is a JSON STRING) + OpenAI-form tools. "None of these" is an assistant turn with no call,
//                Needle's own refusal (answers []), which the router reads as option 0.
//                Upload: needle platform finetune train.jsonl validation.jsonl test.jsonl --suffix smd-router
//                The platform takes 100 to 10,000 examples per run, hence --cap.
//   needle-local {query, tools, answers, system} for `needle finetune` (LoRA; confidence head untouched).
//   llama-json   chat JSONL whose assistant content is {"option": n}, for the FunctionGemma SFT on a GPU.
//                TODO(A0.3): confirm FunctionGemma's own function-calling chat template before training;
//                the grammar on the phone forces {"option": n}, so the target text must match it.
//   bakeoff      {id, system, prompt, tools, n_options} for the device harness (test split only); the
//                harness writes {id, option, confidence, ms} lines that score.mjs --pred reads.
// Training rows are also emitted with the options shuffled (--permute N extra copies), so the
// position of the right option carries no signal. val/test keep the runtime order.
import fs from "node:fs";
import path from "node:path";
import { loadApp, OUT_DIR, readJsonl, writeJsonl, unit, sha } from "./lib.mjs";
import { permute } from "./metrics.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const TARGETS = String(arg("targets", "cactus,needle-local,llama-json,bakeoff")).split(",");
const PERMUTE = Number(arg("permute", 2));
const CAP = Number(arg("cap", 10000));

const { E } = loadApp();
const TOOLS = E.TOOL_SCHEMA, SYSTEM = E.SYSTEM;

export function modelRows(rows) { return rows.filter((r) => r.route_by === "model" && r.candidates && r.candidates.length); }

// A row's option must be 0 when the target is not offered, else the 1-based index of an accepted target.
export function checkRow(r) {
  if (r.target_option < 0 || r.target_option > r.candidates.length) throw new Error("option out of range: " + r.id);
  if (r.target_option) {
    const c = r.candidates[r.target_option - 1], ok = r.accept && r.accept.length ? r.accept : [r.target];
    if (c.kind !== r.kind || !ok.map(String).includes(String(c.id))) throw new Error("option does not point at the target: " + r.id);
  }
  return r;
}

export function augment(rows, k) {
  const out = [], seen = new Set();
  rows.forEach((r) => {
    [r].concat(Array.from({ length: k }, (_, i) => permute(r, r.id + ":p" + i, unit))).forEach((v, i) => {
      const key = E.promptFor(v.input_text, v.candidates) + "|" + v.target_option;
      if (seen.has(key)) return; seen.add(key);
      out.push({ ...checkRow(v), id: i ? r.id + "~p" + i : r.id });
    });
  });
  return out;
}

export function capRows(rows, cap) {
  if (rows.length <= cap) return rows;
  return rows.slice().sort((a, b) => unit("cap:" + a.id) - unit("cap:" + b.id)).slice(0, cap);
}

export const FORMAT = {
  cactus: (r) => ({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: E.promptFor(r.input_text, r.candidates) },
      r.target_option
        ? { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "choose_option", arguments: JSON.stringify({ option: r.target_option }) } }] }
        : { role: "assistant", content: "" }
    ],
    tools: TOOLS.map((t) => ({ type: "function", function: t }))
  }),
  "needle-local": (r) => ({
    query: E.promptFor(r.input_text, r.candidates), tools: TOOLS, system: SYSTEM,
    answers: r.target_option ? [{ name: "choose_option", arguments: { option: r.target_option } }] : []
  }),
  "llama-json": (r) => ({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: E.promptFor(r.input_text, r.candidates) },
      { role: "assistant", content: JSON.stringify({ option: r.target_option }) }
    ]
  }),
  bakeoff: (r) => ({ id: r.id, system: SYSTEM, prompt: E.promptFor(r.input_text, r.candidates), tools: TOOLS, n_options: r.candidates.length })
};
const FILE = { train: "train", val: "validation", test: "test" };

function main() {
  const split = Object.fromEntries(["train", "val", "test"].map((s) => [s, modelRows(readJsonl(path.join(OUT_DIR, s + ".jsonl"))).map(checkRow)]));
  const rows = { train: capRows(augment(split.train, PERMUTE), CAP), val: capRows(split.val, CAP), test: capRows(split.test, CAP) };
  const summary = { permute: PERMUTE, cap: CAP, targets: {} };
  TARGETS.forEach((t) => {
    if (!FORMAT[t]) throw new Error("unknown target " + t);
    const dir = path.join(OUT_DIR, "export", t), files = {};
    (t === "bakeoff" ? ["test"] : ["train", "val", "test"]).forEach((s) => {
      const f = path.join(dir, FILE[s] + ".jsonl");
      writeJsonl(f, rows[s].map(FORMAT[t]));
      // Sidecar: line -> canonical id, so device predictions and platform scores map back to rows.
      writeJsonl(path.join(dir, FILE[s] + ".index.jsonl"), rows[s].map((r, i) => ({ line: i, id: r.id, target_option: r.target_option, n_options: r.candidates.length })));
      files[FILE[s]] = { rows: rows[s].length, none: rows[s].filter((r) => !r.target_option).length, sha256: sha(fs.readFileSync(f, "utf8")) };
    });
    summary.targets[t] = files;
  });
  const pos = {}; rows.train.forEach((r) => { pos[r.target_option] = (pos[r.target_option] || 0) + 1; });
  summary.train_option_histogram = pos;
  fs.writeFileSync(path.join(OUT_DIR, "export", "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
if (import.meta.url === "file://" + process.argv[1]) main();
