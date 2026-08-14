/* Phase 5 gap-fix CDP test (real headless Chrome): closes the two gaps left after Phase 5.
 *   (a) NURSE READ - a fresh session with NO injected cycle object (the real nurse case, not the
 *       test seam) opens the Oncology tab in nurse view with only an `oncoCycleId`. Asserts the
 *       client fires GET /api/queue/onco/cycle and renders the give-list + admin table from the
 *       FETCHED cycle/adminRecords, not from any locally-cached plan value.
 *   (b) DOCTOR clearance/cycle-management - [Create cycle N], toggle clearance checks, [Resolve
 *       clearance], then [Confirm cycle to ready]. Asserts the confirm action is DISABLED until the
 *       cycle's own persisted clearance.status is "cleared", and that each action fires exactly the
 *       one POST it should, only after the confirm() gate (stubbed to auto-accept).
 * Loads the REAL onco-dose.js + onco-protocols.js + onco-nurse.js + opd-emr.js into a minimal harness
 * (flags stubbed on, fetch stubbed + every call RECORDED, window.confirm stubbed to auto-accept).
 * USAGE: node test/run-onco-cycle-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8796, DBG = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-cycle-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RCHOP = require(join(HERE, "..", "kb", "protocols", "rchop.json"));
const DOSE = require(join(HERE, "..", "onco-dose.js"));
const calculatedDoses = DOSE.planDoses(RCHOP, { height: 165, weight: 60, age: 55, sex: "female" });
const rituximabFinal = calculatedDoses.filter(d => d.drugId === "rituximab")[0].final;
const CYCLE_ID = "TP-fixture__1";

const FIXTURE_PLAN = {
  planId: "TP-fixture", protocolId: RCHOP.id, ghisPatientId: "MRN-CDP-2", lockedTemplate: RCHOP,
  plannedCycles: RCHOP.cycles, calculatedDoses: calculatedDoses, confirmedDoses: calculatedDoses, status: "active",
};
// The cycle the CREATE stub hands back: freshly planned, clearance untouched ("pending") - drives
// the doctor create -> toggle checks -> resolve -> confirm sequence.
const CREATED_CYCLE = {
  cycleId: CYCLE_ID, planId: "TP-fixture", cycleNo: 1, day: 1, state: "planned",
  clearance: { status: "pending", checks: [], resolvedBy: "", resolvedAt: 0 },
  confirmedDoses: calculatedDoses, administrationSequence: [],
};
// The NURSE-READ fixture: deliberately a DIFFERENT rituximab dose than FIXTURE_PLAN/CREATED_CYCLE
// carry (simulates a physician dose change that happened after this client last saw the plan), so
// the assertion can prove the give-list renders the FETCHED value, never a stale local one.
const fetchedRituximabFinal = rituximabFinal - 50;
const fetchedDoses = calculatedDoses.map((d) => d.drugId === "rituximab" ? Object.assign({}, d, { final: fetchedRituximabFinal, modified: fetchedRituximabFinal, modifiedReason: "renal adjustment" }) : d);
const GET_CYCLE_RESPONSE = {
  ok: true,
  cycle: {
    cycleId: CYCLE_ID, planId: "TP-fixture", cycleNo: 1, day: 1, state: "ready",
    clearance: { status: "cleared", checks: [{ name: "CBC/platelets", status: "ok" }], resolvedBy: "dr1", resolvedAt: Date.now() },
    confirmedDoses: fetchedDoses, administrationSequence: [],
  },
  plan: { protocolId: RCHOP.id, name: RCHOP.name, ghisPatientId: "MRN-CDP-2", intent: "curative", cycleLengthDays: RCHOP.cycleLengthDays },
  adminRecords: [{
    id: "ADM-fetched-1", cycleId: CYCLE_ID, planId: "TP-fixture", drugId: "cyclophosphamide",
    planned: fetchedDoses.filter((d) => d.drugId === "cyclophosphamide")[0], actual: 555, route: "IV",
    startTime: Date.UTC(2026, 0, 1, 9, 0), endTime: Date.UTC(2026, 0, 1, 9, 30),
    administeredBy: "Nurse Fetched", prepared: true, administered: true,
    reaction: "fetched-record-reaction", notes: "", status: "administered", createdAt: 1,
  }],
};

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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-cycle-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-dose.js + onco-protocols.js + onco-nurse.js + opd-emr.js loaded into the harness");

  // ==================================================================================================
  // (b) DOCTOR: create cycle -> toggle clearance checks -> resolve -> confirm to ready
  // ==================================================================================================

  await ev(`window.OPDEMR.openProfile({ patientId: "MR-CDP-2", name: "Test Patient", tab: "onco", oncoView: "doctor",
    oncoPlan: ${JSON.stringify(FIXTURE_PLAN)} }); return 1;`);

  let matrixShown = null;
  for (let i = 0; i < 60; i++) { await sleep(150); matrixShown = await ev(`return !!document.querySelector(".oe-onco-tbl");`); if (matrixShown === true) break; }
  ok(matrixShown === true, "the doctor dose matrix renders");
  ok(await ev(`return !!document.querySelector('[data-oe-act="onco-cycle-create:1"]');`) === true, "[Create cycle 1] offered - no cycle exists yet");
  ok(await ev(`return !document.querySelector('[data-oe-act^="onco-clr-resolve:"]');`) === true, "no clearance panel before a cycle exists");

  const createPostsBefore = await ev(`return window.__fetchCalls.filter(function(c){ return /\\/api\\/queue\\/onco\\/cycle$/.test(c.url); }).length;`);
  ok(createPostsBefore === 0, "ZERO POSTs to .../onco/cycle before the Create tap");

  await ev(`window.__STUB.createdCycle = ${JSON.stringify(CREATED_CYCLE)}; return 1;`);
  await ev(`document.querySelector('[data-oe-act="onco-cycle-create:1"]').click(); return 1;`);
  let createCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    createCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.method === "POST" && /\\/api\\/queue\\/onco\\/cycle$/.test(c.url); });`);
    if (createCalls && createCalls.length >= 1) break;
  }
  ok(!!createCalls && createCalls.length === 1, `EXACTLY one POST to .../onco/cycle fires on the Create tap (got ${createCalls ? createCalls.length : 0})`);
  if (createCalls && createCalls.length === 1) ok(createCalls[0].body && createCalls[0].body.planId === "TP-fixture" && createCalls[0].body.cycleNo === 1, "create body carries {planId, cycleNo:1}");

  let clrShown = null;
  for (let i = 0; i < 60; i++) { await sleep(150); clrShown = await ev(`return !!document.querySelector('[data-oe-act="onco-clr-resolve:${CYCLE_ID}"]');`); if (clrShown === true) break; }
  ok(clrShown === true, "the pre-chemo clearance panel appears once the cycle exists");
  ok(await ev(`return !document.querySelector('[data-oe-act="onco-cycle-create:1"]');`) === true, "the Create button is replaced by the clearance panel");

  RCHOP.clearanceChecks.forEach((name) => {
    // (assert presence lazily inside the loop below via ev; kept simple - one assertion after the loop)
  });
  const allTogglesPresent = await ev(`return ${JSON.stringify(RCHOP.clearanceChecks)}.every(function(n){ return !!document.querySelector('[data-oe-act="onco-clr-toggle:' + n.replace(/"/g, "") + '"]'); });`);
  ok(allTogglesPresent === true, "one toggle per protocol clearanceChecks entry is present");

  const confirmSel = `[data-oe-act="onco-cycle-confirm:${CYCLE_ID}"]`;
  ok(await ev(`var b=document.querySelector('${confirmSel}'); return !!b && b.disabled;`) === true, "[Confirm cycle to ready] is DISABLED before clearance is resolved");

  // Toggle every check on, pick "cleared" in the status select, then Resolve.
  await ev(`${JSON.stringify(RCHOP.clearanceChecks)}.forEach(function(n){ document.querySelector('[data-oe-act="onco-clr-toggle:' + n.replace(/"/g, "") + '"]').click(); }); return 1;`);
  await ev(`
    var sel = document.querySelector('[data-oe-inp="onco-clr-status"]');
    sel.value = "cleared"; sel.dispatchEvent(new Event("input", { bubbles: true }));
    return 1;
  `);
  const resolvePostsBefore = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/onco/cycle/clearance") >= 0; }).length;`);
  ok(resolvePostsBefore === 0, "ZERO POSTs to .../onco/cycle/clearance before the Resolve tap");

  await ev(`document.querySelector('[data-oe-act="onco-clr-resolve:${CYCLE_ID}"]').click(); return 1;`);
  let clrCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    clrCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/cycle/clearance") >= 0; });`);
    if (clrCalls && clrCalls.length >= 1) break;
  }
  ok(!!clrCalls && clrCalls.length === 1, `EXACTLY one POST to .../onco/cycle/clearance fires on the Resolve tap (got ${clrCalls ? clrCalls.length : 0})`);
  if (clrCalls && clrCalls.length === 1) {
    ok(clrCalls[0].body && clrCalls[0].body.cycleId === CYCLE_ID, "clearance body carries the cycleId");
    ok(clrCalls[0].body && clrCalls[0].body.status === "cleared", "clearance body carries the selected overall status");
    ok(Array.isArray(clrCalls[0].body.checks) && clrCalls[0].body.checks.length === RCHOP.clearanceChecks.length && clrCalls[0].body.checks.every((c) => c.status === "ok"), "every toggled check is sent as {name, status:'ok'}");
  }

  let confirmEnabled = null;
  for (let i = 0; i < 60; i++) { await sleep(150); confirmEnabled = await ev(`var b=document.querySelector('${confirmSel}'); return !!b && !b.disabled;`); if (confirmEnabled === true) break; }
  ok(confirmEnabled === true, "[Confirm cycle to ready] is ENABLED once the cycle's persisted clearance.status is 'cleared'");

  const confirmPostsBefore = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/onco/cycle/confirm") >= 0; }).length;`);
  ok(confirmPostsBefore === 0, "ZERO POSTs to .../onco/cycle/confirm before the tap");
  await ev(`document.querySelector('${confirmSel}').click(); return 1;`);
  let confirmCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    confirmCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/cycle/confirm") >= 0; });`);
    if (confirmCalls && confirmCalls.length >= 1) break;
  }
  ok(!!confirmCalls && confirmCalls.length === 1, `EXACTLY one POST to .../onco/cycle/confirm fires on the Confirm tap (got ${confirmCalls ? confirmCalls.length : 0})`);
  if (confirmCalls && confirmCalls.length === 1) ok(confirmCalls[0].body && confirmCalls[0].body.cycleId === CYCLE_ID, "confirm body carries the cycleId");

  // ==================================================================================================
  // (a) NURSE READ: a FRESH session with no injected cycle object - only an oncoCycleId. Must fetch
  // real GET /onco/cycle and render the give-list/admin table from the FETCHED data, not local state.
  // ==================================================================================================

  await ev(`window.__STUB.getCycleResponse = ${JSON.stringify(GET_CYCLE_RESPONSE)}; window.__fetchCalls = []; return 1;`);
  await ev(`window.OPDEMR.openProfile({ patientId: "MR-CDP-2", name: "Test Patient", tab: "onco", oncoView: "nurse",
    oncoPlan: ${JSON.stringify(FIXTURE_PLAN)}, oncoCycleId: "${CYCLE_ID}" }); return 1;`);

  let getCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    getCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.method === "GET" && c.url.indexOf("/api/queue/onco/cycle?") >= 0; });`);
    if (getCalls && getCalls.length >= 1) break;
  }
  ok(!!getCalls && getCalls.length === 1, `a fresh nurse session with only an oncoCycleId fires EXACTLY one GET /api/queue/onco/cycle (got ${getCalls ? getCalls.length : 0})`);
  if (getCalls && getCalls.length === 1) ok(getCalls[0].url.indexOf("cycleId=" + encodeURIComponent(CYCLE_ID)) >= 0, "the GET carries the requested cycleId");

  let nurseRendered = null;
  for (let i = 0; i < 60; i++) { await sleep(150); nurseRendered = await ev(`return !!document.querySelector(".oe-onco-nurse");`); if (nurseRendered === true) break; }
  ok(nurseRendered === true, "Today's Chemotherapy (nurse view) renders once the fetch resolves");

  const nurseBodyText = (await ev(`return document.querySelector(".oe-onco-nurse").textContent;`)) || "";
  ok(nurseBodyText.indexOf(fetchedRituximabFinal + " mg") >= 0, `give-list shows the FETCHED cycle's confirmed dose (${fetchedRituximabFinal} mg) - a value that differs from the plan's own confirmedDoses (${rituximabFinal} mg), proving it renders from the fetch`);
  ok(nurseBodyText.indexOf(rituximabFinal + " mg") < 0 || fetchedRituximabFinal === rituximabFinal, "the STALE plan-level dose is not what gets shown for rituximab");

  ok(nurseBodyText.indexOf("fetched-record-reaction") >= 0, "the administration record table shows the FETCHED adminRecords row (reaction present)");
  ok(nurseBodyText.indexOf("555 mg") >= 0, "the FETCHED admin record's actual dose (555 mg) is shown");
  ok(await ev(`return !document.querySelector('[data-oe-act^="onco-start:${CYCLE_ID}:cyclophosphamide"]');`) === true, "cyclophosphamide already has a fetched administration row - no duplicate Start button");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll oncology cycle-management gap-fix checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
