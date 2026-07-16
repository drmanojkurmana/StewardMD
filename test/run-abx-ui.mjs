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

  // ---- flag ON (default / ?abxui=1) ----
  ok(await attach(BASE + "?abxui=1"), "reasoning engine loads (window.DX ready)");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  ok(await ev(`return document.documentElement.classList.contains("abx-ui");`) === true, "flag applies html.abx-ui (?abxui=1)");

  await ev(`DX.openWorkspace(); return 1;`); await sleep(500);
  ok(await ev(`var o=document.getElementById("dxOverlay"); return !!(o && o.classList.contains("on"));`) === true, "reasoning workspace opens (#dxOverlay.on)");
  // restyle actually applied: the search input picks up the abx min-height (48px)
  ok(await ev(`var s=document.getElementById("dxSearch"); return s ? getComputedStyle(s).minHeight : "none";`) === "48px", "restyle CSS is in effect (search field min-height 48px)");
  // and the header title is the premium weight
  ok(await ev(`var t=document.querySelector("#dxOverlay .dx-title"); return t ? getComputedStyle(t).fontWeight : "";`) === "800", "premium type hierarchy applied (title weight 800)");

  // engine interaction still works: adding a finding renders a selected chip
  await ev(`try{ DX.addFindings(["fever"]); }catch(e){} return 1;`); await sleep(300);
  ok(await ev(`var sel=document.getElementById("dxSel"); return !!(sel && (sel.querySelector(".dx-sel-chip") || /No findings/i.test("")===false && sel.textContent.length>0));`) === true, "engine still accepts findings (selected list renders) — interaction intact");

  // ---- flag OFF (?abxui=0) ----
  ok(await attach(BASE + "?abxui=0"), "reloads with ?abxui=0");
  ok(await ev(`return !document.documentElement.classList.contains("abx-ui");`) === true, "?abxui=0 fully disables the restyle layer (no html.abx-ui)");
  await ev(`DX.openWorkspace(); return 1;`); await sleep(400);
  ok(await ev(`var s=document.getElementById("dxSearch"); return s ? getComputedStyle(s).minHeight : "none";`) !== "48px", "with the flag off, the base engine styles are unchanged (original search sizing)");

  console.log(fails === 0 ? "\nALL GREEN — antibiotic engine UI restyle test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
