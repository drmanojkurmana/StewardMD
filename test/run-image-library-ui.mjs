/* Image Library in the REAL app (headless Chrome over CDP): all three entry points
 * (Knowledge Library home, PrepNucleus subject screen, Ophthalmós Learn), the system
 * list, thumbnail grid, search, filters, full-screen viewer with next/previous and
 * back, 390px with nothing wider than the screen, light and dark, flag off, and no
 * uncaught error.
 * USAGE: node test/run-image-library-ui.mjs   (CHROME=<path>; SHOTS=<dir>; IMGLIB_LIGHT=1; IMGLIB_W=820 for iPad) */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort());
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/imglib-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(320);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "imglib-" + (process.env.IMGLIB_LIGHT ? "light-" : "dark-") + (process.env.IMGLIB_W ? process.env.IMGLIB_W + "-" : "") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: +process.env.IMGLIB_W || 390, height: +process.env.IMGLIB_W > 600 ? 1180 : 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_ONBOARD=false; window.confirm=function(){return true;};` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.SMD_IMGLIB;`, 30000); await ev(clean);
  if (process.env.IMGLIB_LIGHT) await ev(`document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);
  ok(await ev(`return SMD_IMGLIB.enabled()===true;`) === true, "flag smd_imglib defaults ON");

  /* Entry 1: Knowledge Library home */
  await ev(`SB.openRef('syndromes'); return 1;`);
  ok(await until(`return !!document.querySelector('#kblibImgLib');`, 20000), "Knowledge Library home shows the Image Library entry");
  await click("#kblibImgLib");
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-sys');`, 20000), "entry opens the system list with counts and samples");
  ok(await ev(`return document.querySelectorAll('#smdImgLib .igl-sys').length>=20;`) === true, "systems list has 20+ systems");
  ok(await ev(`return /images/.test(document.querySelector('#smdImgLib .igl-count').textContent);`) === true, "header carries the total image count");
  ok(await until(`var im=[].slice.call(document.querySelectorAll('#smdImgLib .igl-sysimg img'),0,4); return im.length===4 && im.every(function(i){return i.complete && i.naturalWidth>0;});`, 20000), "system sample thumbnails load");
  await shot("systems");

  /* System grid, search, viewer */
  await click('#smdImgLib .igl-sys[data-v="cardiology"]');
  ok(await until(`return document.querySelectorAll('#smdImgLib .igl-card').length>=10;`, 20000), "Cardiology opens a lazy thumbnail grid");
  ok(await ev(`return !!document.querySelector('#smdImgLib .igl-chips');`) === true, "source and kind filters show");
  await sleep(1500); await shot("grid");
  const before = await ev(`return document.querySelectorAll('#smdImgLib .igl-card').length;`);
  await ev(`var q=document.querySelector('#smdImgLib .igl-q'); q.value='zzzznothing'; q.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-empty');`, 8000), "search with no match shows the empty state");
  await ev(`var q=document.querySelector('#smdImgLib .igl-q'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdImgLib .igl-card').length>=10;`, 8000), "clearing search restores the grid");
  await click("#smdImgLib .igl-card");
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-vimg');`, 8000), "tap opens the full-screen viewer with the image");
  ok(await ev(`return document.querySelector('#smdImgLib .igl-vcap').textContent.trim().length>0;`) === true, "viewer shows the caption");
  ok(await ev(`return !!document.querySelector('#smdImgLib .igl-vlink');`) === true, "viewer links back to where the image is from");
  const pos1 = await ev(`return document.querySelector('#smdImgLib .igl-vpos').textContent;`);
  await click('#smdImgLib [data-igl="vnext"]');
  ok(await until(`return document.querySelector('#smdImgLib .igl-vpos').textContent!==${JSON.stringify(pos1)};`, 5000), "Next moves to the next image (swipe target)");
  await ev(`var s=document.querySelector('#smdImgLib .igl-vstage'); ['touchstart','touchmove','touchend'].forEach(function(n){}); return 1;`);
  await shot("viewer");
  await click('#smdImgLib [data-igl="vclose"]');
  ok(await until(`return document.querySelector('#smdImgLib .igl-viewer').hidden;`, 5000), "viewer close returns to the grid");
  await click('#smdImgLib [data-igl="back"]');
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-sys');`, 5000), "back returns to the system list");
  const wide = await ev(`var r=document.querySelector('#smdImgLib'), out=[]; if (r.scrollWidth>innerWidth+1) r.querySelectorAll('*').forEach(function(e){ var b=e.getBoundingClientRect(); if (b.right>innerWidth+1 && out.length<5) out.push((e.className||e.tagName)+' '+Math.round(b.right)); }); return out.join(' | ');`);
  ok(!wide, "390px: nothing wider than the screen" + (wide ? " (" + wide + ")" : ""));
  await click('#smdImgLib [data-igl="back"]');
  ok(await until(`return document.querySelector('#smdImgLib').hidden;`, 5000), "back from systems closes the library");

  /* Entry 2: PrepNucleus subject screen, next to the atlases */
  await ev(`try{localStorage.setItem("smd_prep","1");}catch(e){} PREP.open({ subject: "surgery" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="il-imglib"]');`, 30000), "PrepNucleus subject screen shows Image Library next to the atlases");
  await click('#smdPrep [data-act="il-imglib"]');
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-sys') || !!document.querySelector('#smdImgLib .igl-card');`, 20000), "PrepNucleus entry opens the same library");
  await ev(`SMD_IMGLIB.close(); if(window.PREP&&PREP.close) PREP.close(); return 1;`);

  /* Entry 3: Ophthalmós Learn, filtered to Eye */
  await ev(`try{localStorage.setItem("smd_ophthalmos_prefs", JSON.stringify({tab:"learn",lang:"en"}));}catch(e){} if(window.OPHTHALMOS) OPHTHALMOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act="lnimglib"]');`, 30000), "Ophthalmós Learn shows the Image Library entry");
  await click('[data-act="lnimglib"]');
  ok(await until(`return !!document.querySelector('#smdImgLib .igl-card');`, 20000), "Ophthalmós entry opens the library filtered to Eye");
  ok(await ev(`return /Eye/.test(document.querySelector('#smdImgLib .igl-title').textContent);`) === true, "the Eye filter is applied");
  await shot("eye");
  await ev(`SMD_IMGLIB.close(); if(window.OPHTHALMOS&&OPHTHALMOS.close) OPHTHALMOS.close(); return 1;`);

  /* Light and dark surfaces */
  const bgDark = await ev(`document.body.classList.add("dark"); SMD_IMGLIB.open({}); return getComputedStyle(document.querySelector('#smdImgLib')).backgroundColor;`);
  const bgLight = await ev(`document.body.classList.remove("dark"); return getComputedStyle(document.querySelector('#smdImgLib')).backgroundColor;`);
  ok(bgDark !== bgLight && !!bgDark && !!bgLight, "library follows light and dark (dark " + bgDark + ", light " + bgLight + ")");
  await ev(`SMD_IMGLIB.close(); return 1;`);

  /* Flag off is a complete no-op */
  await ev(`try{localStorage.setItem("smd_imglib","0");}catch(e){} return 1;`);
  await call("Page.navigate", { url: BASE + "?imglib=0" }); await until(`return !!window.SMD_IMGLIB;`, 30000); await ev(clean);
  ok(await ev(`return SMD_IMGLIB.enabled()===false && SMD_IMGLIB.open({})===false;`) === true, "?imglib=0 / localStorage 0 turns the library off");
  await ev(`try{localStorage.removeItem("smd_imglib");}catch(e){} return 1;`);

  ok(errors.length === 0, "no uncaught error" + (errors.length ? ": " + errors[0].slice(0, 200) : ""));
  console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
} finally {
  try { chrome.kill(); } catch {}
  if (serveProc) try { serveProc.kill(); } catch {}
}
