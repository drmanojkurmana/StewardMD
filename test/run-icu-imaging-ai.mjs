/* ICU AI Imaging Assist test (Phase 2).
 *
 * Proves: the clinician chooses AI-summary OR deterministic-extract per report; the AI packet is
 * strictly DE-IDENTIFIED (no name/MRN/bed; report text PHI-redacted; age BAND not DOB); the
 * deterministic extract works fully offline (impression + modality correlations + the ALWAYS-
 * deterministic critical flag); the rendered result carries the "Draft — advisory, not a
 * diagnosis" framing + a Source line; and AI-off falls back gracefully. The live /api/ai/imaging
 * call is PROD-only, so the AI path is exercised with a stubbed SMD_AI.imagingSummary.
 *
 * No reasoning/antibiotic engine touched. USAGE: BASE=http://localhost:8902/ node test/run-icu-imaging-ai.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9382, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-imaging-ai-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
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
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.ingestWardImaging && ICU._buildImagingAiPacket && ICU._imagingDeterministic)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU + imaging-AI API not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) DE-IDENTIFICATION — packet excludes identifiers; report text is PHI-redacted; age is a BAND
  const P = JSON.parse(await ev(`
    ICU.reset();
    ICU.ingestPatient({name:"Rajesh Kumar", age:63, sex:"M", bed:"ICU-7", diagnosis:"?pancreatitis", complaints:"epigastric pain"});
    ICU.ingestWardImaging({ patientId:"PX", source:"Ward Sync", imaging:[{reportId:"Z1",description:"CECT Abdomen",
      report:"Name: Rajesh Kumar\\nMRN: 998877\\nIMPRESSION: acute interstitial pancreatitis."}] });
    var rec = ICU.state().imaging[0];
    var pkt = ICU._buildImagingAiPacket(rec);
    return JSON.stringify({ keys: Object.keys(pkt).sort(), band: pkt.ageBand, json: JSON.stringify(pkt) });`));
  const forbiddenKey = ["name", "mrn", "bed", "dob", "phone", "address"].some(k => P.keys.indexOf(k) >= 0);
  ok(!forbiddenKey, "AI packet has NO identifier keys (name/MRN/bed/dob/phone/address)");
  ok(P.band === "60-69" && P.json.indexOf('"age":63') < 0, "age sent as a BAND (60-69), not the exact age/DOB");
  ok(P.json.indexOf("Rajesh Kumar") < 0 && P.json.indexOf("998877") < 0 && P.json.indexOf("ICU-7") < 0, "name / MRN / bed never appear anywhere in the AI packet (report text PHI-redacted)");
  ok(/acute interstitial pancreatitis/i.test(P.json), "clinical report content IS included (impression preserved after redaction)");

  // 2) DETERMINISTIC EXTRACT — offline; impression + correlations + always-deterministic red flags
  const D = JSON.parse(await ev(`
    var pancr = ICU._imagingDeterministic({impressionRaw:"Acute interstitial pancreatitis.", studyName:"CECT Abdomen", critical:[]});
    var bleed = ICU._imagingDeterministic({impressionRaw:"Acute intracerebral haemorrhage with mass effect.", critical:["Intracranial haemorrhage","Midline shift / mass effect"]});
    var sparse = ICU._imagingDeterministic({impressionRaw:"", findingsRaw:"", reportRaw:"", critical:[]});
    return JSON.stringify({
      pancrCorr: pancr.correlateWith, pancrSum: pancr.summary,
      bleedFlags: bleed.redFlags, bleedCorr: bleed.correlateWith,
      sparseSum: sparse.summary });`));
  ok(/impression/i.test(D.pancrSum) && D.pancrCorr.join("|").toLowerCase().indexOf("lipase") >= 0, "deterministic: pancreatitis → impression summary + lipase/amylase correlation");
  ok(D.bleedFlags.length >= 2 && D.bleedCorr.join("|").toLowerCase().indexOf("blood pressure") >= 0, "deterministic: brain bleed → carries critical red flags + BP/coag correlations");
  ok(/Insufficient report detail/i.test(D.sparseSum), "deterministic: sparse report → 'Insufficient report detail…' (no fabrication)");

  // 3) AI-MODE render (stubbed SMD_AI) — structured sections + Draft/advisory framing + Source line
  await ev(`
    ICU.reset(); ICU.ingestPatient({name:"AIPT",age:50,sex:"F"});
    ICU.ingestWardImaging({ patientId:"PY", source:"Ward Sync", imaging:[{reportId:"Y1",description:"CT Brain",
      report:"IMPRESSION: acute intracerebral haemorrhage with midline shift."}] });
    window.__pkt = null;
    window.SMD_AI = window.SMD_AI || {};
    window.SMD_AI.imagingSummary = function(pkt){ window.__pkt = pkt; return Promise.resolve({ mode:"imaging", summary:{
      summary:"Imaging is suggestive of an acute intracerebral haemorrhage.",
      positives:["Right fronto-parietal haemorrhage"], negatives:["No hydrocephalus described"],
      significance:["Mass effect may raise intracranial pressure"],
      differentials:["Hypertensive haemorrhage","Underlying vascular lesion"],
      correlateWith:["Blood pressure","Coagulation profile"],
      redFlags:["Midline shift"], nextChecks:["Neurosurgery review","Repeat CT if deteriorating"] }}); };
    ICU.open(); var root=document.getElementById('icuRoot');
    var wsb=root.querySelector('[data-icu-act="ws:documents"]'); if(wsb) wsb.click();
    var seg=root.querySelector('[data-icu-act="tab:imaging"]'); if(seg) seg.click();
    var a=root.querySelector('[data-icu-act^="imgassist:"]'); if(a) a.click();     // opens the assist modal
    var aiBtn=document.getElementById('icuAsAI'); if(aiBtn) aiBtn.click();          // async → renders on microtask
    return 1;`);
  await sleep(300);
  const AI = JSON.parse(await ev(`
    var out=document.getElementById('icuAsOut'); var txt=out?out.textContent:"";
    return JSON.stringify({
      pktKeys: window.__pkt ? Object.keys(window.__pkt).sort() : [],
      pktHasReport: !!(window.__pkt && /intracerebral h/i.test(window.__pkt.reportText||"")),
      draft: /Draft — clinician review required/.test(txt),
      notDx: /not a diagnosis/i.test(txt),
      suggestive: /suggestive of/i.test(txt),
      diffs: /Differential considerations/i.test(txt),
      correlate: /Correlate with/i.test(txt),
      redflags: /Urgent red flags/i.test(txt),
      source: /Source:.*Ward Sync report/i.test(txt),
      crit: !!document.querySelector('#icuAsOut .icu-img-crit') });`));
  ok(AI.pktKeys.length > 0 && AI.pktHasReport, "AI mode actually sent the de-identified packet (report text included)");
  ok(AI.draft && AI.notDx, "AI result framed as 'Draft — clinician review required' + 'not a diagnosis'");
  ok(AI.suggestive && AI.diffs && AI.correlate && AI.redflags, "AI result renders structured sections (summary/differentials/correlate/red-flags)");
  ok(AI.source, "AI result carries a 'Source: … Ward Sync report' line");
  ok(AI.crit, "always-deterministic urgent-finding banner shown in the assist result");

  // 4) AI-OFF fallback — a graceful message, never a crash
  const off = await ev(`
    window.SMD_AI.imagingSummary = function(){ return Promise.resolve({ error:"ai-off" }); };
    var root=document.getElementById('icuRoot');
    var a=root.querySelector('[data-icu-act^="imgassist:"]'); if(a) a.click();
    var aiBtn=document.getElementById('icuAsAI'); if(aiBtn) aiBtn.click();
    return 1;`);
  await sleep(200);
  const OFF = await ev(`var out=document.getElementById('icuAsOut'); return out?out.textContent:"";`);
  ok(/turned off|deterministic extract instead/i.test(OFF || ""), "AI-off → graceful fallback message (offers deterministic extract)");

  console.log(fails === 0 ? "\nALL GREEN — ICU AI Imaging Assist test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
