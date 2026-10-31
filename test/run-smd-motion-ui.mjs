/* Motion 3 in the REAL app (headless Chromium over CDP), owner 2026-10-31: "any transition in app should have good
 * motion, slide up down or anything premium, new, unique".
 * What must hold: a full-screen page opened from a tile grows out of that tile (clip-path from the tile's rect, on a
 * spring easing) and shrinks back into it on close; with no source it rises; a screen swapped in after a Back tap
 * slides in from the left, a forward one from the right, and its rows settle one after another; reduced motion and
 * smd_motion3 = "0" fall back (no clip, the old 16 px rise). Screenshots mid-motion: SHOTS=<dir>.
 * USAGE: node test/run-smd-motion-ui.mjs
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-tools-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");
const SHOTS = process.env.SHOTS || "";
const Q1 = "ana-brachial-plexus-q1", Q2 = "ana-brachial-plexus-q2";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}


await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function shot(name) { if (!SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); }
// A real tap: pointerdown then click, at the element's centre.
const tap = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); var r=b.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2; b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:x,clientY:y,button:0})); b.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); return 1;`);
// The newest animation on a target: its first keyframe and easing.
const anim = (sel) => ev(`var t=document.querySelector(${JSON.stringify(sel)}); if(!t) return "none"; var L=t.getAnimations(), a=L.filter(function(x){ return x.effect.getKeyframes().some(function(f){ return f.transform; }); }).slice(-1)[0] || L.slice(-1)[0]; if(!a) return "none"; var k=a.effect.getKeyframes(); return JSON.stringify({clip:k[0].clipPath||"", tr:k[0].transform||"", op:k[0].opacity, ease:a.effect.getTiming().easing, dur:a.effect.getTiming().duration});`);
// The page fixture: a tile on the page, which opens a full-screen page (a direct child of body, the app's pattern).
const FIXTURE = `
  window.__open = function () { var p=document.createElement("div"); p.id="mxPage"; p.style.cssText="position:fixed;inset:0;z-index:950;background:#f4f2ec;font:16px sans-serif"; p.innerHTML='<div id="mxBody" style="position:absolute;inset:60px 0 0 0"><div class="scr"><h2>Screen one</h2><ul><li>Row 1</li><li>Row 2</li><li>Row 3</li><li>Row 4</li></ul><button id="mxNext">Next</button></div></div><button class="db-back" aria-label="Back" id="mxBack" style="position:absolute;left:8px;top:8px;width:44px;height:44px">&lt;</button>'; document.body.appendChild(p); };
  window.__screen = function (name) { var b=document.getElementById("mxBody"); b.innerHTML='<div class="scr" style="min-height:'+(innerHeight*0.6)+'px"><h2>'+name+'</h2><ul><li>Row A</li><li>Row B</li><li>Row C</li></ul></div>'; };
  var t=document.createElement("button"); t.id="mxTile"; t.textContent="Tile"; t.style.cssText="position:fixed;left:30px;top:420px;width:120px;height:90px;border-radius:20px;z-index:900;background:#0e6e63;color:#fff"; t.onclick=function(){ window.__open(); }; document.body.appendChild(t); return 1;`;

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") { const d = JSON.stringify(m.params.exceptionDetails); if (/motion/.test(d)) errors.push(d.slice(0, 300)); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const boot = async (ls) => {
    await call("Page.navigate", { url: BASE + (ls ? "?m=" + Date.now() : "") });
    ok(await until(`return !!(window.SMD_MOTION && document.body);`, 30000), "the app boots with smd-motion.js" + (ls ? " (" + ls + ")" : ""));
    await sleep(3200);   // page-motion learns what is already on screen, and ignores the first 2.5 s of swaps
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","harrisonQuotePopup"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); ${FIXTURE}`);
    await sleep(200);
  };
  await boot();
  ok(await ev(`return SMD_MOTION.on() && /^linear\\(0, /.test(SMD_MOTION.ease("open").easing);`) === true, "springs run as CSS linear() easings");

  // 1. Open from a tile: the page grows out of it.
  await tap("#mxTile");
  await sleep(30);
  const want = await ev(`var r=document.getElementById("mxTile").getBoundingClientRect(); return "inset("+Math.round(r.top)+"px "+Math.round(innerWidth-r.right)+"px "+Math.round(innerHeight-r.bottom)+"px "+Math.round(r.left)+"px round 20px)";`);
  const op = JSON.parse(await anim("#mxPage"));
  ok(op.clip === want && /scale\(0\.96\)/.test(op.tr) && /^linear\(/.test(op.ease), "the page grows out of the tapped tile on the open spring: " + JSON.stringify(op));
  for (const f of [0.08, 0.2, 0.4]) {
    await ev(`document.getAnimations().forEach(function(a){ if(a.effect&&a.effect.target&&a.effect.target.id==="mxPage"){ a.pause(); a.currentTime=a.effect.getTiming().duration*${f}; } }); return 1;`);
    await sleep(80); await shot("mx-open-" + Math.round(f * 100));
  }
  await ev(`document.getAnimations().forEach(function(a){ try { a.finish(); } catch (e) {} }); return 1;`);

  // 2. Inside the page: forward and back slides, rows settle.
  await ev(`document.getElementById("mxNext").click(); __screen("Screen two"); return 1;`);
  await sleep(30);
  const fw = JSON.parse(await anim("#mxBody > .scr"));
  ok(/translateX\(390px\)/.test(fw.tr) && fw.op == null, "a new screen slides in from the right edge, no fade: " + JSON.stringify(fw));
  const gh = await ev(`var g=[].slice.call(document.querySelectorAll("body > [data-pm-ghost]")).filter(function(x){ return x.getAnimations().some(function(a){ return a.effect.getKeyframes().some(function(f){ return /inset\\(0px 2/.test(f.clipPath||""); }); }); })[0]; return g ? g.textContent.indexOf("Screen") >= 0 && !g.getAnimations().some(function(a){ return a.effect.getKeyframes().some(function(f){ return f.opacity != null; }); }) : false;`);
  ok(gh === true, "the old screen is pushed aside and clipped at the new one's edge, not faded");
  ok(await ev(`return document.querySelector("#mxBody li:nth-child(3)").getAnimations().some(function(a){ return a.effect.getTiming().delay > 60; });`) === true, "its rows settle one after another");
  await ev(`document.getAnimations().forEach(function(a){ try { a.finish(); } catch (e) {} }); return 1;`);
  await tap("#mxBack"); await ev(`__screen("Screen one again"); return 1;`);
  await sleep(30);
  const bk = JSON.parse(await anim("#mxBody > .scr"));
  ok(/translateX\(-117px\)/.test(bk.tr), "after Back the screen slides in from the left: " + JSON.stringify(bk));
  await ev(`document.getAnimations().forEach(function(a){ try { a.finish(); } catch (e) {} }); return 1;`);

  // 3. Close: back into the tile.
  await ev(`document.getElementById("mxPage").remove(); return 1;`);
  await sleep(30);
  const cl = JSON.parse(await ev(`var g=document.querySelector("body > [data-pm-ghost]"); if(!g) return JSON.stringify({}); var a=g.getAnimations().filter(function(x){ return x.effect.getKeyframes().some(function(f){ return f.clipPath; }); })[0]; if(!a) return JSON.stringify({none:1, n:g.getAnimations().length}); var k=a.effect.getKeyframes(); return JSON.stringify({clip:k[k.length-1].clipPath, op:k[k.length-1].opacity, origin:g.style.transformOrigin});`));
  ok(cl.clip === want && String(cl.op) === "0" && /^\d+px \d+px$/.test(cl.origin), "closing shrinks it back into the tile: " + JSON.stringify(cl));
  await sleep(500);
  ok(await ev(`return !document.querySelector("[data-pm-ghost]");`) === true, "the closing copy is gone after the exit");

  // 4. No source (opened by code): it rises.
  await sleep(800);
  await ev(`__open(); return 1;`); await sleep(30);
  const rs = JSON.parse(await anim("#mxPage"));
  ok(!rs.clip && /translateY\(844px\)/.test(rs.tr) && rs.op == null, "a page opened with no tap slides up from the bottom edge, no fade: " + JSON.stringify(rs));
  await ev(`document.getAnimations().forEach(function(a){ try { a.finish(); } catch (e) {} }); document.getElementById("mxPage").remove(); return 1;`);
  await sleep(600);

  // 5. Reduced motion: nothing animates; switch off: the earlier motion.
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tap("#mxTile"); await sleep(30);
  ok(await anim("#mxPage") === "none", "reduced motion: the page appears without motion");
  await ev(`document.getElementById("mxPage").remove(); return 1;`);
  await call("Emulation.setEmulatedMedia", { features: [] });
  await sleep(600);
  await ev(`localStorage.setItem("smd_motion3","0"); return 1;`);
  await tap("#mxTile"); await sleep(30);
  const old = JSON.parse(await anim("#mxPage"));
  ok(!old.clip && /translateY\(16px\)/.test(old.tr), "smd_motion3 = 0: the earlier 16 px rise: " + JSON.stringify(old));
  await ev(`localStorage.removeItem("smd_motion3"); return 1;`);
  ok(errors.length === 0, "no motion error " + errors.join(" | "));
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
finally {
  try { chrome.kill(); } catch {} try { if (serveProc) serveProc.kill(); } catch {}
  console.log(fails ? fails + " failed" : "all passed");
  process.exit(fails ? 1 : 0);
}
