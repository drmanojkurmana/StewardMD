/* WardSynQ ED: arrival (unidentified patient) -> triage -> the shared chart -> a resuscitation
 * bundle -> disposition (admitted, via the SAME bed board the inpatient admission uses), driven in
 * real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-ed-golden-path-harness.html stubs only the network). Proves the CLIENT half of the ED
 * vertical - real DOM, real ward.css, real delegated click handler - not a mock render.
 * Persistence/server-side correctness for these same contracts is proven separately, for real, in
 * test/wardsynq-ed.test.mjs.
 *
 *   node test/run-ward-ed-golden-path.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9389, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-ed-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-ed-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the ED harness (${ready})`);

  // ---- 1. Reachability: the ED tab from the ward list, an empty board. -------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="edboard"]');`)) break; }
  await ev(`document.querySelector('[data-w-act="edboard"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('No patients currently in the ED') >= 0;`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('No patients currently in the ED') >= 0;`), "the ED tab is reachable and an empty board says so plainly");

  // ---- 2. Unidentified arrival. ------------------------------------------------------------------
  await ev(`document.querySelector('[data-w-act="edarrivalopen"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(80); if (await ev(`return !!document.querySelector('[data-w-act="edarriveunknown"]');`)) break; }
  await ev(`document.getElementById('wEdSex').value = 'male'; document.getElementById('wEdUnkCc').value = 'Found down, unresponsive'; document.querySelector('[data-w-act="edarriveunknown"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bed');`)) break; }
  const arrivalBody = await lastBody("/ward/ed-arrival");
  ok(arrivalBody && arrivalBody.arrival && arrivalBody.arrival.unknown && arrivalBody.arrival.unknown.sex === "male", "an unidentified arrival posts exactly what was chosen, no identity invented: " + JSON.stringify(arrivalBody));
  ok(await ev(`return document.body.textContent.indexOf('TRAUMA-UNKNOWN') >= 0;`), "the board shows the real provisional MRN wardsynq-mpi.js generated, not a placeholder");

  // ---- 3. Open the chart: untriaged, so the triage card asks for an acuity - never computes one. --
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="triage"]');`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Not yet triaged') >= 0;`), "an unidentified, untriaged arrival is shown as untriaged - nothing pretends to know an acuity yet");
  await ev(`document.getElementById('wTriageAcuity').value = '2'; document.querySelector('[data-w-act="triage"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('2 - Emergent') >= 0;`)) break; }
  const triageBody = await lastBody("/ward/ed-triage");
  ok(triageBody && triageBody.acuity === 2, "the acuity posted is exactly what was picked: " + JSON.stringify(triageBody));
  ok(await ev(`return document.body.textContent.indexOf('2 - Emergent') >= 0;`), "the recorded acuity is shown once triaged");

  // ---- 4. Resuscitation: start a real Code Sepsis bundle, mark an element. -----------------------
  await ev(`document.getElementById('wResusCode').value = 'code-sepsis'; document.querySelector('[data-w-act="resusstart"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('Code Sepsis') >= 0;`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Measure lactate') >= 0;`), "the started bundle's real elements (from wardsynq-emergency.js's own definition) are on screen");
  await ev(`window.prompt = function(){ return "resulted"; }; document.querySelector('[data-w-act^="resusmark:"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('done') >= 0;`)) break; }
  const markBody = await lastBody("/ward/resus-mark");
  ok(markBody && markBody.key === "lactate" && markBody.event === "resulted", "marking an element posts the real key and the real event a human typed: " + JSON.stringify(markBody));

  // ---- 5. Disposition: admitted, via the SAME bed board an inpatient admission uses. --------------
  await ev(`document.querySelector('[data-w-act="dispositionadmit"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bedcell.free');`)) break; }
  ok(await ev(`return !!document.querySelector('.w-bedcell.free');`), "admitting from the ED opens the real bed board, not a second admission form");
  await ev(`document.querySelector('.w-bedcell.free').click(); return true;`);
  await sleep(200);
  const dispBody = await lastBody("/ward/ed-disposition");
  ok(dispBody && dispBody.disposition === "admitted" && dispBody.admission && dispBody.admission.ward === "ICU", "picking a bed fires the disposition directly, naming the real ward and bed: " + JSON.stringify(dispBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
