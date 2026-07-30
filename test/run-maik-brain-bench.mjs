// MaiK Clinical Decision Engine — "never-guess" benchmark scorer.
// Runs test/maik-neverguess.json through MaiKBrain.resolve() (deterministic, offline) and
// prints a scorecard per kind. Establishes the Phase-0 BASELINE so later phases are measurable.
//   Pass rules: broad→decision in {overview,ask}; abbrev→decision 'ask'; specific→'answer'
//   with a resolved primary; nonmedical→'refuse'; followup→deferred (Phase 1, needs context).
// USAGE: node test/run-maik-brain-bench.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
["kb/dist/kb.core.js", "kb/dist/kb.clinical.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "kb/dist/kb.expanded.js", "dxmgmt.js", "clinical-vocab.js", "kb/ai/maik-kb.js", "kb/ai/maik-scope.js", "kb/ai/maik-brain.js"].forEach(load);
const { MaiKBrain } = globalThis;
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "test/maik-neverguess.json"), "utf8")).cases;

const PASS = {
  broad: r => ["overview", "ask"].includes(r.decision),
  abbrev: r => r.decision === "ask",
  specific: r => r.decision === "answer" && !!r.primary,
  nonmedical: r => r.decision === "refuse",
  followup: () => null   // deferred to Phase 1
};
const tally = {};
const rows = [];
for (const c of corpus) {
  let r; try { r = MaiKBrain.resolve(c.q, c.context || {}); } catch (e) { r = { decision: "THROW", primary: null, _err: e.message }; }
  const res = PASS[c.kind] ? PASS[c.kind](r) : null;
  const t = tally[c.kind] || (tally[c.kind] = { pass: 0, fail: 0, defer: 0 });
  if (res === true) t.pass++; else if (res === false) t.fail++; else t.defer++;
  rows.push({ kind: c.kind, q: c.q, decision: r.decision, primary: r.primary ? r.primary.canonicalName : "-", res });
}

const mark = v => v === true ? "PASS" : v === false ? "FAIL" : "····";
console.log("\nMaiK never-guess benchmark — BASELINE (MaiKBrain.resolve, deterministic)\n");
for (const row of rows) console.log("  " + mark(row.res).padEnd(6) + row.kind.padEnd(11) + JSON.stringify(row.q).padEnd(46) + "→ " + row.decision + (row.primary !== "-" ? "  [" + row.primary + "]" : ""));
console.log("\n  ── by kind ──");
let P = 0, N = 0;
for (const k of Object.keys(tally)) { const t = tally[k]; const scored = t.pass + t.fail; P += t.pass; N += scored; console.log("  " + k.padEnd(11) + t.pass + "/" + scored + " pass" + (t.defer ? "  (" + t.defer + " deferred)" : "")); }
console.log("\n  OVERALL (scored): " + P + "/" + N + " = " + (N ? Math.round(P / N * 100) : 0) + "%");
console.log("  Note: abbrev + wrong-condition gaps are EXPECTED to fail at baseline — that is what Phase 1 fixes.\n");
