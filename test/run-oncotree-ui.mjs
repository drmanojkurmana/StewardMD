/* ONCOTREE UI drive test (real headless Chrome, mobile viewport). Loads the REAL oncotree scripts +
 * REAL kb/oncotree/breast.json + kb/protocols/*.json, then walks the breast pathway with real clicks:
 * histology -> workup -> sequencing -> response -> residual subtype -> outcome, asserting protocol cards + DRAFT badges +
 * disabledBy explanation + protocol detail + Select handoff. Also asserts NO console errors/exceptions
 * and NO horizontal overflow at 390px. USAGE: node test/run-oncotree-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8802, DBG = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/oncotree-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=390,844"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (sel) => { const found = await ev(`var e=document.querySelector('${sel}'); if(e){e.click();} return !!e;`); await sleep(120); return found; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const consoleErrors = [];

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push((m.params.args || []).map(a => a.value || a.description || "").join(" "));
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push("EXCEPTION: " + (m.params.exceptionDetails && (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)));
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "test/oncotree-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real oncotree engine + recommend + UI loaded (window.SMD_ONCOTREE.open present)");

  await ev(`window.SMD_ONCOTREE.open(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(150); if (await ev(`return !!document.querySelector(".ot-disease");`)) break; }
  ok(await ev(`return document.getElementById("smdOncoTree").style.display;`) === "block", "open() shows the overlay");
  ok(Number(await ev(`return document.querySelectorAll(".ot-disease").length;`)) >= 2, "disease picker lists multiple cancers (breast + lung)");
  await clickAct(`[data-ot-act="pick"][data-ot-guideline="breast"]`);
  for (let i = 0; i < 40; i++) { await sleep(150); if (await ev(`return !!document.querySelector(".ot-step-title");`)) break; }
  ok(/breast cancer type|histolog/i.test((await ev(`return (document.querySelector(".ot-step-title")||{}).textContent||"";`)) || ""), "picking Breast opens the histology question");

  // walk the pathway (breast navigator v3.2: histology -> workup -> sequencing -> preop regimens -> response -> residual subtype)
  const title = async () => (await ev(`return (document.querySelector(".ot-step-title")||{}).textContent||"";`)) || "";
  const pickOpt = (node, opt) => clickAct(`[data-ot-act="answer"][data-ot-node="${node}"][data-ot-opt="${opt}"]`);
  ok(await pickOpt("n_histology", "invasive"), "answer histology = invasive");
  ok(/workup/i.test(await title()), "invasive workup step appears");
  ok(await pickOpt("n_inv_wk", "continue"), "workup reviewed");
  ok(/sequenc/i.test(await title()), "primary sequencing question appears");
  ok(await pickOpt("n_inv_approach", "preop"), "answer sequencing = preoperative");
  ok(/neoadjuvant|preoperative/i.test(await title()), "preoperative regimen step appears");
  ok(await pickOpt("n_tx_preop", "continue"), "surgery completed - evaluate response");
  ok(await pickOpt("n_preop_response", "residual"), "answer response = residual disease");
  ok(/residual/i.test(await title()), "residual subtype question appears");

  // progress rail shows prior answers
  ok(Number(await ev(`return document.querySelectorAll(".ot-rail-chip").length;`)) >= 4, "progress rail shows answered steps");

  ok(await pickOpt("n_preop_residual_subtype", "her2pos"), "answer residual subtype = HER2-positive");
  ok(Number(await ev(`return document.querySelectorAll(".ot-card").length;`)) > 0, "HER2-positive residual outcome shows applicable protocol cards");
  ok(await ev(`return !document.querySelector(".ot-badge.exp, .ot-badge.draft") && !/DRAFT|BETA/.test((document.querySelector(".ot-outcome, #otBody")||{}).textContent||"");`) === true, "protocol cards carry no draft / Beta badge (owner decision 2026-09-28)");
  ok(/T-DM1|trastuzumab emtansine|T-DXd|deruxtecan/i.test((await ev(`return document.getElementById("otBody").textContent||"";`)) || ""), "outcome is the HER2-positive residual branch (T-DM1 / T-DXd)");

  // disabledBy explanation
  await clickAct(`[data-ot-act="toggle-excluded"]`);
  ok(await ev(`return !!document.querySelector(".ot-excl");`) === true, "excluded pathways panel lists not-applicable branches");
  await clickAct(`[data-ot-act="why"]`);
  ok(((await ev(`return (document.querySelector(".ot-excl-why")||{}).textContent||"";`)) || "").trim().length > 10, "Why? explains the exclusion");

  // protocol detail
  await clickAct(`[data-ot-act="view-proto"]`);
  ok(await ev(`return !!document.querySelector(".ot-drugs");`) === true, "protocol detail shows the regimen table");
  ok((await ev(`return document.querySelector(".ot-detail-warn").textContent||"";`) || "").indexOf("Verify against your institutional protocol") >= 0, "detail carries the verify-against-protocol caveat");

  // select -> handoff
  await clickAct(`[data-ot-act="select-proto"]`);
  ok((await ev(`return (document.querySelector(".ot-selection h2")||{}).textContent||"";`) || "").indexOf("selected") >= 0, "Select shows the handoff confirmation");
  await clickAct(`[data-ot-act="handoff"]`);
  ok(Number(await ev(`return (window.__selectEvents||[]).length;`)) === 1, "handoff emits exactly one smd-oncotree-select CustomEvent (no bypass)");
  ok(await ev(`return (window.__selectEvents[0]||{}).protocolId ? true : false;`) === true, "handoff payload carries the selected protocolId");

  // mobile: no horizontal overflow at 390px
  const overflow = await ev(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
  ok(Number(overflow) <= 1, "no horizontal overflow at 390px (scrollWidth-clientWidth=" + overflow + ")");

  await sleep(200);
  ok(consoleErrors.length === 0, "no console errors / exceptions during the flow" + (consoleErrors.length ? ": " + JSON.stringify(consoleErrors.slice(0, 3)) : ""));

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll ONCOTREE UI checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
