/* Narkē Ventilator Lab (narke-vent.js) in headless Chrome: registers on the Test hub, the lab home (levels, patients,
 * tutorials, practice), level switching hides and shows controls and readouts, a setting waits for Confirm then updates
 * the readouts and lights the cause-and-effect chain, keyboard on the dials, Draw ABG before and after, alarms open
 * their card and acknowledge, time skips change the physiology, mode picker, Learn-this-setting card, tutorial coach,
 * what-if, ABG case and dyssynchrony flows, debrief score, Hindi, both themes, reduced motion, no horizontal scroll at
 * 390 px, 44 px targets, no dashes, no uncaught errors.
 * Engine: narke-models/vent-engine.js; content: narke/vent/*.json (no scenario values are hard-coded here).
 * USAGE: PORT=<free port> CHROME_PORT=<free port> node test/run-narke-vent-ui.mjs   (SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8994) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9394), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-vent-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evp = async (e) => { const r = await call("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const key = async (k, code, vk, text) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
let W = 390, H = 844;
const size = async (w, h) => { W = w; H = h; await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 700 }); await sleep(250); };
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(350); const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const R = `var R=document.getElementById("smdNarke");`;
const click = (sel) => ev(`var b=document.querySelector('#smdNarke ${sel.replace(/'/g, "\\'")}'); if(!b) return "missing"; b.click(); return 1;`);
const noOverflow = () => ev(`${R} var s=R.querySelector('.sp-scroll'); return (s ? s.scrollWidth <= s.clientWidth + 1 : true) && document.documentElement.scrollWidth <= innerWidth;`);
const small = () => ev(`${R} var out=[]; [].forEach.call(R.querySelectorAll('button, [role=spinbutton], select, summary, a[href]'), function(b){ if (b.closest('[inert]')) return; var r=b.getBoundingClientRect(); if (!r.width || !r.height) return; if (getComputedStyle(b).visibility==='hidden') return; if (r.width < 43.5 || r.height < 43.5) out.push((b.getAttribute('data-act')||b.className||b.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height)); }); return out.length ? out.slice(0,6).join('; ') : true;`);
// A real click: scroll the target into the clear area, dispatch a mouse press at its centre, and fail if something
// else (a coach, a toast, a sticky bar) is on top of it.
const tap = async (sel) => {
  if (/\.vl-sheet/.test(sel)) await sleep(450); // a sheet slides in: tap only once it has settled (screenshots used to hide this)
  const pos = await ev(`var b=document.querySelector('#smdNarke ${sel.replace(/'/g, "\\'")}'); if(!b) return "missing"; var sc=b.closest('.sp-scroll'); if (sc) { var r0=b.getBoundingClientRect(), s0=sc.getBoundingClientRect(); if (r0.top < s0.top + 70 || r0.bottom > s0.bottom - 8) sc.scrollTop += r0.top - s0.top - s0.height/3; } var r=b.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2, h=document.elementFromPoint(x,y); return (h && (h===b || b.contains(h))) ? [x,y] : "covered by " + (h ? (h.className||h.tagName) : "nothing") + " at " + Math.round(x) + "," + Math.round(y);`);
  if (!Array.isArray(pos)) return pos;
  for (const type of ["mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x: pos[0], y: pos[1], button: "left", clickCount: 1 });
  await sleep(60); return 1;
};
const theme = (dark) => ev(`document.body.className=${dark ? '"dark"' : '""'}; return 1;`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await size(390, 844);
  await call("Page.navigate", { url: BASE });
  await until(`return !!window.NARKE_LOADER;`, 20000);
  await evp(`NARKE_LOADER.load().then(function(){return 1;})`);
  ok(await ev(`return !!(window.NARKE_MODELS && NARKE_MODELS["vent-engine"]);`) === true, "the loader brings narke-models/vent-engine.js");
  // Back from a run asks Resume later / Finish / Leave; the harness's own back leaves without saving.
  await ev(`window.__back=function(){ var l=document.querySelector('#smdNarke [data-act=vlleave]'); if (l) { l.click(); return; } NARKE.back(); l=document.querySelector('#smdNarke [data-act=vlleave]'); if (l) l.click(); }; return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._sims && NARKE._sims.some(function(x){return x.id==="ventlab";}));`, 15000), "the lab registers with host.registerSim once the engine is loaded");

  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.removeItem("smd_narke_vent");localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"mbbs",lang:"en",tab:"test"}));}catch(e){} document.body.className="dark"; document.body.innerHTML='<div id="smdNarke"></div>'; document.documentElement.style.zoom=1; NARKE.open(); return 1;`);
  // (zoom 1: the app's Display "auto fit" scales the whole app to 0.95 at phone width; targets are checked in CSS px.)
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=sim][data-s=ventlab]');`, 15000), "the Test hub lists the Ventilator Lab");
  ok(await ev(`return NARKE._sims[0].id==="ventlab" && document.querySelector('#smdNarke .sp-rows [data-act=sim]').getAttribute('data-s')==="ventlab";`) === true, "the Ventilator Lab is pinned first among Narkē Test's simulators");
  ok(await ev(`var f=document.querySelector('#smdNarke .sp-feat[data-s=ventlab]'); return !!f && f.getBoundingClientRect().top < document.querySelector('#smdNarke .sp-today').getBoundingClientRect().top;`) === true, "a featured Ventilator Lab card sits at the top of Narkē Test");
  await shot("390-dark-test-hub");
  { const r = await tap(`.sp-feat[data-s=ventlab]`); ok(r === 1, "the featured card opens the lab with a real click" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home .vl-sc');`, 15000), "the lab home opens with patient cards");
  ok(await ev(`${R} return R.querySelectorAll('.vl-levels button').length===4 && R.querySelector('.vl-levels [aria-pressed=true]').getAttribute('data-v')==='1';`) === true, "four levels, Level 1 selected by default");
  ok(await ev(`${R} return /Not a real ventilator/.test(R.querySelector('.vl-disc').textContent);`) === true, "the disclaimer is on the home screen");
  const n1 = await ev(`return document.querySelectorAll('#smdNarke .vl-sc').length;`);
  ok(await ev(`${R} return R.querySelectorAll('[data-act=vltut]').length >= 1 && !!R.querySelector('[data-act=vlwhat]') && !!R.querySelector('[data-act=vlcases]') && !!R.querySelector('[data-act=vldys]');`) === true, "tutorials, what-if, ABG cases and the dyssynchrony gallery are listed");
  ok(await ev(`${R} return R.querySelectorAll('.vl-sc .vl-mini path').length >= 2;`) === true, "each patient card carries its own pressure and flow trace from the engine");
  ok(await noOverflow() === true, "home: no horizontal scroll at 390 px");
  { const sm = await small(); ok(sm === true, "home: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await shot("390-dark-home");
  await theme(false); await shot("390-light-home"); await theme(true);

  await click(`[data-act=vllevel][data-v="3"]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-sc').length > ${n1};`), "Level 3 opens more patients (" + n1 + " at Level 1)");
  await click(`[data-act=vllevel][data-v="1"]`);
  await until(`return document.querySelectorAll('#smdNarke .vl-sc').length === ${n1};`);

  // Level 1 run
  await click(`[data-act=vlgo]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-run canvas[data-w=paw]');`), "the run opens with the ventilator waveforms");
  const k1 = await ev(`return [].map.call(document.querySelectorAll('#smdNarke .vl-set > .vl-knobs [data-knob]'), function(k){return k.getAttribute('data-knob');}).join(',');`);
  ok(/fio2/.test(k1) && /peep/.test(k1) && !/\bti\b/.test(k1) && !/trig/.test(k1), "Level 1 shows the core settings only: " + k1);
  const ro1 = await ev(`return document.querySelectorAll('#smdNarke .vl-ro-i').length;`);
  ok(await ev(`${R} return !!R.querySelector('#vlHr') && !!R.querySelector('#vlSpo2') && !!R.querySelector('#vlBp') && R.querySelectorAll('.vl-mon canvas').length===3;`) === true, "bedside monitor: HR, SpO2, BP and three traces");
  ok(await ev(`${R} return !!R.querySelector('.vl-pt .vl-h').textContent.trim() && /PBW/.test(R.querySelector('.vl-pt-who').textContent);`) === true, "patient card: diagnosis and PBW");
  ok(await ev(`${R} return R.querySelectorAll('.vl-tabs [data-act=vltab]').length===4 && getComputedStyle(R.querySelector('.vl-vent')).display==='none' && getComputedStyle(R.querySelector('.vl-monw')).display!=='none';`) === true, "390 px: the run is four tabs, Monitor open, the ventilator hidden until its tab");
  ok(await tap(`[data-act=vltab][data-t=dials]`) === 1 && await ev(`${R} return getComputedStyle(R.querySelector('.vl-vent')).display!=='none' && getComputedStyle(R.querySelector('.vl-monw')).display==='none' && getComputedStyle(R.querySelector('.vl-minimon')).display!=='none';`) === true, "the Dials tab shows the ventilator and a vitals strip, one tab open at a time");
  await sleep(150);
  ok(await ev(`${R} var c=R.querySelector('canvas[data-w=paw]'); return c.width > 100 && c.height > 40;`) === true, "waveform canvases are sized to the device");
  ok(await ev(`${R} return R.querySelector('#vlWaves').getAttribute('aria-label').length > 40;`) === true, "the waveforms have a spoken description");
  ok(await noOverflow() === true, "run: no horizontal scroll at 390 px");
  { const sm = await small(); ok(sm === true, "run: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await shot("390-dark-run-top");
  // beginner layer at Level 1
  ok(await ev(`${R} var d=R.querySelectorAll('.vl-doing .vl-ro-i'); return d.length===4 && /Air per breath/.test(R.querySelector('.vl-doing').textContent) && /VTe/.test(R.querySelector('.vl-doing').textContent);`) === true, "Level 1: 'What the ventilator is doing' shows four numbers with plain names and their clinical names");
  ok(await ev(`${R} var n=R.querySelector('.vl-next'); return !!n && /Draw ABG/.test(n.textContent);`) === true, "Level 1: the next-step line starts with drawing a baseline gas");
  ok(await ev(`${R} return !!R.querySelector('.vl-knob-s') && !!R.querySelector('.vl-what summary') && R.querySelector('.vl-story').open;`) === true, "Level 1: dials carry plain captions, the monitor explains its numbers, the story and goals are open");
  ok(await ev(`${R} return /Keep oxygen saturation/.test(R.querySelector('.vl-story').textContent) && !/Pplat/.test(R.querySelector('.vl-story').textContent);`) === true, "Level 1: goals in plain words, no Pplat");
  ok(await ev(`${R} var X=NARKE_VENT_UI.run(), m=NARKE_MODELS["vent-engine"].readout(X.s, X.set).vitals.map; return R.querySelector('#vlBp').classList.contains('abn') === (m < 65);`) === true, "NIBP is coloured only when the pressure is low");
  await tap(`[data-act=vltab][data-t=mon]`);
  await click(`.vl-next`);
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-act')==='vldraw';`) === true, "the next-step line takes the learner to Draw ABG");
  await click(`[data-act=vldraw]`);
  ok(await until(`return /dial/.test(document.querySelector('#smdNarke .vl-next').textContent);`), "after the gas the next step is to change one dial");
  ok(await ev(`${R} return R.querySelectorAll('.vl-abgt tbody tr').length===5 && !!R.querySelector('.vl-abg-d');`) === true, "Level 1 gas: five rows, each with a plain caption");
  await click(`[data-act=vltab][data-t=dials]`);
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vl-vent'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 60; return 1;`); await shot("390-dark-run-vent-l1");
  await theme(false); await shot("390-light-run-vent-l1"); await theme(true);

  // change a setting: stage, confirm, chain
  const peep0 = await ev(`return document.querySelector('#smdNarke [data-spin=peep]').getAttribute('aria-valuenow');`);
  const fio0 = +(await ev(`return document.querySelector('#smdNarke [data-spin=fio2]').getAttribute('aria-valuenow');`));
  await tap(`[data-act=vlstep][data-k=fio2][data-d="1"]`);
  ok(+(await ev(`return document.querySelector('#smdNarke [data-spin=fio2]').getAttribute('aria-valuenow');`)) === Math.floor(fio0 / 5) * 5 + 5, "Level 1: FiO2 steps in 5s (" + fio0 + " to the next 5)");
  await click(`[data-act=vlcancel]`);
  await tap(`[data-act=vlstep][data-k=peep][data-d="1"]`);
  ok(await ev(`${R} return R.querySelector('[data-knob=peep]').classList.contains('is-pend') && !!R.querySelector('[data-act=vlconfirm]');`) === true, "a change waits for Confirm, shown on the dial and in the footer");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-act')==='vlstep';`) === true, "focus stays on the stepper");
  await shot("390-dark-pending");
  await click(`[data-act=vlconfirm]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-cs[data-state=on]').length >= 3;`, 5000), "Confirm lights the cause-and-effect chain step by step");
  ok(await ev(`${R} return /PEEP/.test(R.querySelector('.vl-cs[data-step=setting] .vl-cs-t').textContent) && R.querySelector('[data-spin=peep]').getAttribute('aria-valuenow') !== "${peep0}";`) === true, "the chain names the change and the dial holds the new value");
  ok(await ev(`return !!document.querySelector('#smdNarke .vl-ovs.c-ox.hot');`) === true, "the oxygenation side marks the last change");
  ok(await until(`${R} return getComputedStyle(R.querySelector('.vl-chainw')).display!=='none' && R.querySelector('[data-act=vltab][data-t=chg]').getAttribute('aria-pressed')==='true';`, 3000), "after Confirm (and a 220 ms commit beat) the What changed tab opens on the chain");
  ok(await ev(`${R} var c=R.querySelector('#vlChain'); return c.querySelectorAll('.vl-cs-t').length===8 && !!c.querySelector('details.vl-more') && /In 30 min without your change/.test(c.querySelector('details.vl-more').textContent) && /In 30 min with it/.test(c.querySelector('details.vl-more').textContent) && !/Plateau/.test(c.querySelector('.vl-chain').textContent);`) === true, "Level 1 chain: one plain line per link; numbers in three labelled columns behind More detail");
  await sleep(2200); await shot("390-dark-chain");
  await ev(`document.querySelector('#smdNarke #vlChain details.vl-more').open=true; return 1;`); await shot("390-dark-chain-more");

  // keyboard on the dial
  await click(`[data-act=vltab][data-t=dials]`); await ev(`document.querySelector('#smdNarke [data-spin=rr]').focus(); return 1;`);
  const rr0 = +(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`));
  await key("ArrowUp", "ArrowUp", 38); await key("ArrowUp", "ArrowUp", 38);
  ok(+(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`)) === Math.floor(rr0 / 2) * 2 + 4 && await ev(`return document.activeElement.getAttribute('data-spin');`) === "rr", "arrow keys turn the rate dial (2 a step at Level 1) and keep focus");
  await key("Enter", "Enter", 13, "\r");
  ok(await until(`return !document.querySelector('#smdNarke [data-act=vlconfirm]') && document.querySelector('#smdNarke .vl-cs[data-step=setting] .vl-cs-t').textContent.indexOf('Rate')>=0 || /RR|rate/i.test(document.querySelector('#smdNarke .vl-cs[data-step=setting] .vl-cs-t').textContent);`, 4000), "Enter confirms from the dial");

  // ABG before and after, time skip
  const clock0 = await ev(`return document.getElementById('vlClock').textContent;`);
  await click(`[data-act=vldraw]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-abgt');`), "Draw ABG shows a gas");
  const pc0 = await ev(`return document.querySelector('#smdNarke .vl-ovs.c-ve .vl-ov-res dd b').textContent;`);
  await click(`[data-act=vlskip][data-k="1800"]`);
  ok(await until(`return document.getElementById('vlClock').textContent !== ${JSON.stringify(clock0)};`), "+30 min moves the sim clock");
  const pc1 = await ev(`return document.querySelector('#smdNarke .vl-ovs.c-ve .vl-ov-res dd b').textContent;`);
  ok(pc0 !== pc1, "time skip changes the physiology (PaCO2 " + pc0 + " to " + pc1 + ")");
  await click(`[data-act=vldraw]`);
  ok(await until(`return document.querySelectorAll('#vlAbg .vl-abgt thead th').length === 4 && document.querySelectorAll('#vlAbg .vl-abgt .vl-arr').length >= 5;`), "the second draw shows before, now and arrows");
  ok(await ev(`return document.querySelectorAll('#smdNarke .vl-why li').length >= 1;`) === true, "the ABG comparison explains why");
  await click(`[data-act=vltab][data-t=abg]`); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-abg");
  ok(await ev(`return document.querySelector('#smdNarke .sp-top').getBoundingClientRect().top === 0 && visualViewport.offsetTop === 0;`) === true, "scrolling to a panel keeps the top bar in place");
  ok(await ev(`${R} return /SpO2 is how full/.test(R.querySelector('.vl-abg').textContent);`) === true, "Level 1 blood gas: one line on PaO2 versus SpO2");

  // learn this setting
  await click(`[data-act=vltab][data-t=dials]`);
  await click(`[data-act=vlinfo][data-k=peep]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-lcard dt');`), "the info button opens the Learn this setting card");
  ok(await ev(`return document.activeElement && document.activeElement.id === 'vlShH' && document.querySelector('#smdNarke .sp-scroll').hasAttribute('inert');`) === true, "the sheet takes focus and the page behind is inert");
  await shot("390-dark-learn-card");
  await key("Escape", "Escape", 27);
  ok(await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap') && document.activeElement && document.activeElement.getAttribute('data-act')==='vlinfo';`), "Escape closes the card and returns focus to its button");

  // Hindi
  await click(`[data-act=lang]`);
  ok(await until(`${R} return R.getAttribute('lang')==='hi' && /[\\u0900-\\u097F]/.test(R.querySelector('.vl-chainw .vl-h').textContent);`), "Hindi switches the run screen");
  ok(await ev(`return !/[\\u0966-\\u096F]/.test(document.getElementById('smdNarke').innerText);`) === true, "Hindi uses ASCII digits");
  await click(`[data-act=vltab][data-t=mon]`); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-run-hindi");
  ok(await ev(`${R} return /[\\u0900-\\u097F]/.test(R.querySelector('.vl-tabs').textContent) && /[\\u0900-\\u097F]/.test(R.querySelector('.vl-live').textContent);`) === true, "Hindi: tabs and the time state speak Hindi");
  ok(await ev(`${R} var m=R.querySelector('.vl-mode'), t=m.querySelector('.vl-mode-t'); return getComputedStyle(t).textOverflow!=='ellipsis' && t.scrollWidth<=t.clientWidth+1 && m.getBoundingClientRect().right <= innerWidth;`) === true, "Hindi: the mode button shows its whole short title");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vl-knob-l, .vl-ro-i dt, .vl-cs-b b'), function(e){ return e.scrollWidth <= e.clientWidth + 1; });`) === true, "Hindi: dial labels, readouts and the chain fit without cutting text");
  await click(`[data-act=vltab][data-t=dials]`); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-run-hindi-vent");
  await click(`[data-act=vltab][data-t=chg]`); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-run-hindi-chain");
  await click(`[data-act=vlmode]`); await until(`return document.querySelectorAll('#smdNarke .vl-mbtn').length >= 2;`);
  await click(`[data-act=vlmpick][data-k=vc]`); await until(`return !!document.querySelector('#smdNarke .vl-mrow.on');`);
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vl-mbtn-t'), function(e){ return e.scrollWidth <= e.clientWidth + 1; }) && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vl-modes').textContent);`) === true, "Hindi mode sheet: every mode title and its note fit");
  await shot("390-dark-mode-sheet-hindi");
  await key("Escape", "Escape", 27); await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap');`);
  await click(`[data-act=lang]`);
  await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);

  // Level 3: more controls, readouts, mode picker
  await ev(`__back(); return 1;`);
  await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await click(`[data-act=vllevel][data-v="3"]`);
  await until(`return document.querySelectorAll('#smdNarke .vl-sc').length > ${n1};`);
  await click(`[data-act=vlgo]`);
  await until(`return !!document.querySelector('#smdNarke .vl-run');`);
  const k3 = await ev(`return [].map.call(document.querySelectorAll('#smdNarke .vl-set > .vl-knobs [data-knob]'), function(k){return k.getAttribute('data-knob');}).join(',');`);
  const ro3 = await ev(`return document.querySelectorAll('#smdNarke .vl-ro-i').length;`);
  ok(k3.split(",").length > k1.split(",").length && /ti/.test(k3), "Level 3 shows more settings: " + k3);
  ok(ro3 > ro1, "Level 3 shows more ventilator readouts (" + ro1 + " to " + ro3 + ")");
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vl-ro-i dt'), function(d){return d.textContent.trim().length>0;});`) === true, "every readout has a label");
  await click(`[data-act=vlmode]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-mbtn').length >= 3;`), "the mode button opens the mode list");
  await click(`[data-act=vlmpick][data-k=acpc]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-mrow.on .vl-mcard');`), "picking a mode shows its mode card");
  await shot("390-dark-mode-sheet");
  await click(`[data-act=vlmuse]`);
  await until(`return !!document.querySelector('#smdNarke [data-act=vlconfirm]');`);
  await click(`[data-act=vlconfirm]`);
  ok(await until(`return /AC-PC/.test(document.querySelector('#smdNarke .vl-mode b').textContent) && !!document.querySelector('#smdNarke [data-knob=pinsp]');`), "the new mode takes effect with its own controls (Pinsp)");

  // alarms: run until one appears (raise rate a lot to trap air or find any)
  await ev(`__back(); return 1;`);
  await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  const alarmSc = await ev(`var ids=[].map.call(document.querySelectorAll('#smdNarke [data-act=vlgo]'), function(b){return b.getAttribute('data-s');}); return ids.indexOf('asthma')>=0?'asthma':ids.indexOf('copd')>=0?'copd':ids[ids.length-1];`);
  await click(`[data-act=vlgo][data-s="${alarmSc}"]`);
  await until(`return !!document.querySelector('#smdNarke .vl-run');`);
  const VAL = `.vl-al:not([data-k=spo2Low]):not([data-k=mapLow]):not([data-k=hrHigh]):not([data-k=hrLow])`;
  for (let i = 0; i < 8 && !(await ev(`return !!document.querySelector('#smdNarke ${VAL}');`)); i++) {
    await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlconfirm]`); await sleep(200);
  }
  ok(await ev(`return !!document.querySelector('#smdNarke ${VAL}');`) === true, "a ventilator alarm appears in the alarm bar (" + alarmSc + ")");
  await shot("390-dark-alarm");
  const alId = await ev(`return document.querySelector('#smdNarke ${VAL}').getAttribute('data-k');`);
  await click(`.vl-al[data-k="${alId}"]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-acard') && !!document.querySelector('#smdNarke [data-act=vlack]');`), "the alarm opens its card with silence and acknowledge");
  ok(await ev(`return /cause|clue|Troubleshooting|intervention/i.test(document.querySelector('#smdNarke .vl-acard').textContent);`) === true, "the alarm card explains causes and the fix");
  await shot("390-dark-alarm-card");
  await click(`[data-act=vlack]`);
  ok(await until(`return !document.querySelector('#smdNarke .vl-al[data-k="${alId}"]');`), "acknowledge removes that alarm from the bar");

  // debrief
  await click(`[data-act=vlfinish]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-score b') && document.querySelectorAll('#smdNarke .vl-parts li').length >= 3;`), "Finish shows the debrief with the score breakdown");
  ok(await ev(`var X=NARKE_MODELS["vent-engine"].SCORE_MAX, sm=[].map.call(document.querySelectorAll('#smdNarke .vl-parts b small'), function(e){return e.textContent;}); return sm.length>=3 && sm.indexOf('/'+X.protection)>=0 && sm.indexOf('/'+X.oxygenation)>=0;`) === true, "debrief maxima come from the engine's SCORE_MAX");
  ok(await ev(`var sc=NARKE_VENT_UI.run().score, nul=Object.keys(sc.parts).filter(function(k){return sc.parts[k]===null;}), rows=document.querySelectorAll('#smdNarke .vl-parts li.vl-pna'); return rows.length===nul.length && [].every.call(rows, function(r){ return /Not scored/.test(r.querySelector('b').textContent) && r.querySelector('.vl-pnote').textContent.length > 10; });`) === true, "debrief: a part the run did not test says Not scored, with the reason");
  ok(await noOverflow() === true, "debrief: no horizontal scroll");
  await shot("390-dark-debrief");
  await theme(false); await shot("390-light-debrief"); await theme(true);
  await click(`[data-act=vlhome]`);
  await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // every tutorial, end to end, with "Do it for me": no step may stall. A step stalls if Next is still disabled after
  // its change is applied and the clock has been moved on twice by 30 min (observation steps must offer Next at once).
  await click(`[data-act=vllevel][data-v="1"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='1';`);
  const tutIds = await ev(`return [].map.call(document.querySelectorAll('#smdNarke [data-act=vltut]'), function(b){return b.getAttribute('data-k');}).join(',');`);
  let didDo = false, stalls = [], flats = [];
  for (const id of tutIds.split(",")) {
    if (!(await ev(`return !!document.querySelector('#smdNarke .vl-home');`))) { await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`); }
    await click(`[data-act=vltut][data-k="${id}"]`);
    if (!(await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`))) { stalls.push(id + ": coach did not open"); continue; }
    for (let step = 0; step < 20; step++) {
      const info = await ev(`var sp=document.querySelector('#smdNarke .vl-co-h span'); return sp ? sp.textContent : "";`);
      if (await ev(`return !!document.querySelector('#smdNarke [data-act=vltutdo]');`)) { await click(`[data-act=vltutdo]`); didDo = true; await sleep(120); }
      const obs = await ev(`return !document.querySelector('#smdNarke .vl-co-task');`);
      let dis = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('data-wait')==='1' ? "true" : "false";`);
      if (obs && dis === "true") { stalls.push(id + " " + info + ": an observation step does not offer Next"); break; }
      for (let w = 0; w < 2 && dis === "true"; w++) { await click(`[data-act=vlskip][data-k="1800"]`); await sleep(120); dis = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('data-wait')==='1' ? "true" : "false";`); }
      if (dis === "true") { stalls.push(id + " " + info); break; }
      if (dis === "none") break;
      const flat = await ev(`var w=[].map.call(document.querySelectorAll('#smdNarke .vl-co-wait'), function(p){return p.textContent;}).join(' '); return /barely moves/.test(w) ? w : "";`);
      if (flat) flats.push(id + " " + info + ": " + flat);
      if (id === "how-it-works" && step === 2) await shot("390-dark-tutorial");
      if (id === "vt-rr" && step === 5) { ok(await ev(`return !!document.querySelector('#smdNarke .vl-co-ok');`) === true, "vt-rr observation step (plateau up) confirms what the learner saw"); await shot("390-dark-tutorial-observe"); }
      await click(`[data-act=vltutn]`); await sleep(120);
      if (!(await ev(`return !!document.querySelector('#smdNarke .vl-coach');`))) break;
    }
    ok(await ev(`return !document.querySelector('#smdNarke .vl-coach');`) === true, "tutorial " + id + " runs to Done");
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-next');`) === true, "after " + id + " the next-step line returns");
  }
  ok(stalls.length === 0, "no tutorial step stalls" + (stalls.length ? ": " + stalls.join(" | ") : ""));
  if (flats.length) console.log("   (expected change not seen, Next offered anyway: " + flats.join(" | ") + ")");
  ok(didDo, "Do it for me applies a tutorial step's change");
  await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  ok(await ev(`return document.querySelectorAll('#smdNarke .vl-tdone').length === ${tutIds.split(",").length};`) === true, "the lab home ticks every finished tutorial");
  // Hindi tutorial coach
  await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
  await click(`[data-act=vltut][data-k="vt-rr"]`); await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`);
  for (let i = 0; i < 2; i++) { await click(`[data-act=vltutn]`); await sleep(150); }
  ok(await ev(`return /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vl-coach').textContent) && !!document.querySelector('#smdNarke [data-act=vltutdo]');`) === true, "Hindi: the tutorial coach speaks Hindi and offers Do it for me");
  await shot("390-dark-tutorial-hindi");
  await click(`[data-act=vltutx]`); await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await shot("390-dark-home-hindi");
  await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);

  // what-if
  if (!(await ev(`return !!document.querySelector('#smdNarke .vl-home');`))) { await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`); }
  await click(`[data-act=vlwhat]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-wi') && document.querySelectorAll('#smdNarke [data-act=vlwip]').length >= 1;`), "what-if lists the questions for this level");
  await click(`[data-act=vlwip]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-wi-res .vl-ba tbody tr').length === 3 && document.querySelectorAll('#smdNarke .vl-wi-res .vl-cs').length >= 6;`), "Level 1 what-if: three rows (SpO2, CO2, blood pressure) with the chain");
  ok(await ev(`var h=[].map.call(document.querySelectorAll('#smdNarke .vl-wi-res .vl-ba thead th'), function(x){return x.textContent;}).join('|'); return /Now/.test(h) && /In 30 min without your change/.test(h) && /In 30 min with it/.test(h);`) === true, "what-if columns read Now / In 30 min without your change / In 30 min with it");
  ok(await ev(`var h=document.querySelector('#smdNarke .vl-wi-h'), v=h && h.nextElementSibling; return !!v && v.classList.contains('vl-verdict') && /^(Helps|Trade off|Makes it worse|Little change):/.test(v.textContent.trim()) && v.textContent.split(/[.!?](\\s|$)/).filter(function(x){return x && x.trim();}).length === 1;`) === true, "r4 U5: a one-sentence verdict sits at the top of the what-if result");
  await sleep(2000);
  ok(await noOverflow() === true, "what-if: no horizontal scroll");
  { const sm = await small(); ok(sm === true, "what-if: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await shot("390-dark-whatif");
  await click(`[data-act=vlwid][data-v="-1"]`); await click(`[data-act=vlwigo]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-wi-h');`), "build your own what-if runs");
  await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // ABG case
  await click(`[data-act=vlcases]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-abgcard dd b');`), "the ABG case shows its gas card");
  await click(`[data-act=vlq1]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-v1') && !!document.querySelector('#smdNarke [data-act=vlq2]');`), "question 1 reveals the why and question 2");
  await click(`[data-act=vlq2]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-v2');`) && await ev(`return NARKE_MODELS["vent-engine"].caseState ? document.querySelectorAll('#smdNarke .vl-case .vl-ba tbody tr').length >= 3 : !!document.querySelector('#smdNarke .vl-case .vl-empty');`) === true, "question 2: the result gas comes from the case's own state (E.caseState), or the lab says it waits for it");
  ok(await ev(`${R} return !!R.querySelector('.vl-vig-set') && /VC|PC|PSV|CPAP|NIV|SIMV|PRVC|APRV/.test(R.querySelector('.vl-vig-set').textContent);`) === true, "the case opens with the patient and the current settings");
  ok(await ev(`${R} var v=R.querySelector('.vl-v2'); return v.classList.contains('ok') || !!R.querySelector('.vl-ans');`) === true, "a wrong answer reveals the right one");
  ok(await ev(`return !NARKE_MODELS["vent-engine"].caseState || !!document.querySelector('#smdNarke .vl-case .vl-verdict');`) === true, "r4 U5: the case answer carries a one-sentence verdict");
  ok(await noOverflow() === true, "ABG case: no horizontal scroll");
  await shot("390-dark-case");
  await click(`[data-act=vlcnext]`);
  ok(await until(`return /Case 2/.test(document.querySelector('#smdNarke .sp-title').textContent);`), "Next case moves on");
  // abg-12: a combined change (lower VT and raise the rate) must apply both settings and explain them
  { const LEARN = JSON.parse(readFileSync(join(HERE, "../narke/vent/learn.json"), "utf8")), ci = LEARN.cases.findIndex((c) => c.id === "abg-12");
    const c12 = LEARN.cases[ci], oi = c12.q2.options.findIndex((o) => o.change && o.change.also);
    // the case list follows the level (a Level 1 learner sees only the level 1 cases): Level 4 shows them all, from Case 1
    await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
    await click(`[data-act=vllevel][data-v="4"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='4';`);
    await click(`[data-act=vlcases]`); await until(`return /Case 1 /.test(document.querySelector('#smdNarke .sp-title').textContent + ' ');`);
    for (let i = 0; i < ci; i++) { await click(`[data-act=vlq1]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`); await click(`[data-act=vlq2]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlcnext]');`); await click(`[data-act=vlcnext]`); await until(`return /Case ${i + 2} /.test(document.querySelector('#smdNarke .sp-title').textContent + ' ');`); }
    await click(`[data-act=vlq1]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`);
    await click(`[data-act=vlq2][data-o="${oi}"]`);
    const S = (await evp(`Promise.resolve(NARKE_MODELS["vent-engine"].SETTINGS)`)) || {};
    const ap = !(await ev(`return !!NARKE_MODELS["vent-engine"].caseState;`)) || await until(`var a=document.querySelector('#smdNarke .vl-applied'); return !!a && a.textContent.indexOf(${JSON.stringify(S.vt.label.en)})>=0 && a.textContent.indexOf(${JSON.stringify(S.rr.label.en)})>=0 && /\\b30\\b/.test(a.textContent) && /\\b420\\b/.test(a.textContent);`);
    ok(ap, "abg-12: the combined option applies VT 420 and rate 30 together and says so: " + (await ev(`var a=document.querySelector('#smdNarke .vl-applied'); return a ? a.textContent : "none";`)));
    if (await ev(`return !!NARKE_MODELS["vent-engine"].caseState;`)) ok(await ev(`return document.querySelectorAll('#smdNarke .vl-case .vl-ba tbody tr').length >= 4 && document.querySelectorAll('#smdNarke .vl-case .vl-why li').length >= 1;`) === true, "abg-12: the combined change has a result gas and reasons");
    await shot("390-dark-case-combined"); }
  await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await click(`[data-act=vllevel][data-v="1"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='1';`);

  // dyssynchrony gallery
  await click(`[data-act=vldys]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-dcard').length === 7;`), "the gallery shows the seven dyssynchrony patterns");
  await shot("390-dark-gallery");
  await click(`[data-act=vldys1]`);
  ok(await until(`return !!document.querySelector('#smdNarke canvas[data-w=dpaw]') && /Which pattern/.test(document.getElementById('smdNarke').textContent);`), "a pattern shows its waveform and asks which pattern it is");
  const ans = await ev(`return NARKE._internal ? 1 : 0;`);
  await click(`[data-act=vldyans]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-dyv') && document.querySelectorAll('#smdNarke .vl-dys1 .vl-mcard dt').length >= 3;`), "naming it reveals the name, clue, cause and fix");
  await shot("390-dark-dys");

  // reduced motion: chain is still, waves drawn once
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await ev(`__back(); __back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await click(`[data-act=vlgo]`); await until(`return !!document.querySelector('#smdNarke .vl-run');`);
  await click(`[data-act=vlstep][data-k=fio2][data-d="-1"]`); await click(`[data-act=vlconfirm]`);
  ok(await ev(`return document.querySelectorAll('#smdNarke .vl-cs[data-state=wait]').length === 0 && document.querySelectorAll('#smdNarke .vl-cs[data-state=on]').length >= 1;`) === true, "reduced motion: the chain appears at once");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  // light theme plates
  const dk = await ev(`return getComputedStyle(document.querySelector('#smdNarke .vl-plate')).backgroundColor;`);
  await theme(false); await sleep(100);
  const lt = await ev(`return getComputedStyle(document.querySelector('#smdNarke .vl-plate')).backgroundColor;`);
  ok(dk !== lt, "dark plate " + dk + ", light paper plate " + lt);
  await shot("390-light-run-top");
  await theme(true);

  // bedside actions (E.ACTIONS / E.act), new readouts and flags
  const toHome = async () => { for (let i = 0; i < 4 && !(await ev(`return !!document.querySelector('#smdNarke .vl-home');`)); i++) { await ev(`__back(); return 1;`); await sleep(150); } };
  const goRun = async (lvl, id) => {
    await toHome(); await click(`[data-act=vllevel][data-v="${lvl}"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='${lvl}';`);
    await click(`[data-act=vlgo][data-s="${id}"]`); await until(`return !!document.querySelector('#smdNarke .vl-run');`);
    if (await ev(`return document.querySelector("#smdNarke [data-act=vllive]").getAttribute("aria-pressed")==="true";`) === true) await click(`[data-act=vllive]`); // live off: the test moves time itself (Level 1 starts paused)
  };
  const num = (sel) => ev(`var b=document.querySelector('#smdNarke ${sel}'); return b ? parseFloat(b.textContent) : null;`);
  const skip = async (k) => { await click(`[data-act=vlskip][data-k="${k}"]`); await sleep(150); };
  const lastAct = (id) => ev(`var R0=NARKE_VENT_UI.run(); return R0.log.some(function(x){return x.action==="act:${id}";});`);
  {
    await goRun(1, "postop-normal");
    ok(await ev(`var d=document.querySelector("#smdNarke .vl-bedd"); return !!d && !d.open && d.querySelectorAll("[data-act=vlbed]").length >= 3;`) === true, "Level 1: bedside actions are one folded line on the Monitor tab while no alarm suggests one (U4)");
    await goRun(2, "pneumonia");
    ok(await ev(`${R} var b=R.querySelectorAll('.vl-bed [data-act=vlbed]'), A=NARKE_MODELS["vent-engine"].ACTIONS; return b.length===Object.keys(A).length && [].every.call(b, function(x){ return x.textContent.indexOf(A[x.getAttribute('data-k')].label.en)>=0; });`) === true, "Level 2: a Bedside actions group shows every engine action with its label");
    ok(await ev(`${R} return !!R.querySelector('.vl-ro-i[data-vl-id=trapV]') && !!R.querySelector('.vl-ro-i[data-vl-id=autoPeep]') && !R.querySelector('.vl-ro-i[data-vl-id=ineffective]');`) === true, "Level 2: trapped air sits next to auto-PEEP; missed breaths wait for Level 3");
    await skip(1800);
    const pk0 = await num(`.vl-ro-i[data-vl-id=ppeak] b`);
    await click(`[data-act=vlbed][data-k=suction]`); await sleep(150);
    const pk1 = await num(`.vl-ro-i[data-vl-id=ppeak] b`);
    ok(pk1 < pk0, "suction after the secretions event lowers peak pressure (" + pk0 + " to " + pk1 + ")");
    ok(await lastAct("suction") === true, "suction is logged in the run log for the score");
    await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-bedside");
    await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
    ok(await ev(`${R} return /[\\u0900-\\u097F]/.test(R.querySelector('.vl-bed').textContent) && [].every.call(R.querySelectorAll('.vl-bedb'), function(b){ return b.scrollWidth <= b.clientWidth + 1; });`) === true, "Hindi: bedside actions speak Hindi and fit");
    await shot("390-dark-bedside-hindi");
    await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);
    { const sm = await small(); ok(sm === true, "bedside: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
    ok(await noOverflow() === true, "bedside: no horizontal scroll at 390 px");

    // trauma: a pneumothorax (timeline on) recovers only after Decompress
    await goRun(4, "trauma-contusion");
    ok(await ev(`${R} return !!R.querySelector('.vl-ro-i[data-vl-id=ineffective]') && /Missed breaths/.test(R.querySelector('.vl-ro-i[data-vl-id=ineffective] dt').textContent);`) === true, "Level 4: missed breaths per minute shows with a plain label");
    await skip(900); await skip(900);
    const sp0 = await num(`#vlSpo2`);
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-bedb.sug[data-k=decompress]');`) === true, "after the pneumothorax the alarms point at Decompress");
    await skip(1800);
    const sp1 = await num(`#vlSpo2`);
    ok(sp0 < 90 && sp1 < 90, "without decompression SpO2 stays low (" + sp0 + ", then " + sp1 + " after 30 min)");
    await click(`.vl-al`); await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-acard');`);
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-sheet [data-act=vlbed][data-k=decompress]');`) === true, "the alarm card's troubleshooting links to the Decompress action");
    await shot("390-dark-alarm-action");
    await click(`.vl-sheet [data-act=vlbed][data-k=decompress]`);
    ok(await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap') && document.querySelector('#smdNarke [data-act=vlbed][data-k=decompress]').getAttribute('aria-disabled')==='true' && /drain in place/i.test(document.querySelector('#smdNarke [data-act=vlbed][data-k=decompress]').textContent);`), "Decompress from the alarm card closes it and the drain shows as in place");
    // the transfusion is now the learner's bedside action, not a timeline event: decompress, then give blood
    ok(await ev(`return !!document.querySelector('#smdNarke #vlBedW [data-act=vlbed][data-k=blood]');`) === true, "Give blood is offered at the bedside");
    await click(`#vlBedW [data-act=vlbed][data-k=blood]`);
    ok(await lastAct("blood") === true, "the transfusion is logged in the run log");
    await skip(1800);
    const sp2 = await num(`#vlSpo2`);
    ok(sp2 >= 90 && sp2 > sp1 + 5, "after Decompress and blood SpO2 recovers (" + sp1 + " to " + sp2 + ")");
    ok(await lastAct("decompress") === true, "Decompress is logged in the run log");

    // ARDS: bag 100% shows the countdown and the off-ventilator state, then the lung has derecruited
    await goRun(4, "ards");
    await click(`[data-act=vllive]`); // live on so the countdown ticks
    await skip(300);
    const cs0 = await num(`.vl-ro-i[data-vl-id=cstat] b`);
    await click(`[data-act=vlbed][data-k=bag100]`);
    ok(await until(`var b=document.querySelector('#smdNarke .vl-bag'); return !!b && /\\d+ s left/.test(b.textContent) && /Off the ventilator/.test(b.textContent);`), "bagging shows a countdown strip and says the patient is off the ventilator");
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-al[data-k=disconnect]') && document.querySelector('#smdNarke [data-act=vlbed][data-k=bag100]').getAttribute('aria-disabled')==='true';`) === true, "while bagging the disconnect alarm sounds and Bag 100% is unavailable");
    ok(await ev(`var R0=NARKE_VENT_UI.run(), E0=NARKE_MODELS["vent-engine"], f=E0.readout(R0.s,R0.set).flags, t=document.getElementById('vlFlags').textContent; return f.some(function(x){return x.id==="bagging";}) && f.every(function(x){ return t.indexOf(x.label.en)>=0; });`) === true, "the bagging flag (and every engine flag) renders with its label");
    const c0 = await ev(`return parseInt(document.getElementById('vlBagN').textContent,10);`);
    await sleep(2300);
    const c1 = await ev(`return parseInt(document.getElementById('vlBagN').textContent,10);`);
    ok(c1 < c0, "the bagging countdown ticks (" + c0 + " to " + c1 + " s)");
    await shot("390-dark-bagging");
    await theme(false); await shot("390-light-bagging"); await theme(true);
    await click(`[data-act=vllive]`);
    await skip(300);
    const cs1 = await num(`.vl-ro-i[data-vl-id=cstat] b`);
    ok(await ev(`return !document.querySelector('#smdNarke .vl-bag');`) === true, "the countdown strip goes when bagging ends");
    ok(cs1 < cs0, "ARDS: 60 s of bagging without PEEP derecruits the lung (Cstat " + cs0 + " to " + cs1 + ")");
    ok(await lastAct("bag100") === true, "Bag 100% is logged in the run log");
    // effortsIgnored: put this run's patient (lightly sedated) on plain VC, then let the screen refresh
    ok(await ev(`var R0=NARKE_VENT_UI.run(), E0=NARKE_MODELS["vent-engine"], sc=JSON.parse(JSON.stringify(R0.sc)); sc.patient.drive.sedation=0.2; sc.timeline=[]; var s0=E0.init(sc,{mode:"vc"}); R0.s=s0; R0.set=JSON.parse(JSON.stringify(s0.settings)); document.querySelector('#smdNarke [data-act=vlskip][data-k="300"]').click(); var f=E0.readout(R0.s,R0.set).flags.filter(function(x){return x.id==="effortsIgnored";})[0]; return f ? document.getElementById('vlFlags').textContent.indexOf(f.label.en)>=0 : "no effortsIgnored flag";`) === true, "the effortsIgnored flag renders with its label in a controlled mode");
    await goRun(1, "postop-normal"); await click(`[data-act=vllive]`);
  }

  // ---- persona pass: every fix with real clicks ----
  const RU = `var X=NARKE_VENT_UI.run(), E0=NARKE_MODELS["vent-engine"];`;
  const clock = () => ev(`return NARKE_VENT_UI.run().s.t;`);
  {
    // exact time skips, and a skip during an active alarm still moves the clock and says the alarm is on
    await goRun(1, "postop-normal");
    const t0 = await clock();
    await tap(`[data-act=vlskip][data-k="900"]`);
    ok(await clock() - t0 === 900, "+15 min moves the sim clock exactly 15 min");
    ok(await ev(`return document.querySelector('#smdNarke .vl-toast.on') && /Time moved on 15 min/.test(document.querySelector('#smdNarke .vl-toast').textContent);`) === true, "the skip says how far the clock moved");
    ok(await ev(`var b=document.querySelector('#smdNarke .vl-live'); return /Time/.test(b.textContent) && /paused|running/.test(b.textContent);`) === true, "Live is a labelled state: Time running or paused");
    const tr = await tap(`.vl-toast-x`);
    ok(tr === 1 && await ev(`return !document.querySelector('#smdNarke .vl-toast.on');`) === true, "a toast can be dismissed" + (tr === 1 ? "" : ": " + tr));

    // tap the number to type a value; warnings before an extreme value; Set PEEP back from the alarm card
    await tap(`[data-act=vltab][data-t=dials]`);
    await tap(`[data-act=vltype][data-k=peep]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-type');`), "tapping a dial's number opens a number field");
    await ev(`var i=document.querySelector('#smdNarke .vl-type'); i.value='24'; return 1;`);
    await key("Enter", "Enter", 13, "\r");
    ok(await until(`return document.querySelector('#smdNarke [data-spin=peep]').getAttribute('aria-valuenow')==='24' && !!document.querySelector('#smdNarke .vl-warns li');`), "typed PEEP 24 is staged and a warning shows before Confirm");
    ok(await ev(`return /very high/.test(document.querySelector('#smdNarke .vl-warns').textContent) && /Confirm anyway/.test(document.querySelector('#smdNarke [data-act=vlconfirm]').textContent);`) === true, "the warning names the value and Confirm reads Confirm anyway");
    await shot("390-dark-warning");
    await tap(`[data-act=vlconfirm]`);
    for (let i = 0; i < 6 && !(await ev(`return !!document.querySelector('#smdNarke .vl-al[data-k=peepSetHigh], #smdNarke .vl-al[data-k=peepHigh], #smdNarke .vl-al[data-k=mapLow]');`)); i++) await tap(`[data-act=vlskip][data-k="300"]`);
    const pk = await ev(`var a=document.querySelector('#smdNarke .vl-al[data-k=peepSetHigh]') || document.querySelector('#smdNarke .vl-al[data-k=peepHigh]') || document.querySelector('#smdNarke .vl-al[data-k=mapLow]'); return a ? a.getAttribute('data-k') : "";`);
    ok(!!pk, "high PEEP raises an alarm (" + pk + ")");
    if (pk) {
      await click(`.vl-al[data-k="${pk}"]`);
      ok(await until(`var c=document.querySelector('#smdNarke .vl-sheet .vl-cause'); return !!c && /You changed PEEP from 5/.test(c.textContent) && /min ago/.test(c.textContent);`), "the alarm card opens with: You changed PEEP from 5 to 20, N min ago");
      ok(await ev(`return !!document.querySelector('#smdNarke .vl-sheet [data-act=vlsetback][data-k=peep]');`) === true, "the card offers Set PEEP back to 5 in one tap");
      await shot("390-dark-alarm-caused");
      await click(`[data-act=vltoastx]`);
      await tap(`.vl-sheet [data-act=vlsetback]`);
      ok(await until(`return document.querySelector('#smdNarke [data-spin=peep]').getAttribute('aria-valuenow')==='5';`), "Set PEEP back applies PEEP 5");
    }

    // monitor alarms persist: SpO2 below target or MAP below 65 is never "No active alarms", even after Acknowledge
    await ev(`${RU} var r=E0.readout; window.__ro=r; E0.readout=function(s,st){ var x=r.apply(this, arguments); x=JSON.parse(JSON.stringify(x)); x.vitals.map=52; x.vitals.sbp=70; x.vitals.dbp=43; return x; }; return 1;`);
    await tap(`[data-act=vlskip][data-k="300"]`);
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-al[data-k=mapLow]') && !/No active alarms/.test(document.getElementById('vlAlarms').textContent);`) === true, "MAP below 65 is a monitor alarm on the bar");
    await click(`.vl-al[data-k=mapLow]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlack]');`);
    await click(`[data-act=vlack]`);
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-al[data-k=mapLow]') && /acknowledged/.test(document.querySelector('#smdNarke .vl-al[data-k=mapLow]').textContent);`) === true, "acknowledging a monitor alarm keeps it on the bar, marked acknowledged");
    ok(await ev(`return document.getElementById('vlBp').classList.contains('abn') && /low/i.test(document.getElementById('vlBpT').textContent);`) === true, "the low NIBP is coloured and tagged low");
    await shot("390-dark-monitor-alarm");
    // arrest: sustained MAP below 40 ends the run with an arrest card and debrief
    await ev(`${RU} var r=window.__ro; E0.readout=function(){ var x=JSON.parse(JSON.stringify(r.apply(this, arguments))); x.vitals.map=35; x.vitals.spo2=45; return x; }; return 1;`);
    await tap(`[data-act=vlskip][data-k="300"]`);
    await tap(`[data-act=vlskip][data-k="300"]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-arrest');`), "two minutes of MAP below 40 ends the run with a cardiac arrest card");
    await shot("390-dark-arrest");
    await ev(`NARKE_MODELS["vent-engine"].readout=window.__ro; return 1;`);
    await click(`.vl-sheet [data-act=vlfinish]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-arrest-d') && !!document.querySelector('#smdNarke .vl-score.bad');`), "the debrief opens with the arrest and what led to it");
    ok(await ev(`var li=document.querySelectorAll('#smdNarke .vl-parts li'); return li.length >= 3 && [].every.call(li, function(l){ return !!l.querySelector('.vl-pwhy'); });`) === true, "every debrief part has its own one-line explanation");
    ok(await ev(`return /Unsafe moments/.test(document.getElementById('smdNarke').textContent) && (document.querySelectorAll('#smdNarke .vl-unsafe li').length >= 1 || !!document.querySelector('#smdNarke .vl-done .vl-empty'));`) === true, "the debrief lists unsafe moments with their times");
    await shot("390-dark-debrief-arrest");
    await theme(false); await shot("390-light-debrief-arrest"); await theme(true);

    // leave a run: Resume later keeps it; opening the patient again resumes at the same time
    await goRun(2, "pneumonia");
    await tap(`[data-act=vlskip][data-k="1800"]`);
    const tr0 = await clock();
    await ev(`NARKE.back(); return 1;`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet [data-act=vlresl]') && !!document.querySelector('#smdNarke .vl-sheet [data-act=vlfinish]') && !!document.querySelector('#smdNarke .vl-sheet [data-act=vlleave]');`), "back from a live run asks: Resume later, Finish and debrief, or Leave");
    await shot("390-dark-leave");
    await tap(`.vl-sheet [data-act=vlresl]`);
    ok(await until(`var c=document.querySelector('#smdNarke .vl-home [data-act=vlgo][data-s=pneumonia] .vl-resume'); return !!c && /Unfinished run at 0 h 30 min/.test(c.textContent);`), "the lab home shows the unfinished run with its time");
    await shot("390-dark-home-resume");
    await tap(`[data-act=vlgo][data-s=pneumonia]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-run');`) && await clock() === tr0, "opening the patient resumes the run at " + tr0 + " s");
    await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke [data-act=vlleave]');`);
    await tap(`.vl-sheet [data-act=vlleave]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-home') && !document.querySelector('#smdNarke [data-act=vlgo][data-s=pneumonia] .vl-resume');`), "Leave without saving drops the run");

    // holds, chest exam and spontaneous-mode readouts that need a hold. The engine measures a hold only on a passive
    // patient: the pneumonia patient breathes against it, so the lab says the number is not reliable and keeps none.
    await goRun(2, "pneumonia");
    await tap(`[data-act=vltab][data-t=dials]`);
    ok(await tap(`[data-act=vlhold][data-k=insp]`) === 1 && await ev(`var h=document.getElementById('vlHold').textContent; return /Inspiratory hold/.test(h) && /not reliable/.test(h) && !/Pplat/.test(h);`) === true, "Inspiratory hold on a breathing patient says the number is not reliable and shows no plateau");
    // a passive patient (post-op, sedated): the hold gives real numbers
    await goRun(2, "postop-normal");
    await tap(`[data-act=vltab][data-t=dials]`);
    ok(await tap(`[data-act=vlhold][data-k=insp]`) === 1 && await ev(`return /Inspiratory hold/.test(document.getElementById('vlHold').textContent) && /Pplat|Plateau/.test(document.getElementById('vlHold').textContent);`) === true, "Inspiratory hold shows the plateau, driving pressure and compliance");
    ok(await tap(`[data-act=vlhold][data-k=exp]`) === 1 && /Auto-PEEP|PEEP total/.test(await ev(`return document.getElementById('vlHold').textContent;`)), "Expiratory hold shows the trapped pressure");
    ok(await tap(`[data-act=vlexam]`) === 1 && await ev(`return document.querySelectorAll('#vlHold .vl-exam dl > div').length >= 3;`) === true, "Listen to the chest gives air entry, trachea, movement and added sounds");
    await ev(`var h=document.getElementById('vlHold'); h.scrollIntoView({block:"center"}); return 1;`); await shot("390-dark-holds");
    await click(`[data-act=vlmode]`); await until(`return document.querySelectorAll('#smdNarke .vl-mbtn').length >= 3;`);
    await click(`[data-act=vlmpick][data-k=psv]`); await click(`[data-act=vlmuse]`);
    await until(`return !!document.querySelector('#smdNarke [data-act=vlconfirm]');`); await click(`[data-act=vlconfirm]`);
    ok(await until(`var p=document.querySelector('#smdNarke .vl-ro-i[data-vl-id=pplat]'); return !!p && /needs a hold/.test(p.textContent);`), "PSV: plateau shows as needs a hold");
    await tap(`[data-act=vltab][data-t=dials]`); // Confirm opens the What changed tab
    ok(await tap(`[data-act=vlhold][data-k=insp]`) === 1, "PSV: the inspiratory hold button can be tapped");
    ok(await ev(`var p=document.querySelector('#smdNarke .vl-ro-i[data-vl-id=pplat]'); return !!p && !/needs a hold/.test(p.textContent) && /\\d/.test(p.textContent);`) === true, "after an inspiratory hold the plateau is measured");
    ok(await ev(`return /not scored/.test(document.querySelector('#smdNarke .vl-ro-i[data-vl-id=vte]').textContent);`) === true, "PSV: tidal volume is the patient's own (not scored)");

    // bedside action feedback: toast, log line, used state
    await goRun(2, "pneumonia");
    await click(`[data-act=vltab][data-t=mon]`);
    { const tr = await tap(`[data-act=vlbed][data-k=suction]`);
      const fb = await ev(`var t=document.querySelector('#smdNarke .vl-toast').textContent, l=document.querySelector('#smdNarke .vl-bedlog'), b=document.querySelector('#smdNarke [data-act=vlbed][data-k=suction]').textContent; return /Done:/.test(t) && !!l && /Your actions/.test(l.textContent) && /Used at/.test(b) ? true : JSON.stringify({ toast: t.slice(0, 80), log: !!l, btn: b });`);
      ok(tr === 1 && fb === true, "a bedside action gives a toast, a log line and a used-at time" + (tr === 1 ? "" : " (tap: " + tr + ")") + (fb === true ? "" : ": " + fb)); }
    ok(await ev(`var s=[].filter.call(document.querySelectorAll('#smdNarke .vl-bedb small'), function(x){return /Suggested/.test(x.textContent);}).length, a=document.querySelectorAll('#smdNarke .vl-bedb').length; return s < a;`) === true, "only matching actions are marked Suggested");
    await shot("390-dark-bed-feedback");
    { const sm = await small(); ok(sm === true, "persona screens: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
    ok(await noOverflow() === true, "persona screens: no horizontal scroll at 390 px");

    // what changed while you changed nothing: the drift line
    await ev(`${RU} var r=window.__ro; window.__n=0; E0.readout=function(){ var x=JSON.parse(JSON.stringify(r.apply(this, arguments))); window.__n++; x.vitals.spo2 -= Math.min(12, Math.floor(X.s.t/600)); return x; }; return 1;`);
    await tap(`[data-act=vlskip][data-k="1800"]`);
    ok(await ev(`return /Why is the patient changing/.test(document.getElementById('vlDrift').textContent);`) === true, "a drift with no learner change explains Why is the patient changing");
    await ev(`NARKE_MODELS["vent-engine"].readout=window.__ro; return 1;`);

    // modes: VC and AC-VC explained; trigger labels fit at 390 px
    await goRun(3, "copd");
    await tap(`[data-act=vltab][data-t=dials]`);
    await click(`[data-act=vlmode]`); await until(`return document.querySelectorAll('#smdNarke .vl-mbtn').length >= 2;`);
    ok(await ev(`var t=document.querySelector('#smdNarke .vl-modes').textContent; return /cannot trigger extra breaths/.test(t) && /trigger extra full breaths/.test(t);`) === true, "the mode list explains VC versus AC-VC");
    await shot("390-dark-modes-explained");
    await key("Escape", "Escape", 27); await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap');`);
    ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vl-optseg button'), function(b){ var r=b.getBoundingClientRect(), k=b.closest('.vl-knob').getBoundingClientRect(); return !r.width || (r.right <= k.right - 4 && b.scrollWidth <= b.clientWidth + 1); });`) === true, "390 px: the trigger type labels sit inside their card");
    await ev(`var k=document.querySelector('#smdNarke [data-knob=trigType]'); if(k) k.scrollIntoView({block:"center"}); return 1;`); await shot("390-dark-trigger");

    // gloss: a plain meaning at first use (Level 1, English and Hindi), from learn.json gloss
    await ev(`var L=NARKE_VENT_UI.learn(); window.__gl=L.gloss; L.gloss={"tidal volume":{en:"air in each breath",hi:"हर साँस की हवा"},"ventilator":{en:"breathing machine",hi:"साँस की मशीन"}}; return 1;`);
    await goRun(1, "postop-normal");
    ok(await ev(`var t=document.getElementById('smdNarke').textContent; return (t.match(/\\(breathing machine\\)/g)||[]).length === 1 || !/ventilator/i.test(document.querySelector('#smdNarke .vl-story').textContent);`) === true, "Level 1: a glossed term gets its plain meaning once, at first use");
    await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
    ok(await ev(`var t=document.getElementById('smdNarke').textContent; return /साँस की मशीन/.test(t) || !/ventilator/i.test(document.querySelector('#smdNarke .vl-story').textContent);`) === true, "Hindi: the gloss is in Hindi");
    await shot("390-dark-gloss-hindi");
    await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);
    await ev(`NARKE_VENT_UI.learn().gloss=window.__gl; return 1;`);
  }

  // ---- round 2: blockers U1, U2, U3, U5 and the beginner fixes, with real taps ----
  {
    const coachOk = () => ev(`var c=document.getElementById('vlCoach'), n=document.querySelector('#smdNarke [data-act=vltutn]'), f=document.getElementById('vlFoot'); if(!c||!n) return "no coach"; var r=n.getBoundingClientRect(), cr=c.getBoundingClientRect(), fr=f.getBoundingClientRect(); return r.height>0 && r.bottom <= fr.top + 1 && r.top >= cr.top && r.bottom <= cr.bottom + 1 && c.getBoundingClientRect().height <= innerHeight*0.56 ? true : JSON.stringify([Math.round(r.top),Math.round(r.bottom),Math.round(cr.top),Math.round(cr.bottom),Math.round(fr.top)]);`);
    // U5 setup: a saved, unfinished run on the patient the first-alarm tutorial uses
    await goRun(1, "postop-normal");
    await tap(`[data-act=vlskip][data-k="900"]`);
    await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-sheet [data-act=vlresl]');`);
    await tap(`.vl-sheet [data-act=vlresl]`);
    ok(await until(`var c=document.querySelector('#smdNarke [data-act=vlgo][data-s=postop-normal] .vl-resume'); return !!c && /0 h 15 min/.test(c.textContent);`), "U5 setup: an unfinished run on Mr Rao is saved at 0 h 15 min");
    const best0 = await ev(`try { return JSON.stringify((JSON.parse(localStorage.getItem("smd_narke_vent"))||{}).best||{}); } catch(e) { return "{}"; }`);

    // U1 + U2 + U3: "Your first alarm" in the natural order: the learner suctions from the alarm card at step 4
    await tap(`[data-act=vltut][data-k="first-alarm"]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`), "first-alarm tutorial opens");
    ok(await ev(`return NARKE_VENT_UI.run().live === false && !!document.querySelector('#smdNarke .vl-tstop');`) === true, "U8: a Level 1 run starts with the clock stopped and says so");
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const st = await ev(`return document.querySelector('#smdNarke .vl-co-ht').textContent;`);
      const c = await coachOk(); if (c !== true) steps.push(st + " Next not in view: " + c);
      if (/Step 3 /.test(st + " ")) {
        ok(await ev(`return /Open alarm limits/.test(document.querySelector('#smdNarke .vl-coach').textContent);`) === true, "U3: the alarm-limit step offers Open alarm limits in the coach");
        await tap(`[data-act=vltutshow]`); await sleep(400);
        const cov = await ev(`var k=document.querySelector('#smdNarke [data-knob=pPeakHigh]'), c=document.getElementById('vlCoach').getBoundingClientRect(), tb=document.querySelector('#smdNarke .vl-tabbar').getBoundingClientRect(), sm=document.querySelector('#smdNarke .vl-alim summary').getBoundingClientRect(); if(!k) return "no knob"; var r=k.getBoundingClientRect(); return r.height > 0 && (r.bottom <= c.top + 1) && sm.top >= tb.bottom - 1 && sm.top - tb.bottom < 60 ? true : JSON.stringify({knob:[r.top,r.bottom],coachTop:c.top,tabBottom:tb.bottom,summaryTop:sm.top});`);
        ok(cov === true, "U3 + r4 U2: Open alarm limits lands the limits card just below the tab bar, its dial clear of the coach" + (cov === true ? "" : ": " + cov));
        await shot("r2-coach-limits");
        await tap(`[data-act=vltutdo]`); await sleep(150);
      }
      if (/Step 4 /.test(st + " ")) {
        ok(await until(`return !!document.querySelector('#smdNarke .vl-al[data-k=pPeakHigh]');`, 3000), "step 4: the high pressure alarm sounds");
        await tap(`.vl-al[data-k=pPeakHigh]`);
        ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-acard');`), "the alarm card opens");
        await sleep(400);
        const card = await ev(`var a=document.querySelector('#smdNarke .vl-acard'), lead=a.querySelector('.vl-bedb.lead'), lim=a.querySelector('[data-act=vlsetback]'), first=a.querySelector('button'); return JSON.stringify({lead: lead && lead.getAttribute('data-k'), firstIsLead: first===lead, limInMore: !lim || !!lim.closest('details.vl-more'), limSec: !lim || lim.classList.contains('sec'), note: /does not fix the patient/.test(a.textContent), steps: a.querySelectorAll('.vl-now li').length, pri: a.querySelectorAll('.sp-btn.pri').length});`);
        const cj = JSON.parse(card);
        ok(cj.lead === "suction" && cj.firstIsLead, "U2: the alarm card's first, filled button is the bedside fix (Suction): " + card);
        ok(cj.limInMore && cj.limSec && cj.note && cj.pri === 0, "U2: setting the alarm limit back sits under Other causes as a plain button that says it hides the alarm: " + card);
        ok(cj.steps >= 3, "U2: the card lists what to do, in order, patient first");
        await shot("r2-alarm-card");
        await tap(`.vl-sheet .vl-bedb.lead`);
        ok(await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap') && !document.querySelector('#smdNarke .vl-al[data-k=pPeakHigh]');`), "suction from the card clears the alarm");
        { const cw = await ev(`var t=document.querySelector('#smdNarke .vl-coach').textContent, m=/went (up|down), ([\\d.]+) to ([\\d.]+)/.exec(t); if (/\\bppeak\\b/.test(t)) return "raw key: " + t; if (!m) return "no evidence line: " + t; var a=+m[2], b=+m[3]; return (m[1]==="up" ? b > a : b < a) ? true : "contradiction: " + m[0];`);
          ok(cw === true, "U6: after suction the coach's evidence still reads the change it saw, in the right direction, with labels" + (cw === true ? "" : ": " + cw)); }
      }
      if (/Step 5 /.test(st + " ")) ok(await ev(`return /already cleared/.test(document.getElementById('vlCoSay').textContent);`) === true, "U1: step 5 says the alarm is already cleared instead of narrating it");
      if (/Step 7 /.test(st + " ")) {
        ok(await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return b.getAttribute('data-wait')!=='1' && /already did this/.test(document.querySelector('#smdNarke .vl-coach').textContent);`) === true, "U1: the suction step accepts the suction already done from the alarm card; Next is open");
        await shot("r2-tut-step7");
      }
      const wait = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('data-wait');`);
      if (wait === "none") break;
      if (wait === "1") { steps.push(st + " Next waits"); break; }
      await tap(`[data-act=vltutn]`); await sleep(150);
      if (!(await ev(`return !!document.querySelector('#smdNarke .vl-coach');`))) break;
    }
    ok(steps.length === 0, "U1/U3: every first-alarm step offers Next in view, above the time row" + (steps.length ? ": " + steps.join(" | ") : ""));
    ok(await ev(`return !document.querySelector('#smdNarke .vl-coach') && !!document.querySelector('#smdNarke .vl-tutrun');`) === true, "the tutorial finishes and the run says it is practice, not saved");
    // U5: leaving the practice run neither saves over nor deletes the patient's own run, and nothing counts as a best
    await ev(`NARKE.back(); return 1;`);
    ok(await until(`return !!document.querySelector('#smdNarke .vl-home') && !document.querySelector('#smdNarke .vl-sheet-wrap');`), "back from a tutorial run goes straight home (no Resume later)");
    ok(await ev(`var c=document.querySelector('#smdNarke [data-act=vlgo][data-s=postop-normal] .vl-resume'); return !!c && /0 h 15 min/.test(c.textContent);`) === true, "U5: the patient's own saved run (0 h 15 min) is untouched by the tutorial");
    ok(await ev(`try { return JSON.stringify((JSON.parse(localStorage.getItem("smd_narke_vent"))||{}).best||{}); } catch(e) { return "{}"; }`) === best0, "U5: a tutorial adds no best score");
    await tap(`[data-act=vlfresh][data-s=postop-normal]`); await until(`return !!document.querySelector('#smdNarke .vl-run');`);

    // U11: an event card never moves the page
    await tap(`[data-act=vltab][data-t=mon]`);
    const y0 = await ev(`return document.querySelector('#smdNarke .vl-monw').getBoundingClientRect().top;`);
    await tap(`[data-act=vlskip][data-k="300"]`);
    ok(await ev(`return document.querySelector('#smdNarke .vl-toast.on') && Math.abs(document.querySelector('#smdNarke .vl-monw').getBoundingClientRect().top - ${y0}) < 1;`) === true, "U11: the event card floats; the monitor does not move when it appears");
    // U7: Dials opens on the dials, with breath size per kg PBW
    await tap(`[data-act=vltab][data-t=dials]`);
    ok(await ev(`var s=document.querySelector('#smdNarke .vl-set').getBoundingClientRect(), v=document.querySelector('#smdNarke .vl-vent').getBoundingClientRect(), p=document.querySelector('#smdNarke [data-knob=vt] .vl-perkg'); return s.top < v.top && !!p && /mL\\/kg PBW/.test(p.textContent);`) === true, "U7: the Dials tab shows the dials first, with VT in mL/kg PBW and the 6 to 8 band");
    // U10: a fast rate warns before Confirm
    for (let i = 0; i < 12 && +(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`)) < 30; i++) await click(`[data-act=vlstep][data-k=rr][data-d="1"]`);
    ok(await ev(`return /fast/.test(document.querySelector('#smdNarke .vl-warns').textContent) && /Confirm anyway/.test(document.querySelector('#smdNarke [data-act=vlconfirm]').textContent);`) === true, "U10: rate 30 warns before Confirm");
    await click(`[data-act=vlcancel]`);
    // U6: the chest exam speaks in labels, never the engine's keys
    await tap(`[data-act=vlexam]`);
    ok(await ev(`var d=[].map.call(document.querySelectorAll('#vlHold .vl-exam dt'), function(x){return x.textContent.trim();}); return d.length >= 4 && d.every(function(x){ return !/^(airEntry|trachea|wheeze|crackles|chestRise|summary)$/.test(x); });`) === true, "U6: chest exam rows have labels, not raw keys");
    // U2: the low SpO2 card (pneumonia) leads with a plan, opens its checks, and is state-aware about FiO2
    await goRun(2, "pneumonia");
    await tap(`[data-act=vlskip][data-k="300"]`);
    if (await ev(`return !!document.querySelector('#smdNarke .vl-al[data-k=spo2Low]');`)) {
      await click(`.vl-al[data-k=spo2Low]`); await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-acard');`); await sleep(400);
      ok(await ev(`var a=document.querySelector('#smdNarke .vl-acard'); return a.querySelectorAll('.vl-now li').length >= 4 && /FiO2/.test(a.textContent) && /senior/i.test(a.textContent) && !!a.querySelector('[data-act=vlbed][data-k=bag100]');`) === true, "U2: the low SpO2 card lists patient, probe, circuit, FiO2, suction, DOPE, bag and senior, with Bag 100% as a button");
      await shot("r2-spo2-card");
      await key("Escape", "Escape", 27); await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap');`);
    } else ok(true, "(pneumonia had no low SpO2 alarm at 5 min: card check skipped)");
  }

  // ================= round 4 (U1 to U10) =================
  {
    // U1: the event card docks above the footer (never over the first card under the tabs), hides after about 3 s,
    // and waits while it has focus
    await goRun(1, "postop-normal");
    await tap(`[data-act=vltab][data-t=dials]`);
    await click(`[data-act=vlskip][data-k="300"]`); await sleep(300);
    const tp = await ev(`var t=document.querySelector('#smdNarke .vl-toast.on'), tb=document.querySelector('#smdNarke .vl-tabbar'), f=document.getElementById('vlFoot'); if(!t) return "no toast"; var r=t.getBoundingClientRect(), b=tb.getBoundingClientRect(), fr=f.getBoundingClientRect(); return r.top > b.bottom + 120 && r.bottom <= fr.top + 1 ? true : JSON.stringify({toast:[r.top,r.bottom],tabBottom:b.bottom,footTop:fr.top});`);
    ok(tp === true, "r4 U1: the event card docks above the footer, clear of the first card under the tabs" + (tp === true ? "" : ": " + tp));
    await shot("r4-toast-dock");
    ok(await until(`return !document.querySelector('#smdNarke .vl-toast.on');`, 5200), "r4 U1: a short event card hides by itself after about 3 s");
    await click(`[data-act=vlskip][data-k="300"]`); await sleep(200);
    await ev(`document.querySelector('#smdNarke .vl-toast-x').focus(); return 1;`); await sleep(3600);
    ok(await ev(`return !!document.querySelector('#smdNarke .vl-toast.on');`) === true, "r4 U1: the card stays while it has focus");
    await ev(`document.querySelector('#smdNarke [data-act=vltab][data-t=dials]').focus(); return 1;`);
    ok(await until(`return !document.querySelector('#smdNarke .vl-toast.on');`, 3500), "r4 U1: and hides about 2 s after focus leaves");

    // U4: a smaller breath at the same rate warns about minute volume and offers the rate pair
    const vt0 = +(await ev(`return document.querySelector('#smdNarke [data-spin=vt]').getAttribute('aria-valuenow');`)), rr0 = +(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`));
    for (let i = 0; i < 2; i++) await click(`[data-act=vlstep][data-k=vt][data-d="-1"]`);
    const vt1 = +(await ev(`return document.querySelector('#smdNarke [data-spin=vt]').getAttribute('aria-valuenow');`)), want = Math.ceil(vt0 * rr0 / vt1);
    ok(await ev(`var w=document.querySelector('#smdNarke .vl-warns'), b=document.querySelector('#smdNarke [data-act=vlrrpair]'); return !!w && /each minute/.test(w.textContent) && !!b && b.getAttribute('data-v')==='${want}' && /Also raise rate to ${want}/.test(b.textContent);`) === true, `r4 U4: VT ${vt0} to ${vt1} at rate ${rr0} warns and offers "Also raise rate to ${want}"`);
    { const sm = await small(); ok(sm === true, "r4 U4: the warning's button is at least 44 px" + (sm === true ? "" : ": " + sm)); }
    await shot("r4-ve-pair");
    ok(await tap(`[data-act=vlrrpair]`) === 1 && await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow')==='${want}' && !document.querySelector('#smdNarke [data-act=vlrrpair]');`) === true, "r4 U4: the pair stages the rate; the minute-volume warning goes");
    await click(`[data-act=vlcancel]`);

    // U6: the next strip never says "again" when no gas was drawn before
    await click(`[data-act=vlstep][data-k=fio2][data-d="1"]`); await click(`[data-act=vlconfirm]`); await sleep(300);
    await click(`[data-act=vlskip][data-k="1800"]`); await sleep(200);
    ok(await ev(`var n=document.querySelector('#smdNarke .vl-next'); return !!n && /Draw ABG/.test(n.textContent) && !/again/.test(n.textContent);`) === true, "r4 U6: after a change with no gas drawn yet, Next says Draw ABG, not 'again'");
    await click(`[data-act=vldraw]`); await sleep(150);
    ok(await ev(`var n=document.querySelector('#smdNarke .vl-next'); return !!n && !/again|Before and Now/.test(n.textContent);`) === true, "r4 U6: after that first gas, Next neither says 'again' nor compares two gases");
    ok(await ev(`var l=NARKE._sims.filter(function(x){return x.id==="ventlab";})[0].line({n:1}); return /\\b1 run\\b/.test(l) && !/1 runs/.test(l);`) === true, "r4 U6: one finished run reads '1 run'");

    // U7: the drift line is written at paint time, in the language of the moment
    await ev(`var R0=NARKE_VENT_UI.run(); R0.drift={note:{en:"Drift test line",hi:"ड्रिफ्ट परीक्षण पंक्ति"}}; return 1;`);
    await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
    ok(await until(`var d=document.getElementById('vlDrift'); return !!d && /ड्रिफ्ट परीक्षण/.test(d.textContent);`, 3000), "r4 U7: the drift line follows a switch to Hindi");
    // Hindi bedside toast keeps its numbers
    await goRun(2, "pneumonia"); await click(`[data-act=vlcancel]`);
    await tap(`[data-act=vltab][data-t=mon]`);
    await tap(`#vlBedW [data-act=vlbed][data-k=bag100]`); await sleep(200);
    const ht = await ev(`var t=document.querySelector('#smdNarke .vl-toast.on'); return t ? t.textContent : "none";`);
    ok(/हो गया/.test(ht) && /\d+ से \d+/.test(ht), "r4 U1: the Hindi bedside card keeps the numbers: " + ht);
    await shot("r4-hindi-bed-toast");
    await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);

    // U3: alarm limits move 5 per tap, take a typed value, and keep turning while held
    await goRun(2, "postop-normal");
    await tap(`[data-act=vltab][data-t=dials]`);
    await ev(`document.querySelector('#smdNarke .vl-alim').open=true; return 1;`);
    const pk = () => ev(`return +document.querySelector('#smdNarke [data-spin=pPeakHigh]').getAttribute('aria-valuenow');`);
    const p0 = await pk(); await tap(`[data-act=vlstep][data-k=pPeakHigh][data-d="-1"]`); const p1 = await pk();
    ok(p0 - p1 === 5, `r4 U3: one tap moves the peak pressure limit by 5 (${p0} to ${p1})`);
    ok(await ev(`return /Tap the number to type it/.test(document.querySelector('#smdNarke .vl-alim').textContent);`) === true, "r4 U3: the alarm limits say they can be typed");
    await click(`[data-act=vltype][data-k=pPeakHigh]`);
    await ev(`var i=document.querySelector('#smdNarke .vl-type'); i.value='27'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1;`);
    ok(await pk() === 27, "r4 U3: tap the number and type 27");
    { const pos = await ev(`var b=document.querySelector('#smdNarke [data-act=vlstep][data-k=pPeakHigh][data-d="1"]'); b.scrollIntoView({block:'center'}); var r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2];`);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x: pos[0], y: pos[1], button: "left", clickCount: 1 }); await sleep(900);
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos[0], y: pos[1], button: "left", clickCount: 1 }); await sleep(100); }
    ok(await pk() >= 27 + 15, "r4 U3: holding + keeps turning the limit (" + (await pk()) + ")");
    { const sm = await small(); ok(sm === true, "r4 U3: limit controls are at least 44 px" + (sm === true ? "" : ": " + sm)); }
    await shot("r4-alarm-limits");
    await click(`[data-act=vlcancel]`);

    // U8: the chest exam never shows a raw key, in English or Hindi, and follows a language switch
    for (const id of ["pneumonia", "asthma"]) {
      await goRun(3, id);
      await tap(`[data-act=vltab][data-t=mon]`);
      await ev(`var b=document.querySelector('#smdNarke [data-act=vlexam]'); if (b) b.click(); return 1;`);
      const raw = `var rows=[].map.call(document.querySelectorAll('#vlHold .vl-exam dt, #vlHold .vl-exam dd'), function(x){return x.textContent.trim();}); if (rows.length < 6) return "rows " + rows.length; var bad=rows.filter(function(x){ return /\\b[a-z]+[A-Z][A-Za-z]*\\b|\\b(left|right|summary|undefined|null)\\b|^\\[|_/.test(x) && !/^(Left|Right)/.test(x); }); return bad.length ? bad.join(" | ") : true;`;
      const en = await ev(raw); ok(en === true, `r4 U8: ${id} chest exam in English has no raw keys` + (en === true ? "" : ": " + en));
      await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
      const hi = await ev(raw + ``);
      ok(hi === true && await ev(`return /[\\u0900-\\u097F]/.test(document.querySelector('#vlHold .vl-exam').textContent);`) === true, `r4 U8: ${id} chest exam in Hindi has no raw keys and is in Hindi` + (hi === true ? "" : ": " + hi));
      if (id === "pneumonia") await shot("r4-exam-hindi");
      await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);
    }

    // U10: the new tutorials run to Done by hand (the learner's own taps), and the mixed acidosis case is listed
    const handTut = async (id) => {
      await toHome(); await click(`[data-act=vllevel][data-v="1"]`);
      await tap(`[data-act=vltut][data-k="${id}"]`);
      if (!(await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`))) return id + ": no coach";
      for (let i = 0; i < 20; i++) {
        const d = JSON.parse(await ev(`var R0=NARKE_VENT_UI.run(), sp=R0.tut&&R0.tut.tu.steps[R0.tut.i]; return JSON.stringify(sp ? { d: sp.do || null, ok: R0.tut.ok, i: R0.tut.i } : { end: 1 });`));
        if (d.end) break;
        if (!d.ok && d.d) {
          if (d.d.action) { await tap(`[data-act=vltutshow]`); await sleep(500); const r = await tap(`#vlBedW [data-act=vlbed][data-k="${d.d.action}"]`); if (r !== 1) return id + " step " + (d.i + 1) + ": " + r; }
          else if (d.d.mode) { await click(`.vl-mode`); await until(`return !!document.querySelector('#smdNarke .vl-sheet [data-act=vlmpick][data-k="${d.d.mode}"]');`); await tap(`.vl-sheet [data-act=vlmpick][data-k="${d.d.mode}"]`); await tap(`.vl-sheet [data-act=vlmuse]`); await sleep(450); const r = await tap(`[data-act=vlconfirm]`); if (r !== 1) return id + " mode confirm: " + r; }
          else if (d.d.key != null) {
            await tap(`[data-act=vltutshow]`); await sleep(500);
            for (let g = 0; g < 40; g++) { const v = +(await ev(`return document.querySelector('#smdNarke [data-spin="${d.d.key}"]').getAttribute('aria-valuenow');`)); if (v === d.d.to) break; await click(`[data-act=vlstep][data-k="${d.d.key}"][data-d="${v < d.d.to ? 1 : -1}"]`); }
            const r = await tap(`[data-act=vlconfirm]`); if (r !== 1) return id + " confirm: " + r;
          }
          await sleep(200);
        }
        let wait = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('data-wait')==='1' ? "1" : "0";`);
        for (let w = 0; w < 2 && wait === "1"; w++) { await click(`[data-act=vlskip][data-k="1800"]`); await sleep(150); wait = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('data-wait')==='1' ? "1" : "0";`); }
        if (wait === "1") return id + " step " + (d.i + 1) + ": Next still waits";
        if (wait === "none") break;
        const r = await tap(`[data-act=vltutn]`); if (r !== 1) return id + " Next: " + r;
        await sleep(150);
        if (!(await ev(`return !!document.querySelector('#smdNarke .vl-coach');`))) break;
      }
      return (await ev(`return !document.querySelector('#smdNarke .vl-coach');`)) ? true : id + ": did not finish";
    };
    for (const id of ["low-spo2", "disconnect", "apnoea-ps"]) { const r = await handTut(id); ok(r === true, `r4 U10: tutorial ${id} runs to Done by hand` + (r === true ? "" : ": " + r)); }
    await toHome(); await click(`[data-act=vllevel][data-v="2"]`);
    await click(`[data-act=vltut][data-k="low-spo2"]`); await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`);
    for (let i = 0; i < 6; i++) { if (await ev(`return !!document.querySelector('#smdNarke [data-act=vltutdo]');`)) await click(`[data-act=vltutdo]`); await click(`[data-act=vltutn]`); await sleep(150); }
    await shot("r4-tut-lowspo2");
    await theme(false); await shot("r4-tut-lowspo2-light"); await theme(true);
    await click(`[data-act=vltutx]`);
    { const LEARN = JSON.parse(readFileSync(join(HERE, "../narke/vent/learn.json"), "utf8"));
      const c15 = LEARN.cases.find((c) => c.id === "abg-15");
      ok(!!c15 && /mixed respiratory and metabolic acidosis/.test(c15.q1.options[c15.q1.answer].en) && /mixed/.test(c15.q1.options[c15.q1.answer].hi), "r4 U10: a combined hypoxia and hypercapnia case names mixed acidosis (en + hi)");
      const ci = LEARN.cases.filter((c) => (c.level || 1) <= 2).findIndex((c) => c.id === "abg-15");
      await toHome(); await click(`[data-act=vllevel][data-v="2"]`); await click(`[data-act=vlcases]`); await until(`return /Case 1 /.test(document.querySelector('#smdNarke .sp-title').textContent + ' ');`);
      for (let i = 0; i < ci; i++) { await click(`[data-act=vlq1]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`); await click(`[data-act=vlq2]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlcnext]');`); await click(`[data-act=vlcnext]`); await until(`return /Case ${i + 2} /.test(document.querySelector('#smdNarke .sp-title').textContent + ' ');`); }
      await click(`[data-act=vlq1][data-o="${c15.q1.answer}"]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`);
      await click(`[data-act=vlq2][data-o="${c15.q2.answer}"]`); await until(`return !!document.querySelector('#smdNarke .vl-v2');`);
      ok(await ev(`var v=document.querySelector('#smdNarke .vl-case .vl-verdict'); return !!v && /^Helps:/.test(v.textContent.trim()) && /PaCO2/.test(v.textContent) && /SpO2/.test(v.textContent);`) === true, "r4 U10 + U5: abg-15's keyed answer reads 'Helps' and names CO2 and SpO2: " + (await ev(`var v=document.querySelector('#smdNarke .vl-case .vl-verdict'); return v ? v.textContent : "none";`)));
      ok(await noOverflow() === true, "r4: the mixed acidosis case has no horizontal scroll");
      await shot("r4-case-mixed");
      await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
      await shot("r4-case-mixed-hindi");
      await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`); }
    await toHome(); await click(`[data-act=vllevel][data-v="1"]`);
  }

  // the tutorial coach: one line when collapsed, docked so its target is never under it, Next says what to press
  for (const [w, h] of [[390, 844], [1280, 860]]) {
    await size(w, h);
    await toHome(); await click(`[data-act=vllevel][data-v="1"]`);
    await tap(`[data-act=vltut][data-k="fio2-peep"]`);
    await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`);
    let guard = 0;
    while (guard++ < 8 && !(await ev(`return !!document.querySelector('#smdNarke [data-act=vltutdo]');`))) { await click(`[data-act=vltutn]`); await sleep(120); }
    ok(await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'), n=document.getElementById('vlCoNeed'); return b.getAttribute('data-wait')==='1' && !!n && /Your turn/.test(n.textContent) && !/First:/.test(document.querySelector('#smdNarke .vl-coach').textContent) && !/Set Set/.test(document.querySelector('#smdNarke .vl-coach').textContent);`) === true, w + " px: a waiting Next says what to press first, and no 'Set Set'");
    await tap(`[data-act=vltutn]`); await sleep(700); // the waiting Next scrolls its control into view smoothly
    const cov = await ev(`var c=document.getElementById('vlCoach').getBoundingClientRect(), hl=[].filter.call(document.querySelectorAll('#smdNarke .vl-hl, #smdNarke [data-knob].vl-chg'), function(e){ var r=e.getBoundingClientRect(); return r.width && r.height; }); if (!hl.length) hl=[document.querySelector('#smdNarke .vl-knob')]; return hl.every(function(e){ var r=e.getBoundingClientRect(); return r.bottom <= c.top + 1 || r.right <= c.left + 1 || r.top >= c.bottom - 1; }) ? true : JSON.stringify([c.top, c.left, hl[0].getBoundingClientRect().top, hl[0].getBoundingClientRect().bottom]);`);
    ok(cov === true, w + " px: the coach never covers the highlighted target" + (cov === true ? "" : ": " + cov));
    ok(await ev(`var c=document.getElementById('vlCoach').getBoundingClientRect(); return ${w < 1000} ? c.height <= innerHeight * 0.56 : c.left > innerWidth - 400;`) === true, w + " px: the coach is " + (w < 1000 ? "a sheet of at most 55 % of the screen" : "docked at the right"));
    await shot(w + "-dark-coach");
    await theme(false); await shot(w + "-light-coach"); await theme(true);
    ok(await tap(`[data-act=vlcomin]`) === 1 && await ev(`var c=document.getElementById('vlCoach'); return c.classList.contains('min') && c.getBoundingClientRect().height <= 64;`) === true, w + " px: the coach collapses to one line");
    await shot(w + "-dark-coach-min");
    await tap(`[data-act=vlcomin]`);
    await click(`[data-act=vltutx]`);
  }
  await size(390, 844);
  await toHome();
  ok(await ev(`return NARKE._sims.filter(function(x){return x.id==="ventlab";})[0].line(null).indexOf("tutorials") >= 0;`) === true, "the Narkē Test row counts finished tutorials as progress");

  // tablet and desktop layouts, both themes (the run must be open: the checks above leave the lab home showing)
  await goRun(2, "pneumonia");
  for (const [w, h] of [[768, 1024], [1280, 860]]) {
    await size(w, h);
    ok(await noOverflow() === true, w + " px: no horizontal scroll on the run");
    const cols = await ev(`var a=document.querySelector('#smdNarke .vl-colA').getBoundingClientRect(), b=document.querySelector('#smdNarke .vl-colB').getBoundingClientRect(); return a.left < b.left && Math.abs(a.top - b.top) < 4 ? true : [a.left,a.top,a.width,b.left,b.top,b.width].map(Math.round).join(",");`);
    ok(cols === true, w + " px: the run lays out in columns" + (cols === true ? "" : ": " + cols));
    await ev(`var t=document.querySelector(".vl-toast"); if (t) t.classList.remove("on"); document.querySelector("#smdNarke .sp-scroll").scrollTop=0; return 1;`);
    await shot(w + "-dark-run"); await theme(false); await shot(w + "-light-run"); await theme(true);
  }
  await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  for (const [w, h] of [[768, 1024], [1280, 860]]) { await size(w, h); await shot(w + "-dark-home"); await theme(false); await shot(w + "-light-home"); await theme(true); }
  await size(1280, 860);
  // resident path: Level 4 on desktop, a sick patient, after a change
  await click(`[data-act=vllevel][data-v="4"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='4';`);
  await shot("1280-dark-home-l4");
  { const sc4 = await ev(`var ids=[].map.call(document.querySelectorAll('#smdNarke [data-act=vlgo]'), function(b){return b.getAttribute('data-s');}); return ids.indexOf('ards')>=0?'ards':ids[ids.length-1];`);
    await click(`[data-act=vlgo][data-s="${sc4}"]`); await until(`return !!document.querySelector('#smdNarke .vl-run');`); }
  ok(await ev(`${R} return !R.querySelector('.vl-next') && !R.querySelector('.vl-doing') && R.querySelectorAll('.vl-ro-i').length >= 12;`) === true, "Level 4: no beginner strip or next-step line, the full readout grid");
  await click(`[data-act=vlstep][data-k=peep][data-d="1"]`); await click(`[data-act=vlconfirm]`); await sleep(2200);
  await ev(`var t=document.querySelector(".vl-toast"); if (t) t.classList.remove("on"); document.querySelector("#smdNarke .sp-scroll").scrollTop=0; return 1;`);
  ok(await noOverflow() === true, "Level 4 desktop: no horizontal scroll");
  await shot("1280-dark-run-l4"); await theme(false); await shot("1280-light-run-l4"); await theme(true);
  await ev(`__back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await click(`[data-act=vllevel][data-v="1"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='1';`);
  await click(`[data-act=vlwhat]`); await until(`return !!document.querySelector('#smdNarke .vl-wi');`);
  await click(`[data-act=vlwip]`); await sleep(2200); await shot("1280-dark-whatif"); await theme(false); await shot("1280-light-whatif"); await theme(true);
  await ev(`__back(); return 1;`);
  await size(390, 844);

  const txt = await ev(`return document.getElementById("smdNarke").innerText;`), dm = /[\s\S]{0,60}[–—][\s\S]{0,60}/.exec(txt);
  ok(!dm, "no em or en dash on the lab screens" + (dm ? ": " + dm[0] : ""));
  // The harness empties the app's DOM, so the app's own Escape handler (app.js closeModal) can throw; not the lab's.
  const own = errors.filter((x) => !/closeModal/.test(x));
  ok(own.length === 0, "no uncaught errors" + (own.length ? ": " + own.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē Ventilator Lab UI" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
