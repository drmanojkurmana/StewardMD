/* StewardMD — TB treatment pathways (PR1 data+logic). Validates the NTEP-sourced SMD_TB engine:
 * DST classification, decision-aware eligible/excluded regimens, and mandatory safety gates.
 * Also prints the coverage matrix (clinical state × pathway × source × gates).
 * USAGE: BASE=http://localhost:5173/ node test/run-tb-pathways.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9537);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/tb-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!window.SMD_TB`) === true) break; }
  const loaded = await ev(`var d=await SMD_TB.ready(); return !!(d&&d.reg&&d.drugs)`);
  chk("SMD_TB loads NTEP-sourced regimen + drug data", loaded === true);

  // 1. Drug-susceptible pulmonary TB → HRZE, no DR-TB drugs by default
  const s1 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({xpertRif:"RIF sensitive"}, {age:40, site:"pulmonary"}))`));
  chk("1. DS pulmonary → HRZE pathway, no DR-TB regimen", s1 && s1.state === "susceptible" && s1.eligible.some(r => r.id === "ds_hrze") && !s1.eligible.some(r => ["bpalm","shorter_oral","longer_oral"].includes(r.id)), s1 && s1.eligible.map(r=>r.id).join(","));
  // 2. Rifampicin-resistant → DR-TB pathway opens (real regimens, not vague)
  const s2 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({xpertRif:"RIF resistant"}, {age:35, site:"pulmonary"}))`));
  chk("2. RR-TB → DR-TB pathway opens with BPaLM (not a vague card)", s2 && s2.state === "rr" && s2.eligible[0] && s2.eligible[0].id === "bpalm", s2 && s2.eligible.map(r=>r.id).join(","));
  // 3. Fluoroquinolone resistance → pre-XDR; shorter oral excluded/not offered; BPaLM still eligible
  const s3 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({xpertRif:"RIF resistant", fqSusceptibility:"resistant"}, {age:35, site:"pulmonary"}))`));
  chk("3. FQ resistance → pre-XDR; shorter-oral not offered; BPaLM eligible", s3 && s3.state === "pre_xdr" && s3.eligible.some(r=>r.id==="bpalm") && !s3.eligible.some(r=>r.id==="shorter_oral"), s3 && s3.eligible.map(r=>r.id).join(","));
  // 4. Bedaquiline (BPaLM) eligibility → ECG/QTc, cardiac/interaction, CBC, DST gates
  const g4 = J(await ev(`return JSON.stringify(SMD_TB.safetyGates("bpalm", {}))`));
  chk("4. BPaLM shows ECG/QTc + cardiac-interaction + CBC gates (missing when no data)", g4 && g4.some(g=>g.id==="qt_ecg"&&!g.satisfied) && g4.some(g=>g.id==="cardiac_interactions") && g4.some(g=>g.id==="cbc_neuropathy"), g4 && g4.map(g=>g.id).join(","));
  // 5. Linezolid → CBC, neuropathy, optic monitoring + toxicity flags
  const d5 = J(await ev(`return JSON.stringify(SMD_TB.drug("linezolid"))`));
  chk("5. Linezolid flags myelosuppression + neuropathy + optic/CBC monitoring", d5 && d5.myelosuppressionFlag && d5.neuropathyFlag && /CBC/i.test(d5.ongoingMonitoring.join(" ")) && /colour vision|optic/i.test(d5.ongoingMonitoring.join(" ")));
  // 6. Rifampicin interaction → warfarin/DOAC + hormonal contraception
  const d6 = J(await ev(`return JSON.stringify(SMD_TB.drug("rifampicin"))`));
  chk("6. Rifampicin interactions include contraception + warfarin/DOAC", d6 && /contracept/i.test(d6.interactions.join(" ")) && /warfarin|doac/i.test(d6.interactions.join(" ")));
  // 7. Renal impairment → renal gate required on DR-TB regimens; renal pathway exists
  const g7 = J(await ev(`return JSON.stringify(SMD_TB.safetyGates("longer_oral", {}))`));
  const hasRenalReg = await ev(`return (SMD_TB.data().reg.regimens||[]).some(function(r){return r.id==="renal_pathway";})`);
  chk("7. Renal review gate required + dedicated renal pathway exists", g7 && g7.some(g=>g.id==="renal"&&!g.satisfied) && hasRenalReg === true);
  // 8. Liver injury → hepatotoxicity pathway; BPaLM excluded on significant liver dysfunction
  const s8 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({xpertRif:"RIF resistant"}, {age:40, site:"pulmonary", liverDysfunction:true}))`));
  const hasHepReg = await ev(`return (SMD_TB.data().reg.regimens||[]).some(function(r){return r.id==="hepatotoxicity_pathway";})`);
  chk("8. Significant liver dysfunction excludes BPaLM (reason) + DILI pathway exists", s8 && s8.excluded.some(r=>r.id==="bpalm"&&/liver/i.test(r.why)) && hasHepReg === true, s8 && (s8.excluded.find(r=>r.id==="bpalm")||{}).why);
  // 9. TB meningitis → BPaLM excluded (severe EP); CNS pathway exists
  const s9 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({xpertRif:"RIF resistant"}, {age:40, site:"cns"}))`));
  const hasCns = await ev(`return (SMD_TB.data().reg.regimens||[]).some(function(r){return r.id==="cns_tb";})`);
  chk("9. TB meningitis → BPaLM excluded (severe EP) + CNS pathway exists", s9 && s9.excluded.some(r=>r.id==="bpalm"&&/extrapulmonary|CNS/i.test(r.why)) && hasCns === true);
  // 10. Missing DST → 'DST pending'; no definitive DR-TB regimen recommended
  const s10 = J(await ev(`return JSON.stringify(SMD_TB.eligibleRegimens({}, {age:40, site:"pulmonary"}))`));
  chk("10. Missing DST → 'DST pending'; no DR-TB regimen by default", s10 && s10.state === "dst_pending" && !s10.eligible.some(r=>["bpalm","shorter_oral","longer_oral"].includes(r.id)), s10 && s10.state);

  // ---- PR2: decision-aware TB workspace UI ----
  await ev(`await SMD_TB.ready();
    var oa=document.getElementById("outputArea")||(function(){var d=document.createElement("div");d.id="outputArea";document.body.appendChild(d);return d;})();
    oa.innerHTML='<div class="card"><h2>Alternative regimens</h2>Modified regimens per drug-susceptibility testing</div><div class="qa-regimen">Isoniazid + Rifampicin + Pyrazinamide + Ethambutol (HRZE)</div>';
    window.__tbr = SMD_TB.renderWorkspace({age:35, site:"pulmonary"}, "PULMONARY_TB");
    return 1;`);
  const lines = () => ev(`var l=document.getElementById("smdTbLines");return l?l.innerText:""`);
  chk("UI: TB workspace injected on a TB render", await ev(`return String(window.__tbr)`) === "true" && await ev(`return !!(document.getElementById("smdTbCard")&&document.getElementById("smdTbInputs"))`) === true);
  chk("UI: vague 'Modified regimens per DST' card hidden", await ev(`var els=[].slice.call(document.querySelectorAll("#outputArea .card"));var v=els.filter(function(n){return /modified regimens per drug-susceptibility/i.test(n.textContent);})[0];return v? v.style.display==="none":true`) === true);
  chk("UI: DST-pending state shown by default (no DR regimen)", /pending/i.test(await ev(`var l=document.getElementById("smdTbLines");return l?l.innerText:""`)));
  // set RIF resistant → BPaLM eligible card with "Why this regimen"
  await ev(`function setSel(k,v){var el=document.querySelector('#smdTbInputs [data-tb="'+k+'"]');el.value=v;el.dispatchEvent(new Event("change",{bubbles:true}));} setSel("xpertRif","RIF resistant"); return 1;`);
  const t1 = await lines();
  chk("UI: RIF resistant → BPaLM eligible card + 'Why this regimen'", /Rifampicin-resistant|RR-TB/i.test(t1) && /BPaLM/i.test(t1) && /Why this regimen/i.test(t1), t1.replace(/\n/g," ").slice(0,90));
  // set FQ resistant → pre-XDR; shorter not offered
  await ev(`var el=document.querySelector('#smdTbInputs [data-tb="fqSusceptibility"]');el.value="resistant";el.dispatchEvent(new Event("change",{bubbles:true}));return 1;`);
  const t2 = await lines();
  const eligTitles = await ev(`return [].slice.call(document.querySelectorAll("#smdTbLines .smd-tb-reg.elig h4")).map(function(h){return h.textContent;}).join(" | ")`);
  chk("UI: FQ resistant → pre-XDR; shorter-oral not an eligible card", /pre-XDR/i.test(t2) && /BPaLM/i.test(String(eligTitles)) && !/shorter oral/i.test(String(eligTitles)), "eligible: " + String(eligTitles).slice(0, 90));
  // liver dysfunction → BPaLM excluded (why not)
  await ev(`var c=document.querySelector('#smdTbInputs [data-tb="liverDysfunction"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}));return 1;`);
  chk("UI: liver dysfunction → BPaLM shown as excluded with reason", /Why not eligible/i.test(await lines()) && /liver/i.test(await lines()));
  chk("UI: sources shown (NTEP)", /NTEP|Drug-Resistant TB/i.test(await lines()));
  // PR3: special populations + guideline reference
  chk("PR3: special situations cover 8 populations (NTEP §3.9)", await ev(`return SMD_TB.specialSituations().length`) === 8);
  chk("PR3: HIV special situation flags efavirenz ↓ bedaquiline/pretomanid", await ev(`return SMD_TB.specialSituations().some(function(s){return s.id==="hiv" && /efavirenz/i.test(s.guidance);})`) === true);
  chk("PR3: pregnancy guidance present (BPaLM restriction + Lzd shorter regimen)", await ev(`return SMD_TB.specialSituations().some(function(s){return s.id==="pregnancy" && /BPaLM/i.test(s.guidance) && /shorter oral/i.test(s.guidance);})`) === true);
  chk("PR3: guideline reference exposes NTEP + WHO + Harrison", await ev(`var g=SMD_TB.guidelines();return g.length>=3 && g.some(function(x){return /NTEP|Drug-Resistant TB/i.test(x.title+" "+x.body);}) && g.some(function(x){return /WHO|World Health/i.test(x.title+" "+x.body);}) && g.some(function(x){return /Harrison|internal-medicine/i.test(x.title+" "+x.body);});`) === true);
  chk("PR3 UI: 'Special populations' + '📖 Guideline reference' rendered in workspace", /Special populations/i.test(await lines()) && /Guideline reference/i.test(await lines()));

  // ---- coverage matrix ----
  const cov = J(await ev(`var d=SMD_TB.data(); return JSON.stringify((d.reg.regimens||[]).map(function(r){return {id:r.id, states:(r.forStates||[]).join("/"), source:(r.source||"").split(";")[0]};}));`));
  console.log("\n  Coverage matrix (regimen × states × source):");
  (cov||[]).forEach(r => console.log(`   • ${r.id.padEnd(22)} states=${r.states.padEnd(28)} src=${r.source}`));

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — TB pathways (PR1)"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
