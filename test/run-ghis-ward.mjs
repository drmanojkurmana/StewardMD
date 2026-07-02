/* StewardMD — GHIS Ward Sync injection test (additive, flag-gated)
 *
 * WHY: ghis-ward.js is a drop-in module that self-injects a 🏥 Ward button
 * (#ghisBtn) + side panel (#ghisPanel), behind the `smd_ghis_ward` flag
 * (default ON). This harness drives the REAL page headlessly and asserts:
 *   (1) with the flag ON, the Ward button + #ghisPanel inject on load and
 *       window.GHIS / window.openGHIS are defined;
 *   (2) the per-doctor login screen (#ghisUserId + #ghisPassword + Keep-me-logged-in)
 *       is present, and on a non-localhost backend the ward targets /api/ghis;
 *   (3) SMD_setGhis(false) removes the button + panel + injected style instantly;
 *   (4) SMD_setGhis(true) re-injects them — fully reversible, no redeploy.
 *
 * USAGE:  node test/run-ghis-ward.mjs       (exit 0 = pass, 1 = fail)
 * Requires a local static server on $BASE (auto-spawned) and Google Chrome.
 * NOT shipped — development/test tooling only.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8802/";
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9361;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ghis-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8802";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  // Simulate the HOSTED (non-localhost) backend before any page script runs: pin
  // window.GHIS_PROXY to the same-origin Function target and record fetch URLs.
  // (On real stewardmd.in the ward auto-detects this same '/api/ghis' value; on
  // localhost it would instead pick http://localhost:3456 — the dev proxy.)
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.GHIS_PROXY='/api/ghis';window.__ghisFetches=[];(function(){window.fetch=function(u){try{window.__ghisFetches.push(String(u));}catch(e){}if(String(u).indexOf('/status')>=0)return Promise.resolve({json:function(){return Promise.resolve({connected:false});}});return Promise.resolve({json:function(){return Promise.resolve([]);}});};})();" });
  // ensure the flag is ON for this run, then load
  await call("Page.navigate", { url: BASE });
  await ev(`try{localStorage.setItem('smd_ghis_ward','1');}catch(e){} return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(400); if (await ev(`return !!document.getElementById('ghisPanel');`) === true) { ready = true; break; } }
  ok(ready, "flag ON → #ghisPanel injects on load");
  ok(await ev(`return !!document.getElementById('ghis-nofab');`) === true, "floating FAB suppressed (sidebar-only mount)");
  ok(await ev(`var b=document.getElementById('ghisBtn'); return !b || getComputedStyle(b).display==='none';`) === true, "floating 🏥 Ward FAB is hidden");
  ok(await ev(`return typeof window.openGHIS==='function' && !!window.GHIS;`) === true, "window.GHIS / window.openGHIS globals defined");
  ok(await ev(`return typeof window.SMD_setGhis==='function';`) === true, "SMD_setGhis toggle exposed");
  ok(await ev(`return !!document.querySelector('style[data-ghis]');`) === true, "GHIS stylesheet injected");
  // per-doctor login screen: id + password inputs present (replaces the old cookie paste)
  ok(await ev(`return !!document.getElementById('ghisUserId') && !!document.getElementById('ghisPassword');`) === true, "per-doctor login inputs (#ghisUserId + #ghisPassword) present");
  ok(await ev(`return !!document.getElementById('ghisRemember');`) === true, "'Keep me logged in' checkbox present");
  // backend selection: hosted target → calls hit the same-origin Cloudflare Function.
  // Seed a saved token so openGHIS verifies it via /status (the new client only
  // calls /status when a token exists; otherwise it shows the login screen).
  await ev(`try{localStorage.setItem('ghis_token','test-token');}catch(e){} try{ if(window.openGHIS) openGHIS(); }catch(e){} return 1;`); await sleep(300);
  ok(await ev(`return (window.__ghisFetches||[]).some(function(u){return u.indexOf('/api/ghis/status')>=0;}) && !(window.__ghisFetches||[]).some(function(u){return u.indexOf('localhost:3456')>=0;});`) === true, "non-localhost → ward targets /api/ghis (Cloudflare Function), not the localhost proxy");
  await ev(`try{localStorage.removeItem('ghis_token');}catch(e){} return 1;`);

  // toggle OFF → everything removed instantly
  await ev(`window.SMD_setGhis(false); return 1;`); await sleep(150);
  ok(await ev(`return !document.getElementById('ghisBtn') && !document.getElementById('ghisPanel') && !document.querySelector('style[data-ghis]');`) === true, "SMD_setGhis(false) removes button + panel + style instantly");

  // toggle ON → re-injected
  await ev(`window.SMD_setGhis(true); return 1;`);
  let back = false;
  for (let i = 0; i < 20; i++) { await sleep(200); if (await ev(`return !!document.getElementById('ghisBtn') && !!document.getElementById('ghisPanel');`) === true) { back = true; break; } }
  ok(back, "SMD_setGhis(true) re-injects the Ward button + panel (reversible)");

  console.log(`\n${fails === 0 ? "ALL GREEN — GHIS Ward Sync injects, toggles off, and re-injects" : fails + " failed"}`);
  if (fails > 0) process.exitCode = 1;
} catch (e) {
  console.log("ERR " + e.message); process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
