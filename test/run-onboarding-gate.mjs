/* StewardMD — onboarding-vs-quick-load gate regression.
 * Verifies index.html's auth-based gate: a NEW user (no saved account / no prior guest) sees the
 * full onboarding (intro + disclaimer + login — nothing hidden); a RETURNING user (signed in or
 * previous guest) has the intro/#splash suppressed so it's boot-splash → app. Deterministic:
 * asserts the injected <style data-smd="interstitial-gate"> which the head script decides.
 * USAGE: BASE=http://localhost:5173/ node test/run-onboarding-gate.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9489);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-onb`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
const nav = async (u) => { await call("Page.navigate", { url: u }); for (let i=0;i<60;i++){ await sleep(300); if (await ev(`return document.readyState!=="loading"`)===true) break; } await sleep(500); };
const gateStyle = `return (function(){var s=document.querySelector('style[data-smd=\\"interstitial-gate\\"]');return s?s.textContent:"";})();`;
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{Object.defineProperty(navigator,'serviceWorker',{configurable:true,get:function(){return undefined;}});}catch(e){}" });

  await nav(BASE + "?cb=0");
  // NEW user: clear all auth markers
  await ev(`["stewardmd_account","stewardmd_guest_used","smd_home_v2"].forEach(function(k){localStorage.removeItem(k);});return 1;`);
  await nav(BASE + "?cb=new");
  let g = await ev(gateStyle);
  chk("NEW user: onboarding NOT suppressed (no interstitial-gate)", g === "", "style=" + JSON.stringify(g));

  // RETURNING (signed in)
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({email:"x@y.com",type:"google"}));return 1;`);
  await nav(BASE + "?cb=signedin");
  g = await ev(gateStyle);
  chk("SIGNED-IN: intro + splash suppressed (quick load)", /#introPoster/.test(g) && /#splash/.test(g), "style=" + JSON.stringify(g));

  // RETURNING (previous guest)
  await ev(`localStorage.removeItem("stewardmd_account");localStorage.setItem("stewardmd_guest_used","1");return 1;`);
  await nav(BASE + "?cb=guest");
  g = await ev(gateStyle);
  chk("RETURNING GUEST: intro + splash suppressed too", /#introPoster/.test(g) && /#splash/.test(g), "style=" + JSON.stringify(g));

  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — new users get full onboarding; returning users get quick boot→app"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
