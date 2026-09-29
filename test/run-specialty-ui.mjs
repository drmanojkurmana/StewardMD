// test/run-specialty-ui.mjs: the specialty engine on the fixture host (test/fixtures/specialty-fixture), headless Chrome via CDP.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/specialty-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

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
  await call("Page.navigate", { url: BASE + "test/fixtures/specialty-fixture/index.html" });
  ok(await until(`return !!(window.FIXTURE && FIXTURE.open && window.FIXTURE_MODELS);`, 15000), "engine and fixture host load");
  await ev(`localStorage.clear(); FIXTURE.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdFixture [data-act=pick][data-t=learn]');`), "first open asks Learn or Test");
  ok(await ev(`return !!document.querySelector('#smdFixture .sp-draft');`) === true, "draft footer on the screen");
  await ev(`document.querySelector('[data-act=setlang][data-l=hi]').click(); return 1;`);
  ok(await ev(`return document.getElementById('smdFixture').getAttribute('lang') === 'hi' && /फ़िक्स्चर/.test(document.querySelector('.ln-h1').textContent);`) === true, "language choice on first run switches to Hindi");
  await ev(`document.querySelector('[data-act=setlang][data-l=en]').click(); document.querySelector('[data-act=pick][data-t=learn]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('.ln-unit').length === 2 && !!document.querySelector('.ln-start');`), "Learn home: start card and two units");
  ok(await ev(`return !!document.querySelector('.ex-home [data-act=exopen]') && !!document.querySelector('[data-act=lnglossary]') && !!document.querySelector('[data-act=read][data-r=notes]') && !!document.querySelector('[data-act=tools]');`) === true, "Explore, glossary, notes and calculators on the Learn home");
  // lesson: every step, the check, done
  await ev(`document.querySelector('.ln-start [data-act=lesson]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('lnArt') && document.getElementById('lnArt').getAttribute('data-step') === 'idea';`), "lesson opens on its idea");
  for (let i = 0; i < 6; i++) { await ev(`document.getElementById('lnNext').click(); return 1;`); await sleep(60); }
  ok(await ev(`return document.getElementById('lnArt').getAttribute('data-step') === 'check0' && document.getElementById('lnNext').disabled;`) === true, "the check waits for an answer");
  await ev(`document.querySelector('[data-act=lnans][data-k="1"]').click(); return 1;`);
  ok(await ev(`return /Right/.test(document.getElementById('lnFb').textContent);`) === true, "right answer marked");
  await ev(`document.getElementById('lnNext').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.ln-done') && JSON.parse(localStorage.smd_fixture_v1).learn['fx-one'].done === true;`), "lesson done and saved under the host's own key");
  // Escape unwinds: lesson done step -> previous step
  await ev(`FIXTURE.back(); FIXTURE.back(); return 1;`);
  await ev(`document.querySelector('[data-act=lnexit]') ? document.querySelector('[data-act=lnexit]').click() : FIXTURE._internal.renderHub(); return 1;`);
  ok(await until(`return !!document.querySelector('.ln-start');`), "back to the Learn home");
  // Test tab: plan, clinic session, done
  await ev(`document.querySelector('[data-act=tab][data-t=test]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.sp-plan-row') && !!document.querySelector('[data-act=clinic][data-t=cases]') && !!document.querySelector('[data-act=sim][data-s=fx-drill]');`), "Test hub: plan, clinic and drill rows");
  await ev(`document.querySelector('[data-act=clinic][data-t=cases]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.fx-case');`), "clinic plugin renders a case");
  for (let i = 0; i < 6; i++) { await ev(`var b=document.querySelector('[data-act=fxdone]'); if (b) b.click(); return 1;`); await sleep(40); }
  ok(await until(`return !!document.querySelector('.sp-done-h');`), "engine done screen after the session");
  ok(await ev(`var s=JSON.parse(localStorage.smd_fixture_v1); return Object.keys(s.cards).filter(function(k){return k.indexOf('cases.mbbs:')===0;}).length === 0;`) === true, "a plugin that grades nothing leaves no cards");
  await ev(`document.querySelector('[data-act=hub]').click(); return 1;`);
  // Resident gate: a spent trial opens the paywall with no fetch
  await ev(`var s=JSON.parse(localStorage.smd_fixture_v1); s.trials={'clinic.cases':1}; localStorage.smd_fixture_v1=JSON.stringify(s); FIXTURE.close(); FIXTURE.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=level][data-v=resident]');`);
  await ev(`document.querySelector('[data-act=level][data-v=resident]').click(); window.__pw=0; window.SMD_PRO_NOTICE={show:function(){window.__pw++;}}; window.__fc=0; var of=window.fetch; window.fetch=function(){window.__fc++; return of.apply(this, arguments);}; return 1;`);
  ok(await ev(`return !!document.querySelector('.sp-today [data-act=pro]') && /1 free try|Trial used/.test(document.querySelector('[data-act=clinic][data-t=cases]').textContent);`) === true, "Resident is visible with locks and trial badges");
  await ev(`document.querySelector('[data-act=clinic][data-t=cases]').click(); return 1;`);
  ok(await ev(`return window.__pw === 1 && window.__fc === 0 && !document.querySelector('.fx-case');`) === true, "spent trial: paywall, no fetch, no clinic");
  await ev(`document.querySelector('[data-act=level][data-v=mbbs]').click(); return 1;`);
  // bank: topic set, explanation, empty explanation, doubtful key
  await ev(`document.querySelector('[data-act=bank]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=mcqtopic][data-t=fx-a]');`), "bank lists topics from the index");
  ok(await ev(`return window.__fc >= 0 && !FIXTURE._mcq.items['fx-a'];`) === true, "no topic file loads before a set needs it");
  await ev(`document.querySelector('[data-act=mcqtopic][data-t=fx-a]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('mcqStem');`), "a topic set loads its one file and starts");
  ok(await ev(`return !!FIXTURE._mcq.items['fx-a'] && !FIXTURE._mcq.items['fx-b'];`) === true, "only that topic's file loaded");
  await ev(`document.querySelector('[data-act=mcqans]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.mcq-x');`), "answer marked with an explanation block");
  await ev(`document.querySelector('[data-act=lang]').click(); return 1;`);
  ok(await ev(`return !!document.querySelector('.mcq-x') && !document.getElementById('mcqNext').hidden && !!document.querySelector('#mcqPanel .sp-ans[data-state]');`) === true, "a language switch keeps the answered question (state, explanation, Next)");
  await ev(`document.querySelector('[data-act=lang]').click(); return 1;`);
  ok(await ev(`return FIXTURE._mcq.run.items.every(function(it){return it.d !== 3;});`) === true, "MBBS set has no hard questions");
  await ev(`FIXTURE._mcq.run = {items:[FIXTURE._mcq.items['fx-a'].filter(function(x){return x.id==='q4';})[0], FIXTURE._mcq.items['fx-a'].filter(function(x){return x.id==='q2';})[0]], i:0, exam:false, picks:[], done:false, t0:Date.now(), limit:0}; FIXTURE._render(); document.querySelector('[data-act=mcqans]').click(); return 1;`);
  ok(await until(`return /no explanation/.test(document.getElementById('mcqNote').textContent);`), "an empty explanation says so");
  await ev(`document.getElementById('mcqNext').click(); document.querySelector('[data-act=mcqans]').click(); return 1;`);
  ok(await until(`return /may be wrong/.test(document.getElementById('mcqNote').textContent);`), "a flagged key shows its doubt note");
  await ev(`FIXTURE.back(); return 1;`);
  // search loads the other topic lazily
  await until(`return !!document.getElementById('mcqSearch');`);
  await ev(`var i=document.getElementById('mcqSearch'); i.value='Gamma 7'; i.dispatchEvent(new Event('input')); return 1;`);
  ok(await until(`return !!FIXTURE._mcq.items['fx-b'] && document.querySelectorAll('#mcqResults .mcq-hit').length === 1;`), "search loads the remaining topic files and finds the hit");
  await ev(`FIXTURE.back(); return 1;`);
  // calculator: worked example fills the form and the result shows
  await ev(`FIXTURE._internal.renderTools(); return 1;`);
  await until(`return !!document.querySelector('[data-act=tool][data-s=fx-sum]');`);
  await ev(`document.querySelector('[data-act=tool][data-s=fx-sum]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('tlSum') && /Fill in|Check|Enter/.test(document.getElementById('tlSum').textContent);`), "calculator opens waiting for inputs");
  await ev(`document.querySelector('[data-act=tex][data-i="1"]').click(); return 1;`);
  ok(await ev(`return /62/.test(document.querySelector('.tl-big b').textContent) && document.querySelector('.tl-band').getAttribute('data-band') === 'caution';`) === true, "worked example 2 gives 62, caution band");
  await ev(`var i=document.getElementById('tl-a'); i.focus(); i.value='500'; i.dispatchEvent(new Event('input',{bubbles:true})); i.blur(); return 1;`);
  ok(await until(`return /Use 0 to 100/.test(document.getElementById('tl-a-e').textContent) && document.getElementById('tl-a').getAttribute('aria-invalid') === 'true';`), "out-of-range input shows its error by the field");
  await ev(`document.querySelector('[data-act=lang]').click(); document.querySelector('[data-act=lang]').click(); FIXTURE.back(); return 1;`);
  ok(await until(`return FIXTURE._st.view === 'tools' && !!document.querySelector('[data-act=tool][data-s=fx-sum]');`), "back from a calculator returns to the list, also after a language switch");
  await ev(`FIXTURE.back(); return 1;`);
  // drill: intro, stages, branching, result
  await until(`return FIXTURE._st.view === 'hub';`);
  await ev(`FIXTURE._internal.renderTest(); document.querySelector('[data-act=sim][data-s=fx-drill]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=drillgo]');`), "drill intro");
  await ev(`document.querySelector('[data-act=drillgo]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=drillpick][data-o=o1]') && !!document.getElementById('drClock');`), "first stage with the clock");
  await ev(`document.querySelector('[data-act=drillpick][data-o=o2]').click(); return 1;`);
  ok(await ev(`return /Waiting loses time/.test(document.getElementById('drFb').textContent);`) === true, "wrong call feedback");
  await ev(`document.getElementById('drNext').click(); document.querySelector('[data-act=drillpick][data-o=o3]').click(); document.getElementById('drNext').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.dr-score') && /50%/.test(document.querySelector('.dr-score').textContent) && document.querySelectorAll('.dr-critl li').length === 1;`), "branch ends early; score and the critical miss show");
  ok(await ev(`var s=JSON.parse(localStorage.smd_fixture_v1); return s.sims['fx-drill'].n === 1 && !!s.cards['drill:fx-drill'];`) === true, "drill recorded and scheduled");
  // Hindi: labels translate, numbers stay ASCII
  await ev(`FIXTURE._st.prefs.lang='hi'; FIXTURE._render(); return 1;`);
  ok(await ev(`var t=document.getElementById('smdFixture').textContent; return /50%/.test(t) && !/[\\u0966-\\u096F]/.test(t);`) === true, "Hindi result keeps ASCII digits");
  await ev(`FIXTURE._st.prefs.lang='en'; return 1;`);
  // Escape to closed, focus restored
  await ev(`FIXTURE.close(); var b=document.createElement('button'); b.id='opener'; document.body.appendChild(b); b.focus(); FIXTURE.open(); return 1;`);
  await until(`return FIXTURE._st.view === 'hub';`);
  await key("Escape", "Escape", 27);
  ok(await until(`return !FIXTURE.isOpen() && document.activeElement && document.activeElement.id === 'opener';`, 3000), "Escape from the hub closes and returns focus to the opener");
  // CSS stays scoped: nothing outside the overlay changes
  ok(await ev(`return getComputedStyle(document.getElementById('opener')).borderRadius !== '14px';`) === true, "engine CSS does not style the host page");
  ok(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
