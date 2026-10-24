/* Kardia measurement lab UI test (WP6). Headless Chrome via CDP.
 * Runs a Simpson biplane trace (true cut polygons) and a VTI trace
 * (synthetic triangle envelope) through the real touch UI at 390 and
 * 820 px widths, and writes screenshots into work/shots/.
 * USAGE: node test/run-kardia-measure-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 9391, BASE_PORT = 8997;
const BASE = `http://localhost:${BASE_PORT}/`;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kardia-measure-chrome-" + process.pid;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(join(ROOT, "work/shots"), { recursive: true });

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Kardia measurement harness</title>
<link rel="stylesheet" href="/kardia.css"></head>
<body style="margin:0"><div id="app" class="krd-root"></div>
<script src="/kardia-sim-heart.js"></script>
<script src="/kardia-sim-geom.js"></script>
<script src="/kardia-sim-measure.js"></script>
<script>
window.__err = "";
window.addEventListener("error", function (e) { window.__err = String(e.message || e.error); });
(function () {
  var mode = new URLSearchParams(location.search).get("mode") || "simpson";
  var rootEl = document.getElementById("app");
  fetch("/kardia/views.json").then(function (r) { return r.json(); }).then(function (views) {
    var M = window.KARDIA_MEASURE;
    if (mode === "vti") {
      var spec = M.createStubSpectrumSource({ peakVelocityMs: 1.5, durationSec: 0.4, riseSec: 0.13 });
      var ui = M.createUI(rootEl, { tool: "vtiTrace", source: spec, truth: spec.trueVtiCm(), quantity: "LVOTVTI" });
      ui.setPoints(spec.envelopePoints(48));
      window.__ui = ui; window.__source = spec;
      ui.elements.done.click();
      window.__result = ui.elements.feedback.textContent;
      window.__ready = true;
    } else {
      var heart = window.KARDIA_HEART.create(); heart.step(4000);
      var geom = window.KARDIA_GEOM.create({ heart: heart }); geom.setViews(views);
      var src = M.createStubImageSource({ heart: heart, geom: geom, view: "tte_a4c" });
      var gt = M.groundTruth(heart);
      var ui2 = M.createUI(rootEl, { tool: "simpson", source: src, truth: gt.EF, quantity: "EF", expectedPhase: "endDiastole" });
      var W = rootEl.clientWidth || 390, H = Math.round(W * 0.78);
      function traceFor(view, phase) {
        src.setView(view);
        var fr = src.frameAt(phase);
        var lv = fr.polygons.filter(function (p) { return p.id === "lv_cavity"; })[0];
        return lv.points.map(function (p) { return src.mmToPx(p, W, H); });
      }
      var traces = [traceFor("tte_a4c", "endDiastole"), traceFor("tte_a4c", "endSystole"),
                    traceFor("tte_a2c", "endDiastole"), traceFor("tte_a2c", "endSystole")];
      ui2.setTraces(traces);
      window.__ui = ui2; window.__source = src; window.__truth = gt;
      ui2.elements.done.click();
      window.__result = ui2.elements.feedback.textContent;
      window.__ready = true;
    }
  }).catch(function (e) { window.__err = String(e && e.message || e); window.__ready = true; });
})();
</script></body></html>`;
writeFileSync(join(ROOT, "work/kardia-measure-harness.html"), HARNESS);

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(BASE_PORT)], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--force-device-scale-factor=1"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function attach(url, width) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: width < 600 });
  await call("Page.enable", {});
  await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return !!window.__ready;`) === true) return true; }
  return false;
}
async function shot(name) {
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const data = r.result && r.result.data;
  if (!data) return false;
  writeFileSync(join(ROOT, "work/shots", name), Buffer.from(data, "base64"));
  return true;
}
try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  for (const width of [390, 820]) {
    for (const mode of ["simpson", "vti"]) {
      const label = `${mode} at ${width}`;
      ok(await attach(`${BASE}work/kardia-measure-harness.html?mode=${mode}`, width), `${label}: harness ready`);
      ok(await ev(`return window.__err || "";`) === "", `${label}: no page error (${await ev(`return window.__err || "";`)})`);
      const result = await ev(`return window.__result || "";`);
      console.log("  result: " + result);
      if (mode === "vti") { const m = /VTI trace: ([0-9.]+) cm/.exec(result || ""); ok(!!m && Math.abs(parseFloat(m[1]) - 30) <= 3 && /True value/.test(result || ""), `${label}: VTI graded against the triangle truth`); }
      else ok(/Simpson biplane:/.test(result || "") && /True value/.test(result || ""), `${label}: Simpson graded against the model EF`);
      ok(await ev(`var b=[...document.querySelectorAll(".krdm-btn")]; return b.length>=3 && b.every(function(x){return x.getBoundingClientRect().height>=44;});`) === true, `${label}: all controls at least 44 px tall`);
      ok(await ev(`return document.documentElement.scrollWidth <= ${width} + 1;`) === true, `${label}: no horizontal overflow`);
      ok(await shot(`kardia-measure-${mode}-${width}.png`), `${label}: screenshot written to work/shots/`);
    }
  }
  console.log(fails === 0 ? "\nALL GREEN: Kardia measurement UI test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
