/* RadioAnatome Immersive CT — real headless-browser test (CDP, SwiftShader WebGL).
 * Proves: the catalog card (both flags) opens the view; the living body streams and renders
 * with the CT slice as its cut; the axial CT loads with R/L/A/P edge letters; a TAP on a CT pin
 * (Input.dispatchTouchEvent, a real one-finger touch) names the structure and highlights it in 3D;
 * a TAP on the 3D body names the structure and its pins (or offers the nearest slice); the slice
 * slider and cine move the CT and the 3D cut together; CT windows swap both images; "Above the
 * slice" really draws the cut-away half; Show all labels never overlaps; Back unwinds to the
 * catalog; the flag hides the card; no page errors; no sideways scroll at phone width.
 * USAGE: CHROME=<chrome> [BASE=http://localhost:8994/] [CDP_PORT=9386] [SHOTS=<dir>] node test/run-atlas-imm-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = +process.env.CDP_PORT || 9386, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/atlas-imm-ui-chrome-" + PORT;
const SHOTS = process.env.SHOTS || "";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 390, H = 844;   // iPhone 15 class viewport
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8994"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
try { await fetch(`http://localhost:${PORT}/json/version`); console.log(`💥 Chrome debug port ${PORT} is already in use; set CDP_PORT to a free port.`); process.exit(2); } catch {}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", `--window-size=${W},${H}`], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId; const pageErrors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r, rej) => { const to = setTimeout(() => { pending.delete(i); rej(new Error("CDP " + m + " got no answer in 180 s")); }, 180000); pending.set(i, (x) => { clearTimeout(to); r(x); }); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const evj = async (e) => JSON.parse(await ev(e) || "null");
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const until = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(250); } return false; };
// a real one-finger touch (touchstart -> touchend), as a phone delivers it; the browser derives the pointer events and the click
const tap = async (x, y) => { await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(x), y: Math.round(y) }] }); await sleep(40); await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(120); };
const shot = async (name) => { if (!SHOTS) return; const { mkdirSync, writeFileSync } = await import("node:fs"); mkdirSync(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) { writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("   shot: " + join(SHOTS, name + ".png")); } };
const SIG = `var f=ATLAS3D._readFrame(); if(!f) return null; var h=0, lit=0; for (var i=0;i<f.px.length;i+=4*7){ h=(h*31 + f.px[i]*3 + f.px[i+1]*5 + f.px[i+2]*7)>>>0; if (f.px[i]+f.px[i+1]+f.px[i+2] > 90) lit++; } return JSON.stringify({h:h, lit:lit});`;
const sig = () => evj(SIG);
const settled = (ms = 120000) => until(`var s=ATLAS3D._state; return !!s.imm && !!s.imm.atlas && !s.camTo && Object.keys(s.loading).length===0 && !!s.plane && s.plane.ready===true;`, ms);
// a pin's on-screen centre, in viewport px, read from the rendered dot
// (scrolled into view first: the Immersive panel scrolls on a phone, and a finger only reaches what is on screen)
const pinXY = async (sel) => {
  // scroll it into view, then wait until it stops moving (overlays slide in, sheets spring)
  let prev = null;
  for (let k = 0; k < 30; k++) {
    const r = await evj(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; ${k ? "" : "e.scrollIntoView({block:'center', behavior:'instant'});"} var r=e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});`);
    if (!r) return null;
    if (prev && Math.abs(prev.x - r.x) < 0.5 && Math.abs(prev.y - r.y) < 0.5) return r;
    prev = r; await sleep(100);
  }
  return prev;
};
let curTarget = null;
async function attach(url) {
  if (curTarget) { const old = curTarget; curTarget = null; sessionId = undefined; try { await call("Target.closeTarget", { targetId: old }); } catch {} }
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" }); curTarget = targetId;
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.navigate", { url });
  return until(`return !!(window.ATLAS && ATLAS.open && window.ATLAS3D)`, 30000);
}
const clearIntro = () => ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; pageErrors.push((d.exception && d.exception.description || d.text || "").split("\n")[0] + " @" + (d.url || "").split("/").pop() + ":" + d.lineNumber); } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- entry point ----
  ok(await attach(BASE + "?atlas3d=1"), "app loads with ATLAS + ATLAS3D");
  await clearIntro();
  await ev(`localStorage.removeItem('smd_atlas_imm'); ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-3d-card.imm')`), "catalog shows the Immersive CT card (flag default ON)");
  const card = await pinXY("#smdAtlas .atlas-3d-card.imm");
  await tap(card.x, card.y);
  ok(await until(`return ATLAS3D.isOpen() && document.getElementById('smdAtlas3d').classList.contains('a3d-immersive') && !!document.getElementById('a3dCanvas') && !!document.getElementById('a3dCtBox')`), "tapping the card opens Immersive CT (3D canvas + CT panel)");
  ok(await settled(), "living body streamed, CT data loaded, slice texture on the cut plane");
  const st0 = await evj(`var s=ATLAS3D._state; return JSON.stringify({src:s.src, m:s.plane.m, i:s.plane.i, n:s.plane.n, err:s.err, hint:!!document.getElementById('a3dHint'), sheet:!!(document.getElementById('a3dSheet')||{}).classList && document.getElementById('a3dSheet').classList.contains('on')});`);
  // the whole body (s1045) is the default; it opens on the chest, the middle of the slices that pin the heart
  ok(st0.src === "body" && st0.m === "ct-live-body-axial" && st0.n === 96 && st0.i === 45 && !st0.err, "on the whole-body living CT at axial slice 45 of 96 (chest): " + JSON.stringify(st0));
  ok(await ev(`return document.getElementById('a3dSub').textContent==='Living-patient CT · head to thigh';`) === true, "header says head to thigh");
  ok(await ev(`var c=[].slice.call(document.querySelectorAll('#a3dImmRegions .atlas-chip')).map(function(b){return b.textContent+(b.classList.contains('on')?'*':'');}).join(','); return c==='Whole,Head,Neck,Chest*,Abdomen,Pelvis';`) === true, "region chips Whole, Head, Neck, Chest (on), Abdomen, Pelvis");
  ok(await ev(`var e=document.getElementById('a3dImmRegions'), b=e.lastElementChild.getBoundingClientRect(), a=e.firstElementChild.getBoundingClientRect(); return Math.abs(a.top-b.top)<1;`) === true, "region chips stay on one scrolling row");
  ok(!st0.hint, "no first-open gesture hint over the CT");
  ok(await until(`var i=document.getElementById('a3dCtImg'); return i.complete && i.naturalWidth>0 && /ct-live-body-axial\\/045\\.webp$/.test(i.getAttribute('src')) && document.getElementById('a3dCtWait').hidden;`, 20000), "axial CT image 045 loaded, wait note gone");
  ok(await ev(`return ['a3dEdT','a3dEdB','a3dEdL','a3dEdR'].map(function(k){return document.getElementById(k).textContent;}).join('')==='APRL' && document.getElementById('a3dCtImg').classList.contains('flip');`) === true, "radiological display: image mirrored, edge letters A/P/R/L from modules.json");
  ok(await ev(`return document.getElementById('a3dImmLvl').textContent==='Slice 45 of 96' && document.querySelector('[data-a3d-act=immslice]').value==='45';`) === true, "level caption and slider agree");
  const s0 = await sig();
  ok(!!s0 && s0.lit > 200, "3D frame shows the body (" + (s0 && s0.lit) + " lit samples)");
  ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth && document.getElementById('a3dImm').scrollWidth <= document.getElementById('a3dImm').clientWidth;`) === true, "no sideways scroll at 390 px");
  ok(await ev(`var b=document.getElementById('a3dCtBox').getBoundingClientRect(); return b.width >= ${W} - 26 && b.width <= ${W} - 22;`) === true, "CT fills the width inside the 12 px gutters");
  await shot("imm-01-open");

  // ---- tap a CT pin: names it, highlights it in 3D ----
  await ev(`document.querySelector('[data-a3d-act=immall]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state, sl=s.imm.atlas.slices[s.plane.i-1]; return document.querySelectorAll('#a3dCtPins .a3d-ct-pin').length === sl.pins.length && document.querySelectorAll('#a3dCtPins .a3d-ct-lbl').length > 0;`) === true, "Show all labels draws every pin on the slice and some labels");
  ok(await ev(`var L=[].slice.call(document.querySelectorAll('#a3dCtPins .a3d-ct-lbl')).map(function(e){return e.getBoundingClientRect();}), box=document.getElementById('a3dCtBox').getBoundingClientRect();
    for (var i=0;i<L.length;i++){ var a=L[i]; if (a.left < box.left-1 || a.right > box.right+1 || a.top < box.top-1) return false; for (var j=i+1;j<L.length;j++){ var b=L[j]; if (a.left<b.right-1 && a.right>b.left+1 && a.top<b.bottom-1 && a.bottom>b.top+1) return false; } } return true;`) === true, "labels stay inside the CT and never overlap");
  await shot("imm-02-all-labels");
  await ev(`document.querySelector('[data-a3d-act=immall]').click(); return 1;`);
  // pick the heart pin on this slice and tap where it is DRAWN, so the display flip is exercised
  const liverIdx = await ev(`var s=ATLAS3D._state, p=s.imm.atlas.slices[s.plane.i-1].pins; for (var k=0;k<p.length;k++) if (p[k].s==='heart') return k; return -1;`);
  ok(liverIdx >= 0, "slice 45 pins the heart");
  const lp = await evj(`var s=ATLAS3D._state, p=s.imm.atlas.slices[s.plane.i-1].pins[${liverIdx}], b=document.getElementById('a3dCtBox').getBoundingClientRect(); return JSON.stringify({x: b.left + (100-p.x)/100*b.width, y: b.top + p.y/100*b.height});`);
  await tap(lp.x, lp.y);
  ok(await until(`var s=ATLAS3D._state; return !!s.subject && s.subject.cid==='HEART' && s.sel.length>0 && s.src==='body';`, 5000), "tap on the heart pin (mirrored image) selects HEART on the whole body");
  ok(await ev(`return /Heart/.test(document.querySelector('.a3d-imm-sel h3').textContent) && !!document.querySelector('.a3d-imm-def') && document.querySelectorAll('#a3dCtPins .a3d-ct-pin.on').length>=1 && /Heart/.test(document.querySelector('#a3dCtPins .a3d-ct-lbl.on').textContent);`) === true, "name, definition and the highlighted pin + label show under the slice");
  ok(await ev(`var sh=document.getElementById('a3dSheet'); return !sh || !sh.classList.contains('on');`) === true, "no sheet covers the CT on selection");
  ok(await ev(`var s=ATLAS3D._state, b=s.data.canon.HEART.body; return b.length===2 && b.length===s.sel.length && b.every(function(i){return s.sel.indexOf(i)>=0;});`) === true, "the 3D selection is the whole-body heart (heart + left atrial appendage surfaces)");
  await shot("imm-03-heart");

  // ---- tap an empty corner: nothing selected, an honest hint ----
  const bx = await evj(`var e=document.getElementById('a3dCtBox'); e.scrollIntoView({block:'center', behavior:'instant'}); var b=e.getBoundingClientRect(); return JSON.stringify({x:b.left+6, y:b.bottom-6});`);
  await tap(bx.x, bx.y);
  ok(await until(`var s=ATLAS3D._state; return !s.subject && /No labelled structure/.test(document.getElementById('a3dImmInfo').textContent);`, 5000), "a tap far from every pin clears the selection and says why");

  // ---- slider moves the CT and the 3D cut together ----
  const posA = await ev(`return ATLAS3D._state.data.planes['ct-live-body-axial']['45'].pos;`);
  await ev(`var r=document.querySelector('[data-a3d-act=immslice]'); r.value='70'; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.plane.i===70 && /ct-live-body-axial\\/070\\.webp$/.test(document.getElementById('a3dCtImg').getAttribute('src')) && document.getElementById('a3dImmLvl').textContent==='Slice 70 of 96';`, 5000), "slider to 70: CT image, caption and 3D plane all on slice 70");
  ok(await ev(`return ATLAS3D._state.data.planes['ct-live-body-axial']['70'].pos < ${posA};`) === true, "the 3D cut moved inferior (lower y) as the slice number rose");
  ok(await settled(150000), "slice 70 texture uploaded to the cut plane (the camera glides after the cut first)");
  ok(await ev(`var s=ATLAS3D._state; return Math.abs(s.cam.target[1] - s.data.planes['ct-live-body-axial']['70'].pos) < 1e-3;`) === true, "the camera followed the cut down the body (target height = the slice level)");
  ok(await ev(`return document.querySelector('#a3dImmRegions .atlas-chip.on').textContent==='Abdomen';`) === true, "the region chip follows the level (Abdomen)");

  // ---- "Above the slice" draws the cut-away half ----
  await ev(`var r=document.querySelector('[data-a3d-act=immabove]'); r.value='0'; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(300); const off = await sig();
  await ev(`var r=document.querySelector('[data-a3d-act=immabove]'); r.value='80'; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(300); const on80 = await sig();
  ok(!!off && !!on80 && on80.h !== off.h && on80.lit > off.lit, "Above the slice at 80% adds the anatomy above the cut (" + (off && off.lit) + " → " + (on80 && on80.lit) + " lit samples)");
  await ev(`var r=document.querySelector('[data-a3d-act=immabove]'); r.value='18'; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);

  // ---- tap the 3D body: names the structure on both sides ----
  const hit = await ev(`var c=document.getElementById('a3dCanvas'); var best=-1; for (var yy=0.35; yy<0.8 && best<0; yy+=0.05) { best = ATLAS3D._pickAt(c.width/2, c.height*yy); if (best>=0) { window.__hy = yy; } } return best;`);
  ok(hit >= 0, "GPU pick finds a living-CT structure below the cut (part " + hit + ")");
  // let the software renderer drain its follow-up frames (settleFrames runs to 1.5 s): under
  // SwiftShader a frame takes ~0.5 s, and a touchend queued behind two of them reads as a long press
  await settled(30000); await sleep(1700);
  const cv = await evj(`var c=document.getElementById('a3dCanvas'); document.getElementById('a3dImm').scrollTop=0; var r=c.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height*window.__hy});`);
  // A real touch, at the spot the GPU pick just confirmed. This caught a zoom bug: the app's
  // Display setting zooms the document, and the canvas tap maths ignored it, so this tap used
  // to land ~10 px off and miss (fixed in bindInput pos()).
  await tap(cv.x, cv.y);
  ok(await until(`var s=ATLAS3D._state; return !!s.subject && !!document.querySelector('.a3d-imm-sel h3');`, 8000), "a real touch on the 3D body names the structure the GPU pick found: " + await ev(`var s=ATLAS3D._state; return s.subject ? JSON.stringify(s.subject) : 'none';`));
  ok(await ev(`var s=ATLAS3D._state; return s.sel.indexOf(${hit}) >= 0;`) === true, "…and the picked part " + hit + " is in the selection (the tap landed where it was aimed)");
  ok(await ev(`var s=ATLAS3D._state, d=s.data; if (s.subject.kind!=='canon') return true; var own=d.canon[s.subject.cid][s.src==='body'?'body':'live']; return own.length>0 && own.every(function(i){return s.sel.indexOf(i)>=0;});`) === true, "a 3D tap selects the whole structure (both kidneys, not one), matching the CT pins");

  // ---- a structure not on this slice offers the nearest slice that has it ----
  await ev(`ATLAS3D._state.imm && ATLAS3D._select(ATLAS3D._state.data.canon.PROSTATE.body, {kind:'canon', cid:'PROSTATE'}, {noFocus:true}); return 1;`);
  ok(await until(`return !!document.querySelector('[data-a3d-act=immgo]');`, 3000), "PROSTATE (not on slice 70) offers Go to slice N");
  const goI = await ev(`return +document.querySelector('[data-a3d-act=immgo]').getAttribute('data-i');`);
  const go = await pinXY("[data-a3d-act=immgo]");
  await tap(go.x, go.y);
  ok(await until(`var s=ATLAS3D._state; return s.plane.i===${goI} && document.querySelectorAll('#a3dCtPins .a3d-ct-pin.on').length>=1 && !document.querySelector('[data-a3d-act=immgo]');`, 5000), "Go to slice " + goI + " lands on a slice where the prostate pin is highlighted");
  await shot("imm-04-prostate");

  // ---- windows swap the CT and the 3D texture together ----
  const lung = await pinXY("[data-a3d-act=immwin][data-w=lung]");
  await tap(lung.x, lung.y);
  ok(await until(`var s=ATLAS3D._state; return s.imm.win==='lung' && /\\/w\\/lung\\/\\d{3}\\.webp$/.test(document.getElementById('a3dCtImg').getAttribute('src')) && document.querySelector('[data-a3d-act=immwin][data-w=lung]').getAttribute('aria-checked')==='true';`, 5000), "Lung window: CT image switches to the lung variant, segment checked");
  ok(await settled(30000), "the 3D cut plane reloaded its texture under the new window");
  await ev(`var b=document.querySelector('[data-a3d-act=immwin][data-w=""]'); b.click(); return 1;`);

  // ---- cine ----
  await ev(`document.querySelector('[data-a3d-act=immslice]').value='10'; document.querySelector('[data-a3d-act=immslice]').dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  const play = await pinXY("[data-a3d-act=immplay]");
  await tap(play.x, play.y);
  ok(await until(`return ATLAS3D._state.plane.i >= 13 && document.querySelector('[data-a3d-act=immplay]').getAttribute('aria-pressed')==='true';`, 8000), "Play steps through the slices (now " + await ev(`return ATLAS3D._state.plane.i;`) + ")");
  const play2 = await pinXY("[data-a3d-act=immplay]");
  await tap(play2.x, play2.y);
  const iStop = await ev(`return ATLAS3D._state.plane.i;`); await sleep(900);
  ok(await ev(`return ATLAS3D._state.plane.i===${iStop} && !ATLAS3D._state.imm.play;`) === true, "Pause stops it at slice " + iStop);
  // ---- region chips ----
  const head = await pinXY("#a3dImmRegions [data-r=head]");
  await tap(head.x, head.y);
  ok(await until(`var s=ATLAS3D._state; return s.plane.i===9 && /ct-live-body-axial\\/009\\.webp$/.test(document.getElementById('a3dCtImg').getAttribute('src')) && document.querySelector('#a3dImmRegions .atlas-chip.on').textContent==='Head';`, 8000), "Head jumps to slice 9 (brain) and lights the chip");
  ok(await settled(60000) && await ev(`var s=ATLAS3D._state; return Math.abs(s.cam.target[1] - s.data.planes['ct-live-body-axial']['9'].pos) < 1e-3;`) === true, "the camera framed the head level");
  ok(await ev(`return ATLAS3D._state.imm.atlas.slices[8].pins.some(function(p){return p.s==='brain';});`) === true, "slice 9 pins the brain");
  await shot("imm-05-head");
  const whole = await pinXY("#a3dImmRegions [data-r='']");
  await tap(whole.x, whole.y);
  ok(await until(`var s=ATLAS3D._state; return s.imm.follow===false && s.plane.i===9 && document.querySelector('#a3dImmRegions .atlas-chip.on').textContent==='Whole';`, 5000), "Whole frames the full body without moving the slice");
  await ev(`document.querySelector('[data-a3d-act=immplay]').click(); return 1;`);
  await ev(`ATLAS.back(); return 1;`);
  ok(await until(`return !ATLAS3D.isOpen() && ATLAS.isOpen() && !!document.querySelector('#smdAtlas .atlas-3d-card.imm');`, 5000), "Back closes Immersive CT onto the RadioAnatome catalog");
  ok(await ev(`return ATLAS3D._state.imm===null;`) === true, "closing drops the immersive state and its cine timer");

  // ---- from the 3D layer's living body ----
  await ev(`ATLAS3D.open({src:'live'}); return 1;`);
  ok(await until(`return !!document.querySelector('#a3dBar [data-a3d-act=immopen]')`, 30000), "the 3D layer's Living CT tools offer Immersive");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=immopen]').click(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return ATLAS3D.isOpen() && !!s.imm && !!s.plane && s.plane.m==='ct-live-torso-axial' && s.src==='live' && s.plane.n===48;`, 30000), "…and it opens Immersive CT on the same (torso) body");
  ok(await until(`return document.getElementById('a3dImmRegions').hidden===true && document.getElementById('a3dSub').textContent==='Living-patient CT · lower chest to pelvis';`, 10000), "the torso has no region chips and says lower chest to pelvis");
  ok(await settled(), "and it renders after the switch");
  await ev(`ATLAS3D.close(); return 1;`);

  // ---- the whole body as a 3D source, and a whole-body CT row deep-linking into it ----
  await ev(`ATLAS3D.open({src:'body'}); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.src==='body' && [].slice.call(document.querySelectorAll('#a3dSrc .a3d-srcbtn')).map(function(b){return b.textContent;}).join('|')==='Reference|Living CT|Whole body' && !!document.querySelector('#a3dBar [data-a3d-act=immopen][data-m="ct-live-body-axial"]');`, 30000), "3D sources: Reference, Living CT, Whole body; the whole body offers its own Immersive");
  await ev(`ATLAS3D.close(); ATLAS3D.open({canon:'THYROID_GLAND', from:{m:'ct-live-body-axial', i:27}}); return 1;`);
  ok(await until(`var s=ATLAS3D._state, b=s.data && s.data.canon.THYROID_GLAND.body; return s.src==='body' && !!s.plane && s.plane.m==='ct-live-body-axial' && s.plane.i===27 && !!b && b.length===1 && s.sel.length===1 && s.sel[0]===b[0];`, 30000), "a whole-body CT row (thyroid, slice 27) opens 3D on the whole body, cut at that slice, thyroid selected");
  await until(`return Object.keys(ATLAS3D._state.loading).length===0;`, 90000);
  await ev(`ATLAS3D.close(); return 1;`);

  // ---- flag off ----
  ok(await attach(BASE + "?atlas3d=1&immersive=0"), "reload with ?immersive=0");
  await clearIntro(); await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-3d-card')`), "the 3D Anatomy card stays");
  ok(await ev(`return !document.querySelector('#smdAtlas .atlas-3d-card.imm') && ATLAS3D.immEnabled()===false;`) === true, "the Immersive CT card is gone with the flag off");

  ok(pageErrors.length === 0, "no uncaught page errors" + (pageErrors.length ? ": " + pageErrors.slice(0, 5).join(" | ") : ""));
} catch (e) { console.log("💥", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
