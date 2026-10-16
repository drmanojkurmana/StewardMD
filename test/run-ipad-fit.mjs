/* test/run-ipad-fit.mjs: every Home action at iPad and iPad Pro sizes, portrait and landscape, with the app's own
 * tablet zoom (auto fit 1.08 / 1.15) and touch emulation. Fails when anything sticks past the screen edge outside a
 * scrollable container, or when a control sits below the screen inside a fixed panel that cannot scroll to it.
 * Owner 2026-10-16: "make all modules and whole app iPad Pro and iPad screen ready".
 * Limits: headless Chrome, not WebKit, and the first screen of each tool only.
 *
 * USAGE: node test/run-ipad-fit.mjs [act,act,...]   (default: every Home action)
 *   needs the static server on :8994 (node test/serve.mjs . 8994). OUT=<dir> keeps screenshots.
 *   LEGACY=1 uses Chrome's pre-standard zoom, closer to WebKit. */
// node audit.mjs <outdir> <act,act,...>   -> writes <outdir>/<act>.json and screenshots
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
const ALL = "home startcase reasoning search cases calculators guidelines drugs govschemes docs review kxinbox speckit icdsearch dosecalc neo adultref drugmenu electrolytes dosing interactions icu ward queue wardsynq atlas ophthalmos tokos prep narke oncohome oncotree staging hospital prescription syndromes askai antibiogram menu about account dictate retinalscan kardiox kxlearn thorex sknx clinix pglog surgx insulin hospadmin connect connectpatient agentconnect followcare maitri alltools".split(" ");
const outDir = process.env.OUT || ((process.env.CLAUDE_JOB_DIR || "/tmp") + "/ipad-fit"), actsArg = process.argv[2] || ALL.join(",");
mkdirSync(outDir, { recursive: true });
const acts = actsArg.split(",");
const SIZES = [[820, 1180, "ipad-p"], [1180, 820, "ipad-l"], [1024, 1366, "pro-p"], [1366, 1024, "pro-l"]];
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn("/opt/pw-browsers/chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio", ...(process.env.LEGACY ? ["--disable-blink-features=StandardizedBrowserZoom"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/ipad-${port}`, "about:blank"], { stdio: "ignore" });
let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch {} await sleep(100); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(String(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200)); };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await call("Runtime.evaluate", { expression: `(() => { try { return (${e}); } catch (x) { return 'ERR ' + x; } })()`, returnByValue: true, awaitPromise: true })).result?.result?.value;
await call("Runtime.enable"); await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_ONBOARD=false; window.confirm=function(){return true}; try{localStorage.setItem("smd_onboarding_tour","0");}catch(e){}` });
const MEASURE = `(function(){
  var W = innerWidth, H = innerHeight, rows = [], cut = [];
  var docOver = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W;
  function vis(el, s){ return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; }
  // Fine only when a SCROLLABLE ancestor inside the screen holds it (the user can swipe to it). An overflow:hidden
  // ancestor means the content is cut off: that is the bug we are looking for, so it does not excuse it.
  // Hidden/clipped ancestors that are themselves off-screen (carousels, drawers) do excuse it.
  function clippedBy(el){ for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement){ var s = getComputedStyle(p); var r = p.getBoundingClientRect();
      if (/(auto|scroll)/.test(s.overflowX) && r.right <= W + 1 && r.left >= -1) return true;
      if (/(hidden|clip)/.test(s.overflowX) && (r.right <= 0 || r.left >= W)) return true;
      if (/(hidden|clip)/.test(s.overflowX) && r.right <= W + 1 && r.left >= -1){ var er = el.getBoundingClientRect(); if (er.left >= r.right - 1 || er.right <= r.left + 1) return true; }
    } return false; }
  function name(el){ return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''); }
  var all = document.body.querySelectorAll('*'), bad = new Set();
  for (var i = 0; i < all.length; i++){
    var el = all[i], s = getComputedStyle(el); if (!vis(el, s)) continue;
    var r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > H * 3) continue;
    if ((r.right > W + 2 || r.left < -2) && !clippedBy(el)){
      if (el.parentElement && bad.has(el.parentElement)) { bad.add(el); continue; }
      bad.add(el); rows.push({ el: name(el), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), txt: (el.innerText||'').trim().slice(0,40) });
    }
    if ((s.position === 'fixed') && r.height > 100 && el.scrollHeight > el.clientHeight + 8 && !/(auto|scroll)/.test(s.overflowY) && r.bottom > H - 2){
      cut.push({ el: name(el), sh: el.scrollHeight, ch: el.clientHeight });
    }
  }
  // Vertical: a control below the screen bottom with no scrollable ancestor that could bring it up is unreachable.
  var low = [];
  var ctl = document.body.querySelectorAll('button,a[href],input,select,textarea,[role=button],[data-act]');
  for (var j = 0; j < ctl.length && low.length < 6; j++){
    var c = ctl[j], cs = getComputedStyle(c); if (!vis(c, cs)) continue;
    var cr = c.getBoundingClientRect(); if (cr.width < 4 || cr.height < 4 || cr.top < H - 1 || cr.top > H * 1.6) continue;
    var sc = false, fixedRoot = false;
    for (var q = c.parentElement; q && q !== document.documentElement; q = q.parentElement){ var qs = getComputedStyle(q);
      if (/(auto|scroll)/.test(qs.overflowY) && q.scrollHeight > q.clientHeight + 2) { sc = true; break; }
      if (qs.position === 'fixed') fixedRoot = true; }
    if (!sc && fixedRoot && document.documentElement.scrollHeight <= innerHeight + 2) low.push({ el: name(c), top: Math.round(cr.top), txt: (c.innerText||c.getAttribute('aria-label')||'').trim().slice(0,30) });
  }
  // the topmost full-screen layer: what the user is looking at
  var top = document.elementFromPoint(W/2, H/2), layer = top; while (layer && layer.parentElement && layer.parentElement !== document.body) layer = layer.parentElement;
  var lr = layer && layer.getBoundingClientRect();
  return { W: W, H: H, low: low, docOver: docOver, n: rows.length + low.length, rows: rows.slice(0, 8), cut: cut.slice(0, 4), layer: layer ? name(layer) : '', layerW: lr ? Math.round(lr.width) : 0, layerL: lr ? Math.round(lr.left) : 0 };
})()`;
for (const act of acts) {
  errs = [];
  await call("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true, screenWidth: 1024, screenHeight: 1366 }); await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.navigate", { url: "http://localhost:8994/?tour=0&prep=1&clinix=1" });
  for (let i = 0; i < 100; i++) { if (await ev("!!document.getElementById('homeV2')")) break; await sleep(200); }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}), true`);
  await sleep(800);
  const res = { act, sizes: {} };
  if (act !== "home") {
    await ev(`(function(){var b=document.createElement('button');b.setAttribute('data-act',${JSON.stringify(act)});b.style.cssText='position:fixed;left:-50px;top:0;width:1px;height:1px';document.getElementById('homeV2').appendChild(b);b.click();b.remove();return 1})()`);
    await sleep(3500);
  }
  for (const [w, h, tag] of SIZES) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true, screenWidth: Math.min(w,h) < 900 ? 820 : 1024, screenHeight: 1366 });
    await sleep(700);
    res.sizes[tag] = await ev(MEASURE); res.sizes[tag].zoom = await ev("document.documentElement.style.zoom");
    if (tag === "ipad-p" || tag === "pro-l") {
      const shot = await call("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      if (shot.result) writeFileSync(`${outDir}/${act}-${tag}.jpg`, Buffer.from(shot.result.data, "base64"));
    }
  }
  res.errors = errs.slice(0, 5);
  writeFileSync(`${outDir}/${act}.json`, JSON.stringify(res, null, 1));
  const s = res.sizes; console.log(act, Object.keys(s).map(k => `${k}:${s[k].n}/${s[k].docOver}@${s[k].zoom}`).join(" "), s["ipad-p"].layer);
}
chrome.kill();
const bad = []; for (const a of acts) { try { const r = JSON.parse((await import("node:fs")).readFileSync(`${outDir}/${a}.json`, "utf8")); for (const k in r.sizes) if (r.sizes[k].n) bad.push(a + "@" + k + ": " + JSON.stringify(r.sizes[k].rows.concat(r.sizes[k].low || []).slice(0, 3))); } catch (e) { bad.push(a + ": no result"); } }
if (bad.length) { console.log("\nFAIL\n" + bad.join("\n")); process.exit(1); }
console.log("\nall " + acts.length + " screens fit at 4 iPad sizes"); process.exit(0);
