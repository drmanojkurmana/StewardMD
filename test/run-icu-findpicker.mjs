/* ICU Clinical Complaint Autocomplete + Structured Finding Picker test.
 *
 * Proves the standalone clinical vocabulary (window.SMD_VOCAB) + the ICU finding picker:
 *  - deterministic LOCAL autocomplete (prefix > token > synonym > typo), NEVER AI;
 *  - abbreviation / shorthand / b-l expansion; word-boundary matching (no mid-word noise);
 *  - red flags never hidden across workspaces; results grouped by category;
 *  - picking adds a structured chip {canonicalFindingId, polarity, temporality, source, clinicianConfirmed};
 *  - dedupe, modifier cycle, remove, compound (multi-chip) selection;
 *  - free-text "Add as note" + deterministic "Extract findings" (SMD_NLP) with clinician review
 *    (negation-safe, NEVER auto-added);
 *  - the picker is DOCUMENTATION only — it never feeds the reasoning engine / changes scoring;
 *  - findings are patient-scoped (reset on a new patient).
 *
 * Does NOT modify reasoning/ranking, disease signatures, MaiK, Ward Sync auth, or ICU calculations.
 * USAGE: node test/run-icu-findpicker.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-findpicker-chrome";
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
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });   // mobile viewport so the bottom-sheet/nav overlap check is faithful
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.openFindingPicker && window.SMD_VOCAB && SMD_VOCAB.search && window.SMD_NLP && SMD_NLP.extract)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU + SMD_VOCAB + SMD_NLP not loaded");
  await ev(`["smdBootSplash","introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  const top = (q, ws2) => `SMD_VOCAB.search(${JSON.stringify(q)},{workspace:${JSON.stringify(ws2 || "im")},limit:8}).results`;

  // 1) prefix precision — deterministic local search, NEVER AI
  const t1 = await J(`return JSON.stringify({head:(${top("head")}[0]||{}).label, quad:(${top("quad")}[0]||{}).label});`);
  ok(/headache/i.test(t1.head) && /quadripar/i.test(t1.quad), `prefix precision: "head"→${t1.head}, "quad"→${t1.quad}`);

  // 2) typo tolerance (Levenshtein, distance-gated)
  const t2 = await J(`return JSON.stringify({a:(${top("aniscoria")}[0]||{}).label, b:(${top("quadriperesis")}[0]||{}).label});`);
  ok(/anisocoria/i.test(t2.a) && /quadripar/i.test(t2.b), `typo tolerance: "aniscoria"→${t2.a}, "quadriperesis"→${t2.b}`);

  // 3) abbreviation / shorthand / b-l expansion
  const t3 = await J(`return JSON.stringify({ams:(${top("ams")}[0]||{}).label, sob:(${top("sob")}[0]||{}).label, bl:(${top("b/l plant")}[0]||{}).label});`);
  ok(/altered sensorium/i.test(t3.ams) && /breathless/i.test(t3.sob) && /extensor plantar/i.test(t3.bl), `shorthand: ams→${t3.ams}, sob→${t3.sob}, b/l plant→${t3.bl}`);

  // 4) ranking tiebreak — a cleaner prefix match beats a red-flag that only tied on the nudge
  const t4 = await J(`return JSON.stringify((${top("vom")}).map(function(x){return x.label;}).slice(0,3));`);
  ok(/vomiting/i.test(t4[0]) && !/haemat|hemat/i.test(t4[0]), `ranking tiebreak: "vom"→${t4[0]} (Vomiting before haematemesis)`);

  // 5) word-boundary matching — "ear" must not match inside "heart"
  const t5 = await J(`return JSON.stringify((${top("ear")}).map(function(x){return x.label;}));`);
  ok(t5.some(function (l) { return /ear discharge|mastoid/i.test(l); }) && !t5.some(function (l) { return /tachycardia|bradycardia/i.test(l); }), `word-boundary: "ear"→${t5.slice(0, 3).join(", ")} (no heart-rate noise)`);

  // 6) red flags never hidden across workspaces (Stridor is ENT-only + red, still surfaces in IM)
  const t6 = await J(`return JSON.stringify((${top("stridor", "im")}).map(function(x){return x.label;}));`);
  ok(t6.some(function (l) { return /stridor/i.test(l); }), `emergency finding never hidden: "stridor" in IM → ${t6.slice(0, 2).join(", ")}`);

  // 7) maps to EXISTING canonical engine finding IDs; every result carries a display group
  const t7 = await J(`
    var r=${top("quad")};
    var chips=SMD_VOCAB.toChips("quadriparesis");
    return JSON.stringify({ cid:(chips[0]||{}).canonicalFindingId, grouped: r.every(function(x){return !!x.group;}) });
  `);
  ok(t7.cid === "focalNeuroDeficit" && t7.grouped === true, `canonical mapping: quadriparesis→${t7.cid}; all results grouped=${t7.grouped}`);

  // 8) the picker button lives in Care Plan → Diagnosis and opens the modal sheet
  const t8 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP1",age:60,sex:"M"}); ICU.open('dx');   // v2: patient workspace on Care Plan → Diagnosis
    var cp=document.querySelector('[data-icu-act="ws:careplan"]'); if(cp) cp.click();
    var btn=document.querySelector('[data-icu-act="findpick"]'); var hadBtn=!!btn; if(btn) btn.click();
    return JSON.stringify({ hadBtn:hadBtn, sheet:!!document.getElementById('icuFindSheet'), input:!!document.getElementById('icuFindQ') });
  `);
  ok(t8.hadBtn && t8.sheet && t8.input, `"Add findings" button in Care Plan → Diagnosis opens the picker modal`);

  // 9) typing renders a GROUPED dropdown of hits (debounced ~120ms local)
  await ev(`var i=document.getElementById('icuFindQ'); if(i){ i.value="head"; i.dispatchEvent(new Event('input',{bubbles:true})); } return 1;`);
  await sleep(260);
  const t9 = await J(`return JSON.stringify({ hits:document.querySelectorAll('#icuFindRes .icu-find-hit').length, hdrs:document.querySelectorAll('#icuFindRes .icu-find-cath').length, first:(document.querySelector('#icuFindRes .icu-find-hit .nm')||{}).textContent||"" });`);
  ok(t9.hits > 0 && t9.hdrs > 0 && /headache/i.test(t9.first), `typing "head" → grouped dropdown (${t9.hits} hits, ${t9.hdrs} group headers, first=${t9.first})`);

  // 10) tapping a hit adds a structured, clinician-confirmed chip (documentation only)
  const t10 = await J(`
    var h=document.querySelector('#icuFindRes .icu-find-hit[data-find="headache"]') || document.querySelector('#icuFindRes .icu-find-hit');
    if(h) h.click();
    var f=(ICU.state().findings||[])[0]||{};
    return JSON.stringify(f);
  `);
  ok(t10.canonicalFindingId === "headache" && t10.polarity === "present" && t10.temporality === "current" && t10.source === "manual_picker" && t10.clinicianConfirmed === true && t10.inReasoning === true,
    `tap → structured chip {cid:${t10.canonicalFindingId}, polarity:${t10.polarity}, temporality:${t10.temporality}, source:${t10.source}, confirmed:${t10.clinicianConfirmed}}`);

  // 11) dedupe — the same finding is not added twice
  const t11 = await J(`
    var before=(ICU.state().findings||[]).length;
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker");
    return JSON.stringify({before:before, after:(ICU.state().findings||[]).length});
  `);
  ok(t11.after === t11.before, `dedupe: re-adding "headache" keeps count at ${t11.after}`);

  // 12) modifier cycle — driving the ACTUAL ▾ button in the modal (not the primitives):
  //     present→absent→possible→historical→resolved→present, mapped to {polarity, temporality}
  const t12 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FPM",age:55,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker");
    ICU.openFindingPicker();
    function st(){ var f=ICU.state().findings[0]; return f.polarity+"/"+f.temporality; }
    var seq=[]; for(var i=0;i<6;i++){ seq.push(st()); var m=document.querySelector('.icu-find-chips [data-icu-act^="findmod"]'); if(m) m.click(); }
    return JSON.stringify(seq);
  `);
  ok(t12[0] === "present/current" && t12[1] === "absent/current" && t12[2] === "possible/current" && t12[3] === "present/historical" && t12[4] === "present/resolved" && t12[5] === "present/current",
    `▾ modifier cycle (via UI): ${t12.join(" → ")}`);

  // 13) remove — findrm drops the chip
  const t13 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP2",age:50,sex:"F"});
    ICU._addFindingChip({canonicalFindingId:"fever",displayLabel:"Fever",inReasoning:true},"manual_picker");
    var before=(ICU.state().findings||[]).length;
    ICU.openFindingPicker();
    var x=document.querySelector('.icu-find-chips [data-icu-act^="findrm"]'); if(x) x.click();
    return JSON.stringify({before:before, after:(ICU.state().findings||[]).length});
  `);
  ok(t13.before === 1 && t13.after === 0, `remove: × drops the chip (${t13.before}→${t13.after})`);

  // 14) compound selection adds MULTIPLE canonical chips
  const t14 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP3",age:44,sex:"M"});
    (SMD_VOCAB.toChips("headache_vomiting")||[]).forEach(function(ch){ ICU._addFindingChip(ch,"manual_picker"); });
    return JSON.stringify((ICU.state().findings||[]).map(function(f){return f.canonicalFindingId;}));
  `);
  ok(t14.length === 2 && t14.indexOf("headache") >= 0 && t14.indexOf("nauseaVomiting") >= 0, `compound "Headache with vomiting" → ${t14.join(" + ")}`);

  // 15) free-text "Extract findings" — deterministic SMD_NLP, negation-safe, review-first (NOT auto-added)
  const t15 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP4",age:60,sex:"M"});
    ICU.openFindingPicker();
    var fa=document.getElementById('icuFindFree'); if(fa){ fa.value="60M no fever, headache and vomiting"; }
    var ex=document.getElementById('icuFindExtract'); if(ex) ex.click();
    var sugg=Array.prototype.map.call(document.querySelectorAll('#icuFindRes .icu-find-hit'),function(b){return b.getAttribute('data-find');});
    return JSON.stringify({ sugg:sugg, autoAdded:(ICU.state().findings||[]).length, feverSuggested: sugg.indexOf('fever')>=0 });
  `);
  ok(t15.sugg.indexOf("headache") >= 0 && t15.sugg.indexOf("vomiting") >= 0 && !t15.feverSuggested && t15.autoAdded === 0,
    `Extract: review-first suggestions [${t15.sugg.join(", ")}]; negated "fever" excluded; auto-added=${t15.autoAdded}`);

  // 16) tapping an extracted suggestion then adds it; "Add as note" appends to complaints
  const t16 = await J(`
    var h=document.querySelector('#icuFindRes .icu-find-hit[data-find="headache"]'); if(h) h.click();
    var addedCid=((ICU.state().findings||[])[0]||{}).canonicalFindingId;
    ICU.openFindingPicker();
    var fa=document.getElementById('icuFindFree'); if(fa){ fa.value="chest tightness on exertion"; }
    var nb=document.getElementById('icuFindNote'); if(nb) nb.click();
    return JSON.stringify({ addedCid:addedCid, complaints:ICU.state().patient.complaints||"" });
  `);
  ok(t16.addedCid === "headache" && /chest tightness/i.test(t16.complaints), `reviewed suggestion added (${t16.addedCid}); "Add as note" → complaints`);

  // 17) documentation-only — findings live in state, run through the LIVE recompute()/alert pipeline
  //     (recompute is scheduled via rAF → await it), and never perturb the derived clinical outputs
  await ev(`ICU.reset(); ICU.ingestPatient({name:"FP5",age:70,sex:"M"}); ICU.ingestLabs({k:6.8}); return 1;`);
  await sleep(150);
  const before17 = await ev(`return JSON.stringify((ICU.state().alerts||[]).map(function(a){return a.title;}));`);
  await ev(`ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker"); ICU._addFindingChip({canonicalFindingId:"seizure",displayLabel:"Seizure",inReasoning:true},"manual_picker"); return 1;`);
  await sleep(150);
  const t17 = await J(`return JSON.stringify({after:JSON.stringify((ICU.state().alerts||[]).map(function(a){return a.title;})), findings:(ICU.state().findings||[]).length});`);
  ok(t17.findings === 2 && t17.after === before17 && /hyperkal/i.test(before17), `documentation-only: adding findings did not perturb recompute-derived alerts (pipeline live: ${JSON.parse(before17 || "[]").length} alerts, unchanged)`);

  // 18) patient isolation — a new patient starts with no findings
  const t18 = await J(`ICU.reset(); ICU.ingestPatient({name:"FP6",age:33,sex:"F"}); return JSON.stringify({n:(ICU.state().findings||[]).length});`);
  ok(t18.n === 0, `patient isolation: new patient has no inherited findings`);

  // 19) negation cue typed into the AUTOCOMPLETE → the chip is documented as ABSENT (not present)
  const t19 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP7",age:48,sex:"M"});
    ICU.openFindingPicker();
    var i=document.getElementById('icuFindQ'); if(i){ i.value="no fever"; i.dispatchEvent(new Event('input',{bubbles:true})); }
    return 1;
  `);
  await sleep(260);
  const t19b = await J(`
    var h=document.querySelector('#icuFindRes .icu-find-hit[data-find="fever"]') || document.querySelector('#icuFindRes .icu-find-hit');
    if(h) h.click();
    var f=(ICU.state().findings||[])[0]||{};
    return JSON.stringify({cid:f.canonicalFindingId, polarity:f.polarity, temporality:f.temporality});
  `);
  ok(t19b.cid === "fever" && t19b.polarity === "absent", `negation in autocomplete: "no fever" → chip documented ABSENT (${t19b.polarity})`);

  // 20) re-picking an existing finding updates its polarity (latest action wins; no duplicate, no stale state)
  const t20 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP8",age:52,sex:"F"});
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",polarity:"absent",temporality:"current"},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",polarity:"present",temporality:"current"},"manual_picker");
    var f=ICU.state().findings;
    return JSON.stringify({count:f.length, polarity:(f[0]||{}).polarity});
  `);
  ok(t20.count === 1 && t20.polarity === "present", `re-pick updates in place: count ${t20.count}, polarity now ${t20.polarity} (was absent)`);

  // 21) documented findings flow into the Daily ICU summary (documentation purpose)
  const t21 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"FP9",age:66,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"fever",displayLabel:"Fever",polarity:"absent",inReasoning:true},"manual_picker");
    return JSON.stringify({s: ICU.summary(ICU.state())});
  `);
  ok(/CLINICAL FINDINGS:/.test(t21.s) && /Headache/.test(t21.s) && /No Fever/.test(t21.s), `findings appear in the Daily ICU summary (incl. "No Fever")`);

  // 22) chips SAVE + REOPEN correctly for the selected patient (local roster; polarity preserved)
  const t22 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"SMOKE-SAVE",age:60,sex:"M"});
    ICU._addFindingChip({canonicalFindingId:"headache",displayLabel:"Headache",inReasoning:true},"manual_picker");
    ICU._addFindingChip({canonicalFindingId:"fever",displayLabel:"Fever",polarity:"absent",inReasoning:true},"manual_picker");
    ICU.savePatient();
    var id = ICU.state().patient._id;
    ICU.newPatient();
    var cleared = (ICU.state().findings||[]).length;
    ICU.loadPatient(id);
    var restored = (ICU.state().findings||[]).map(function(c){return c.canonicalFindingId+":"+c.polarity;});
    return JSON.stringify({ cleared:cleared, restored:restored });
  `);
  ok(t22.cleared === 0 && t22.restored.indexOf("headache:present") >= 0 && t22.restored.indexOf("fever:absent") >= 0,
    `chips save + reopen for the selected patient (cleared→${t22.cleared}, restored [${t22.restored.join(", ")}])`);

  // 23) mobile bottom-sheet does NOT overlap the ICU navigation chrome: the sheet covers the viewport
  //     bottom, the modal layer sits above the ICU root, and no v2 nav chrome (bottom bar / top-tabs /
  //     sub-nav) is the topmost element at the bottom while the picker is open. (v2: the picker opens
  //     from the Care Plan → Diagnosis workspace.)
  const t23 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"SMOKE-NAV",age:55,sex:"F"}); ICU.open('dx');
    var cp=document.querySelector('[data-icu-act="ws:careplan"]'); if(cp) cp.click();
    var icuRoot=document.getElementById('icuRoot'); var rootZ = icuRoot ? (+getComputedStyle(icuRoot).zIndex||0) : -1;
    ICU.openFindingPicker();
    var sheet=document.getElementById('icuFindSheet'), modal=document.getElementById('icuModal');
    var modalZ = +getComputedStyle(modal).zIndex||0, sr = sheet ? sheet.getBoundingClientRect() : null;
    var bx=Math.round(window.innerWidth/2), by=Math.round(window.innerHeight-4);   // bottom-centre = where any nav bar would sit
    var topEl=document.elementFromPoint(bx, by);
    return JSON.stringify({
      rootPresent: !!icuRoot, sheetPresent: !!sheet,
      sheetReachesBottom: !!(sr && sr.bottom >= window.innerHeight-1),
      modalAboveRoot: modalZ > rootZ,
      bottomTopIsModalLayer: !!(topEl && (topEl.closest('#icuFindSheet') || topEl.id==='icuModal')),
      bottomTopIsNav: !!(topEl && (topEl.closest('.icu-v2-bottombar') || topEl.closest('.icu-v2-tabs') || topEl.closest('.icu-subnav')))
    });
  `);
  ok(t23.rootPresent && t23.sheetPresent && t23.sheetReachesBottom && t23.modalAboveRoot && t23.bottomTopIsModalLayer && !t23.bottomTopIsNav,
    `bottom-sheet does not overlap ICU nav (sheet reaches viewport bottom, modal above the ICU root, no nav chrome topmost)`);

  console.log(fails === 0 ? "\nALL GREEN — ICU finding picker test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
