/* Capture-guard headless check (real Chrome, real specialty.css, real capture-guard.js + toast.js).
 * Fixture: test/fixtures/capture-guard.html (the Tokós "See it" figure markup). A mocked Capacitor
 * CaptureGuard plugin is injected before the page's scripts run.
 * Verifies:
 *  iOS mock  - no overlay in normal viewing; overlay (tiled mark) appears only with html.smd-cg-on
 *              and only on the real-image container; hotspot and zoom taps still land under it
 *              (pointer-events:none); the screenshot notice appears via the shared toast.
 *  Android mock - setSecure(true) with the real image in view, setSecure(false) once it is
 *              scrolled out of view, true again when scrolled back.
 *  Real app  - index.html on the web: capture-guard is inert (no style, no class, no errors).
 * USAGE: node test/run-capture-guard-ui.mjs   (BASE=http://localhost:8993/ to reuse a server)
 * SHOT=/path/prefix to also save before/after screenshots of the figure.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/capture-guard-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8993"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const mock = (platform) => `
  window.__cg = { secure: [], listeners: {} };
  window.Capacitor = {
    isNativePlatform: function () { return true; },
    getPlatform: function () { return "${platform}"; },
    isPluginAvailable: function (n) { return n === "CaptureGuard"; },
    Plugins: { CaptureGuard: {
      addListener: function (n, f) { window.__cg.listeners[n] = f; return Promise.resolve({ remove: function () {} }); },
      getState: function () { return Promise.resolve({ captured: false, platform: "${platform}" }); },
      setSecure: function (o) { window.__cg.secure.push(!!o.secure); return Promise.resolve({ applied: true }); }
    } }
  };`;

async function open(url, platform) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  if (platform) await call("Page.addScriptToEvaluateOnNewDocument", { source: mock(platform) });
  await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev(`return document.readyState === "complete"`) === true) break; }
  await sleep(300);
}
async function tapAt(x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(80);
}
async function shot(name) {
  if (!process.env.SHOT) return;
  const r = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 360, scale: 1 } });
  writeFileSync(`${process.env.SHOT}-${name}.png`, Buffer.from(r.result.data, "base64"));
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text + " " + ((m.params.exceptionDetails.exception || {}).description || "")); };
  const FIX = BASE + "test/fixtures/capture-guard.html";

  // ---------- iOS: overlay only during capture ----------
  await open(FIX, "ios");
  ok(await ev(`return !!(window.SMD_CaptureGuard && SMD_CaptureGuard.state().active)`) === true, "guard active with the plugin present (iOS mock)");
  ok(await ev(`return document.getElementById("lnImg").complete && document.getElementById("lnImg").naturalWidth > 0`) === true, "real Tokós image loaded");
  await sleep(200);
  ok(await ev(`return document.getElementById("zoomBtn").getAttribute("data-smd-cg")`) === "s", "real-image container marked (ln-pic-b is static, so it gets the positioning marker)");
  ok(await ev(`return document.querySelector("#diagImg").parentElement.hasAttribute("data-smd-cg")`) === false, "diagram container not marked");
  const after = (sel) => `var s=getComputedStyle(document.querySelector("${sel}"),"::after"); return JSON.stringify({c:s.content,bg:s.backgroundImage.slice(0,30),pe:s.pointerEvents,op:s.opacity,pos:s.position});`;
  let a = JSON.parse(await ev(after("#zoomBtn")));
  ok(a.c === "none" || a.bg === "none", "normal viewing is clean (no overlay before capture) " + JSON.stringify(a));
  await shot("before");

  await ev(`window.__cg.listeners.captureChange({ captured: true }); return 1;`);
  await sleep(150);
  ok(await ev(`return document.documentElement.classList.contains("smd-cg-on")`) === true, "captureChange(true) sets html.smd-cg-on");
  a = JSON.parse(await ev(after("#zoomBtn")));
  ok(a.bg.indexOf("url(\"data:image/svg+xml") === 0 && a.pos === "absolute", "overlay tile drawn over the real image while captured");
  ok(a.pe === "none", "overlay is pointer-events:none");
  ok(Number(a.op) > 0.1 && Number(a.op) < 0.5, "overlay is low opacity (" + a.op + ")");
  const d = JSON.parse(await ev(after(".ln-mpic")));
  ok(d.c === "none" || d.bg === "none", "no overlay on the diagram tile");
  await shot("capturing");

  // taps land on the real controls under the overlay
  const hot = JSON.parse(await ev(`var r=document.getElementById("hot0").getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});`));
  const img = JSON.parse(await ev(`var r=document.getElementById("lnImg").getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*0.75,y:r.top+r.height*0.75});`));
  ok(await ev(`var e=document.elementFromPoint(${hot.x},${hot.y}); return e && e.closest("button") && e.closest("button").id`) === "hot0", "hit-test at the hotspot finds the hotspot");
  await ev(`window.__hits=[]; return 1;`);
  await tapAt(hot.x, hot.y); await tapAt(img.x, img.y);
  ok(await ev(`return JSON.stringify(window.__hits)`) === JSON.stringify(["hot0", "zoomBtn"]), "hotspot and zoom taps still work under the overlay");

  // screenshot notice via the shared toast
  await ev(`window.__cg.listeners.screenshot({}); return 1;`);
  await sleep(300);
  const toast = await ev(`var t=document.getElementById("smdToast"); return t ? t.textContent + "|" + t.style.opacity : "";`);
  ok(toast === "Images are \u00a9\u00a0StewardMD. Please do not share.|1", "screenshot shows the shared toast notice (" + toast + ")");

  await ev(`window.__cg.listeners.captureChange({ captured: false }); return 1;`);
  await sleep(100);
  a = JSON.parse(await ev(after("#zoomBtn")));
  ok(await ev(`return document.documentElement.classList.contains("smd-cg-on")`) === false && (a.c === "none" || a.bg === "none"), "overlay removed when capture stops");
  ok(await ev(`return JSON.stringify(window.__cg.secure)`) === "[]", "iOS never calls setSecure");

  // ---------- Android: FLAG_SECURE follows what is on screen ----------
  await open(FIX, "android");
  await sleep(300);
  ok(await ev(`return JSON.stringify(window.__cg.secure)`) === "[true]", "setSecure(true) with the real image in view");
  await ev(`window.scrollTo(0, 1500); return 1;`); await sleep(400);
  ok(await ev(`return JSON.stringify(window.__cg.secure)`) === "[true,false]", "setSecure(false) once it scrolls out of view");
  await ev(`window.scrollTo(0, 0); return 1;`); await sleep(400);
  ok(await ev(`return JSON.stringify(window.__cg.secure)`) === "[true,false,true]", "setSecure(true) again when it scrolls back");
  await ev(`document.getElementById("lnPic").remove(); return 1;`); await sleep(300);
  ok(await ev(`return JSON.stringify(window.__cg.secure)`) === "[true,false,true,false]", "setSecure(false) when the image leaves the DOM");

  // ---------- real app on the web: inert ----------
  await open(BASE + "index.html", null);
  await sleep(1500);
  ok(await ev(`return !!window.SMD_CaptureGuard && SMD_CaptureGuard.state().active === false`) === true, "real app (web): capture-guard loaded and inert");
  ok(await ev(`return !document.getElementById("smdCaptureGuardCss") && !document.documentElement.classList.contains("smd-cg-on")`) === true, "real app (web): no style, no class");
  const own = errors.filter((x) => /capture-guard|toast\.js/.test(x));
  ok(own.length === 0, "no exceptions from capture-guard.js / toast.js" + (own.length ? " " + own.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { chrome.kill(); } catch {}
  if (serveProc) try { serveProc.kill(); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
