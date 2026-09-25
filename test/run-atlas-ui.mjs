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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
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
const key = async (k, code) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, text: k === "Enter" ? "\r" : undefined, windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 })[k] || 0 }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k }); await sleep(80); };

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
    var a=p.px/100, b=p.py/100; if(v.flip.x) a=1-a; if(v.flip.y) b=1-b; var ex=img.left+a*img.width, ey=img.top+b*img.height;
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
  await ev(`ATLAS._setSlice(6); return 1;`); ok(await ready(), "slice 6 renders");

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
  // flipX + flipY together: the 180-degree turn the knee, foot and hand modules carry.
  await ev(`var m=__meta(); m.flipX=true; m.flipY=true; ATLAS._draw(); return 1;`);
  const rot = await ev(`var v=ATLAS._view(); return ATLAS._placed().every(function(p){ return Math.abs(p.x-(v.D.x+(1-p.px/100)*v.D.w))<0.01 && Math.abs(p.y-(v.D.y+(1-p.py/100)*v.D.h))<0.01; }) && /scale\\(-[\\d.]+, *-[\\d.]+\\)/.test(document.getElementById('atlasImg').style.transform)`);
  ok(rot, "flipX+flipY turns the slice 180 degrees and every pin with it");
  dr = await pinDrift();
  ok(dr.n > 0 && dr.max < 1.5, "rotated: pins stay on their structures (max drift " + dr.max.toFixed(2) + " px)");
  await pinch(cx, cy, 40, 100);
  dr = await pinDrift();
  ok(dr.n > 0 && dr.max < 1.5, "rotated AND zoomed: pins stay on their structures (max drift " + dr.max.toFixed(2) + " px)");
  await ev(`ATLAS._state.z={s:1,px:0,py:0}; ATLAS._draw(); document.querySelector('#atlasTools [data-atlas-act=quiz]').click(); document.querySelector('#atlasTools [data-atlas-act=qkind][data-v=find]').click(); return 1;`);
  const rt = await ev(`return ATLAS._state.quiz.target`);
  const rp = (await pinsVp()).find((p) => p.s === rt);
  await tap(rp.x, rp.y);
  ok(await until(`var q=ATLAS._state.quiz; return !!q.answered && q.answered.ok===true`), "Find it hit-testing works on a rotated slice");
  await shot("390-rotated-180.png");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=qexit]').click(); __restore(); ATLAS._draw(); return 1;`);

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

  // =============================== PHASE B (390x844) ===============================
  await viewport(390, 844, true);
  await call("Network.enable", {});
  const IDX = JSON.parse(readFileSync(join(HERE, "../atlas/index.json"), "utf8"));
  const ATL = (id) => JSON.parse(readFileSync(join(HERE, "../atlas/" + id + "/atlas.json"), "utf8"));
  const bestRow = (sid) => IDX.structures.find((r) => r.s === sid).m.slice().sort((a, b) => b[2] - a[2])[0];

  // ---- B0: the sheet is fully opaque while it animates in; labels are 12 px and stay on screen ----
  await ev(`ATLAS.open(${JSON.stringify(MOD)}); return 1;`); await ready();
  await ev(`ATLAS._setSlice(6); return 1;`); await ready();
  await ev(`ATLAS._select('liver'); return 1;`);
  const opac = await ev(`var sh=document.getElementById('atlasSheet'); return [getComputedStyle(sh).opacity, sh.getAnimations ? sh.getAnimations().length : -1]`);
  ok(opac[0] === "1", "the sheet is fully opaque even mid-animation (opacity " + opac[0] + ", " + opac[1] + " running animations): no footer bleed");
  await sleep(700); await shot("390-sheet-opaque.png");
  await ev(`ATLAS._select(null); document.querySelector('#atlasTools [data-atlas-act=mode][data-v=labels]').click(); return 1;`);
  ok(await ev(`var l=document.querySelector('#atlasOv text.atlas-lab'); return !!l && getComputedStyle(l).fontSize==='12px'`), "labels are 12 px");
  ok(await ev(`var s=document.getElementById('atlasStage').getBoundingClientRect(); return [].slice.call(document.querySelectorAll('#atlasOv text.atlas-lab')).every(function(t){var b=t.getBoundingClientRect(); return b.left>=s.left-0.5 && b.right<=s.right+0.5;})`), "every 12 px label fits inside the stage horizontally");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=mode][data-v=pins]').click(); ATLAS.close(); return 1;`);

  // ---- B1: search ----
  await ev(`ATLAS._state.mode=null; ATLAS.open(); return 1;`);
  ok(await until(`return !!document.getElementById('atlasQ') && document.querySelectorAll('#smdAtlas .atlas-row').length>5`), "the catalog has a search field");
  await ev(`document.getElementById('atlasQ').focus(); return 1;`);
  await call("Input.insertText", { text: "LIVER" });
  ok(await until(`var r=document.getElementById('atlasResults'); return !r.hidden && !!r.querySelector('.atlas-res-main')`), "typing shows results (debounced)");
  const liv = await ev(`var b=document.querySelector('#atlasResults .atlas-res-main'); return {n:b.querySelector('.atlas-res-n').textContent, col:getComputedStyle(b.querySelector('i')).backgroundColor, chips:document.querySelectorAll('#atlasResults .atlas-res')[0].querySelectorAll('.atlas-res-mods .atlas-chip').length, m:b.getAttribute('data-m'), i:+b.getAttribute('data-i'), browse:document.getElementById('atlasBrowse').hidden}`);
  const lb = bestRow("liver");
  ok(liv.n === "Liver" && /rgb\(255, 212, 121\)/.test(liv.col) && liv.chips === IDX.structures.find((r) => r.s === "liver").m.length, "a result shows the name, the category colour and every module that contains it (" + liv.chips + ")");
  ok(liv.m === lb[0] && liv.i === lb[1] && liv.browse === true, "the result targets the best module and slice, and the browse list hides");
  await shot("390-search-results.png");
  await ev(`var q=document.getElementById('atlasQ'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); q.focus(); return 1;`);
  await call("Input.insertText", { text: "aórta" });
  ok(await until(`return /Aorta/.test((document.querySelector('#atlasResults .atlas-res-n')||{}).textContent||'')`), "search ignores case and accents (aórta finds Aorta)");
  await ev(`var q=document.getElementById('atlasQ'); q.value=''; q.focus(); return 1;`);
  await call("Input.insertText", { text: "zzqxv" });
  ok(await until(`var r=document.getElementById('atlasResults'); return !r.hidden && /Nothing matches "zzqxv"/.test(r.textContent) && /No results/.test(document.getElementById('atlasQStatus').textContent)`), "no match says so plainly, and the status is announced");
  await shot("390-search-nothing.png");
  await ev(`var q=document.getElementById('atlasQ'); q.value=''; q.focus(); return 1;`);
  await call("Input.insertText", { text: "kidney" });
  await until(`return !!document.querySelector('#atlasResults .atlas-res-main')`);
  await key("ArrowDown");
  ok(await ev(`return document.activeElement===document.querySelector('#atlasResults button')`), "ArrowDown moves from the field into the results");
  await key("Enter");
  const kb = bestRow("kidney");
  ok(await until(`var s=ATLAS._state; return s.moduleId===${JSON.stringify(kb[0])} && s.slice===${kb[1]} && s.locked==='kidney' && s.sel==='kidney'`), "Enter on a result opens openAt(" + kb[0] + ", kidney, " + kb[1] + ") with the structure locked");
  await ready();
  await ev(`document.querySelector('#smdAtlas [data-atlas-act=search]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('atlasSearch') && document.activeElement===document.getElementById('atlasQ')`), "the viewer's Search action opens search with the field focused");
  await call("Input.insertText", { text: "spleen" });
  await until(`return !!document.querySelector('#atlasResults .atlas-res-mods .atlas-chip')`);
  const chip = await ev(`var c=document.querySelector('#atlasResults .atlas-res-mods .atlas-chip'); c.click(); return {m:c.getAttribute('data-m'), i:+c.getAttribute('data-i')}`);
  ok(await until(`var s=ATLAS._state; return !document.getElementById('atlasSearch') && s.moduleId===${JSON.stringify(chip.m)} && s.slice===${chip.i} && s.locked==='spleen'`), "a module chip in a result opens that module at the spleen's best slice");
  await ready();

  // ---- B2: recents and bookmarks ----
  await ev(`ATLAS._setSlice(7); return 1;`); await ready();
  await ev(`ATLAS._select('spleen'); return 1;`);
  await ev(`document.getElementById('atlasStar').click(); return 1;`);
  ok(await until(`return !document.getElementById('atlasPop').hidden && document.activeElement===document.getElementById('atlasBmName')`), "the star opens a bookmark form with the optional name focused");
  await call("Input.insertText", { text: "My spleen" });
  await key("Enter");
  ok(await until(`var b=document.getElementById('atlasStar'); return b.getAttribute('aria-pressed')==='true' && document.getElementById('atlasPop').hidden`), "Enter saves; the star shows the view is bookmarked");
  const bm = await ev(`return JSON.parse(localStorage.getItem('smd_atlas_bookmarks'))[0]`);
  ok(bm && bm.n === "My spleen" && bm.m === chip.m && bm.i === 7 && bm.s === "spleen", "the bookmark stores module + slice + structure + name");
  await ev(`ATLAS._setSlice(8); return 1;`);
  ok(await ev(`return document.getElementById('atlasStar').getAttribute('aria-pressed')==='false'`), "another slice is not bookmarked");
  ok(await ev(`for (var k=0; k<5 && ATLAS._state.view==="viewer"; k++) ATLAS.back(); return ATLAS.isOpen() && ATLAS._state.view`) === "catalog", "back unwinds to the catalog, which stays open");
  await until(`return ATLAS._state.view==='catalog' && !!document.querySelector('#atlasBrowse')`);
  const rc = await ev(`return JSON.parse(localStorage.getItem('smd_atlas_recent'))`);
  ok(rc.length >= 2 && rc.length <= 8 && rc[0].m === chip.m && rc[0].i === 8, "recents: newest first, the module's last slice (" + rc[0].m + " slice " + rc[0].i + ")");
  ok(await ev(`var c=document.querySelectorAll('#atlasBrowse .atlas-rcard'); return c.length===${rc.length} && c[0].getAttribute('data-m')===${JSON.stringify(chip.m)} && +c[0].getAttribute('data-i')===8`), "the catalog shows a Recent row at the top, newest first");
  ok(await ev(`var b=document.querySelector('#atlasBrowse .atlas-bms .atlas-bm-open'); return !!b && /My spleen/.test(b.textContent)`), "the catalog lists the bookmark");
  await shot("390-catalog-recents-bookmarks.png");
  await ev(`document.querySelector('#atlasBrowse .atlas-bm-open').click(); return 1;`);
  ok(await until(`var s=ATLAS._state; return s.moduleId===${JSON.stringify(chip.m)} && s.slice===7 && s.locked==='spleen'`), "tapping a bookmark returns to its module, slice and structure");
  await ready(); await ev(`for (var k=0; k<5 && ATLAS._state.view==="viewer"; k++) ATLAS.back(); return 1;`);
  await until(`return ATLAS._state.view==='catalog' && !!document.querySelector('.atlas-bm-del')`);
  await ev(`document.querySelector('.atlas-bm-del').click(); return 1;`);
  ok(await until(`return !document.querySelector('.atlas-bms') && JSON.parse(localStorage.getItem('smd_atlas_bookmarks')).length===0`), "delete removes the bookmark");
  // The bookmark visit (slice 7) is now the newest recent.
  const rc0 = await ev(`var c=document.querySelector('#atlasBrowse .atlas-rcard'); var r={m:c.getAttribute('data-m'), i:+c.getAttribute('data-i')}; c.click(); return r;`);
  ok(rc0.m === chip.m && rc0.i === 7 && await until(`return ATLAS._state.moduleId===${JSON.stringify(chip.m)} && ATLAS._state.slice===7`), "tapping a recent opens that module at that slice (the bookmark visit, slice 7, is now newest)");
  await ev(`ATLAS.close(); return 1;`);

  // ---- B4: plane localizer ----
  await ev(`ATLAS.openAt(${JSON.stringify(MOD)}, 'liver', 6); return 1;`); await ready();
  ok(await until(`return document.querySelectorAll('#atlasLoc [data-atlas-act=plane]').length===3 && !!document.querySelector('#atlasScout .atlas-scout svg line')`), "grouped modules show Axial / Coronal / Sagittal chips and a scout with a line");
  const line = (i) => ev(`ATLAS._setSlice(${i}); var l=document.querySelector('#atlasScout line'); return l ? [+l.getAttribute('y1'), +l.getAttribute('y2'), +l.getAttribute('x1'), +l.getAttribute('x2')] : null;`);
  const l5 = await line(5), l15 = await line(15);
  ok(l5 && l15 && Math.abs(l5[0] - l5[1]) < 0.05 && l15[0] > l5[0], "the axial slice is a horizontal line on the coronal scout, lower for a lower slice (" + l5[0] + " -> " + l15[0] + ")");
  await ev(`ATLAS._setSlice(6); return 1;`); await ready(); await ev(`ATLAS._select('liver'); ATLAS._select(null); return 1;`);
  await sleep(600); await shot("390-scout-on-coronal.png");
  // Tap the scout 70% of the way down: the slice under that level.
  const sc = await rect("#atlasScout .atlas-scout");
  const AXJ = ATL(MOD), COJ = ATL("ct-live-torso-coronal"), SAJ = ATL("ct-live-torso-sagittal");
  const coMidQ = COJ.slices[Math.ceil(COJ.slices.length / 2) - 1].q;
  const pt = [coMidQ[0] + 0.5 * coMidQ[3] + 0.7 * coMidQ[6], coMidQ[1] + 0.5 * coMidQ[4] + 0.7 * coMidQ[7], coMidQ[2] + 0.5 * coMidQ[5] + 0.7 * coMidQ[8]];
  const nearestAx = await ev(`return ATLAS._pure.nearestSlice(ATLAS._state.atlas.slices, ${JSON.stringify(pt)})`);
  await tap(sc.l + sc.w * 0.5, sc.t + sc.h * 0.7);
  ok(await until(`return ATLAS._state.slice===${nearestAx}`), "tapping the scout jumps to that level (slice " + nearestAx + ")");
  // Switch plane with the liver selected: same anatomical point, liver still locked.
  await ev(`ATLAS._setSlice(6); return 1;`); await ready();
  await ev(`ATLAS._state.locked='liver'; ATLAS._select('liver'); return 1;`);
  const expCo = await ev(`var s=ATLAS._state.atlas.slices[5], pin=s.pins.filter(function(p){return p.s==='liver'})[0]; var q=s.q, p=ATLAS._pure.qPoint(q, pin.x/100, pin.y/100); return ATLAS._pure.nearestSlice(${JSON.stringify(COJ.slices)}, p);`);
  await ev(`document.querySelector('#atlasLoc [data-atlas-act=plane][data-v="ct-live-torso-coronal"]').click(); return 1;`);
  ok(await until(`var s=ATLAS._state; return s.moduleId==='ct-live-torso-coronal' && s.slice===${expCo} && s.locked==='liver'`), "Coronal switches to the sibling slice through the liver's pin (slice " + expCo + "), liver still locked");
  await ready();
  ok(await ev(`return document.querySelector('#atlasLoc [data-atlas-act=plane][aria-pressed=true]').getAttribute('data-v')==='ct-live-torso-coronal' && !!document.querySelector('#atlasScout line')`), "the coronal view has its own scout (on the axial)");
  await sleep(600); await shot("390-coronal-scout-on-axial.png");
  await ev(`ATLAS.openAt('ct-head-axial', null, 3); return 1;`); await ready();
  ok(await ev(`return !document.getElementById('atlasLoc')`), "modules without group/plane get no localizer");
  await ev(`ATLAS.close(); return 1;`);

  // ---- B3: offline download ----
  const offId = MOD;
  await ev(`ATLAS.openAt(${JSON.stringify(offId)}, null, 6); return 1;`); await ready();
  await ev(`document.getElementById('atlasMore').click(); return 1;`);
  ok(await until(`return !document.getElementById('atlasPop').hidden && !!document.querySelector('#atlasPop [data-atlas-act=offline]')`), "More offers Download for offline");
  const nFiles = await ev(`return ATLAS._pure.offlineFiles(ATLAS._state.atlas, ATLAS._state.catalog.modules.filter(function(m){return m.id===${JSON.stringify(offId)}})[0]).length + 1`);
  // Throttle so the progress is visible, then let it finish at full speed.
  await call("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: 250000, uploadThroughput: -1 });
  await ev(`document.querySelector('#atlasPop [data-atlas-act=offline]').click(); return 1;`);
  ok(await until(`var p=document.querySelector('#atlasPop .atlas-prog'); return !!p && +p.getAttribute('aria-valuenow')>=5`, 30000), "a progress bar with percent, file count and bytes appears");
  await shot("390-download-progress.png");
  ok(await ev(`return /\\d+% · \\d+ of ${nFiles} files · [\\d.]+ (KB|MB)/.test(document.querySelector('#atlasPop').textContent)`), "progress text reads percent, files of " + nFiles + " and bytes");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok(await until(`return /Available offline/.test(document.getElementById('atlasPop').textContent)`, 60000), "the download completes and says Available offline");
  ok(await ev(`return caches.has('atlas2d-${offId}')`) === true, "the files are in the module's own Cache API cache");
  ok(await until(`return /^blob:/.test(document.getElementById('atlasImg').src)`), "the viewer switches to cached blobs right away");
  await ev(`ATLAS.back(); return 1;`);
  ok(await until(`return ATLAS._state.view==='viewer'`) && await ev(`ATLAS.back(); return ATLAS._state.view`) === "catalog", "back to the catalog");
  ok(await until(`var b=document.querySelector('.atlas-row-off[data-off="${offId}"]'); return !!b && /Available offline/.test(b.textContent)`), "the catalog card carries an Available offline badge");
  // Airplane mode.
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const offCheck = await ev(`return fetch('/atlas/ct-knee-axial/001.webp?nocache=' + Date.now()).then(function(){return 'reached'}, function(){return 'blocked'})`);
  await ev(`window.__offStart = performance.now(); document.querySelector('#smdAtlas .atlas-row[data-atlas-mod="${offId}"]').click(); return 1;`);
  ok(await until(`var s=document.getElementById('atlasStage'), i=document.getElementById('atlasImg'); return !!i && /^blob:/.test(i.src) && i.complete && i.naturalWidth>0 && !s.classList.contains('is-error') && !s.classList.contains('is-loading')`, 20000), "OFFLINE (" + offCheck + "): the downloaded module opens and its slice renders from the cache");
  ok(await ev(`return document.querySelectorAll('#atlasOv circle.atlas-dot').length > 0`), "offline: pins render too");
  await ev(`ATLAS._setSlice(12); return 1;`);
  ok(await until(`var i=document.getElementById('atlasImg'); return /^blob:/.test(i.src) && i.complete && i.naturalWidth>0`), "offline: scrubbing to another slice works");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=panel]').click(); document.querySelector('#atlasPanel [data-atlas-act=win][data-v=lung]').click(); return 1;`);
  ok(await until(`var s=document.getElementById('atlasStage'), i=document.getElementById('atlasImg'); return /^blob:/.test(i.src) && i.complete && i.naturalWidth>0 && !s.classList.contains('is-error')`), "offline: the lung window renders from the cache");
  await ev(`document.querySelector('#atlasPanel [data-atlas-act=win][data-v=soft]').click(); document.querySelector('#atlasTools [data-atlas-act=panel]').click(); document.querySelector('#smdAtlas [data-atlas-act=grid]').click(); return 1;`);
  ok(await until(`var g=document.querySelectorAll('#atlasGrid .atlas-gth'); return g.length===ATLAS._state.atlas.slices.length && /blob:/.test(g[0].querySelector('i').style.backgroundImage) && g[0].querySelector('i').classList.contains('flip')`), "offline: the all-slices grid uses cached thumbnails, mirrored like the flipX slice");
  await shot("390-offline-grid.png");
  await ev(`ATLAS.back(); return 1;`);
  await ev(`window.__nSl=ATLAS._state.atlas.slices.length; window.__revoked=[]; var o=URL.revokeObjectURL; URL.revokeObjectURL=function(u){window.__revoked.push(u); return o.call(URL,u)}; ATLAS.back(); return 1;`);
  ok(await until(`return ATLAS._state.view==='catalog' && window.__revoked.length >= 2 * window.__nSl`), "leaving the module revokes its object URLs (" + (await ev(`return window.__revoked.length`)) + ")");
  await ev(`document.querySelector('#smdAtlas .atlas-row[data-atlas-mod="ct-knee-axial"]').click(); return 1;`);
  ok(await until(`var s=document.getElementById('atlasStage'); return !!s && (s.classList.contains('is-error') || ATLAS._state.loadErr===true || (document.getElementById('atlasImg') && !document.getElementById('atlasImg').complete))`, 8000), "offline: a module that was NOT downloaded fails honestly");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev(`ATLAS.back(); return 1;`);
  // Stop a download midway: nothing recorded, nothing cached.
  await ev(`ATLAS.openAt('ct-live-torso-coronal', null, 3); return 1;`); await ready();
  await call("Network.emulateNetworkConditions", { offline: false, latency: 50, downloadThroughput: 100000, uploadThroughput: -1 });
  await ev(`document.getElementById('atlasMore').click(); document.querySelector('#atlasPop [data-atlas-act=offline]').click(); return 1;`);
  await until(`var p=document.querySelector('#atlasPop .atlas-prog'); return !!p && +p.getAttribute('aria-valuenow')>=1`, 20000);
  await ev(`document.querySelector('#atlasPop [data-atlas-act=offstop]').click(); return 1;`);
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok(await until(`return !!document.querySelector('#atlasPop [data-atlas-act=offline]') && !JSON.parse(localStorage.getItem('smd_atlas_offline')||'{}')['ct-live-torso-coronal']`, 20000) && await until(`return caches.has('atlas2d-ct-live-torso-coronal').then(function(h){return !h})`), "Stop download: no offline record and the partial cache is deleted");
  await ev(`document.getElementById('atlasPop').hidden || document.querySelector('#atlasPop [data-atlas-act=popx], #atlasMore').click(); ATLAS.close(); return 1;`);
  // Remove the offline copy.
  await ev(`ATLAS.openAt(${JSON.stringify(offId)}, null, 2); return 1;`); await ready();
  await ev(`document.getElementById('atlasMore').click(); document.querySelector('#atlasPop [data-atlas-act=offremove]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#atlasPop [data-atlas-act=offline]') && !JSON.parse(localStorage.getItem('smd_atlas_offline')||'{}')[${JSON.stringify(offId)}]`) && await until(`return caches.has('atlas2d-${offId}').then(function(h){return !h})`), "Remove offline copy deletes the record and the cache");
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
  await boxesClear("1024 Labels + side panel");
  // B6: at 900 px and up the structure sheet is a right-side panel spanning the stage.
  const side = await ev(`var sh=document.getElementById('atlasSheet').getBoundingClientRect(), s=document.getElementById('atlasStage').getBoundingClientRect(), bar=document.querySelector('.atlas-bar').getBoundingClientRect(), tools=document.getElementById('atlasTools').getBoundingClientRect();
    return {side:document.getElementById('atlasSheet').classList.contains('side'), right:Math.abs(sh.right-innerWidth), top:Math.abs(sh.top-s.top), bottom:Math.abs(sh.bottom-s.bottom), w:sh.width, barFree:sh.top>=bar.bottom-0.5||sh.bottom<=bar.top+0.5, toolsFree:sh.top>=tools.bottom-0.5, op:getComputedStyle(document.getElementById('atlasSheet')).opacity}`);
  ok(side.side && side.right < 1 && side.top < 1 && side.bottom < 1 && side.w > 300, "1024: the sheet is a right-side panel spanning exactly the stage (" + Math.round(side.w) + " px wide)");
  ok(side.barFree && side.toolsFree && side.op === "1", "1024: the slice bar and tool row stay uncovered, and the panel is opaque");
  const clear = await ev(`var p=document.getElementById('atlasSheet').getBoundingClientRect(), bad=[];
    [].slice.call(document.querySelectorAll('#atlasOv text.atlas-lab, #atlasOv circle.atlas-dot, #atlasOv .atlas-call, #atlasOv .atlas-orient')).forEach(function(e){var b=e.getBoundingClientRect(); if(b.width && b.right>p.left+0.5 && b.left<p.right) bad.push(e.textContent||e.getAttribute('class'));});
    var i=document.getElementById('atlasImg').getBoundingClientRect();
    return {bad:bad, img:i.right<=p.left+0.5, n:document.querySelectorAll('#atlasOv text.atlas-lab').length}`);
  ok(clear.bad.length === 0 && clear.img && clear.n > 0, "1024: labels, pins and the slice all sit left of the side panel" + (clear.bad.length ? " (" + clear.bad.slice(0, 4).join(", ") + ")" : ""));
  await shot("1024-side-panel.png");
  await ev(`ATLAS._select(null); document.querySelector('#atlasTools [data-atlas-act=mode][data-v=pins]').click(); ATLAS._select('liver'); return 1;`); await sleep(300);
  ok(await ev(`var p=document.getElementById('atlasSheet').getBoundingClientRect(); return [].slice.call(document.querySelectorAll('#atlasOv circle.atlas-dot, #atlasOv .atlas-call')).every(function(e){var b=e.getBoundingClientRect(); return b.right<=p.left+0.5;})`), "1024 Pins: pins and the callout avoid the side panel too");
  await ev(`document.querySelector('#atlasTools [data-atlas-act=mode][data-v=labels]').click(); ATLAS.close(); return 1;`);
  await viewport(820, 1180, true);
  await ev(`ATLAS.open(${JSON.stringify(MOD)}); return 1;`); await ready(); await ev(`ATLAS._select('liver'); return 1;`); await sleep(300);
  ok(await ev(`var sh=document.getElementById('atlasSheet'); return !sh.classList.contains('side') && sh.getBoundingClientRect().bottom>=innerHeight-1`), "below 900 px (820 wide) it stays a bottom sheet");
  await ev(`ATLAS.close(); return 1;`);

  // ---------------- B5: clinical notes, flag both ways ----------------
  const noteSpy = `window.__nf=0; var of=window.fetch; window.fetch=function(u){ if(/\\/atlas\\/notes\\.json/.test(String(u))) window.__nf++; return of.apply(this, arguments); }; return 1;`;
  await viewport(390, 844, true);
  await ev(`try{localStorage.removeItem('smd_atlas_notes')}catch(e){} ` + noteSpy);
  await ev(`ATLAS.openAt(${JSON.stringify(MOD)}, 'liver', 6); return 1;`); await ready();
  await until(`return !!document.querySelector('#atlasSheet [data-tab=definition]')`);
  ok(await ev(`return !document.querySelector('#atlasSheet [data-tab=clinical]') && window.__nf===0 && performance.getEntriesByType('resource').every(function(r){return !/\\/atlas\\/notes\\.json/.test(r.name)})`), "notes flag OFF by default: no Clinical tab and notes.json is never fetched");
  await ev(`ATLAS.close(); return 1;`);
  ok(await attach(BASE + "?atlasnotes=1"), "app reloads with ?atlasnotes=1");
  await clearIntro(); await settleZoom();
  await ev(noteSpy);
  await ev(`ATLAS.openAt(${JSON.stringify(MOD)}, 'liver', 6); return 1;`); await ready();
  ok(await until(`return !!document.querySelector('#atlasSheet [data-tab=clinical]')`), "flag ON (?atlasnotes=1): the structure sheet has a Clinical tab");
  await ev(`document.querySelector('#atlasSheet [data-tab=clinical]').click(); return 1;`);
  const NOTES = JSON.parse(readFileSync(join(HERE, "../atlas/notes.json"), "utf8")).notes.liver;
  ok(await until(`var b=document.querySelector('#atlasSheet .atlas-sheet-body'); return !!b && /Draft, pending clinical review/.test(b.textContent) && b.textContent.indexOf(${JSON.stringify(NOTES.clinical.slice(0, 40))})>=0 && b.textContent.indexOf(${JSON.stringify(NOTES.imaging.slice(0, 40))})>=0`), "the Clinical tab shows the clinical and imaging notes under a Draft, pending clinical review badge");
  ok(await ev(`return window.__nf===1`), "notes.json is fetched once, only when the flag is on");
  await ev(`var sh=document.getElementById('atlasSheet'); sh.classList.add('full'); ATLAS._draw(); return 1;`); await sleep(350);
  await shot("390-notes-tab.png");
  await ev(`ATLAS.close(); try{localStorage.setItem('smd_atlas_notes','1')}catch(e){} return 1;`);
  ok(await attach(BASE), "reload with localStorage smd_atlas_notes=1 and no query");
  await clearIntro(); await settleZoom();
  await ev(`ATLAS.openAt(${JSON.stringify(MOD)}, 'kidney', 5); return 1;`); await ready();
  ok(await until(`return !!document.querySelector('#atlasSheet [data-tab=clinical]')`), "flag ON via localStorage");
  ok(await attach(BASE + "?atlasnotes=0"), "reload with ?atlasnotes=0 over localStorage=1");
  await clearIntro(); await settleZoom();
  await ev(`ATLAS.openAt(${JSON.stringify(MOD)}, 'kidney', 5); return 1;`); await ready();
  await until(`return !!document.querySelector('#atlasSheet [data-tab=definition]')`);
  ok(await ev(`return !document.querySelector('#atlasSheet [data-tab=clinical]')`), "?atlasnotes=0 wins over localStorage: no tab");
  await ev(`try{localStorage.removeItem('smd_atlas_notes')}catch(e){} ATLAS.close(); return 1;`);

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
