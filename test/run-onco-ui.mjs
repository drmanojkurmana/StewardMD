/* Phase 3 CDP test (real headless Chrome): the Oncology matrix + read-only dose drawer.
 * Loads the REAL onco-protocols.js + opd-emr.js into a minimal harness (SMD_QUEUE_FLAGS stubbed on,
 * fetch stubbed + recorded). Injects a fixture treatment plan via OPDEMR.openProfile({tab:"onco",
 * oncoPlan:...}) - the Phase-4 seam - and asserts:
 *   - the matrix renders (drug rows x cycle columns)
 *   - clicking a cell opens the dose drawer showing protocol dose + calculation + rounding + final
 *   - clicking a cell fires ZERO additional network requests (read-only, no fetch on cell click)
 *   - clicking the drawer's close action closes it
 * USAGE: node test/run-onco-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8797, DBG = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RCHOP = require(join(HERE, "..", "kb", "protocols", "rchop.json"));
const DOSE = require(join(HERE, "..", "onco-dose.js"));
const calculatedDoses = DOSE.planDoses(RCHOP, { height: 165, weight: 60, age: 55, sex: "female" });
const FIXTURE_PLAN = {
  planId: "TP-fixture", protocolId: RCHOP.id, lockedVersion: RCHOP.version, lockedTemplate: RCHOP,
  plannedCycles: RCHOP.cycles, calculatedDoses: calculatedDoses, confirmedDoses: [], status: "active"
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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-protocols.js + opd-emr.js loaded into the harness (window.SMD_ONCOUI._buildOncoMatrix present)");

  await ev(`window.OPDEMR.openProfile({ patientId:"MR1", name:"Test Patient", tab:"onco", oncoPlan: ${JSON.stringify(FIXTURE_PLAN)} }); return 1;`);
  let rendered = null;
  for (let i = 0; i < 60; i++) { await sleep(150); rendered = await ev(`return !!document.querySelector(".oe-onco-tbl");`); if (rendered === true) break; }
  ok(rendered === true, "the drug x cycle matrix renders on the Oncology tab");

  const rowCount = await ev(`return document.querySelectorAll(".oe-onco-tbl tbody tr").length;`);
  ok(rowCount === RCHOP.drugs.length, `one matrix row per drug (expected ${RCHOP.drugs.length}, got ${rowCount})`);

  const cellCount = await ev(`return document.querySelectorAll('[data-oe-act^="onco-cell:"]').length;`);
  ok(cellCount === RCHOP.drugs.length * RCHOP.cycles, `one cell-button per drug x cycle (expected ${RCHOP.drugs.length * RCHOP.cycles}, got ${cellCount})`);

  ok(await ev(`return !document.querySelector(".oe-onco-drawer");`) === true, "no dose drawer before any cell click");
  const fetchesBeforeClick = await ev(`return window.__fetchCalls.length;`);

  await ev(`document.querySelector('[data-oe-act="onco-cell:1:rituximab"]').click(); return 1;`);
  await sleep(150);

  ok(await ev(`return !!document.querySelector(".oe-onco-drawer");`) === true, "clicking a cell opens the dose drawer");
  const drawerText = (await ev(`return document.querySelector(".oe-onco-drawer").textContent.toLowerCase();`)) || "";
  ok(drawerText.indexOf("protocol dose") >= 0, "drawer shows the protocol dose");
  ok(drawerText.indexOf("calculation") >= 0, "drawer shows the calculation");
  ok(drawerText.indexOf("rounding") >= 0, "drawer shows the rounding step");
  ok(drawerText.indexOf("final") >= 0, "drawer shows the final dose");
  const rituximabFinal = calculatedDoses.filter(d => d.drugId === "rituximab")[0].final;
  ok(drawerText.indexOf(rituximabFinal + " mg") >= 0, `drawer shows the final dose value (${rituximabFinal} mg)`);

  const fetchesAfterClick = await ev(`return window.__fetchCalls.length;`);
  ok(fetchesAfterClick === fetchesBeforeClick, `ZERO network calls fired on cell click (before=${fetchesBeforeClick}, after=${fetchesAfterClick}) - read-only drawer`);

  await ev(`document.querySelector('[data-oe-act="onco-drawer-close"]').click(); return 1;`);
  await sleep(150);
  ok(await ev(`return !document.querySelector(".oe-onco-drawer");`) === true, "clicking close dismisses the dose drawer");

  const fetchesAfterClose = await ev(`return window.__fetchCalls.length;`);
  ok(fetchesAfterClose === fetchesBeforeClick, "still zero network calls after closing the drawer");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll oncology matrix/drawer checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
