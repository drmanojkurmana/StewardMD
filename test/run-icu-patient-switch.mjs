/* ICU patient-switch safety test (cross-patient contamination — bug C1).
 *
 * The Ward-Sync ingest functions MERGE into live STATE and their contract says "callers
 * reset/select the patient before syncing". Loading a DIFFERENT ward patient (bundle.patientId
 * changed) must therefore start from a clean slate, or the previous patient's weight, infusions,
 * vitals, findings, ABG, etc. bleed onto the new patient (identity + dosing-relevant data mix).
 * This test loads synthetic Patient A via ward, adds weight+infusion+vitals, then loads a
 * DIFFERENT ward Patient B and asserts none of A's data survives. Deterministic. No PHI.
 * USAGE: node test/run-icu-patient-switch.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9418, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-switch-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.ingestFromWard && ICU.ingestInfusion && ICU.ingestMonitor)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  const r = await J(`
    ICU.reset();
    // Load synthetic ward Patient A, then add weight + a pressor + vitals + a finding.
    ICU.ingestFromWard({ patient:{name:"Test-Alpha", age:60, sex:"M"}, patientId:"WARD-A1", source:"Ward Sync", labs:[{test:"Sodium", result:140, units:"mmol/L"}] });
    ICU.ingestPatient({ weightKg:50 });
    ICU.ingestInfusion({ drug:"Noradrenaline", dose:0.1, unit:"mcg/kg/min", rateMlHr:5, source:"manual" });
    ICU.ingestMonitor({ hr:120, sbp:150 });
    var a = ICU.state();
    var alpha = { name:a.patient.name, wt:a.patient.weightKg, inf:(a.infusions||[]).length, hr:(a.vitals||[]).length };
    // Now load a DIFFERENT ward Patient B (as GHIS.loadIntoICU does on patient switch).
    ICU.ingestFromWard({ patient:{name:"Test-Bravo", age:40, sex:"F"}, patientId:"WARD-B2", source:"Ward Sync", labs:[{test:"Sodium", result:130, units:"mmol/L"}] });
    var b = ICU.state();
    return JSON.stringify({
      alpha: alpha,
      bName: b.patient.name,
      bWeight: b.patient.weightKg,          // MUST NOT be Alpha's 50
      bInfusions: (b.infusions||[]).length,  // MUST be 0 (Alpha's pressor gone)
      bVitals: (b.vitals||[]).length,        // MUST be 0 (Alpha's HR gone)
      bNa: b.labs.recent.na                  // MUST be 130 (Bravo's), not 140 (Alpha's)
    });
  `);
  // sanity: Alpha was set up correctly
  ok(r.alpha && r.alpha.name === "Test-Alpha" && r.alpha.wt === 50 && r.alpha.inf === 1 && r.alpha.hr >= 1, `setup: Patient A has weight 50, 1 pressor, vitals (${JSON.stringify(r.alpha)})`);
  // the actual C1 assertions
  ok(r.bName === "Test-Bravo", `switched to Patient B (name = ${r.bName})`);
  ok(r.bWeight == null, `C1: Patient B does NOT inherit Patient A's weight (bWeight=${r.bWeight}, must be null)`);
  ok(r.bInfusions === 0, `C1: Patient B does NOT inherit Patient A's pressor (bInfusions=${r.bInfusions}, must be 0)`);
  ok(r.bVitals === 0, `C1: Patient B does NOT inherit Patient A's vitals (bVitals=${r.bVitals}, must be 0)`);
  ok(r.bNa === 130, `C1: Patient B shows its OWN sodium 130, not Patient A's 140 (bNa=${r.bNa})`);

  // Re-sync of the SAME ward patient must MERGE (not wipe) — new labs land, existing data kept.
  const same = await J(`
    ICU.ingestPatient({ weightKg:62 });
    ICU.ingestFromWard({ patientId:"WARD-B2", source:"Ward Sync", labs:[{test:"Potassium", result:4.2, units:"mmol/L"}] });
    var s = ICU.state();
    return JSON.stringify({ wt:s.patient.weightKg, na:s.labs.recent.na, k:s.labs.recent.k });
  `);
  ok(same.wt === 62 && same.na === 130 && same.k === 4.2, `re-sync of SAME patient merges (weight 62 kept, Na 130 kept, K 4.2 added) — ${JSON.stringify(same)}`);

  console.log(fails === 0 ? "\nALL GREEN — ICU patient-switch contamination test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
