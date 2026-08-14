/* ONCQIS Phase C CDP test (real headless Chrome): the evidence overlay rendered end to end from the REAL
 * onco-evidence.js against a fixture Standard Protocol carrying core + guideline + institutional +
 * divergence. Mirrors run-onco-p1-ui.mjs (serve + Chrome + CDP WebSocket).
 * Asserts:
 *   - the 3 evidence layers render (CORE / CURRENT GUIDELINE / INSTITUTIONAL) with source+version
 *   - CORE is not flattened into GUIDELINE (layers stay separate)
 *   - UPDATE AVAILABLE shows BOTH regimens (standard FOLFOX-6 + guideline FOLFOXIRI) and ALL 3 actions
 *   - clicking an UPDATE action only RECORDS the choice (applied:false) and never mutates the protocol
 *   - divergence shows "Clinical review required"; a selection is RECORDED only on an explicit click
 * USAGE: node test/run-onco-evidence-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8801, DBG = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-evidence-ui-chrome";
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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-evidence-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-evidence.js loaded and rendered into the harness");

  // ---- 3 evidence layers render, not flattened ----
  const layers = (await ev(`return document.getElementById("layers").textContent || "";`)) || "";
  ok(/Core Evidence/i.test(layers) && /Current Guideline/i.test(layers) && /Institutional/i.test(layers), "all 3 evidence layers render (Core / Current Guideline / Institutional)");
  ok(/DeVita 12th ed/.test(layers) && /v12/.test(layers) && /current/.test(layers), "core row shows source + version + evidenceStatus");
  ok(/NCCN Colon/.test(layers) && /Tumour Board Policy/.test(layers), "guideline + institutional sources render");
  const coreOnly = await ev(`var h=document.getElementById("layers").innerHTML; var i=h.indexOf("Current Guideline"); return h.slice(0,i);`);
  ok(/DeVita/.test(coreOnly) && !/NCCN/.test(coreOnly), "CORE layer is not flattened into the guideline layer");

  // ---- UPDATE AVAILABLE: both regimens + all 3 actions ----
  const upd = (await ev(`return document.getElementById("update").textContent || "";`)) || "";
  ok(/UPDATE AVAILABLE/.test(upd), "the UPDATE AVAILABLE overlay renders");
  ok(/FOLFOX-6/.test(upd) && /FOLFOXIRI/.test(upd), "UPDATE AVAILABLE shows BOTH the standard (FOLFOX-6) and guideline (FOLFOXIRI) regimens");
  ok(/Irinotecan/.test(upd), "the structured why-differ names the added drug (Irinotecan)");
  const nActions = await ev(`return document.querySelectorAll('#update [data-onco-ev="update-choice"]').length;`);
  ok(Number(nActions) === 3, `all 3 physician actions render (${nActions})`);
  ok(/never auto-applies/i.test(upd), "the overlay states it never auto-applies a change");

  // ---- before any click: nothing recorded, protocol name intact ----
  ok(await ev(`return window.__lastChoice === null;`) === true, "no choice is recorded before an explicit click");

  // ---- click SELECT UPDATED REGIMEN: choice RECORDED, protocol NOT mutated ----
  await ev(`document.querySelector('#update [data-choice="select"]').click(); return 1;`); await sleep(80);
  ok(await ev(`return window.__lastChoice && window.__lastChoice.choice === "select";`) === true, "clicking SELECT UPDATED REGIMEN records the physician choice");
  ok(await ev(`return window.__lastChoice.applied === false && window.__lastChoice.autoApplied === false;`) === true, "the SELECT action does NOT auto-apply a change (applied:false)");
  ok(await ev(`return window.__standardName === "FOLFOX-6" && window.__protocol.name === "FOLFOX-6";`) === true, "the Standard Protocol is unchanged after selecting the update (no auto-replace)");

  // ---- click CONTINUE STANDARD PROTOCOL: still just recorded ----
  await ev(`document.querySelector('#update [data-choice="continue"]').click(); return 1;`); await sleep(80);
  ok(await ev(`return window.__lastChoice.choice === "continue" && window.__lastChoice.applied === false;`) === true, "clicking CONTINUE records the choice and applies nothing");

  // ---- divergence: clinical review required, selection recorded only on click ----
  const div = (await ev(`return document.getElementById("divergence").textContent || "";`)) || "";
  ok(/EVIDENCE DIVERGENCE/.test(div), "the EVIDENCE DIVERGENCE view renders");
  ok(/Clinical review required/i.test(div), "the divergence view states 'Clinical review required'");
  ok(/Source 1/.test(div) && /Source 2/.test(div), "both divergent sources render");
  ok(await ev(`return window.__lastDivergence === null;`) === true, "no divergence selection is recorded before an explicit click");
  await ev(`document.querySelector('#divergence [data-onco-ev="divergence-select"][data-src-index="1"]').click(); return 1;`); await sleep(80);
  ok(await ev(`return window.__lastDivergence && window.__lastDivergence.selected === "NCCN Colon";`) === true, "clicking a source records that selection");
  ok(await ev(`return window.__lastDivergence.autoReconciled === false && window.__lastDivergence.resolution === "clinical-review-required";`) === true, "the divergence selection is NEVER auto-reconciled (resolution stays clinical-review-required)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll Onco Phase C evidence-overlay checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
