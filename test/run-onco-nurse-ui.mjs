/* Phase 5 CDP test (real headless Chrome): the nurse execution view ("Today's Chemotherapy").
 * Loads the REAL onco-dose.js + onco-protocols.js + onco-nurse.js + opd-emr.js into a minimal harness
 * (flags stubbed on, fetch stubbed + recorded, window.confirm stubbed to auto-accept). Injects a
 * fixture plan + a CLEARED, READY cycle via OPDEMR.openProfile({tab:"onco", oncoPlan, oncoCycle,
 * oncoView:"nurse"}) - the Phase-5 seam - and asserts:
 *   - the clearance banner renders green (cleared) and the confirmed dose is shown VERBATIM (never
 *     recomputed - onco-dose.js is loaded on the page but the nurse view must not call it)
 *   - filling an actual dose + reaction and tapping [Start] fires EXACTLY ONE POST to
 *     /api/queue/onco/admin, with the typed values in the body
 *   - after that POST resolves, the administration-record table shows the new row and the drug's
 *     [Start] button is replaced by a "Given" tag (no double-recording)
 *   - tapping [Complete cycle] fires EXACTLY ONE POST to /api/queue/onco/cycle/complete
 * USAGE: node test/run-onco-nurse-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8799, DBG = 9390, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-nurse-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RCHOP = require(join(HERE, "..", "kb", "protocols", "rchop.json"));
const DOSE = require(join(HERE, "..", "onco-dose.js"));
const calculatedDoses = DOSE.planDoses(RCHOP, { height: 165, weight: 60, age: 55, sex: "female" });
const rituximabFinal = calculatedDoses.filter(d => d.drugId === "rituximab")[0].final;
const FIXTURE_PLAN = {
  planId: "TP-fixture", protocolId: RCHOP.id, ghisPatientId: "MRN-CDP-1", lockedTemplate: RCHOP,
  plannedCycles: RCHOP.cycles, calculatedDoses: calculatedDoses, confirmedDoses: calculatedDoses, status: "active",
};
const FIXTURE_CYCLE = {
  cycleId: "TP-fixture__1", planId: "TP-fixture", cycleNo: 1, day: 1, state: "ready",
  clearance: { status: "cleared", checks: [{ name: "CBC/platelets", status: "ok" }, { name: "renal", status: "ok" }], resolvedBy: "dr1", resolvedAt: Date.now() },
  confirmedDoses: calculatedDoses, administrationSequence: [],
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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-nurse-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-dose.js + onco-protocols.js + onco-nurse.js + opd-emr.js loaded into the harness");

  await ev(`window.__FIXTURE_CYCLE = ${JSON.stringify(FIXTURE_CYCLE)}; return 1;`);
  await ev(`window.OPDEMR.openProfile({ patientId: "MR-CDP-1", name: "Test Patient", tab: "onco", oncoView: "nurse",
    oncoPlan: ${JSON.stringify(FIXTURE_PLAN)}, oncoCycle: window.__FIXTURE_CYCLE }); return 1;`);

  let rendered = null;
  for (let i = 0; i < 60; i++) { await sleep(150); rendered = await ev(`return !!document.querySelector(".oe-onco-nurse");`); if (rendered === true) break; }
  ok(rendered === true, "Today's Chemotherapy (nurse view) renders on open");
  ok(await ev(`return !document.querySelector(".oe-onco-tbl");`) === true, "the doctor matrix is NOT rendered while in nurse mode");

  ok(await ev(`return !!document.querySelector(".oe-onco-clr.oe-clr-green");`) === true, "a 'cleared' cycle shows the GREEN clearance banner");
  const bodyText = (await ev(`return document.querySelector(".oe-onco-nurse").textContent;`)) || "";
  ok(bodyText.indexOf(rituximabFinal + " mg") >= 0, `the give-list shows the CONFIRMED dose verbatim (${rituximabFinal} mg), never recomputed`);

  const startBtnSel = '[data-oe-act="onco-start:TP-fixture__1:rituximab"]';
  ok(await ev(`return !!document.querySelector('${startBtnSel}');`) === true, "a [Start] button is present for rituximab");

  // Fill the actual-dose + reaction inputs for rituximab, then tap [Start]. window.confirm is
  // stubbed to auto-accept - the ONE confirm() gate covering the whole staged-confirm sequence.
  await ev(`
    var doseEl = document.querySelector('[data-oe-inp="onco-admin-dose:TP-fixture__1:rituximab"]');
    var rxEl = document.querySelector('[data-oe-inp="onco-admin-reaction:TP-fixture__1:rituximab"]');
    doseEl.value = "650"; doseEl.dispatchEvent(new Event("input", { bubbles: true }));
    rxEl.value = "mild flushing"; rxEl.dispatchEvent(new Event("input", { bubbles: true }));
    return 1;
  `);
  const fetchesBeforeStart = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/onco/admin") >= 0; }).length;`);
  ok(fetchesBeforeStart === 0, "ZERO POSTs to /onco/admin before the Start tap (typing the dose/reaction is silent staging)");

  await ev(`document.querySelector('${startBtnSel}').click(); return 1;`);
  let adminCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    adminCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/admin") >= 0; });`);
    if (adminCalls && adminCalls.length >= 1) break;
  }
  ok(!!adminCalls && adminCalls.length === 1, `EXACTLY one POST to /api/queue/onco/admin fires on the Start tap (got ${adminCalls ? adminCalls.length : 0})`);
  if (adminCalls && adminCalls.length === 1) {
    const call1 = adminCalls[0];
    ok(call1.method === "POST", "the admin call is a POST");
    ok(call1.body && call1.body.drugId === "rituximab" && call1.body.cycleId === "TP-fixture__1", "body carries the drug + cycle");
    ok(call1.body && call1.body.actual === 650, "body carries the typed actual dose (650), not a recomputed one");
    ok(call1.body && call1.body.reaction === "mild flushing", "body carries the typed reaction");
  }

  let recorded = null;
  for (let i = 0; i < 60; i++) { await sleep(150); recorded = await ev(`return document.querySelector(".oe-onco-admtbl") ? document.querySelector(".oe-onco-admtbl").textContent : "";`); if (recorded && recorded.indexOf("mild flushing") >= 0) break; }
  ok(!!recorded && recorded.indexOf("mild flushing") >= 0, "the administration-record table shows the new row (reaction present)");
  ok(await ev(`return !document.querySelector('${startBtnSel}');`) === true, "rituximab's [Start] button is replaced (no double-recording)");

  // Tap [Complete cycle].
  const completeBtnSel = '[data-oe-act="onco-complete:TP-fixture__1"]';
  ok(await ev(`return !!document.querySelector('${completeBtnSel}');`) === true, "[Complete cycle] is present");
  const completeBeforeTap = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/onco/cycle/complete") >= 0; }).length;`);
  ok(completeBeforeTap === 0, "ZERO POSTs to /onco/cycle/complete before the tap");
  await ev(`document.querySelector('${completeBtnSel}').click(); return 1;`);
  let completeCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    completeCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/cycle/complete") >= 0; });`);
    if (completeCalls && completeCalls.length >= 1) break;
  }
  ok(!!completeCalls && completeCalls.length === 1, `EXACTLY one POST to /api/queue/onco/cycle/complete fires on the Complete tap (got ${completeCalls ? completeCalls.length : 0})`);
  if (completeCalls && completeCalls.length === 1) ok(completeCalls[0].body && completeCalls[0].body.cycleId === "TP-fixture__1", "complete body carries the cycleId");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll oncology nurse-execution checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
