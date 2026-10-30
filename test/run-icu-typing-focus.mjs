/* "On typing the first letter the keyboard closes; tap the box again, type one letter, closed again."
 * Data arriving while a doctor types (a colleague's edit on the shared patient, the task heartbeat, a
 * live snapshot) repainted the whole ICU screen, which replaces the text box being typed in, and iOS
 * drops the keyboard. Passive repaints now wait until the field loses focus (paintPassive).
 * Checks: the round-note composer keeps focus and every typed letter while state changes underneath
 * it, and the deferred repaint lands as soon as the field is left.
 * USAGE: node test/run-icu-typing-focus.mjs   (CHROME=/path/to/chrome to override)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8924/").replace(/\/?$/, "/");
const PORT = 9459, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-typing-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8924"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
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

  await J(`
    window.SMD_AUTH = { currentUser: { uid: "u1", displayName: "Dr A" } }; window.toast = function () {};
    var pt = { id: "p1", name: "Shared Pt", bed: "2", dx: "Sepsis", state: null };
    window.SMD_ICU_GROUPS = {
      setSeverityFn: function () {}, ensureIdentity: function (cb) { cb && cb("SMD-AAAAAA"); }, setActiveGroup: function () {}, leavePatient: function () {}, enterPatient: function () {},
      canInstruct: function () { return true; }, syncState: function () { return "synced"; },
      subscribeGroups: function (cb) { setTimeout(function () { cb([{ id: "g1", name: "Unit", kind: "icu", myRole: "consultant" }]); }, 10); return function () {}; },
      subscribePatients: function (g, cb) { setTimeout(function () { cb([pt]); }, 10); return function () {}; },
      subscribeMembers: function (g, cb) { setTimeout(function () { cb([{ uid: "u1", role: "consultant", name: "Dr A" }]); }, 10); return function () {}; },
      subscribePatient: function (g, id, cb) { setTimeout(function () { cb({ patient: pt, timeline: [], tasks: [] }); }, 10); return function () {}; },
      subscribePresence: function () { return function () {}; }, upsertPatient: function () { return Promise.resolve(); }
    };
    localStorage.setItem("smd_icu_groups", "1"); ICU.open(); return "1";`);
  await sleep(900);
  await J(`document.querySelector("#icuRoot .icu-v2-card").click(); return "1";`); await sleep(800);
  await J(`document.querySelector('#icuRoot .icu-v2-tab[data-icu-act="tab:rounds"]').click(); return "1";`); await sleep(600);
  for (let i = 0; i < 40; i++) {   // the Rounds panel waits for the shared patient's live view-model
    if (await J(`return document.querySelector('#icuRoot [data-icu-act="grpround"]') ? "1" : "0";`) === 1) break;
    await sleep(150);
  }
  await J(`var b = document.querySelector('#icuRoot [data-icu-act="grpround"]'); if (b) b.click(); return b ? "1" : "0";`);
  for (let i = 0; i < 20 && (await J(`return document.querySelector("#icuRoundNote") ? "1" : "0";`)) !== 1; i++) await sleep(150);
  const onRound = await J(`return JSON.stringify({ note: !!document.querySelector("#icuRoundNote") });`);
  ok(onRound.note, "round-note composer is open (#icuRoundNote)");

  // a colleague's edit lands every 250 ms while the doctor types, one letter at a time
  await J(`window.__n = 0; window.__tick = setInterval(function () { ICU.update({ goals: ["MAP > 65 #" + (++window.__n)] }); }, 250); return "1";`);
  await J(`document.querySelector("#icuRoundNote").focus(); return "1";`);
  const word = "Afebrile";
  for (const ch of word) { await call("Input.insertText", { text: ch }); await sleep(180); }
  await sleep(400);
  const typed = await J(`var a = document.activeElement; return JSON.stringify({ id: a && a.id, val: a && a.value, ticks: window.__n });`);
  ok(typed.ticks >= 4, `state changed underneath the typing (${typed.ticks} updates)`);
  ok(typed.id === "icuRoundNote", `the note box keeps focus while data arrives (active: ${typed.id || "none"})`);
  ok(typed.val === word, `every letter landed in the same box ("${typed.val}")`);

  await J(`clearInterval(window.__tick); document.activeElement.blur(); return "1";`); await sleep(300);
  const after = await J(`var n = document.querySelector("#icuRoundNote"); return JSON.stringify({ val: n && n.value, painted: !!document.querySelector("#icuRoot") });`);
  ok(after.val === word, `leaving the box repaints and keeps the note ("${after.val}")`);
  // a held-back repaint lands as soon as a control is tapped, even with the field still focused
  await J(`document.querySelector("#icuRoundNote").focus(); ICU.update({ goals: ["after tap"] }); return "1";`); await sleep(200);
  const held = await J(`return JSON.stringify({ focused: document.activeElement && document.activeElement.id });`);
  ok(held.focused === "icuRoundNote", "a data change while the box is focused does not take the focus");
  await J(`var b = document.querySelector('#icuRoot [data-icu-act^="grproundprio:"]'); if (b) b.click(); return b ? "1" : "0";`); await sleep(300);
  const tapped = await J(`var n = document.querySelector("#icuRoundNote"); return JSON.stringify({ val: n && n.value });`);
  ok(tapped.val === "Afebrile", `tapping a control repaints at once and keeps the note ("${tapped.val}")`);
} catch (e) { console.log("❌ " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
