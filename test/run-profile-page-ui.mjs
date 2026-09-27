/* The Profile page (home.js openAccount), driven in a real headless browser.
 *
 * Owner: "Profile section not opening after repeated clicks ... even information doesn't load if
 * opens". Firebase is LAZY, and that includes auth. On a cold start SMD_AUTH and SMD_DB are both
 * absent; the details loader only booted Firebase when auth was already there, so it never asked
 * for it and sat on "Sign-in still loading" for good. Measured before the fix: zero load requests
 * across five opens.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-profile-page-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9405, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pfp-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

/* A signed-in account whose Firebase has NOT loaded: the cold start. __loadMode picks what the
 * lazy loader does - "ok" boots auth + db (auth restores a moment later, as it really does),
 * "hang" never calls back. */
const STUB = `
  ["introPoster","splash","accountGate","introOverlay","smdBootSplash","pfSetupRoot","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
  window.__loads = 0; window.__loadMode = "ok";
  window.SMD_AUTH = null; window.SMD_DB = null;
  window.SMD_ACCOUNT = window.SMD_ACCOUNT || {};
  // Capture the auth-change listener so the test can fire it for real.
  window.__acctL = []; SMD_ACCOUNT.onChange = function (f) { window.__acctL.push(f); };
  SMD_ACCOUNT.profile = function () { return { signedIn: true, name: "Dr Manoj", email: "m@x.in", picture: "" }; };
  window.__mkDb = function () { return { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
    get: function () { return Promise.resolve({ exists: true, data: function () { return { hospital: "King George Hospital", degree: "MD", speciality: "Internal Medicine", city: "Visakhapatnam", phone: "8897298117", regNo: "APMC123" }; } }); },
    set: function () { return Promise.resolve(); }
  }; } }; } }; } }; } }; };
  window.SMD_loadFirebase = function (cb) {
    window.__loads++;
    if (window.__loadMode === "hang") return;
    setTimeout(function () {
      var listeners = [];
      window.SMD_AUTH = { currentUser: null, onAuthStateChanged: function (f) { listeners.push(f); return function () {}; } };
      window.SMD_DB = window.__mkDb();
      cb && cb();
      // The persisted session comes back a beat after the SDK: currentUser is null until then.
      setTimeout(function () { SMD_AUTH.currentUser = { uid: "u-doc-1", getIdToken: function(){return Promise.resolve("t");} }; listeners.forEach(function (f) { f(SMD_AUTH.currentUser); }); }, 120);
    }, 60);
  };
  return 1;`;
