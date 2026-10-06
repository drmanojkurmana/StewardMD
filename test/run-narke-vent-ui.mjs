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
  ok(await until(`return !!(window.NARKE && NARKE._sims && NARKE._sims.some(function(x){return x.id==="ventlab";}));`, 15000), "the lab registers with host.registerSim once the engine is loaded");

  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.removeItem("smd_narke_vent");localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"mbbs",lang:"en",tab:"test"}));}catch(e){} document.body.className="dark"; document.body.innerHTML='<div id="smdNarke"></div>'; document.documentElement.style.zoom=1; NARKE.open(); return 1;`);
  // (zoom 1: the app's Display "auto fit" scales the whole app to 0.95 at phone width; targets are checked in CSS px.)
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=sim][data-s=ventlab]');`, 15000), "the Test hub lists the Ventilator Lab");
  await click(`[data-act=sim][data-s=ventlab]`);
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
  ok(await ev(`${R} var c=R.querySelector('canvas[data-w=paw]'); return c.width > 100 && c.height > 40;`) === true, "waveform canvases are sized to the device");
  ok(await ev(`${R} return R.querySelector('#vlWaves').getAttribute('aria-label').length > 40;`) === true, "the waveforms have a spoken description");
  ok(await noOverflow() === true, "run: no horizontal scroll at 390 px");
  { const sm = await small(); ok(sm === true, "run: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await shot("390-dark-run-top");
  // beginner layer at Level 1
  ok(await ev(`${R} var d=R.querySelectorAll('.vl-doing .vl-ro-i'); return d.length===4 && /Air per breath/.test(R.querySelector('.vl-doing').textContent) && /VTe/.test(R.querySelector('.vl-doing').textContent);`) === true, "Level 1: 'What the ventilator is doing' shows four numbers with plain names and their clinical names");
  ok(await ev(`${R} var n=R.querySelector('.vl-next'); return !!n && /Draw ABG/.test(n.textContent);`) === true, "Level 1: the next-step line starts with drawing a baseline gas");
  ok(await ev(`${R} return !!R.querySelector('.vl-knob-s') && !!R.querySelector('.vl-what summary') && R.querySelector('.vl-story').open;`) === true, "Level 1: dials carry plain captions, the monitor explains its numbers, the story and goals are open");
  await click(`.vl-next`);
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-act')==='vldraw';`) === true, "the next-step line takes the learner to Draw ABG");
  await click(`[data-act=vldraw]`);
  ok(await until(`return /dial/.test(document.querySelector('#smdNarke .vl-next').textContent);`), "after the gas the next step is to change one dial");
  ok(await ev(`${R} return R.querySelectorAll('.vl-abgt tbody tr').length===5 && !!R.querySelector('.vl-abg-d');`) === true, "Level 1 gas: five rows, each with a plain caption");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vl-vent'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12; return 1;`); await shot("390-dark-run-vent-l1");
  await theme(false); await shot("390-light-run-vent-l1"); await theme(true);

  // change a setting: stage, confirm, chain
  const peep0 = await ev(`return document.querySelector('#smdNarke [data-spin=peep]').getAttribute('aria-valuenow');`);
  await click(`[data-act=vlstep][data-k=peep][data-d="1"]`);
  ok(await ev(`${R} return R.querySelector('[data-knob=peep]').classList.contains('is-pend') && !!R.querySelector('[data-act=vlconfirm]');`) === true, "a change waits for Confirm, shown on the dial and in the footer");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-act')==='vlstep';`) === true, "focus stays on the stepper");
  await shot("390-dark-pending");
  await click(`[data-act=vlconfirm]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-cs[data-state=on]').length >= 3;`, 5000), "Confirm lights the cause-and-effect chain step by step");
  ok(await ev(`${R} return /PEEP/.test(R.querySelector('.vl-cs[data-step=setting] .vl-cs-t').textContent) && R.querySelector('[data-spin=peep]').getAttribute('aria-valuenow') !== "${peep0}";`) === true, "the chain names the change and the dial holds the new value");
  ok(await ev(`return !!document.querySelector('#smdNarke .vl-ovs.c-ox.hot');`) === true, "the oxygenation side marks the last change");
  await sleep(2200); await shot("390-dark-chain");

  // keyboard on the dial
  await ev(`document.querySelector('#smdNarke [data-spin=rr]').focus(); return 1;`);
  const rr0 = +(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`));
  await key("ArrowUp", "ArrowUp", 38); await key("ArrowUp", "ArrowUp", 38);
  ok(+(await ev(`return document.querySelector('#smdNarke [data-spin=rr]').getAttribute('aria-valuenow');`)) === rr0 + 2 && await ev(`return document.activeElement.getAttribute('data-spin');`) === "rr", "arrow keys turn the rate dial and keep focus");
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
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-abgt thead th').length === 4 && document.querySelectorAll('#smdNarke .vl-abgt .vl-arr').length >= 5;`), "the second draw shows before, now and arrows");
  ok(await ev(`return document.querySelectorAll('#smdNarke .vl-why li').length >= 1;`) === true, "the ABG comparison explains why");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vl-abg'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12; return 1;`); await shot("390-dark-abg");
  ok(await ev(`return document.querySelector('#smdNarke .sp-top').getBoundingClientRect().top === 0 && visualViewport.offsetTop === 0;`) === true, "scrolling to a panel keeps the top bar in place");

  // learn this setting
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
  await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("390-dark-run-hindi");
  ok(await ev(`${R} var m=R.querySelector('.vl-mode'), t=m.querySelector('.vl-mode-t'); return getComputedStyle(t).textOverflow!=='ellipsis' && t.scrollWidth<=t.clientWidth+1 && m.getBoundingClientRect().right <= innerWidth;`) === true, "Hindi: the mode button shows its whole short title");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vl-knob-l, .vl-ro-i dt, .vl-cs-b b'), function(e){ return e.scrollWidth <= e.clientWidth + 1; });`) === true, "Hindi: dial labels, readouts and the chain fit without cutting text");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vl-vent'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12; return 1;`); await shot("390-dark-run-hindi-vent");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vl-chainw'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12; return 1;`); await shot("390-dark-run-hindi-chain");
  await click(`[data-act=vlmode]`); await until(`return document.querySelectorAll('#smdNarke .vl-mbtn').length >= 2;`);
  await click(`[data-act=vlmpick][data-k=vc]`); await until(`return !!document.querySelector('#smdNarke .vl-mrow.on');`);
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vl-mbtn-t'), function(e){ return e.scrollWidth <= e.clientWidth + 1; }) && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vl-modes').textContent);`) === true, "Hindi mode sheet: every mode title and its note fit");
  await shot("390-dark-mode-sheet-hindi");
  await key("Escape", "Escape", 27); await until(`return !document.querySelector('#smdNarke .vl-sheet-wrap');`);
  await click(`[data-act=lang]`);
  await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);

  // Level 3: more controls, readouts, mode picker
  await ev(`NARKE.back(); return 1;`);
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
  await ev(`NARKE.back(); return 1;`);
  await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  const alarmSc = await ev(`var ids=[].map.call(document.querySelectorAll('#smdNarke [data-act=vlgo]'), function(b){return b.getAttribute('data-s');}); return ids.indexOf('asthma')>=0?'asthma':ids.indexOf('copd')>=0?'copd':ids[ids.length-1];`);
  await click(`[data-act=vlgo][data-s="${alarmSc}"]`);
  await until(`return !!document.querySelector('#smdNarke .vl-run');`);
  for (let i = 0; i < 8 && !(await ev(`return !!document.querySelector('#smdNarke .vl-al');`)); i++) {
    await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlstep][data-k=rr][data-d="1"]`); await click(`[data-act=vlconfirm]`); await sleep(200);
  }
  ok(await ev(`return !!document.querySelector('#smdNarke .vl-al');`) === true, "an alarm appears in the alarm bar (" + alarmSc + ")");
  await shot("390-dark-alarm");
  const alId = await ev(`return document.querySelector('#smdNarke .vl-al').getAttribute('data-k');`);
  await click(`.vl-al`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-sheet .vl-acard') && !!document.querySelector('#smdNarke [data-act=vlack]');`), "the alarm opens its card with silence and acknowledge");
  ok(await ev(`return /cause|clue|Troubleshooting|intervention/i.test(document.querySelector('#smdNarke .vl-acard').textContent);`) === true, "the alarm card explains causes and the fix");
  await shot("390-dark-alarm-card");
  await click(`[data-act=vlack]`);
  ok(await until(`return !document.querySelector('#smdNarke .vl-al[data-k="${alId}"]');`), "acknowledge removes that alarm from the bar");

  // debrief
  await click(`[data-act=vlfinish]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-score b') && document.querySelectorAll('#smdNarke .vl-parts li').length >= 3;`), "Finish shows the debrief with the score breakdown");
  ok(await ev(`var X=NARKE_MODELS["vent-engine"].SCORE_MAX, sm=[].map.call(document.querySelectorAll('#smdNarke .vl-parts b small'), function(e){return e.textContent;}); return sm.length>=3 && sm.indexOf('/'+X.protection)>=0 && sm.indexOf('/'+X.oxygenation)>=0;`) === true, "debrief maxima come from the engine's SCORE_MAX");
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
    if (!(await ev(`return !!document.querySelector('#smdNarke .vl-home');`))) { await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`); }
    await click(`[data-act=vltut][data-k="${id}"]`);
    if (!(await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`))) { stalls.push(id + ": coach did not open"); continue; }
    for (let step = 0; step < 20; step++) {
      const info = await ev(`var sp=document.querySelector('#smdNarke .vl-co-h span'); return sp ? sp.textContent : "";`);
      if (await ev(`return !!document.querySelector('#smdNarke [data-act=vltutdo]');`)) { await click(`[data-act=vltutdo]`); didDo = true; await sleep(120); }
      const obs = await ev(`return !document.querySelector('#smdNarke .vl-co-task');`);
      let dis = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('aria-disabled');`);
      if (obs && dis === "true") { stalls.push(id + " " + info + ": an observation step does not offer Next"); break; }
      for (let w = 0; w < 2 && dis === "true"; w++) { await click(`[data-act=vlskip][data-k="1800"]`); await sleep(120); dis = await ev(`var b=document.querySelector('#smdNarke [data-act=vltutn]'); return !b ? "none" : b.getAttribute('aria-disabled');`); }
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
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  ok(await ev(`return document.querySelectorAll('#smdNarke .vl-tdone').length === ${tutIds.split(",").length};`) === true, "the lab home ticks every finished tutorial");
  // Hindi tutorial coach
  await click(`[data-act=lang]`); await until(`return document.getElementById('smdNarke').getAttribute('lang')==='hi';`);
  await click(`[data-act=vltut][data-k="vt-rr"]`); await until(`return !!document.querySelector('#smdNarke .vl-coach .vl-co-say');`);
  for (let i = 0; i < 2; i++) { await click(`[data-act=vltutn]`); await sleep(150); }
  ok(await ev(`return /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vl-coach').textContent) && !!document.querySelector('#smdNarke [data-act=vltutdo]');`) === true, "Hindi: the tutorial coach speaks Hindi and offers Do it for me");
  await shot("390-dark-tutorial-hindi");
  await click(`[data-act=vltutx]`); await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await shot("390-dark-home-hindi");
  await click(`[data-act=lang]`); await until(`return !document.getElementById('smdNarke').getAttribute('lang');`);

  // what-if
  if (!(await ev(`return !!document.querySelector('#smdNarke .vl-home');`))) { await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`); }
  await click(`[data-act=vlwhat]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-wi') && document.querySelectorAll('#smdNarke [data-act=vlwip]').length >= 1;`), "what-if lists the questions for this level");
  await click(`[data-act=vlwip]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-wi-res .vl-ba tbody tr').length >= 4 && document.querySelectorAll('#smdNarke .vl-wi-res .vl-cs').length >= 6;`), "what-if shows before and after side by side with the chain");
  await sleep(2000);
  ok(await noOverflow() === true, "what-if: no horizontal scroll");
  { const sm = await small(); ok(sm === true, "what-if: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await shot("390-dark-whatif");
  await click(`[data-act=vlwid][data-v="-1"]`); await click(`[data-act=vlwigo]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-wi-h');`), "build your own what-if runs");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // ABG case
  await click(`[data-act=vlcases]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-abgcard dd b');`), "the ABG case shows its gas card");
  await click(`[data-act=vlq1]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-v1') && !!document.querySelector('#smdNarke [data-act=vlq2]');`), "question 1 reveals the why and question 2");
  await click(`[data-act=vlq2]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-v2') && document.querySelectorAll('#smdNarke .vl-case .vl-ba tbody tr').length >= 4;`), "question 2 applies the change in the engine and shows the result ABG");
  ok(await noOverflow() === true, "ABG case: no horizontal scroll");
  await shot("390-dark-case");
  await click(`[data-act=vlcnext]`);
  ok(await until(`return /Case 2/.test(document.querySelector('#smdNarke .sp-title').textContent);`), "Next case moves on");
  // abg-12: a combined change (lower VT and raise the rate) must apply both settings and explain them
  { const LEARN = JSON.parse(readFileSync(join(HERE, "../narke/vent/learn.json"), "utf8")), ci = LEARN.cases.findIndex((c) => c.id === "abg-12");
    const c12 = LEARN.cases[ci], oi = c12.q2.options.findIndex((o) => o.change && o.change.also);
    for (let i = 1; i < ci; i++) { await click(`[data-act=vlq1]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`); await click(`[data-act=vlq2]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlcnext]');`); await click(`[data-act=vlcnext]`); await until(`return /Case ${i + 2} /.test(document.querySelector('#smdNarke .sp-title').textContent + ' ');`); }
    await click(`[data-act=vlq1]`); await until(`return !!document.querySelector('#smdNarke [data-act=vlq2]');`);
    await click(`[data-act=vlq2][data-o="${oi}"]`);
    const S = (await evp(`Promise.resolve(NARKE_MODELS["vent-engine"].SETTINGS)`)) || {};
    const ap = await until(`var a=document.querySelector('#smdNarke .vl-applied'); return !!a && a.textContent.indexOf(${JSON.stringify(S.vt.label.en)})>=0 && a.textContent.indexOf(${JSON.stringify(S.rr.label.en)})>=0 && /\\b30\\b/.test(a.textContent) && /\\b420\\b/.test(a.textContent);`);
    ok(ap, "abg-12: the combined option applies VT 420 and rate 30 together and says so: " + (await ev(`var a=document.querySelector('#smdNarke .vl-applied'); return a ? a.textContent : "none";`)));
    ok(await ev(`return document.querySelectorAll('#smdNarke .vl-case .vl-ba tbody tr').length >= 4 && document.querySelectorAll('#smdNarke .vl-case .vl-why li').length >= 1;`) === true, "abg-12: the combined change has a result gas and reasons");
    await shot("390-dark-case-combined"); }
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

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
  await ev(`NARKE.back(); NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
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
  const toHome = async () => { for (let i = 0; i < 4 && !(await ev(`return !!document.querySelector('#smdNarke .vl-home');`)); i++) { await ev(`NARKE.back(); return 1;`); await sleep(150); } };
  const goRun = async (lvl, id) => {
    await toHome(); await click(`[data-act=vllevel][data-v="${lvl}"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='${lvl}';`);
    await click(`[data-act=vlgo][data-s="${id}"]`); await until(`return !!document.querySelector('#smdNarke .vl-run');`);
    await click(`[data-act=vllive]`); // live off: the test moves time itself
  };
  const num = (sel) => ev(`var b=document.querySelector('#smdNarke ${sel}'); return b ? parseFloat(b.textContent) : null;`);
  const skip = async (k) => { await click(`[data-act=vlskip][data-k="${k}"]`); await sleep(150); };
  const lastAct = (id) => ev(`var R0=NARKE_VENT_UI.run(); return R0.log.some(function(x){return x.action==="act:${id}";});`);
  {
    await goRun(1, "postop-normal");
    ok(await ev(`return !document.querySelector('#smdNarke .vl-bed');`) === true, "Level 1: no bedside actions while no alarm suggests one");
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
    await skip(1800);
    const sp2 = await num(`#vlSpo2`);
    ok(sp2 >= 90 && sp2 > sp1 + 5, "after Decompress SpO2 recovers (" + sp1 + " to " + sp2 + ")");
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

  // tablet and desktop layouts, both themes
  for (const [w, h] of [[768, 1024], [1280, 860]]) {
    await size(w, h);
    ok(await noOverflow() === true, w + " px: no horizontal scroll on the run");
    const cols = await ev(`var a=document.querySelector('#smdNarke .vl-colA').getBoundingClientRect(), b=document.querySelector('#smdNarke .vl-colB').getBoundingClientRect(); return a.left < b.left && Math.abs(a.top - b.top) < 4 ? true : [a.left,a.top,a.width,b.left,b.top,b.width].map(Math.round).join(",");`);
    ok(cols === true, w + " px: the run lays out in columns" + (cols === true ? "" : ": " + cols));
    await ev(`var t=document.querySelector(".vl-toast"); if (t) t.classList.remove("on"); document.querySelector("#smdNarke .sp-scroll").scrollTop=0; return 1;`);
    await shot(w + "-dark-run"); await theme(false); await shot(w + "-light-run"); await theme(true);
  }
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
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
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await click(`[data-act=vllevel][data-v="1"]`); await until(`return document.querySelector('#smdNarke .vl-levels [aria-pressed=true]').getAttribute('data-v')==='1';`);
  await click(`[data-act=vlwhat]`); await until(`return !!document.querySelector('#smdNarke .vl-wi');`);
  await click(`[data-act=vlwip]`); await sleep(2200); await shot("1280-dark-whatif"); await theme(false); await shot("1280-light-whatif"); await theme(true);
  await ev(`NARKE.back(); return 1;`);
  await size(390, 844);

  const txt = await ev(`return document.getElementById("smdNarke").innerText;`), dm = /[\s\S]{0,60}[–—][\s\S]{0,60}/.exec(txt);
  ok(!dm, "no em or en dash on the lab screens" + (dm ? ": " + dm[0] : ""));
  // The harness empties the app's DOM, so the app's own Escape handler (app.js closeModal) can throw; not the lab's.
  const own = errors.filter((x) => !/closeModal/.test(x));
  ok(own.length === 0, "no uncaught errors" + (own.length ? ": " + own.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē Ventilator Lab UI" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
