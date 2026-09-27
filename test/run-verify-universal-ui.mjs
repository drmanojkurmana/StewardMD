/* "Verified once, verified everywhere", in a real headless browser, across real page reloads.
 *
 * Owner, 2026-09-27: "after using a verified NMC register number it still asks at some point to
 * verify my registration. once reg is verified it should be universal all over the app."
 *
 * verify.js kept a "yes" only in memory, so every launch started from nothing, and any failure on
 * the way to an answer (expired token on a slow network, a fetch that timed out, opening offline)
 * was scored as "no" - and evaluate() then showed the FORCED verification screen to a doctor the
 * server had already verified. Each step here reloads the page, because that is where it went wrong.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-verify-universal-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9419, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/vfu-chrome-" + Date.now();
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



/* Runs before ANY app script on every load. The Firebase user is fake and its behaviour is steered
 * from localStorage (__t_*), so it survives reloads. SMD_AUTH is pinned: the real SDK must not
 * replace it half-way through a test. */
const EARLY = `(function () {
  function m(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  var user = {
    uid: "u-vfy-1", email: "doctor.test@example.in",
    getIdTokenResult: function () {
      if (m("__t_token", "ok") === "fail") return Promise.reject(new Error("network"));
      return Promise.resolve({ claims: m("__t_claim", "none") === "verified" ? { verified: true } : {} });
    },
    getIdToken: function () { return m("__t_token", "ok") === "fail" ? Promise.reject(new Error("network")) : Promise.resolve("tok"); }
  };
  var A = { currentUser: user, onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); return function () {}; } };
  Object.defineProperty(window, "SMD_AUTH", { get: function () { return A; }, set: function () {}, configurable: false });
  window.__vfyCalls = 0;
  var f = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf("/api/verify-doctor") >= 0) {
      window.__vfyCalls++;
      var mode = m("__t_server", "verified");
      if (mode === "fail") return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ status: mode, regNo: "APMC 84213" }); } });
    }
    return f.apply(this, arguments);
  };
})();`;
const setMode = (o) => ev(`var o=${JSON.stringify(o)}; Object.keys(o).forEach(function(k){ localStorage.setItem("__t_"+k, o[k]); }); return 1;`);
const forced = () => ev(`var g=document.getElementById("verifyGate"); return !!(g && !g.classList.contains("hidden") && g.style.display !== "none" && g.dataset.mode === "forced");`);
const persisted = () => ev(`return localStorage.getItem("smd_verified_ok:u-vfy-1");`);
async function isVerified() { await ev(`window.__iv = "pending"; SMD_VERIFY.isVerified().then(function(v){ window.__iv = v; }); return 1;`); for (let i = 0; i < 30; i++) { await sleep(100); const v = await ev(`return window.__iv;`); if (v !== "pending") return v; } return "timeout"; }
async function launch() {
  await call("Page.reload", { ignoreCache: false });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return !!(window.SMD_VERIFY && SMD_VERIFY._evaluate && document.getElementById("verifyGate"))`) === true) break; }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","pfSetupRoot","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await sleep(1500);   // let verify.js's own boot evaluate() run, exactly as on a real launch
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: EARLY });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.removeItem("smd_verified_ok:u-vfy-1"); localStorage.removeItem("smd_verify_bypass"); return 1;`);

  // 1. Verified by the NMC register: the server says so, the token claim has not caught up.
  await setMode({ token: "ok", claim: "none", server: "verified" });
  await launch();
  ok(await isVerified() === true, "a doctor the server has verified is verified, with the token claim lagging");
  ok(await persisted() === "1", "and that is remembered for this account on this device");
  ok(await forced() === false, "no verification screen");

  // 2. The very next launch, on a bad network: token refresh fails AND the server is unreachable.
  await setMode({ token: "fail", server: "fail" });
  await launch();
  ok(await forced() === false, "next launch with no network: NOT asked to verify again (the reported bug)");
  ok(await isVerified() === true, "and every gate still reads verified");
  await ev(`SMD_VERIFY._evaluate(); return 1;`); await sleep(800);
  ok(await forced() === false, "a second evaluate() on the dead network still does not force it");

  // 3. Slow token, working server: verified, never asked.
  await setMode({ token: "ok", server: "fail" });
  await launch();
  ok(await forced() === false && await isVerified() === true, "server down but token fine: still verified everywhere");

  // 4. Only the server can take it away: a revoked registration clears the remembered yes.
  await setMode({ token: "ok", claim: "none", server: "unverified" });
  await launch();
  await isVerified(); await sleep(900);
  ok(await persisted() === null, "an explicit 'unverified' from the server withdraws it (revocation still works)");

  // 5. Never verified, no network: the screen is still shown - the fix did not open the gate to everyone.
  await ev(`localStorage.removeItem("smd_verified_ok:u-vfy-1"); return 1;`);
  await setMode({ token: "ok", claim: "none", server: "unverified" });
  await launch();
  ok(await forced() === true, "an account the server says is NOT verified is still asked to verify");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { await ev(`["token","claim","server"].forEach(function(k){localStorage.removeItem("__t_"+k)}); return 1;`); } catch {}
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
