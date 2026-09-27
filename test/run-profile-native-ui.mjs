/* Profile on an iPHONE, reproduced in a real headless browser.
 *
 * Owner, after the OTA had landed: "pushed to devices, still not opening". A browser could not show
 * it, because the cause is iOS-only. native-watch.js runs only when Capacitor reports iOS, and it
 * REPLACED window.SMD_ROLE (role-features.js's object: current, labelOf, allows, isVerified...) with
 * one holding just seniorMost/isRestricted. Profile then threw "SMD_ROLE.labelOf is not a function"
 * before its sheet opened; the sidebar's try/catch swallowed it; the tap did nothing, every time.
 *
 * So this test makes the page believe it is the iOS app BEFORE any script runs, then taps Profile
 * through the real Settings row the doctor uses.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-profile-native-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9407, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pfn-chrome-" + Date.now();
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


const IOS = `window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; },
  platform: "ios", Plugins: {}, registerPlugin: function () { return new Proxy({}, { get: function () { return function () { return Promise.resolve({}); }; } }); } };`;
const SIGNED_IN = `
  ["introPoster","splash","accountGate","introOverlay","smdBootSplash","pfSetupRoot","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
  window.SMD_ACCOUNT = window.SMD_ACCOUNT || {};
  SMD_ACCOUNT.profile = function () { return { signedIn: true, name: "Dr Manoj", email: "m@x.in", picture: "" }; };
  window.SMD_loadFirebase = function (cb) { cb && cb(); };
  return 1;`;
const isOpen = () => ev(`var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector(".hv-sh-t"));`);
const onTop = () => ev(`var s=document.getElementById("hvSheet"); if(!s||!s.classList.contains("on")) return false; var r=s.getBoundingClientRect(); var el=document.elementFromPoint(r.left+r.width/2, r.top+Math.min(120,r.height/2)); return !!(el && s.contains(el));`);
const closeIt = () => ev(`var sc=document.getElementById("hvScrim"); if (sc) sc.click(); return 1;`);
async function tapProfileRow() {
  await ev(`SMD_openSettings(); return 1;`); await sleep(250);
  const r = await ev(`var b=document.querySelector('#sbrSettings [data-sbr-act="profile"]'); if(!b) return "no row"; b.click(); return "ok";`);
  await sleep(500);
  return r;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: IOS });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return typeof window.SMD_openSettings === "function" && typeof window.SMD_openProfile === "function" && !!document.getElementById("hvSheet")`) === true) { ready = true; break; } }
  ok(ready, "the app boots believing it is the iOS build");
  await sleep(1500);
  ok(await ev(`return window.Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";`) === true, "Capacitor reports iOS, so native-watch.js takes its native path");

  // ── the shared role object survives native-watch.js ───────────────────────────────────────────
  const api = JSON.parse(await ev(`var R=window.SMD_ROLE||{}; return JSON.stringify({labelOf:typeof R.labelOf, current:typeof R.current, allows:typeof R.allows, isVerified:typeof R.isVerified, seniorMost:typeof R.seniorMost, isRestricted:typeof R.isRestricted});`));
  ok(api.labelOf === "function" && api.current === "function" && api.allows === "function" && api.isVerified === "function",
     "role-features.js's API is still there on iOS " + JSON.stringify(api));
  ok(api.seniorMost === "function" && api.isRestricted === "function", "and native-watch.js's additions sit alongside it " + JSON.stringify(api));

  // ── the owner's actual tap, repeatedly ────────────────────────────────────────────────────────
  await ev(SIGNED_IN);
  let opened = 0, top = 0;
  for (let k = 0; k < 4; k++) {
    await tapProfileRow();
    if (await isOpen()) opened++;
    if (await onTop()) top++;
    await closeIt(); await sleep(250);
  }
  ok(opened === 4, `Settings > Profile opens on iOS, 4 taps out of 4 (got ${opened})`);
  ok(top === 4, `and it is on top, not behind something (got ${top})`);

  // ── defence in depth: a broken optional piece must not stop Profile opening ───────────────────
  await ev(`window.__keepRole = window.SMD_ROLE; window.SMD_ROLE = { labelOf: function () { throw new Error("boom"); }, current: function () { return "doctor"; } }; return 1;`);
  await tapProfileRow();
  ok(await isOpen() === true, "a role module that throws still leaves Profile opening");
  await closeIt(); await sleep(200);
  await ev(`window.SMD_ROLE = window.__keepRole; return 1;`);

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
