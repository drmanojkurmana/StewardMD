/* BUG B8 (2026-08-22 ward-round audit): the board card showed MAP, lactate and SpO2 - never pulse
 * or respiratory rate, even though both are charted on every observation round for every patient.
 * Lactate also always took a slot with a bare "-" even when blank, which is most of the time for a
 * ward patient. Card now shows HR/RR when charted, and only shows LACT when there's a real value.
 * USAGE: node test/run-icu-cardvitals.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9456, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-cardvitals-chrome";
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

  // ---- a patient with vitals charted but NO lactate: card shows HR + RR, no bare "LACT —" tile ----
  const noLact = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Ward Pt", bed: "1" });
    ICU.ingestMonitor({ hr: 96, sbp: 118, dbp: 74, spo2: 97, rr: 18 });
    ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    var tiles = Array.prototype.map.call(card.querySelectorAll(".icu-v2-vk"), function(el){ return el.textContent; });
    return JSON.stringify({ tiles: tiles });
  `);
  ok(noLact.tiles.includes("HR"), `pulse (HR) now appears on the card when charted (${JSON.stringify(noLact.tiles)})`);
  ok(noLact.tiles.includes("RR"), `respiratory rate (RR) now appears on the card when charted (${JSON.stringify(noLact.tiles)})`);
  ok(!noLact.tiles.includes("LACT"), `lactate is NOT shown when it was never charted, freeing the slot (${JSON.stringify(noLact.tiles)})`);
  ok(noLact.tiles.includes("MAP") && noLact.tiles.includes("SpO₂"), `MAP and SpO₂ still always show, unchanged (${JSON.stringify(noLact.tiles)})`);

  // ---- a critically tachypnoeic patient: RR tile is present and flagged critical ----
  const critRR = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Tachypnoeic", bed: "10" });
    ICU.ingestMonitor({ hr: 126, sbp: 100, dbp: 60, spo2: 95, rr: 34 });
    ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    var rr = Array.prototype.filter.call(card.querySelectorAll(".icu-v2-vc"), function(el){ return el.querySelector(".icu-v2-vk").textContent === "RR"; })[0];
    return JSON.stringify({ val: rr.querySelector(".icu-v2-vv").textContent, crit: rr.classList.contains("crit") });
  `);
  ok(critRR.val === "34", `the RR tile shows the actual charted value (${critRR.val})`);
  ok(critRR.crit === true, `RR 34 (>30) renders as critical on the tile — same threshold as the Monitoring tab`);

  // ---- lactate DOES appear, and is styled critical, when it actually has a value ----
  const withLact = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Septic", bed: "3" });
    ICU.ingestMonitor({ hr: 110, sbp: 90, dbp: 55, spo2: 94, lactate: 5.2 });
    ICU.savePatient();
    ICU.open();
    var card = document.querySelector(".icu-v2-card");
    var lact = Array.prototype.filter.call(card.querySelectorAll(".icu-v2-vc"), function(el){ return el.querySelector(".icu-v2-vk").textContent === "LACT"; })[0];
    return JSON.stringify({ present: !!lact, val: lact ? lact.querySelector(".icu-v2-vv").textContent : null, crit: lact ? lact.classList.contains("crit") : false });
  `);
  ok(withLact.present === true, "lactate DOES take a slot when it has a real value");
  ok(withLact.val === "5.2" && withLact.crit === true, `...showing the value and critical styling as before (${JSON.stringify(withLact)})`);

  console.log(fails === 0 ? "\nALL GREEN — B8 (card vitals: pulse + RR added, lactate slot only when charted) fixed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
