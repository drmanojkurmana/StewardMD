/* test/kardiox-ort-cache.test.mjs — CR4: the ORT analyzer is cached and reused across analyses, so the
 * 7-head ONNX ensemble is loaded ONCE, not rebuilt (and reloaded, ~157 MB) on every call. Mocks
 * SMD_KARDIOX_ORT.makeOrtAnalyzer with a counter and drives ortActive() repeatedly. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", "module", read("kardiox-models.js"))(win, undefined);
new Function("window", "module", "setTimeout", "Promise", "Date", read("kardiox-providers.js"))(win, undefined, setTimeout, Promise, Date);
const P = win.SMD_KARDIOX_PROVIDERS;
ok("providers exposed with ortActive", !!P && typeof P.ortActive === "function");

// Count how many times a fresh analyzer is built. With the CR4 cache it must be built ONCE for a given
// config and then reused, regardless of how many times ortActive()/ortAnalyzer() is called.
let makeCalls = 0;
win.ort = {};   // no model-manager / not on-device-ready -> the "url" analyzer path
win.SMD_KARDIOX_ORT = {
  makeOrtAnalyzer: function () { makeCalls++; return { kind: "ecglib-ort", analyze: function () {}, analyzePaper: function () {}, ensure: function () { return Promise.resolve(); } }; }
};

for (let i = 0; i < 8; i++) P.ortActive();
ok("8 ortActive() calls build the analyzer only ONCE (cached, not per-analysis — CR4)", makeCalls === 1);
ok("ortActive() still reports the engine as available", P.ortActive() === true && makeCalls === 1);

console.log(`\nkardiox-ort-cache: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
