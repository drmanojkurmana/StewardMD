/* RadioAnatome 3D layer — real headless-browser test (CDP).
 * Proves, in a real WebGL context: the flag gates the entry point, the catalog card opens the
 * 3D layer, geometry streams and renders, GPU picking returns a mesh, a canonical structure
 * selected from the 3D side lists its CT/MRI modules, tapping one lands in the slice viewer
 * with that structure LOCKED, and the slice sheet's "3D" pill reopens the 3D layer on the
 * same structure. Also: search, region chips, isolate, back-unwinding, and flag-off.
 * USAGE: BASE=http://localhost:8995/ node test/run-atlas3d-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const PORT = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/atlas3d-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8995"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
// SwiftShader gives headless Chrome a real (software) WebGL context.
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const until = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(250); } return false; };
async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  return until(`return !!(window.ATLAS && ATLAS.open && window.ATLAS3D)`, 30000);
}
const clearIntro = () => ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- flag ON ----
  ok(await attach(BASE + "?atlas3d=1"), "app loads with ATLAS + ATLAS3D (?atlas3d=1)");
  await clearIntro();
  ok(await ev(`return ATLAS3D.enabled();`) === true, "flag resolves ON from the query alias");
  await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-3d-card')`), "RadioAnatome catalog shows the 3D Anatomy card");
  await ev(`document.querySelector('#smdAtlas .atlas-3d-card').click(); return 1;`);
  ok(await until(`return ATLAS3D.isOpen() && !!document.getElementById('a3dCanvas')`), "3D layer opens with a canvas");
  ok(await until(`var s=ATLAS3D._state; return !!s.data && !!s.gl;`, 30000), "manifest loaded and WebGL context created");
  ok(await ev(`return ATLAS3D._state.data.parts.length;`) === 2293, "2,293 meshes in the manifest (2,227 reference + 66 living CT)");
  ok(await until(`var s=ATLAS3D._state; return !s.err && s.loaded>0 && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10;`, 120000), "default systems streamed and uploaded (no error)");
  const err = await ev(`return ATLAS3D._state.err;`);
  ok(!err, "no renderer error: " + (err || "none"));
  ok(await ev(`return document.getElementById('a3dProgress').hidden === true;`), "progress pill hides after load");
  // GPU picking at the canvas centre must hit SOME mesh on the whole-body view.
  const hit = await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45);`);
  ok(typeof hit === "number" && hit >= 0, "GPU colour pick at the body centre returns a mesh (index " + hit + ")");
  ok(await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(2, 2);`) === -1, "pick on empty background returns -1");

  // ---- 3D -> CT correlation ----
  await ev(`ATLAS3D.selectCanon('KIDNEY'); return 1;`);
  ok(await until(`var sh=document.getElementById('a3dSheet'); return !!sh && sh.classList.contains('on') && /Kidney/.test(sh.textContent)`), "selecting KIDNEY opens the sheet titled Kidney");
  ok(await ev(`return ATLAS3D._state.sel.length;`) === 2, "both kidney meshes are selected");
  await ev(`document.querySelector('#a3dSheet [data-tab=correlate]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSheet .a3d-link[data-a3d-act=ct]').length >= 3`), "CT / MRI tab lists the living-torso CT modules that pin the kidney");
  ok(await ev(`return !!document.querySelector('#a3dSheet .a3d-link[data-m="ct-live-torso-axial"][data-s="kidney"]');`), "a row targets ct-live-torso-axial / kidney");
  ok(await ev(`return !!document.querySelector('#a3dSheet [data-a3d-act=side][data-side=left]');`), "laterality pills (Left / Right / Both) are offered");
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=side][data-side=left]').click(); return 1;`);
  ok(await until(`return ATLAS3D._state.sel.length === 1 && ATLAS3D._state.data.parts[ATLAS3D._state.sel[0]].name === 'Left kidney'`), "Left pill narrows the selection to the left kidney mesh");
  await ev(`document.querySelector('#a3dSheet [data-tab=correlate]').click(); return 1;`);
  await ev(`document.querySelector('#a3dSheet .a3d-link[data-m="ct-live-torso-axial"][data-s="kidney"]').click(); return 1;`);
  ok(await until(`return !ATLAS3D.isOpen() && ATLAS._state.view==='viewer' && ATLAS._state.moduleId==='ct-live-torso-axial' && !!ATLAS._state.atlas`), "tapping the CT row closes 3D and opens the CT module");
  ok(await until(`return ATLAS._state.locked==='kidney' && ATLAS._state.sel==='kidney'`), "the kidney is selected AND locked in the slice viewer");
  const slice = await ev(`return ATLAS._state.slice;`);
  ok(await ev(`var s=ATLAS._state.atlas.slices[ATLAS._state.slice-1]; return s.pins.some(function(p){return p.s==='kidney'});`) === true, "landed on a slice that pins the kidney (slice " + slice + ")");
  ok(await until(`var sh=document.getElementById('atlasSheet'); return !!sh && sh.classList.contains('on') && !!sh.querySelector('[data-atlas-act="3d"][data-canon="KIDNEY"]')`), "slice sheet shows the 3D pill for KIDNEY");

  // ---- CT -> 3D (from a LIVING-torso slice: lands on the living body with the cut plane) ----
  await ev(`document.querySelector('#atlasSheet [data-atlas-act="3d"]').click(); return 1;`);
  ok(await until(`return ATLAS3D.isOpen() && ATLAS3D._state.subject && ATLAS3D._state.subject.cid==='KIDNEY' && ATLAS3D._state.sel.length===2`, 30000), "3D pill reopens the 3D layer with KIDNEY highlighted");
  ok(await ev(`return ATLAS3D._state.src;`) === "live", "opened from a living-torso slice: source is Living CT");
  ok(await ev(`var s=ATLAS3D._state; return s.sel.every(function(i){return s.data.parts[i].src===1}) && s.data.parts[s.sel[0]].name.indexOf('kidney')>=0;`) === true, "the selected meshes are the living-CT kidneys");
  ok(await ev(`var p=ATLAS3D._state.plane; return !!p && p.m==='ct-live-torso-axial' && p.i===` + slice + ` && p.n===24;`) === true, "the cut plane is that very slice (" + slice + "/24)");
  ok(await until(`var s=ATLAS3D._state; return !s.err && Object.keys(s.loading).length===0 && Object.keys(s.chunks).filter(function(k){return s.chunks[k].src===1}).length>=1;`, 120000), "living-CT geometry streamed");
  ok(await until(`return !!ATLAS3D._state.plane && ATLAS3D._state.plane.ready === true`, 30000), "the CT slice texture loaded onto the plane");
  // SwiftShader renders a frame in ~0.6 s, so the camera glide alone takes ~25 s here (under 1 s on a phone).
  var drawn = await until(`var s=ATLAS3D._state; return s.dirty===false && !s.camTo`, 90000);
  ok(drawn, "the frame after the last chunk is actually drawn (dirty cleared with no animation running)" + (drawn ? "" : " state=" + await ev(`var s=ATLAS3D._state; return JSON.stringify({dirty:s.dirty, raf:s.raf, camTo:s.camTo, explode:[s.explode, s.explodeTarget], loading:Object.keys(s.loading).length});`)));
  ok(await ev(`return !!document.querySelector('#a3dBar [data-a3d-act=slice]') && !!document.querySelector('#a3dSrc .a3d-srcbtn.on[data-id=live]');`) === true, "slice slider is shown and the Living CT tab is active");
  await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=slice]'); r.value=12; r.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  ok(await until(`return ATLAS3D._state.plane && ATLAS3D._state.plane.i===12`), "slider moves the cut to slice 12");
  ok(await ev(`var l=document.getElementById('a3dLabel'); return !!l && !l.hidden && /Kidney/.test(l.textContent);`) === true, "callout label names the selection on the canvas");
  await ev(`document.querySelector('#a3dSheet [data-tab=correlate]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSheet .a3d-link.a3d-plane').length >= 3`), "CT rows into living-torso modules offer Show in 3D");
  await ev(`document.querySelector('#a3dSrc .a3d-srcbtn[data-id=bp3d]').click(); return 1;`);
  ok(await until(`return ATLAS3D._state.src==='bp3d' && ATLAS3D._state.plane===null`), "Reference tab switches body and drops the plane");
  ok(await ev(`var s=ATLAS3D._state; var skin=s.data.parts.filter(function(p){return p.src===1 && s.data.systems[p.sys].id==='integumentary'})[0]; return !!skin && s.shell===true && !!s.chunks[s.data.chunks.filter(function(c){return c.src===1 && c.system==='integumentary'})[0].id];`) === true, "the living body's skin chunk streamed for the body outline");
  ok(await ev(`return ATLAS3D._state.data.parts.filter(function(p){return p.src===1 && ATLAS3D._state.data.systems[p.sys].id==='skeletal'}).length;`) === 27, "27 living bones (spine, lower ribs, pelvis, femurs) are in the manifest");
  await ev(`ATLAS3D.setSource('live'); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.src==='live' && !!s.hidden[s.data.byId['LIVE_colon']] && !!s.hidden[s.data.byId['LIVE_small_bowel']]`), "living body hides the bowel by default (Layers > Bowel shows it)");
  await ev(`ATLAS3D.selectCanon('COLON'); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.sel.length===1 && s.data.parts[s.sel[0]].id==='LIVE_colon'`), "selecting COLON still shows the living colon (selection wins over the default)");
  await ev(`ATLAS3D.setSource('bp3d'); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return !s.err && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10;`, 120000), "reference geometry streamed after switching back");
  await ev(`ATLAS3D.selectCanon('LIVER'); return 1;`);
  ok(await until(`return ATLAS3D._state.src==='live' && ATLAS3D._state.sel.length===1 && ATLAS3D._state.data.parts[ATLAS3D._state.sel[0]].id==='LIVE_liver'`), "LIVER (no reference surface) auto-switches to the living-CT liver");
  await ev(`document.querySelector('[data-a3d-act=view]').click(); return 1;`);
  ok(await ev(`return ATLAS3D._state.view===1 && document.querySelector('[data-a3d-act=view]').textContent==='Front';`) === true, "view button cycles to Front");
  await ev(`ATLAS3D.setSource('bp3d'); return 1;`);

  // ---- search / regions / isolate / hierarchy ----
  await ev(`var q=document.getElementById('a3dQ'); q.value='liver'; q.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(await until(`var r=document.getElementById('a3dResults'); return !!r && !r.hidden && r.firstChild && r.firstChild.classList.contains('canon')`), "unified search: 'liver' leads with the RadioAnatome CT/MRI entry");
  await ev(`var q=document.getElementById('a3dQ'); q.value='femur'; q.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(await until(`var r=document.getElementById('a3dResults'); return !!r && !r.hidden && /femur/i.test(r.textContent)`), "search 'femur' shows results");
  await ev(`document.querySelector('#a3dResults .a3d-hit[data-a3d-act=part]').click(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.subject && s.subject.kind==='part' && /femur/i.test(s.data.parts[s.subject.i].name)`), "tapping a result selects that mesh");
  ok(await ev(`return document.getElementById('a3dResults').hidden;`) === true, "results close after a pick");
  await ev(`document.querySelector('#a3dSheet [data-tab=correlate]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSheet .a3d-link[data-a3d-act=ct]').length >= 3`), "a femur mesh correlates to the knee/pelvis CT modules through FEMUR");
  await ev(`document.querySelector('#a3dSheet [data-tab=hierarchy]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSheet .a3d-tree').length >= 1`), "hierarchy tab lists parent FMA concepts");
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=isolate]').click(); return 1;`);
  ok(await ev(`return ATLAS3D._state.isolate === true;`) === true, "Isolate toggles on");
  await ev(`document.querySelector('#a3dChips [data-r=BRAIN]').click(); return 1;`);
  ok(await until(`return ATLAS3D._state.region==='BRAIN' && document.querySelector('#a3dChips .atlas-chip.on').textContent==='Brain'`), "region chip switches to Brain");
  await ev(`document.querySelector('[data-a3d-act=systems]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSystems input[data-a3d-act=sys]').length === 15`), "Layers panel lists 15 systems");
  ok(await ev(`return !!document.querySelector('#a3dSystems input[data-a3d-act=lod]');`) === true, "Layers panel offers the Full detail / LOD switch");
  ok(await ev(`return document.querySelector('#a3dSystems input[data-id=muscular]').checked;`) === false, "muscles are off by default (mobile budget)");
  await ev(`document.querySelector('[data-a3d-act=info]').click(); return 1;`);
  ok(await until(`var i=document.getElementById('a3dInfo'); return !!i && i.textContent.indexOf('BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International')>=0`), "About screen renders the mandated CC BY attribution verbatim");
  ok(await ev(`return document.body.textContent.split('Database Center for Life Science').length - 1;`) === 1, "the attribution renders ONLY on the About screen");

  // ---- back unwinding: info -> layers -> sheet -> close ----
  ok(await ev(`return ATLAS.back() === true && !document.getElementById('a3dInfo');`) === true, "back closes About");
  ok(await ev(`return ATLAS.back() === true && !document.getElementById('a3dSystems');`) === true, "back closes Layers");
  ok(await ev(`return ATLAS.back() === true && !document.getElementById('a3dSheet').classList.contains('on');`) === true, "back closes the sheet");
  ok(await ev(`return ATLAS.back() === true && !ATLAS3D.isOpen() && ATLAS.isOpen();`) === true, "back closes the 3D layer and leaves RadioAnatome open underneath");
  ok(await ev(`return !document.getElementById('a3dCanvas') && !ATLAS3D._state.gl;`) === true, "close disposes the canvas and the GL context");

  // ---- flag OFF ----
  ok(await attach(BASE + "?atlas3d=0"), "app reloads with ?atlas3d=0");
  await clearIntro();
  await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-row')`), "catalog renders");
  ok(await ev(`return !document.querySelector('#smdAtlas .atlas-3d-card');`) === true, "flag off: no 3D card");
  await ev(`ATLAS.openAt('ct-live-torso-axial','kidney',5); return 1;`);
  ok(await until(`var sh=document.getElementById('atlasSheet'); return ATLAS._state.locked==='kidney' && !!sh && sh.classList.contains('on')`), "openAt still works with the flag off");
  ok(await ev(`return !document.querySelector('#atlasSheet [data-atlas-act="3d"]');`) === true, "flag off: no 3D pill on the slice sheet");
} catch (e) { console.log("💥", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
