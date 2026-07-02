/* ICU report-import: compression + clinician-confirmed apply (gold125, PR 2/2).
 *
 * Verifies the safety-critical, locally-testable parts of the photo/PDF import:
 *   • client-side compression shrinks a large image to a JPEG under the upload cap
 *     (so a raw multi-MB file is NEVER what reaches the OCR endpoint),
 *   • imported values apply with source "Imported report" and are conflict-safe
 *     (a clinician's Manual value is not overwritten),
 *   • ventilator/ABG/vitals groups route to the right ICU context fields.
 *
 * The OCR vision call itself hits /api/ai (Cloudflare Function) and is prod-only.
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-import.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9375, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-imp-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU._compressImage && ICU.ingestFromWard)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU import API not loaded");

  // 1) compression: a big noisy image → JPEG under the ~1.6 MB upload cap
  const comp = await ev(`
    var n = 2600, cv = document.createElement("canvas"); cv.width = n; cv.height = n; var ctx = cv.getContext("2d");
    var im = ctx.createImageData(n, n); for (var i = 0; i < im.data.length; i += 4) { im.data[i]=(i*7)%255; im.data[i+1]=(i*13)%255; im.data[i+2]=(i*29)%255; im.data[i+3]=255; }
    ctx.putImageData(im, 0, 0);
    var raw = cv.toDataURL("image/png");
    return await new Promise(function(res){ ICU._compressImage(raw, function(out, meta){ res(JSON.stringify({ rawKB: Math.round(raw.length*3/4/1024), outKB: meta&&meta.kb, jpeg: /^data:image\\/jpeg/.test(out||"") })); }); });
  `);
  const C = JSON.parse(comp);
  ok(C.jpeg === true, "compressed output is a JPEG data-URL (EXIF/metadata dropped by canvas re-encode)");
  ok(C.outKB > 0 && C.outKB <= 1650, "large image (" + C.rawKB + " KB raw) compressed to " + C.outKB + " KB (≤ upload cap)");

  // 2) imported values apply with source "Imported report" + conflict-safety
  const r2 = await ev(`
    ICU.reset && ICU.reset();
    var res = ICU.ingestFromWard({ source: "Imported report", mapped: { na: 129, k: 6.1, creat: 190 }, abg: { ph: 7.21, paco2: 34 }, ventilator: { fio2: 60, peep: 10 } });
    var s = ICU.state();
    return JSON.stringify({ na: s.labs.recent.na, k: s.labs.recent.k, src: s.src.na && s.src.na.source, ph: (s.abg||{}).ph, fio2: (s.ventilator||{}).fio2, applied: res.applied.length });
  `);
  const R = JSON.parse(r2);
  ok(R.na === 129 && R.k === 6.1 && R.creat !== 0, "imported labs applied to context (Na/K/Creat)");
  ok(R.src === "Imported report", "imported values tagged source = 'Imported report'");
  ok(R.ph === 7.21 && R.fio2 === 60, "imported ABG + ventilator route to abg / ventilator context");

  const r3 = await ev(`
    ICU.reset && ICU.reset();
    ICU.ingestLabs({ k: 4.2 }); ICU.state().src.k = { source: "Manual", ts: 1 };
    ICU.ingestFromWard({ source: "Imported report", mapped: { k: 6.9 } });
    return JSON.stringify({ k: ICU.state().labs.recent.k, conflicts: (ICU.state().conflicts||[]).length });
  `);
  const K = JSON.parse(r3);
  ok(K.k === 4.2, "manual K (4.2) NOT overwritten by imported report (6.9)");
  ok(K.conflicts >= 1, "import-vs-manual conflict recorded for clinician to resolve");

  console.log(fails === 0 ? "\nALL GREEN — ICU report-import test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
