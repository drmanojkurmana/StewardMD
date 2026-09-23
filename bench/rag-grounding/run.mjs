#!/usr/bin/env node
/* bench/rag-grounding/run.mjs — cross-model grounding battery.
 *
 * Two things are measured, and they are kept apart on purpose:
 *   1. VERIFIER quality, on gold-labelled claims (cases.json): accepted valid claims, blocked
 *      unsupported claims, false-rejection rate, precision/recall of "supported". Deterministic,
 *      no model involved, also asserted in test/maik-grounding-verifier.test.mjs.
 *   2. Per-MODEL behaviour, on real answers: how much of what each pack writes against the same
 *      passages survives grounding (claims supported / removed / contradicted, answers grounded /
 *      partial / ungrounded). Needs answers from the packs, which only exist on a phone:
 *        --answers <file>   recorded answers: { "<packId>": { "<caseId>": "<answer text>" } }
 *        --live             ask each INSTALLED pack on the connected phone via the WebView's CDP
 *                           (adb forward tcp:9333, see bench/icu-monitor/device-run.mjs) and record
 *                           them to answers-<date>.json first.
 *      Per-model "false rejection" cannot be computed without a human gold label on each free-form
 *      answer; the battery reports what was removed so a clinician can review it, it does not guess.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = require("../../kb/ai/maik-grounding.js");
const R = require("../../kb/ai/maik-lite-rag.js");
const CASES = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const expand = (q) => R.expand(q)[0];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

// ── 1. verifier metrics on gold claims ──
const t = { tp: 0, fn: 0, fp: 0, tn: 0 }, byCat = {};
for (const c of CASES) for (const cl of c.claims) {
  const got = G.groundAnswer(cl.text, c.passages, c.question || "", { expand }).claims[0]?.status || "meta";
  const goldOk = cl.gold === "supported" || cl.gold === "clinician", gotOk = got === "supported" || got === "clinician";
  const cat = (byCat[c.category] = byCat[c.category] || { tp: 0, fn: 0, fp: 0, tn: 0, miss: [] });
  const k = goldOk ? (gotOk ? "tp" : "fn") : (gotOk ? "fp" : "tn");
  t[k]++; cat[k]++;
  if (k === "fn" || k === "fp") cat.miss.push({ claim: cl.text, gold: cl.gold, got });
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "n/a");
console.log("VERIFIER (gold claims, n=" + (t.tp + t.fn + t.fp + t.tn) + ")");
console.log("  valid grounded accepted   " + pct(t.tp, t.tp + t.fn) + "   false rejection " + pct(t.fn, t.tp + t.fn));
console.log("  unsupported blocked       " + pct(t.tn, t.tn + t.fp));
console.log("  precision " + pct(t.tp, t.tp + t.fp) + "   recall " + pct(t.tp, t.tp + t.fn));
for (const [cat, v] of Object.entries(byCat)) console.log("  " + cat.padEnd(22) + " accepted " + pct(v.tp, v.tp + v.fn).padStart(6) + "  blocked " + pct(v.tn, v.tn + v.fp).padStart(6) + (v.miss.length ? "  MISSES " + JSON.stringify(v.miss) : ""));

// ── 2. per-model battery on real answers ──
async function liveAnswers(packs) {
  const { connect } = await import("../icu-monitor/../../bench/icu-monitor/android-cdp.mjs").catch(() => ({}));
  if (!connect) throw new Error("live mode needs bench/icu-monitor/android-cdp.mjs and a forwarded WebView (adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>)");
  const pages = await (await fetch("http://localhost:9333/json")).json();
  const c = connect(pages[0].webSocketDebuggerUrl, { timeoutMs: 300000 });
  const out = {};
  for (const pack of packs) {
    out[pack] = {};
    for (const cs of CASES) {
      const ev = cs.passages.map((p, i) => "[" + (i + 1) + "] " + p.text).join("\n\n");
      const q = cs.question || "Summarise the reference material.";
      // The SAME prompt shape maik-local.js builds, minus retrieval (the passages are the case's).
      const expr = `window.SMD_MAIK_LOCAL.answer({ question: ${JSON.stringify("Reference material from the StewardMD Knowledge Base:\n" + ev + "\n\nUsing the reference material above where it applies, answer:\n" + q)} }, { pack: ${JSON.stringify(pack)}, _ungrounded: true }, null).then(function(r){ window.__smdres = JSON.stringify(r); }, function(e){ window.__smdres = "ERR:" + e; });`;
      const r = await c.evaluateAsync(expr, 300);
      try { out[pack][cs.id] = JSON.parse(r).text || ""; } catch (e) { out[pack][cs.id] = ""; }
      console.log("  live " + pack + " " + cs.id + " " + (out[pack][cs.id] ? "ok" : "EMPTY"));
    }
  }
  return out;
}

let answers = null;
if (opt("--answers")) answers = JSON.parse(readFileSync(opt("--answers"), "utf8"));
else if (args.includes("--live")) {
  const packs = (opt("--packs") || "maik-lite,maik-mxcore,bonsai-ternary-8b").split(",");
  answers = await liveAnswers(packs);
  const f = new URL("./answers-" + new Date().toISOString().slice(0, 10) + ".json", import.meta.url);
  writeFileSync(f, JSON.stringify(answers, null, 2)); console.log("recorded to " + f.pathname);
}
if (!answers) { console.log("\nPER-MODEL: no answers (pass --answers <file> or --live with a phone attached)."); process.exit(0); }

console.log("\nPER-MODEL (real answers through the verifier; removed claims listed for clinician review)");
for (const [pack, byCase] of Object.entries(answers)) {
  const s = { answers: 0, grounded: 0, partial: 0, ungrounded: 0, supported: 0, unsupported: 0, contradicted: 0, removed: [] };
  for (const cs of CASES) {
    const a = byCase[cs.id]; if (!a) continue;
    const g = G.groundAnswer(a, cs.passages, cs.question || "", { expand });
    s.answers++; s[g.verdict]++;
    s.supported += g.stats.supported + g.stats.clinician; s.unsupported += g.stats.unsupported; s.contradicted += g.stats.contradicted;
    for (const r of g.removed) s.removed.push({ case: cs.id, status: r.status, text: r.text });
  }
  const claims = s.supported + s.unsupported + s.contradicted;
  console.log("  " + pack.padEnd(18) + " answers " + s.answers + "  grounded " + s.grounded + "  partial " + s.partial + "  ungrounded " + s.ungrounded +
    "  | claims kept " + pct(s.supported, claims) + "  unsupported " + pct(s.unsupported, claims) + "  contradicted " + pct(s.contradicted, claims));
  for (const r of s.removed) console.log("      removed [" + r.status + "] " + r.case + ": " + r.text);
}
