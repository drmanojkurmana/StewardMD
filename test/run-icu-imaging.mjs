/* ICU Imaging Import + Imaging Notes test (Phase 1 — deterministic, no AI).
 *
 * Proves: imaging[] store + feature flag; Ward Sync radiology ingest via ICU.ingestWardImaging
 * (synthetic fixture — a live GHIS session isn't available in test); modality normalization;
 * section parsing (raw preserved); deterministic critical-term flag WITH negation safety
 * ("no free air" does NOT trigger) and never a diagnosis; content dedup (same report twice →
 * one); manual imaging note; Daily Summary integration; empty state; patient isolation; and
 * the Imaging Notes view rendering (cards + critical banner) reached via Documents → Imaging.
 *
 * Reuses the deterministic layer only — no reasoning/ranking/antibiotic engine touched.
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-imaging.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9380, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-imaging-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Synthetic Ward Sync radiology records (raw /radiology + /radiology-report shape).
const FIXTURE = JSON.stringify([
  { reportId: "R1", description: "CECT Abdomen", date: "03-JUL-2026", printType: "manual", reported: "03-JUL-2026 14:30", enteredBy: "Rao",
    report: "CLINICAL: epigastric pain, vomiting.\nFINDINGS: Bulky oedematous pancreas with peripancreatic fat stranding. No pancreatic necrosis. No free air.\nIMPRESSION: Acute interstitial pancreatitis." },
  { reportId: "R2", description: "CT Brain plain", date: "02-JUL-2026", printType: "automated", reported: "02-JUL-2026", enteredBy: "Nair",
    report: "FINDINGS: Large right fronto-parietal intraparenchymal haemorrhage with 8 mm midline shift.\nIMPRESSION: Acute intracerebral haemorrhage with mass effect." },
  { reportId: "R3", description: "X-ray Chest PA", date: "01-JUL-2026", printType: "manual", reported: "01-JUL-2026", enteredBy: "Rao",
    report: "Lungs clear. No consolidation. No pneumothorax. No free air under the diaphragm.\nIMPRESSION: Normal chest radiograph." }
]);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.ingestWardImaging && ICU.ingestImaging && ICU.imagingOn)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU + imaging API not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) feature flag on by default + store exists
  ok(await ev(`return ICU.imagingOn() === true;`) === true, "imaging feature flag ON by default (smd_icu_imaging)");
  ok(await ev(`ICU.reset(); return Array.isArray(ICU.state().imaging) && ICU.state().imaging.length === 0;`) === true, "imaging[] store exists and starts empty");

  // 2) modality normalization (deterministic, from the free-text title)
  const mod = JSON.parse(await ev(`return JSON.stringify({
    cect: ICU._imgModality("CECT Abdomen"), ct: ICU._imgModality("CT Brain plain"), mri: ICU._imgModality("MRI Brain with contrast"),
    us: ICU._imgModality("USG Abdomen"), xr: ICU._imgModality("X-ray Chest PA"), echo: ICU._imgModality("2D Echocardiography"),
    ercp: ICU._imgModality("ERCP"), other: ICU._imgModality("Bone densitometry")});`));
  ok(mod.cect.category === "ctmri" && /cect/i.test(mod.cect.modality), "modality: CECT → CT/MRI bucket");
  ok(mod.us.category === "us" && mod.xr.category === "xray" && mod.echo.category === "cardiac" && mod.ercp.category === "endo" && mod.other.category === "other", "modality: US / X-ray / Echo / Endoscopy / Other buckets correct");

  // 3) Ward Sync ingest (synthetic fixture)
  const r3 = JSON.parse(await ev(`ICU.reset(); ICU.ingestPatient({name:"IMGPT",age:52,sex:"M"});
    var res = ICU.ingestWardImaging({ patientId:"P1", source:"Ward Sync", imaging: ${FIXTURE} });
    var im = ICU.state().imaging;
    return JSON.stringify({ res: res, n: im.length, cats: im.map(function(r){return r.category;}), studies: im.map(function(r){return r.studyName;}) });`));
  ok(r3.res.added === 3 && r3.n === 3, "Ward Sync ingest: 3 imaging reports imported (CECT/CT/X-ray)");
  ok(r3.studies.indexOf("CECT Abdomen") >= 0 && r3.studies.indexOf("CT Brain plain") >= 0, "original study titles preserved");

  // 4) section parser — raw preserved, impression extracted, parsed flag set
  const parse = JSON.parse(await ev(`var r = ICU.state().imaging.filter(function(x){return x.reportId==="R1";})[0]||{};
    return JSON.stringify({ parsed:r.parsed, imp:r.impressionRaw, hasRaw: !!r.reportRaw, findings:r.findingsRaw });`));
  ok(parse.parsed === true && /interstitial pancreatitis/i.test(parse.imp), "parser: IMPRESSION extracted (R1) + parsed flag set");
  ok(parse.hasRaw && /peripancreatic fat stranding/i.test(parse.findings), "parser: FINDINGS extracted, raw report preserved");

  // 5) critical-term flag — triggers review only, never a diagnosis; WITH negation safety
  const crit = JSON.parse(await ev(`var by={}; ICU.state().imaging.forEach(function(r){by[r.reportId]=r.critical||[];});
    return JSON.stringify(by);`));
  ok(crit.R2.length >= 2 && crit.R2.join("|").toLowerCase().indexOf("h") >= 0 && crit.R2.some(function (c) { return /midline shift|mass effect/i.test(c); }), "critical flag: CT brain (ICH + midline shift) flagged for urgent review (" + crit.R2.join(", ") + ")");
  ok(crit.R1.length === 0, "negation safety: 'No pancreatic necrosis / No free air' does NOT flag (R1)");
  ok(crit.R3.length === 0, "negation safety: 'No consolidation / No pneumothorax / No free air' does NOT flag (R3)");
  ok(await ev(`var d=ICU.state().patient.diagnosis||""; return d==="";`) === true, "critical flag never sets a diagnosis (engine authority intact)");

  // 5b) review-hardening: negation is CLAUSE-scoped (an earlier "No ..." sentence must not
  //     suppress a real finding), and British/American spellings both flag. Uses the pure scan.
  const scan = JSON.parse(await ev(`return JSON.stringify({
    negClause: ICU._imgCritical("No fracture. Acute subdural haematoma seen."),
    negClause2: ICU._imgCritical("No acute infarct. Small acute subdural haematoma."),
    negPtx: ICU._imgCritical("No pleural effusion. Large pneumothorax on the right."),
    trueNeg: ICU._imgCritical("No free air. No perforation. No pneumothorax."),
    ischB: ICU._imgCritical("Features of mesenteric ischaemia with bowel wall thickening."),
    ischA: ICU._imgCritical("Findings of mesenteric ischemia."),
    necroZ: ICU._imgCritical("Findings consistent with necrotizing pancreatitis."),
    necroS: ICU._imgCritical("Acute necrotising pancreatitis.")
  });`));
  ok(scan.negClause.length > 0 && scan.negClause2.length > 0 && scan.negPtx.length > 0, "negation clause-scoped — an earlier 'No …' clause no longer suppresses a real urgent finding");
  ok(scan.trueNeg.length === 0, "genuine same-clause negations still suppressed ('No free air / No perforation / No pneumothorax')");
  ok(scan.ischB.length > 0 && scan.ischA.length > 0, "bowel ischaemia flagged in BOTH British (ischaemia) + American (ischemia) spelling");
  ok(scan.necroZ.length > 0 && scan.necroS.length > 0, "necrotising + necrotizing pancreatitis both flagged");

  // 6) dedup — re-import the same batch → no new records
  const dedup = JSON.parse(await ev(`var res = ICU.ingestWardImaging({ patientId:"P1", source:"Ward Sync", imaging: ${FIXTURE} });
    return JSON.stringify({ added: res.added, dups: res.duplicates, total: ICU.state().imaging.length });`));
  ok(dedup.added === 0 && dedup.dups === 3 && dedup.total === 3, "dedup: same report fetched twice creates one record (0 added, 3 dup)");

  // 7) manual imaging note
  const man = JSON.parse(await ev(`var rec = ICU.ingestImaging({ modality:"USG", studyName:"Bedside USG Abdomen", impressionRaw:"Moderate ascites, no free fluid loculation.", comment:"Tapped 1.2 L." });
    var im = ICU.state().imaging;
    return JSON.stringify({ total: im.length, cat: rec.category, src: rec.source });`));
  ok(man.total === 4 && man.cat === "us" && man.src === "Manual", "manual imaging note added (source Manual, US bucket)");

  // 8) Daily Summary integration — reviewed imaging appears under IMPORTANT IMAGING
  const sum = JSON.parse(await ev(`var im=ICU.state().imaging; im.forEach(function(r){ if(r.reportId==="R1") r.reviewed=true; });
    var s = ICU.summary();
    return JSON.stringify({ has: /IMPORTANT IMAGING/.test(s), pancr: /interstitial pancreatitis/i.test(s), unreviewedHidden: (s.match(/Bedside USG/)||[]).length });`));
  ok(sum.has && sum.pancr, "Daily Summary includes reviewed imaging (IMPORTANT IMAGING → R1 impression)");
  ok(sum.unreviewedHidden === 0, "Daily Summary excludes not-reviewed / not-added imaging");

  // 9) UI render — reach Documents → Imaging, cards render, critical banner shown (single sync ev)
  const ui = await ev(`ICU.open();
    var root=document.getElementById('icuRoot'); if(!root) return JSON.stringify({err:'no root'});
    var wsb=root.querySelector('[data-icu-act="ws:documents"]'); if(wsb) wsb.click();
    var seg=root.querySelector('[data-icu-act="tab:imaging"]'); if(seg) seg.click();
    return JSON.stringify({
      cards: root.querySelectorAll('.icu-img-card').length,
      crit: root.querySelectorAll('.icu-img-crit').length,
      hasFetch: !!root.querySelector('[data-icu-act="imgfetch"]'),
      hasAdd: !!root.querySelector('[data-icu-act="imgadd"]'),
      subnavImaging: !!root.querySelector('[data-icu-act="tab:imaging"]')
    });`);
  const U = JSON.parse(ui);
  ok(U.subnavImaging === true, "Imaging appears as a Documents sub-nav member");
  ok(U.cards === 4, "Imaging Notes renders a card per report (4)");
  ok(U.crit >= 1, "urgent-finding banner rendered on the flagged CT-brain card");
  ok(U.hasFetch && U.hasAdd, "Fetch-from-Ward-Sync + Add-imaging-note actions present");

  // 10) patient isolation + empty state
  const iso = await ev(`ICU.reset(); ICU.ingestPatient({name:"IMGPT2",age:40,sex:"F"});
    var im = ICU.state().imaging;
    ICU.open(); var root=document.getElementById('icuRoot');
    var wsb=root.querySelector('[data-icu-act="ws:documents"]'); if(wsb) wsb.click();
    var seg=root.querySelector('[data-icu-act="tab:imaging"]'); if(seg) seg.click();
    var body=root.textContent||"";
    return JSON.stringify({ n: im.length, empty: /No imaging reports available/.test(body) });`);
  const I = JSON.parse(iso);
  ok(I.n === 0, "patient isolation: new patient inherits no imaging");
  ok(I.empty === true, "empty state: 'No imaging reports available from Ward Sync for this patient.'");

  // 11) PHI isolation across ward patients — loading a DIFFERENT ward patient drops the prior
  //     patient's radiology (Manual notes preserved). Guards against cross-patient PHI exposure.
  const xp = JSON.parse(await ev(`
    ICU.reset();
    ICU.ingestWardImaging({ patientId:"PA", source:"Ward Sync", imaging:[{reportId:"A1",description:"CT Brain",report:"IMPRESSION: normal study."}] });
    ICU.ingestImaging({ studyName:"Bedside USG", modality:"USG", impressionRaw:"ascites" });
    ICU.ingestWardImaging({ patientId:"PB", source:"Ward Sync", imaging:[{reportId:"B1",description:"X-ray Chest",report:"IMPRESSION: clear lungs."}] });
    var after = ICU.state().imaging;
    return JSON.stringify({
      wardPatients: after.filter(function(r){return r.source==="Ward Sync";}).map(function(r){return r.wardPatientId;}),
      hasManual: after.some(function(r){return r.source==="Manual";}),
      studies: after.map(function(r){return r.studyName;})
    });`));
  ok(xp.wardPatients.length === 1 && xp.wardPatients[0] === "PB", "PHI isolation: switching ward patient drops the prior patient's radiology (only PB remains)");
  ok(xp.hasManual === true && xp.studies.indexOf("CT Brain") < 0 && xp.studies.indexOf("X-ray Chest") >= 0, "manual note preserved across ward switch; patient A's report removed, B's present");

  // 12) id-keyed card actions target the RIGHT record (robust to array reindexing). Click the
  //     2nd card's "Mark reviewed" via its id-based data-icu-act and confirm only it flips.
  const idact = await ev(`
    ICU.reset(); ICU.ingestPatient({name:"IDPT",age:60,sex:"M"});
    ICU.ingestWardImaging({ patientId:"PC", source:"Ward Sync", imaging:[
      {reportId:"C1",description:"USG Abdomen",report:"IMPRESSION: normal."},
      {reportId:"C2",description:"MRI Brain",report:"IMPRESSION: small vessel disease."}]});
    ICU.open(); var root=document.getElementById('icuRoot');
    var wsb=root.querySelector('[data-icu-act="ws:documents"]'); if(wsb) wsb.click();
    var seg=root.querySelector('[data-icu-act="tab:imaging"]'); if(seg) seg.click();
    var cards=root.querySelectorAll('.icu-img-card');
    var btn=cards[1] && cards[1].querySelector('[data-icu-act^="imgreview:"]'); if(btn) btn.click();
    var im=ICU.state().imaging;
    var c1=im.filter(function(r){return r.reportId==="C1";})[0]||{}, c2=im.filter(function(r){return r.reportId==="C2";})[0]||{};
    return JSON.stringify({ c1r: !!c1.reviewed, c2r: !!c2.reviewed, cards: cards.length });`);
  const IA = JSON.parse(idact);
  ok(IA.c2r === true && IA.c1r === false, "id-keyed action toggled the correct record (2nd card reviewed, 1st untouched)");

  console.log(fails === 0 ? "\nALL GREEN — ICU imaging import + notes test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
