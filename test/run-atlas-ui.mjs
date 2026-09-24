/* RadioAnatome 2D slice viewer — real headless-browser test (CDP).
 * Drives the real app at a 390x844 phone viewport with emulated TOUCH (real pinch, drag, tap,
 * double-tap through Input.dispatchTouchEvent) and then at 1024x768. Proves: the slice fills
 * the phone width in Pins mode; Labels mode draws one label per structure and nothing lands
 * under the sheet or the top bar; zoom/pan keeps every pin on its structure; flipX mirrors
 * pins; the ruler reports mm; windows swap images; quiz scoring; sheet focus in/out; cine and
 * momentum; rapid module switching ends on the last module; openAt still locks.
 * USAGE: node test/run-atlas-ui.mjs          (starts test/serve.mjs on :8996 if needed)
 *        BASE=http://localhost:8996/ SHOTS=/tmp/atlas-ui-shots node test/run-atlas-ui.mjs
 * localhost, not 127.0.0.1: the page CSP's upgrade-insecure-requests broke stylesheets there.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/atlas-ui-chrome";
const SHOTS = process.env.SHOTS || "/tmp/atlas-ui-shots";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MOD = "ct-live-torso-axial";
mkdirSync(SHOTS, { recursive: true });
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8996"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--mute-audio", "--hide-scrollbars", "--window-size=1024,900"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (c) passes++; else fails++; };
const until = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(120); } return false; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name), Buffer.from(r.result.data, "base64")); console.log("  shot " + join(SHOTS, name)); };

// ---- touch helpers (CSS px, viewport coordinates) ----
const touch = (type, pts) => call("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
async function tap(x, y) { await touch("touchStart", [[x, y]]); await sleep(40); await touch("touchEnd", []); await sleep(60); }
// hold: rest the finger before lifting, so the release carries no flick velocity.
async function drag(x0, y0, x1, y1, steps = 12, stepMs = 16, hold = 0) {
  await touch("touchStart", [[x0, y0]]);
  for (let i = 1; i <= steps; i++) { await sleep(stepMs); await touch("touchMove", [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); }
  if (hold) await sleep(hold);
  await touch("touchEnd", []); await sleep(80);
}
async function pinch(cx, cy, r0, r1, steps = 10) {
  await touch("touchStart", [[cx - r0, cy], [cx + r0, cy]]);
  for (let i = 1; i <= steps; i++) { const r = r0 + (r1 - r0) * i / steps; await sleep(16); await touch("touchMove", [[cx - r, cy], [cx + r, cy]]); }
  await touch("touchEnd", []); await sleep(120);
}
const key = async (k, code) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "Escape" ? 27 : 0 }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k }); await sleep(80); };

async function viewport(w, h, mobile) {
  await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await ev(`window.dispatchEvent(new Event('resize')); return 1;`);
  await settleZoom();
}
// home.js auto-fit sets documentElement.style.zoom asynchronously (0.95 below 400 px wide). On a
// device the ResizeObserver repaints the overlay after that; headless Chrome never fires
// ResizeObserver, so wait for the zoom to hold still, then send the resize the viewer listens to.
async function settleZoom() {
  let last = null, same = 0;
  for (let i = 0; i < 40 && same < 4; i++) { const z = await ev(`return document.documentElement.style.zoom || '1'`); same = z === last ? same + 1 : 0; last = z; await sleep(100); }
  await ev(`window.dispatchEvent(new Event('resize')); return 1;`);
}
async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await viewport(390, 844, true);
  await call("Page.navigate", { url });
  return until(`return !!(window.ATLAS && ATLAS.open && ATLAS._pure && ATLAS._pure.zoomAt)`, 30000);
}
const clearIntro = () => ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
// The slice is up and its pins are drawn.
const ready = () => until(`var s=document.getElementById('atlasStage'), i=document.getElementById('atlasImg'); return !!(s && i && i.complete && i.naturalWidth>0 && !s.classList.contains('is-loading') && ATLAS._view());`, 20000);
const rect = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};`);
const overlap = (a, b) => !!(a && b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5);
// Stage-relative placed pins -> viewport coordinates. k is the app's document zoom (its
// Display text-size setting), which scales viewport px but not the stage's layout px.
const pinsVp = () => ev(`var st=document.getElementById('atlasStage'), r=st.getBoundingClientRect(), k=r.width/st.clientWidth; return ATLAS._placed().filter(function(p){return p.vis}).map(function(p){return {s:p.s,x:r.left+p.x*k,y:r.top+p.y*k,px:p.px,py:p.py}});`);
// Every drawn dot sits where the TRANSFORMED image says its structure is.
const pinDrift = () => ev(`
  var img=document.getElementById('atlasImg').getBoundingClientRect(), v=ATLAS._view(), max=0, n=0;
  var dots=[].slice.call(document.querySelectorAll('#atlasOv circle.atlas-dot'));
  var pl=ATLAS._placed().filter(function(p){return p.vis});
  dots.forEach(function(d,i){ var p=pl[i]; if(!p) return; var b=d.getBoundingClientRect(), cx=b.left+b.width/2, cy=b.top+b.height/2;
    var a=p.px/100; if(v.flip) a=1-a; var ex=img.left+a*img.width, ey=img.top+(p.py/100)*img.height;
    max=Math.max(max, Math.abs(cx-ex), Math.abs(cy-ey)); n++; });
  return {max:max, n:n, dots:dots.length};`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  ok(await attach(BASE), "app loads with the new ATLAS build");
  await clearIntro();
  await settleZoom();
  await ev(`try{localStorage.removeItem('smd_atlas_labels')}catch(e){} window.__roDisc=0; var D=ResizeObserver.prototype.disconnect; ResizeObserver.prototype.disconnect=function(){window.__roDisc++; return D.apply(this,arguments)}; return 1;`);
  await ev(`ATLAS.open(${JSON.stringify(MOD)}); return 1;`);
  ok(await ready(), "torso axial module opens and slice 1 renders");
  // Module fields come from the data agent's modules.json; tests that need a field absent or
  // different change it in memory and restore this snapshot.
  await ev(`window.__meta=function(){return ATLAS._state.catalog.modules.filter(function(m){return m.id===${JSON.stringify(MOD)}})[0]}; window.__snap=JSON.stringify(__meta()); window.__restore=function(){var m=__meta(), o=JSON.parse(__snap); Object.keys(m).forEach(function(k){delete m[k]}); Object.assign(m,o);}; return 1;`);
  const shipped = await ev(`return JSON.stringify({flipX:__meta().flipX, orient:__meta().orient, mm:__meta().mm, w:(__meta().windows||[]).length})`);
  console.log("  shipped torso-axial fields: " + shipped);
  await ev(`ATLAS._setSlice(6); return 1;`); ok(await ready(), "slice 6 (25 pins, 15 structures) renders");

  // ---------------- 390x844: Pins mode ----------------
  ok(await ev(`return document.querySelector('#atlasTools [data-atlas-act=mode][aria-pressed=true]').getAttribute('data-v');`) === "pins", "narrow portrait defaults to Pins mode");
  const iw = await ev(`return document.getElementById('atlasImg').getBoundingClientRect().width / innerWidth;`);
  ok(iw >= 0.85, "Pins mode: the slice fills " + (iw * 100).toFixed(1) + "% of the phone width (>= 85%; was 219/390 = 56%)");
  ok(await ev(`return document.querySelectorAll('#atlasOv circle.atlas-dot').length === ATLAS._state.atlas.slices[5].pins.length;`), "every pin is drawn");
  const stops = await ev(`var t=[].slice.call(document.querySelectorAll('#atlasOv [tabindex="0"]')).map(function(e){return e.getAttribute('data-atlas-s')}); var u={}; t.forEach(function(s){u[s]=(u[s]||0)+1}); return {n:t.length, dup:Object.keys(u).filter(function(k){return u[k]>1}).length, uniq:new Set(ATLAS._state.atlas.slices[5].pins.map(function(p){return p.s})).size};`);
  ok(stops.n === stops.uniq && stops.dup === 0, "exactly one tab stop per structure (" + stops.n + " stops, " + stops.uniq + " structures)");
  ok(await ev(`return !document.querySelector('#atlasOv text.atlas-lab');`), "Pins mode draws no gutter labels or leader lines");
  await shot("390-pins.png");

  // Tap a pin with a real touch: callout pill beside it + sheet peek, focus moves into the sheet.
  let pins = await pinsVp();
  const tgt = pins.find((p) => p.s === "liver") || pins[0];
  await tap(tgt.x + 3, tgt.y + 2);
  ok(await until(`return ATLAS._state.sel===${JSON.stringify(tgt.s)}`), "a touch tap near a pin selects its structure (" + tgt.s + ")");
  ok(await until(`var sh=document.getElementById('atlasSheet'); return !!sh && sh.classList.contains('on') && !sh.classList.contains('full')`), "the sheet peeks");
  ok(await ev(`return !!document.activeElement && document.getElementById('atlasSheet').contains(document.activeElement);`), "focus moves into the sheet on open");
  const call1 = await rect("#atlasOv .atlas-call"), sheetR = await rect("#atlasSheet"), stageR = await rect("#atlasStage");
  ok(!!call1 && /Liver|/.test(await ev(`return document.querySelector('#atlasOv .atlas-call').textContent`)), "a callout pill names the structure beside the pin");
  ok(call1 && Math.abs((call1.t + call1.b) / 2 - tgt.y) < 30 && (call1.l > tgt.x || call1.r < tgt.x), "the callout sits beside the tapped pin");
  ok(!overlap(call1, sheetR) && call1.t >= stageR.t && call1.b <= stageR.b, "the callout is inside the stage and not under the sheet");
  await shot("390-pins-callout.png");
  await key("Escape");
  ok(await until(`return !document.getElementById('atlasSheet').classList.contains('on') && ATLAS._state.sel===null`), "Escape closes the sheet");

  // Keyboard: focus a pin, Enter opens the sheet with focus inside, Escape returns focus to the pin.
  await ev(`document.querySelector('#atlasOv [tabindex="0"][data-atlas-s="aorta"]').focus(); return 1;`);
  await key("Enter");
  ok(await until(`var sh=document.getElementById('atlasSheet'); return sh.classList.contains('on') && sh.contains(document.activeElement) && ATLAS._state.sel==='aorta'`), "Enter on a focused pin opens its sheet and focus goes in");
  await key("Escape");
  ok(await until(`var a=document.activeElement; return !document.getElementById('atlasSheet').classList.contains('on') && !!a && a.getAttribute('data-atlas-s')==='aorta'`), "Escape returns focus to the same structure's pin");

  // ---------------- Labels mode ----------------
  await ev(`document.querySelector('#atlasTools [data-atlas-act=mode][data-v=labels]').click(); return 1;`);
  ok(await ev(`try{return localStorage.getItem('smd_atlas_labels')==='labels'}catch(e){return false}`), "the label mode is persisted");
  const lab = await ev(`var L=[].slice.call(document.querySelectorAll('#atlasOv text.atlas-lab')).map(function(e){return e.getAttribute('data-atlas-s')}); var u=new Set(L); var vis=new Set(ATLAS._placed().filter(function(p){return p.vis}).map(function(p){return p.s})); return {n:L.length, u:u.size, vis:vis.size};`);
  ok(lab.n === lab.u && lab.n === lab.vis, "Labels mode: one label per structure (" + lab.n + " labels, " + lab.vis + " structures)");
  ok(await ev(`return document.querySelectorAll('#atlasOv line.atlas-lead').length === ATLAS._placed().filter(function(p){return p.vis}).length;`), "... with one leader per pin");
  const boxesClear = async (label) => {
    const r = await ev(`var top=document.querySelector('#smdAtlas .atlas-top').getBoundingClientRect(), tools=document.getElementById('atlasTools').getBoundingClientRect(), sh=document.getElementById('atlasSheet'), s=sh&&sh.classList.contains('on')?sh.getBoundingClientRect():null, bad=[];
      function ov(a,b){return a.left<b.right-0.5&&a.right>b.left+0.5&&a.top<b.bottom-0.5&&a.bottom>b.top+0.5}
      [].slice.call(document.querySelectorAll('#atlasOv text.atlas-lab, #atlasOv .atlas-call')).forEach(function(e){var b=e.getBoundingClientRect(); if(ov(b,top)||ov(b,tools)||(s&&ov(b,s))) bad.push(e.textContent);});
      return {bad:bad, n:document.querySelectorAll('#atlasOv text.atlas-lab').length, sheet:!!s};`);
    ok(r.bad.length === 0 && r.n > 0, label + ": no label box overlaps the top bar, the tool row" + (r.sheet ? " or the sheet" : "") + (r.bad.length ? " (" + r.bad.join(", ") + ")" : ""));
  };
  await boxesClear("390 Labels");
  await shot("390-labels.png");
  await ev(`ATLAS._select('kidney'); return 1;`);
  ok(await until(`return document.getElementById('atlasSheet').classList.contains('on')`), "selecting a structure opens the sheet in Labels mode");
  await sleep(350);
  await boxesClear("390 Labels + sheet");
  ok(await ev(`return document.querySelectorAll('#atlasOv text.atlas-lab.on').length===1`), "the selected structure's one label is highlighted");
  await shot("390-labels-sheet.png");
  await ev(`ATLAS._select(null); document.querySelector('#atlasTools [data-atlas-act=mode][data-v=off]').click(); return 1;`);
  ok(await ev(`return !document.querySelector('#atlasOv circle, #atlasOv text.atlas-lab')`), "Off mode shows the clean image");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=mode][data-v=pins]').click(); return 1;`);

  // ---------------- structures list ----------------
  await ev(`document.querySelector('#smdAtlas [data-atlas-act=list]').click(); return 1;`);
  ok(await until(`var sh=document.getElementById('atlasSheet'); return sh.classList.contains('on') && sh.classList.contains('full') && sh.querySelectorAll('.atlas-li').length===new Set(ATLAS._state.atlas.slices[5].pins.map(function(p){return p.s})).size`), "'On this slice' lists every structure once");
  ok(await ev(`return document.getElementById('atlasSheet').contains(document.activeElement)`), "the list sheet takes focus");
  await ev(`document.querySelector('#atlasSheet .atlas-li[data-atlas-s=spleen], #atlasSheet .atlas-li').click(); return 1;`);
  ok(await until(`return !!ATLAS._state.sel && document.getElementById('atlasSheet').classList.contains('on') && !document.getElementById('atlasSheet').classList.contains('full')`), "picking from the list selects the structure");
  await key("Escape");
  ok(await until(`var a=document.activeElement; return !document.getElementById('atlasSheet').classList.contains('on') && !!a && a.getAttribute('data-atlas-act')==='list'`), "closing returns focus to the list button");

  // ---------------- zoom / pan (real touch) ----------------
  let st0 = await rect("#atlasStage");
  const cx = st0.l + st0.w / 2, cy = st0.t + st0.h * 0.45;
  await pinch(cx, cy, 40, 120);
  const s1 = await ev(`return ATLAS._state.z.s`);
  ok(s1 > 2.4 && s1 < 3.6, "a two-finger pinch zooms (" + (+s1).toFixed(2) + "x)");
  let dr = await pinDrift();
  ok(dr.n > 0 && dr.max < 1.5, "zoomed: every visible pin stays on its structure (max drift " + dr.max.toFixed(2) + " px over " + dr.n + " pins)");
  ok(await ev(`return !!document.querySelector('#atlasHud .atlas-zoom')`), "a Reset zoom control appears");
  const pxBefore = await ev(`return ATLAS._state.z.px`);
  await drag(cx, cy, cx - 90, cy + 40, 10);
  ok(Math.abs((await ev(`return ATLAS._state.z.px`)) - pxBefore) > 20 && (await ev(`return ATLAS._state.slice`)) === 6, "zoomed one-finger drag pans (and does not scrub)");
  dr = await pinDrift();
  ok(dr.n > 0 && dr.max < 1.5, "panned: pins still on their structures (max drift " + dr.max.toFixed(2) + " px)");
  await drag(cx, cy, cx + 3000, cy + 3000, 6);
  ok(await ev(`var i=document.getElementById('atlasImg').getBoundingClientRect(), s=document.getElementById('atlasStage').getBoundingClientRect(); return i.left<=s.left+0.5 && i.top<=s.top+0.5;`), "pan is clamped (the image never leaves an empty band)");
  await shot("390-zoomed.png");
  await ev(`document.querySelector('#atlasHud .atlas-zoom').click(); return 1;`);
  ok(await ev(`return ATLAS._state.z.s===1 && !document.querySelector('#atlasHud .atlas-zoom')`), "Reset zoom returns to 1x");
  await tap(cx, cy); await sleep(70); await tap(cx, cy);
  ok(await until(`return ATLAS._state.z.s > 2.4`), "double-tap zooms in");
  await sleep(400); await tap(cx, cy); await sleep(70); await tap(cx, cy);
  ok(await until(`return ATLAS._state.z.s === 1`), "double-tap again resets");

  // ---------------- scrub + momentum + cine ----------------
  await ev(`ATLAS._setSlice(6); return 1;`); await ready(); await sleep(400);
  await drag(cx, cy + 60, cx, cy - 80, 14, 20, 150);        // drag up 140 px (~10 slices), then rest
  const afterSlow = await ev(`return ATLAS._state.slice`);
  ok(afterSlow >= 14 && afterSlow <= 17, "unzoomed vertical drag scrubs slices (6 -> " + afterSlow + ")");
  await ev(`ATLAS._setSlice(3); return 1;`); await sleep(400);
  await touch("touchStart", [[cx, cy + 60]]);
  for (let i = 1; i <= 5; i++) { await sleep(12); await touch("touchMove", [[cx, cy + 60 - i * 14]]); }
  await touch("touchEnd", []);
  await sleep(900);
  // The finger itself moved 70 px = 5 slices (3 -> 8); anything past 8 is momentum, and the
  // velocity cap keeps it from running the whole stack.
  const coasted = await ev(`return ATLAS._state.slice`);
  ok(coasted >= 10 && coasted <= 18, "a flick carries on with momentum, capped (finger reached 8, coasted to " + coasted + ")");
  await ev(`ATLAS._setSlice(2); return 1;`); await sleep(300);
  await ev(`document.getElementById('atlasCine').click(); return 1;`);
  await sleep(900);
  const cineSl = await ev(`return ATLAS._state.slice`);
  ok(cineSl >= 5 && (await ev(`return document.getElementById('atlasCine').getAttribute('aria-pressed')`)) === "true", "cine plays at about 6 fps (2 -> " + cineSl + " in 0.9 s)");
  await tap(cx, st0.t + 10);
  const stopped = await ev(`return ATLAS._state.slice`); await sleep(500);
  ok((await ev(`return ATLAS._state.slice`)) === stopped && (await ev(`return document.getElementById('atlasCine').getAttribute('aria-pressed')`)) === "false", "any touch stops cine");

  // ---------------- flipX + orientation ----------------
  await ev(`ATLAS._setSlice(6); return 1;`); await ready();
  await ev(`var m=__meta(); delete m.flipX; delete m.orient; ATLAS._draw(); return 1;`);
  const unflipped = await ev(`return ATLAS._placed().map(function(p){return p.x})`);
  await ev(`var m=__meta(); m.flipX=true; m.orient={left:'R',right:'L',top:'A',bottom:'P'}; ATLAS._draw(); return 1;`);
  const v = await ev(`return ATLAS._view()`);
  const flipped = await ev(`return ATLAS._placed().map(function(p){return p.x})`);
  ok(flipped.length && flipped.every((x, i) => Math.abs(x - (2 * (v.D.x + v.D.w / 2) - unflipped[i])) < 0.01), "flipX mirrors every pin about the image centre" + (process.env.DIAG ? JSON.stringify({v, u: unflipped.slice(0,3), f: flipped.slice(0,3)}) : ""));
  ok(/scale\(-[0-9.]+, *[0-9.]+\)/.test(await ev(`return document.getElementById('atlasImg').style.transform`)), "flipX mirrors the image itself");
  dr = await pinDrift();
  ok(dr.max < 1.5, "flipped: pins stay on their mirrored structures (max drift " + dr.max.toFixed(2) + " px)");
  ok(await ev(`return [].slice.call(document.querySelectorAll('#atlasOv .atlas-orient')).map(function(e){return e.textContent}).join('')==='RLAP'`), "orientation letters are drawn from module.orient");
  await shot("390-flip-orient.png");
  await ev(`__restore(); ATLAS._draw(); return 1;`);

  // ---------------- Adjust (no windows) ----------------
  await ev(`delete __meta().windows; return 1;`);
  await ev(`document.querySelector('#atlasTools [data-atlas-act=panel]').click(); return 1;`);
  ok(await ev(`var b=document.querySelector('#atlasTools [data-atlas-act=panel]'); return b.getAttribute('aria-label')==='Adjust brightness and contrast' && !!document.querySelector('#atlasPanel input[data-adj=b]') && !/window/i.test(document.getElementById('atlasPanel').textContent)`), "without module.windows the control is an honest 'Adjust', never called a window" + (process.env.DIAG ? await ev('return document.getElementById("atlasTools").outerHTML.slice(0,600)') : ""));
  await ev(`var i=document.querySelector('#atlasPanel input[data-adj=b]'); i.value=150; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(/brightness\(150%\)/.test(await ev(`return document.getElementById('atlasImg').style.filter`)), "brightness applies as a CSS filter");
  await ev(`document.querySelector('#atlasPanel [data-atlas-act=adjreset]').click(); document.querySelector('#atlasTools [data-atlas-act=panel]').click(); __restore(); return 1;`);

  // ---------------- Quiz: Name it ----------------
  await ev(`document.querySelector('#atlasTools [data-atlas-act=quiz]').click(); return 1;`);
  ok(await ev(`return ATLAS._state.quiz && ATLAS._state.quiz.kind==='name' && !/Liver|Aorta|Kidney/.test(document.getElementById('atlasOv').innerHTML)`), "Name it: pins shown, names hidden");
  pins = await pinsVp();
  const nq = pins.find((p) => p.s === "aorta") || pins[0];
  await tap(nq.x, nq.y);
  ok(await until(`return !!document.querySelector('#atlasOv .atlas-call.card [data-atlas-act=qmark]')`), "tapping a pin reveals its name with self-mark buttons");
  await ev(`document.querySelector('#atlasOv [data-atlas-act=qmark][data-v="1"]').click(); return 1;`);
  ok(await ev(`var q=ATLAS._state.quiz; return q.score===1 && q.asked===1 && document.querySelector('#atlasTools .atlas-score').textContent==='1/1'`), "self-marking 'Knew it' scores 1/1");
  await shot("390-quiz-name.png");

  // ---------------- Quiz: Find it ----------------
  await ev(`document.querySelector('#atlasTools [data-atlas-act=qkind][data-v=find]').click(); return 1;`);
  ok(await ev(`var q=ATLAS._state.quiz; return q.kind==='find' && !!q.target && q.score===0 && !document.querySelector('#atlasOv circle.atlas-dot') && /Find:/.test(document.getElementById('atlasHud').textContent)`), "Find it: prompts a structure on this slice, no pins shown");
  let target = await ev(`return ATLAS._state.quiz.target`);
  pins = await pinsVp();
  const hit = pins.find((p) => p.s === target);
  await tap(hit.x, hit.y);
  ok(await until(`var q=ATLAS._state.quiz; return !!q.answered && q.answered.ok===true && q.score===1 && q.asked===1`), "tapping the target is marked correct (1/1)");
  ok(await ev(`return !!document.querySelector('#atlasOv .atlas-call.ok') && !!document.querySelector('#atlasTools [data-atlas-act=qnext]')`), "correct feedback and a Next button");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=qnext]').click(); return 1;`);
  target = await ev(`return ATLAS._state.quiz.target`);
  pins = await pinsVp();
  const tp = pins.filter((p) => p.s === target);
  const wrong = pins.filter((p) => p.s !== target).sort((a, b) => Math.min(...tp.map((q) => Math.hypot(q.x - b.x, q.y - b.y))) - Math.min(...tp.map((q) => Math.hypot(q.x - a.x, q.y - a.y))))[0];
  await tap(wrong.x, wrong.y);
  ok(await until(`var q=ATLAS._state.quiz; return !!q.answered && q.answered.ok===false && q.score===1 && q.asked===2`), "tapping a different structure is marked wrong (1/2)");
  ok(await ev(`return !!document.querySelector('#atlasOv .atlas-call.bad') && !!document.querySelector('#atlasOv .atlas-tapmark.qbad') && document.querySelectorAll('#atlasOv circle.atlas-dot').length>=1`), "wrong feedback reveals the target and marks the tap");
  await shot("390-quiz-find.png");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=qexit]').click(); return 1;`);
  ok(await ev(`return ATLAS._state.quiz===null && !!document.querySelector('#atlasTools [data-atlas-act=mode]')`), "Exit leaves the quiz");

  // ---------------- Ruler + windows (module fields injected, as the data agent will ship them) ----------------
  // mm is overridden with round numbers so the expected reading is exact; windows are the shipped ones.
  await ev(`__meta().mm=[400,346.5]; ATLAS._openModule(${JSON.stringify(MOD)}); return 1;`);
  ok(await ready(), "module reopens with mm + windows");
  await ev(`ATLAS._setSlice(6); return 1;`); await ready();
  await ev(`document.querySelector('#atlasTools [data-atlas-act=ruler]').click(); return 1;`);
  const ir = await rect("#atlasImg");
  await tap(ir.l + ir.w * 0.25, ir.t + ir.h * 0.5); await sleep(400);
  await tap(ir.l + ir.w * 0.75, ir.t + ir.h * 0.5); await sleep(200);
  const mmTxt = await ev(`return document.getElementById('atlasHud').textContent`);
  ok(/^\s*(19[5-9]|20[0-5])(\.\d)? mm\s*$/.test(mmTxt), "ruler: half the image width of a 400 mm image reads ~200 mm (" + mmTxt.trim() + ")");
  await pinch(ir.l + ir.w / 2, ir.t + ir.h / 2, 40, 100);
  ok((await ev(`return document.getElementById('atlasHud').textContent`)).includes(mmTxt.trim()), "the measurement is unchanged by zoom");
  await ev(`document.querySelector('#atlasHud .atlas-zoom') && document.querySelector('#atlasHud .atlas-zoom').click(); document.querySelector('#atlasTools [data-atlas-act=ruler]').click(); return 1;`);
  await ev(`document.querySelector('#atlasTools [data-atlas-act=panel]').click(); return 1;`);
  ok(await ev(`return document.querySelector('#atlasTools [data-atlas-act=panel]').getAttribute('aria-label')==='Window' && document.querySelectorAll('#atlasPanel [data-atlas-act=win]').length===3`), "module.windows shows window chips");
  await ev(`document.querySelector('#atlasPanel [data-atlas-act=win][data-v=lung]').click(); return 1;`);
  ok(/\/atlas\/ct-live-torso-axial\/w\/lung\/006\.webp$/.test(await ev(`return document.getElementById('atlasImg').getAttribute('src')`)), "a window swaps to /atlas/<module>/w/<id>/NNN.webp with the same NNN");
  ok(await until(`var s=document.getElementById('atlasStage'), i=document.getElementById('atlasImg'); return i.complete && i.naturalWidth>0 && !s.classList.contains('is-error') && !s.classList.contains('is-loading')`), "the shipped lung-window image loads and the pins come back");
  await ev(`document.querySelector('#atlasPanel [data-atlas-act=win][data-v=lung]').setAttribute('data-x','1'); return 1;`);
  await shot("390-window-lung.png");
  await ev(`document.querySelector('#atlasPanel [data-atlas-act=win][data-v=soft]').click(); return 1;`);
  ok(/\/atlas\/ct-live-torso-axial\/006\.webp$/.test(await ev(`return document.getElementById('atlasImg').getAttribute('src')`)), "the first window is the original image");
  ok(await until(`var s=document.getElementById('atlasStage'); return /w\\/lung/.test(document.getElementById('atlasImg').src)===false && !s.classList.contains('is-error')`), "the shipped soft-tissue image loads after switching back");
  await ev(`__restore(); return 1;`);

  // ---------------- lifecycle: ResizeObserver, rapid switching, openAt ----------------
  ok(await ev(`return ATLAS.back()===true && !document.getElementById('atlasPanel') && ATLAS._state.view==='viewer'`), "back() closes the open panel first, one layer at a time");
  const disc0 = await ev(`return window.__roDisc`);
  await ev(`ATLAS.back(); return 1;`);
  ok(await ev(`return ATLAS._state.view==='catalog' && window.__roDisc>${disc0}`), "leaving the viewer disconnects the ResizeObserver");
  await ev(`window.__of=window.__of||window.fetch; window.fetch=function(u){ var d=/ct-head-axial\\/atlas\\.json/.test(String(u))?1500:/ct-abdomen-axial\\/atlas\\.json/.test(String(u))?700:0; var a=arguments, self=this; return new Promise(function(r){setTimeout(r,d)}).then(function(){return window.__of.apply(self,a)}); }; return 1;`);
  await until(`return !!document.querySelector('#smdAtlas .atlas-row[data-atlas-mod="ct-head-axial"]')`);
  // Tap a module, back, tap another, back, tap a third: all within one tick, while the first two
  // module fetches are still in flight (1.5 s and 0.7 s) and the last resolves at once.
  await ev(`['ct-head-axial','ct-abdomen-axial','ct-knee-axial'].forEach(function(id, i){ if (i) ATLAS.back(); document.querySelector('#smdAtlas .atlas-row[data-atlas-mod="'+id+'"]').click(); }); return 1;`);
  await sleep(2200);
  ok(await ev(`var s=ATLAS._state; return s.moduleId==='ct-knee-axial' && !!s.atlas && s.atlas.id==='ct-knee-axial' && /ct-knee-axial/.test(document.getElementById('atlasImg').getAttribute('src'))`), "rapid switching (slow, slower, fast) ends on the LAST module" + (process.env.DIAG ? await ev('var s=ATLAS._state; return JSON.stringify({m:s.moduleId, a:s.atlas&&s.atlas.id, v:s.view, src:(document.getElementById("atlasImg")||{}).src, rows:document.querySelectorAll("#smdAtlas .atlas-row").length})') : ""));
  await ev(`window.fetch=window.__of; return 1;`);
  await ev(`ATLAS.openAt('ct-live-torso-axial','kidney',5); return 1;`);
  ok(await until(`var sh=document.getElementById('atlasSheet'); return ATLAS._state.moduleId==='ct-live-torso-axial' && ATLAS._state.locked==='kidney' && ATLAS._state.sel==='kidney' && ATLAS._state.slice===5 && !!sh && sh.classList.contains('on')`), "openAt(module, structure, slice) still opens, jumps and locks");
  ok(await ev(`return ATLAS._state.z.s===1 && ATLAS._state.quiz===null && ATLAS._state.ruler===null`), "a new module visit starts clean (zoom, quiz, ruler reset)");
  await ev(`ATLAS.close(); return 1;`);
  ok(await ev(`return !ATLAS.isOpen() && !document.body.classList.contains('atlas-lock')`), "close() closes the atlas");

  // ---------------- small phone, landscape phone, reduced motion ----------------
  await viewport(375, 667, true);
  await ev(`ATLAS.open(${JSON.stringify(MOD)}); return 1;`); await ready(); await ev(`ATLAS._draw(); return 1;`);
  ok(await ev(`var t=document.querySelector('#atlasTools .atlas-tools-in'), k=t.getBoundingClientRect().width/t.clientWidth; return t.scrollWidth <= t.clientWidth + 1 && [].slice.call(t.querySelectorAll('button')).every(function(b){var r=b.getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.height / k >= 44 - 0.5;})`), "375x667: the tool row fits with no overflow, every target >= 44 CSS px tall");
  await shot("375-pins.png");
  await viewport(844, 390, true);
  await ev(`ATLAS._draw(); return 1;`);
  const land = await ev(`var i=document.getElementById('atlasImg').getBoundingClientRect(); return {h:i.height, mode:document.querySelector('#atlasTools [data-atlas-act=mode][aria-pressed=true]').getAttribute('data-v')}`);
  ok(land.h >= 150 && land.mode === "pins", "844x390 landscape phone: Pins mode, slice " + Math.round(land.h) + " px tall");
  await shot("844-landscape.png");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await viewport(390, 844, true);
  await ev(`ATLAS.close(); ATLAS.open(${JSON.stringify(MOD)}); return 1;`); await ready();
  ok(await ev(`return !document.getElementById('atlasCine') && !!document.getElementById('atlasRange')`), "prefers-reduced-motion: no cine control is offered");
  await call("Emulation.setEmulatedMedia", { features: [] });
  await ev(`ATLAS.close(); return 1;`);

  // ---------------- 1024x768 ----------------
  await viewport(1024, 768, false);
  // A fresh visitor: nothing chosen this session, nothing stored.
  await ev(`try{localStorage.removeItem('smd_atlas_labels')}catch(e){} ATLAS._state.mode=null; ATLAS.open(${JSON.stringify(MOD)}); return 1;`);
  await ready(); await ev(`ATLAS._setSlice(6); return 1;`); await ready(); await sleep(300);
  await shot("1024-default.png");
  ok(await ev(`return document.querySelector('#atlasTools [data-atlas-act=mode][aria-pressed=true]').getAttribute('data-v')==='labels'`), "1024x768 defaults to Labels mode");
  const lab2 = await ev(`var L=[].slice.call(document.querySelectorAll('#atlasOv text.atlas-lab')).map(function(e){return e.getAttribute('data-atlas-s')}); return {n:L.length,u:new Set(L).size}`);
  ok(lab2.n === lab2.u && lab2.n > 0, "1024: one label per structure (" + lab2.n + ")");
  await boxesClear("1024 Labels");
  await shot("1024-labels.png");
  await ev(`ATLAS._select('liver'); return 1;`); await sleep(350);
  await boxesClear("1024 Labels + sheet");
  await shot("1024-labels-sheet.png");
  await ev(`ATLAS.close(); return 1;`);

  // ---------------- 3D flag off: the catalog and openAt do not depend on the 3D layer ----------------
  ok(await attach(BASE + "?atlas3d=0"), "app reloads with ?atlas3d=0");
  await clearIntro(); await settleZoom();
  await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdAtlas .atlas-row').length > 5 && !document.querySelector('#smdAtlas .atlas-3d-card')`), "flag off: catalog renders without the 3D card");
  ok(await ev(`return !document.querySelector('#smdAtlas .atlas-row[data-atlas-mod="brain-mri-axial-t1"]')`), "modules marked hidden are left out of the catalog");
  await ev(`ATLAS.openAt('ct-live-torso-axial','kidney',5); return 1;`);
  ok(await until(`var sh=document.getElementById('atlasSheet'); return ATLAS._state.locked==='kidney' && !!sh && sh.classList.contains('on') && !sh.querySelector('[data-atlas-act="3d"]')`), "flag off: openAt still opens and locks, with no 3D pill");
  await ev(`ATLAS.close(); return 1;`);
} catch (e) { console.log("CRASH", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${passes} pass / ${fails} FAILED` : `\nALL ${passes} PASS`);
process.exit(fails ? 1 : 0);
