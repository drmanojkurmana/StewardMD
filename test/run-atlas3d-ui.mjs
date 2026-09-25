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
// CDP_PORT / BASE let two runs coexist (parallel agents); the defaults are unchanged.
const PORT = +process.env.CDP_PORT || 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/atlas3d-ui-chrome" + (PORT === 9387 ? "" : "-" + PORT);
const SHOTS = process.env.SHOTS || "";   // a directory: write 430x900 screenshots of the new controls there
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8995"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
// Never drive someone else's browser: a Chrome already on this debug port may lack the SwiftShader flags.
try { await fetch(`http://localhost:${PORT}/json/version`); console.log(`💥 Chrome debug port ${PORT} is already in use; set CDP_PORT to a free port.`); process.exit(2); } catch {}
// SwiftShader gives headless Chrome a real (software) WebGL context.
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r, rej) => { const to = setTimeout(() => { pending.delete(i); rej(new Error("CDP " + m + " got no answer in 180 s (renderer crashed or hung)")); }, 180000); pending.set(i, (x) => { clearTimeout(to); r(x); }); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const until = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(250); } return false; };
let curTarget = null;
async function attach(url) {
  if (curTarget) { const old = curTarget; curTarget = null; sessionId = undefined; try { await call("Target.closeTarget", { targetId: old }); } catch {} }
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" }); curTarget = targetId;
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  // A fixed 430x900 phone-sized viewport (headless ignores a window this narrow), so pixel checks and screenshots are stable.
  await call("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  return until(`return !!(window.ATLAS && ATLAS.open && window.ATLAS3D)`, 30000);
}
const clearIntro = () => ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
const evp = async (e, ms = 60000) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true, timeout: ms }); return r.result && r.result.result ? r.result.result.value : null; };
const shot = async (name) => { if (!SHOTS) return; const { mkdirSync, writeFileSync } = await import("node:fs"); mkdirSync(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) { writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("   shot: " + join(SHOTS, name + ".png")); } };
// Frame signature from a synchronous render + readPixels: a hash, and how many sampled pixels are lit (not background).
const SIG = `var f=ATLAS3D._readFrame(); if(!f) return null; var h=0, lit=0; for (var i=0;i<f.px.length;i+=4*7){ h=(h*31 + f.px[i]*3 + f.px[i+1]*5 + f.px[i+2]*7)>>>0; if (f.px[i]+f.px[i+1]+f.px[i+2] > 90) lit++; } return JSON.stringify({h:h, lit:lit});`;
const sig = async () => JSON.parse(await ev(SIG) || "null");
const BP3D_CREDIT = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";
const SNAP = `var r = await ATLAS3D._snapshot(); var u = new Uint8Array(await r.blob.arrayBuffer()); var b=''; for (var i=0;i<u.length;i+=32768) b += String.fromCharCode.apply(null, u.subarray(i, i+32768));
  var bm = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; var x = c.getContext('2d'); x.drawImage(bm, 0, 0);
  var bandTop = bm.height - r.bandH, px = r.bandH ? x.getImageData(0, bandTop, bm.width, r.bandH).data : [], text = 0, dark = 0;
  for (var j=0;j<px.length;j+=4){ var s = px[j]+px[j+1]+px[j+2]; if (s > 450) text++; else if (s < 60) dark++; }
  var fh = ATLAS3D._state.canvas.height;
  return JSON.stringify({size:u.length, png:u[0]===0x89&&u[1]===0x50&&u[2]===0x4e&&u[3]===0x47, name:r.name, credit:r.credit, lines:r.lines, bandH:r.bandH, h:bm.height, frameH:fh, text:text, dark:dark, b64:btoa(b)});`;
