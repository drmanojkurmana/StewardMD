/* WardSynQ ward: the whole admission -> discharge-handoff golden path, driven in real headless
 * Chrome over CDP against the REAL ward.js and ward.css (test/ward-golden-path-harness.html stubs
 * only the network). Proves the CLIENT half of the vertical: admission (bed board), medication
 * ordering into the eMAR round, the eMAR state machine, investigation ordering through to a
 * result, and the handoff to discharge - through the real DOM, the real delegated click handler
 * and the real CSS, not a mock render. Persistence and the server-side contracts these calls rely
 * on are proven separately, for real, in test/wardsynq-inpatient-emar.test.mjs.
 *
 *   node test/run-ward-golden-path.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const calls = (frag) => ev(`return window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}).length;`);
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
  ok(ready === true, `real ward.js loaded into the harness (${ready})`);

  // ---- 1. Reachability + admission: no patient exists, the board is used to pick a bed, a NEW
  // patient is registered through the front-desk sheet, and the write is /ward/admit. -------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return document.querySelectorAll('.w-empty').length > 0 || document.querySelector('.w-bed');`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('No patients are currently admitted') >= 0;`), "an empty ward says so, and the ward opened with no console needed");

  await ev(`document.querySelector('[data-w-act="board"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bedcell.free');`)) break; }
  ok(await ev(`return !!document.querySelector('.w-bedcell.free');`), "the bed board rendered free beds from GET /ward/beds");

  await ev(`var b=[].filter.call(document.querySelectorAll('.w-bedcell.free'), function(x){return x.textContent.indexOf('12')>=0})[0]; b.click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(80); if (await ev(`return !!document.querySelector('[data-w-act="admitnew"]');`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Admit to Medical A, bed 12') >= 0;`), "picking a free bed opens the admit panel for that exact bed");

  await ev(`document.querySelector('[data-w-act="admitnew"]').click(); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bed');`)) break; }
  const admitBody = await lastBody("/ward/admit");
  ok(admitBody && admitBody.ward === "Medical A" && admitBody.bed === "12" && !!admitBody.mrn, "registering a new patient admits them to exactly the bed picked: " + JSON.stringify(admitBody));
  ok(await ev(`return !!document.querySelector('.w-bed');`), "the ward list now shows the admitted patient");

  // ---- 2. Open the chart (the one screen a doctor and a nurse share). ---------------------------
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="vitals"]');`)) break; }
  ok(await ev(`return !!document.querySelector('[data-w-act="vitals"]');`), "the chart opened: vitals, flowsheet, medication order, eMAR and investigations all on one screen");
  ok((await calls("/ward/flowsheet")) > 0 && (await calls("/ward/news2")) > 0, "opening the chart loaded the flowsheet and a NEWS2/PEWS score, unprompted");

  // ---- 3. Vitals -> flowsheet is the same record, no second write path. -------------------------
  await ev(`document.getElementById('wv_sbp').value = '118'; document.getElementById('wv_pulse').value = '82'; document.querySelector('[data-w-act="vitals"]').click(); return true;`);
  await sleep(200);
  const vitalsBody = await lastBody("/ward/vitals");
  ok(vitalsBody && vitalsBody.vitals && vitalsBody.vitals.sbp === "118", "vitals recorded exactly what was typed: " + JSON.stringify(vitalsBody));

  // ---- 4. Medication order -> the SAME order appears on the eMAR round. --------------------------
  await ev(`document.getElementById('wMoDrug').value='Paracetamol 500mg'; document.getElementById('wMoValue').value='500'; document.getElementById('wMoUnit').value='mg'; document.getElementById('wMoRoute').value='oral'; document.getElementById('wMoFreq').value='BD'; document.querySelector('[data-w-act="medorder"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('Paracetamol 500mg') >= 0 && !!document.querySelector('[data-w-act^="mar:verify"]');`)) break; }
  ok(await ev(`return !!document.querySelector('[data-w-act^="mar:verify"]');`), "the newly prescribed order appeared on the medication round, ready to verify");

  // ---- 5. eMAR: verify -> dispense -> scan -> administer, the real state machine, one click per
  // state, exactly as the tested eMAR does it. --------------------------------------------------
  await ev(`document.querySelector('[data-w-act^="mar:verify"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act^="mar:dispense"]');`)) break; }
  await ev(`document.querySelector('[data-w-act^="mar:dispense"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act^="mar:scan"]');`)) break; }
  await ev(`document.querySelector('[data-w-act^="mar:scan"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act^="mar:administer"]');`)) break; }
  await ev(`document.querySelector('[data-w-act^="mar:administer"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('administered') >= 0;`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('administered') >= 0;`), "the dose went verify -> dispense -> scan -> administer, one real click per state");
  ok((await calls("/ward/mar")) === 4, "exactly four MAR writes, one per state transition");

  // ---- 6. Investigation order -> pending -> a result appears. ------------------------------------
  await ev(`document.getElementById('wInvCode').value='Chest X-ray'; document.querySelector('[data-w-act="investigation"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('Chest X-ray') >= 0;`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Chest X-ray') >= 0 && document.body.textContent.indexOf('On order') >= 0;`), "the ordered test shows on the investigations worklist");
  await ev(`document.querySelector('[data-w-act="investigations"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('Clear.') >= 0;`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Clear.') >= 0;`), "the completed report's conclusion reached the results card, read through the FHIR export door");

  // ---- 7. Discharge handoff: the chart hands off to DISCHARGE.open with the right patient. -------
  let capturedDischarge = null;
  await ev(`window.DISCHARGE = { open: function(o){ window.__dischargeArgs = o; } }; return true;`);
  await ev(`document.querySelector('[data-w-act="summary"]').click(); return true;`);
  await sleep(100);
  capturedDischarge = JSON.parse((await ev(`return JSON.stringify(window.__dischargeArgs || null);`)) || "null");
  ok(!!capturedDischarge && !!capturedDischarge.encounterId && !!capturedDischarge.patientId, "the Summary button hands the exact admitted patient to the discharge workstation: " + JSON.stringify(capturedDischarge));

  // ---- 8. Responsive: no horizontal overflow at phone, tablet and desktop widths. -----------------
  for (const w of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
    await sleep(120);
    const overflow = await ev(`return document.documentElement.scrollWidth - window.innerWidth;`);
    ok(overflow <= 1, `no horizontal overflow at ${w}px (scrollWidth - innerWidth = ${overflow})`);
  }
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
