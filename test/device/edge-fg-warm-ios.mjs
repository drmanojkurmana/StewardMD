/* test/device/edge-fg-warm-ios.mjs: iPhone check for the FunctionGemma background warm and the
 * neonatal tool card (branch edge-fg-warm-neocard). JS only: injects edge-runtime.js, edge-router.js
 * and the home.js tool opener over the WebKit proxy into the RUNNING OTA bundle.
 * USAGE: ios_webkit_debug_proxy -c null:9221,:9222-9250 (relaunch the app first), then
 *        node test/device/edge-fg-warm-ios.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../ios-webkit-cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pages = await (await fetch("http://localhost:9222/json")).json();
const page = pages.find((p) => /stewardmd|capacitor|localhost/i.test(p.url)) || pages[0];
if (!page) { console.error("no WebView page"); process.exit(1); }
const c = connect(page.webSocketDebuggerUrl, { timeoutMs: 90000 });
const ev = (e) => c.evaluate(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(expr, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await ev(expr); if (v != null && v !== "" && v !== "null" && v !== undefined) return v; await sleep(250); }
  return null;
}

console.log("page", page.url, "lock?", await ev(`!!document.querySelector("#appLock:not([hidden]),.app-lock.on")`));
console.log("before", await ev(`JSON.stringify({ choice: SMD_EDGE.engineChoice(), engine: SMD_EDGE.engineName(), holder: window.SMD_LLAMA_HOLDER || null, ver: (document.querySelector('script[src*="edge-router.js"]')||{}).src })`));

// Inject the branch's JS (the OTA bundle has the old files).
for (const f of ["edge-runtime.js", "edge-router.js"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  console.log("inject", f, await ev(`(function(){ try { (0,eval)(${JSON.stringify(src)}); return "ok"; } catch (e) { return "ERR " + e.message; } })()`));
}
// home.js opener (closure-private in the OTA build): the same logic, for the render check below.
await ev(`window.SMD_MAIK_TOOL_OPENABLE = window.SMD_MAIK_TOOL_OPENABLE || null; 1`);

// 1. Switch to FunctionGemma; the warm is scheduled 4 s later, outside any request.
await ev(`window.__x = null; window.__t0 = Date.now(); SMD_EDGE.setEngineChoice("functiongemma"); 1`);
console.log("after switch", await ev(`JSON.stringify({ engine: SMD_EDGE.engineName(), holder: window.SMD_LLAMA_HOLDER || null })`));
const warm = await poll(`(function(){ var l = SMD_EDGE.warmLog(); var w = l.filter(function(x){ return "ok" in x; }).pop(); return w ? JSON.stringify({ log: l, sinceSwitchMs: Date.now() - window.__t0 }) : null; })()`, 90000);
console.log("WARM", warm);

// 2. Next request: warm.
await ev(`window.__x = null; var t=Date.now(); SMD_EDGE.route("show me the resistance patterns antibiogram").then(function(r){ window.__x = JSON.stringify({ wallMs: Date.now()-t, r: r && { id: r.id, source: r.source, ms: r.ms, confidence: r.confidence } }); }); 1`);
console.log("FIRST REQUEST", await poll(`window.__x`, 30000));

// 3. Potassium: what the router offers and picks.
await ev(`window.__x = null; var t=Date.now(); SMD_EDGE.route("normal adult potassium range?").then(function(r){ window.__x = JSON.stringify({ wallMs: Date.now()-t, cands: SMD_EDGE.candidates("normal adult potassium range?").map(function(c){return c.kind+":"+c.id;}), r: r && { kind: r.kind, id: r.id, source: r.source, confidence: r.confidence } }); }); 1`);
console.log("POTASSIUM", await poll(`window.__x`, 30000));
// The branch's home.js opener predicate, evaluated against the live neonatal hub.
console.log("neo:ref openable", await ev(`(function(){ var N = window.SMD_NEO_HUB; return !!(N && N.open && N.on && N.on() && N.tools && N.tools().some(function (t) { return t.id === "ref"; })); })()`));
console.log("stats", await ev(`JSON.stringify(SMD_EDGE.stats())`));
c.close && c.close();
process.exit(0);
