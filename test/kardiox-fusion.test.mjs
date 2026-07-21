/* test/kardiox-fusion.test.mjs — Evidence Fusion Engine (JS port of fusion.py) log-odds consensus. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const win = {}; new Function("window", "module", read("kardiox-fusion.js"))(win, undefined);
const F = win.SMD_KARDIOX_FUSION;

ok("fusion exposed", !!F && typeof F.fuse === "function" && F.METHOD === "logodds-consensus");

// Regression guard for the null-quality coercion bug: null signal quality must be NEUTRAL, not 0
// (JS +null===0 once gated a P=0.98 finding down to 0.25).
const r = F.fuse([{ source: "ecglib", label: "Atrial fibrillation", confidence: 0.98, weight: 0.6 }], { matched: [], conflicts: [] }, null, null);
ok("single strong candidate + null quality → high confidence (not gated to 0.25)", r.overallConfidence > 0.85 && r.topLabel === "Atrial fibrillation");

// Log-odds rewards multiple independent agreeing sources.
const one = F.fuse([{ source: "a", label: "AF", confidence: 0.8, weight: 1 }], {}, null, null).findings[0].fusedConfidence;
const two = F.fuse([{ source: "a", label: "AF", confidence: 0.8, weight: 1 }, { source: "b", label: "AF", confidence: 0.8, weight: 1 }], {}, null, null).findings[0].fusedConfidence;
ok("two agreeing sources > one (consensus reward)", two > one);

ok("low signal quality gates confidence toward 0.5", F.fuse([{ source: "ecglib", label: "AF", confidence: 0.98, weight: 0.6 }], {}, 0.2, null).overallConfidence < r.overallConfidence);
ok("never asserts absolute certainty (≤0.98)", F.fuse([{ source: "a", label: "X", confidence: 0.999, weight: 5 }], {}, null, null).findings[0].fusedConfidence <= 0.98);

const fb = F.fuse([], { diagnoses: [{ label: "Sinus rhythm", confidence: 0.7 }] }, null, null);
ok("fallback to rule diagnoses when no model candidates", fb.topLabel === "Sinus rhythm" && fb.findings.length === 1);
ok("malformed candidates skipped with a warning", F.fuse([{ label: "AF" }, { source: "x", label: "AF", confidence: 0.9 }], {}, null, null).warnings.some(w => /malformed/.test(w)));
ok("empty everything → nothing to fuse", (() => { const e = F.fuse([], {}, null, null); return e.topLabel === null && e.overallConfidence === 0; })());

console.log(`\nkardiox-fusion: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
