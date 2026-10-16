/* The OTA download card (native-ota.js progressUI + the meter in install()): bar, MB, live speed, speed graph, in the real page
 * with a fake updater plugin whose download() stays pending. A fake fetch answers the ranged speed probes. Checks:
 *  - the card appears and fills: "about N of 100 MB", a speed in MB/s, an ETA, a rising bar and a speed graph;
 *  - the figures are estimates ("about") until the plugin sends an intermediate percentage, then they are exact;
 *  - a dead network (no probe answers for over 20 s) shows "Waiting for the network" and stops the bar (meter unit);
 *  - the plugin's 70% event switches the card to Installing; the finished download restarts the app (set() called);
 *  - no probe traffic when nobody is watching (the silent auto-update path).
 * USAGE: CHROME=<path> CHROME_FLAGS=--no-sandbox node test/run-ota-progress-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9473, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ota-progress-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// A fake CapacitorUpdater + App, wired up so a real @capgo/capacitor-updater method call is
// recorded and answered exactly like the real plugin would. Injected BEFORE navigation so
// native-bridge.js's own `native = !!(Capacitor && ...)` check sees a genuine native platform,
// and native-ota.js's document-start notifyAppReady() call has something real to hit.
const BOOT = `
  window.__calls = []; window.__dlCbs = []; window.__probes = 0; window.__appStateCbs = [];
  var pendingResolve = null;
  var FAKE_UPDATER = {
    notifyAppReady: function () { return Promise.resolve({}); },
    download: function (opts) { window.__calls.push(["download", opts]); return new Promise(function (res) { pendingResolve = res; window.__finishDownload = function () { res({ id: "bundle-9" }); }; }); },
    set: function (opts) { window.__calls.push(["set", opts]); return Promise.resolve(); },
    next: function (opts) { window.__calls.push(["next", opts]); return Promise.resolve({}); },
    reset: function () { return Promise.resolve(); },
    addListener: function (name, cb) { if (name === "download") window.__dlCbs.push(cb); return Promise.resolve({ remove: function () {} }); },
    list: function () { return Promise.resolve({ bundles: [] }); },
    current: function () { return Promise.resolve({ bundle: { id: "builtin" } }); },
    delete: function () { return Promise.resolve(); }
  };
  var FAKE_APP = { getInfo: function () { return Promise.resolve({ build: "7", version: "2.1" }); }, addListener: function (n, cb) { if (n === "appStateChange") window.__appStateCbs.push(cb); return Promise.resolve({ remove: function () {} }); } };
  window.Capacitor = { isNativePlatform: function () { return true; }, platform: "ios", Plugins: { CapacitorUpdater: FAKE_UPDATER, App: FAKE_APP } };
  var realFetch = window.fetch.bind(window);
  window.__probeDelay = 100;   // ms per 384 KB probe, about 3.7 MB/s
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf("/api/ota/probe") !== -1) {
      window.__probes++;
      return new Promise(function (res) { setTimeout(function () { res(new Response("a".repeat(393216), { status: 200 })); }, window.__probeDelay); });
    }
    if (u.indexOf("/api/ota/file/") !== -1) {
      window.__probes++;
      return new Promise(function (res) { setTimeout(function () { res(new Response(new ArrayBuffer(393216), { status: 206 })); }, window.__probeDelay); });
    }
    if (u.indexOf("/api/ota/check") !== -1) return Promise.resolve(new Response(JSON.stringify({ ota: false }), { status: 200 }));
    return realFetch(url, opts);
  };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return typeof window.SMD_OTA`) === "object") break; }
  await ev(`["introPoster","splash","smdBootSplash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // ---- the meter on its own (pure, explicit clock) ----
  const m = await J(`var m = SMD_OTA._meter(100 * 1048576); m.sample(1048576, 1000); var t0 = Date.now(); var a = m.read(t0 + 1000, "download"); var b = m.read(t0 + 2000, "download"); var w = m.read(t0 + 30000, "download"); var i = m.read(t0 + 31000, "install"); return JSON.stringify({ a: a, b: b, w: w, i: i });`);
  ok(m.a.speed > 900000 && m.b.bytes > m.a.bytes && m.b.est === true, "the meter turns a measured 1 MB/s into rising estimated bytes: " + Math.round(m.a.bytes) + " then " + Math.round(m.b.bytes));
  ok(m.w.phase === "waiting" && m.w.speed === 0 && Math.abs(m.w.bytes - m.b.bytes) < 1, "no samples for over 20 s: phase waiting, speed 0, the bar stops");
  ok(m.i.phase === "install" && m.i.pct === 100, "the install phase reads 100%");
  const n0 = await J(`var m = SMD_OTA._meter(100 * 1048576); var t0 = Date.now(); var r = m.read(t0 + 30000, "download"); m.fail("HTTP 403"); var r2 = m.read(t0 + 31000, "download"); return JSON.stringify({ r: r, r2: r2 });`);
  ok(n0.r.phase === "download" && n0.r.samples === 0 && n0.r.elapsed >= 30000, "a probe that never answered is NOT 'waiting for the network' (the native download is still running): phase " + n0.r.phase);
  ok(n0.r2.err === "HTTP 403", "the probe's failure reason reaches the card: " + n0.r2.err);

  // ---- the card, fed by a real install() ----
  await ev(`var d = document.createElement("div"); d.id = "otpHost"; d.style.cssText = "position:fixed;left:12px;right:12px;top:12px;z-index:999999;background:#fff;padding:8px"; document.body.appendChild(d);
    window.__last = null; window.__pu = SMD_OTA.progressUI(d);
    window.__inst = SMD_OTA.install({ version: 99, zipUrl: "https://stewardmd.in/api/ota/file/abc", zipHash: "abc", zipSize: 100 * 1048576 }, function (p, l, info) { window.__last = info; window.__pu.update(p, l, info); });
    return 1;`);
  ok(await ev(`return !!document.querySelector("#otpHost .otp-bar") && /Starting|Downloading/.test(document.querySelector("#otpHost").textContent);`) === true, "the card appears as soon as the download starts");
  await sleep(5500);
  const c1 = await J(`var q=function(s){var e=document.querySelector("#otpHost "+s);return e?e.textContent:""}; return JSON.stringify({ mb: q(".otp-mb"), sp: q(".otp-sp"), pc: q(".otp-pc"), w: document.querySelector("#otpHost .otp-bar i").style.width, spark: !!document.querySelector("#otpHost .otp-spark polyline"), probes: window.__probes, est: window.__last && window.__last.est, speed: window.__last && window.__last.speed });`);
  ok(/^about [\d.]+ of 100\.0 MB$/.test(c1.mb), "it shows the estimated MB of the total: " + c1.mb);
  ok(/MB\/s/.test(c1.sp) && /left|working/.test(c1.sp), "it shows the live speed and an ETA: " + c1.sp);
  ok(parseFloat(c1.w) > 0 && parseInt(c1.pc) > 0, "the bar is filling: " + c1.w + " / " + c1.pc);
  ok(c1.spark === true, "a speed graph is drawn");
  ok(c1.probes >= 2 && c1.probes <= 6, "a few small probes, not a flood (" + c1.probes + " in 5.5 s)");
  const shot = process.env.SHOTS; if (shot) { const r = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(shot + "/otp-card.png", Buffer.from(r.result.data, "base64")); }

  // ---- an intermediate percentage from the plugin makes the figures exact ----
  await ev(`window.__dlCbs.forEach(function (cb) { cb({ percent: 35 }); }); return 1;`);
  await sleep(1300);
  const c2 = await J(`var q=function(s){var e=document.querySelector("#otpHost "+s);return e?e.textContent:""}; return JSON.stringify({ mb: q(".otp-mb"), est: window.__last.est, bytes: window.__last.bytes });`);
  ok(c2.est === false && /^50\.0 of 100\.0 MB$/.test(c2.mb), "a 35% event (of the 70% download band) reads as exactly 50.0 of 100.0 MB: " + c2.mb);

  // ---- the plugin's 70% event: installing ----
  await ev(`window.__dlCbs.forEach(function (cb) { cb({ percent: 70 }); }); return 1;`);
  await sleep(1300);
  ok(/Installing/.test(await ev(`return document.querySelector("#otpHost .otp-ph").textContent;`)), "the 70% event switches the card to Installing");
  const probesAt70 = await ev(`return window.__probes;`); await sleep(3500);
  ok(await ev(`return window.__probes;`) === probesAt70, "the speed probes stop once the file has landed");
  await ev(`window.__finishDownload(); return 1;`);
  await sleep(600);
  ok(await ev(`return window.__calls.some(function (c) { return c[0] === "set" && c[1].id === "bundle-9"; });`) === true, "the finished download is applied with set()");

  // ---- no probe traffic when nobody is watching ----
  const before = await ev(`return window.__probes;`);
  await ev(`window.__calls = []; SMD_OTA.install({ version: 100, zipUrl: "https://stewardmd.in/api/ota/file/def", zipHash: "def", zipSize: 100 * 1048576 }, null, false); return 1;`);
  await sleep(3500);
  ok(await ev(`return window.__probes;`) === before, "the silent auto-update path sends no probe requests");
  await ev(`window.__finishDownload && window.__finishDownload(); return 1;`);
} catch (e) { console.log("❌ harness: " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
