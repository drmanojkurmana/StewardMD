/* ICU/Ward unit navigation test.
 *
 * After selecting a hospital the dashboard shows two categories — ICU (ICU/MICU/SICU/PICU/CCU) and
 * Ward (Male Ward/Female Ward). Selecting an ICU unit opens the ICU dashboard; a Ward opens the
 * Ward dashboard. ICU and Ward are kept COMPLETELY separate (navigation + per-unit patient lists),
 * and the default ICU unit stays on the LEGACY roster key (backward compatibility).
 *
 * Runs SOLO (smd_icu_groups=0) — no Firestore.
 * USAGE: BASE=http://localhost:8924/ node test/run-icu-units.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8924/").replace(/\/?$/, "/");
const PORT = 9378, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-units-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8924"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const has = async (act) => ev(`return !!document.querySelector('[data-icu-act="${act}"]');`);
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(320); };
const subOf = async () => JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-subnav .icu-seg'), function(x){return x.textContent;}));`));
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.openUnits && ICU.curUnit)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_icu_v2");localStorage.removeItem("smd_icu_unit:anon");}catch(e){} return 1;`);

  // Open the unit picker → hospital step first (no hospital chosen yet)
  await ev(`ICU.openUnits(); return 1;`); await sleep(500);
  ok(await has("unithosp:GIMSR"), "unit picker opens on the hospital step (GIMSR selectable)");

  // Pick hospital → category step shows the two top-level categories
  await clickAct("unithosp:GIMSR");
  ok(await has("unitcat:icu") && await has("unitcat:ward"), "after selecting a hospital, two categories are shown: ICU + Ward");

  // ICU category → the 5 ICU unit types
  await clickAct("unitcat:icu");
  const icuTypes = ["ICU", "MICU", "SICU", "PICU", "CCU"];
  let allIcu = true; for (const tp of icuTypes) if (!(await has("unitsel:icu:" + encodeURIComponent(tp)))) allIcu = false;
  ok(allIcu, "ICU contains ICU / MICU / SICU / PICU / CCU");

  // back → Ward category → the 2 ward types
  await clickAct("unitback");
  await clickAct("unitcat:ward");
  ok(await has("unitsel:ward:" + encodeURIComponent("Male Ward")) && await has("unitsel:ward:" + encodeURIComponent("Female Ward")), "Ward contains Male Ward + Female Ward");

  // Select an ICU unit (MICU) → ICU dashboard
  await ev(`ICU.openUnits(); return 1;`); await sleep(250);
  await clickAct("unitcat:icu");
  await clickAct("unitsel:icu:MICU");
  ok(await ev(`return ICU.isWard()===false;`) === true, "selecting an ICU unit opens the ICU dashboard (not ward)");
  const cuMicu = JSON.parse(await ev(`return JSON.stringify(ICU.curUnit());`));
  ok(cuMicu.cat === "icu" && cuMicu.type === "MICU", "current unit = ICU / MICU (" + JSON.stringify(cuMicu) + ")");
  ok(await ev(`return /MICU/.test((document.querySelector('.icu-v2-usub')||{}).textContent||"");`) === true, "board shows the selected unit (MICU)");

  // Add a patient in MICU, then switch to SICU — must NOT see the MICU patient (separate lists)
  await ev(`ICU.reset(); ICU.ingestPatient({name:"MICUPT",age:60,sex:"M",bed:"1",diagnosis:"Sepsis"}); return 1;`);
  await ev(`ICU.openUnits(); return 1;`); await sleep(250);
  await clickAct("unitcat:icu");
  await clickAct("unitsel:icu:SICU");
  ok(await ev(`return !/MICUPT/.test(document.body.innerText);`) === true, "SICU patient list does NOT show the MICU patient (units kept separate)");
  // back to MICU — the patient is still there
  await ev(`ICU.openUnits(); return 1;`); await sleep(200);
  await clickAct("unitcat:icu");
  await clickAct("unitsel:icu:MICU");
  ok(await ev(`return /MICUPT/.test(document.body.innerText);`) === true, "returning to MICU shows the MICU patient again");

  // Select a Ward → ward dashboard, ventilator hidden
  await ev(`ICU.openUnits(); return 1;`); await sleep(250);
  await clickAct("unitcat:ward");
  await clickAct("unitsel:ward:" + encodeURIComponent("Male Ward"));
  ok(await ev(`return ICU.isWard()===true;`) === true, "selecting a Ward opens the Ward dashboard");
  const cuWard = JSON.parse(await ev(`return JSON.stringify(ICU.curUnit());`));
  ok(cuWard.cat === "ward" && cuWard.type === "Male Ward", "current unit = Ward / Male Ward (" + JSON.stringify(cuWard) + ")");
  await ev(`ICU.ingestPatient({name:"WARDPT",age:40,sex:"F",bed:"2",diagnosis:"CAP"}); ICU.openWard('overview'); return 1;`); await sleep(300);
  await clickAct("ws:monitoring");
  const wardMon = await subOf();
  ok(wardMon.indexOf("Vent") < 0, "ward Monitoring hides the ventilator tab (" + wardMon.join(",") + ")");

  // Ward patient must NOT appear on the ICU (MICU) board — full separation
  await ev(`ICU.open(); return 1;`); await sleep(300);   // ICU category (last ICU unit = MICU)
  ok(await ev(`return /MICUPT/.test(document.body.innerText) && !/WARDPT/.test(document.body.innerText);`) === true, "ICU board shows MICU patient, NOT the ward patient");

  // Backward compatibility: the DEFAULT ICU unit stays on the LEGACY (unsuffixed) roster key
  await ev(`ICU.openUnits(); return 1;`); await sleep(200);
  await clickAct("unitcat:icu");
  await clickAct("unitsel:icu:ICU");
  await ev(`ICU.reset(); ICU.ingestPatient({name:"LEGACYPT",age:55,sex:"M",bed:"3",diagnosis:"DKA"}); return 1;`); await sleep(200);
  const legacyKey = await ev(`return !!localStorage.getItem("stewardmd_icu_state:anon");`);
  const noSuffixDefault = JSON.parse(await ev(`return JSON.stringify(ICU.curUnit());`));
  ok(noSuffixDefault.cat === "icu" && noSuffixDefault.type === "ICU", "default ICU unit = icu / ICU");
  ok(legacyKey === true, "default ICU unit persists to the LEGACY buffer key (backward compatible)");

  console.log(fails === 0 ? "\nALL GREEN — ICU/Ward unit navigation test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
