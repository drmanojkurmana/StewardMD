/* test/kardiox-ort-cache.test.mjs — CR4 + R6 follow-up: the ORT analyzer is cached and reused across
 * analyses (7-head ensemble loaded ONCE), and the cache is SINGLE-SLOT with disposal — a config change
 * (url → mgr) releases the superseded ~157 MB ensemble instead of leaving both resident (~314 MB). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", "module", read("kardiox-models.js"))(win, undefined);
new Function("window", "module", "setTimeout", "Promise", "Date", read("kardiox-providers.js"))(win, undefined, setTimeout, Promise, Date);
const P = win.SMD_KARDIOX_PROVIDERS;
ok("providers exposed with ortActive", !!P && typeof P.ortActive === "function");

// Count analyzer builds + track disposals. A stub analyzer per config; dispose() records its key.
let makeCalls = 0; const disposed = [];
win.SMD_KARDIOX_ORT = {
  makeOrtAnalyzer: function (opts) {
    makeCalls++;
    var id = opts && opts.modelManager ? "mgr" : "url";
    return { kind: "ecglib-ort", analyze: function () {}, analyzePaper: function () {}, ensure: function () { return Promise.resolve(); }, dispose: function () { disposed.push(id); } };
  }
};

// Phase 1 — no model manager + a global `ort`: the "url" path, cached once across many calls.
win.ort = {};
for (let i = 0; i < 8; i++) P.ortActive();
ok("8 ortActive() calls build the analyzer only ONCE (cached, not per-analysis — CR4)", makeCalls === 1);

// Phase 2 — the model pack becomes ready mid-session (url → mgr). Single-slot cache must dispose the
// old "url" ensemble and build "mgr", never hold both resident (R6 #1 dual-residency).
win.SMD_KARDIOX_MODELMGR = { installed: function () { return Promise.resolve(true); }, source: function (f) { return { url: f }; } };
await P.checkModels();   // flips _ondeviceReady = true
P.ortActive();
ok("a url→mgr config transition builds the new ensemble", makeCalls === 2);
ok("the superseded 'url' ensemble is DISPOSED, not left resident (no ~314 MB dual-residency — R6 #1)", disposed.indexOf("url") >= 0);
P.ortActive();
ok("after the transition the 'mgr' analyzer is reused (still single-build, no thrash)", makeCalls === 2);

console.log(`\nkardiox-ort-cache: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
