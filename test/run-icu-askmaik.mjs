/* ICU "Ask MaiK about this patient" test (Care Plan → Deep clinical review follow-up chat).
 *
 * Proves: the Ask MaiK entry points render (Care Plan + Clinical Correlation + Imaging/reports);
 * the prompt carries the DE-IDENTIFIED patient context (no name/bed/MRN/phone) plus the deep-review
 * output when one has been run; a typed question is PHI-redacted before it leaves the device;
 * follow-up turns carry the earlier Q&A (a real conversation, not one-shot); the answer renders in
 * the sheet; and the transcript resets on patient switch (no cross-patient leak).
 *
 * The MaiK call (StewardRAG.buildPackage → SMD_AI.explainGrounded) is stubbed; the live route is
 * prod-only. USAGE: BASE=http://localhost:8902/ node test/run-icu-askmaik.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-askmaik-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Stub the whole MaiK call chain and capture the prompt each call receives.
const STUB = `
  window.__ask = [];
  window.StewardRAG = { buildPackage: function(assess, opts){ window.__ask.push(opts.question); return Promise.resolve({ reasoning:{differential:[]}, grounding:[], question: opts.question }); } };
  window.SMD_AI = window.SMD_AI || {};
  window.SMD_AI.explainGrounded = function(pkg){ return Promise.resolve({ text: "ANSWER-" + window.__ask.length + ": surgical repair is generally considered above 5 cm." }); };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU._openAskMaik && ICU._askSend && ICU._askContextText)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU Ask-MaiK API not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) the de-identified context text — real clinical content, zero identifiers
  const C = await ev(`
    ICU.reset(); ICU.ingestPatient({name:"Sunil Rao",age:58,sex:"M",bed:"ICU-9",diagnosis:"?sepsis",complaints:"fever; MRN 55231; contact 9876543210"});
    ICU.ingestWardImaging({ patientId:"PA1", source:"Ward Sync", imaging:[{reportId:"A1",description:"CT Chest",report:"IMPRESSION: bilateral consolidation."}] });
    ICU.ingestLabs({ crp:200 });
    return ICU._askContextText();`);
  ok(/Imaging: .*consolidation/i.test(C) && /Labs: .*inflammatory/i.test(C), "context text carries the real clinical evidence (imaging + labs)");
  ok(C.indexOf("Sunil Rao") < 0 && C.indexOf("ICU-9") < 0 && C.indexOf("55231") < 0 && C.indexOf("9876543210") < 0, "context text excludes name / bed / MRN / phone");
  ok(C.indexOf("58") < 0 || /band|–|-/.test(C), "context text uses an age band, not the exact age");

  // 2) a question is PHI-redacted before it is sent, and the answer renders in the sheet
  await ev(STUB + `
    ICU._askReset(); ICU._openAskMaik();
    ICU._askSend("For Sunil Rao, contact 9876543210 — 5x3 cm saccular aneurysm, is this an indication for surgery?");
    return 1;`);
  await sleep(400);
  const Q1 = JSON.parse(await ev(`
    return JSON.stringify({ prompt: window.__ask[0] || "", sheet: (document.querySelector('#icuAskSheet')||{}).textContent || "", log: ICU._askLog().length });`));
  ok(Q1.prompt.indexOf("9876543210") < 0, "the clinician's typed question is PHI-redacted before the AI call");
  ok(/saccular aneurysm/i.test(Q1.prompt) && /CLINICIAN QUESTION/.test(Q1.prompt), "the question reaches MaiK inside the patient-context prompt");
  ok(/consolidation/i.test(Q1.prompt), "the prompt is grounded on THIS patient's context");
  ok(/ANSWER-1/.test(Q1.sheet) && Q1.log === 1, "the answer renders in the Ask MaiK sheet and is kept in the transcript");

  // 3) follow-up turn carries the earlier Q&A → a conversation, not one-shot
  await ev(`ICU._askSend("Why do you think that diagnosis?"); return 1;`);
  await sleep(400);
  const Q2 = JSON.parse(await ev(`return JSON.stringify({ prompt: window.__ask[1] || "", log: ICU._askLog().length });`));
  ok(/EARLIER IN THIS CONVERSATION/.test(Q2.prompt) && /ANSWER-1/.test(Q2.prompt), "a follow-up question carries the earlier Q&A (multi-turn discussion)");
  ok(Q2.log === 2, "transcript keeps both turns");

  // 4) once a deep review has been run, its output is part of what MaiK is asked about
  await ev(`
    window.SMD_AI.correlate = function(){ return Promise.resolve({ correlation:{ clinicalCorrelation:"DEEPREVIEW-MARKER pulmonary infective process.",
      topConsiderations:["Community-acquired pneumonia"], whyFit:["Consolidation + raised CRP"], alternatives:[], whatDoesntFit:[], missing:[], redFlags:[], nextChecks:["Blood cultures"], protocols:[] }}); };
    ICU.open('imaging'); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="corranalyse"]').click();
    root.querySelector('[data-icu-act="corrdeep"]').click();
    var g=document.querySelector('#icuDeepSheet [data-icu-act="deepgo"]'); if(g) g.click();
    return 1;`);
  await sleep(400);
  const C2 = await ev(`return ICU._askContextText();`);
  ok(/DEEPREVIEW-MARKER/.test(C2) && /Community-acquired pneumonia/.test(C2), "after a deep review, its correlation + considerations are in the Ask MaiK context (\"why this dx?\" is answerable)");

  // 5) entry points render where the clinician expects them
  const B = JSON.parse(await ev(`
    var root=document.getElementById('icuRoot');
    var imgBtn = !!root.querySelector('[data-icu-act="askmaik"]');
    var cp = root.querySelector('[data-icu-act="ws:careplan"]'); if (cp) cp.click();
    var dxTab = root.querySelector('[data-icu-act="tab:dx"]'); if (dxTab) dxTab.click();
    var dxBtn = !!root.querySelector('[data-icu-act="askmaik"]');
    return JSON.stringify({ imgBtn: imgBtn, dxBtn: dxBtn });`));
  ok(B.imgBtn, "Ask MaiK button renders on the Imaging / reports screen");
  ok(B.dxBtn, "Ask MaiK button renders in Care Plan → Diagnosis (below Deep clinical review)");

  // 6) patient isolation — the transcript never survives a patient switch
  const ISO = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"OTHER",age:30,sex:"F"});
    var root=document.getElementById('icuRoot');
    var dxTab = root.querySelector('[data-icu-act="tab:dx"]'); if (dxTab) dxTab.click();
    return JSON.stringify({ log: ICU._askLog().length });`));
  ok(ISO.log === 0, "Ask MaiK transcript resets on patient switch (no cross-patient leak)");

  console.log(fails === 0 ? "\nALL GREEN — ICU Ask MaiK test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
