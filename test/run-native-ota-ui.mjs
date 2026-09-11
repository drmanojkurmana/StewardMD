/* native-ota.js (window.SMD_OTA) — real headless Chrome against the actual index.html, with a
 * fake window.Capacitor (CapacitorUpdater + App plugins) and a stubbed /api/ota/check.
 *
 * home.js has carried a DORMANT Settings-page integration since before the 1 Aug OTA teardown —
 * `if (window.SMD_OTA && SMD_OTA.available()) { ... swRow("ota_auto", ...) ... }` — this file is
 * what finally defines window.SMD_OTA, to that exact pre-existing contract
 * ({available,isAuto,setAuto,currentVersion,check,install}). This test verifies the contract
 * itself and the new proactive banner; it does not re-drive home.js's own (unowned, unchanged)
 * render path, since correctness there follows from the contract being honoured here.
 *
 * The two behaviours that matter most, both load-bearing per vault/modules/OTA Updates.md:
 *   1. notifyAppReady() fires on EVERY load, before anything else — skipping it triggers the
 *      plugin's own auto-rollback.
 *   2. When the server reports the kill switch is on, THIS DEVICE calls reset() and reverts to
 *      the builtin bundle — enforced here, not just displayed in the admin console.
 * USAGE: node test/run-native-ota-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9442, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/native-ota-chrome";
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
  window.__calls = [];
  window.__downloadListeners = [];
  // Several OTHER modules (autofetch.js, streak.js, theme-sync.js, swipe-back.js) also register
  // their own real appStateChange listener on load — the real Capacitor App plugin supports many
  // independent subscribers per event, so the fake must too, or the last one registered silently
  // wins and native-ota.js's own listener is never actually the one that fires.
  window.__appStateCbs = [];
  window.__fireAppState = function (st) { window.__appStateCbs.forEach(function (cb) { try { cb(st); } catch (e) {} }); };
  var FAKE_UPDATER = {
    notifyAppReady: function () { window.__calls.push(["notifyAppReady"]); return Promise.resolve({}); },
    download: function (opts) { window.__calls.push(["download", opts]); return window.__downloadResult || Promise.resolve({ id: "bundle-1" }); },
    set: function (opts) { window.__calls.push(["set", opts]); return Promise.resolve(); },
    next: function (opts) { window.__calls.push(["next", opts]); return Promise.resolve({}); },
    reset: function () { window.__calls.push(["reset"]); return Promise.resolve(); },
    addListener: function (name, cb) { window.__downloadListeners.push(name); return Promise.resolve({ remove: function () {} }); },
  };
  var FAKE_APP = {
    getInfo: function () { return Promise.resolve({ build: "7", version: "2.1" }); },
    addListener: function (name, cb) { if (name === "appStateChange") window.__appStateCbs.push(cb); return Promise.resolve({ remove: function () {} }); },
  };
  window.Capacitor = {
    isNativePlatform: function () { return true; },
    platform: "ios",
    Plugins: { CapacitorUpdater: FAKE_UPDATER, App: FAKE_APP },
  };
  window.__otaResponses = [];
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    // native-ota.js calls fetch(SMD_API_BASE + "/api/ota/check...") — on native that's the ABSOLUTE
    // https://stewardmd.in/... url native-bridge.js sets, not a relative path. Match by substring so
    // this works regardless of how the caller built the URL.
    if (String(url).indexOf("/api/ota/check") === -1) return realFetch(url, opts);
    var body = window.__otaResponses.length ? window.__otaResponses.shift() : { ota: false, reason: "no-channel" };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return typeof window.SMD_OTA`) === "object") { ready = true; break; } }
  if (!ready) throw new Error("window.SMD_OTA never appeared");

  // ---- notifyAppReady, on load, before anything else ----
  const boot = await J(`return JSON.stringify({ calls: window.__calls, native: window.SMD_IS_NATIVE, avail: SMD_OTA.available() });`);
  ok(boot.native === true, `native-bridge.js recognises the fake platform as native`);
  ok(boot.calls.some(c => c[0] === "notifyAppReady"), `notifyAppReady() fired on load (${JSON.stringify(boot.calls)})`);
  ok(boot.avail === true, `SMD_OTA.available() is true once the plugin exists — this is the exact guard home.js's dormant Settings row checks`);

  // ---- check(): up to date ----
  const upToDate = await J(`
    window.__otaResponses = [{ ota:false, reason:"up-to-date" }];
    return SMD_OTA.check().then(function(r){ return JSON.stringify(r); });
  `);
  ok(upToDate.status === "uptodate", `check() reports uptodate when the server says so (${JSON.stringify(upToDate)})`);

  // ---- check(): update available ----
  const avail = await J(`
    window.__otaResponses = [{ ota:true, version:5, zipUrl:"https://stewardmd.in/api/ota/file/abc", zipHash:"abc" }];
    return SMD_OTA.check().then(function(r){ return JSON.stringify(r); });
  `);
  ok(avail.status === "available" && avail.version === 5 && avail.zipUrl === "https://stewardmd.in/api/ota/file/abc", `check() surfaces the zip url + version (${JSON.stringify(avail)})`);

  // ---- install(): explicit tap -> set() (immediate), version persisted ----
  const installed = await J(`
    window.__calls = [];
    return SMD_OTA.install({ version:5, zipUrl:"https://stewardmd.in/api/ota/file/abc", zipHash:"abc" }, null, true).then(function(r){
      return JSON.stringify({ res:r, calls: window.__calls, current: SMD_OTA.currentVersion() });
    });
  `);
  ok(installed.res.ok === true, `install() reports success`);
  ok(installed.calls.some(c => c[0] === "download" && c[1].url === "https://stewardmd.in/api/ota/file/abc"), `install() calls download() with the exact zip url (${JSON.stringify(installed.calls)})`);
  ok(installed.calls.some(c => c[0] === "set"), `an explicit tap (immediate:true) calls set() — the instant-apply path`);
  ok(!installed.calls.some(c => c[0] === "next"), `...and does NOT call next()`);
  ok(installed.current === 5, `the applied version is persisted (currentVersion() now 5)`);

  // ---- install(): auto/background path -> next(), never set() ----
  const queued = await J(`
    window.__calls = [];
    return SMD_OTA.install({ version:6, zipUrl:"https://stewardmd.in/api/ota/file/def", zipHash:"def" }, null, false).then(function(r){
      return JSON.stringify({ res:r, calls: window.__calls });
    });
  `);
  ok(queued.res.ok === true, `background install succeeds`);
  ok(queued.calls.some(c => c[0] === "next"), `immediate:false calls next() — queued for a future natural restart, never yanking a live session`);
  ok(!queued.calls.some(c => c[0] === "set"), `...and never set() — this is the "never applied without the user's own choice" guarantee`);

  // ---- THE load-bearing one: kill switch enforcement, client-side ----
  const killed = await J(`
    window.__calls = [];
    window.__otaResponses = [{ ota:false, reason:"disabled" }];
    return SMD_OTA.check().then(function(r){
      return JSON.stringify({ res:r, calls: window.__calls, current: SMD_OTA.currentVersion() });
    });
  `);
  ok(killed.calls.some(c => c[0] === "reset"), `kill switch: the device calls reset() itself, reverting to the builtin bundle (${JSON.stringify(killed.calls)})`);
  ok(killed.res.reverted === true, `check() reports the revert explicitly`);
  ok(killed.current === null, `currentVersion() is cleared back to builtin after a kill-triggered revert`);

  // ---- kill switch does NOT fire reset() if the device was never on an OTA bundle ----
  const killedNoop = await J(`
    window.__calls = [];
    window.__otaResponses = [{ ota:false, reason:"disabled" }];
    return SMD_OTA.check().then(function(r){ return JSON.stringify({ calls: window.__calls }); });
  `);
  ok(!killedNoop.calls.some(c => c[0] === "reset"), `a device already on the builtin bundle is left alone — no pointless reset() call`);

  // ---- the proactive banner: appears on a real background check, not just a manual one ----
  // Fired via __fireAppState (broadcasts to every registered appStateChange listener, matching the
  // real multi-subscriber Capacitor App plugin) — several OTHER modules (autofetch.js, streak.js,
  // theme-sync.js) ALSO register their own listener for this event, so calling only "the" callback
  // would just hit whichever one happened to register last.
  /* The banner must NOT appear over the splash / intro / sign-in gate (reported from internal
   * testing with it stacked on the pre-login screen, clipping the notification ask). native-ota.js
   * asks window.SMD_PROMPT_OK - home.js's single definition of "signed in and actually on home" -
   * and defers on a timer until it passes. Prove the deferral first, then let it through. */
  await ev(`window.SMD_PROMPT_OK = function(){ return false; }; return 1;`);
  await J(`
    window.__otaResponses = [{ ota:true, version:7, zipUrl:"https://stewardmd.in/api/ota/file/ghi", zipHash:"ghi" }];
    try { localStorage.removeItem("smd_ota_lastcheck"); } catch(e){}
    try { localStorage.setItem("smd_ota_auto", "0"); } catch(e){}   // manual mode -> banner, not silent apply
    window.__fireAppState({ isActive: true });
    return JSON.stringify({ ok: 1 });
  `);
  await sleep(500);
  ok(await ev(`var b=document.getElementById("smdOtaBanner"); return !b || b.className.indexOf("on") < 0;`) === true,
    "the banner does NOT appear while the sign-in gate is still up");

  // Now the doctor is signed in and on home: the deferred banner should arrive on the next tick.
  await ev(`window.SMD_PROMPT_OK = function(){ return true; }; return 1;`);
  await sleep(1900);
  const banner = await J(`return JSON.stringify({ nListeners: window.__appStateCbs.length });`);
  ok(banner.nListeners >= 1, `native-ota.js registered an app-foreground listener (alongside ${banner.nListeners - 1} others)`);
  await sleep(500);
  const bannerShown = await ev(`var b=document.getElementById("smdOtaBanner"); return b ? b.className : "absent";`);
  ok(/\bon\b/.test(bannerShown || ""), `the banner appears after a background check finds an update, in manual mode (class="${bannerShown}")`);
  const bannerText = await ev(`return (document.getElementById("smdOtaBanner")||{}).textContent || "";`);
  ok(/Update ready/.test(bannerText), `banner text says what it is (got "${bannerText}")`);

  // ---- tapping "Update now" on the banner installs immediately (set(), not next()) ----
  const tapped = await J(`
    window.__calls = [];
    document.querySelector("#smdOtaBanner .go").click();
    return JSON.stringify({ clicked: true });
  `);
  await sleep(300);
  const afterTap = await J(`return JSON.stringify({ calls: window.__calls });`);
  ok(afterTap.calls.some(c => c[0] === "download"), `tapping the banner's "Update now" triggers a download`);
  ok(afterTap.calls.some(c => c[0] === "set"), `...and applies it immediately (set()), matching an explicit user tap`);

  // ---- auto mode: no banner, silent background apply via next() ----
  const autoOn = await J(`
    document.getElementById("smdOtaBanner").remove();
    try { localStorage.setItem("smd_ota_auto", "1"); } catch(e){}
    try { localStorage.removeItem("smd_ota_lastcheck"); } catch(e){}
    window.__calls = [];
    window.__otaResponses = [{ ota:true, version:8, zipUrl:"https://stewardmd.in/api/ota/file/jkl", zipHash:"jkl" }];
    window.__fireAppState({ isActive: true });
    return JSON.stringify({ ok: true });
  `);
  await sleep(400);
  const autoResult = await J(`return JSON.stringify({ calls: window.__calls, bannerPresent: !!document.getElementById("smdOtaBanner") || (document.getElementById("smdOtaBanner")&&document.getElementById("smdOtaBanner").classList.contains("on")) });`);
  ok(autoResult.calls.some(c => c[0] === "next"), `with automatic updates on, the background check applies silently via next() (${JSON.stringify(autoResult.calls)})`);
  ok(!autoResult.calls.some(c => c[0] === "set"), `...never via the disruptive set()`);

  /* ── an update failure must never carry our infrastructure back to the screen ──
   * Reported from the field, 2026-08-28: a failed update printed the OTA endpoint. install() was
   * returning @capgo/capacitor-updater's own message, and that plugin is handed the bundle's
   * zipUrl - so its failures quote the URL back, and the settings screen interpolated it straight
   * into the status line. Fail download() exactly the way the plugin does. */
  await J(`window.__calls = [];
    window.__downloadResult = Promise.reject(new Error(
      "Failed to download https://stewardmd.in/api/ota/file/abc: HTTP 403 from r2.stewardmd.internal"));
    return 1;`);
  const leak = await J(`return window.SMD_OTA.install(
      { version: "9.9.9", zipUrl: "https://stewardmd.in/api/ota/file/abc", zipHash: "h" }, null, true)
    .then(function (r) { return JSON.stringify(r); });`);
  const leakStr = typeof leak === "string" ? leak : JSON.stringify(leak);
  ok(!/stewardmd\.in|r2\.stewardmd|https?:\/\//.test(leakStr),
     `install() returns no URL or hostname on failure (got: ${leakStr})`);
  ok(/"error":"(network|checksum|storage|unauthorized|missing|download-failed|apply-failed)"/.test(leakStr),
     `...only a fixed code (got: ${leakStr})`);
  ok(/unauthorized/.test(leakStr),
     `...and a 403 is classified rather than passed through (got: ${leakStr})`);

  console.log(fails === 0 ? "\nALL GREEN — the OTA client honours its contract, and never applies anything the user or their own auto-update choice didn't ask for" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
