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
  ok(await ev(`return ATLAS3D._state.data.parts.length;`) === 2227, "2,227 meshes in the manifest");
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

  // ---- CT -> 3D ----
  await ev(`document.querySelector('#atlasSheet [data-atlas-act="3d"]').click(); return 1;`);
  ok(await until(`return ATLAS3D.isOpen() && ATLAS3D._state.subject && ATLAS3D._state.subject.cid==='KIDNEY' && ATLAS3D._state.sel.length===2`, 30000), "3D pill reopens the 3D layer with KIDNEY highlighted");
  ok(await until(`var s=ATLAS3D._state; return !s.err && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10;`, 120000), "geometry re-streamed after reopen");

  // ---- search / regions / isolate / hierarchy ----
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
