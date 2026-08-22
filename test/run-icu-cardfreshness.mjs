/* BUG B7 (2026-08-22 ward-round audit): the board card footer said "Saved" + the age of the last
 * SAVE (an app action), not the age of the actual observation - a board could look entirely green
 * at 4pm because the morning's numbers were saved at 9am and nobody has charted since. The card
 * now shows the age of the newest actual observation (vitals or a lab) when there is one.
 * (The audit's second half - auto-demoting a stale patient to "Not assessed" - changes acuity
 * classification like B2/B3 and is intentionally NOT built here; this is display-only.)
 * USAGE: node test/run-icu-cardfreshness.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8922/").replace(/\/?$/, "/");
const PORT = 9457, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-cardfresh-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8922"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
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

  // ---- vitals charted 6h ago, then re-saved (app-touch) 1 minute ago: footer must say "Vitals 6h
  // ago", NOT "Saved just now" - the app was touched recently, the PATIENT was not observed recently.
  const stale = await J(`
    ${clearRoster}
    var real = Date.now;
    Date.now = function(){ return real() - 6 * 3600000; };   // 6 hours ago
    ICU.reset(); ICU.ingestPatient({ name: "Stale Vitals", bed: "4" });
    ICU.ingestMonitor({ hr: 88, sbp: 120, dbp: 78, spo2: 98 });
    Date.now = real;   // back to "now" - simulates re-saving the SAME record later with no new chart
    ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    return JSON.stringify({ label: card.querySelector(".icu-v2-foot-txt").textContent, ago: card.querySelector(".icu-v2-foot-ago").textContent });
  `);
  ok(stale.label === "Vitals", `footer label is "Vitals" (the observation), not "Saved" (the app action) — got "${stale.label}"`);
  ok(/^6 h ago$/.test(stale.ago), `...and shows the vitals' real age, 6h, not "just now" from the re-save (got "${stale.ago}")`);

  // ---- a fresh admission with NOTHING charted yet: falls back to "Saved just now" — nothing else
  // honest to say for a patient with zero observations.
  const blank = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Just Admitted", bed: "9" }); ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    return JSON.stringify({ label: card.querySelector(".icu-v2-foot-txt").textContent, ago: card.querySelector(".icu-v2-foot-ago").textContent });
  `);
  ok(blank.label === "Saved", `a patient with nothing charted yet still falls back to "Saved" (got "${blank.label}")`);
  ok(blank.ago === "just now", `...at its real save time (got "${blank.ago}")`);

  // ---- a lab result is the newest observation (no vitals at all): still picked up.
  const labOnly = await J(`
    ${clearRoster}
    var real = Date.now;
    Date.now = function(){ return real() - 3 * 3600000; };   // 3 hours ago
    ICU.reset(); ICU.ingestPatient({ name: "Lab Only", bed: "6" });
    ICU.ingestLabs({ k: 4.2 });
    Date.now = real;
    ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    return JSON.stringify({ label: card.querySelector(".icu-v2-foot-txt").textContent, ago: card.querySelector(".icu-v2-foot-ago").textContent });
  `);
  ok(labOnly.label === "Vitals" && /^3 h ago$/.test(labOnly.ago), `a lab-only observation (no vitals charted) is still picked up as freshness (${JSON.stringify(labOnly)})`);

  console.log(fails === 0 ? "\nALL GREEN — B7 (card footer shows observation age, not save age) fixed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
