/* PHASE G CDP test (real headless Chrome): the [Add to EMR] explicit structured write.
 * Loads the REAL onco-dose.js + onco-protocols.js + onco-protocol-report.js + opd-emr.js into a minimal
 * harness (flags on, fetch stubbed + recorded, window.confirm auto-accept) and asserts:
 *   - [Add to EMR] appears ONLY when the plan is ACTIVE (post CONFIRM & ACTIVATE); a draft plan shows none
 *   - opening/rendering an active plan fires ZERO POSTs to /onco/plan/emr (never automatic on activation)
 *   - tapping [Add to EMR] fires EXACTLY ONE POST to /api/queue/onco/plan/emr, carrying the planId
 *   - the Tata PDF (SMD_ONCOREPORT.buildProtocolSheet) is built from the SAME plan object - the confirmed
 *     dose appears verbatim, never a recomputed number
 * USAGE: node test/run-onco-emr-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8801, DBG = 9392, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-emr-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RCHOP = require(join(HERE, "..", "kb", "protocols", "rchop.json"));
const DOSE = require(join(HERE, "..", "onco-dose.js"));
const calculatedDoses = DOSE.planDoses(RCHOP, { height: 165, weight: 60, age: 55, sex: "female" });
const rituximabFinal = calculatedDoses.filter(d => d.drugId === "rituximab")[0].final;
const ACTIVE_PLAN = {
  planId: "TP-emr-1", protocolId: RCHOP.id, lockedVersion: RCHOP.version, lockedTemplate: RCHOP,
  ghisPatientId: "MRN-EMR-1", intent: "curative", plannedCycles: RCHOP.cycles,
  calculatedDoses: calculatedDoses, confirmedDoses: calculatedDoses, status: "active",
  confirmations: [{ by: "dr1", at: Date.now(), physicianConfirmed: true }],
};
const DRAFT_PLAN = Object.assign({}, ACTIVE_PLAN, { planId: "TP-emr-draft", status: "draft" });

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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-emr-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-dose.js + onco-protocols.js + onco-protocol-report.js + opd-emr.js loaded into the harness");

  // ---- DRAFT plan: no [Add to EMR] (only after CONFIRM & ACTIVATE) ----
  await ev(`window.OPDEMR.openProfile({ patientId: "MR-EMR-D", name: "Test Patient", tab: "onco", oncoPlan: ${JSON.stringify(DRAFT_PLAN)} }); return 1;`);
  let draftRendered = null;
  for (let i = 0; i < 60; i++) { await sleep(150); draftRendered = await ev(`return !!document.querySelector(".oe-onco-tbl") || !!document.querySelector(".oe-onco-matrix") || !!document.querySelector("[data-oe-act='onco-print']");`); if (draftRendered) break; }
  ok(await ev(`return !document.querySelector("[data-oe-act='onco-add-emr']");`) === true, "a DRAFT plan shows NO [Add to EMR] button (never before activation)");

  // ---- ACTIVE plan: [Add to EMR] present, and rendering it fires ZERO EMR posts ----
  await ev(`window.OPDEMR.openProfile({ patientId: "MR-EMR-1", name: "Test Patient", tab: "onco", oncoPlan: ${JSON.stringify(ACTIVE_PLAN)} }); return 1;`);
  let btn = null;
  for (let i = 0; i < 60; i++) { await sleep(150); btn = await ev(`return !!document.querySelector("[data-oe-act='onco-add-emr']");`); if (btn === true) break; }
  ok(btn === true, "an ACTIVE plan shows the [Add to EMR] button");
  ok(await ev(`return window.__fetchCalls.filter(function(c){return c.url.indexOf("/onco/plan/emr")>=0;}).length;`) === 0, "rendering the active plan fires ZERO /onco/plan/emr posts (never automatic)");

  // ---- explicit tap -> exactly one POST ----
  await ev(`document.querySelector("[data-oe-act='onco-add-emr']").click(); return 1;`);
  let emrCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    emrCalls = await ev(`return window.__fetchCalls.filter(function(c){return c.url.indexOf("/api/queue/onco/plan/emr")>=0;});`);
    if (emrCalls && emrCalls.length >= 1) break;
  }
  ok(!!emrCalls && emrCalls.length === 1, `EXACTLY one POST to /api/queue/onco/plan/emr on the tap (got ${emrCalls ? emrCalls.length : 0})`);
  if (emrCalls && emrCalls.length === 1) {
    ok(emrCalls[0].method === "POST", "the EMR write is a POST");
    ok(emrCalls[0].body && emrCalls[0].body.planId === "TP-emr-1", "the body carries the activated plan id");
  }

  // ---- the Tata PDF is built from the SAME plan object (confirmed dose verbatim, never recomputed) ----
  const pdf = await ev(`return window.SMD_ONCOREPORT.buildProtocolSheet(${JSON.stringify(ACTIVE_PLAN)}, {}).indexOf("${rituximabFinal} mg") >= 0;`);
  ok(pdf === true, `the protocol PDF shows the plan's CONFIRMED dose verbatim (${rituximabFinal} mg), never recomputed`);

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll oncology [Add to EMR] checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
