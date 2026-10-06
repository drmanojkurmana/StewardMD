/* Narkē Ventilator Lab real-ventilator bridge (narke-vent-bridge.js) in headless Chrome: the lab home lists the five
 * bridge rows; Walk up to the bed ticks and completes; the screen map switches panel styles (labels change, layout
 * moves), a tapped number explains itself as SET or MEASURED, the quiz scores; mode names map to lab modes with the
 * never-alone tag; the 3 am drill gives feedback on a wrong order, a trap and a safe order with an SBAR script; the
 * never-alone card; back returns to the lab home on its row; Hindi, both themes, reduced motion, no horizontal scroll
 * at 390 px, 44 px targets, no dashes, no uncaught errors.
 * Content: narke/vent/bridge.json (read here, so no clinical text is hard-coded in the test).
 * USAGE: PORT=<free port> CHROME_PORT=<free port> node test/run-narke-vent-bridge-ui.mjs   (SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8983) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9683), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-vbridge-chrome-" + PORT;
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
  const J = JSON.parse(readFileSync(join(HERE, "..", "narke", "vent", "bridge.json"), "utf8"));
  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.removeItem("smd_narke_vent");localStorage.removeItem("smd_narke_vbridge");localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"mbbs",lang:"en",tab:"test"}));}catch(e){} document.body.className="dark"; document.body.innerHTML='<div id="smdNarke"></div>'; document.documentElement.style.zoom=1; NARKE.open(); return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._ventLab && window.NARKE_VENT_BRIDGE && NARKE_VENT_BRIDGE.homeBlock);`, 15000), "the bridge script loads after the lab");
  await ev(`NARKE._ventLab.open(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vl-home [data-act=vbopen]').length === 5;`, 15000), "the lab home lists five bridge rows");
  const rowsTop = await ev(`${R} var h=R.querySelector('#vbHomeH'), p=[].filter.call(R.querySelectorAll('.vl-home .sp-h2'), function(x){return x.id!=='vbHomeH';}); var pt=p.filter(function(x){return /Patients/.test(x.textContent);})[0]; return !!h && !!pt && h.getBoundingClientRect().top < pt.getBoundingClientRect().top;`);
  ok(rowsTop === true, "at Level 1 the bridge sits above the patients");
  ok(await noOverflow() === true, "home: no horizontal scroll at 390 px");
  { const sm = await small(); ok(sm === true, "home: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), h=document.getElementById('vbHomeH'); sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 60; return 1;`);
  await shot("01-390-dark-home-bridge");

  // Walk up to the bed
  { const r = await tap(`[data-act=vbopen][data-k=bed]`); ok(r === 1, "Walk up to the bed opens with a real tap" + (r === 1 ? "" : ": " + r)); }
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-chk').length === ${J.bed.groups.reduce((n, g) => n + g.items.length, 0)};`), "every checklist item is a toggle");
  ok(await ev(`${R} return R.querySelector('.vb-chk').getAttribute('data-k')==='pt' && /draft/i.test(R.querySelector('.sp-draft').textContent) && /clinical review/.test(R.querySelector('.vb-review').textContent);`) === true, "the patient comes first; the screen carries the draft footer and the clinical review note");
  { const r = await tap(`.vb-chk[data-k=pt]`); ok(r === 1 && await ev(`return document.querySelector('#smdNarke .vb-chk[data-k=pt]').getAttribute('aria-pressed')==='true' && /^1 of/.test(document.getElementById('vbProgT').textContent);`) === true, "a tap ticks an item and the count moves" + (r === 1 ? "" : ": " + r)); }
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute('data-k')==='pt';`) === true, "focus stays on the ticked item");
  await shot("02-390-dark-bed");
  await ev(`[].forEach.call(document.querySelectorAll('#smdNarke .vb-chk[aria-pressed=false]'), function(b){ b.click(); }); return 1;`);
  ok(await until(`var d=document.getElementById('vbBedDone'); return !d.hidden && d.classList.contains('on') && /All checked/.test(document.getElementById('vbProgT').textContent);`), "all ticked: the done card says what to write down");
  ok(await noOverflow() === true, "bed: no horizontal scroll"); { const sm = await small(); ok(sm === true, "bed: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await theme(false); await shot("03-390-light-bed-done"); await theme(true);
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .vl-home') && document.activeElement && document.activeElement.getAttribute('data-k')==='bed';`), "back returns to the lab home, focus on the row");
  ok(await ev(`return /12 of 12|of 12/.test(document.querySelector('#smdNarke [data-act=vbopen][data-k=bed]').textContent);`) === true, "the row shows the checklist progress");

  // Reading a real ventilator screen
  await tap(`[data-act=vbopen][data-k=screen]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-panel .vb-t').length === ${J.screen.tiles.length};`), "the panel shows every number as a button");
  ok(await ev(`${R} return R.querySelectorAll('.vb-setrow .vb-t.vb-set').length===5 && R.querySelectorAll('.vb-mcol .vb-t.vb-meas').length===7 && !!R.querySelector('.vb-top .vb-t.vb-set');`) === true, "SET keys along the bottom, MEASURED numbers in their own column, the mode on top");
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
  { const r = await tap(`[data-act=vbtile][data-k=fio2]`);
    ok(r === 1 && await until(`var i=document.getElementById('vbInfo'); return /SET/.test(i.querySelector('.vb-kind').textContent) && /policy/.test(i.textContent);`), "FiO2 is marked SET and carries the local-policy caveat" + (r === 1 ? "" : ": " + r)); }
  ok(await ev(`return /^2 of/.test(document.getElementById('vbOpened').textContent) && document.querySelectorAll('#smdNarke .vb-t.seen').length===2;`) === true, "learned numbers are counted and marked");
  ok(await ev(`return document.getElementById('vbInfo').getAttribute('aria-live')==='polite';`) === true, "the explanation is announced");
  { const sm = await small(); ok(sm === true, "screen map: every target is at least 44 px" + (sm === true ? "" : ": " + sm)); }
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-styles'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await shot("04-390-dark-screen-map"); await theme(false); await shot("05-390-light-screen-map"); await theme(true);
  await ev(`document.querySelector('#smdNarke .vb-labels').open=true; return 1;`);
  ok(await ev(`${R} return R.querySelectorAll('.vb-lrows > li').length === ${J.screen.labelRows.length} && /No logos/.test(R.querySelector('.vb-brand').textContent);`) === true, "label names by brand, as text, with the no-affiliation note");
  ok(await noOverflow() === true, "label map: no horizontal scroll");
  // quiz: one wrong, then the rest right
  for (let i = 0; i < J.screen.quiz.length; i++) {
    const Q = J.screen.quiz[i], pick = i === 0 ? (Q.answer + 1) % Q.options.length : Q.answer;
    const r = await tap(`#vbQuiz [data-act=vbqans][data-o="${pick}"]`);
    if (r !== 1) { ok(false, "quiz answer " + i + ": " + r); break; }
    if (i === 0) ok(await until(`var v=document.querySelector('#vbQuiz .vb-qv'); return !!v && v.classList.contains('bad') && document.activeElement===v;`), "a wrong answer says so, shows why and takes focus");
    await tap(`#vbQuiz [data-act=vbqnext]`);
  }
  ok(await until(`return /4 of 5/.test(document.querySelector('#vbQuiz .vb-qscore').textContent);`), "the quiz scores 4 of 5");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // Mode names
  await tap(`[data-act=vbopen][data-k=modes]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-mode').length === ${J.modes.items.length};`), "one card per mode family");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vb-mode'), function(c){ return !!c.querySelector('.vb-never') && /Closest in the lab/.test(c.querySelector('.vb-ml').textContent) && c.querySelector('.vb-ml').textContent.length > 25; });`) === true, "each mode names its closest lab mode and says do not change alone");
  ok(await ev(`return /intubated/.test(document.querySelector('#smdNarke .vb-modes').textContent);`) === true, "BiPAP versus BIPAP is explained");
  ok(await noOverflow() === true, "modes: no horizontal scroll");
  await shot("06-390-dark-modes");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);

  // 3 am drill
  await tap(`[data-act=vbopen][data-k=drills]`);
  ok(await until(`return document.querySelectorAll('#smdNarke [data-act=vbdrill]').length === ${J.drills.items.length} && !!document.querySelector('#smdNarke .vb-drows [data-act=vbopen][data-k=never]');`), "four drills and the never-alone card");
  await tap(`[data-act=vbdrill][data-k=highp]`);
  ok(await until(`return document.querySelectorAll('#smdNarke .vb-step').length === ${J.drills.items[0].steps.length} && document.querySelector('#smdNarke [data-act=vbcheck]').disabled;`), "the drill opens with every step in the pool and Check disabled");
  const bad = ["suction", "look", "bag", "dope", "call", "trap"];
  for (const id of bad) { const r = await tap(`.vb-step[data-k=${id}]`); if (r !== 1) { ok(false, "pick " + id + ": " + r); break; } }
  ok(await ev(`return document.querySelectorAll('#smdNarke .vb-ord li').length === 6 && !document.querySelector('#smdNarke .vb-step');`) === true, "picked steps move into Your order");
  await shot("07-390-dark-drill-picking");
  await tap(`[data-act=vbcheck]`);
  ok(await until(`${R} var v=R.querySelector('.vb-dv'); return !!v && v.classList.contains('bad') && R.querySelector('.vb-r.late') && R.querySelector('.vb-r.trap') && document.activeElement===v;`), "feedback: looking at the patient came too late, the trap is flagged, the verdict takes focus");
  ok(await ev(`return document.querySelectorAll('#smdNarke .vb-sbar dl > div').length === 4;`) === true, "the SBAR script follows the feedback");
  await shot("08-390-dark-drill-feedback");
  await tap(`[data-act=vbdagain]`);
  for (const id of ["look", "bag", "dope", "suction", "call"]) await tap(`.vb-step[data-k=${id}]`);
  await tap(`[data-act=vbcheck]`);
  ok(await until(`var v=document.querySelector('#smdNarke .vb-dv'); return !!v && v.classList.contains('ok') && document.querySelectorAll('#smdNarke .vb-r.trap').length===0;`), "a safe order (trap left out) passes");
  ok(await noOverflow() === true, "drill: no horizontal scroll"); { const sm = await small(); ok(sm === true, "drill: 44 px targets" + (sm === true ? "" : ": " + sm)); }
  await theme(false); await shot("09-390-light-drill-safe"); await theme(true);
  await ev(`NARKE.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=vbdrill]') && document.activeElement && document.activeElement.getAttribute('data-k')==='highp' && /Done/.test(document.querySelector('#smdNarke [data-act=vbdrill][data-k=highp]').textContent);`), "back returns to the drill list on that drill, marked done");

  // Never alone
  await tap(`.vb-drows [data-act=vbopen][data-k=never]`);
  ok(await until(`${R} return R.querySelectorAll('.vb-list.ok li').length===${J.never.may.length} && R.querySelectorAll('.vb-list.no li').length===${J.never.mayNot.length} && R.querySelectorAll('.vb-list.call li').length===${J.never.callNow.length};`), "never-alone: may, not alone, call now");
  ok(await noOverflow() === true, "never-alone: no horizontal scroll");

  // Hindi
  await tap(`[data-act=lang]`);
  ok(await until(`${R} return R.getAttribute('lang')==='hi' && /[\\u0900-\\u097F]/.test(R.querySelector('.vb-nv').textContent);`), "Hindi switches the never-alone card");
  ok(await ev(`return !document.querySelector('#smdNarke .vb-wrap [lang=en]') && !/[\\u0966-\\u096F]/.test(document.getElementById('smdNarke').innerText);`) === true, "Hindi: no English fallback, ASCII digits");
  await shot("10-390-dark-never-hindi");
  await ev(`NARKE.back(); return 1;`); await until(`return !!document.querySelector('#smdNarke .vl-home');`);
  await tap(`[data-act=vbopen][data-k=screen]`);
  await until(`return !!document.querySelector('#smdNarke .vb-panel');`);
  await tap(`[data-act=vbtile][data-k=pplat]`);
  ok(await until(`return /[\\u0900-\\u097F]/.test(document.getElementById('vbInfo').textContent) && /[\\u0900-\\u097F]/.test(document.querySelector('#smdNarke .vb-styles').textContent);`), "Hindi: the screen map and its explanation");
  ok(await noOverflow() === true, "Hindi screen map: no horizontal scroll");
  ok(await ev(`${R} return [].every.call(R.querySelectorAll('.vb-styles button, .vb-tl'), function(e){ return e.scrollWidth <= e.clientWidth + 1; });`) === true, "Hindi: style buttons and panel labels fit");
  await ev(`var sc=document.querySelector('#smdNarke .sp-scroll'), el=document.querySelector('#smdNarke .vb-panel'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8; return 1;`);
  await theme(false); await shot("11-390-light-screen-hindi"); await theme(true);
  await tap(`[data-act=lang]`);

  // Reduced motion: the explanation swaps without the slide
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tap(`[data-act=vbtile][data-k=ppeak]`);
  ok(await ev(`var i=document.getElementById('vbInfo'); return !i.classList.contains('vb-in') || getComputedStyle(i).animationName==='none';`) === true, "reduced motion: no slide on the explanation");
  await call("Emulation.setEmulatedMedia", { features: [] });
  await size(1280, 860); await ev(`document.querySelector('#smdNarke .sp-scroll').scrollTop=0; return 1;`); await shot("12-1280-dark-screen-map"); await size(390, 844);

  const txt = await ev(`return document.getElementById("smdNarke").innerText;`), dm = /[\s\S]{0,60}[–—][\s\S]{0,60}/.exec(txt);
  ok(!dm, "no em or en dash on the bridge screens" + (dm ? ": " + dm[0] : ""));
  const own = errors.filter((x) => !/closeModal/.test(x));
  ok(own.length === 0, "no uncaught errors" + (own.length ? ": " + own.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē Ventilator Lab bridge UI" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
