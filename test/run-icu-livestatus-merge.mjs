/* BUG (2026-09-07, user report): adding one vital (e.g. Heart Rate) via "Add / update data", then
 * separately adding another (e.g. BP systolic/diastolic), made the FIRST value disappear from the
 * Live Patient Status tiles. Root cause: renderLiveStatus() (and the Hemo tab, Fluids tab, the
 * collapsed vitals summary line, the patient banner, and the import-review "current value"
 * comparison) all read latestVitals() — the single most-recent-TIMESTAMP row — instead of
 * mergedVitals() — the forward-filled newest-non-null-value-per-FIELD across the whole series.
 * A sparse manual entry (ICU.ingestMonitor pushes ONE NEW ROW containing only the fields just
 * typed) is exactly the case mergedVitals exists for (see its own header comment, "R1 C1"), but it
 * was only wired into the alert engine (recompute()) and curMap()/shockIndex() — not into any of
 * the clinician-facing tiles. This test charts HR alone, then BP alone in a SEPARATE call (as the
 * clinician does through two separate "Add / update data" edits), and asserts HR is still shown.
 * USAGE: node test/run-icu-livestatus-merge.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9457, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-livestatus-merge-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8921"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

const clearRoster = `try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`try { localStorage.setItem("smd_icu_groups","0"); } catch(e){} return 1;`);

  // ---- HR entered first, then BP entered SEPARATELY (two distinct ingestMonitor calls, exactly
  // what "Add / update data" → save HR → Add / update data again → save BP does) ----
  const r = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Merge Pt", bed: "7" });
    ICU.ingestMonitor({ hr: 84 });
    ICU.ingestMonitor({ sbp: 128, dbp: 82 });
    ICU.savePatient();
    ICU.open();
    function tile(label) {
      var els = document.querySelectorAll(".icu-vc");
      for (var i = 0; i < els.length; i++) { if (els[i].querySelector(".vl").textContent === label) return els[i].querySelector(".vv").textContent; }
      return null;
    }
    return JSON.stringify({ hr: tile("Heart Rate"), bp: tile("BP") });
  `);
  ok(r.hr != null && r.hr.indexOf("84") !== -1, `Heart Rate tile still shows 84 after a later, separate BP entry (got "${r.hr}")`);
  ok(r.bp != null && r.bp.indexOf("128") !== -1 && r.bp.indexOf("82") !== -1, `BP tile shows the newly entered 128/82 (got "${r.bp}")`);

  console.log(fails === 0 ? "\nALL GREEN — Live Status tiles forward-fill across separate vitals entries" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
