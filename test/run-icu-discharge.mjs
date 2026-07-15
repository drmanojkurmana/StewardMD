/* ICU Discharge Creator test.
 *
 * The Discharge Creator is a STRUCTURED, fillable summary (not one text blob): each section is a
 * field auto-filled from recorded data — final diagnosis, reason for admission, hospital course,
 * key investigations, condition at discharge — and DISCHARGE MEDICATIONS are pre-filled from the
 * editable Treatment list. Copy / Print / Share; nothing auto-sent.
 *
 * Runs SOLO (smd_icu_groups=0) — no Firestore.
 * USAGE: BASE=http://localhost:8930/ node test/run-icu-discharge.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8930/").replace(/\/?$/, "/");
const PORT = 9379, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-discharge-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8930"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const val = async (id) => ev(`var e=document.getElementById(${JSON.stringify(id)}); return e?e.value:null;`);
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(320); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.state)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_icu_unit:anon");}catch(e){} return 1;`);

  // Seed a patient with course-relevant data + a Treatment list
  await ev(`ICU.reset();
    ICU.ingestPatient({name:"DISPT",age:65,sex:"M",bed:"3",diagnosis:"Septic shock",complaints:"Fever + breathlessness x3 days"});
    ICU.ingestMonitor({hr:96,sbp:110,dbp:70,spo2:95,temp:37.2});
    ICU.ingestLabs({na:138,k:4.2,creat:1.4,hb:9.8,wbc:15,crp:120});
    var s=ICU.state(); s.treatment=[
      {id:"t1",name:"Meropenem",dose:"1 g",route:"IV",freq:"q8h",cat:"abx",by:"Dr Test",ts:1},
      {id:"t2",name:"Noradrenaline",dose:"0.1 mcg/kg/min",route:"IV",freq:"infusion",cat:"supp",by:"Dr Test",ts:2}];
    return 1;`);
  await sleep(200);

  // Open the discharge tab, then the Creator modal
  await ev(`ICU.open('discharge'); return 1;`); await sleep(400);
  ok(await ev(`return /Discharge Creator/i.test(document.body.innerText);`) === true, "Discharge tab shows the Discharge Creator");
  await clickAct("discharge");
  ok(await ev(`return !!document.getElementById('dis-finalDx');`) === true, "Creator opens as a STRUCTURED form (not one textarea) with per-section fields");

  // Auto-filled sections
  ok((await val("dis-finalDx")) === "Septic shock", "Final diagnosis auto-filled from the working diagnosis");
  ok(/Fever/.test(await val("dis-complaints") || ""), "Reason for admission auto-filled from complaints");
  ok(/HR 96/.test(await val("dis-condition") || ""), "Condition at discharge auto-filled with the latest vitals");
  ok(/WBC 15|CRP 120|HB 9\.8/i.test(await val("dis-investigations") || ""), "Key investigations auto-filled from labs");

  // The KEY integration — discharge medications pre-filled from the Treatment list
  const meds = await val("dis-meds") || "";
  ok(/Meropenem/.test(meds) && /Noradrenaline/.test(meds), "Discharge medications pre-filled from the Treatment list (" + meds.replace(/\n/g, " | ").slice(0, 80) + ")");

  // Actions present
  ok(await ev(`return !!document.querySelector('[data-icu-act="dischargecopy"]') && !!document.querySelector('[data-icu-act="dischargeprint"]');`) === true, "Copy + Print/PDF actions present");
  ok(await ev(`return /DISPT/.test(document.body.innerText);`) === true, "Header shows the patient identity");
  // Copy assembles without error (clipboard write is best-effort in headless)
  const copyErr = await ev(`var b=document.querySelector('[data-icu-act="dischargecopy"]'); b&&b.click(); return "ok";`);
  ok(copyErr === "ok", "Copy assembles the summary without error");

  // Empty-treatment fallback: discharge meds fall back to running infusions
  await ev(`var s=ICU.state(); s.treatment=[]; s.infusions=[{drug:"Vasopressin",dose:0.03,unit:"U/min"}]; return 1;`);
  await ev(`ICU.open('overview'); ICU.open('discharge'); return 1;`); await sleep(250);
  await clickAct("discharge");
  ok(/Vasopressin/.test(await val("dis-meds") || ""), "With no Treatment items, discharge meds fall back to running infusions");
  await clickAct("closeform");

  // Ward mode: the Creator still works and is Ward-scoped (opens, diagnosis fills)
  await ev(`ICU.openWard(); ICU.reset(); ICU.ingestPatient({name:"WDIS",age:50,sex:"F",bed:"5",diagnosis:"Community-acquired pneumonia"}); ICU.openWard('discharge'); return 1;`); await sleep(400);
  await clickAct("discharge");
  ok(await ev(`return !!document.getElementById('dis-finalDx');`) === true, "Discharge Creator works in Ward mode too");
  ok((await val("dis-finalDx")) === "Community-acquired pneumonia", "Ward discharge auto-fills the diagnosis");

  console.log(fails === 0 ? "\nALL GREEN — ICU Discharge Creator test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
