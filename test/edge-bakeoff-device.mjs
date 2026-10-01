/* test/edge-bakeoff-device.mjs — run the Edge router bake-off on a REAL phone (Edge-Master-Plan Day 5).
 *
 * Not part of `npm test` (it needs a connected device with the app open). It feeds the exported
 * test prompts (vault/plans/edge-data/dataset/export/bakeoff/test.jsonl, from
 * `node scripts/edge/export.mjs`) to SMD_EDGE.bakeoff() inside the app's WebView, under the same
 * runtime contract as production, and writes the {id, option, confidence, ms, status} lines that
 * `node scripts/edge/score.mjs --pred <file>` scores against the rules baseline.
 *
 * Android (CDP):
 *   adb shell pidof in.stewardmd.app                      # the app's pid
 *   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   node test/edge-bakeoff-device.mjs --engine needle [--weights /data/.../tuned.cact] [--uncalibrated]
 *   node test/edge-bakeoff-device.mjs --engine llama --model /data/.../functiongemma-router-q8_0.gguf
 * iOS (WebKit, USB only, phone unlocked, app freshly launched - see test/ios-webkit-cdp.mjs):
 *   ios_webkit_debug_proxy -c null:9221,:9222-9250 ; curl localhost:9222/json
 *   node test/edge-bakeoff-device.mjs --ios --ws ws://localhost:9222/devtools/page/1 --engine needle
 *
 * Options: --limit N (first N rows), --out <file> (default edge-bakeoff-<engine>-<platform>.jsonl in
 * the scratch dir given by --dir, else the current dir), --deadline ms (default 1200, production).
 *
 * After a llama run, RELAUNCH THE APP: the llama plugin holds one model, and MaiK's pack was evicted.
 */
import fs from "node:fs";
import path from "node:path";
import { connect } from "./ios-webkit-cdp.mjs";

const argv = process.argv.slice(2);
const has = (k) => argv.includes("--" + k);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const ENGINE = arg("engine", "needle");
const IOS = has("ios");
const FILE = arg("file", "vault/plans/edge-data/dataset/export/bakeoff/test.jsonl");
const LIMIT = Number(arg("limit", 0));
const OUT = arg("out", path.join(arg("dir", "."), `edge-bakeoff-${ENGINE}-${IOS ? "ios" : "android"}.jsonl`));
const DEADLINE = Number(arg("deadline", 1200));

let rows = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (LIMIT) rows = rows.slice(0, LIMIT);
console.log(`${rows.length} prompts, engine ${ENGINE}, ${IOS ? "iOS" : "Android"}`);

// ---- one evaluate() for both platforms: a string expression in, a JSON-able value out ----------
let ev;
if (IOS) {
  const ws = arg("ws");
  if (!ws) { console.error("--ios needs --ws <webSocketDebuggerUrl> (curl localhost:9222/json)"); process.exit(1); }
  const c = connect(ws, { timeoutMs: 60000 });
  ev = (expr) => c.evaluate(`(function(){try{return JSON.stringify((function(){${expr}})())}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`).then((v) => (typeof v === "string" ? JSON.parse(v) : v));
} else {
  const PORT = process.env.CDP_PORT || 9333;
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) { console.error("no debuggable page on port " + PORT); process.exit(1); }
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 1; const pending = new Map();
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  ev = (expr) => new Promise((r) => {
    const i = id++; pending.set(i, (m) => {
      const v = m.result && m.result.result ? m.result.result.value : null;
      r(typeof v === "string" ? JSON.parse(v) : v);
    });
    sock.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { returnByValue: true,
      expression: `(function(){try{return JSON.stringify((function(){${expr}})())}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()` } }));
  });
}

// ---- 1. probe ------------------------------------------------------------------------------------
const probe = await ev(`var C = window.Capacitor || {}, P = C.Plugins || {};
  return { native: !!(C.isNativePlatform && C.isNativePlatform()), edge: !!window.SMD_EDGE, bakeoff: !!(window.SMD_EDGE && SMD_EDGE.bakeoff),
           needle: !!P.Needle, llama: !!P.Llama, runtime: !!window.SMD_EDGE_RUNTIME };`);
console.log("probe", JSON.stringify(probe));
if (!probe || probe.__err || !probe.bakeoff) { console.error("the app build has no SMD_EDGE.bakeoff (rebuild with this branch)"); process.exit(1); }
if (ENGINE === "needle" && !probe.needle) { console.error("Capacitor.Plugins.Needle is missing: capacitor-needle is not in this build"); process.exit(1); }
if (ENGINE === "llama" && (!probe.llama || !arg("model"))) { console.error("llama needs the Llama plugin and --model <gguf path on the device>"); process.exit(1); }

// ---- 2. ship the prompts in chunks (a single huge evaluate can exceed the WebView's message cap) --
await ev(`window.__edgeRows = []; window.__edgeBake = null; return 1;`);
for (let i = 0; i < rows.length; i += 100) {
  const chunk = JSON.stringify(rows.slice(i, i + 100));
  const r = await ev(`window.__edgeRows = window.__edgeRows.concat(${chunk}); return window.__edgeRows.length;`);
  process.stdout.write(`\rloaded ${r}/${rows.length}`);
}
console.log();

// ---- 3. start (fire and forget), then poll -----------------------------------------------------
const engineExpr = ENGINE === "llama"
  ? `SMD_EDGE.llamaAdapter(Capacitor.Plugins.Llama, { modelPath: ${JSON.stringify(arg("model"))} })`
  : `SMD_EDGE.needleAdapter(Capacitor.Plugins.Needle, { weightsPath: ${JSON.stringify(arg("weights", "") || "")} || undefined, calibrated: ${has("uncalibrated") ? "false" : "true"} })`;
const started = await ev(`window.__edgeBake = { n: 0, done: false, err: null, out: null, t0: Date.now() };
  SMD_EDGE.bakeoff(window.__edgeRows, ${engineExpr}, { deadlineMs: ${DEADLINE}, onProgress: function (i) { window.__edgeBake.n = i; } })
    .then(function (out) { window.__edgeBake.out = out; window.__edgeBake.done = true; })
    .catch(function (e) { window.__edgeBake.err = String(e && e.message || e); window.__edgeBake.done = true; });
  return 1;`);
if (started !== 1) { console.error("could not start", started); process.exit(1); }
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await ev(`var b = window.__edgeBake; return { n: b.n, done: b.done, err: b.err, s: Math.round((Date.now() - b.t0) / 1000) };`);
  process.stdout.write(`\r${st.n}/${rows.length} in ${st.s}s   `);
  if (st.err) { console.error("\nbake-off failed: " + st.err); process.exit(1); }
  if (st.done) break;
}
console.log();

// ---- 4. collect and write ------------------------------------------------------------------------
const out = [];
for (let i = 0; i < rows.length; i += 200) out.push(...(await ev(`return window.__edgeBake.out.slice(${i}, ${i + 200});`)));
fs.writeFileSync(OUT, out.map((l) => JSON.stringify(l)).join("\n") + "\n");
const st = {}; out.forEach((l) => { st[l.status] = (st[l.status] || 0) + 1; });
console.log(`wrote ${out.length} lines to ${OUT}`, JSON.stringify(st));
console.log(`score it: node scripts/edge/score.mjs --pred ${OUT}`);
if (ENGINE === "llama") console.log("RELAUNCH THE APP now: MaiK's model was evicted from the llama plugin.");
process.exit(0);
