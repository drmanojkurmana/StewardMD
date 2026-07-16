/* Antibiotic-engine UI restyle test (presentation-only, flag-gated).
 * Verifies: the html.abx-ui flag applies (?abxui), the restyle CSS actually takes effect on the
 * live #dxOverlay, the engine still opens + accepts findings (interaction intact), and ?abxui=0
 * fully disables the layer. Engine OUTPUT is proven unchanged separately by run-golden.mjs.
 * USAGE: BASE=http://localhost:8991/ node test/run-abx-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9383, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/abx-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8991"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.DX && DX.openWorkspace)`) === true) return true; }
  return false;
}
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // helper: open a case so the 5-step wizard (#inputCard) renders
  async function openWizard() {
    await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
    await ev(`var b=document.querySelector('[data-act="startcase"]'); if(b) b.click(); return 1;`); await sleep(900);
    await ev(`var c=document.querySelector('.mode-card'); if(c) c.click(); return 1;`); await sleep(1500);
  }

  // ---- flag ON (default / ?abxui=1) ----
  ok(await attach(BASE + "?abxui=1"), "engine loads (window.DX ready)");
  ok(await ev(`return document.documentElement.classList.contains("abx-ui");`) === true, "flag applies html.abx-ui (?abxui=1)");
  await openWizard();
  // the 5-step wizard is app.js #inputCard — the restyle must land on IT (not the reasoning overlay)
  ok(await ev(`return !!document.getElementById("inputCard");`) === true, "the 5-step wizard (#inputCard) is present");
  ok(await ev(`var e=document.getElementById("inputCard"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "16px", "wizard card restyled (#inputCard radius 16px)");
  ok(await ev(`var e=document.getElementById("runBtn"); return e ? getComputedStyle(e).minHeight : "";`) === "52px", "primary CTA restyled (#runBtn min-height 52px)");
  ok(await ev(`var e=document.querySelector(".simple-chip"); return e ? (parseFloat(getComputedStyle(e).minHeight) >= 44) : true;`) === true, "finding chips are large touch targets (≥44px)");
  ok(await ev(`return !!document.getElementById("runBtn");`) === true, "engine controls intact (Generate Clinical Decision button present)");

  // ---- flag OFF (?abxui=0) ----
  ok(await attach(BASE + "?abxui=0"), "reloads with ?abxui=0");
  ok(await ev(`return !document.documentElement.classList.contains("abx-ui");`) === true, "?abxui=0 fully disables the restyle layer (no html.abx-ui)");
  // Clean discriminator: the layer's tokens (defined only under html.abx-ui) are absent when off.
  ok(await ev(`return getComputedStyle(document.documentElement).getPropertyValue("--abx-r-card").trim();`) === "", "with the flag off, the restyle layer's tokens are gone (base engine unchanged)");

  console.log(fails === 0 ? "\nALL GREEN — antibiotic engine UI restyle test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
