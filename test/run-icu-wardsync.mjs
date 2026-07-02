/* ICU Ward-Sync patient-context sync test (gold124).
 *
 * Proves Ward Sync / imported labs populate the ICU patient context safely:
 *   • mapped electrolytes/renal/CBC land in ICU_STATE.labs.recent,
 *   • the mapping GUARDS hold (Alk Phosphatase ≠ phosphate, BUN ≠ urea, MCH ≠ Hb),
 *   • abnormal electrolytes trigger the deterministic ELYTE alert engine,
 *   • a newer Ward update sets the "new update" flag,
 *   • a clinician's Manual value is NOT overwritten — a conflict is recorded.
 *
 * Exercises ICU.ingestFromWard (client). No engine/privacy/provider change.
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-wardsync.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9372, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-ws-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.ingestFromWard && window.ELYTE)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU.ingestFromWard / ELYTE not loaded");

  // 1) sync a Ward panel that includes the dangerous look-alikes
  const r1 = await ev(`
    ICU.reset && ICU.reset();
    var res = ICU.ingestFromWard({ patientId: "T1", source: "Ward Sync", patient: { name: "Test", weightKg: 70, age: 60, sex: "M" }, labs: [
      { test: "Sodium", result: "128", units: "mmol/L", low: "135", high: "145" },
      { test: "Potassium", result: "6.5", units: "mmol/L", low: "3.5", high: "5.0" },
      { test: "Calcium", result: "1.7", units: "mmol/L", low: "2.1", high: "2.6" },
      { test: "Magnesium", result: "0.5", units: "mmol/L", low: "0.7", high: "1.0" },
      { test: "Phosphate", result: "0.4", units: "mmol/L", low: "0.8", high: "1.5" },
      { test: "Creatinine", result: "180", units: "umol/L", low: "60", high: "110" },
      { test: "Alkaline Phosphatase", result: "240", units: "U/L", low: "40", high: "120" },
      { test: "BLOOD UREA NITROGEN (BUN)", result: "40", units: "mg/dL", low: "7", high: "20" },
      { test: "Mean corpuscular hemoglobin", result: "31", units: "pg", low: "27", high: "33" }
    ]});
    var L = ICU.state().labs.recent;
    return JSON.stringify({ na: L.na, k: L.k, ca: L.ca, mg: L.mg, po4: L.po4, creat: L.creat, urea: L.urea, hb: L.hb, mapped: res.mappedLabs });
  `);
  const L = JSON.parse(r1);
  ok(L.na === 128 && L.k === 6.5 && L.ca === 1.7 && L.mg === 0.5 && L.creat === 180, "electrolytes + renal populate ICU labs (Na/K/Ca/Mg/Creat)");
  ok(L.po4 === 0.4, "phosphate populates from 'Phosphate' (0.4)");
  ok(L.po4 !== 240, "GUARD: 'Alkaline Phosphatase' did NOT overwrite phosphate");
  ok(L.urea == null, "GUARD: 'BUN' did NOT map to urea (different scale)");
  ok(L.hb == null, "GUARD: 'Mean corpuscular hemoglobin' did NOT map to Hb");

  // 2) abnormal K triggers the deterministic ELYTE alert engine
  const r2 = await ev(`
    var res = ELYTE.analyze(ICU.state().labs.recent, { weight: 70, age: 60, sex: "m" }, "si");
    var kAb = res.filter(function(r){ return /potassium|hyperkal/i.test(r.name) && r.level && r.level !== "ok"; }).length;
    var abTotal = res.filter(function(r){ return r.level && r.level !== "ok"; }).length;
    return JSON.stringify({ kAb: kAb, abTotal: abTotal });
  `);
  const A = JSON.parse(r2);
  ok(A.kAb >= 1, "abnormal K⁺ (6.5) flagged by ELYTE correction engine");
  ok(A.abTotal >= 3, "multiple electrolyte abnormalities detected (" + A.abTotal + ")");

  // 3) newer Ward update sets the new-update flag
  const r3 = await ev(`ICU.ingestFromWard({ patientId: "T1", source: "Ward Sync", labs: [{ test: "Potassium", result: "5.8", low: "3.5", high: "5.0" }] }); return JSON.stringify(ICU.wardStatus());`);
  ok(JSON.parse(r3).newUpdate === true, "newer Ward lab update sets 'new update' flag");

  // 4) manual override is preserved — Ward change records a conflict, doesn't overwrite
  const r4 = await ev(`
    ICU.reset && ICU.reset();
    ICU.ingestLabs({ na: 140 }); ICU.state().src.na = { source: "Manual", ts: 1 };
    var res = ICU.ingestFromWard({ patientId: "T2", source: "Ward Sync", labs: [{ test: "Sodium", result: "120", low: "135", high: "145" }] });
    return JSON.stringify({ na: ICU.state().labs.recent.na, conflicts: (ICU.state().conflicts||[]).length });
  `);
  const C = JSON.parse(r4);
  ok(C.na === 140, "manual Na (140) NOT overwritten by Ward Sync (120)");
  ok(C.conflicts >= 1, "Ward-vs-manual conflict recorded for clinician to resolve");

  console.log(fails === 0 ? "\nALL GREEN — ICU Ward-Sync context test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