const snapProbe = async () => JSON.parse(await evp(SNAP) || "{}");
const settled = (ms = 90000) => until(`var s=ATLAS3D._state; return !s.camTo && Object.keys(s.loading).length===0 && (!s.plane || s.plane.ready===true);`, ms);   // the slice texture lands asynchronously too
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Target.targetCrashed") console.log("💥 renderer crashed: " + JSON.stringify(m.params)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await call("Target.setDiscoverTargets", { discover: true });

  // ---- flag ON ----
  ok(await attach(BASE + "?atlas3d=1"), "app loads with ATLAS + ATLAS3D (?atlas3d=1)");
  await clearIntro();
  await ev(`localStorage.removeItem('smd_atlas3d_hint'); localStorage.removeItem('smd_atlas3d_views'); return 1;`);   // first-open state
  ok(await ev(`return ATLAS3D.enabled();`) === true, "flag resolves ON from the query alias");
  await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-3d-card')`), "RadioAnatome catalog shows the 3D Anatomy card");
  await ev(`document.querySelector('#smdAtlas .atlas-3d-card').click(); return 1;`);
  ok(await until(`return ATLAS3D.isOpen() && !!document.getElementById('a3dCanvas')`), "3D layer opens with a canvas");
  ok(await until(`var s=ATLAS3D._state; return !!s.data && !!s.gl;`, 30000), "manifest loaded and WebGL context created");
  // ---- loading progress in bytes (checked while the default systems stream in) ----
  ok(await until(`var p=document.getElementById('a3dProgress'); return p.getAttribute('role')==='progressbar' && /^\\d+$/.test(p.getAttribute('aria-valuenow')||'') && /\\d+% \\([\\d.]+ of [\\d.]+ MB\\)/.test(p.textContent);`, 20000), "progress is a progressbar in percent and MB: " + await ev(`return document.getElementById('a3dProgress').textContent;`));
  // ---- first-open gesture hint ----
  ok(await until(`return !!document.getElementById('a3dHint')`, 10000), "first open shows the gesture hint");
  ok(await ev(`var h=document.getElementById('a3dHint'), t=h.textContent; return h.querySelectorAll('li').length===4 && /Drag/.test(t) && /zoom/.test(t) && /Tap/.test(t) && /Double-tap/.test(t) && !!h.querySelector('button[data-a3d-act=hintok]') && h.getAttribute('role')==='dialog';`) === true, "hint names drag, zoom, tap, double-tap and has a Got it button");
  await shot("01-gesture-hint");
  ok(await ev(`return ATLAS3D._state.data.parts.length;`) === 2293, "2,293 meshes in the manifest (2,227 reference + 66 living CT)");
  ok(await until(`var s=ATLAS3D._state; return !s.err && s.loaded>0 && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10;`, 120000), "default systems streamed and uploaded (no error)");
  const err = await ev(`return ATLAS3D._state.err;`);
  ok(!err, "no renderer error: " + (err || "none"));
  ok(await ev(`return document.getElementById('a3dProgress').hidden === true;`), "progress pill hides after load");
  await ev(`document.querySelector('#a3dHint button').click(); return 1;`);
  ok(await ev(`return !document.getElementById('a3dHint') && localStorage.getItem('smd_atlas3d_hint')==='1';`) === true, "Got it dismisses the hint and remembers it");
  // GPU picking at the canvas centre must hit SOME mesh on the whole-body view.
  const hit = await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45);`);
  ok(typeof hit === "number" && hit >= 0, "GPU colour pick at the body centre returns a mesh (index " + hit + ")");
  ok(await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(2, 2);`) === -1, "pick on empty background returns -1");

  // ---- premium controls on the reference body ----
  ok(await settled(), "camera settled before pixel checks");
  const s0 = await sig();
  ok(!!s0 && s0.lit > 50, "a synchronous frame readback shows the body (" + (s0 && s0.lit) + " lit samples)");
  // free cut plane
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clip]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !!s.clip && s.clip.axis==='y' && document.querySelectorAll('#a3dBar .a3d-segbtn').length===3 && !!document.querySelector('#a3dBar [data-a3d-act=clippos]');`) === true, "Cut adds an axial plane with Axial / Coronal / Sagittal and a position slider");
  const s1 = await sig();
  ok(s1.h !== s0.h && s1.lit < s0.lit, "the axial cut changes the rendered pixels and removes the upper body (" + s0.lit + " -> " + s1.lit + ")");
  await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=clippos]'); r.value=80; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  const s2 = await sig();
  ok(Math.abs(await ev(`return ATLAS3D._state.clip.t;`) - 0.8) < 1e-9 && s2.h !== s1.h && s2.lit > s1.lit, "moving the cut up keeps more of the body (" + s1.lit + " -> " + s2.lit + ")");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clipaxis][data-ax=x]').click(); return 1;`);
  const s3 = await sig();
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clipflip]').click(); return 1;`);
  const s4 = await sig();
  ok(await ev(`var c=ATLAS3D._state.clip; return c.axis==='x' && c.flip===true && document.querySelector('#a3dBar [data-a3d-act=clipflip]').getAttribute('aria-pressed')==='true';`) === true && s3.h !== s2.h && s4.h !== s3.h, "Sagittal and Flip each change the cut and the pixels");
  await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=xray]'); r.value=85; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(Math.abs(await ev(`return ATLAS3D._state.xray;`) - 0.15) < 1e-9, "X-ray slider sets the opacity of everything unselected");
  await shot("02-cut-and-xray");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clipoff]').click(); return 1;`);
  const s5 = await sig();
  ok(s5.h !== s0.h, "X-ray alone changes the frame (whole body see-through)");
  await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=xray]'); r.value=0; r.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  const s6 = await sig();
  ok(s6.h === s0.h, "cut removed and X-ray back at 0: the frame is pixel-identical to the default view");
  await ev(`ATLAS3D._state.xray = null; return 1;`);
  // fade / hide / isolate with undo; a faded part lets the tap through
  await ev(`ATLAS3D._select([` + hit + `], {kind:'part', i:` + hit + `}, {noFocus:true}); return 1;`);
  ok(await until(`var p=document.querySelector('#a3dSheet [data-a3d-act=fade]'); return !!p && p.textContent==='Fade' && !!document.querySelector('#a3dSheet [data-a3d-act=hide]') && !!document.querySelector('#a3dSheet [data-a3d-act=isolate]');`), "sheet offers Fade next to Hide and Isolate");
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=fade]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !!s.faded[` + hit + `] && s.sel.length===0 && !!document.querySelector('#a3dBar [data-a3d-act=undo]') && /Show all 1/.test(document.querySelector('#a3dBar [data-a3d-act=unhide]').textContent);`) === true, "Fade marks the part, deselects it, and offers Undo and Show all");
  const sFade = await sig();
  ok(sFade.h !== s0.h, "the faded part renders differently (translucent)");
  const through = await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45);`);
  ok(through !== hit, "a tap on the faded part passes through to what is behind (" + hit + " -> " + through + ")");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=undo]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state, c=document.getElementById('a3dCanvas'); return !s.faded[` + hit + `] && s.hist.length===0 && ATLAS3D._pickAt(c.width/2, c.height*0.45)===` + hit + `;`) === true, "Undo restores the part (picked again) and empties the history");
  await ev(`ATLAS3D._select([` + hit + `], {kind:'part', i:` + hit + `}, {noFocus:true}); return 1;`);
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=isolate]').click(); return 1;`);
  ok(await ev(`return ATLAS3D._state.isolate===true && ATLAS3D._state.hist.length===1;`) === true, "Isolate is recorded in the history");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=undo]').click(); return 1;`);
  ok(await ev(`return ATLAS3D._state.isolate===false && ATLAS3D._state.sel.length===1;`) === true, "Undo turns Isolate back off and keeps the selection");
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=hide]').click(); return 1;`);
  const other = await ev(`var s=ATLAS3D._state; for (var i=0;i<s.data.parts.length;i++){ if (i!==` + hit + ` && s.data.parts[i].src===0 && s.gl.stateData[i*4]===255) return i; } return -1;`);
  await ev(`ATLAS3D._select([` + other + `], {kind:'part', i:` + other + `}, {noFocus:true}); return 1;`);
  await ev(`document.querySelector('#a3dSheet [data-a3d-act=fade]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !!s.hidden[` + hit + `] && !!s.faded[` + other + `] && /Show all 2/.test(document.querySelector('#a3dBar [data-a3d-act=unhide]').textContent);`) === true, "one hidden + one faded part: Show all 2");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=unhide]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !s.hidden[` + hit + `] && !s.faded[` + other + `] && !document.querySelector('#a3dBar [data-a3d-act=unhide]');`) === true, "Show all clears every hide and fade");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=undo]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !!s.hidden[` + hit + `] && !!s.faded[` + other + `];`) === true, "Undo after Show all brings both back");
  // saved views: save, change everything, restore, delete
  await ev(`var s=ATLAS3D._state; s.clip={axis:'z',t:0.4,flip:false}; s.cam.yaw=1.1; s.cam.pitch=0.3; ATLAS3D._select([` + other + `], {kind:'part', i:` + other + `}, {noFocus:true}); return 1;`);
  await ev(`document.querySelector('#a3dBar [data-a3d-act=systems]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('a3dViewName') && !!document.querySelector('#a3dSystems [data-a3d-act=vsave]')`), "Layers panel has a Saved views section");
  await ev(`document.getElementById('a3dViewName').value='Hidden part test'; document.querySelector('#a3dSystems [data-a3d-act=vsave]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#a3dSystems [data-a3d-act=vload]').length===1 && /Hidden part test/.test(document.querySelector('#a3dSystems .a3d-vlist').textContent)`), "the saved view is listed by name");
  await shot("03-saved-views");
  const saved = JSON.parse(await ev(`return localStorage.getItem('smd_atlas3d_views');`) || "[]");
  ok(saved.length === 1 && saved[0].hidden.length === 1 && saved[0].clip.axis === "z" && Math.abs(saved[0].cam.yaw - 1.1) < 1e-9, "the view is stored with part ids, the cut and the camera");
  await ev(`document.querySelector('#a3dSystems [data-a3d-act=panelclose]').click(); document.querySelector('#a3dBar [data-a3d-act=reset]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state; return !s.clip && Object.keys(s.faded).length===0 && s.hist.length===0 && s.xray===null && !document.querySelector("#a3dBar [data-a3d-act=unhide]");`) === true, "Reset clears cut, fades, X-ray and history, and shows no stray Show all");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=systems]').click(); return 1;`);
  await until(`return !!document.querySelector('#a3dSystems [data-a3d-act=vload]')`);
  await ev(`document.querySelector('#a3dSystems [data-a3d-act=vload]').click(); return 1;`);
  ok(await ev(`var s=ATLAS3D._state, c=s.camTo||s.cam; return !document.getElementById('a3dSystems') && !!s.hidden[` + hit + `] && !!s.faded[` + other + `] && s.clip && s.clip.axis==='z' && Math.abs(s.clip.t-0.4)<1e-9 && s.sel.length===1 && s.sel[0]===` + other + ` && Math.abs(c.yaw-1.1)<1e-9 && Math.abs(c.pitch-0.3)<1e-9;`) === true, "restoring the view brings back camera, selection, hidden, faded and the cut");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=systems]').click(); return 1;`);
  await until(`return !!document.querySelector('#a3dSystems [data-a3d-act=vdel]')`);
  await ev(`document.querySelector('#a3dSystems [data-a3d-act=vdel]').click(); return 1;`);
  ok(await until(`return !document.querySelector('#a3dSystems [data-a3d-act=vload]') && JSON.parse(localStorage.getItem('smd_atlas3d_views')).length===0`), "deleting the view removes it from the list and storage");
  await ev(`document.querySelector('#a3dSystems [data-a3d-act=panelclose]').click(); return 1;`);
  // snapshot: a real PNG with the structure name in the file name, shared as a File
  const snap = await snapProbe();
  const partSlug = (await ev(`var s=ATLAS3D._state; return s.data.parts[` + other + `].name;`) || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  ok(snap.png && snap.size > 5000, "snapshot is a non-empty PNG (" + snap.size + " bytes)");
  ok(typeof snap.name === "string" && snap.name.indexOf(partSlug) >= 0 && /\.png$/.test(snap.name), "snapshot filename carries the selected structure: " + snap.name);
  ok(snap.credit === BP3D_CREDIT, "reference-body snapshot carries the verbatim BodyParts3D CC BY credit");
  ok(snap.bandH > 0 && snap.h === snap.frameH + snap.bandH && snap.lines >= 1, "the credit is a band added below the frame (" + snap.lines + " lines, " + snap.bandH + " px), not over the view");
  ok(snap.text > 150 && snap.dark > snap.text, "the credit band in the decoded PNG has text on a dark band (" + snap.text + " text px)");
  if (SHOTS && snap.b64) { const { writeFileSync } = await import("node:fs"); writeFileSync(join(SHOTS, "04-snapshot-output.png"), Buffer.from(snap.b64, "base64")); }
  await ev(`window.__shared=null; navigator.canShare=function(){return true}; navigator.share=function(d){ window.__shared={n:d.files.length, name:d.files[0].name, type:d.files[0].type, size:d.files[0].size}; return Promise.resolve(); }; document.querySelector('#a3dBar [data-a3d-act=snap]').click(); return 1;`);
  ok(await until(`return !!window.__shared && window.__shared.n===1 && window.__shared.type==='image/png' && window.__shared.size>5000`), "the image button shares a PNG File through Web Share");
  // quiz
  await ev(`document.querySelector('#a3dBar [data-a3d-act=reset]').click(); return 1;`);
  await ev(`document.querySelector('#a3dBar [data-a3d-act=quiz]').click(); return 1;`);
  ok(await until(`var q=document.getElementById('a3dQuiz'), s=ATLAS3D._state; return !!s.quiz && !!s.quiz.target && !q.hidden && /Tap the/.test(q.textContent) && q.textContent.indexOf(s.data.canon[s.quiz.target].name)>=0`), "Quiz asks for a loaded, visible structure by name: " + await ev(`var s=ATLAS3D._state; return s.quiz && s.quiz.target;`));
  ok(await ev(`var s=ATLAS3D._state, e=s.data.canon[s.quiz.target]; return (e.kind==='concept'||e.kind==='composite') && e.coverage==='full' && e.parts.every(function(i){return s.gl.stateData[i*4]===255}) && s.quiz.px>=30;`) === true, "the asked structure is whole, every mesh is switched on, and it has " + await ev(`return ATLAS3D._state.quiz.px;`) + " tappable pixels in the pick buffer");
  await shot("05-quiz");
  const wrong = await ev(`var s=ATLAS3D._state, t=s.data.canon[s.quiz.target].parts; for (var i=0;i<s.data.parts.length;i++){ if (t.indexOf(i)<0 && s.data.parts[i].src===0 && s.gl.stateData[i*4]===255) return i; } return -1;`);
  await ev(`ATLAS3D._quizTap(` + wrong + `); return 1;`);
  ok(await ev(`var q=ATLAS3D._state.quiz; return q.state==='ask' && q.score===0 && /Not quite/.test(document.querySelector('#a3dQuiz .a3d-qmsg.bad').textContent);`) === true, "a wrong tap says what was tapped and lets you try again");
  await ev(`var s=ATLAS3D._state; ATLAS3D._quizTap(s.data.canon[s.quiz.target].parts[0]); return 1;`);
  ok(await ev(`var q=ATLAS3D._state.quiz, el=document.getElementById('a3dQuiz'); return q.state==='right' && q.score===1 && q.n===1 && /Correct/.test(el.textContent) && /1 \\/ 1/.test(el.textContent) && ATLAS3D._state.sel.length>0;`) === true, "a right tap scores 1 / 1 and highlights the answer");
  await ev(`document.querySelector('#a3dQuiz [data-a3d-act=quiznext]').click(); return 1;`);
  await ev(`document.querySelector('#a3dQuiz [data-a3d-act=quizskip]').click(); return 1;`);
  ok(await ev(`var q=ATLAS3D._state.quiz; return q.state==='shown' && q.score===1 && q.n===2 && ATLAS3D._state.sel.length>0;`) === true, "Show me reveals the answer and counts the question (1 / 2)");
  await ev(`document.querySelector('#a3dQuiz [data-a3d-act=quizend]').click(); return 1;`);
  ok(await ev(`return ATLAS3D._state.quiz===null && document.getElementById('a3dQuiz').hidden && ATLAS3D._state.sel.length===0;`) === true, "Exit ends the quiz and clears the highlight");

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
  ok(await ev(`return !document.getElementById('a3dHint');`) === true, "the gesture hint is not shown again");
  ok(await ev(`var s=ATLAS3D._state; return s.sel.every(function(i){return s.data.parts[i].src===1}) && s.data.parts[s.sel[0]].name.indexOf('kidney')>=0;`) === true, "the selected meshes are the living-CT kidneys");
  // slice counts come from the manifest (24, or 48 since the denser stacks), never hardcoded
  const nPlanes = await ev(`return Object.keys(ATLAS3D._state.data.planes['ct-live-torso-axial']).length;`);
  const target = slice === Math.round(nPlanes / 2) ? Math.round(nPlanes / 2) + 1 : Math.round(nPlanes / 2);
  ok(nPlanes >= 24 && await ev(`var p=ATLAS3D._state.plane; return !!p && p.m==='ct-live-torso-axial' && p.i===` + slice + ` && p.n===` + nPlanes + `;`) === true, "the cut plane is that very slice (" + slice + "/" + nPlanes + ")");
  ok(await until(`var s=ATLAS3D._state; return !s.err && Object.keys(s.loading).length===0 && Object.keys(s.chunks).filter(function(k){return s.chunks[k].src===1}).length>=1;`, 120000), "living-CT geometry streamed");
  ok(await until(`return !!ATLAS3D._state.plane && ATLAS3D._state.plane.ready === true`, 30000), "the CT slice texture loaded onto the plane");
  // SwiftShader renders a frame in ~0.6 s, so the camera glide alone takes ~25 s here (under 1 s on a phone).
  var drawn = await until(`var s=ATLAS3D._state; return s.dirty===false && !s.camTo`, 180000);   // 180 s: other agents share the CPU with SwiftShader
  ok(drawn, "the frame after the last chunk is actually drawn (dirty cleared with no animation running)" + (drawn ? "" : " state=" + await ev(`var s=ATLAS3D._state; return JSON.stringify({dirty:s.dirty, raf:s.raf, camTo:s.camTo, explode:[s.explode, s.explodeTarget], loading:Object.keys(s.loading).length});`)));
  ok(await ev(`return !!document.querySelector('#a3dBar [data-a3d-act=slice]') && !!document.querySelector('#a3dSrc .a3d-srcbtn.on[data-id=live]');`) === true, "slice slider is shown and the Living CT tab is active");
  await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=slice]'); r.value=` + target + `; r.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  ok(await until(`return ATLAS3D._state.plane && ATLAS3D._state.plane.i===` + target), "slider moves the cut to slice " + target);
  ok(await ev(`var l=document.getElementById('a3dLabel'); return !!l && !l.hidden && /Kidney/.test(l.textContent);`) === true, "callout label names the selection on the canvas");
  // the registered CT cut wins over the free cut; the free cut works on the living body once the slice is gone
  await settled();
  const l0 = await sig();
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clip]').click(); return 1;`);
  const l1 = await sig();
  ok(l1.h === l0.h && await ev(`var r=document.querySelector('#a3dBar [data-a3d-act=clippos]'); return r.disabled && /CT slice/.test(document.querySelector('#a3dBar .a3d-cliprow').textContent);`) === true, "while a CT slice is shown the CT cut wins (identical pixels " + l0.h + "=" + l1.h + ", cut slider paused)");
  await shot("06-living-ct-cut-paused");
  await ev(`document.querySelector('#a3dBar [data-a3d-act=planeoff]').click(); return 1;`);
  const l2 = await sig();
  await ev(`document.querySelector('#a3dBar [data-a3d-act=clipoff]').click(); return 1;`);
  const l3 = await sig();
  ok(l2.h !== l3.h && l2.lit < l3.lit, "with the slice gone the free cut cuts the living body (" + l3.lit + " -> " + l2.lit + ")");
  await ev(`ATLAS3D.setPlane('ct-live-torso-axial', ` + target + `, {noFocus:true}); return 1;`);
  ok(await until(`return !!ATLAS3D._state.plane && ATLAS3D._state.plane.i===` + target + ` && ATLAS3D._state.plane.ready===true`, 30000), "slice " + target + " back on the living body");
  // living-CT snapshot: credit from live.json's source fields (dataset, licence, doi)
  const { readFileSync } = await import("node:fs");
  const liveSrc = JSON.parse(readFileSync(join(HERE, "..", "atlas/3d/live.json"), "utf8")).source;
  const lsnap = await snapProbe();
  ok(lsnap.png && lsnap.credit === `${liveSrc.dataset}, ${liveSrc.licence}, doi:${liveSrc.doi}`, "living-CT snapshot credits live.json: " + lsnap.credit);
  ok(lsnap.bandH > 0 && lsnap.text > 150 && lsnap.dark > lsnap.text, "its credit band is drawn in the PNG (" + lsnap.text + " text px)");
  if (SHOTS && lsnap.b64) { const { writeFileSync } = await import("node:fs"); writeFileSync(join(SHOTS, "08-snapshot-living-ct.png"), Buffer.from(lsnap.b64, "base64")); }
  ok(await ev(`var t=document.getElementById('smdAtlas3d').textContent; return t.indexOf('zenodo.10047292')<0 && t.indexOf('Database Center for Life Science')<0;`) === true, "no credit text leaked into the DOM");
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

  // ---- one chunk fails: the rest stays usable, Retry fetches only what failed ----
  await ev(`window.__realFetch = window.__realFetch || window.fetch; window.__asked = []; window.fetch = function(u){ var s=String(u && u.url || u); if (/cardiac-/.test(s)) { window.__asked.push(s); return Promise.reject(new TypeError('forced test failure')); } return window.__realFetch.apply(this, arguments); }; ATLAS3D.open(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return !!s.gl && s.loaded>5 && Object.keys(s.loading).length===0 && Object.keys(s.failed).length>0`, 120000), "a forced cardiac chunk failure is recorded per chunk: " + await ev(`return Object.keys(ATLAS3D._state.failed).join(',');`));
  ok(await ev(`var s=ATLAS3D._state, p=document.getElementById('a3dProgress'); return !s.err && !p.hidden && /Some anatomy failed to load/.test(p.textContent) && !!p.querySelector('[data-a3d-act=retry]') && Object.keys(s.chunks).length>=10;`) === true, "compact banner with Retry; no fatal error; the other chunks are loaded and drawn");
  ok(await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45) >= 0;`) === true, "the loaded parts stay pickable");
  await shot("07-chunk-failure-retry");
  const failedIds = await ev(`return Object.keys(ATLAS3D._state.failed).sort().join(',');`);
  await ev(`window.fetch = function(u){ window.__asked.push('R:' + String(u && u.url || u)); return window.__realFetch.apply(this, arguments); }; window.__asked = []; document.querySelector('#a3dProgress [data-a3d-act=retry]').click(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return Object.keys(s.failed).length===0 && Object.keys(s.loading).length===0 && document.getElementById('a3dProgress').hidden;`, 60000), "Retry succeeds and the banner clears");
  ok(await ev(`var s=ATLAS3D._state; return '` + failedIds + `'.split(',').every(function(id){ return !!s.chunks[id]; });`) === true, "the previously failed chunks are now uploaded (" + failedIds + ")");
  ok(await ev(`return window.__asked.length>0 && window.__asked.every(function(u){ return /cardiac-/.test(u); });`) === true, "Retry re-fetched only the failed chunks: " + await ev(`return window.__asked.length + ' requests';`));
  await ev(`window.fetch = window.__realFetch; return 1;`);
  // ---- close while chunks are in flight, reopen at once: the closed session must not upload ----
  await ev(`ATLAS3D.close(); window.fetch = function(){ var a = arguments, t = this; return new Promise(function(r){ setTimeout(r, 1500); }).then(function(){ return window.__realFetch.apply(t, a); }); }; ATLAS3D.open(); return 1;`);
  ok(await until(`return Object.keys(ATLAS3D._state.loading || {}).length > 0`, 30000), "chunks in flight before the close");
  await ev(`ATLAS3D.close(); ATLAS3D.open(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return !!s.gl && s.loaded>5 && Object.keys(s.loading).length===0`, 120000), "reopened while the closed session's chunks were still downloading");
  ok(await ev(`var s=ATLAS3D._state; return s.loaded === Object.keys(s.chunks).length;`) === true, "no chunk from the closed session was uploaded into the reopened one (" + await ev(`var s=ATLAS3D._state; return s.loaded + ' loaded / ' + Object.keys(s.chunks).length + ' chunks';`) + ")");
  await ev(`window.fetch = window.__realFetch; ATLAS3D.close(); return 1;`);
  // ---- flag OFF ----
  ok(await attach(BASE + "?atlas3d=0"), "app reloads with ?atlas3d=0");
  await clearIntro();
  await ev(`ATLAS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdAtlas .atlas-row')`), "catalog renders");
  ok(await ev(`return !document.querySelector('#smdAtlas .atlas-3d-card');`) === true, "flag off: no 3D card");
  await ev(`ATLAS.openAt('ct-live-torso-axial','kidney',5); return 1;`);
  ok(await until(`var sh=document.getElementById('atlasSheet'); return ATLAS._state.locked==='kidney' && !!sh && sh.classList.contains('on')`), "openAt still works with the flag off");
  ok(await ev(`return !document.querySelector('#atlasSheet [data-atlas-act="3d"]');`) === true, "flag off: no 3D pill on the slice sheet");
  // ---- a device that cached a wrong-size chunk (the 2026-09-06 R2 overwrite) recovers ----
  // Geometry is pointed at the R2 base so the on-device cache is used, R2 URLs are served from this
  // server, and one living chunk's cache entry holds another chunk's valid gzip (wrong size).
  ok(await attach(BASE + "?atlas3d=1"), "fresh page for the poisoned-cache check");
  await clearIntro();
  await ev(`var R2='https://models.stewardmd.in/atlas3d', d=null; localStorage.setItem('smd_atlas3d_hint','1'); localStorage.setItem('smd_atlas3d_base', R2);
    window.__real = window.fetch; window.__net = {};
    window.fetch = function(u, o){ var s = String(u && u.url || u); if (s.indexOf(R2) === 0) { var f = s.slice(R2.length); window.__net[f] = (window.__net[f] || 0) + 1; return window.__real('/atlas/3d' + f, o); } return window.__real.apply(this, arguments); };
    window.__real('/atlas/3d/manifest.json').then(function(r){ return r.json(); }).then(function(m){
      var live = m.chunks.filter(function(c){ return /\\/live-/.test(c.url); }), bad = live[0], other = live[1];
      window.__bad = bad.url.split('/').pop();
      return window.__real(other.url).then(function(r){ return r.arrayBuffer(); }).then(function(b){
        return caches.open('atlas3d-v1').then(function(c){ return c.put(R2 + '/' + window.__bad, new Response(b)); });
      });
    }).then(function(){ window.__poisoned = true; });
    return 1;`);
  ok(await until(`return window.__poisoned === true`, 30000), "a wrong-size (valid gzip) chunk is planted in the 3D cache: " + await ev(`return window.__bad`));
  await ev(`ATLAS3D.open(); return 1;`);
  await until(`return !!ATLAS3D._state.gl`, 30000);
  await ev(`ATLAS3D.setSource('live'); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.src==='live' && s.loaded>5 && Object.keys(s.loading).length===0`, 120000), "living body loads");
  ok(await ev(`var s=ATLAS3D._state, id=s.data.chunks.filter(function(c){ return c.url.split('/').pop()===window.__bad; })[0].id; return !!s.chunks[id] && !s.failed[id] && Object.keys(s.failed).length===0;`) === true, "the poisoned chunk was purged and refetched: nothing failed (network fetches of it: " + await ev(`return window.__net['/' + window.__bad] || 0`) + ")");
  await ev(`ATLAS3D.close(); localStorage.removeItem('smd_atlas3d_base'); window.fetch = window.__real; return 1;`);
  // ---- GPU context loss and restore (WEBGL_lose_context), last and in a fresh page ----
  ok(await attach(BASE + "?atlas3d=1"), "fresh page for the context-loss checks");
  await clearIntro();
  await ev(`localStorage.setItem('smd_atlas3d_hint','1'); ATLAS3D.open(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return !!s.gl && !s.err && s.loaded>5 && Object.keys(s.loading).length===0;`, 120000), "3D layer loaded in the fresh page");
  await ev(`window.__lc = ATLAS3D._state.gl.gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return s.lost===true && /Restoring/.test(document.getElementById('a3dProgress').textContent);`, 10000), "context loss is caught: Restoring the 3D view, no error banner");
  await ev(`window.__lc.restoreContext(); return 1;`);
  ok(await until(`var s=ATLAS3D._state; return !s.lost && !s.err && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10 && document.getElementById('a3dProgress').hidden;`, 120000), "context restored in place: programs rebuilt and every chunk re-uploaded (" + await ev(`return Object.keys(ATLAS3D._state.chunks).length;`) + " chunks)");
  ok(await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45) >= 0;`) === true, "picking works after the restore");
  const rs = await sig();
  ok(!!rs && rs.lit > 50, "the restored context draws the body (" + (rs && rs.lit) + " lit samples)");
  // a browser that never hands the context back: after 5 s the viewer swaps in a fresh canvas
  await ev(`window.__oldCv = document.getElementById('a3dCanvas'); ATLAS3D._state.gl.gl.getExtension('WEBGL_lose_context').loseContext(); return 1;`);
  ok(await until(`return ATLAS3D._state.lost===true`, 10000), "second context loss caught (not restored this time)");
  ok(await until(`var s=ATLAS3D._state, c=document.getElementById('a3dCanvas'); return !s.lost && !s.err && c && c!==window.__oldCv && s.canvas===c && Object.keys(s.loading).length===0 && Object.keys(s.chunks).length>=10;`, 120000), "an unrestored context is replaced by a fresh canvas and the anatomy reloads");
  ok(await ev(`var c=document.getElementById('a3dCanvas'); return ATLAS3D._pickAt(c.width/2, c.height*0.45) >= 0;`) === true, "picking works on the replacement canvas");
  await ev(`ATLAS3D.close(); return 1;`);

} catch (e) { console.log("💥", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
