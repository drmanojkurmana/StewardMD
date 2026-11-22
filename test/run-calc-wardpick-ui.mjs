/* Calculators "Fill from patient" -> Ward Sync pick mode (owner 2026-11-21): the real Ward Sync screen opens with a
 * Select button on every patient; Select closes Ward Sync and fills the calculator from that patient.
 * Uses Ward Sync's own demo hospital (GHIS.loadDemoHospital), so the real patient-list code runs.
 * USAGE: node test/run-calc-wardpick-ui.mjs   (SHOTS=<dir> also saves screenshots) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8929/").replace(/\/?$/, "/");
const PORT = 9466, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/calc-wardpick-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
try { await fetch(BASE); } catch { serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8929"])[1]], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let id = 1, ws, sessionId; const pending = new Map();
const call = (m, p) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){${e}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const until = async (e, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(`return !!(${e})`)) === true) return true; await sleep(200); } return false; };
const shot = async (name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("   shot " + join(SHOTS, name + ".png")); };
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`window.MEDCALC && document.getElementById("homeV2")`, 40000), "app loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  // Ward Sync is lazy loaded: load it through its own entry, then switch to its demo hospital.
  await ev(`try { window.openGHIS ? 0 : (window.SMD_loadGHIS && SMD_loadGHIS()); } catch (e) {} return 1;`);
  ok(await until(`window.GHIS && GHIS.loadDemoHospital && window.closeGHIS`, 20000), "Ward Sync loaded");
  await ev(`GHIS.loadDemoHospital({ branches: [{ dept: "Test Ward", patients: [{ patientId: "P1", episodeId: "E1", name: "Ward Test", gender: "Male", bed: "4", doctor: "Rao", age: 72, labs: [] }] }] }); closeGHIS(); return 1;`);
  await sleep(500);
  await ev(`MEDCALC.open("oakland_lgib"); return 1;`);
  ok(await until(`document.getElementById("mcAuto_oakland_lgib")`), "calculator open");
  await ev(`document.getElementById("mcAuto_oakland_lgib").click(); return 1;`);
  ok(await until(`document.getElementById("ghisPanel") && document.getElementById("ghisPanel").classList.contains("open")`), "Fill from patient opens Ward Sync");
  ok(await until(`document.querySelector("#ghisPatientList .ghis-pick-banner")`), "Ward Sync shows the select-a-patient banner");
  ok(await until(`document.querySelector("#ghisPatientList .ghis-pt-select") && document.querySelector("#ghisPatientList .ghis-pt-select").offsetParent`), "every patient has a visible Select button");
  await sleep(400); await shot("1-wardsync-pick");
  await ev(`document.querySelector("#ghisPatientList .ghis-pt-select").click(); return 1;`);
  ok(await until(`!document.getElementById("ghisPanel").classList.contains("open")`), "Select closes Ward Sync");
  await sleep(800);
  const v = await ev(`return ["age","sex"].map(function(k){ var e=document.getElementById("mc_oakland_lgib_"+k); return e?e.value:""; }).join("|");`);
  ok(v === "72|M", `the selected patient fills the calculator (age|sex = ${v})`);
  ok(/Ward Sync/.test(String(await ev(`var n=document.getElementById("mcAFnote_oakland_lgib"); return n?n.textContent:"";`))), "the note names Ward Sync as the source");
  ok((await ev(`return GHIS.isPicking();`)) === false, "pick mode ends after Select");
  await shot("2-calc-filled");
  // Closing Ward Sync without choosing cancels the pick.
  await ev(`document.getElementById("mcAuto_oakland_lgib").click(); return 1;`); await sleep(400);
  await ev(`closeGHIS(); return 1;`);
  ok((await ev(`return GHIS.isPicking();`)) === false, "closing Ward Sync without Select cancels the pick");
  // Owner 2026-11-23: MELD-Na filled "0 of 5" though the patient had LFT, electrolytes and INR (fields had no lab tag).
  await ev(`GHIS.loadDemoHospital(window.SMD_TEST_HOSPITAL); closeGHIS(); MEDCALC.open("meld_na"); return 1;`);
  ok(await until(`document.getElementById("mcAuto_meld_na")`), "MELD-Na open");
  await ev(`document.getElementById("mcAuto_meld_na").click(); return 1;`);
  ok(await until(`document.querySelector("#ghisPatientList .ghis-pt-select")`), "MELD-Na Fill opens Ward Sync");
  await ev(`var b=[].slice.call(document.querySelectorAll("#ghisPatientList .ghis-row")).filter(function(r){return /Ravi Kumar/.test(r.textContent);})[0]; b.querySelector(".ghis-pt-select").click(); return 1;`);
  ok(await until(`/Filled 4 of 5/.test((document.getElementById("mcAFnote_meld_na")||{}).textContent||"")`, 15000), "MELD-Na fills bilirubin, INR, creatinine and sodium");
  const mv = await ev(`return ["bili","inr","creat","na"].map(function(k){ return document.getElementById("mc_meld_na_"+k).value; }).join("|");`);
  ok(/^8\.4\|2\.4\|/.test(mv), `MELD-Na takes the newest bilirubin and INR (${mv})`);
  ok(/\d/.test(String(await ev(`return (document.getElementById("mcScore_meld_na")||{}).textContent||"";`))), "MELD-Na calculates a score");
  await shot("3-meld-filled");
  // Any EMR (owner 2026-11-23): a FHIR Connect hospital's Select returns the patient and its Observations fill the calculator.
  await ev(`window.SMD_CONNECT = Object.assign({}, window.SMD_CONNECT || {}, {
    connections: function(){ return Promise.resolve([{ connectionId: "c1" }]); },
    worklist: function(){ return Promise.resolve({ rows: [{ patientId: "F1", episodeId: "F1", patientFirstName: "Fhir Patient", gender: "female", bedName: "9", employeeFirstName: "Rao", deptDescription: "Hepatology", dob: "55" }] }); },
    pullContext: function(){ return Promise.resolve({ ok: true, bundle: { observations: [
      { category: "laboratory", code: { text: "Bilirubin, Total" }, value: { value: 3.0, unit: "mg/dL" }, effectiveDateTime: "2026-11-20T08:00:00Z" },
      { category: "laboratory", code: { text: "Bilirubin, Total" }, value: { value: 4.1, unit: "mg/dL" }, effectiveDateTime: "2026-11-22T08:00:00Z" },
      { category: "laboratory", code: { text: "INR" }, value: { value: 1.6, unit: "" }, effectiveDateTime: "2026-11-22T08:00:00Z" },
      { category: "laboratory", code: { text: "Creatinine" }, value: { value: 1.1, unit: "mg/dL" }, effectiveDateTime: "2026-11-22T08:00:00Z" },
      { category: "laboratory", code: { text: "Sodium" }, value: { value: 131, unit: "mmol/L" }, effectiveDateTime: "2026-11-22T08:00:00Z" } ] } }); }
  }); MEDCALC.open("meld_na"); return 1;`);
  await sleep(300);
  await ev(`document.getElementById("mcAuto_meld_na").click(); return 1;`); await sleep(500);
  await ev(`ghisLoadConnectRoster("t1", "FHIR Test Hospital"); return 1;`);
  ok(await until(`document.querySelector("#ghisPatientList .ghis-pt-select")`), "FHIR hospital roster shows Select");
  await ev(`document.querySelector("#ghisPatientList .ghis-pt-select").click(); return 1;`);
  ok(await until(`/Filled 4 of 5/.test((document.getElementById("mcAFnote_meld_na")||{}).textContent||"")`, 15000), "FHIR hospital: MELD-Na fills 4 of 5 from Observations");
  const fv = await ev(`return ["bili","inr","creat","na"].map(function(k){ return document.getElementById("mc_meld_na_"+k).value; }).join("|");`);
  ok(fv === "4.1|1.6|1.1|131", `FHIR hospital: newest values used (${fv})`);
  console.log(fails === 0 ? "\nALL GREEN: Fill from patient picks the patient in Ward Sync" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
