/* OTA delta install (native-ota.js planDelta + install): instead of one whole-app zip, the app asks the server for the file
 * list (check?files=1), asks the plugin which files it does not already have (getMissingBundleFiles), and downloads only
 * those in manifest mode, where the plugin reports a real event per finished file. Checks, in the real page with a fake
 * updater plugin:
 *  - download() gets the manifest (absolute per-file URLs, no checksum) and the card shows the size of what is MISSING;
 *  - progress is real: events move the bar to an exact figure, with no speed-probe traffic;
 *  - a failed delta falls back to the one-zip download (checksum, no manifest) and the card switches to the zip estimate;
 *  - a device that has none of the files uses the zip straight away;
 *  - a plugin without getMissingBundleFiles uses the zip.
 * USAGE: CHROME=<path> CHROME_FLAGS=--no-sandbox node test/run-ota-delta-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9474, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ota-delta-chrome";
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


const BOOT = `
  window.__calls = []; window.__dlCbs = []; window.__probes = 0; window.__checks = []; window.__missing = 2; window.__failDelta = false;
  var FILES = []; for (var i = 0; i < 10; i++) FILES.push({ path: "f" + i + ".js", hash: "h" + i, size: (i < 2 ? 5 : 1) * 1048576 });
  var FAKE_UPDATER = {
    notifyAppReady: function () { return Promise.resolve({}); },
    getMissingBundleFiles: function (o) { window.__calls.push(["missing", o.manifest.length]); return Promise.resolve({ missing: o.manifest.slice(0, window.__missing), total: o.manifest.length, reusableCount: o.manifest.length - window.__missing }); },
    download: function (opts) {
      window.__calls.push(["download", opts]);
      if (opts.manifest && window.__failDelta) return Promise.reject(new Error("Manifest file download failed"));
      return new Promise(function (res) { window.__finishDownload = function () { res({ id: "bundle-9" }); }; });
    },
    set: function (opts) { window.__calls.push(["set", opts]); return Promise.resolve(); },
    next: function (opts) { return Promise.resolve({}); },
    reset: function () { return Promise.resolve(); },
    addListener: function (name, cb) { if (name === "download") window.__dlCbs.push(cb); return Promise.resolve({ remove: function () {} }); },
    list: function () { return Promise.resolve({ bundles: [] }); },
    current: function () { return Promise.resolve({ bundle: { id: "builtin" } }); },
    delete: function () { return Promise.resolve(); }
  };
  var FAKE_APP = { getInfo: function () { return Promise.resolve({ build: "7", version: "2.1" }); }, addListener: function () { return Promise.resolve({ remove: function () {} }); } };
  window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; }, platform: "ios", Plugins: { CapacitorUpdater: FAKE_UPDATER, App: FAKE_APP } };
  window.__noDeltaApi = function () { delete FAKE_UPDATER.getMissingBundleFiles; };
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf("/api/ota/probe") !== -1) { window.__probes++; return Promise.resolve(new Response("a".repeat(393216), { status: 200 })); }
    if (u.indexOf("/api/ota/check") !== -1) {
      window.__checks.push(u);
      var body = { ota: true, version: 99, zipHash: "ab12", zipSize: 100 * 1048576 };
      if (u.indexOf("files=1") !== -1) body.files = FILES;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return realFetch(url, opts);
  };
`;

const PEND = `{ version: 99, zipUrl: "https://stewardmd.in/api/ota/file/ab12", zipHash: "ab12", zipSize: 100 * 1048576 }`;
const startCard = (extra) => `var d = document.getElementById("otpHost") || document.createElement("div"); d.id = "otpHost"; d.style.cssText = "position:fixed;left:12px;right:12px;top:12px;z-index:999999;background:#fff;padding:8px"; document.body.appendChild(d);
    window.__calls = []; window.__dlCbs = []; window.__probes = 0; window.__last = null; window.__pu = SMD_OTA.progressUI(d);
    ${extra || ""}
    window.__inst = SMD_OTA.install(${PEND}, function (p, l, info) { window.__last = info; window.__pu.update(p, l, info); });
    return 1;`;
const txt = (s) => `var e=document.querySelector("#otpHost ${s}"); return e?e.textContent:"";`;

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

  // ---- delta: 2 of 10 files missing (5 MB each) = 10 MB, against a 100 MB zip ----
  await ev(startCard());
  await sleep(1500);
  const dl = await J(`var c = window.__calls.filter(function (x) { return x[0] === "download"; })[0]; return JSON.stringify({ n: window.__calls.filter(function (x) { return x[0] === "download"; }).length, opts: c && c[1] });`);
  ok(dl.n === 1 && dl.opts && Array.isArray(dl.opts.manifest) && dl.opts.manifest.length === 10, "download() is given the 10-file manifest, not just the zip");
  ok(dl.opts.checksum === undefined && dl.opts.manifest[0].download_url === "https://stewardmd.in/api/ota/file/h0" && dl.opts.manifest[0].file_name === "f0.js" && dl.opts.manifest[0].file_hash === "h0", "entries carry file_name, file_hash and an absolute per-file URL; no zip checksum");
  ok(await ev(`return window.__checks.some(function (u) { return u.indexOf("files=1") !== -1; });`) === true, "the file list is requested with files=1");
  const c1 = await J(`return JSON.stringify({ mb: (document.querySelector("#otpHost .otp-mb")||{}).textContent, ph: (document.querySelector("#otpHost .otp-ph")||{}).textContent, note: (document.querySelector("#otpHost .otp-note")||{}).textContent, pc: (document.querySelector("#otpHost .otp-pc")||{}).textContent });`);
  ok(/^0\.0 of 10\.0 MB$/.test(c1.mb), "the card shows the size of what is missing (10.0 MB), a real 0, not 100 MB and not 'measuring': " + c1.mb);
  ok(c1.ph === "Downloading changes", "the heading says it is downloading changes: " + c1.ph);
  ok(/Only what changed/.test(c1.note) && /2 files/.test(c1.note) && /10\.0 MB instead of the full 100\.0 MB/.test(c1.note), "the note explains the saving: " + c1.note);

  // iOS maps completed files / total to 10..70: 8 reused + 1 of 2 missing = 9/10 files = 10 + 0.9*60 = 64
  await ev(`window.__dlCbs.forEach(function (cb) { cb({ percent: 0 }); cb({ percent: 64 }); }); return 1;`);
  await sleep(1300);
  const c2 = await J(`return JSON.stringify({ mb: (document.querySelector("#otpHost .otp-mb")||{}).textContent, est: window.__last.est, pc: (document.querySelector("#otpHost .otp-pc")||{}).textContent, probes: window.__probes });`);
  ok(c2.est === false && /^5\.0 of 10\.0 MB$/.test(c2.mb), "one of the two missing files landed: exactly 5.0 of 10.0 MB (no 'about'): " + c2.mb);
  ok(c2.pc === "50%", "and the bar reads 50%: " + c2.pc);
  ok(c2.probes === 0, "delta mode sends no speed-probe traffic (" + c2.probes + ")");
  await ev(`window.__dlCbs.forEach(function (cb) { cb({ percent: 70 }); }); return 1;`);
  await sleep(1300);
  ok(/Installing/.test(await ev(txt(".otp-ph"))), "the 70% event switches to Installing");
  await ev(`window.__finishDownload(); return 1;`); await sleep(600);
  ok(await ev(`return window.__calls.some(function (c) { return c[0] === "set" && c[1].id === "bundle-9"; });`) === true, "the finished delta bundle is applied with set()");

  // ---- the delta fails: fall back to the zip ----
  await ev(startCard("window.__failDelta = true;"));
  await sleep(2500);
  const fb = await J(`var d = window.__calls.filter(function (x) { return x[0] === "download"; }); return JSON.stringify({ n: d.length, last: d[d.length - 1][1], ph: (document.querySelector("#otpHost .otp-ph")||{}).textContent });`);
  ok(fb.n >= 2 && fb.last.manifest === undefined && fb.last.checksum === "ab12", "after the delta fails the zip is downloaded (checksum, no manifest): " + fb.n + " calls");
  ok(fb.ph === "Downloading update", "and the card goes back to the whole-update view: " + fb.ph);
  ok(await ev(`return window.__probes;`) >= 1, "the zip path measures the link again");
  await ev(`window.__failDelta = false; window.__finishDownload(); return 1;`); await sleep(500);

  // ---- nothing reusable: straight to the zip ----
  await ev(startCard("window.__missing = 10;"));
  await sleep(1500);
  const none = await J(`var d = window.__calls.filter(function (x) { return x[0] === "download"; }); return JSON.stringify({ n: d.length, o: d[0][1] });`);
  ok(none.n === 1 && none.o.manifest === undefined && none.o.checksum === "ab12", "no file reusable: the single zip, not 10 separate requests");
  await ev(`window.__finishDownload(); return 1;`); await sleep(500);

  // ---- plugin without the delta API ----
  await ev(startCard("window.__missing = 2; window.__noDeltaApi();"));
  await sleep(1500);
  const old = await J(`var d = window.__calls.filter(function (x) { return x[0] === "download"; }); return JSON.stringify({ n: d.length, o: d[0][1], asked: window.__calls.some(function (x) { return x[0] === "missing"; }) });`);
  ok(old.n === 1 && old.o.manifest === undefined && old.asked === false, "an older plugin build without getMissingBundleFiles uses the zip");
  await ev(`window.__finishDownload(); return 1;`);
} catch (e) { console.log("❌ harness: " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
