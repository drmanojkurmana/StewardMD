/* ICU Guided Clinical Workflow — Slice 1: unified clinical context + Deep Review packet.
 *
 * Proves the unified context builder (SINGLE reusable service) folds the structured finding chips
 * and latest vitals into the Deep-Review context + packet + cache hash — so Deep Clinical Review
 * reasons over the FULL picture (findings + labs + imaging + vitals + working dx), not just imaging
 * + labs. Deterministic/local only (no AI call). Flag smd_icu_dxflow (default ON) + ?icudxflow=0.
 *
 * Does NOT change deterministic scoring, MaiK, Ward Sync auth, patient ownership, or unrelated UI.
 * USAGE: node test/run-icu-dxflow.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9395, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-dxflow-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU._buildClinicalContext && ICU._buildCorrelationPacket && ICU.dxFlowOn)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU dx-flow API not loaded");
  await ev(`["smdBootSplash","introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // helper: seed a patient with findings (incl. a negated one) + vitals + a working dx
  const seed = `
    ICU.reset();
    ICU.ingestPatient({name:"Johnny Testpatient",age:60,sex:"M",bed:"ICU-7",complaints:"altered sensorium",diagnosis:"Ischaemic stroke"});
    ICU._addFindingChip({canonicalFindingId:"alteredSensorium",displayLabel:"Altered sensorium / mental status",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"focalNeuroDeficit",displayLabel:"Quadriparesis",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"fever",displayLabel:"Fever",polarity:"absent",inReasoning:true},"manual_picker");
    ICU.update({vitals:[{ts:1,sbp:180,dbp:100,hr:120,spo2:88,temp:37.0}]});
  `;

  // 1) flag default ON
  ok(await ev(`return ICU.dxFlowOn()===true;`) === true, "smd_icu_dxflow default ON");

  // 2) unified context builder folds in structured findings (polarity/temporality preserved)
  const c2 = await J(seed + `var ctx=ICU._buildClinicalContext(); return JSON.stringify({ n:ctx.findings.length, fever:(ctx.findings.filter(function(f){return f.id==="fever";})[0]||{}).polarity, hasAltered: ctx.findings.some(function(f){return f.id==="alteredSensorium";}) });`);
  ok(c2.n === 3 && c2.hasAltered && c2.fever === "absent", `context includes structured findings (${c2.n}); negation preserved (fever=${c2.fever})`);

  // 3) latest vitals folded in
  const c3 = await J(`var ctx=ICU._buildClinicalContext(); return JSON.stringify(ctx.vitals);`);
  ok(Array.isArray(c3) && c3.some(v => /BP 180\/100/.test(v)) && c3.some(v => /SpO₂ 88%|SpO2 88%/.test(v)), `latest vitals folded in (${(c3 || []).join(", ")})`);

  // 4) Deep Review PACKET carries findings (with polarity) + vitals
  const c4 = await J(`var pkt=ICU._buildCorrelationPacket(ICU._buildClinicalContext()); return JSON.stringify({ hasFindings:!!(pkt.findings&&pkt.findings.length), feverPol:(( pkt.findings||[]).filter(function(f){return /fever/i.test(f.finding);})[0]||{}).polarity, hasVitals:!!(pkt.vitals&&pkt.vitals.length) });`);
  ok(c4.hasFindings && c4.feverPol === "absent" && c4.hasVitals, `packet carries findings (fever polarity=${c4.feverPol}) + vitals`);

  // 5) packet contains NO patient identifiers (name / bed), age is a band
  const c5 = await J(`var s=JSON.stringify(ICU._buildCorrelationPacket(ICU._buildClinicalContext())); return JSON.stringify({ hasName:/Johnny|Testpatient/.test(s), hasBed:/ICU-7/.test(s), band:ICU._buildCorrelationPacket(ICU._buildClinicalContext()).patientContext.ageBand });`);
  ok(!c5.hasName && !c5.hasBed && c5.band === "60-69", `de-identified packet — no name/bed; age band=${c5.band}`);

  // 6) cache hash STABLE when context unchanged (test 11)
  const c6 = await J(`var h1=ICU._correlationHash(ICU._buildClinicalContext()), h2=ICU._correlationHash(ICU._buildClinicalContext()); return JSON.stringify({eq:h1===h2});`);
  ok(c6.eq === true, "cache hash stable when context unchanged (cache reuse)");

  // 7) cache hash INVALIDATES when a structured finding changes (test 12)
  const c7 = await J(`var h1=ICU._correlationHash(ICU._buildClinicalContext()); ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker"); var h2=ICU._correlationHash(ICU._buildClinicalContext()); return JSON.stringify({changed:h1!==h2});`);
  ok(c7.changed === true, "cache hash invalidates when a finding changes");

  // 8) cache hash INVALIDATES when a vital changes, and when the working dx changes
  const c8 = await J(`var h1=ICU._correlationHash(ICU._buildClinicalContext()); ICU.update({vitals:[{ts:2,sbp:90,dbp:60,hr:130}]}); var h2=ICU._correlationHash(ICU._buildClinicalContext()); ICU.state().patient.diagnosis="Intracerebral haemorrhage"; var h3=ICU._correlationHash(ICU._buildClinicalContext()); return JSON.stringify({vitalChanged:h1!==h2, dxChanged:h2!==h3});`);
  ok(c8.vitalChanged && c8.dxChanged, "cache hash invalidates on vital change + working-dx change");

  // 9) findings-only context is enough to build a packet (symptom-only review path)
  const c9 = await J(`ICU.reset(); ICU.ingestPatient({name:"F",age:40,sex:"F"}); ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker"); var ctx=ICU._buildClinicalContext(); var pkt=ICU._buildCorrelationPacket(ctx); return JSON.stringify({ img:ctx.img.length, labs:ctx.labs.length, findings:(pkt.findings||[]).length });`);
  ok(c9.img === 0 && c9.labs === 0 && c9.findings === 1, `symptom-only context builds a packet (findings=${c9.findings}, no imaging/labs)`);

  // 10) kill-switch: ?icudxflow / localStorage OFF → findings + vitals omitted (reverts to imaging+labs)
  const c10 = await J(seed + `try{localStorage.setItem("smd_icu_dxflow","0");}catch(e){} var ctx=ICU._buildClinicalContext(); var pkt=ICU._buildCorrelationPacket(ctx); var r={ on:ICU.dxFlowOn(), findings:ctx.findings.length, vitals:ctx.vitals.length, pktFindings:!!pkt.findings, pktVitals:!!pkt.vitals }; try{localStorage.removeItem("smd_icu_dxflow");}catch(e){} return JSON.stringify(r);`);
  ok(c10.on === false && c10.findings === 0 && c10.vitals === 0 && !c10.pktFindings && !c10.pktVitals, "kill-switch OFF → findings/vitals omitted (reverts to imaging+labs only)");

  // 11) existing imaging correlation still works: quick correlation runs on imaging+labs (deterministic)
  const c11 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"IMG",age:55,sex:"M"});
    ICU.ingestImaging({studyName:"CT abdomen", impressionRaw:"Acute pancreatitis with peripancreatic fat stranding and ascites", modality:"CT"});
    ICU.ingestLabs({plt:80});
    var q=ICU._runQuickCorrelation();
    return JSON.stringify({ hasEv:(q.ev.img.length+q.ev.labs.length)>0, status:q.status });
  `);
  ok(c11.hasEv && !!c11.status, `imaging correlation still works (evidence gathered, status="${c11.status}")`);

  // 12) documentation-only reaffirmed: buildClinicalContext does not mutate the deterministic engine
  const c12 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"P",age:70,sex:"M"});
    var before = window.SMD_REASON && SMD_REASON.assess ? SMD_REASON.assess({headache:true}).infectious.length : -1;
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker"); ICU._buildClinicalContext();
    var after = window.SMD_REASON && SMD_REASON.assess ? SMD_REASON.assess({headache:true}).infectious.length : -1;
    return JSON.stringify({eq:before===after && before>=0});
  `);
  ok(c12.eq === true, "building the context does not perturb the deterministic engine");

  console.log(fails === 0 ? "\nALL GREEN — ICU dx-flow Slice 1 passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
