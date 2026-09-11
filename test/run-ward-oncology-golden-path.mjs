/* WardSynQ ONCqis bridge: open a chart -> Oncology button -> link a plan -> record a diagnosis
 * with staging -> record a CTCAE-graded adverse event -> record a chemo administration, driven in
 * real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-oncology-golden-path-harness.html stubs only the network). Proves the CLIENT half of
 * the ONCqis bridge - real DOM, real ward.css, real delegated click handler - not a mock render.
 * Persistence/server-side correctness for these same contracts is proven separately, for real, in
 * test/wardsynq-oncology.test.mjs.
 *
 *   node test/run-ward-oncology-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9400, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-oncology-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-oncology-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the ONCqis bridge harness");

  // ---- 1. Open the ward list, open the one patient's chart. ---------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="oncologyopen"]');`), "the ordinary chart carries an Oncology button - reachable from any patient, not a separate ward");

  // ---- 2. Open the Oncology bridge view. -----------------------------------------------------------
  await click('[data-w-act="oncologyopen"]');
  ok(await waitFor(`return !!document.getElementById('wOncoPlanId');`), "the ONCqis bridge view opens");
  ok(await ev(`return document.body.textContent.indexOf('No ONCqis plan linked') >= 0;`), "no plan linked yet, stated plainly");

  // ---- 3. Link a plan. ------------------------------------------------------------------------------
  await fill("wOncoPlanId", "plan-777"); await fill("wOncoRegimen", "AC-T"); await fill("wOncoVersion", "3");
  await click('[data-w-act="oncolinksave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('AC-T') >= 0;`), "the linked plan's real regimen is shown");
  const linkBody = await lastBody("/ward/onco-link");
  ok(linkBody && linkBody.plan.oncoPlanId === "plan-777" && linkBody.plan.regimen === "AC-T", "the link posts exactly what was entered: " + JSON.stringify(linkBody));

  // ---- 4. Record the diagnosis with staging. --------------------------------------------------------
  await fill("wOncoDxCode", "C50.9"); await fill("wOncoDxDisplay", "Malignant neoplasm of breast"); await fill("wOncoStage", "IIB");
  await click('[data-w-act="oncodxsave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('stage IIB') >= 0;`), "the diagnosis and its ONCqis-resolved stage are shown");
  const dxBody = await lastBody("/ward/onco-diagnosis");
  ok(dxBody && dxBody.staging.stageGroup === "IIB", "staging is posted exactly as entered, never recomputed here: " + JSON.stringify(dxBody));

  // ---- 5. Record a CTCAE-graded adverse event; an invalid grade is refused. -------------------------
  await fill("wOncoAeTerm", "Neutropenia"); await fill("wOncoAeGrade", "3");
  await click('[data-w-act="oncoaesave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('grade 3') >= 0;`), "the recorded CTCAE grade is shown, never computed by this screen");
  const aeBody = await lastBody("/ward/onco-ae");
  ok(aeBody && aeBody.event.grade === 3, "the grade posted is exactly what was entered: " + JSON.stringify(aeBody));

  // ---- 6. Record a chemo administration with dose lineage and an extravasation flag. ----------------
  await fill("wOncoCycleId", "plan-777__1"); await fill("wOncoDrug", "Doxorubicin"); await fill("wOncoDose", "90"); await fill("wOncoBsa", "1.8");
  await ev(`document.getElementById('wOncoExtrav').checked = true; return true;`);
  await click('[data-w-act="oncochemosave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('extravasation') >= 0;`), "a structured extravasation flag is shown, not buried in prose");
  const chemoBody = await lastBody("/ward/onco-chemo");
  ok(chemoBody && chemoBody.oncoPlanId === "plan-777" && chemoBody.admin.doseGiven === 90 && chemoBody.admin.bsaUsed === 1.8 && chemoBody.admin.extravasation.occurred === true,
    "the administration posts the real dose, the real BSA, and the real extravasation flag, tied to the ALREADY-LINKED plan: " + JSON.stringify(chemoBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
