/* The ICU "Send me a test notification" button, in a real headless browser.
 *
 * Owner, repeatedly, with a screenshot: the button says "Test notification sent" and nothing ever
 * arrives. That message was never false - the server counts a send only when APNs returns 200 -
 * but APNs returns 200 for a handset whose user has notifications switched OFF, and iOS then drops
 * the payload in silence. So a button that reports only the server's answer always claims success
 * and can never explain the usual failure.
 *
 * These cases drive every link in the chain and assert the button names the broken one. They are
 * only reachable in a browser: the plugin, the permission state and the toast are all runtime.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-push-diagnostic-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9403, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/push-chrome-" + Date.now();
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
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: false }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

/* The whole chain, stubbed so each link can be broken on purpose. __srv is what /api/push/test
 * answers; __perm / __tok / __plug are what the handset reports. */
const STUB = `
  window.__toasts = []; window.toast = function (m) { window.__toasts.push(String(m)); };
  // A signed-in doctor: icu.js idToken() reads SMD_AUTH.currentUser.getIdToken().
  window.SMD_AUTH = { currentUser: { uid: "u-doc-1", getIdToken: function () { return Promise.resolve("tok"); } } };
  window.__srv = { ok: true, sent: 1, total: 1 };
  window.__perm = "granted"; window.__tok = true; window.__plug = true; window.__nativeOK = true;
  window.__enableCalls = 0; window.__enableGrants = true;
  window.SMD_pushDiagnostics = function () {
    return Promise.resolve({ native: window.__nativeOK, plugin: window.__plug,
                             permission: window.__perm, token: window.__tok, flag: true });
  };
  window.SMD_enableNativePush = function () {
    window.__enableCalls++;
    if (window.__enableGrants) { window.__perm = "granted"; window.__tok = true; }
    return Promise.resolve(window.__enableGrants);
  };
  var _f = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf("/api/push/test") >= 0) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(window.__srv); } });
    }
    return _f.apply(this, arguments);
  };
  return 1;`;

const lastToast = () => ev(`return window.__toasts.length ? window.__toasts[window.__toasts.length-1] : "";`);
const allToasts = () => ev(`return JSON.stringify(window.__toasts);`);
async function press() {
  await ev(`window.__toasts = []; return 1;`);
  await ev(`ICU._testPush(); return 1;`);
  await sleep(500);
}

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU._testPush)`) === true) { ready = true; break; } }
  ok(ready, "icu.js exposes the test-push handler");
  if (!ready) throw new Error("ICU._testPush missing - the test hook was not exported");
  await ev(STUB);

  // ── the failure the owner actually hit ────────────────────────────────────────────────────────
  await press();
  ok(!/^Test notification sent/.test(await lastToast()),
     "a server 'sent' no longer ends the story with a bare success claim " + await lastToast());
  ok(/iOS hides banners while the app is open|Focus/i.test(await lastToast()),
     "it names the two handset reasons a delivered push shows nothing " + await lastToast());

  // ── notifications switched off ────────────────────────────────────────────────────────────────
  await ev(`window.__perm = "denied"; return 1;`); await press();
  ok(/Notifications are OFF/i.test(await lastToast()) && /Settings/i.test(await lastToast()),
     "notifications denied says so, and where to turn them on " + await lastToast());
  ok(await ev(`return window.__toasts.join(" ").indexOf("Sending a test") < 0;`) === true,
     "and it does not pretend to send first");

  // ── never asked: ask, then continue without a second tap ──────────────────────────────────────
  await ev(`window.__perm = "prompt"; window.__tok = false; window.__enableCalls = 0; window.__enableGrants = true; return 1;`);
  await press(); await sleep(400);
  ok(await ev(`return window.__enableCalls;`) === 1, "an unasked device is asked for permission");
  ok(/Apple accepted it/i.test(await allToasts()), "and the test proceeds once granted, with no second tap " + await allToasts());

  await ev(`window.__perm = "prompt"; window.__tok = false; window.__enableCalls = 0; window.__enableGrants = false; return 1;`);
  await press(); await sleep(400);
  ok(/were not allowed/i.test(await lastToast()), "a refused prompt says nothing can reach the device " + await lastToast());

  // ── registered with us, but Apple has no token for this install ───────────────────────────────
  await ev(`window.__perm = "granted"; window.__tok = false; return 1;`); await press();
  ok(/not finished registering/i.test(await lastToast()), "no device token says to reopen the app " + await lastToast());

  // ── the server side ───────────────────────────────────────────────────────────────────────────
  await ev(`window.__tok = true; window.__srv = { ok: true, sent: 0, total: 0 }; return 1;`); await press();
  ok(/no registered device/i.test(await lastToast()), "no device on the account is distinct from a stale one " + await lastToast());

  await ev(`window.__srv = { ok: true, sent: 0, total: 2 }; return 1;`); await press();
  ok(/stale/i.test(await lastToast()), "tokens present but all rejected reads as stale, not as 'no device' " + await lastToast());

  // ── a browser tab ─────────────────────────────────────────────────────────────────────────────
  await ev(`window.__nativeOK = false; return 1;`); await press();
  ok(/installed app/i.test(await lastToast()), "a browser is told push needs the installed app " + await lastToast());

  // ── an older bundle without the diagnostic still works ────────────────────────────────────────
  await ev(`window.__nativeOK = true; window.__srv = { ok: true, sent: 1, total: 1 }; delete window.SMD_pushDiagnostics; return 1;`);
  await press();
  ok(/Apple accepted it/i.test(await allToasts()), "without the diagnostic it falls back to sending " + await allToasts());

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
