/* ICU Settings → Group mode switch used to write smd_icu_groups and location.reload(), restarting
 * the WHOLE app (splash, home, every module) to flip one ICU setting. It now switches in place
 * (grpSetMode): no navigation, every shared-unit listener is torn down going solo, and the live
 * unit subscription comes back going group.
 * USAGE: node test/run-icu-grptoggle.mjs   (CHROME=/path/to/chrome to override)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9456, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-grptoggle-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8921"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.stack||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && window.SMD_ICU_GROUPS)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // Fake signed-in user + fake collab API that counts live listeners.
  await J(`
    window.SMD_AUTH = { currentUser: { uid: "test-uid" } };
    window.__live = 0; window.__subs = 0;
    function sub(cb, val) { window.__live++; window.__subs++; setTimeout(function () { cb(val); }, 20); var done = false; return function () { if (!done) { done = true; window.__live--; } }; }
    window.SMD_ICU_GROUPS = {
      setSeverityFn: function () {}, ensureIdentity: function () {}, setActiveGroup: function () {}, leavePatient: function () {},
      subscribeGroups: function (cb) { return sub(cb, [{ id: "g1", name: "Toggle Test Unit", kind: "icu" }]); },
      subscribePatients: function (gid, cb) { return sub(cb, []); },
      subscribeMembers: function (gid, cb) { return sub(cb, []); }
    };
    localStorage.setItem("smd_icu_groups", "1");
    window.__noReload = "marker";   // a reload wipes window state
    ICU.open();
    return "1";
  `);
  await sleep(600);
  const before = await J(`return JSON.stringify({ live: window.__live, board: (document.getElementById("icuRoot")||{}).textContent.indexOf("Toggle Test Unit") >= 0 })`);
  ok(before.live >= 2, `group mode: shared-unit listeners are live (${before.live})`);

  const tog = `var b = document.querySelector('#icuRoot [data-icu-act="grptoggle"]'); if (!b) return JSON.stringify({ none: true }); b.click(); return "1";`;
  const state = `var b = document.querySelector('#icuRoot [data-icu-act="grptoggle"]');
    return JSON.stringify({ marker: window.__noReload || null, flag: localStorage.getItem("smd_icu_groups"), checked: b ? b.getAttribute("aria-checked") : null,
      open: ICU.isOpen(), live: window.__live, subs: window.__subs, text: (document.getElementById("icuRoot")||{}).textContent || "" });`;

  await J(`document.querySelector('#icuRoot [data-icu-act="icusettings"]').click(); return "1";`);
  await sleep(200);
  const subsBefore = (await J(state)).subs;

  // Group → Solo
  await J(tog); await sleep(500);
  const solo = await J(state);
  ok(solo.marker === "marker", "Group → Solo did NOT reload the app");
  ok(solo.flag === "0", `flag written as solo ("${solo.flag}")`);
  ok(solo.checked === "false", "switch now shows OFF");
  ok(solo.open === true, "ICU stays open on Settings");
  ok(solo.live === 0, `every shared-unit listener torn down in solo (${solo.live} live)`);
  ok(/Solo ICU/.test(solo.text), "settings copy reflects solo");
  ok(!/Reopens the app/.test(solo.text), "no 'Reopens the app' copy");

  // Solo → Group
  await J(tog); await sleep(600);
  const grp = await J(state);
  ok(grp.marker === "marker", "Solo → Group did NOT reload the app");
  ok(grp.flag === "1", `flag written as group ("${grp.flag}")`);
  ok(grp.checked === "true", "switch now shows ON");
  ok(grp.subs > subsBefore && grp.live >= 2, `live unit subscription restarted (${grp.live} live)`);

  // Board shows the shared unit again
  await J(`document.querySelector('#icuRoot [data-icu-act="icuboard"]').click(); return "1";`); await sleep(300);
  const board = await J(state);
  ok(board.text.indexOf("Toggle Test Unit") >= 0, "board shows the shared unit after switching back");

  // Rapid toggling must not leak listeners
  for (let i = 0; i < 6; i++) { await J(`ICU && document.querySelector('#icuRoot [data-icu-act="icusettings"]') && document.querySelector('#icuRoot [data-icu-act="icusettings"]').click(); return "1";`); await J(tog); await sleep(80); }
  await sleep(600);
  const rapid = await J(state);
  ok(rapid.flag === "1" && rapid.live <= 3, `6 rapid toggles end in group with no leaked listeners (${rapid.live} live)`);
} catch (e) { console.log("❌ " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
