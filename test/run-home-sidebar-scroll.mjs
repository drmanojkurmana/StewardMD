/* Sidebar scroll-lock test (home.js).
 * app.js only slides the drawer open — it never locks the page, so on iOS a touch-drag over the
 * drawer scrolled the page behind it (web-page feel). A document touchmove guard blocks touch-scroll
 * outside the drawer's (scrollable) menu while the sidebar is open. This verifies that guard.
 * USAGE: BASE=http://localhost:8980/ node test/run-home-sidebar-scroll.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8980/").replace(/\/?$/, "/");
const PORT = 9382, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/home-sbscroll-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8980"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(400); if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SB;`) === true) { ready = true; break; } }
  ok(ready, "app boots (home.js loaded, window.SB present)");

  // helper: dispatch a cancelable touchmove on a target and report defaultPrevented
  const fire = async (sel) => ev(`
    var el = document.querySelector(${JSON.stringify(sel)}) || document.body;
    var ev = new TouchEvent("touchmove", { bubbles:true, cancelable:true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;`);

  // sidebar CLOSED → guard inactive → background touchmove NOT blocked
  ok(await fire("body") === false, "with the sidebar closed, page touch-scroll is NOT blocked");

  // open the sidebar
  await ev(`try{ if(window.SB && SB.open) SB.open(); }catch(e){} return 1;`); await sleep(400);
  ok(await ev(`var d=document.getElementById("sbDrawer"); return !!(d && d.classList.contains("open"));`) === true, "sidebar opens (#sbDrawer.open)");

  // OPEN → a touchmove OUTSIDE the drawer (the page/backdrop behind) is BLOCKED (no background scroll)
  ok(await fire("#sbBackdrop") === true || await fire("body") === true, "with the sidebar open, background touch-scroll IS blocked (guard prevents it)");

  // overscroll-behavior:contain applied to the drawer menu
  ok(await ev(`var m=document.getElementById("sbMenu"); if(!m) return "no-menu"; return getComputedStyle(m).overscrollBehaviorY || getComputedStyle(m).overscrollBehavior;`) === "contain", "the drawer menu has overscroll-behavior:contain (no scroll chaining)");

  // close → guard inactive again
  await ev(`try{ if(window.SB && SB.close) SB.close(); }catch(e){} return 1;`); await sleep(300);
  ok(await fire("body") === false, "after closing, page touch-scroll works again");

  console.log(fails === 0 ? "\nALL GREEN — sidebar scroll-lock test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
