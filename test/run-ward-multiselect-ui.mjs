/* Ward Sync multi-select (owner 2026-11-22): tick patients or a whole group, then one "Add N to <unit>" adds them all.
 * Single pick mode (Calculators, SURGX, Insulin...) shows Select instead of boxes. Demo hospital, ICU stubbed.
 * USAGE: node test/run-ward-multiselect-ui.mjs   (SHOTS=<dir> also saves screenshots) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8931/").replace(/\/?$/, "/");
const PORT = 9468, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-multi-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
try { await fetch(BASE); } catch { serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8931"])[1]], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let id = 1, ws, sessionId; const pending = new Map();
const call = (m, p) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){${e}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(`return !!(${e})`)) === true) return true; await sleep(200); } return false; };
const shot = async (name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("   shot " + join(SHOTS, name + ".png")); };
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`window.openGHIS && document.getElementById("homeV2")`, 40000), "app loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  ok(await until(`window.GHIS && GHIS.loadDemoHospital && window.SMD_TEST_HOSPITAL`, 20000), "Ward Sync and the demo hospital loaded");
  // Stub the dashboard: record each add, resolve like a real roster write.
  await ev(`window.__added = []; window.ICU = window.ICU || {}; ICU.addWardPatientToRoster = function(o){ window.__added.push(o.patientId); return Promise.resolve(); }; ICU.currentUnitLabel = function(){ return "MICU"; }; return 1;`);
  await ev(`openGHIS(); GHIS.loadDemoHospital(window.SMD_TEST_HOSPITAL); return 1;`);
  ok(await until(`document.querySelectorAll("#ghisPatientList .ghis-row").length >= 20`), "demo ward renders");
  await sleep(800); await ev(`window.__added = []; return 1;`);   // the demo pre-fills its MICU unit through the same call
  ok((await ev(`return document.querySelectorAll("#ghisPatientList input[data-sel-pid]").length;`)) === 0, "the plain list (variant A) has no selection boxes");
  await ev(`document.getElementById("ghisChipSel").click(); return 1;`); await sleep(300);
  ok((await ev(`return document.querySelectorAll("#ghisPatientList input[data-sel-pid]").length;`)) >= 20, "Select puts a selection box on every patient row");
  ok((await ev(`return document.getElementById("ghisChipSel").textContent;`)) === "Done", "the Select chip turns into Done");
  ok((await ev(`return !!document.querySelector("#ghisPatientList .ghis-grp-sel[data-gi='0']");`)) === true, "each group has Select all");
  ok((await ev(`var b=document.getElementById("ghisSelBar"); return !b || b.hidden;`)) === true, "no bar before anything is ticked");
  // Tick one row
  await ev(`var i=document.querySelector("#ghisPatientList input[data-sel-pid]"); i.click(); return 1;`); await sleep(200);
  ok(/1\s*selected/.test(String(await ev(`return document.getElementById("ghisSelBar").innerText;`))), "ticking a row shows '1 selected'");
  // Select a whole group (department)
  await ev(`document.querySelector("#ghisPatientList .ghis-grp-sel[data-gi='0']").click(); return 1;`); await sleep(200);
  const n0 = await ev(`return document.querySelectorAll("#ghisPatientList .ghis-grp")[0].querySelectorAll("input[data-sel-pid]").length;`);
  const barTxt = String(await ev(`return document.getElementById("ghisSelBar").innerText;`));
  ok(new RegExp(n0 + "\\s*selected").test(barTxt) && /Add \d+ to MICU/.test(barTxt), `Select all ticks the whole group (${barTxt.replace(/\s+/g, " ")})`);
  ok((await ev(`return document.querySelector("#ghisPatientList .ghis-grp-sel[data-gi='0']").textContent;`)) === "Clear", "the group button turns into Clear");
  await shot("1-multiselect");
  // Add them
  await ev(`document.querySelector("#ghisSelBar .ghis-seladd").click(); return 1;`);
  ok(await until(`window.__added.length === ${n0}`, 15000), `Add adds every selected patient (${n0})`);
  await sleep(500);
  ok((await ev(`var b=document.getElementById("ghisSelBar"); return !b || b.hidden;`)) === true, "the bar goes away after adding");
  ok((await ev(`return document.querySelectorAll("#ghisPatientList .ghis-grp")[0].querySelectorAll(".ghis-inunit").length;`)) === n0, "added patients show 'In unit'");
  await shot("2-added");
  // ICU's "Add patients from Ward Sync" opens straight into Select mode
  await ev(`GHIS.toggleSelMode(false); GHIS.openForAdd(); return 1;`); await sleep(300);
  ok((await ev(`return document.querySelectorAll("#ghisPatientList input[data-sel-pid]").length;`)) > 0, "openForAdd starts in Select mode");
  // Single pick mode: Select buttons, no boxes, no bar
  await ev(`GHIS.pickPatient(function(sel){ window.__picked = sel; }); return 1;`); await sleep(500);
  ok((await ev(`return document.querySelectorAll("#ghisPatientList input[data-sel-pid]").length;`)) === 0, "pick mode hides the selection boxes");
  ok((await ev(`return document.querySelectorAll("#ghisPatientList .ghis-pt-select").length;`)) >= 20, "pick mode shows Select on every patient");
  await ev(`document.querySelector("#ghisPatientList .ghis-pt-select").click(); return 1;`); await sleep(300);
  ok(!!(await ev(`return window.__picked && window.__picked.patientId;`)), "Select hands the patient to the caller");
  // Cancel callback
  await ev(`window.__cancelled = 0; openGHIS(); GHIS.pickPatient(function(){}, { onCancel: function(){ window.__cancelled++; } }); return 1;`); await sleep(300);
  await ev(`closeGHIS(); return 1;`);
  ok((await ev(`return window.__cancelled;`)) === 1, "closing Ward Sync without Select runs the caller's cancel");
  console.log(fails === 0 ? "\nALL GREEN: Ward Sync multi-select and pick" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
