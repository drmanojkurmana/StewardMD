/* The PDF engines really do load on demand, in a real browser, and export still works.
 *
 * The unit test pins the loader's contract. What it cannot prove is the thing that would actually
 * hurt a doctor: that moving 551 KB off the cold-start path did not leave prescription export
 * reaching for a global that is no longer there. This drives the real page.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<binary> node test/run-pdf-lazy-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9399, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pdf-lazy-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_PDF_ENGINES && SMD_PDF_ENGINES.ensure)`) === true) { ready = true; break; } }
  ok(ready, "pdf-engines.js loads on the real page");
  if (!ready) throw new Error("loader never appeared");

  // ── the whole point: 551 KB is NOT on the cold-start path ──
  ok(await ev(`return !!window.html2canvas;`) === false, "html2canvas is NOT parsed at cold start");
  ok(await ev(`return !!(window.jspdf || window.jsPDF);`) === false, "jspdf is NOT parsed at cold start");
  ok(await ev(`return SMD_PDF_ENGINES.loaded();`) === false, "loader agrees nothing is loaded yet");
  ok(await ev(`return document.querySelectorAll('script[src*="vendor-jspdf"],script[src*="vendor-html2canvas"]').length;`) === 0,
    "no eager vendor <script> tags remain in the served page");

  /* ── the name collision that would have broken exports ──
   * native-bridge.js defines window.SMD_PDF = { fromHtml } and loads BEFORE this file, so naming the
   * loader SMD_PDF would have silently replaced its renderer (MaiK, onco, reports). native-bridge
   * early-returns on web (`if (!native) return`), so SMD_PDF is absent in a browser and we cannot
   * assert it survives here - what IS verifiable, and is the actual invariant, is that the loader
   * never takes that name for itself. */
  ok(await ev(`return window.SMD_PDF === undefined;`) === true,
    "the loader does not define window.SMD_PDF (native-bridge owns it; clobbering breaks MaiK/onco/report export)");
  ok(await ev(`return typeof SMD_PDF_ENGINES.ensure;`) === "function", "the loader uses its own SMD_PDF_ENGINES namespace");

  // ── first use really loads them ──
  const t0 = Date.now();
  const got = await ev(`return SMD_PDF_ENGINES.ensure();`);
  const ms = Date.now() - t0;
  ok(got === true, "ensure() resolves true on first use");
  ok(await ev(`return !!window.html2canvas;`) === true, "html2canvas is on window after ensure()");
  ok(await ev(`return !!((window.jspdf && window.jspdf.jsPDF) || window.jsPDF);`) === true, "jspdf is on window after ensure()");
  console.log(`   first-use load cost: ${ms} ms (local disk in the native bundle, no network)`);
  ok(ms < 3000, `first-use load is not a stall (${ms} ms)`);

  // ── the engines actually WORK, not just exist: render something and make a real PDF ──
  const pdf = await ev(`
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;left:-9999px;top:0;width:300px;background:#fff;color:#000";
    d.textContent = "StewardMD export smoke test";
    document.body.appendChild(d);
    return window.html2canvas(d, { scale: 1, backgroundColor: "#ffffff" }).then(function (c) {
      d.remove();
      var JS = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      var p = new JS({ unit: "pt", format: "a4" });
      p.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 200, 60);
      var out = p.output("datauristring");
      return out.indexOf("data:application/pdf") === 0 ? "PDF_OK" : "BAD:" + out.slice(0, 40);
    }).catch(function (e) { return "THREW:" + (e && e.message); });`);
  ok(pdf === "PDF_OK", `a real PDF is produced after lazy load (got: ${pdf})`);

  // ── a second ensure() must not refetch ──
  const before = await ev(`return document.querySelectorAll('script[data-smdpdf]').length;`);
  await ev(`return SMD_PDF_ENGINES.ensure();`);
  ok(await ev(`return document.querySelectorAll('script[data-smdpdf]').length;`) === before,
    "a repeat export does not re-inject the engines");

  console.log(fails === 0 ? "\nALL GREEN — 551 KB off cold start, export still produces a real PDF" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
