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
const key = async (k, code, vk, text) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
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
  // Re-rendering the same view keeps focus on the control that caused it (not the back button)
  await ev(`document.querySelector('[data-act=lang]').focus(); return 1;`); await key("Enter", "Enter", 13, "\r");
  ok(await until(`return document.documentElement && document.querySelector('#smdTokos').getAttribute('lang') === 'hi';`), "language toggle works from the keyboard");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-act') === 'lang';`) === true, "focus stays on the language toggle after it re-renders");
  await key("Enter", "Enter", 13, "\r");
  ok(await until(`return !document.querySelector('#smdTokos').hasAttribute('lang');`), "language toggles back to English");
  // Same tick as the click: the trace (and syncCal) has not mounted yet, so this reads the first markup.
  const steps0 = await ev(`document.querySelector('[data-act=clinic]').click(); return [].map.call(document.querySelectorAll('[data-act=nudge]'), function(b){ return b.getAttribute('aria-label') + '|' + b.textContent; }).join(';');`);
  ok(steps0 === "Move line 1 down 1 bpm|\u22121bpm;Move line 1 up 1 bpm|+1bpm", "caliper steppers carry text and an aria-label in the first markup: " + steps0);
  ok(await until(`return document.querySelectorAll('.tok-q').length === 5;`), "MBBS checklist has 5 questions");
  ok(await ev(`return document.querySelector('[data-act=reveal]').disabled;`) === true, "submit disabled until every question is answered");

  // Calipers read the same before and after zoom (drag in screen space, measured in viewBox units)
  ok(await until(`return !!(TOKOS._cal && document.getElementById('tokTrace'));`), "calipers attached to the inline trace");
  ok(await ev(`var t=document.getElementById('tokCalOut').textContent; return !/Range|Span/.test(t) && /Drag a line/.test(t);`) === true, "calipers start neutral: a prompt, no verdict, before the learner measures");
  ok(await ev(`var L=TOKOS._st.session.list[TOKOS._st.session.i].c.layout, s=TOKOS._cal.state(); return Math.abs(s.y1-TOKOS_CALIPERS.yForBpm(L,160))>1 && Math.abs(s.y2-TOKOS_CALIPERS.yForBpm(L,110))>1;`) === true, "calipers do not start on the 110/160 band");
  // Keyboard only: line 1 stepper, focus + Enter three times
  await ev(`document.querySelector('[data-act=nudge][data-d="1"]').focus(); return 1;`);
  for (let i = 0; i < 3; i++) await key("Enter", "Enter", 13, "\r");
  const rk = await ev(`return document.getElementById('tokCalOut').textContent;`);
  ok(/^Range: 19 bpm/.test(rk), "keyboard stepper (focus + Enter) moves line 1 and updates the readout: " + rk);
  ok(await ev(`return document.querySelector('[data-act=nudge][data-d="1"]').getAttribute('aria-label') === 'Move line 1 up 1 bpm';`) === true, "stepper carries a localized aria-label");
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

  // Escape unwinds one layer: reveal -> hub, then hub -> closed
  // app.js closes its modals on every Escape; this harness wiped <body>, so give it the stubs it expects.
  await ev(`(typeof MODAL_IDS !== 'undefined' ? MODAL_IDS : []).concat('modalBackdrop').forEach(function(id){ if(!document.getElementById(id)){ var d=document.createElement('div'); d.id=id; d.hidden=true; document.body.appendChild(d); } }); document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1;`);
  await key("Escape", "Escape", 27);
  ok(await until(`return TOKOS.isOpen() && TOKOS._st.view === 'hub' && !!document.querySelector('.tok-clinic');`, 3000), "Escape from the reveal returns to the hub");
  await key("Escape", "Escape", 27);
  ok(await until(`return !TOKOS.isOpen();`, 3000), "Escape from the hub closes Tokós");
  await ev(`TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic]');`);

  // Offline: failed load shows an error with Try again, and recovers
  await ev(`window.__f=window.fetch; window.fetch=function(){return Promise.reject(new Error('offline'));}; TOKOS._st.cfg=null; TOKOS._st.loading=null; TOKOS.close(); TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-err [data-act=retry]');`), "offline load shows Try again");
  await ev(`window.fetch=window.__f; document.querySelector('[data-act=retry]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=clinic]');`), "Try again recovers");

  // A fetched SVG with anything scriptable is refused and the trace error with Try again shows instead
  await ev(`localStorage.removeItem("smd_tokos_v1"); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic]');`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  await until(`return !!TOKOS._cal;`);
  await ev(`var c=TOKOS._st.session.list[0].c; window.__good=TOKOS._st.svg[c.svg]; TOKOS._st.svg[c.svg]='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onclick="window.__pwn=1"/></svg>'; TOKOS._render(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-err-trace [data-act=retrace]');`), "an SVG with an on* attribute is refused (trace error + Try again)");
  await ev(`var c=TOKOS._st.session.list[0].c; TOKOS._st.svg[c.svg]=window.__good; document.querySelector('[data-act=retrace]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('tokTrace');`), "Try again mounts the trace");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
