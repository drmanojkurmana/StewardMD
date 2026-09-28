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
  ok(await ev(`return document.getElementById('tokTrace').getAttribute('data-src').endsWith('.svg');`) === true, "trace is an SVG");

  await ev(`[].forEach.call(document.querySelectorAll('.tok-q'),function(f){f.querySelector('[data-act=ans]').click();}); return 1;`);
  await ev(`document.querySelector('[data-act=reveal]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-reveal');`), "reveal screen renders");
  ok(await ev(`var b=document.querySelectorAll('.tok-block'); return b.length===2;`) === true, "trace features and real outcome are two separate blocks (Review Focus)");

  // Spent-trial gate: must not fetch when the trial is already used.
  await ev(`localStorage.setItem("smd_tokos_v1", JSON.stringify({v:1,cards:{},conf:{},days:{},trials:{"clinic.ctg":1}})); localStorage.setItem("smd_tokos_prefs", JSON.stringify({level:"resident",lang:"en"})); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('.tok-clinic');`);
  let paywallShown = false;
  await ev(`window.__fc = 0; var of = window.fetch; window.fetch = function(){ window.__fc++; return of.apply(this, arguments); }; return 1;`);
  await ev(`window.SMD_PRO_NOTICE = { show: function(){ window.__paywall = true; } }; return 1;`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  paywallShown = await ev(`return !!window.__paywall;`);
  ok(paywallShown === true, "spent trial hits the paywall (checked before any fetch)");
  ok(await ev(`return window.__fc === 0;`) === true, "spent trial fires no new fetch");
  ok(await ev(`return !document.querySelector('.tok-clinic-view');`) === true, "spent trial does not open the clinic");

  // MBBS: 5 questions; submit disabled until all answered
  await ev(`localStorage.removeItem("smd_tokos_v1"); localStorage.setItem("smd_tokos_prefs", JSON.stringify({level:"mbbs",lang:"en",tab:"test"})); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic]');`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('.tok-q').length === 5;`), "MBBS checklist has 5 questions");
  ok(await ev(`return document.querySelector('[data-act=reveal]').disabled;`) === true, "submit disabled until every question is answered");

  // Calipers read the same before and after zoom (drag in screen space, measured in viewBox units)
  ok(await until(`return !!(TOKOS._cal && document.getElementById('tokTrace'));`), "calipers attached to the inline trace");
  const drag = async (key, bpm) => ev(`var svg=document.getElementById('tokTrace'), K=TOKOS_CALIPERS, L=TOKOS._st.session.list[TOKOS._st.session.i].c.layout;
    var hit=[].filter.call(svg.querySelectorAll('.tk-cal-hit'),function(h){return h.getAttribute('data-key')==='${key}';})[0];
    var m=svg.getScreenCTM(), from=svg.createSVGPoint(); from.x=L.padL+L.plotW/2; from.y=+hit.getAttribute('y1'); from=from.matrixTransform(m);
    var to=svg.createSVGPoint(); to.x=from.x; to.y=K.yForBpm(L,${bpm}); to=to.matrixTransform(m);
    function pe(t,p){ hit.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:7,clientX:p.x,clientY:p.y})); }
    pe('pointerdown',from); pe('pointermove',{x:from.x,y:to.y}); pe('pointerup',{x:from.x,y:to.y}); return document.getElementById('tokCalOut').textContent;`);
  await drag("y1", 160); const r1 = await drag("y2", 110);
  await ev(`TOKOS._stage.zoomBy(3); return 1;`); await sleep(300);
  await drag("y1", 160); const r2 = await drag("y2", 110);
  ok(/Range: 5[0-1] bpm/.test(r1) && r1 === r2, "caliper reads ~50 bpm at zoom 1 and zoom 3: " + r1 + " | " + r2);

  // Answering keeps the mounted trace (no refetch, same node)
  await ev(`window.__svgNode = document.getElementById('tokTrace'); return 1;`);
  await ev(`document.querySelector('.tok-q [data-act=ans]').click(); return 1;`);
  ok(await ev(`return document.getElementById('tokTrace') === window.__svgNode;`) === true, "answering a question keeps the mounted trace SVG");

  // Grading writes an FSRS card under the level's deck key
  await ev(`[].forEach.call(document.querySelectorAll('.tok-q'),function(f){f.querySelector('[data-act=ans]').click();}); return 1;`);
  await ev(`document.querySelector('[data-act=reveal]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-concord');`), "concordance table shows after submit");
  ok(await ev(`var s=JSON.parse(localStorage.getItem('smd_tokos_v1')); return Object.keys(s.cards).some(function(k){return k.indexOf('ctg.mbbs:')===0;});`) === true, "FSRS card saved under ctg.mbbs");
  ok(await ev(`return document.querySelectorAll('.tok-why li').length >= 1;`) === true, "rationale shown");
  ok(await ev(`return !/undefined|NaN/.test(document.querySelector('.tok-reveal').textContent);`) === true, "reveal shows no undefined or NaN");

  // Hindi: labels translate, clinical numbers stay ASCII
  await ev(`TOKOS._st.prefs.lang='hi'; TOKOS._render(); return 1;`);
  ok(await ev(`var t=document.querySelector('.tok-reveal').textContent; return /pH: \\d\\.\\d+/.test(t) && !/[\\u0966-\\u096F]/.test(t);`) === true, "Hindi reveal keeps pH as ASCII digits");
  ok(await ev(`var t=document.querySelector('.tok-reveal').textContent; return /जन्म का वज़न/.test(t) && !/Weight|Baseline:/.test(t);`) === true, "Hindi reveal labels are translated (R17)");
  await ev(`TOKOS._st.prefs.lang='en'; TOKOS._render(); return 1;`);

  // Offline: failed load shows an error with Try again, and recovers
  await ev(`window.__f=window.fetch; window.fetch=function(){return Promise.reject(new Error('offline'));}; TOKOS._st.cfg=null; TOKOS._st.loading=null; TOKOS.close(); TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-err [data-act=retry]');`), "offline load shows Try again");
  await ev(`window.fetch=window.__f; document.querySelector('[data-act=retry]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=clinic]');`), "Try again recovers");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
