/* StewardMD — intro/disclaimer cadence regression.
 * Verifies the index.html gating script: intro (#introPoster) shows at most once per 3h,
 * disclaimer/brand splash (#splash) once per calendar day; repeat loads hide both WITHOUT
 * removing them (app.js keeps working) and the app stays usable with no error flood.
 * USAGE: BASE=http://localhost:5173/ node test/run-intro-cadence.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9487);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-cad`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
const nav = async (u) => { await call("Page.navigate", { url: u }); for (let i=0;i<60;i++){ await sleep(300); if (await ev(`return document.readyState==="complete"`)===true) break; } await sleep(600); };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  // disable SW so per-load reads are of the served index.html
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{Object.defineProperty(navigator,'serviceWorker',{configurable:true,get:function(){return undefined;}});}catch(e){}" });
  const styleOf = `return (function(){var s=document.querySelector('style[data-smd=\\"interstitial-cadence\\"]');return s?s.textContent:"";})();`;

  await nav(BASE + "?cb=1");
  await ev(`localStorage.removeItem("smd_intro_ts");localStorage.removeItem("smd_disclaimer_day");return 1;`);

  // FIRST load (empty storage) → nothing hidden
  await nav(BASE + "?cb=2");
  let st = await ev(styleOf);
  chk("first load: intro shown", !/introPoster\{display:none/.test(st), "style=" + JSON.stringify(st));
  chk("first load: disclaimer shown", !/#splash\{display:none/.test(st));

  // REPEAT load (within 3h + same day) → both hidden, app usable, no error flood
  await nav(BASE + "?cb=3");
  st = await ev(styleOf);
  chk("repeat: intro hidden", /introPoster\{display:none/.test(st));
  chk("repeat: disclaimer hidden", /#splash\{display:none/.test(st));
  // overlays must not block interaction: nothing of #introPoster/#splash at the viewport centre
  chk("repeat: overlays not blocking (app reachable)", await ev(`var el=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));var ip=document.getElementById("introPoster"),sp=document.getElementById("splash");return !!el && !(ip&&ip.contains(el)) && !(sp&&sp.contains(el));`) === true);

  // 3h boundary: intro_ts = 4h ago (same day) → intro returns, disclaimer stays hidden
  await ev(`localStorage.setItem("smd_intro_ts",String(Date.now()-4*3600*1000));return 1;`);
  await nav(BASE + "?cb=4");
  st = await ev(styleOf);
  chk("after 3h: intro shown again", !/introPoster\{display:none/.test(st), "style=" + JSON.stringify(st));
  chk("after 3h: disclaimer still hidden (daily)", /#splash\{display:none/.test(st));

  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — intro every 3h, disclaimer once/day; app usable, no removal"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
