/* Fork-runtime probe on the connected Android phone (owner, 2026-09-19): is MAiK Cortex installed,
 * does it load on the PrismML llama.cpp build, does it answer? Uses the job's CDP helper.
 * USAGE: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *        node test/run-cortex-fork-probe.mjs <ws-url> ["question"] */
import { connect } from "/Users/diwakarkumar/.claude/jobs/49170716/tmp/android-cdp.mjs";
const ws = process.argv[2]; const q = process.argv[3] || "How to treat UTI?"; const pack = process.argv[4] || "medmo-4b";
const c = connect(ws, { timeoutMs: 15 * 60 * 1000 });
const ev = (e) => c.evaluate(e);
const evA = (e) => (c.evaluateAsync ? c.evaluateAsync(e) : c.evaluate(e));
console.log("bundle:", await ev(`(function(){var s=document.querySelector('script[src*="maik-local.js"]');return s?s.getAttribute("src"):"?"})()`));
console.log("packs installed:", await ev(`(function(){var M=window.SMD_MAIK_MODELS;return JSON.stringify(M.packIds().filter(function(id){return M.installedCached(id)}))})()`));
console.log("active pack:", await ev(`(function(){var L=window.SMD_MAIK_LOCAL;return L&&L.currentPack?L.currentPack():"?"})()`));
console.log("engine:", await ev(`(function(){var E=window.SMD_MAIK_ENGINE;return E?E.effective():"?"})()`));
// The WebView ignores awaitPromise for long promises: store the result on window and poll.
const t0 = Date.now();
await ev(`(function(){window.__cortex=null;window.SMD_MAIK_LOCAL.answer({question:${JSON.stringify(q)}},{pack:${JSON.stringify(pack)}},null).then(function(r){window.__cortex=JSON.stringify({err:r&&r.error,grounded:r&&r.grounded,verdict:r&&r.grounding&&r.grounding.verdict,text:String((r&&r.text)||"").slice(0,700)})},function(e){window.__cortex="THREW: "+(e&&e.message||e)});return 1})()`);
let r = null;
for (let i = 0; i < 120 && !r; i++) { await new Promise((res) => setTimeout(res, 5000)); r = await ev(`window.__cortex`); if (i % 6 === 5) console.log("  waiting", ((Date.now() - t0) / 1000).toFixed(0), "s"); }
console.log("elapsed s:", ((Date.now() - t0) / 1000).toFixed(1));
console.log("answer:", r);
process.exit(0);