const rows = () => ev(`return [].map.call(document.querySelectorAll("#pfPro [data-val]"), function (x) { return x.textContent; }).join("|");`);
const isOpen = () => ev(`var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on"));`);
const closeIt = () => ev(`var sc=document.getElementById("hvScrim"); if (sc) sc.click(); return 1;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return typeof window.SMD_openProfile === "function" && !!document.getElementById("hvSheet")`) === true) { ready = true; break; } }
  ok(ready, "home.js loads and exports SMD_openProfile");
  await sleep(1200);
  await ev(STUB);

  // ── cold start: the details must actually load ────────────────────────────────────────────────
  await ev(`SMD_openProfile(); return 1;`); await sleep(100);
  ok(await isOpen() === true, "Profile opens on a cold start");
  ok(await ev(`return window.__loads;`) >= 1, "and asks for Firebase, which it never used to do");
  await sleep(900);
  const r1 = await rows();
  ok(/King George Hospital/.test(r1) && /Internal Medicine/.test(r1), "the doctor's details load once auth restores " + r1);
  ok(!/Sign-in still loading|Loading/.test(r1), "nothing is left on a loading placeholder " + r1);

  // ── repeated taps ─────────────────────────────────────────────────────────────────────────────
  let allOpened = true;
  for (let k = 0; k < 5; k++) {
    await closeIt(); await sleep(200);
    await ev(`SMD_openProfile(); return 1;`); await sleep(250);
    if (await isOpen() !== true) allOpened = false;
  }
  ok(allOpened, "five close-and-reopen taps in a row all open the page");
  ok(/King George Hospital/.test(await rows()), "and the details are there every time " + await rows());

  // ── a loader that never calls back must not lock Profile on "Loading..." forever ──────────────
  await closeIt(); await sleep(150);
  await ev(`window.SMD_AUTH = null; window.SMD_DB = null; window.__loadMode = "hang"; window.__loads = 0; return 1;`);
  await ev(`SMD_openProfile(); return 1;`); await sleep(300);
  ok(/Loading/.test(await rows()), "a hung load shows Loading at first " + await rows());
  await sleep(12800);
  const r2 = await rows();
  ok(/Offline/.test(r2) && await ev(`return !!document.querySelector("#pfPro [data-retry]");`) === true,
     "and gives up with a Retry instead of loading forever " + r2);
  // Retry, with a loader that now works, recovers without restarting the app.
  await ev(`window.__loadMode = "ok"; document.querySelector("#pfPro [data-retry]").click(); return 1;`); await sleep(1200);
  ok(/King George Hospital/.test(await rows()), "Retry recovers once Firebase can load " + await rows());

  // ── an auth change must not reopen a sheet the doctor closed ──────────────────────────────────
  await closeIt(); await sleep(300);
  const nL = await ev(`return window.__acctL.length;`);
  ok(nL >= 1, "the Profile page subscribes to auth changes (" + nL + " listener)");
  await ev(`window.__acctL.forEach(function (f) { try { f(); } catch (e) {} }); return 1;`); await sleep(300);
  ok(await isOpen() === false, "an auth change after closing does not reopen Profile on the doctor");
  // ...but it does refresh one that is open.
  await ev(`SMD_openProfile(); return 1;`); await sleep(300);
  await ev(`window.__acctL.forEach(function (f) { try { f(); } catch (e) {} }); return 1;`); await sleep(300);
  ok(await isOpen() === true, "and an open Profile stays open through an auth change");

  // ── the details read: the SDK hangs on iOS; the server copy must fill in ──────────────────────
  // Owner, 2026-09-27: every detail "Offline" while Registration said Verified. The SDK read hung.
  await closeIt(); await sleep(200);
  await ev(`try { Object.keys(localStorage).forEach(function(k){ if (k.indexOf("smd_profile_cache:")===0) localStorage.removeItem(k); }); } catch(e){}
    window.SMD_AUTH = { currentUser: { uid: "u-doc-2", getIdToken: function(){ return Promise.resolve("t"); } }, onAuthStateChanged: function(){ return function(){}; } };
    window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
      get: function () { return new Promise(function () {}); },  set: function () { return Promise.resolve(); } }; } }; } }; } }; } };
    window.__srvMode = "ok"; var _f = window.__origFetch || window.fetch; window.__origFetch = _f;
    window.fetch = function (u, o) {
      if (String(u).indexOf("/api/auth/my-profile") >= 0) {
        if (window.__srvMode === "fail") return Promise.reject(new Error("offline"));
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, exists: true, profile: { hospital: "KGH Server Copy", degree: "MD", speciality: "Internal Medicine", city: "Visakhapatnam", regNo: "APMC 1" } }); } });
      }
      return _f.apply(this, arguments);
    }; return 1;`);
  await ev(`SMD_openProfile(); return 1;`); await sleep(1200);
  ok(/KGH Server Copy/.test(await rows()) && !/Offline/.test(await rows()), "SDK read hangs, the server copy fills Profile " + await rows());
  // Both fail, but it was loaded before: the saved copy stays, no Offline.
  await closeIt(); await sleep(200);
  await ev(`window.__srvMode = "fail"; SMD_openProfile(); return 1;`); await sleep(7000);
  ok(/KGH Server Copy/.test(await rows()) && !/Offline/.test(await rows()), "both sources down: the last good copy is shown, not Offline " + await rows());
  // Both fail and nothing was ever loaded here: only then, Offline with Retry.
  await closeIt(); await sleep(200);
  await ev(`localStorage.removeItem("smd_profile_cache:u-doc-2"); SMD_openProfile(); return 1;`); await sleep(7000);
  ok(/Offline/.test(await rows()) && await ev(`return !!document.querySelector("#pfPro [data-retry]");`) === true, "only with nothing to show: Offline with Retry " + await rows());
  await ev(`window.fetch = window.__origFetch; return 1;`);

  // ── one entry point ───────────────────────────────────────────────────────────────────────────
  ok(await ev(`return String(window.SMD_openProfile).indexOf("firstRun") < 0;`) === true,
     "SMD_openProfile is home.js's Profile page, not email-auth's setup-form fallback");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
