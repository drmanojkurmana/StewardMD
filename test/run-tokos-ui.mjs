// test/run-tokos-ui.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.TOKOS_CORE && window.TOKOS_DATA && window.TOKOS_STAGE);`, 15000), "core/data/stage libraries load");

  await ev(`try{localStorage.removeItem("smd_tokos_v1");localStorage.removeItem("smd_tokos_prefs");}catch(e){} document.body.innerHTML='<div id="smdTokos"></div>'; return 1;`);
  await ev(`TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-clinic');`, 10000), "hub renders the CTG clinic entry");

  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('tokTrace');`), "clinic opens with a trace image");
  ok(await ev(`return document.getElementById('tokTrace').src.indexOf('.svg') > -1;`) === true, "trace is an SVG");

  await ev(`document.querySelector('[data-act=reveal]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-reveal');`), "reveal screen renders");
  ok(await ev(`var b=document.querySelectorAll('.tok-block'); return b.length===2;`) === true, "trace features and real outcome are two separate blocks (Review Focus)");

  // Spent-trial gate: must not fetch when the trial is already used.
  await ev(`localStorage.setItem("smd_tokos_v1", JSON.stringify({v:1,cards:{},conf:{},days:{},trials:{"clinic.ctg":1}})); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('.tok-clinic');`);
  let paywallShown = false;
  await ev(`window.__fc = 0; var of = window.fetch; window.fetch = function(){ window.__fc++; return of.apply(this, arguments); }; return 1;`);
  await ev(`window.SMD_PRO_NOTICE = { show: function(){ window.__paywall = true; } }; return 1;`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  paywallShown = await ev(`return !!window.__paywall;`);
  ok(paywallShown === true, "spent trial hits the paywall (checked before any fetch)");
  ok(await ev(`return window.__fc === 0;`) === true, "spent trial fires no new fetch");
  ok(await ev(`return !document.querySelector('.tok-clinic-view');`) === true, "spent trial does not open the clinic");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
