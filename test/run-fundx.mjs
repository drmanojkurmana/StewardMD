/* run-fundx.mjs — FundX AI integration test (headless Chrome + fake camera device).
 * Drives the REAL app: flag gating → Home tile → overlay → guided-capture camera (fake
 * MediaStream) → training, and confirms ?fundx=0 is a no-op. Camera detection quality
 * isn't asserted (fake stream); this proves the DOM wiring + camera mount + no crashes.
 * USAGE: node test/run-fundx.mjs        (manual; not part of `npm test`)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8795/").replace(/\/?$/, "/");
const PORT = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/fundx-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8795"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function attach(url, ready) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(ready) === true) return true; }
  return false;
}
const killGates = `["introPoster","splash","accountGate","introOverlay","verifyGate"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- flag ON ----
  ok(await attach(BASE + "?fundx=1", `return !!(window.FUNDX && FUNDX.enabled && FUNDX.enabled())`), "FundX enabled with ?fundx=1 (window.FUNDX ready)");
  ok(await ev(`return !!(window.SMD_FUNDX_VISION && window.SMD_FUNDX_ENHANCE && window.SMD_FUNDX_PROVIDERS && window.SMD_FUNDX_DETECT && window.SMD_FUNDX_STORE);`) === true, "all FundX modules loaded");
  ok(await ev(`return (window.SMD_FUNDX_PROVIDERS.health().filter(function(x){return x.id==="mock"&&x.available})).length===1;`) === true, "AI Router: mock provider available");
  await ev(killGates);
  ok(await ev(`return !!document.querySelector('[data-act="retinalscan"]');`) === true, "Home shows the Retinal Scan tile");

  // open overlay
  await ev(`var b=document.querySelector('[data-act="retinalscan"]'); if(b) b.click(); return 1;`); await sleep(500);
  ok(await ev(`return !!document.querySelector('#fundxRoot.on');`) === true, "tile opens the FundX overlay (#fundxRoot.on)");
  ok(await ev(`return !!document.querySelector('#fundxRoot [data-fx="newscan"]');`) === true, "FundX Home renders (New retinal scan CTA)");

  // pre-capture → camera (fake stream)
  await ev(`document.querySelector('#fundxRoot [data-fx="newscan"]').click(); return 1;`); await sleep(400);
  ok(await ev(`return !!document.querySelector('#fundxRoot [data-fx="startcam"]') && !!document.querySelector('#fundxRoot [data-fx="eye"]');`) === true, "Pre-capture screen (eye picker + start button)");
  await ev(`localStorage.setItem("smd_fundx_dev","1"); return 1;`);   // enable developer mode (debug overlay)
  await ev(`document.querySelector('#fundxRoot [data-fx="startcam"]').click(); return 1;`); await sleep(2500);
  ok(await ev(`return !!document.getElementById("fundxVideo");`) === true, "Camera screen mounts a live <video>");
  ok(await ev(`return !!document.getElementById("fundxDebug");`) === true, "dev mode: debug overlay present in the camera screen");
  // The per-frame paint depends on the camera analyze loop, which the headless fake device
  // can't drive; verify the overlay's data path works in the REAL browser bundle instead.
  ok(await ev(`var s={state:"ready",shouldCapture:true,diagnostic:0.83,gates:{focus:true,quality:true},readiness:{overall:1,ready:true}}; var fa=window.SMD_FUNDX_VISION.makeFrameAnalysis({focus:0.9,reflection:0.1,vesselScore:0.7,fundusConf:0.8}); var m=window.FUNDX._devMetrics(s,fa); return m.length===11 && m.map(function(r){return r[0];}).indexOf("DIAGNOSTIC")>=0;`) === true, "dev mode: overlay metrics compute in-browser (11 live metrics + decision)");
  ok(await ev(`var v=document.getElementById("fundxVideo"); return !!(v && v.srcObject && v.srcObject.getVideoTracks && v.srcObject.getVideoTracks().length > 0 && v.srcObject.getVideoTracks()[0].readyState === "live");`) === true, "getUserMedia resolved: camera stream attached with a live video track");
  ok(await ev(`return !!document.getElementById("fundxRingFg") && !!document.getElementById("fundxChips");`) === true, "AR overlay present (readiness ring + gate chips)");
  ok(await ev(`return document.querySelectorAll('#fundxChips .fundx-chip').length >= 8;`) === true, "gate chips rendered");

  // close camera → training
  await ev(`var x=document.querySelector('#fundxRoot [data-fx="camclose"]'); if(x) x.click(); return 1;`); await sleep(400);
  await ev(`var tr=document.querySelector('#fundxRoot [data-fx="training"]'); if(tr) tr.click(); return 1;`); await sleep(400);
  ok(await ev(`return document.querySelectorAll('#fundxRoot [data-fx="level"]').length === 7;`) === true, "Training Mode renders 7 levels");

  // close overlay via the global back selector (swipe-back parity)
  await ev(`var c=document.querySelector('#fundxRoot [data-fx="home"],#fundxRoot [aria-label="Back"]'); if(c) c.click(); var cl=document.querySelector('#fundxRoot .fundx-close[aria-label="Close"]'); if(cl) cl.click(); return 1;`); await sleep(300);

  // ---- flag OFF ----
  ok(await attach(BASE + "?fundx=0", `return !!(window.FUNDX)`), "reloads with ?fundx=0");
  ok(await ev(`return window.FUNDX.enabled() === false;`) === true, "?fundx=0 → FundX disabled (stub)");
  await ev(killGates);
  ok(await ev(`return !document.querySelector('[data-act="retinalscan"]');`) === true, "?fundx=0 → no Retinal Scan tile (no-op)");

  console.log(fails === 0 ? "\nALL GREEN — FundX integration test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e && e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
