/* ONCQIS Phase D CDP test (real headless Chrome): the doctor FIND -> COMPARE -> SELECT -> patient-
 * specific Tata digital-protocol flow, end to end, from the REAL onco-plan-flow.js against fixture
 * ACTIVE Standard Protocols + a patient phenotype. Mirrors run-onco-p1-ui.mjs (serve + Chrome + CDP).
 * Asserts:
 *   - openFind renders the APPLICABLE list WITH the "why suggested" rationale + evidence status
 *   - a contradicted (wrong-disease) protocol is excluded; the honest empty + "1 applicable" states render
 *   - NOTHING is selected until an explicit SELECT click (no auto-select): _st.digital null, no matrix
 *   - COMPARE renders the side-by-side (both regimens + cycle + evidence status)
 *   - SELECT (explicit click) renders the Tata matrix with patient-specific PROPOSED doses, a visible
 *     dose lineage, "X / Not scheduled" for an absent cycle, and all 6 action buttons
 * USAGE: node test/run-onco-flow-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8803, DBG = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-flow-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-flow-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-plan-flow.js + recommend + matrix + dose + evidence loaded into the harness");

  // ---- honest empty + "1 applicable" states, via the pure renderFind (no fabricated protocol) ----
  const emptyHtml = (await ev(`return window.SMD_ONCOFLOW.renderFind({diseaseId:"dlbcl"}, []);`)) || "";
  ok(/No applicable ACTIVE Standard Protocol - none published yet/.test(emptyHtml), "no ACTIVE protocols -> honest 'none published yet' (never fabricated)");
  const oneHtml = (await ev(`return window.SMD_ONCOFLOW.renderFind(window.__ctx && window.SMD_ONCOFLOW.derivePhenotype(window.__ctx), [window.__protocols[0]]);`)) || "";
  ok(/1 applicable protocol identified - review required/.test(oneHtml), "exactly one applicable -> the 'review required' header note renders");

  // ---- openFind: applicable list with rationale + evidence status; wrong disease excluded ----
  await ev(`window.SMD_ONCOFLOW.openFind(window.__ctx, window.__protocols); return 1;`);
  await sleep(250);
  ok(await ev(`return !!(document.getElementById("smdOncoFlow") && document.getElementById("smdOncoFlow").classList.contains("on"));`) === true, "openFind opens the flow overlay (#smdOncoFlow)");
  const find = (await ev(`return document.getElementById("smdOncoFlow").textContent || "";`)) || "";
  ok(/APPLICABLE STANDARD PROTOCOLS/.test(find), "the APPLICABLE STANDARD PROTOCOLS list renders");
  ok(/FX R-CHOP-D/.test(find) && /FX DLBCL Alt/.test(find), "both matching DLBCL protocols are listed");
  ok(!/FX NSCLC regimen/.test(find), "the contradicted (wrong-disease) NSCLC protocol is excluded");
  ok(/Why suggested:/.test(find) && /Confirmed matches/.test(find), "each entry shows the 'why suggested' rationale");
  ok(/Evidence status:/.test(find), "each entry shows evidence status");
  ok(/Matched criteria:/.test(find) && /disease/.test(find), "matched criteria are shown");
  const nSelectBtns = await ev(`return document.querySelectorAll('#smdOncoFlow [data-of-act^="select:"]').length;`);
  ok(Number(nSelectBtns) === 2, `a SELECT button per applicable protocol (${nSelectBtns})`);

  // ---- HARD RULE: nothing selected until an explicit click (no auto-select) ----
  ok(await ev(`return window.SMD_ONCOFLOW._st.digital === null;`) === true, "no protocol is auto-selected on openFind (_st.digital is null)");
  ok(await ev(`return !document.querySelector('#smdOncoFlow .oe-onco-tbl');`) === true, "no Tata matrix is rendered before an explicit SELECT");

  // ---- COMPARE: select two, render side-by-side ----
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="cmp:fx-dlbcl-rchopd"]').click(); return 1;`); await sleep(120);
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="cmp:fx-dlbcl-alt"]').click(); return 1;`); await sleep(120);
  ok(await ev(`return !!document.querySelector('#smdOncoFlow [data-of-act="cmp-go"]');`) === true, "the COMPARE bar appears once two protocols are selected");
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="cmp-go"]').click(); return 1;`); await sleep(150);
  const cmp = (await ev(`return document.getElementById("smdOncoFlow").textContent || "";`)) || "";
  ok(/COMPARE PROTOCOLS/.test(cmp), "the side-by-side COMPARE view renders");
  ok(/FX R-CHOP-D/.test(cmp) && /FX DLBCL Alt/.test(cmp), "both protocols appear side by side");
  ok(/Rituximab/.test(cmp) && /Cyclophosphamide/.test(cmp), "the compare shows each regimen");
  ok(/Cycle length/.test(cmp) && /Evidence status/.test(cmp), "the compare shows cycle + evidence status");
  ok(await ev(`return window.SMD_ONCOFLOW._st.digital === null;`) === true, "COMPARE still selects nothing (no auto-select)");

  // ---- back to FIND, then explicit SELECT -> the patient-specific Tata digital protocol ----
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="find"]').click(); return 1;`); await sleep(120);
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="select:fx-dlbcl-rchopd"]').click(); return 1;`); await sleep(200);
  ok(await ev(`return window.SMD_ONCOFLOW._st.digital !== null;`) === true, "an explicit SELECT click builds the in-memory digital protocol");
  const dp = (await ev(`return document.getElementById("smdOncoFlow").textContent || "";`)) || "";
  ok(/PATIENT-SPECIFIC DIGITAL PROTOCOL/.test(dp), "the patient-specific digital protocol renders");
  ok(/Test Patient/.test(dp) && /MR-1001/.test(dp), "header shows patient + MRN");
  ok(/BSA/.test(dp) && /m2 \(computed\)/.test(dp), "header shows the computed BSA");
  ok(/Diffuse large B-cell lymphoma/.test(dp) && /Standard Protocol/.test(dp) && /Protocol version/.test(dp) && /Number of cycles/.test(dp), "header shows diagnosis / selected protocol / version / cycles");
  ok(await ev(`return !!document.querySelector('#smdOncoFlow .oe-onco-tbl');`) === true, "the Tata drug x cycle matrix renders");

  // patient-specific PROPOSED dose: rituximab 375 mg/m2 x BSA(165cm,60kg ~1.65) -> 618.75 -> round50 -> 600 mg
  const bsa = await ev(`return window.SMD_ONCODOSE.bsaMosteller(165,60);`);
  ok(Number(bsa) > 1.6 && Number(bsa) < 1.7, `BSA computes (~${bsa})`);
  ok(/600 mg/.test(dp), "the matrix shows a patient-specific PROPOSED dose (rituximab 600 mg), never invented");
  ok(/Not scheduled/.test(dp), "a drug absent from a cycle shows 'X / Not scheduled' (prednisolone cycles 2 and 3)");

  // ---- full lineage visible (HARD RULE) ----
  ok(/Dose lineage \(patient-specific\)/.test(dp), "the dose lineage section is visible on the SELECT screen");
  ok(/protocol 375 mg\/m2/.test(dp) && /calculated/.test(dp) && /proposed 600 mg/.test(dp), "the lineage shows protocol dose -> calculated -> proposed");

  // ---- all 6 action buttons ----
  for (const a of ["edit", "viewcalc", "viewev", "compareguide", "print", "create"]) {
    ok(await ev(`return !!document.querySelector('#smdOncoFlow [data-of-act="${a}"]');`) === true, `action button present: ${a}`);
  }
  // VIEW CALCULATION opens the full lineage drawer (reuses SMD_ONCOUI.doseDrawerView)
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="viewcalc"]').click(); return 1;`); await sleep(150);
  ok(/Protocol dose/i.test((await ev(`return document.getElementById("smdOncoFlow").textContent||"";`)) || ""), "VIEW CALCULATION opens the detailed dose-lineage drawer");
  await ev(`var b=document.querySelector('#smdOncoFlow [data-oe-act="onco-drawer-close"]'); if(b)b.click(); return 1;`); await sleep(120);

  // CREATE TREATMENT PLAN emits an event and does NOT persist (Phase F)
  await ev(`document.querySelector('#smdOncoFlow [data-of-act="create"]').click(); return 1;`); await sleep(120);
  ok((await ev(`return (window.__flowEvents||[]).indexOf("create")>=0;`)) === true, "CREATE TREATMENT PLAN emits a smd-onco-flow event (no persistence in Phase D)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll Onco Phase D flow checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
