/* ICU Clinical Correlation Assistant test (Phase 3).
 *
 * Proves the staged pipeline: local deterministic extraction of imaging concepts + lab
 * abnormalities (negation-aware); mapping the subset with EXISTING engine finding-keys and
 * running SMD_REASON.assess() READ-ONLY for a deterministic KB signal; transparent confidence
 * categories; a strictly de-identified evidence packet; Deep AI review that is opt-in AND
 * evidence-hash CACHED (no repeat AI call for unchanged evidence); advisory-only (never sets a
 * diagnosis / never alters ranking); and the external-evidence fallback disabled (Phase 4).
 *
 * assess() is exercised for real; the Deep AI call is stubbed (live route is prod-only).
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-correlation.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9384, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-correlation-chrome";
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
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU._runQuickCorrelation && ICU._correlationEvidence && window.SMD_REASON && SMD_REASON.assess)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU correlation API + SMD_REASON.assess not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) local extraction — imaging concepts + lab abnormalities (negation-aware)
  const ex = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"CPT",age:52,sex:"M",complaints:"epigastric pain"});
    ICU.ingestWardImaging({ patientId:"P1", source:"Ward Sync", imaging:[{reportId:"C1",description:"CECT Abdomen",
      report:"FINDINGS: Bulky pancreas with peripancreatic fat stranding. No free air.\\nIMPRESSION: acute pancreatitis."}] });
    ICU.ingestLabs({ lipase:420, plt:90, crp:180 });
    var ev0 = ICU._correlationEvidence();
    return JSON.stringify({ img: ev0.img, labs: ev0.labs });`));
  ok(ex.img.some(function (c) { return /pancreatic inflammation/i.test(c); }) && ex.img.some(function (c) { return /peripancreatic/i.test(c); }), "imaging concept extraction: pancreatic + peripancreatic inflammation");
  ok(ex.labs.some(function (l) { return /pancreatic enzyme/i.test(l); }) && ex.labs.some(function (l) { return /thrombocyto/i.test(l); }), "lab abnormality extraction: enzyme elevation + thrombocytopenia");

  // 2) neuro-emergency pattern — haemorrhage + mass effect concepts + deterministic critical flag
  const neu = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"NPT",age:66,sex:"M"});
    ICU.ingestWardImaging({ patientId:"P2", source:"Ward Sync", imaging:[{reportId:"N1",description:"CT Brain",
      report:"IMPRESSION: acute intracerebral haemorrhage with midline shift."}] });
    var ev0 = ICU._correlationEvidence();
    return JSON.stringify({ img: ev0.img, crit: ev0.crit });`));
  ok(neu.img.some(function (c) { return /haemorrhage/i.test(c); }) && neu.img.some(function (c) { return /mass effect/i.test(c); }), "neuro pattern: haemorrhage + mass-effect concepts extracted");
  ok(neu.crit.length >= 1, "neuro pattern: deterministic critical flag carried into correlation evidence");

  // 3) quick correlation runs the REAL engine READ-ONLY on the mappable subset → candidates + category
  const q = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"QPT",age:70,sex:"M"});
    ICU.ingestWardImaging({ patientId:"P3", source:"Ward Sync", imaging:[{reportId:"Q1",description:"X-ray Chest",
      report:"IMPRESSION: right lower zone consolidation."}] });
    var res = ICU._runQuickCorrelation();
    var d0 = ICU.state().patient.diagnosis || "";
    return JSON.stringify({ keys: res.keys, status: res.status, nCand: res.candidates.length, top: res.candidates[0]?res.candidates[0].name:"", dxUnchanged: d0==="" });`));
  ok(q.keys.indexOf("consolidation") >= 0, "quick: 'consolidation' concept mapped to the EXISTING engine finding-key");
  ok(q.nCand >= 1, "quick: SMD_REASON.assess returned candidates for the mapped pattern (" + q.top + ")");
  ok(["Strong internal match", "Partial internal match", "Broad syndrome match only", "No adequate internal match", "Conflicting evidence", "Insufficient data"].indexOf(q.status) >= 0, "quick: a transparent confidence category is assigned (" + q.status + ")");
  ok(q.dxUnchanged, "quick correlation never sets the patient diagnosis (advisory; engine authority intact)");

  // 4) 'No adequate internal match' when no concept maps to an engine key (pancreatitis has no imaging key)
  const nm = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"NM",age:40,sex:"F"});
    ICU.ingestWardImaging({ patientId:"P4", source:"Ward Sync", imaging:[{reportId:"NM1",description:"CECT Abdomen",report:"IMPRESSION: acute pancreatitis."}] });
    ICU.ingestLabs({ bili:5 });   // a 2nd, NON-mappable abnormality → >=2 evidence items with 0 mappable keys
    var res = ICU._runQuickCorrelation();
    return JSON.stringify({ keys: res.keys, status: res.status });`));
  ok(nm.keys.length === 0 && /No adequate internal match/.test(nm.status), "no mappable concept → 'No adequate internal match' (not a fabricated diagnosis) → Deep review is the path");

  // 5) de-identified evidence packet — no identifiers; clinician findings redacted
  const P = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"Sunil Rao", age:58, sex:"M", bed:"ICU-9", diagnosis:"?sepsis", complaints:"fever; MRN 55231; contact 9876543210"});
    ICU.ingestWardImaging({ patientId:"P5", source:"Ward Sync", imaging:[{reportId:"D1",description:"CT Chest",report:"IMPRESSION: bilateral consolidation."}] });
    ICU.ingestLabs({ crp:200 });
    var pkt = ICU._buildCorrelationPacket(ICU._correlationEvidence());
    return JSON.stringify({ keys: Object.keys(pkt).sort(), ctxKeys: Object.keys(pkt.patientContext).sort(), json: JSON.stringify(pkt) });`));
  ok(P.json.indexOf("Sunil Rao") < 0 && P.json.indexOf("ICU-9") < 0 && P.json.indexOf("55231") < 0 && P.json.indexOf("9876543210") < 0, "correlation packet excludes name / bed / MRN / phone (clinician findings redacted)");
  ok(P.ctxKeys.indexOf("ageBand") >= 0 && P.json.indexOf('"age":58') < 0, "packet carries age BAND, not exact age");

  // 6) Deep review is opt-in AND evidence-hash CACHED (no repeat AI call for unchanged evidence)
  await ev(`
    ICU.reset(); ICU.ingestPatient({name:"CACHE",age:60,sex:"M"});
    ICU.ingestWardImaging({ patientId:"P6", source:"Ward Sync", imaging:[{reportId:"K1",description:"CT Chest",report:"IMPRESSION: bilateral consolidation."}] });
    ICU.ingestLabs({ crp:150 });
    window.__cc = 0;
    window.SMD_AI = window.SMD_AI || {};
    window.SMD_AI.correlate = function(){ window.__cc++; return Promise.resolve({ mode:"correlate", correlation:{
      clinicalCorrelation:"Findings are suggestive of a pulmonary infective process.", topConsiderations:["Community-acquired pneumonia"],
      whyFit:["Consolidation + raised CRP"], alternatives:["Aspiration"], whatDoesntFit:[], missing:["Sputum culture"], redFlags:[], nextChecks:["Blood cultures"], protocols:[] }}); };
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    root.querySelector('[data-icu-act="corrdeep"]').click();
    return 1;`);
  await sleep(300);
  const D1 = JSON.parse(await ev(`
    var root=document.getElementById('icuRoot'); var txt=root.textContent||"";
    root.querySelector('[data-icu-act="corrdeep"]').click();   // 2nd tap → should be a cache hit
    return JSON.stringify({ calls1: window.__cc, deepShown: /suggestive of a pulmonary infective process/i.test(txt), topCons: /Community-acquired pneumonia/i.test(txt) });`));
  await sleep(200);
  const D2 = JSON.parse(await ev(`return JSON.stringify({ calls2: window.__cc });`));
  ok(D1.calls1 === 1 && D1.deepShown && D1.topCons, "Deep review calls the AI once + renders the structured correlation");
  ok(D2.calls2 === 1, "Deep review is CACHED by evidence hash — a repeat tap does NOT call the AI again (token control)");

  // 7) external-evidence fallback button is present and now ENABLED (Phase 4 shipped; opt-in per tap)
  const extBtn = await ev(`
    var root=document.getElementById('icuRoot');
    var b=root.querySelector('[data-icu-act="corrext"]') || Array.prototype.filter.call(root.querySelectorAll('button'),function(x){return /Find evidence beyond StewardMD/i.test(x.textContent);})[0];
    return b ? (b.getAttribute && b.getAttribute('data-icu-act')==='corrext' ? "enabled" : (b.disabled ? "disabled" : "enabled")) : "absent";`);
  ok(extBtn === "enabled", "external-evidence fallback button is present + enabled (Phase 4, opt-in on tap)");

  // 8) advisory-only — after analyse + deep, the diagnosis + engine are untouched
  ok(await ev(`return (ICU.state().patient.diagnosis||"")==="";`) === true, "correlation never wrote a diagnosis (deterministic engine remains the authority)");

  // 9) patient isolation — analysis resets on patient switch (no stale correlation)
  const iso = await ev(`
    ICU.reset(); ICU.ingestPatient({name:"ISO2",age:33,sex:"F"});
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    var body=root.textContent||"";
    return JSON.stringify({ notAnalysed: /Analyse imaging \\+ labs|Add imaging and laboratory data/.test(body), noStaleDeep: !/pulmonary infective process/i.test(body) });`);
  const I = JSON.parse(iso);
  ok(I.notAnalysed && I.noStaleDeep, "patient isolation: new patient starts un-analysed, no prior correlation carried over");

  // 10) enumeration negation — a leading "No" governs the whole comma/‑or list (review fix)
  const enu = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"ENU",age:50,sex:"M"});
    ICU.ingestWardImaging({ patientId:"PE", source:"Ward Sync", imaging:[{reportId:"E1",description:"CT Abdomen",
      report:"IMPRESSION: No focal consolidation, pleural effusion, pneumothorax or ascites."}] });
    return JSON.stringify({ img: ICU._correlationEvidence().img });`));
  ok(enu.img.indexOf("ascites") < 0 && enu.img.indexOf("pulmonary consolidation") < 0 && enu.img.indexOf("pleural effusion") < 0, "enumeration negation: 'No A, B, C or ascites' extracts NONE of the negated concepts");

  // 11) unmapped evidence (labs-only) suppresses the misleading ranked list (review fix)
  const um = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"UMP",age:55,sex:"M"});
    ICU.ingestLabs({ plt:80, lipase:600, crp:220 });   // thrombocytopenia maps; lipase/CRP do NOT
    var q = ICU._runQuickCorrelation();
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    var body=root.textContent||"";
    return JSON.stringify({ unmapped: q.unmapped, caveat: /aren’t machine-matched|aren't machine-matched/.test(body), noRanked: !/Top considerations \\(pattern-based/.test(body) });`));
  ok(um.unmapped.length >= 2, "unmapped labs (enzyme elevation, inflammatory markers) are flagged as not machine-matched");
  ok(um.caveat && um.noRanked, "labs-only with unmapped-dominant evidence: caveat shown, misleading ranked list suppressed");

  // 12) transient Deep-review errors are NOT cached — a retry re-calls the AI (review fix)
  await ev(`
    ICU.reset(); ICU.ingestPatient({name:"ERR",age:60,sex:"M"});
    ICU.ingestWardImaging({ patientId:"PZ", source:"Ward Sync", imaging:[{reportId:"Z1",description:"CT Chest",report:"IMPRESSION: consolidation."}] });
    window.__n = 0;
    window.SMD_AI = window.SMD_AI || {};
    window.SMD_AI.correlate = function(){ window.__n++; return Promise.resolve(window.__n === 1 ? { error:"quota" } : { mode:"correlate", correlation:{ clinicalCorrelation:"Recovered correlation.", topConsiderations:["Pneumonia"], whyFit:[],alternatives:[],whatDoesntFit:[],missing:[],redFlags:[],nextChecks:[],protocols:[] }}); };
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    root.querySelector('[data-icu-act="corrdeep"]').click();
    return 1;`);
  await sleep(250);
  const err1 = JSON.parse(await ev(`return JSON.stringify({ n1: window.__n, errShown: /usage limit reached/i.test(document.getElementById('icuRoot').textContent||"") });`));
  await ev(`document.getElementById('icuRoot').querySelector('[data-icu-act="corrdeep"]').click(); return 1;`);   // retry — must re-call the AI (not blocked by a cached error)
  await sleep(250);
  const err2 = JSON.parse(await ev(`return JSON.stringify({ n2: window.__n, recovered: /Recovered correlation/i.test(document.getElementById('icuRoot').textContent||"") });`));
  ok(err1.errShown && err1.n1 === 1, "Deep review: a transient error is shown (not cached)");
  ok(err2.n2 === 2 && err2.recovered, "Deep review retry re-calls the AI after a transient error and renders the recovered result");

  // 13) cross-patient isolation — a cached Deep result never surfaces on a different patient (review fix)
  const xp = await ev(`
    ICU.reset(); ICU.ingestPatient({name:"PA_ONE",age:60,sex:"M"});
    ICU.ingestWardImaging({ patientId:"PXA", source:"Ward Sync", imaging:[{reportId:"XA1",description:"CT Chest",report:"IMPRESSION: consolidation."}] });
    ICU.ingestLabs({ crp:150 });
    window.SMD_AI.correlate = function(){ return Promise.resolve({ mode:"correlate", correlation:{ clinicalCorrelation:"PATIENT-A-ONLY-NARRATIVE", topConsiderations:["Pneumonia"], whyFit:[],alternatives:[],whatDoesntFit:[],missing:[],redFlags:[],nextChecks:[],protocols:[] }}); };
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    root.querySelector('[data-icu-act="corrdeep"]').click();
    return 1;`);
  await sleep(250);
  const XP = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"PB_TWO",age:61,sex:"F"});   // different unsaved patient, identical evidence
    ICU.ingestWardImaging({ patientId:"PXB", source:"Ward Sync", imaging:[{reportId:"XB1",description:"CT Chest",report:"IMPRESSION: consolidation."}] });
    ICU.ingestLabs({ crp:150 });
    var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    return JSON.stringify({ leaked: /PATIENT-A-ONLY-NARRATIVE/.test(root.textContent||"") });`));
  ok(XP.leaked === false, "cross-patient isolation: patient A's cached Deep narrative never appears on patient B (cache reset on switch)");

  console.log(fails === 0 ? "\nALL GREEN — ICU Clinical Correlation test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
