/* Phase 8 P0 CDP test (real headless Chrome): Onco Home, the reference/tool-library workbench.
 * Loads the REAL onco-home.js + onco-evidence.js into a minimal harness (SMD_QUEUE_FLAGS stubbed
 * with only smd_onco_home on; MEDCALC/MEDDRUGS stubbed with spies; KB_ENRICHMENT stubbed with one
 * oncology disease) and asserts:
 *   - SMD_ONCOHOME.open() renders the dashboard (context strip + tool grid)
 *   - the patient-context strip renders from an injected context, labelled "Patient data"
 *   - flag-off tools (staging/CTCAE/IO-toxicity) are omitted entirely (no greyed placeholder tiles)
 *   - typing a query shows categorized search results (a calculator + a disease)
 *   - clicking a calculator result invokes the REAL window.MEDCALC.open (stubbed) with the right id
 *   - clicking a disease result invokes window.DX.openRef (stubbed) with the right id
 * USAGE: node test/run-onco-home-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8798, DBG = 9389, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-home-ui-chrome";
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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-home-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-home.js + onco-evidence.js loaded into the harness (window.SMD_ONCOHOME.open present)");

  // ---- flag-gated open(): with smd_onco_home stubbed ON, open() must render, not no-op ----
  await ev(`window.SMD_ONCOHOME.open({ patient: { name: "Test Patient", patientId: "MR1" }, heightCm: 165, weightKg: 60, age: 55, sex: "female" }); return 1;`);
  await sleep(150);
  ok(await ev(`return document.getElementById("smdOncoHome").classList.contains("on");`) === true, "SMD_ONCOHOME.open() renders the overlay (flag stubbed on)");

  // ---- dashboard: patient-context strip, labelled "Patient data", never auto-deciding ----
  const ctxText = (await ev(`return (document.querySelector(".oh-ctx")||{}).textContent || "";`)) || "";
  ok(ctxText.indexOf("Patient data") >= 0, 'the patient-context strip is labelled "Patient data": ' + JSON.stringify(ctxText.slice(0, 80)));
  ok(ctxText.indexOf("Test Patient") >= 0, "the context strip shows the injected patient identity");
  ok(ctxText.indexOf("BSA") >= 0, "a BSA chip is computed from the injected height/weight (reuses SMD_ONCODOSE.bsaMosteller when present, else silently omitted)");
  ok(/verify|edit/i.test(ctxText), "the strip nudges verify/edit, never presenting the data as a decision");

  // ---- grouped tool grid renders; flag-off tools are OMITTED entirely (no greyed placeholder tiles) ----
  const cardCount = await ev(`return document.querySelectorAll(".oh-card").length;`);
  ok(Number(cardCount) > 0, `the tool grid renders real cards (${cardCount})`);
  const phCount = await ev(`return document.querySelectorAll(".oh-card-ph").length;`);
  ok(Number(phCount) === 0, `no greyed "coming soon" placeholder tiles — flag-off tools are dropped, not disabled (${phCount} found)`);
  const stagingTile = await ev(`return !!document.querySelector('[data-oh-act="staging-open"]');`);
  ok(stagingTile === false, "a flag-off tool (staging) renders no tile at all (never a disabled/broken link)");
  const everyCardIsButton = await ev(`return Array.prototype.every.call(document.querySelectorAll(".oh-card"), function(c){return c.tagName==="BUTTON";});`);
  ok(everyCardIsButton === true, "every rendered tool tile is an interactive button, with an icon");
  const cardHasIcon = await ev(`return !!document.querySelector(".oh-card .oh-card-ic .material-symbols-rounded");`);
  ok(cardHasIcon === true, "tool cards use the icon+body structure (oh-card-ic + Material Symbol)");
  const heroPresent = await ev(`return !!document.querySelector(".oh-hero .oh-hero-title");`);
  ok(heroPresent === true, "the ONCqis landing hero renders (module identity)");

  // ---- typing a query shows categorized results ----
  await ev(`var i=document.getElementById("ohSearch"); i.value="khorana"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await sleep(150);
  const khoranaRow = await ev(`return !!document.querySelector('[data-oh-act="calc:khorana"]');`);
  ok(khoranaRow === true, 'typing "khorana" shows the real Khorana calculator as a categorized result');
  const secHeads = (await ev(`return Array.prototype.map.call(document.querySelectorAll(".oh-sec-h"), function(e){return e.textContent;}).join("|");`)) || "";
  ok(secHeads.indexOf("Calculators") >= 0, "results are shown under a categorized section header: " + secHeads);

  // ---- clicking a calculator result invokes the REAL MEDCALC.open (stubbed) with the right id ----
  await ev(`document.querySelector('[data-oh-act="calc:khorana"]').click(); return 1;`);
  await sleep(100);
  const calcCalls = await ev(`return JSON.stringify(window.__medcalcOpenCalls);`);
  ok(calcCalls === '["khorana"]', "clicking the Khorana result calls window.MEDCALC.open('khorana'): " + calcCalls);

  // ---- disease search (via the KB, incl. the abbreviation map) + deep link to the KB viewer ----
  await ev(`var i=document.getElementById("ohSearch"); i.value="egfr"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await sleep(150);
  ok(await ev(`return !!document.querySelector('[data-oh-act="kb:lung_cancer"]');`) === true, '"EGFR" (abbreviation) surfaces the Lung cancer KB entry');
  await ev(`window.__dxOpenRefCalls = []; window.DX = { openRef: function(id){ window.__dxOpenRefCalls.push(id); } }; return 1;`);
  await ev(`document.querySelector('[data-oh-act="kb:lung_cancer"]').click(); return 1;`);
  const dxCalls = await ev(`return JSON.stringify(window.__dxOpenRefCalls);`);
  ok(dxCalls === '["lung_cancer"]', "clicking the disease result calls window.DX.openRef('lung_cancer'): " + dxCalls);

  // ---- a drug result routes to the real MEDDRUGS browse overlay (no standalone single-drug API exists) ----
  await ev(`var i=document.getElementById("ohSearch"); i.value="pantop"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await sleep(150);
  ok(await ev(`return !!document.querySelector('[data-oh-act="drug-browse"]');`) === true, '"pantop" surfaces the Pantoprazole drug row');
  await ev(`document.querySelector('[data-oh-act="drug-browse"]').click(); return 1;`);
  ok(await ev(`return window.__medDrugsOpenListCalls;`) === 1, "clicking the drug result opens the real MEDDRUGS browse overlay");

  // ---- clearing the query returns to the dashboard (no stale results, no crash) ----
  await ev(`var i=document.getElementById("ohSearch"); i.value=""; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await sleep(120);
  ok(await ev(`return document.querySelectorAll(".oh-card").length > 0;`) === true, "clearing the query returns to the dashboard grid");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll Onco Home checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
