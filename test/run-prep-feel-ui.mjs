/* PrepNucleus feels like an app, not a web page (owner bug 2026-10-09, iPad): headless Chrome over CDP with touch.
 * What must hold:
 *  - navigation never jumps: a push starts the new screen at the top and keeps the leaving one for a cross-fade (no
 *    empty frame); back returns to the scroll position the screen was left at; a repaint in place (a mistake tag after
 *    an answer) keeps the position on every frame after the tap (sampled per frame), a new question starts at the top;
 *  - nothing scrolls sideways: document.scrollingElement and every screen body are no wider than the window at 390,
 *    820 and 1180 px; the document cannot scroll under the overlay;
 *  - the shared image viewer (prep-viewer.js): tap the question image to open it; a two-finger pinch zooms around the
 *    fingers; one finger pans while zoomed and stops at the edges; double tap fits, double tap again zooms to 2.5x at
 *    the tap; the zoom buttons work; Escape closes and gives focus back to the image; at fit size a swipe down closes
 *    it; the page behind never scrolls; every control is 44 px; the lesson reader's own zoom opens in the same viewer;
 *  - deck images (prep-source.js extractImages on test/fixtures/prep-figures): of six pages only the embedded film and
 *    the film printed in a scan are cut out, each at the film's shape; the text page, the scanned notes page, the
 *    picture of a table and the film under an OCR layer give nothing;
 *  - no uncaught PrepNucleus error. SHOTS=<dir> saves 390 / 820 / 1180 px screenshots, dark and light.
 * USAGE: node test/run-prep-feel-ui.mjs   (CHROME=<path>; SHOTS=<dir>)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const LOADER_V = (await import("node:fs")).readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8").match(/var V = "([^"]+)"/)[1];
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-feel-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: finite animations (entrances, ring draw) are finished first; loops keep running.
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
let W = 390, LIGHT = false;
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(300);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "feel-" + W + "-" + (LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const overflow = () => ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-filters,.pn-tabs,.pn-zoom-sc")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);

import { makeFigurePdf } from "./fixtures/prep-figures/make-pdf.mjs";
const touch = (type, pts) => call("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
async function drag(from, to, steps = 8) {
  await touch("touchStart", from);
  for (let k = 1; k <= steps; k++) { await touch("touchMove", from.map((p, i) => [p[0] + (to[i][0] - p[0]) * k / steps, p[1] + (to[i][1] - p[1]) * k / steps])); await sleep(16); }
  await touch("touchEnd", []);
}
async function tap(x, y) { await touch("touchStart", [[x, y]]); await sleep(30); await touch("touchEnd", []); }
const rectOf = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, r.width, r.height];`);
const vs = () => ev(`return window.PREP_VIEWER && PREP_VIEWER._state();`);
// The stage's content box in its own CSS px and the page zoom (home.js zooms html for text size).
const geo = () => ev(`var st=document.querySelector(".pv-stage"), cs=getComputedStyle(st), i=document.querySelector(".pv-img"), r=st.getBoundingClientRect();
  var W=st.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight), H=st.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  return { z: r.width/st.offsetWidth, W: W, H: H, w: i.offsetWidth, h: i.offsetHeight };`);
const sideways = () => ev(`var d=document.scrollingElement, o=[]; if (d.scrollWidth > d.clientWidth) o.push("document " + d.scrollWidth + ">" + d.clientWidth); document.querySelectorAll("#smdPrep .pn-body").forEach(function(b){ if (b.scrollWidth > b.clientWidth + 1) o.push("body " + b.scrollWidth + ">" + b.clientWidth); }); return o.join("; ");`);
async function size(w, h) { W = w; await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 700 }); await sleep(250); }
async function theme(light) { LIGHT = light; await ev(light ? `document.body.classList.remove("dark"); return 1;` : `document.body.classList.add("dark"); return 1;`); await sleep(120); }
// Samples the body's scrollTop on every frame for ms after running js; returns [min, max] over the samples.
const sampleScroll = (js, ms) => evA(`new Promise(function(res){ var lo=1e9, hi=-1, t0=performance.now(); (${js})(); (function f(){ var b=document.querySelector("#smdPrep > .pn-body"); if (b) { lo=Math.min(lo,b.scrollTop); hi=Math.max(hi,b.scrollTop); } if (performance.now()-t0<${ms}) requestAnimationFrame(f); else res([lo,hi]); })(); })`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await theme(false);

  // ---------- shell and navigation ----------
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=y-home]") && !!window.PREP_VIEWER;`, 20000), "PrepNucleus opens; prep-loader.js loads prep-viewer.js");
  ok(await ev(`return document.documentElement.classList.contains("pn-open") && getComputedStyle(document.documentElement).overflow === "hidden";`) === true, "the document under the overlay cannot scroll (html.pn-open)");
  ok(await ev(`var b=document.querySelector("#smdPrep > .pn-body"), s=getComputedStyle(b); return s.overflowX === "hidden" && s.overflowY === "auto";`) === true, "the screen body scrolls only up and down");
  ok(await ev(`var s=getComputedStyle(document.querySelector("#smdPrep > .pn-bar")); return s.touchAction === "none";`) === true, "the bar is fixed chrome: a drag on it moves nothing");
  ok(await sideways() === "", "home: nothing wider than 390 px");
  const homeScrollable = await ev(`var b=document.querySelector("#smdPrep > .pn-body"); return b.scrollHeight - b.clientHeight;`);
  const Y0 = Math.min(400, Math.max(0, homeScrollable - 5));
  await ev(`document.querySelector("#smdPrep > .pn-body").scrollTop = ${Y0}; return 1;`);
  ok(Y0 > 100, "home scrolls (" + homeScrollable + " px)");
  const pushed = await ev(`document.querySelector("#smdPrep [data-act=y-home]").click(); var g=document.querySelector("body > .pn-ghost"), b=document.querySelector("#smdPrep > .pn-body"); return { ghost: !!g, ghostY: g ? g.querySelector(".pn-body").scrollTop : -1, ghostIds: g ? g.querySelectorAll("[id]").length : -1, top: b ? b.scrollTop : -1 };`);
  ok(pushed.ghost && pushed.ghostIds === 0, "a push keeps the leaving screen for a cross-fade (no empty frame), outside #smdPrep, its ids removed");
  ok(pushed.ghostY === Y0, "the leaving screen stays where it was while it fades (" + pushed.ghostY + ")");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-yq-row").length === 3;`, 8000), "the papers screen arrives");
  ok(await ev(`return document.querySelector("#smdPrep > .pn-body").scrollTop === 0;`) === true, "the pushed screen starts at the top");
  ok(await until(`return !document.querySelector(".pn-ghost");`, 1500), "the leaving screen is removed after its fade");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=y-home]");`, 4000), "back to home");
  ok(Math.abs(await ev(`return document.querySelector("#smdPrep > .pn-body").scrollTop;`) - Y0) <= 2, "back returns to where home was left (" + Y0 + ")");

  // ---------- a repaint in place keeps the place; a new question starts at the top ----------
  await click("#smdPrep [data-act=y-home]");
  await until(`return !!document.querySelector("#smdPrep [data-act=y-paper][data-v=fx-2025-r1]");`, 6000);
  await click(`#smdPrep [data-act=y-paper][data-v=fx-2025-r1]`);
  await until(`return !!document.querySelector("#smdPrep [data-act=y-start][data-k=study]");`, 6000);
  await click(`#smdPrep [data-act=y-start][data-k=study]`);
  ok(await until(`return /Synthetic PYQ one/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 5000), "practice starts");
  await click(`#smdPrep [data-act=answer][data-k="0"]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb.no [data-act=mtag]");`, 3000), "a wrong answer shows the feedback with the mistake tags");
  const room = await ev(`var b=document.querySelector("#smdPrep > .pn-body"); return b.scrollHeight - b.clientHeight;`);
  const YQ = Math.min(260, Math.max(0, room - 4));
  await ev(`document.querySelector("#smdPrep > .pn-body").scrollTop = ${YQ}; return 1;`);
  await ev(`document.querySelector("#smdPrep > .pn-body").__old = 1; return 1;`);
  const span = await sampleScroll(`function(){ document.querySelector("#smdPrep [data-act=mtag]").click(); }`, 400);
  ok(YQ > 40 && span && span[0] >= YQ - 1 && span[1] <= YQ + 1, "tapping a mistake tag repaints in place without moving, on every frame (scrollTop " + JSON.stringify(span) + ", kept at " + YQ + ")");
  // Native pass 2: the repaint patches the screen, so the body is the same node (it was a new node before).
  ok(await ev(`return document.querySelector("#smdPrep > .pn-body").__old === 1 && !!document.querySelector("#smdPrep [data-act=mtag]");`) === true, "the tap repainted the screen by patching it (same body node, the tags still there)");
  await click("#smdPrep [data-act=next]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 6000), "the next question (an image question) shows its image");
  ok(await ev(`return document.querySelector("#smdPrep > .pn-body").scrollTop === 0;`) === true, "a new question starts at the top");
  ok(await sideways() === "", "question: nothing wider than 390 px");

  // ---------- the viewer ----------
  const bodyY = await ev(`var b=document.querySelector("#smdPrep > .pn-body"); b.scrollTop = 0; return b.scrollTop;`);
  const im = await rectOf("#smdPrep .pn-yq-fig .pn-vimg");
  await tap(im[0], im[1]);
  ok(await until(`return !!document.querySelector(".pv") && PREP_VIEWER.isOpen();`, 2000), "tapping the image opens the viewer");
  ok(await ev(`return !document.querySelector("#pnYqZoom");`) === true, "the old in-screen zoom is not used");
  ok(await ev(`return document.activeElement && document.activeElement.classList.contains("pv-x");`) === true, "focus moves to Close image");
  await sleep(300);
  const small = await ev(`return Array.from(document.querySelectorAll(".pv .pv-b")).filter(function(b){ return b.offsetWidth<44 || b.offsetHeight<44; }).map(function(b){ return b.getAttribute("data-pv")+" "+b.offsetWidth+"x"+b.offsetHeight; }).join(", ");`);
  ok(small === "", "every viewer control is at least 44 x 44 CSS px (the app's own text-size zoom applies on top)" + (small ? ": " + small : ""));
  await sleep(300);
  const st0 = await rectOf(".pv-stage"), ci = await rectOf(".pv-img");
  const cx = ci[0], cy = ci[1];
  // Pinch out around a point 30 px right of the image centre: fingers 60 px apart to 180 px apart (3x).
  const fx = cx + 30;
  await drag([[fx - 30, cy], [fx + 30, cy]], [[fx - 90, cy], [fx + 90, cy]]);
  await sleep(350);
  let s = await vs();
  ok(s && s.s > 2.6 && s.s < 3.4, "a pinch zooms (scale " + (s && s.s.toFixed(2)) + ", fingers 3x apart)");
  // The image point that was under the fingers stays under them: t = f - k*f with f = 30 (k = 3) -> x about -60.
  const G0 = await geo();
  ok(s && Math.abs(s.x - (30 / G0.z) * (1 - s.s)) < 4 && Math.abs(s.y) < 4, "the zoom is around the pinch point (x " + (s && s.x.toFixed(1)) + ", page zoom " + G0.z.toFixed(2) + ")");
  await drag([[cx, cy]], [[cx + 80, cy + 30]]);
  await sleep(350);
  const s2 = await vs();
  ok(s2 && s2.x > s.x + 40, "one finger pans the zoomed image (" + (s2 && s2.x.toFixed(1)) + ")");
  await drag([[cx, cy]], [[cx + 2000, cy]], 12);
  await sleep(400);
  const s3 = await vs(), G1 = await geo(), lim = Math.max(0, (G1.w * s3.s - G1.W) / 2);
  ok(s3 && Math.abs(s3.x - lim) < 1.5, "a pan stops at the image's edge (x " + (s3 && s3.x.toFixed(1)) + ", edge " + (lim && lim.toFixed(1)) + ")");
  await tap(cx, cy); await sleep(60); await tap(cx, cy); await sleep(350);
  ok((await vs()).s === 1, "double tap when zoomed fits the image again");
  await tap(cx + 40, cy - 20); await sleep(60); await tap(cx + 40, cy - 20); await sleep(350);
  s = await vs();
  const G2 = await geo(), want = await ev(`return PREP_VIEWER._pure.clampPan({ x: ${-1.5 * 40} / ${G2.z}, y: ${-1.5 * -20} / ${G2.z} }, 2.5, ${G2.w}, ${G2.h}, ${G2.W}, ${G2.H});`);
  ok(Math.abs(s.s - 2.5) < 0.01 && Math.abs(s.x - want.x) < 2 && Math.abs(s.y - want.y) < 2, "double tap at fit zooms to 2.5x at the tap (" + JSON.stringify(s) + " want " + JSON.stringify(want) + ")");
  if (process.env.SHOTS) { for (const L of [false, true]) { await theme(L); await shot("viewer-zoomed"); } await theme(false); }
  await click(".pv [data-pv=fit]"); await sleep(300);
  ok((await vs()).s === 1 && /100%/.test(await text(".pv .pv-pct")), "Fit returns to 100%");
  await click(".pv [data-pv=in]"); await sleep(300);
  ok(Math.abs((await vs()).s - 1.6) < 0.01, "Zoom in button: 160%");
  await click(".pv [data-pv=out]"); await sleep(300);
  ok((await vs()).s === 1, "Zoom out button back to fit");
  ok(await ev(`return document.querySelector("#smdPrep > .pn-body").scrollTop;`) === bodyY, "the page behind never moved");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  ok(await until(`return !document.querySelector(".pv");`, 1500), "Escape closes the viewer");
  ok(await ev(`return document.activeElement && document.activeElement.classList.contains("pn-vimg");`) === true, "focus goes back to the image");
  ok(/Synthetic PYQ two/.test(await text("#smdPrep .pn-q")), "and the question is still there");
  await tap(im[0], im[1]);
  await until(`return PREP_VIEWER.isOpen();`, 2000); await sleep(300);
  await drag([[cx, cy - 100]], [[cx, cy + 160]], 10);
  ok(await until(`return !document.querySelector(".pv");`, 1500), "a swipe down at fit size closes the viewer");
  await tap(im[0], im[1]);
  await until(`return PREP_VIEWER.isOpen();`, 2000); await sleep(200);
  await drag([[cx, cy]], [[cx, cy + 50]], 10); await sleep(350);
  ok(PREP_open_check(await ev(`return PREP_VIEWER.isOpen() && PREP_VIEWER._state().dy === 0;`)), "a short drag down springs back and stays open");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !document.querySelector(".pv");`, 1500) && /Synthetic PYQ two/.test(await text("#smdPrep .pn-q")), "back() closes the viewer first and stays on the question");
  // The lesson reader's own enlarged image opens in the same viewer; closing it presses the lesson's close.
  await ev(`var h=PREP._host; window.__unz=0; h.paint(h.bar("Lesson","","back") + '<div class="pn-body"><button type="button" class="pn-vimg" data-act="l-zoom">fig</button></div><div class="pn-zoom" id="pnZoom"><div class="pn-zoom-top"><p>Lesson caption</p><button type="button" data-act="l-unzoom" onclick="window.__unz++">x</button></div><div class="pn-zoom-sc"><img src="' + document.querySelector("#smdPrep .pn-yq-fig img").src + '" alt="A lesson figure"></div></div>'); return 1;`);
  ok(await ev(`return PREP_VIEWER.isOpen() && document.querySelector(".pv-cap").textContent === "Lesson caption" && document.getElementById("pnZoom").hidden;`) === true, "a lesson's enlarged image opens in the shared viewer");
  await click(".pv [data-pv=close]");
  ok(await until(`return !document.querySelector(".pv") && window.__unz === 1;`, 1500), "closing it closes the lesson's zoom too");
  await ev(`PREP.back(); return 1;`);

  // ---------- widths and themes ----------
  for (const [w, h] of [[390, 844], [820, 1180], [1180, 820]]) {
    await size(w, h);
    for (const L of [false, true]) {
      await theme(L);
      await ev(`PREP.close(); PREP.open(); return 1;`);
      await until(`return !!document.querySelector("#smdPrep [data-act=y-home]");`, 6000);
      ok(await sideways() === "", w + " px " + (L ? "light" : "dark") + ": home has no sideways scroll");
      await shot("home");
      await click("#smdPrep [data-act=y-home]");
      await until(`return !!document.querySelector("#smdPrep [data-act=y-paper][data-v=fx-2025-r1]");`, 6000);
      await click(`#smdPrep [data-act=y-paper][data-v=fx-2025-r1]`);
      await until(`return !!document.querySelector("#smdPrep [data-act=y-start][data-k=study]");`, 6000);
      await click(`#smdPrep [data-act=y-start][data-k=study]`);
      await until(`return !!document.querySelector("#smdPrep [data-act=answer]");`, 5000);
      await click(`#smdPrep [data-act=answer][data-k="2"]`);
      await click("#smdPrep [data-act=next]");
      await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 6000);
      ok(await sideways() === "", w + " px " + (L ? "light" : "dark") + ": image question has no sideways scroll");
      await shot("image-question");
      await click("#smdPrep .pn-yq-fig .pn-vimg");
      await until(`return PREP_VIEWER.isOpen();`, 2000);
      ok(await ev(`var r=document.querySelector(".pv-img").getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;`) === true, w + " px: the image fits the viewer");
      await shot("viewer");
      await ev(`PREP_VIEWER.close(); return 1;`);
      await until(`return !document.querySelector(".pv");`, 1500);
    }
  }
  await size(390, 844);

  // ---------- deck image crops on the figure fixtures ----------
  const pdf64 = Buffer.from(makeFigurePdf(), "latin1").toString("base64");
  const crops = await evA(`(function(){ var b=atob(${JSON.stringify(pdf64)}), u=new Uint8Array(b.length); for (var i=0;i<b.length;i++) u[i]=b.charCodeAt(i);
    return PREP_SRC.loadPdfJs().then(function(lib){ return lib.getDocument({ data: u }).promise; }).then(function(doc){ return PREP_SRC.extractImages(doc, [1,2,3,4,5,6]); })
      .then(function(list){ return list.map(function(x){ return { p: x.p, w: x.w, h: x.h, k: x.k, mime: x.mime }; }); }, function(e){ return "ERR " + e; }); })()`);
  ok(Array.isArray(crops), "extractImages ran on the figure fixtures" + (Array.isArray(crops) ? "" : ": " + crops));
  if (Array.isArray(crops)) {
    ok(crops.map((x) => x.p).join() === "1,4", "only page 1 (embedded film) and page 4 (film inside a scan) give images: " + JSON.stringify(crops.map((x) => x.p)));
    const a1 = crops[0] && crops[0].w / crops[0].h, a4 = crops[1] && crops[1].w / crops[1].h;
    ok(a1 && Math.abs(a1 - 240 / 288) < 0.03, "page 1: the crop is the film only (aspect " + (a1 && a1.toFixed(3)) + ")");
    ok(a4 && Math.abs(a4 - 460 / 552) < 0.12, "page 4: the region is the film, not the page (aspect " + (a4 && a4.toFixed(3)) + ", page 0.707)");
  }
  await ev(`PREP.close(); return 1;`);
  ok(await ev(`return !document.documentElement.classList.contains("pn-open");`) === true, "closing PrepNucleus gives the document back");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { if (userDir && /-chrome-/.test(userDir)) fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
function PREP_open_check(v) { return v === true; }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
