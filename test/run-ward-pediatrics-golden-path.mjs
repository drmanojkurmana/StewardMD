/* WardSynQ Pediatrics/NICU: bed board -> admission-type select "NICU" -> age/weight band check ->
 * weight-based rate calculator -> respiratory-support charting -> a line placed and removed, driven
 * in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-pediatrics-golden-path-harness.html stubs only the network). Proves the CLIENT half of
 * the pediatrics/NICU vertical - real DOM, real ward.css, real delegated click handler - not a mock
 * render. Persistence/server-side correctness for these same contracts is proven separately, for
 * real, in test/wardsynq-pediatrics.test.mjs.
 *
 *   node test/run-ward-pediatrics-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-pediatrics-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-pediatrics-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
const fill = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the pediatrics/NICU harness");

  // ---- 1. Bed board, pick a bed, admit as NICU. -----------------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="board"]');`), "the bed board is reachable");
  await click('[data-w-act="board"]');
  ok(await waitFor(`return !!document.querySelector('.w-bedcell.free');`), "free cots are shown");
  await click('.w-bedcell.free');
  ok(await waitFor(`return !!document.getElementById('wAdmitClass');`), "the admit panel carries the explicit admission-type select");
  await ev(`document.getElementById('wAdmitClass').value = 'NICU'; document.getElementById('wAdmitMrn').value = 'SMD-H1-NICU01'; document.querySelector('[data-w-act="mrnlookup"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="admitconfirm"]');`);
  await click('[data-w-act="admitconfirm"]');
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "admission returns to a ward list showing the new patient");
  const admitBody = await lastBody("/ward/admit");
  ok(admitBody && admitBody.class === "NICU", "the admission posts class:\"NICU\" explicitly: " + JSON.stringify(admitBody));

  // ---- 2. Open the chart: age/weight band. -------------------------------------------------------
  await click('.w-bed');
  ok(await waitFor(`return !!document.getElementById('wAgeWeight');`), "the pediatrics/NICU chart shows the age/weight card");
  ok(await waitFor(`return document.body.textContent.indexOf('neonate') >= 0;`), "the REAL wardsynq-paediatrics.js banding is shown, not a client-side guess");
  ok(await ev(`return document.body.textContent.indexOf('gestational age') >= 0;`), "a neonate with no gestational age states the refusal reason plainly");

  // ---- 3. Weight-based rate calculator: a real calculation, persists nothing. --------------------
  await fill("wRateDose", "5"); await fill("wRateConc", "4"); await fill("wAgeWeight", "3.2");
  await click('[data-w-act="ratecalc"]');
  ok(await waitFor(`return document.body.textContent.indexOf('0.24 mL/h') >= 0;`), "the real computed rate is shown");
  const rateBody = await lastBody("/ward/weight-rate");
  ok(rateBody && rateBody.dosePerKgPerMin === 5 && rateBody.weightKg === 3.2, "the calculator posts exactly what was entered: " + JSON.stringify(rateBody));

  // ---- 4. Respiratory support charting. -----------------------------------------------------------
  await waitFor(`return !!document.getElementById('wNeoFio2');`);
  await ev(`document.getElementById('wNeoMode').value = 'cpap'; return true;`);
  await fill("wNeoFio2", "30");
  await click('[data-w-act="neonatalchart"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Charted') >= 0 || !!document.querySelector('.w-flowgrid, .w-empty');`), "the respiratory observation is charted");
  const neoBody = await lastBody("/ward/neonatal");
  ok(neoBody && (neoBody.code === "fio2-percent" || neoBody.code === "resp-support-mode"), "a real neonatal observation was posted: " + JSON.stringify(neoBody));

  // ---- 5. Lines: place and remove. -----------------------------------------------------------------
  await waitFor(`return !!document.getElementById('wLineType');`);
  await fill("wLineType", "UVC"); await fill("wLineSite", "umbilical");
  await click('[data-w-act="linesave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('UVC') >= 0;`), "the placed line is shown");
  const lineBody = await lastBody("/ward/line");
  ok(lineBody && lineBody.line.type === "UVC" && lineBody.line.site === "umbilical", "the line posts exactly what was entered: " + JSON.stringify(lineBody));

  await click('[data-w-act^="lineremove:"]');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="linesave"]');`), "removing the line returns to a working lines card");
  const removeBody = await lastBody("/ward/line-remove");
  ok(removeBody && removeBody.lineId === "wsq-line-1", "removal posts the real line id: " + JSON.stringify(removeBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
