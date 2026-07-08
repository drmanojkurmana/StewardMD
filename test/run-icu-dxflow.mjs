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

  // ===== Slice 2 — deterministic working-diagnosis pass =====

  // 13) dxFindingKeys: present/possible feed the engine; ABSENT excluded; note:* excluded
  const c13 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"K",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"alteredSensorium",displayLabel:"AMS",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"fever",displayLabel:"Fever",polarity:"absent",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"note:guarding",displayLabel:"Guarding",inReasoning:false},"manual_picker");
    var k=ICU._dxFindingKeys();
    return JSON.stringify({altered:!!k.alteredSensorium, fever:!!k.fever, note:!!k["note:guarding"], n:Object.keys(k).length});
  `);
  ok(c13.altered && !c13.fever && !c13.note && c13.n === 1, `dx keys: present kept, absent "fever" excluded, note:* excluded (${c13.n} key)`);

  // 14) ACCEPTANCE CASE — altered sensorium + quadriparesis + seizure + severe HTN →
  //     structural/epileptic/vascular CNS leads; meningitis does NOT dominate
  const c14 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"ACC",age:60,sex:"M"});
    [["alteredSensorium","Altered sensorium"],["focalNeuroDeficit","Quadriparesis"],["seizure","Seizure"],["hypertensionHx","Severe hypertension"]].forEach(function(p){ ICU._addFindingChip({canonicalFindingId:p[0],displayLabel:p[1],inReasoning:true},"manual_picker"); });
    var r=ICU._runWorkingDx();
    return JSON.stringify({ sufficient:r.sufficient, names:r.cards.map(function(x){return x.c.name;}), top:r.cards[0]&&r.cards[0].c.name, lvl:r.cards[0]&&r.cards[0].lvl });
  `);
  const topStructural = /epilep|status|ictal|stroke|h[ae]?morrhage|\bich\b|intracerebral|encephalopath|ncse|cvt|thrombosis|tumour|tumor/i.test(c14.top || "");
  const menTop = /mening/i.test(c14.top || "");
  ok(c14.sufficient && topStructural && !menTop, `acceptance: structural CNS leads (top="${c14.top}" ${c14.lvl}); meningitis not dominant [${(c14.names || []).slice(0, 4).join(", ")}]`);

  // 15) ≤5 cards, each carries a support level
  const c15 = await J(`var r=ICU._runWorkingDx(); return JSON.stringify({n:r.cards.length, lvls:r.cards.map(function(x){return x.lvl;})});`);
  ok(c15.n >= 1 && c15.n <= 5 && c15.lvls.every(l => /Strong|Moderate|Possible/.test(l)), `≤5 cards with support levels (${c15.n}: ${c15.lvls.join(", ")})`);

  // 16) selecting a suggestion stores patient.workingDx provenance (+ back-compat diagnosis string)
  const c16 = await J(`
    ICU._pickWorkingDx("Ischaemic stroke","deterministic_suggestion");
    var w=ICU.state().patient.workingDx||{};
    return JSON.stringify({ dx:ICU.state().patient.diagnosis, name:w.name, confirmed:w.clinicianConfirmed, source:w.source, hasHash:!!w.contextHash });
  `);
  ok(c16.dx === "Ischaemic stroke" && c16.name === "Ischaemic stroke" && c16.confirmed === true && c16.source === "deterministic_suggestion" && c16.hasHash, `selection stores workingDx{confirmed,source,contextHash}`);

  // 17) insufficient context — only a note:* finding → no confident differential (no invented ranking)
  const c17 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"NC",age:50,sex:"F"});
    ICU._addFindingChip({canonicalFindingId:"note:woundDischarge",displayLabel:"Wound discharge",inReasoning:false},"manual_picker");
    var r=ICU._runWorkingDx();
    return JSON.stringify({keys:r.keys.length, sufficient:r.sufficient});
  `);
  ok(c17.keys === 0 && !c17.sufficient, `insufficient context (note-only) → no invented ranking`);

  // 18) UI: "Find working diagnosis" renders cards; a card exposes Select + View reasoning
  const c18 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"UI",age:60,sex:"M"});
    [["alteredSensorium","AMS"],["seizure","Seizure"],["focalNeuroDeficit","Quadriparesis"]].forEach(function(p){ ICU._addFindingChip({canonicalFindingId:p[0],displayLabel:p[1],inReasoning:true},"manual_picker"); });
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:careplan"]').click();
    var fbtn=root.querySelector('[data-icu-act="finddx"]'); var hadFind=!!fbtn; if(fbtn) fbtn.click();
    var cards=root.querySelectorAll('.icu-dx-card').length;
    var sel=!!root.querySelector('[data-icu-act^="dxpick"]'), why=!!root.querySelector('[data-icu-act^="dxwhy"]');
    return JSON.stringify({hadFind:hadFind, cards:cards, sel:sel, why:why});
  `);
  ok(c18.hadFind && c18.cards >= 1 && c18.sel && c18.why, `UI: Find working diagnosis → ${c18.cards} cards with Select + View reasoning`);

  // 19) advisory — running the differential NEVER silently sets a diagnosis (only Select commits);
  //     and it is stable/read-only (repeated runs don't mutate patient state)
  const c19 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"PURE",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker");
    var dxB=ICU.state().patient.diagnosis||"", wB=ICU.state().patient.workingDx||null;
    ICU._runWorkingDx(); ICU._runWorkingDx();
    var dxA=ICU.state().patient.diagnosis||"", wA=ICU.state().patient.workingDx||null;
    return JSON.stringify({ dxUnset: dxB==="" && dxA==="", noWdx: !wB && !wA });
  `);
  ok(c19.dxUnset && c19.noWdx, "advisory: running the differential never silently sets a diagnosis (only Select commits)");

  // ===== Slice 3 — Deep Review confirm sheet + no-context guard + Care Plan entry =====

  // 20) Care Plan exposes a Deep Review button that opens the OPT-IN confirm sheet (context checklist + Review/Edit)
  const c20 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"DR",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker");
    ICU.open(); var root=document.getElementById('icuRoot'); root.querySelector('[data-icu-act="ws:careplan"]').click();
    var btn=root.querySelector('[data-icu-act="corrdeep"]'); var had=!!btn; if(btn) btn.click();
    var sheet=document.getElementById('icuDeepSheet');
    return JSON.stringify({ had:had, sheet:!!sheet, review:!!(sheet&&sheet.querySelector('[data-icu-act="deepgo"]')), edit:!!(sheet&&sheet.querySelector('[data-icu-act="deepedit"]')), chk:(sheet?sheet.querySelectorAll('.icu-deep-chk').length:0) });
  `);
  ok(c20.had && c20.sheet && c20.review && c20.edit && c20.chk >= 5, `Deep Review opens the opt-in confirm sheet (Review + Edit; ${c20.chk}-item checklist)`);

  // 21) no usable context → AI is NOT offered (no "Review" button); confirm sheet steers to add data
  const c21 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"NOCTX",age:40,sex:"F"});
    var usable=ICU._deepReviewUsable();
    ICU._openDeepReviewConfirm(); var sheet=document.getElementById('icuDeepSheet');
    return JSON.stringify({ usable:usable, review:!!(sheet&&sheet.querySelector('[data-icu-act="deepgo"]')), edit:!!(sheet&&sheet.querySelector('[data-icu-act="deepedit"]')) });
  `);
  ok(c21.usable === false && c21.review === false && c21.edit === true, "no-context guard: no AI call offered on empty context (Review absent; steers to add data)");

  // 22) confirm checklist reflects the sources actually present (findings ✓, labs not available)
  const c22 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"CK",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker");
    var items=ICU._deepReviewItems();
    return JSON.stringify({ findingsOk:((items.filter(function(i){return /findings/i.test(i.label);})[0]||{}).ok||0)>0, labsOk:((items.filter(function(i){return /labs/i.test(i.label);})[0]||{}).ok||0) });
  `);
  ok(c22.findingsOk && !c22.labsOk, "confirm checklist marks present sources (findings ✓; labs — not available)");

  // 23) "Edit context first" routes to the finding picker (not the AI)
  const c23 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"ED",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker");
    ICU._openDeepReviewConfirm();
    var e=document.querySelector('#icuDeepSheet [data-icu-act="deepedit"]'); if(e) e.click();
    return JSON.stringify({ picker:!!document.getElementById('icuFindSheet') });
  `);
  ok(c23.picker === true, "\"Edit context first\" opens the finding picker (no AI call)");

  // ===== Slice 4 — first-use spotlight tour (per account) =====
  const clearTour = `try{localStorage.removeItem(ICU._tourKey());}catch(e){}`;

  // 24) startTour renders a 4-step coach-mark; step 1 highlights Structured findings
  const c24 = await J(clearTour + `
    ICU._startTour(); var el=document.getElementById('icuTour');
    return JSON.stringify({ on:!!(el&&el.classList.contains("on")), steps:ICU._tourSteps.length, t1:(el?(el.querySelector('.icu-tour-t')||{}).textContent:"")||"", hasNext:!!(el&&el.querySelector('[data-icu-act="tournext"]')), hasSkip:!!(el&&el.querySelector('[data-icu-act="tourskip"]')) });
  `);
  ok(c24.on && c24.steps === 4 && /structured findings/i.test(c24.t1) && c24.hasNext && c24.hasSkip, `tour renders (${c24.steps} steps; step1="${c24.t1}"; Next+Skip)`);

  // 25) gating (test 15): fresh → shows; completed / dont-show / skipped-twice → does not
  const c25 = await J(clearTour + `
    var fresh=ICU._tourShouldShow();
    localStorage.setItem(ICU._tourKey(), JSON.stringify({completedVersion:1})); var done=ICU._tourShouldShow();
    localStorage.setItem(ICU._tourKey(), JSON.stringify({dontShowAgain:true})); var dont=ICU._tourShouldShow();
    localStorage.setItem(ICU._tourKey(), JSON.stringify({skippedCount:2})); var sk2=ICU._tourShouldShow();
    ${clearTour} return JSON.stringify({fresh:fresh, done:done, dont:dont, sk2:sk2});
  `);
  ok(c25.fresh === true && c25.done === false && c25.dont === false && c25.sk2 === false, "tour gating: fresh shows; completed / don't-show / skipped-twice do not");

  // 26) Skip records skippedCount + allows one more; a 2nd skip stops it
  const c26 = await J(clearTour + `
    ICU._startTour(); document.querySelector('#icuTour [data-icu-act="tourskip"]').click();
    var s1=ICU._tourState().skippedCount, after1=ICU._tourShouldShow();
    ICU._startTour(); document.querySelector('#icuTour [data-icu-act="tourskip"]').click();
    var s2=ICU._tourState().skippedCount, after2=ICU._tourShouldShow();
    ${clearTour} return JSON.stringify({s1:s1, after1:after1, s2:s2, after2:after2});
  `);
  ok(c26.s1 === 1 && c26.after1 === true && c26.s2 === 2 && c26.after2 === false, "Skip: shows once more after first skip, stops after second");

  // 27) "Got it" + "Don't show again" persists per account and stops the tour
  const c27 = await J(clearTour + `
    ICU._startTour();
    document.querySelector('#icuTour [data-icu-act="tournext"]').click();
    document.querySelector('#icuTour [data-icu-act="tournext"]').click();
    document.querySelector('#icuTour [data-icu-act="tournext"]').click();
    var dont=document.getElementById('icuTourDont'); if(dont) dont.checked=true;
    document.querySelector('#icuTour [data-icu-act="tourdone"]').click();
    var st=ICU._tourState(); var raw=localStorage.getItem(ICU._tourKey());
    ${clearTour} return JSON.stringify({ completed:st.completedVersion, dont:st.dontShowAgain, persisted:!!raw, show:false });
  `);
  ok(c27.completed === 1 && c27.dont === true && c27.persisted, `"Got it" + don't-show persists per account (completedVersion=${c27.completed})`);

  // 28) per-account key + never touches the disclaimer/account keys (test 18)
  const c28 = await J(`
    var beforeConsent=localStorage.getItem("smd_consent"), beforeAcct=localStorage.getItem("stewardmd_account");
    ${clearTour} ICU._startTour(); document.querySelector('#icuTour [data-icu-act="tourskip"]').click();
    var k=ICU._tourKey();
    var r={ keyNs: k.indexOf("smd_icu_dxtour:")===0, consentSame: localStorage.getItem("smd_consent")===beforeConsent, acctSame: localStorage.getItem("stewardmd_account")===beforeAcct };
    ${clearTour} return JSON.stringify(r);
  `);
  ok(c28.keyNs && c28.consentSame && c28.acctSame, "tour state is per-account (smd_icu_dxtour:<uid>) and never touches smd_consent / stewardmd_account");

  // 29) coach-mark sits ABOVE the bottom nav (higher z + offset from bottom) — no overlap (test 20)
  const c29 = await J(clearTour + `
    ICU.reset(); ICU.ingestPatient({name:"NAVX",age:60,sex:"M"}); ICU.open();
    ICU._startTour(); var el=document.getElementById('icuTour'), nav=document.querySelector('.icu-tabs');
    var tz=+getComputedStyle(el).zIndex||0, nz=nav?(+getComputedStyle(nav).zIndex||0):-1, bottom=getComputedStyle(el).bottom;
    ${clearTour} return JSON.stringify({ aboveNav: tz>nz, offset: bottom });
  `);
  ok(c29.aboveNav && c29.offset && c29.offset !== "0px", `coach-mark above the nav (z ${c29.aboveNav}; bottom offset ${c29.offset})`);

  // 30) manual replay from More works even after completion (test 19)
  const c30 = await J(`
    localStorage.setItem(ICU._tourKey(), JSON.stringify({completedVersion:1, dontShowAgain:true}));
    ICU._startTour(); var on=!!(document.getElementById('icuTour')||{}).classList && document.getElementById('icuTour').classList.contains("on");
    ${clearTour} return JSON.stringify({on:on});
  `);
  ok(c30.on === true, "manual replay opens the tour even after completion / don't-show");

  console.log(fails === 0 ? "\nALL GREEN — ICU dx-flow Slice 1–4 passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
