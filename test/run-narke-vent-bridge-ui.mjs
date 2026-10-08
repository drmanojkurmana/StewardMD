/* Narkē Ventilator Lab real-ventilator bridge (narke-vent-bridge.js) in headless Chrome: the lab home lists the seven
 * bridge rows; Walk up to the bed ticks and completes; the screen map switches panel styles (labels change, layout
 * moves), tags the SET row, tells set PEEP from measured PEEP, explains the alarm bar, silence and hold keys, opens the
 * alarm limits page with starting limits, the set-or-measured quiz scores; the tap-the-number quiz runs across the
 * three styles and the limits page; mode names map to one lab mode per line with the never-alone tag; the 3 am drill
 * pool is shuffled, feedback puts the learner's order next to the safe order, names the step a late one belongs
 * before, scores an optional step left out in a neutral colour, flags silence-and-walk-away; daily care checks;
 * handover to the next doctor; the never-alone card; back returns to the lab home on its row; Hindi (drill count
 * grammar), both themes, reduced motion, no horizontal scroll at 390 px, 44 px targets, no dashes, no uncaught errors.
 * Content: narke/vent/bridge.json (read here, so no clinical text is hard-coded in the test).
 * USAGE: PORT=<free port> CHROME_PORT=<free port> node test/run-narke-vent-bridge-ui.mjs   (SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8983) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9683), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-vbridge-chrome-" + PORT;
rmSync(userDir, { recursive: true, force: true }); // a fresh profile each run: saved progress from an earlier run must not leak in
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8983"])[1];
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
const settle = async () => { let last = null; for (let i = 0; i < 25; i++) { const v = await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'); return sc ? sc.scrollTop : 0;`); if (v === last) return; last = v; await sleep(70); } };
const tap = async (sel) => {
  if (/\.vl-sheet/.test(sel)) await sleep(450); // a sheet slides in: tap only once it has settled (screenshots used to hide this)
  // Round 5 flake fix: a tap on a panel tile starts a smooth scroll that brings its explanation into view. Tapping again
  // while that scroll still runs moved the target under the pointer ("page switch returns to the main screen" missed).
  // Wait until the scroller holds still before and after placing the target.
  await settle(); await ev(`var b=document.querySelector('#smdNarke ${sel.replace(/'/g, "\\'")}'); if(!b) return 0; var sc=b.closest('.sp-scroll'); if (sc) { var r0=b.getBoundingClientRect(), s0=sc.getBoundingClientRect(); if (r0.top < s0.top + 70 || r0.bottom > s0.bottom - 8) sc.scrollTo({ top: sc.scrollTop + r0.top - s0.top - s0.height/3, behavior: "instant" }); } return 1;`); await settle();
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
  const J = JSON.parse(readFileSync(join(HERE, "..", "narke", "vent", "bridge.json"), "utf8"));
  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.removeItem("smd_narke_vent");localStorage.removeItem("smd_narke_vbridge");localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"mbbs",lang:"en",tab:"test"}));}catch(e){} document.body.className="dark"; document.body.innerHTML='<div id="smdNarke"></div>'; document.documentElement.style.zoom=1; NARKE.open(); return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._ventLab && window.NARKE_VENT_BRIDGE && NARKE_VENT_BRIDGE.homeBlock);`, 15000), "the bridge script loads after the lab");
  await ev(`NARKE._ventLab.open(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-home [data-act=vbopen]').length === 13;`, 15000), "the lab home lists the twelve path rows and the glossary");
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home .vb-review');`, 8000) && await ev(`${R} return R.querySelectorAll('.vb-review').length===1 && /clinical review/.test(R.querySelector('.vb-review').textContent) && /0 of 12 done/.test(R.querySelector('#vbHomeProg').textContent);`) === true, "R5: the draft note shows once, on the bridge block, with a 0 of 12 progress line");
  { const p = await ev(`var p=NARKE_VENT_BRIDGE.progress(); return JSON.stringify({k:Object.keys(p).sort(), ik:Object.keys(p.items[0]).sort(), ids:p.items.map(function(x){return x.id;}), f:typeof p.items[0].open, d:p.doneCount, t:p.total, fn:p.firstNightPassed, l:p.items[0].label});`);
    const o = JSON.parse(p);
    ok(JSON.stringify(o.k) === '["doneCount","firstNightPassed","items","total"]' && JSON.stringify(o.ik) === '["done","id","label","open"]' && o.f === "function" && o.d === 0 && o.t === 12 && o.fn === false && o.ids.join() === "never,bed,screen,modes,alarms,drills,read,skills,care,hand,card,check" && o.l.en && o.l.hi, "R5 B1: progress() has the documented shape in the browser: " + p); }
  const rowsTop = await ev(`${R} var h=R.querySelector('#vbHomeH'), p=[].filter.call(R.querySelectorAll('.vl-home .sp-h2'), function(x){return x.id!=='vbHomeH';}); var pt=p.filter(function(x){return /Patients/.test(x.textContent);})[0]; return !!h && !!pt && h.getBoundingClientRect().top < pt.getBoundingClientRect().top;`);
  ok(rowsTop === true, "at Level 1 the bridge sits above the patients");
  ok(await noOverflow() === true, "home: no horizontal scroll at 390 px");
  { const sm = await small(); ok(sm === true, "home: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), h=document.getElementById('vbHomeH'); sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 60; return 1;`);
  

  // Walk up to the bed
  { const r = await tap(`[data-act=vbopen][data-k=bed]`); ok(r === 1, "Walk up to the bed opens with a real tap" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-chk').length === ${J.bed.groups.reduce((n, g) => n + g.items.length, 0)};`), "every checklist item is a toggle");
  ok(await ev(`${R} return R.querySelector('.vb-chk').getAttribute('data-k')==='pt' && /draft/i.test(R.querySelector('.sp-draft').textContent) && !R.querySelector('.vb-review');`) === true, "the patient comes first; the page carries the shell's draft line only (no second review note)");
  { const r = await tap(`.vb-chk[data-k=pt]`); ok(r === 1 && await until(`return document.querySelector('#smdNarke .vb-chk[data-k=pt]').getAttribute('aria-pressed')==='true' && /^1 of/.test(document.getElementById('vbProgT').textContent);`, 3000), "a tap ticks an item and the count moves" + (r === 1 ? "" : ": " + r) + " [" + await ev(`return document.getElementById('vbProgT').textContent + ' ' + document.querySelector('#smdNarke .vb-chk[data-k=pt]').getAttribute('aria-pressed');`) + "]"); }
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-k')==='pt';`) === true, "focus stays on the ticked item");
  await ev(`[].forEach.call(document.querySelectorAll('#smdNarke .vb-chk[aria-pressed=false]'), function(b){ b.click(); }); return 1;`);
  ok(await until(`var d=document.getElementById('vbBedDone'); return !d.hidden && d.classList.contains('on') && /All checked/.test(document.getElementById('vbProgT').textContent);`), "all ticked: the done card says what to write down");
  ok(await noOverflow() === true, "bed: no horizontal scroll"); { const sm = await small(); ok(sm === true, "bed: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home') && document.activeElement && document.activeElement.getAttribute('data-k')==='bed';`), "back returns to the lab home, focus on the row");
  ok(await ev(`return /Done/.test(document.querySelector('#smdNarke [data-act=vbopen][data-k=bed]').textContent) && NARKE_VENT_BRIDGE.progress().items[1].done === true && /1 of 12 done/.test(document.getElementById('vbHomeProg').textContent);`) === true, "R5 B1: the bed row is done, progress() and the home line agree");

  // Reading a real ventilator screen
  const mainTiles = J.screen.tiles.filter((t) => t.kind !== "limit").length;
  await tap(`[data-act=vbopen][data-k=screen]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-panel .vb-t').length === ${mainTiles};`), "the main screen shows every number, the alarm bar and the keys as buttons");
  ok(await ev(`${R} return R.querySelectorAll('.vb-setrow .vb-t.vb-set').length===5 && R.querySelectorAll('.vb-mcol .vb-t.vb-meas').length===7 && !!R.querySelector('.vb-top .vb-t.vb-set') && !!R.querySelector('.vb-top .vb-t.vb-alm') && R.querySelectorAll('.vb-keys .vb-t.vb-key').length===5;`) === true, "SET keys along the bottom, MEASURED in their own column, mode and alarm bar on top, five keys on the frame");
  // B1: the SET row is tagged on the panel itself, and set PEEP and measured PEEP read differently
  ok(await ev(`${R} var t=R.querySelector('.vb-setrow .vb-rtag'), m=R.querySelector('.vb-mcol .vb-rtag'); return !!t && /SET/.test(t.textContent) && t.getBoundingClientRect().height > 0 && !!m && /MEASURED/.test(m.textContent);`) === true, "B1: the bottom row carries its own SET tag, the measured column its MEASURED tag");
  ok(await ev(`${R} var a=R.querySelector('[data-k=peepset]'), b=R.querySelector('[data-k=peepm]'); return a.textContent !== b.textContent && /set/.test(a.querySelector('.vb-tq').textContent) && /measured/.test(b.querySelector('.vb-tq').textContent) && /set/i.test(a.getAttribute('aria-label')) && /measured/i.test(b.getAttribute('aria-label'));`) === true, "B1: PEEP set and PEEP measured are labelled distinctly (visible and spoken)");
  ok(await ev(`${R} var a=R.querySelector('[data-k=vtset]'), b=R.querySelector('[data-k=vte]'); return !!a.querySelector('.vb-tq') && !!b.querySelector('.vb-tq');`) === true, "B1: on the Dräger-style panel set VT and measured VT (both VT) are qualified too");
  const dr = J.screen.tiles.find((t) => t.id === "ppeak").labels;
  ok(await ev(`return document.querySelector('#smdNarke [data-k=ppeak] .vb-tl').textContent;`) === dr.drager, "Dräger-style panel names peak pressure " + dr.drager);
  const col0 = await ev(`${R} var m=R.querySelector('.vb-mcol').getBoundingClientRect(), w=R.querySelector('.vb-waves').getBoundingClientRect(); return m.left > w.left;`);
  ok(col0 === true, "Dräger-style: measured values to the right of the waves");
  await tap(`[data-act=vbstyle][data-v=hamilton]`);
  ok(await ev(`${R} var m=R.querySelector('.vb-mcol').getBoundingClientRect(), w=R.querySelector('.vb-waves').getBoundingClientRect(); return m.left < w.left && R.querySelector('[data-k=pplat] .vb-tl').textContent===${JSON.stringify(J.screen.tiles.find((t) => t.id === "pplat").labels.hamilton)} && R.querySelector('[data-act=vbstyle][data-v=hamilton]').getAttribute('aria-pressed')==='true';`) === true, "Hamilton-style: the measured column moves left and the labels change");
  ok(await noOverflow() === true, "Hamilton-style panel: no horizontal scroll");
  await tap(`[data-act=vbstyle][data-v=mindray]`);
  ok(await ev(`${R} var m=R.querySelector('.vb-mcol').getBoundingClientRect(), w=R.querySelector('.vb-waves').getBoundingClientRect(); return m.bottom <= w.top + 1;`) === true, "Mindray-style: the measured values sit above the waves");
  ok(await noOverflow() === true, "Mindray-style panel: no horizontal scroll");
  await tap(`[data-act=vbstyle][data-v=drager]`);
  { const r = await tap(`[data-act=vbtile][data-k=vte]`); ok(r === 1, "a measured number takes a real tap" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`var i=document.getElementById('vbInfo'); return /MEASURED/.test(i.textContent) && i.textContent.indexOf(${JSON.stringify(J.screen.tiles.find((t) => t.id === "vte").name.en)})>=0;`), "VTe explains itself and is marked MEASURED");
  await sleep(600); // the first tap scrolls the explanation into view: tap again once that scroll has settled
  { const r = await tap(`[data-act=vbtile][data-k=fio2]`);
    ok(r === 1 && await until(`var i=document.getElementById('vbInfo'); return /SET/.test(i.querySelector('.vb-kind').textContent) && /policy/.test(i.textContent);`), "FiO2 is marked SET and carries the local-policy caveat" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`return /^2 of/.test(document.getElementById('vbOpened').textContent) && document.querySelectorAll('#smdNarke .vb-t.seen').length===2;`, 3000), "learned numbers are counted and marked [" + await ev(`return document.getElementById('vbOpened').textContent + ' seen=' + [].map.call(document.querySelectorAll('#smdNarke .vb-t.seen'), function(b){return b.getAttribute('data-k');}).join(',');`) + "]");
  ok(await ev(`return document.getElementById('vbInfo').getAttribute('aria-live')==='polite';`) === true, "the explanation is announced");
  // B5: the silence key, then the alarm limits key opens the limits page
  await sleep(500);
  { const r = await tap(`[data-act=vbtile][data-k=silence]`);
    ok(r === 1 && await until(`var i=document.getElementById('vbInfo'); return /KEY/.test(i.querySelector('.vb-kind').textContent) && /2 minutes/.test(i.textContent) && /walk away/.test(i.textContent);`), "B5: the silence key: about 2 minutes, never silence and walk away" + (r === 1 ? "" : ": " + r)); }
  { const sm = await small(); ok(sm === true, "screen map: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-legend'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("02-390-dark-screen-map-set-tag");
  await sleep(500);
  { const r = await tap(`[data-act=vbtile][data-k=limits]`); ok(r === 1, "the alarm limits key takes a real tap" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`${R} return !!R.querySelector('.vb-panel.vb-P-limits') && R.querySelectorAll('.vb-lim .vb-t.vb-lim').length === ${J.screen.tiles.filter((t) => t.kind === "limit").length} && R.querySelector('[data-act=vbpage][data-v=limits]').getAttribute('aria-pressed')==='true';`), "B5: the limits key opens the alarm limits page with every limit");
  await sleep(400);
  { const r = await tap(`[data-act=vbtile][data-k=lim_ppeak]`);
    ok(r === 1 && await until(`var i=document.getElementById('vbInfo'); return /LIMIT/.test(i.querySelector('.vb-kind').textContent) && /about 10 above/.test(i.textContent) && /policy/.test(i.textContent);`), "B5: the high pressure limit gives a sensible start and the unit-policy caveat" + (r === 1 ? "" : ": " + r)); }
  ok(await noOverflow() === true, "limits page: no horizontal scroll"); { const sm = await small(); ok(sm === true, "limits page: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke #vbPageSeg'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await theme(false);  await theme(true);
  { const r = await tap(`[data-act=vbpage][data-v=main]`);
    ok(r === 1 && await until(`return !!document.querySelector('#smdNarke .vb-panel.vb-P-main .vb-waves');`), "the page switch returns to the main screen" + (r === 1 ? "" : ": " + r)); }
  ok(await ev(`${R} var a=R.querySelector('.vb-top .vb-t.vb-alm'); return a.classList.contains('vb-cleared') && /Cleared/.test(a.textContent) && /Cleared/.test(a.getAttribute('aria-label'));`) === true, "R5 B8: the teaching panel's alarm bar reads as a cleared alarm (Ppeak 24 is under its 35 limit)");
  await ev(`document.querySelector('#smdNarke .vb-labels').open=true; return 1;`);
  ok(await ev(`${R} return R.querySelectorAll('.vb-lrows > li').length === ${J.screen.labelRows.length} && /No logos/.test(R.querySelector('.vb-brand').textContent) && /Flow trigger/.test(R.querySelector('.vb-lrows').textContent) && /I:E ratio/.test(R.querySelector('.vb-lrows').textContent);`) === true, "label names by brand, as text, with the trigger and I:E terms and the no-affiliation note");
  ok(await noOverflow() === true, "label map: no horizontal scroll");
  // set-or-measured quiz: one wrong, then the rest right
  const nq = J.screen.quiz.length;
  for (let i = 0; i < nq; i++) {
    const Q = J.screen.quiz[i], pick = i === 0 ? (Q.answer + 1) % Q.options.length : Q.answer;
    const r = await tap(`#vbQuiz [data-act=vbqans][data-o="${pick}"]`);
    if (r !== 1) { ok(false, "quiz answer " + i + ": " + r); break; }
    if (i === 0) ok(await until(`var v=document.querySelector('#vbQuiz .vb-qv'); return !!v && v.classList.contains('bad') && document.activeElement===v;`), "a wrong answer says so, shows why and takes focus");
    await tap(`#vbQuiz [data-act=vbqnext]`);
  }
  ok(await until(`return /${nq - 1} of ${nq}/.test(document.querySelector('#vbQuiz .vb-qscore').textContent);`), `the quiz scores ${nq - 1} of ${nq}`);

  // B5: find it on the screen, a tap-the-number quiz across the three styles, with the limits page
  { const r = await tap(`.vb-tofind`); ok(r === 1, "Find it opens with a real tap" + (r === 1 ? "" : ": " + r)); }
  const FI = J.screen.find.items;
  ok(await until(`return !!document.querySelector('#smdNarke #vbFind .vb-panel.vb-L-${FI[0].style}');`), "the tap quiz shows the first question's panel style");
  for (let i = 0; i < FI.length; i++) {
    const F = FI[i];
    ok(await until(`return !!document.querySelector('#smdNarke #vbFind .vb-panel.vb-L-${F.style}.vb-P-${F.page} [data-act=vbfind][data-k=${F.target}]');`), `find ${i + 1}: ${F.style}-style, ${F.page} page`);
    const pick = i === 0 ? "vtset" : F.target; // the first: tap the SET VT (the classic Dräger-style trap) instead of the measured one
    const r = await tap(`#vbFind [data-act=vbfind][data-k=${pick}]`);
    if (r !== 1) { ok(false, "find tap " + i + ": " + r); break; }
    if (i === 0) {
      ok(await until(`${R} var v=R.querySelector('#vbFind .vb-fv'); return !!v && v.classList.contains('bad') && document.activeElement===v && R.querySelector('#vbFind [data-k=${F.target}]').getAttribute('data-state')==='right' && R.querySelector('#vbFind [data-k=vtset]').getAttribute('data-state')==='wrong';`), "a wrong tap marks both tiles and explains");
      ok(await noOverflow() === true, "find: no horizontal scroll"); { const sm = await small(); ok(sm === true, "find: 44 px targets" + (sm === true ? "" : ": " + sm)); }
      await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke #vbFQ'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
      await shot("04-390-dark-find-feedback");
    }
    if (F.page === "limits" && i < 6) ok(await ev(`return !!document.querySelector('#smdNarke #vbFind .vb-P-limits .vb-lim');`) === true, `find ${i + 1}: the limits page is drawn`);
    await tap(`#vbFind [data-act=vbfnext]`);
  }
  ok(await until(`return /${FI.length - 1} of ${FI.length}/.test(document.querySelector('#smdNarke .vb-fscore').textContent);`), `the tap quiz scores ${FI.length - 1} of ${FI.length}`);
  ok(await ev(`${R} var l=R.querySelectorAll('#vbFind .vb-rev li'); return l.length===1 && /You tapped/.test(l[0].textContent) && /Right answer/.test(l[0].textContent);`) === true, "R5 B8: the tap quiz result lists the miss: what you tapped and the right one");
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .vb-panel') && document.activeElement && document.activeElement.classList.contains('vb-tofind');`), "back from the tap quiz returns to the screen map, on its button");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // Mode names (B3)
  await tap(`[data-act=vbopen][data-k=modes]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-mode').length === ${J.modes.items.length};`), "one card per mode family");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vb-mode'), function(c){ return !!c.querySelector('.vb-never') && /Closest in the lab/.test(c.querySelector('.vb-ml').textContent) && c.querySelector('.vb-mlabs li'); });`) === true, "each mode names its closest lab mode and says do not change alone");
  const labCounts = J.modes.items.map((x) => [].concat(x.lab).length);
  ok(await ev(`${R} var c=[].map.call(R.querySelectorAll('.vb-mode'), function(m){ return m.querySelectorAll('.vb-mlabs li').length; }); return JSON.stringify(c);`) === JSON.stringify(labCounts), "B3: one lab mode per line (no comma-joined pair)");
  ok(await ev(`${R} var lis=R.querySelectorAll('.vb-mode:first-child .vb-mlabs li'); return lis.length===2 && lis[1].getBoundingClientRect().top >= lis[0].getBoundingClientRect().bottom - 1;`) === true, "B3: two lab modes sit on two lines");
  ok(await ev(`${R} var t=R.querySelector('.vb-never').textContent; return !/intern/i.test(t) && /senior/.test(t);`) === true, "B3: the never tag speaks to any junior doctor, not an intern");
  ok(await ev(`return /intubated/.test(document.querySelector('#smdNarke .vb-modes').textContent);`) === true, "BiPAP versus BIPAP is explained");
  ok(await noOverflow() === true, "modes: no horizontal scroll");
  await shot("05-390-dark-modes");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // 3 am drill (B2)
  await tap(`[data-act=vbopen][data-k=drills]`);
  ok(await until(`return document.querySelectorAll('#smdNarke [data-act=vbdrill]').length === ${J.drills.items.length} && !!document.querySelector('#smdNarke .vb-drows [data-act=vbopen][data-k=never]');`), J.drills.items.length + " drills and the never-alone card");
  await tap(`[data-act=vbdrill][data-k=highp]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-step').length === ${J.drills.items[0].steps.length} && document.querySelector('#smdNarke [data-act=vbcheck]').disabled;`), "the drill opens with every step in the pool and Check disabled");
  ok(await ev(`${R} var ids=[].map.call(R.querySelectorAll('.vb-step'), function(b){ return b.getAttribute('data-k'); }), ans=${JSON.stringify(J.drills.items[0].steps.map((x) => x.id))}; return ids[0]!==ans[0] && ids.every(function(id,i){ return id!==ans[i]; });`) === true, "B2: the pool is shuffled: the first step is not first, no step in its own place");
  const bad = ["suction", "look", "bag", "dope", "call", "trap"];
  for (const id of bad) { const r = await tap(`.vb-step[data-k=${id}]`); if (r !== 1) { ok(false, "pick " + id + ": " + r); break; } }
  ok(await ev(`return document.querySelectorAll('#smdNarke .vb-ord li').length === 6 && !document.querySelector('#smdNarke .vb-step');`) === true, "picked steps move into Your order");
  await tap(`[data-act=vbcheck]`);
  ok(await until(`${R} var v=R.querySelector('.vb-dv'); return !!v && v.classList.contains('bad') && R.querySelector('.vb-r.late') && R.querySelector('.vb-r.trap') && document.activeElement===v;`), "feedback: looking at the patient came too late, the trap is flagged, the verdict takes focus");
  ok(await ev(`${R} var c=R.querySelector('.vb-cmp'); if(!c) return 'no compare'; var s=c.querySelectorAll('section'); if (s.length!==2) return 'sections '+s.length; var a=s[0].getBoundingClientRect(), b=s[1].getBoundingClientRect(); return Math.abs(a.top-b.top) < 2 && b.left > a.left && s[0].querySelectorAll('li').length===6 && /Never/.test(s[1].textContent) && /Any time/.test(s[1].textContent) && /any order/.test(s[1].textContent);`) === true, "B2: your order sits next to the safe order (shared numbers, any time, never)");
  ok(await ev(`${R} var t=R.querySelector('.vb-r.late .vb-r-s').textContent; return /Do this sooner: before/.test(t) && /Suction the tube/.test(t) && /your step 2/.test(t) && !/comes earlier/.test(t);`) === true, "B2: the late label says which step it belongs before and where you put it");
  ok(await ev(`return document.querySelectorAll('#smdNarke .vb-sbar dl > div').length === 4;`) === true, "the SBAR script follows the feedback");
  ok(await noOverflow() === true, "drill feedback: no horizontal scroll");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-dv'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("06-390-dark-drill-compare");
  await tap(`[data-act=vbdagain]`);
  for (const id of ["look", "bag", "dope", "suction", "call"]) await tap(`.vb-step[data-k=${id}]`);
  await tap(`[data-act=vbcheck]`);
  ok(await until(`var v=document.querySelector('#smdNarke .vb-dv'); return !!v && v.classList.contains('ok') && document.querySelectorAll('#smdNarke .vb-r.trap').length===0;`), "a safe order (trap left out) passes");
  ok(await noOverflow() === true, "drill: no horizontal scroll"); { const sm = await small(); ok(sm === true, "drill: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  // B2: low SpO2: bag before DOPE, the optional FiO2 left out: safe, in a neutral colour, not red
  await tap(`[data-act=vbdnext]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vb-step[data-k=fio2]');`), "Next drill opens low SpO2");
  for (const id of ["look", "bag", "dope", "call"]) await tap(`.vb-step[data-k=${id}]`);
  await tap(`[data-act=vbcheck]`);
  ok(await until(`${R} var v=R.querySelector('.vb-dv'); return !!v && v.classList.contains('vb-neutral') && !v.classList.contains('bad') && /optional/.test(v.textContent) && /Optional: fine to leave out/.test(R.querySelector('.vb-r.optional').textContent);`), "B2: only an optional step missing: a safe verdict in a neutral colour");
  ok(await ev(`${R} return /bagging with 100% oxygen/.test(R.querySelector('.vb-sbar').textContent) && !/FiO2 now 100/.test(R.querySelector('.vb-sbar').textContent);`) === true, "B2: the low SpO2 SBAR matches bagging and does not assume the optional FiO2");
  await theme(false); await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-dv'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
   await theme(true);
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=vbdrill]') && document.activeElement && document.activeElement.getAttribute('data-k')==='lowspo2' && /Done/.test(document.querySelector('#smdNarke [data-act=vbdrill][data-k=highp]').textContent);`), "back returns to the drill list on that drill, the safe one marked done");
  // B6: the silence trap drill
  await tap(`[data-act=vbdrill][data-k=silence]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vb-step[data-k=trap]') && !!document.querySelector('#smdNarke .vb-step[data-k=doc]');`), "B6: the it-keeps-alarming drill has a silence trap and a what-to-document step");
  for (const id of ["look", "trap"]) await tap(`.vb-step[data-k=${id}]`);
  await tap(`[data-act=vbcheck]`);
  ok(await until(`${R} var t=R.querySelector('.vb-r.trap'); return !!t && /walk away/.test(t.textContent) && !!R.querySelector('.vb-r.missed');`), "B6: silence and walk away is flagged; documenting is missed");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke [data-act=vbdrill]');`);

  // Never alone
  await tap(`.vb-drows [data-act=vbopen][data-k=never]`);
  ok(await until(`${R} return R.querySelectorAll('.vb-list.ok li').length===${J.never.may.length} && R.querySelectorAll('.vb-list.no li').length===${J.never.mayNot.length} && R.querySelectorAll('.vb-list.call li').length===${J.never.callNow.length};`), "never-alone: may, not alone, call now");
  ok(await noOverflow() === true, "never-alone: no horizontal scroll");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B6: daily care checks
  await tap(`[data-act=vbopen][data-k=care]`);
  const nCare = J.care.groups.reduce((n, g) => n + g.items.length, 0);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-chk').length === ${nCare} && /30 to 45 degrees/.test(document.querySelector('#smdNarke .vb-wrap').textContent);`), "B6: daily care checks: head up 30 to 45 degrees, sedation, VAP bundle");
  { const r = await tap(`.vb-chk[data-k=head]`); ok(r === 1 && await until(`return /^1 of ${nCare}/.test(document.getElementById('vbProgT').textContent);`), "a care item ticks" + (r === 1 ? "" : ": " + r)); }
  ok(await noOverflow() === true, "care: no horizontal scroll"); { const sm = await small(); ok(sm === true, "care: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await theme(false);  await theme(true);
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home') && document.activeElement && document.activeElement.getAttribute('data-k')==='care' && /1 of ${nCare}/.test(document.activeElement.textContent);`), "back to the lab home on the care row, with its progress");

  // B4: handover to the next doctor
  await tap(`[data-act=vbopen][data-k=hand]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-hr').length === ${J.handover.rows.length};`), "B4: the handover card lists " + J.handover.rows.length + " parts");
  ok(await ev(`${R} var t=R.querySelector('.vb-ho').textContent; return ${JSON.stringify(J.handover.rows.map((r) => r.label.en))}.every(function(l){ return t.indexOf(l)>=0; }) && R.querySelectorAll('.vb-docs li').length===${J.handover.doc.length};`) === true, "B4: mode, set, measured, last gas, alarms, plan, escalation, and what to write after an alarm");
  ok(await noOverflow() === true, "handover: no horizontal scroll"); { const sm = await small(); ok(sm === true, "handover: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  
  { const r = await tap(`.vb-todr[data-act=vbdrill]`); ok(r === 1 && await until(`return !!document.querySelector('#smdNarke .vb-step[data-k=trap]') && /keeps alarming/.test(document.querySelector('#smdNarke .sp-title').textContent);`), "the handover card links to the it-keeps-alarming drill" + (r === 1 ? "" : ": " + r)); }
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke [data-act=vbdrill]');`);
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);


  /* ================= round 5: B1 to B9 ================= */
  const prog = () => ev(`return JSON.stringify(NARKE_VENT_BRIDGE.progress().items.filter(function(x){return x.done;}).map(function(x){return x.id;}));`);
  // B1: never alone gets a Got it; it returns to the lab on the next row that is not done
  await tap(`[data-act=vbopen][data-k=never]`);
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=vbgot][data-k=never]');`), "R5 B1: the never-alone card ends with Got it");
  { const r = await tap(`[data-act=vbgot][data-k=never]`);
    ok(r === 1 && await until(`return !!document.querySelector('#smdNarke .vl-home') && document.activeElement && document.activeElement.getAttribute('data-k')==='modes';`), "R5 B1: Got it marks it done and lands on the next row not done (mode names)" + (r === 1 ? "" : ": " + r)); }
  ok(/"never"/.test(await prog()) && /"screen"/.test(await prog()), "R5 B1: never and the screen map (both quizzes finished) are done: " + await prog());

  // B5: mode names with what is set and what is not, and a quiz that marks the page done
  await tap(`[data-act=vbopen][data-k=modes]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-chips.set').length === ${J.modes.items.length} && document.querySelectorAll('#smdNarke .vb-chips.not').length === ${J.modes.items.length};`), "R5 B5: every mode lists what is set and what is not");
  ok(await ev(`${R} var c=[].filter.call(R.querySelectorAll('.vb-mode'), function(m){ return /PSV/.test(m.querySelector('.vb-mn').textContent); })[0]; return !!c && /Rate/.test(c.querySelector('.vb-chips.not').textContent) && !/Rate/.test(c.querySelector('.vb-chips.set').textContent);`) === true, "R5 B5: pressure support shows no set rate");
  for (let i = 0; i < J.modes.quiz.length; i++) {
    const r = await tap(`#vbQuizM [data-act=vbqans][data-o="${J.modes.quiz[i].answer}"]`);
    if (r !== 1) { ok(false, "mode quiz " + i + ": " + r); break; }
    await tap(`#vbQuizM [data-act=vbqnext]`);
  }
  ok(await until(`return /${J.modes.quiz.length} of ${J.modes.quiz.length}/.test(document.querySelector('#vbQuizM .vb-qscore').textContent) && !!document.querySelector('#vbQuizM .vb-next');`), "R5 B5: the mode quiz scores and offers the next step");
  ok(/"modes"/.test(await prog()), "R5 B1: finishing the mode quiz marks the page done");
  ok(await noOverflow() === true, "modes: no horizontal scroll"); { const sm = await small(); ok(sm === true, "modes: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B4: alarm messages by brand style
  await tap(`[data-act=vbopen][data-k=alarms]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-al').length === ${J.alarms.items.length} && document.querySelectorAll('#smdNarke .vb-prio li').length === 3;`), "R5 B4: " + J.alarms.items.length + " alarm messages and a red, yellow, low legend");
  ok(await ev(`${R} var a=R.querySelectorAll('.vb-al'); return /High priority/.test(a[0].textContent) && a[0].querySelector('.vb-amsg').textContent===${JSON.stringify(J.alarms.items[0].labels.drager)} && /Look at the patient/.test(a[0].querySelector('.vb-asteps li').textContent);`) === true, "R5 B4: priority in words, the Dräger-style message, the patient first");
  { const r = await tap(`[data-act=vbalstyle][data-v=hamilton]`);
    ok(r === 1 && await ev(`return document.querySelector('#smdNarke .vb-amsg').textContent===${JSON.stringify(J.alarms.items[0].labels.hamilton)} && document.querySelector('#smdNarke [data-act=vbalstyle][data-v=hamilton]').getAttribute('aria-pressed')==='true';`) === true, "R5 B4: the style switch changes the message words" + (r === 1 ? "" : ": " + r)); }
  ok(await noOverflow() === true, "alarms: no horizontal scroll"); { const sm = await small(); ok(sm === true, "alarms: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await theme(false); await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-prio'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("03-390-light-alarm-map"); await theme(true);
  await tap(`[data-act=vbgot][data-k=alarms]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home');`) && /"alarms"/.test(await prog()), "R5 B4: Got it marks the alarm map done");

  // B8: the 60 s timed drill; time running out checks the order by itself
  await tap(`[data-act=vbopen][data-k=drills]`);
  await until(`return !!document.querySelector('#smdNarke [data-act=vbtimed]');`);
  await tap(`[data-act=vbtimed][data-v="1"]`);
  ok(await until(`return document.querySelector('#smdNarke [data-act=vbtimed][data-v="1"]').getAttribute('aria-pressed')==='true' && !!document.querySelector('#smdNarke .vb-tnote');`), "R5 B8: the 60 s timer can be switched on");
  await tap(`[data-act=vbdrill][data-k=disc]`);
  ok(await until(`return /60 s left|59 s left/.test((document.getElementById('vbTimer')||{}).textContent||"");`), "R5 B8: the timed drill shows the time left");
  await tap(`.vb-step[data-k=look]`);
  await ev(`window.__now=Date.now; var d=Date.now()+61000; Date.now=function(){ return window.__now()+61000; }; return 1;`);
  ok(await until(`var v=document.querySelector('#smdNarke .vb-dv'); return !!v && /Time is up/.test(v.textContent) && /Your 1 steps|Your 1 step/.test(v.textContent) && /missed/.test(v.textContent);`, 5000), "R5 B8: at 0 the order is checked, and the count reads in the learner's terms");
  await ev(`Date.now=window.__now; return 1;`);
  ok(await ev(`return !document.getElementById('vbTimer');`) === true, "the timer is gone once checked");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke [data-act=vbtimed]');`);
  await tap(`[data-act=vbtimed][data-v="0"]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vb-drows [data-act=vbopen][data-k=read]');`), "R5 B6: the drill list leads on to Read this screen");

  // B6: read this screen: a panel with a live alarm, no hints
  await tap(`.vb-drows [data-act=vbopen][data-k=read]`);
  ok(await until(`return !!document.querySelector('#smdNarke #vbRead .vb-panel.vb-live.vb-L-${J.read.items[0].style}');`), "R5 B6: the first panel is a " + J.read.items[0].style + "-style screen with a live alarm");
  ok(await ev(`${R} return !R.querySelector('#vbRead .vb-hint') && !R.querySelector('#vbInfo') && R.querySelector('#vbRead [data-k=ppeak] .vb-tv').textContent.indexOf(${JSON.stringify(J.read.items[0].ov.ppeak)})===0 && R.querySelector('#vbRead [data-k=pplat]').getAttribute('aria-disabled')==='true';`) === true, "R5 B6: no hints, the scenario numbers, tiles locked until the first answer");
  for (let i = 0; i < J.read.items.length; i++) {
    const Rd = J.read.items[i], pick1 = i === 0 ? (Rd.q1.answer + 1) % 4 : Rd.q1.answer;
    let r = await tap(`#vbRead [data-act=vbr1][data-o="${pick1}"]`);
    if (r !== 1) { ok(false, "read q1 " + i + ": " + r); break; }
    if (i === 0) {
      ok(await until(`var v=document.querySelector('#vbRead .vb-r1v'); return !!v && v.classList.contains('bad') && /Not right/.test(v.textContent) && document.activeElement===v;`), "R5 B6: a wrong first step says Not right and why");
      await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke #vbRead .vb-panel'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
      await shot("07-390-dark-read-this-screen");
    }
    r = await tap(`#vbRead [data-act=vbr2][data-k=${Rd.q2.targets[0]}]`);
    if (r !== 1) { ok(false, "read q2 " + i + ": " + r); break; }
    ok(await until(`var v=document.querySelector('#vbRead .vb-r2v'); return !!v && v.classList.contains('ok');`), `R5 B6: panel ${i + 1}: the number to read next is accepted`);
    if (i === 0) { ok(await noOverflow() === true, "read: no horizontal scroll"); const sm = await small(); ok(sm === true, "read: 44 px targets" + (sm === true ? "" : ": " + sm)); }
    await tap(`#vbRead [data-act=vbrnext]`);
  }
  ok(await until(`var v=document.querySelector('#vbRead .vb-rscore'); return !!v && /5 of 6/.test(v.textContent) && document.querySelectorAll('#vbRead .vb-rev li').length===1;`), "R5 B6: scored 5 of 6 with the miss listed");
  ok(/"read"/.test(await prog()), "R5 B1: the read drill is done");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B7: hands-on skills
  await tap(`[data-act=vbopen][data-k=skills]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-skill').length === ${J.skills.items.length};`), "R5 B7: " + J.skills.items.length + " hands-on skills");
  ok(await ev(`${R} var t=R.querySelector('.vb-skills').textContent; return /PEEP valve/.test(t) && /EtCO2/.test(t) && /150 mmHg/.test(t) && /Insp. hold/.test(t) && /20 to 30 cmH2O/.test(t) && /water trap/.test(t);`) === true, "R5 B7: bagging, reconnect checks, suction, hold per style, cuff, circuit");
  await shot("12-390-dark-skills");
  for (const x of J.skills.items) await tap(`[data-act=vbskill][data-k=${x.id}]`);
  ok(await until(`return /"skills"/.test(JSON.stringify(NARKE_VENT_BRIDGE.progress().items.filter(function(x){return x.done;}).map(function(x){return x.id;}))) && !!document.querySelector('#smdNarke #vbGot .vb-next');`), "R5 B7: all ticked: done, with the next step");
  ok(await noOverflow() === true, "skills: no horizontal scroll"); { const sm = await small(); ok(sm === true, "skills: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B8: the handover's blank alarm note template
  await tap(`[data-act=vbopen][data-k=hand]`);
  await until(`return !!document.querySelector('#smdNarke [data-act=vbcopy]');`);
  ok(await ev(`return document.querySelectorAll('#smdNarke .vb-ntpl > div').length === ${J.handover.note.fields.length} && !document.querySelector('#smdNarke .vb-note input, #smdNarke .vb-note textarea');`) === true, "R5 B8: the alarm note template has its fields and no place to type patient data");
  await tap(`[data-act=vbcopy]`);
  ok(await until(`return document.getElementById('vbCopied').textContent.length > 0;`), "R5 B8: copy says what happened");
  await tap(`[data-act=vbgot][data-k=hand]`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B3: the pocket card
  await tap(`[data-act=vbopen][data-k=card]`);
  ok(await until(`return !!document.querySelector('#smdNarke #vbPcard') && document.querySelectorAll('#smdNarke .vb-who input').length === 4;`), "R5 B3: the pocket card with four who-to-call fields");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vb-who input'), function(i){ return parseFloat(getComputedStyle(i).fontSize) >= 16 && !!R.querySelector('label[for='+i.id+']'); }) && /this phone only/.test(R.querySelector('.vb-priv').textContent);`) === true, "R5 B3: labelled 16 px inputs (no zoom) and the on-this-phone-only note");
  ok(await ev(`${R} return R.querySelectorAll('#vbPcard .vb-pco').length === 4 && /walk away/.test(R.querySelector('#vbPcard').textContent) && R.querySelectorAll('#vbPcard .vb-pclim tbody tr').length === ${J.screen.limitRows.length};`) === true, "R5 B3: the card has the 4 alarm orders, silence and the limits");
  await ev(`document.getElementById('vbC_n1').focus(); return 1;`); await call("Input.insertText", { text: "Dr Test" });
  await ev(`document.getElementById('vbC_p1').focus(); return 1;`); await call("Input.insertText", { text: "98765 43210" });
  ok(await until(`try { var o=JSON.parse(localStorage.getItem('smd_narke_vcard')); return o.n1==='Dr Test' && o.p1==='98765 43210' && /Dr Test/.test(document.getElementById('vbPcWho').textContent); } catch(e) { return false; }`), "R5 B3: name and number saved on this device and shown on the card");
  ok(/"card"/.test(await prog()), "R5 B1: the card is done once a senior's name and number are in");
  await ev(`window.__pr=null; window.print=function(){ var h=document.getElementById('vbPrintHost'); window.__pr = !!h && document.documentElement.classList.contains('vb-printing') && /Dr Test/.test(h.textContent) && !h.querySelector('[id=vbPcard]'); }; return 1;`);
  await tap(`[data-act=vbprint]`);
  ok(await until(`return window.__pr === true;`), "R5 B3: print puts a copy of the card at the top of the page with print styles on");
  await ev(`window.dispatchEvent(new Event('afterprint')); return 1;`);
  ok(await until(`return !document.getElementById('vbPrintHost') && !document.documentElement.classList.contains('vb-printing');`), "R5 B3: after printing the copy is removed");
  ok(await noOverflow() === true, "card: no horizontal scroll"); { const sm = await small(); ok(sm === true, "card: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await theme(false); await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-who'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("08-390-light-pocket-card"); await theme(true);
  await tap(`[data-act=vbcclear]`);
  ok(await until(`return localStorage.getItem('smd_narke_vcard') === null && document.getElementById('vbC_n1').value === '';`), "R5 B3: Clear removes the names and numbers from the device");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // B2: the first-night check: one wrong, then pass; teach-back on every answer
  await tap(`[data-act=vbopen][data-k=check]`);
  ok(await until(`return document.querySelectorAll('#vbCheck [data-act=vbqans]').length === 4;`), "R5 B2: the first-night check starts");
  for (let i = 0; i < J.check.items.length; i++) {
    const Q = J.check.items[i], pick = i === 0 ? (Q.answer + 1) % 4 : Q.answer;
    const r = await tap(`#vbCheck [data-act=vbqans][data-o="${pick}"]`);
    if (r !== 1) { ok(false, "check " + i + ": " + r); break; }
    if (i === 0) ok(await until(`${R} var v=R.querySelector('#vbCheck .vb-qv'); return !!v && /Not right/.test(v.textContent) && !!R.querySelector('#vbCheck .vb-reva') && !!R.querySelector('#vbCheck .vb-say');`), "R5 B2: a wrong answer: Not right, the right answer, why and a line to say back");
    if (i === 1) ok(await ev(`return !!document.querySelector('#vbCheck .vb-say') && /Say it back/.test(document.querySelector('#vbCheck .vb-say').textContent);`) === true, "R5 B2: a right answer has the say-it-back line too");
    await tap(`#vbCheck [data-act=vbqnext]`);
  }
  const nC = J.check.items.length;
  ok(await until(`${R} return !!R.querySelector('#vbCheck .vb-pass') && /${nC - 1} of ${nC}/.test(R.querySelector('#vbCheck .vb-qscore').textContent) && /under supervision/.test(R.querySelector('#vbCheck .vb-pass').textContent) && R.querySelectorAll('#vbCheck .vb-rev li').length===1;`), `R5 B2: ${nC - 1} of ${nC} passes: the badge, the supervision line and the miss to go over`);
  ok(await ev(`return NARKE_VENT_BRIDGE.progress().firstNightPassed === true;`) === true, "R5 B1: progress().firstNightPassed is true");
  ok(await noOverflow() === true, "check: no horizontal scroll"); { const sm = await small(); ok(sm === true, "check: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-pass'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("09-390-dark-first-night-pass");
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`${R} return !!R.querySelector('.vl-home .vb-badge') && /Passed/.test(R.querySelector('[data-act=vbopen][data-k=check]').textContent);`), "R5 B2: the lab home shows the badge and the check row says Passed");

  // B9: the glossary
  await tap(`[data-act=vbopen][data-k=gloss]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-gi').length === ${J.gloss.items.length};`), "R5 B9: the glossary lists " + J.gloss.items.length + " words");
  await ev(`document.getElementById('vbGq').focus(); return 1;`); await call("Input.insertText", { text: "ExpMinVol" });
  ok(await until(`${R} var v=[].filter.call(R.querySelectorAll('.vb-gi'), function(x){ return !x.hidden; }); return v.length >= 1 && v.length < ${J.gloss.items.length} && /Minute volume/.test(v[0].textContent);`), "R5 B9: a brand name finds the word");
  await ev(`var i=document.getElementById('vbGq'); i.value='zzqq'; i.dispatchEvent(new Event('input')); return 1;`);
  ok(await until(`return !document.getElementById('vbGnone').hidden;`), "R5 B9: no match shows an empty state");
  ok(await noOverflow() === true, "glossary: no horizontal scroll");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await shot("01-390-dark-home-progress");

  // Hindi (B7)
  await tap(`[data-act=lang]`);
  ok(await until(`${R} return R.getAttribute('lang')==='hi' && /[\\u0900-\\u097F]/.test(R.querySelector('#vbHomeH').textContent);`), "Hindi switches the bridge rows");
  ok(await ev(`${R} var t=R.querySelector('[data-act=vbopen][data-k=drills]').textContent; return /drill सुरक्षित/.test(t) && !/drills सुरक्षित/.test(t);`) === true, "B7: Hindi drill count reads '{m} में से {n} drill सुरक्षित'");
  await tap(`[data-act=vbopen][data-k=never]`);
  ok(await until(`${R} return /[\\u0900-\\u097F]/.test(R.querySelector('.vb-nv').textContent);`), "Hindi: the never-alone card");
  ok(await ev(`return !document.querySelector('#smdNarke .vb-wrap [lang=en]') && !/[\\u0966-\\u096F]/.test(document.getElementById('smdNarke').innerText);`) === true, "Hindi: no English fallback, ASCII digits");
  await shot("10-390-dark-never-hindi");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  for (const k of ["hand", "care", "modes"]) {
    await tap(`[data-act=vbopen][data-k=${k}]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vb-wrap') && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vb-wrap').textContent) && !document.querySelector('#smdNarke .vb-wrap [lang=en]');`), "Hindi: " + k + " screen, no English fallback");
    ok(await noOverflow() === true, "Hindi " + k + ": no horizontal scroll");
    await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  }
  await tap(`[data-act=vbopen][data-k=gloss]`);
  ok(await until(`${R} return document.querySelectorAll('#smdNarke .vb-gi').length > 0 && /[\\u0900-\\u097F]/.test(R.querySelector('.vb-gi dd').textContent) && !R.querySelector('.vb-wrap [lang=en]');`), "Hindi: the glossary");
  ok(await noOverflow() === true, "Hindi glossary: no horizontal scroll");
  await theme(false); await shot("11-390-light-glossary-hindi"); await theme(true);
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  for (const k of ["check", "alarms", "card", "skills", "read"]) {
    await tap(`[data-act=vbopen][data-k=${k}]`);
    ok(await until(`return !!document.querySelector('#smdNarke .vb-wrap') && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vb-wrap').textContent) && !document.querySelector('#smdNarke .vb-wrap [lang=en]');`), "Hindi: " + k + " page");
    ok(await noOverflow() === true, "Hindi " + k + ": no horizontal scroll");
    await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  }
  await tap(`[data-act=vbopen][data-k=screen]`);
  await until(`return !!document.querySelector('#smdNarke .vb-panel');`);
  await tap(`[data-act=vbtile][data-k=pplat]`);
  ok(await until(`return /[\\u0900-\\u097F]/.test(document.getElementById('vbInfo').textContent) && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vb-styles').textContent);`), "Hindi: the screen map and its explanation");
  ok(await noOverflow() === true, "Hindi screen map: no horizontal scroll");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vb-styles button, .vb-tl'), function(e){ return e.scrollWidth <= e.clientWidth + 1; });`) === true, "Hindi: style buttons and panel labels fit");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-panel'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await theme(false);  await theme(true);
  await tap(`[data-act=vbpage][data-v=limits]`);
  ok(await until(`return !!document.querySelector('#smdNarke .vb-P-limits');`) && await noOverflow() === true, "Hindi limits page: no horizontal scroll");
  await tap(`[data-act=vbpage][data-v=main]`);
  await tap(`[data-act=lang]`);

  // Reduced motion: the explanation swaps without the slide
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tap(`[data-act=vbtile][data-k=ppeak]`);
  ok(await ev(`var i=document.getElementById('vbInfo'); return !i.classList.contains('vb-in') || getComputedStyle(i).animationName==='none';`) === true, "reduced motion: no slide on the explanation");
  await call("Emulation.setEmulatedMedia", { features: [] });
  await size(1280, 860); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); 
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vb-t'), function(b){ return b.scrollWidth <= b.clientWidth + 1; });`) === true, "1280 px: every panel number fits inside its key");
  await size(390, 844);
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vb-t'), function(b){ return b.scrollWidth <= b.clientWidth + 1; });`) === true, "390 px: every panel number fits inside its key");
  await tap(`[data-act=vbpage][data-v=limits]`);
  ok(await ev(`return [].every.call(document.querySelectorAll('#smdNarke .vb-t'), function(b){ return b.scrollWidth <= b.clientWidth + 1; });`) === true, "390 px limits page: every limit fits inside its key");

  const txt = await ev(`return document.getElementById("smdNarke").innerText;`), dm = /[\s\S]{0,60}[–—][\s\S]{0,60}/.exec(txt);
  ok(!dm, "no em or en dash on the bridge screens" + (dm ? ": " + dm[0] : ""));
  const own = errors.filter((x) => !/closeModal/.test(x));
  ok(own.length === 0, "no uncaught errors" + (own.length ? ": " + own.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē Ventilator Lab bridge UI" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
