/* Resume-where-you-left-off test (home.js).
 *
 * iOS terminates a long-backgrounded WebView app; the next launch is a cold start that reloads
 * index.html and lands on Home, losing the screen the user was on. Fix: snapshot the open overlay
 * when the app backgrounds (visibilitychange:hidden / pagehide), and reopen it on the next launch
 * if recent. This drives the real home.js boot path.
 *
 * USAGE: BASE=http://localhost:8960/ node test/run-home-resume.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8960/").replace(/\/?$/, "/");
const PORT = 9380, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/home-resume-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8960"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
async function bootReady() {
  for (let i = 0; i < 40; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open) && document.body.classList.contains("ui-v2");`) === true) return true; }
  return false;
}
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  ok(await bootReady(), "app boots to the v2 home (home.js showV2 ran)");
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_resume_route");}catch(e){} return 1;`);

  // 1) Snapshot on background: open the ICU dashboard, fire pagehide → the open overlay is recorded
  await ev(`ICU.open(); return 1;`); await sleep(500);
  ok(await ev(`return !!document.querySelector('#icuRoot.on');`) === true, "ICU dashboard is open (#icuRoot.on)");
  await ev(`window.dispatchEvent(new Event('pagehide')); return 1;`); await sleep(150);
  const snap = JSON.parse(await ev(`return localStorage.getItem("smd_resume_route")||"null";`));
  ok(snap && snap.act === "icu" && typeof snap.at === "number", "backgrounding records the open overlay (act=icu)");

  // 2) On Home the snapshot is cleared (a plain reload should stay on Home)
  await ev(`ICU.close(); return 1;`); await sleep(300);
  await ev(`window.dispatchEvent(new Event('pagehide')); return 1;`); await sleep(150);
  ok(await ev(`return localStorage.getItem("smd_resume_route");`) === null, "on Home, the snapshot is cleared");

  // 3) Round-trip: with ICU open, a cold reload REOPENS the dashboard (returns where you were)
  await ev(`ICU.open(); return 1;`); await sleep(500);
  await call("Page.navigate", { url: BASE });   // cold reload (pagehide snapshots icu on the way out)
  ok(await bootReady(), "app re-boots after the cold reload");
  let restored = false;
  for (let i = 0; i < 20; i++) { await sleep(400); if (await ev(`return !!document.querySelector('#icuRoot.on');`) === true) { restored = true; break; } }
  ok(restored, "after a cold reload, the ICU dashboard is REOPENED automatically (resumed where you left off)");

  // 3b) EXACT sub-tab restore: on a patient's Treatment tab → cold reload → resumes to that tab, not the board
  await ev(`ICU.reset(); ICU.ingestPatient({name:"RESPT",age:60,sex:"M",bed:"2",diagnosis:"Sepsis"}); ICU.open('treatment'); return 1;`); await sleep(500);
  ok(await ev(`var v=ICU.curView(); return v.screen==="patient" && v.active==="treatment";`) === true, "on the patient · Treatment tab before backgrounding");
  await call("Page.navigate", { url: BASE });
  ok(await bootReady(), "app re-boots (sub-tab case)");
  let subOk = false;
  for (let i = 0; i < 20; i++) { await sleep(400); if (await ev(`var v=(window.ICU&&ICU.curView)?ICU.curView():{}; return v.screen==="patient" && v.active==="treatment";`) === true) { subOk = true; break; } }
  ok(subOk, "after a cold reload, ICU resumes to the EXACT sub-tab (patient · Treatment), not just the board");

  // 4) Stale snapshot (older than the window) is ignored → Home
  await ev(`ICU.close(); try{localStorage.setItem("smd_resume_route", JSON.stringify({act:"icu", at: Date.now() - 13*3600*1000}));}catch(e){} return 1;`);
  await sleep(200);
  await call("Page.navigate", { url: BASE });
  ok(await bootReady(), "app re-boots (stale-snapshot case)");
  await sleep(2500);
  ok(await ev(`return !document.querySelector('#icuRoot.on');`) === true, "a stale snapshot (>12h) is ignored — app stays on Home");

  console.log(fails === 0 ? "\nALL GREEN — home resume test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
