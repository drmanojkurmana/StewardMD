/* Retest 2026-09-16 (docs/wardsynq/LIVE_RETEST_2026-09-16.md), in real headless Chrome over CDP against the real ward.js and
 * ward.css (test/ward-tablet-harness.html stubs only the network). Proves what a unit test cannot:
 *   - lab Collect asks on the ward, not in a browser prompt: text really typed into the dialog survives a repaint, Cancel
 *     writes nothing, a refused collection is said in the dialog with the typed values kept, OK collects;
 *   - a real mouse press on "Record vitals" whose screen is repainted before the release still records (LT-29's lost
 *     first triage click), the button says it is saving, and the answer is said under it;
 *   - the flowsheet reads mmHg and °C, and an incomplete NEWS2 names what is missing in words;
 *   - a known ED arrival sends its chief complaint;
 *   - a hard stop at order entry offers nothing to sign.
 *
 *   node test/run-ward-clinical-forms-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9498, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-clinical-forms-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tablet-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (js, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(js)) return true; } return false; };
const type = async (id, text) => { await ev(`document.getElementById(${JSON.stringify(id)}).focus(); return true;`); await call("Input.insertText", { text }); await sleep(40); };
const value = (id) => ev(`var e = document.getElementById(${JSON.stringify(id)}); return e ? e.value : null;`);
const click = (sel) => ev(`var b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true;`);
const text = () => ev(`return document.getElementById("smdWard").innerText;`);
const posts = (part) => ev(`return JSON.stringify(window.__calls.filter(function (c) { return c.method === "POST" && c.url.indexOf(${JSON.stringify(part)}) >= 0; }).map(function (c) { return c.body; }));`).then((s) => JSON.parse(s || "[]"));
/* A real mouse press: down on the element's centre, something in between, then up. */
async function press(sel, between) {
  const box = JSON.parse(await ev(`var b = document.querySelector(${JSON.stringify(sel)}); b.scrollIntoView({ block: "center" }); var r = b.getBoundingClientRect(); window.__pressed = b; return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });`));
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  if (between) await between();
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(60);
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready === true;`, 60), "real ward.js loaded into the harness");

  await ev(`window.__noAutoAnswer = true; window.__native = [];
    window.prompt = function (m) { window.__native.push(m); return "native"; }; window.confirm = function (m) { window.__native.push(m); return true; }; window.alert = function (m) { window.__native.push(m); };
    var real = window.fetch;
    window.__collect = { ok: false, error: "wrong_patient_scan" };
    window.fetch = function (url, opts) {
      var u = String(url), p = real(url, opts), body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      var reply = function (o, ms) { return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200, json: function () { return Promise.resolve(o); } }); }, ms || 0); }); };
      if (u.indexOf("/ward/collections") >= 0) return reply({ ok: true, requests: [{ serviceRequestId: "sr-1", display: "CBC", code: "CBC", category: "laboratory", collection: { state: "none" } }] });
      if (u.indexOf("/ward/collect") >= 0) return reply(window.__collect);
      if (u.indexOf("/ward/vitals") >= 0) return reply({ ok: true, written: 2 }, 1200);
      if (u.indexOf("/ward/flowsheet") >= 0) return reply({ ok: true, grid: { hours: [new Date().toISOString()], rows: [
        { label: "Systolic blood pressure", cells: [{ value: 120, unit: "mm[Hg]" }] }, { label: "Body temperature", cells: [{ value: 37, unit: "Cel" }] }] } });
      if (u.indexOf("/ward/news2") >= 0) return reply({ ok: true, tool: "NEWS2", patientId: "pat-1", score: { scorable: false, code: "INCOMPLETE", total: 0,
        missing: ["respiratoryRate", "oxygenSaturation", "supplementalOxygen"], reason: "incomplete: respiratoryRate, oxygenSaturation, supplementalOxygen were not recorded, so the partial total of 0 is not a risk assessment and must not be read as one" } });
      if (u.indexOf("/ward/medication-order") >= 0) return reply({ ok: true, written: 0, checkOnly: true, drug: body.order.drug, safety: { checked: true, allowed: false, warnings: [], unresolvedDrug: false, unresolvedActiveMeds: [],
        blocks: [{ code: "DOSE_ABSOLUTE_CEILING_CUMULATIVE", disposition: "block", hardStop: true, message: "With the paracetamol already active, this order makes 8000 mg a day, above the daily ceiling for paracetamol (4000 mg)." }],
        overridables: [{ code: "SAME_DRUG_ACTIVE", disposition: "overridable", message: "Paracetamol is already active for this patient (Paracetamol 1000 mg QDS)." }], hardStops: [{ code: "DOSE_ABSOLUTE_CEILING_CUMULATIVE" }] } });
      if (u.indexOf("/ward/ed-list") >= 0) return reply({ ok: true, patients: [] });
      if (u.indexOf("/patient/get") >= 0) return reply({ ok: true, patient: { name: "Test Patient QA-04", mrn: "SMD-6TEQZM-00030", ageYears: 45, gender: "male" } });
      if (u.indexOf("/ward/ed-arrival") >= 0) return reply({ ok: true, written: 1 });
      return p;
    };
    return true;`);

  await ev(`WARD.open({ orgId: "org-tablet-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="open:enc-1"]');`), "the ward list shows the harness patient");
  await click('[data-w-act="open:enc-1"]');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="collectspecimen:sr-1"]') && !!document.getElementById("wv_sbp");`), "the chart opened with an uncollected CBC and the vitals form");

  // ---- lab Collect ---------------------------------------------------------------------------------------------
  await click('[data-w-act="collectspecimen:sr-1"]');
  ok(await waitFor(`var d = document.querySelector('#smdWard .w-ask [role="dialog"]'); return !!d && d.getBoundingClientRect().width > 0;`), "Collect opens a question on the ward");
  ok(await ev(`return document.activeElement && document.activeElement.id === "wAsk_specimenType";`), "the cursor is in the specimen box");
  await type("wAsk_specimenType", "Serum");
  await ev(`WARD._dispatch("investigations"); return true;`); await sleep(400);
  ok((await value("wAsk_specimenType")) === "Serum", "what was typed in the dialog survives a repaint of the chart");
  await click('[data-w-act="askcancel"]');
  ok(await waitFor(`return !document.querySelector("#smdWard .w-ask");`) && (await posts("/ward/collect")).length === 0, "Cancel closes it and nothing is written");

  await click('[data-w-act="collectspecimen:sr-1"]');
  await waitFor(`return !!document.getElementById("wAsk_specimenType");`);
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return /Say which specimen was taken/.test(document.querySelector("#smdWard .w-ask").innerText);`) && (await posts("/ward/collect")).length === 0, "a blank specimen is refused in the dialog and nothing is sent");
  await type("wAsk_specimenType", "Whole blood"); await type("wAsk_scanned", "WRONG-MRN");
  await click('[data-w-act="askok"]');
  ok(await waitFor(`var a = document.querySelector("#smdWard .w-ask"); return a && /does not match this patient/.test(a.innerText);`), "a refused scan is said inside the dialog");
  ok((await value("wAsk_specimenType")) === "Whole blood" && (await value("wAsk_scanned")) === "WRONG-MRN", "and what was typed is still there to correct");
  await ev(`window.__collect = { ok: true, written: 1, accessionNumber: "ACC-9" }; return true;`);
  await ev(`var s = document.getElementById("wAsk_scanned"); s.select(); return true;`); await call("Input.insertText", { text: "MRN-H1" }); await sleep(40);
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return !document.querySelector("#smdWard .w-ask") && /Collected\\. Accession ACC-9\\./.test(document.getElementById("smdWard").innerText);`), "OK collects, the dialog closes and the ward says so");
  const collects = await posts("/ward/collect");
  ok(collects.length === 2 && collects[1].specimenType === "Whole blood" && collects[1].scannedPatientBarcode === "MRN-H1", "two sends, the second with the corrected scan: " + JSON.stringify(collects));

  // ---- units and NEWS2 words -----------------------------------------------------------------------------------
  ok(await waitFor(`var t = document.getElementById("smdWard").innerText; return /120 mmHg/.test(t) && /37 °C/.test(t);`), "the flowsheet reads 120 mmHg and 37 °C");
  const chartText = await text();
  ok(!/mm\[Hg\]|\bCel\b/.test(chartText), "no UCUM spelling on the chart");
  ok(/Not recorded: Respiratory rate, Oxygen saturation, Oxygen given or not/.test(chartText) && !/respiratoryRate/.test(chartText), "NEWS2 names what is missing in words");

  // ---- a press split by a repaint still records; busy state and result -------------------------------------------
  await type("wv_sbp", "118"); await type("wv_pulse", "90");
  await press('[data-w-act="vitals"]', async () => {
    await ev(`WARD._st.note = "a late read landed"; WARD._dispatch("dismiss"); return true;`);
    await sleep(150);
    ok(await ev(`return document.body.contains(window.__pressed);`), "a repaint while the button is held down does not replace the button under the pointer");
  });
  ok(await waitFor(`return (${JSON.stringify("/ward/vitals")}) && window.__calls.some(function (c) { return c.method === "POST" && c.url.indexOf("/ward/vitals") >= 0; });`, 10), "releasing it records the vitals: the click was not lost");
  ok(await waitFor(`var b = document.querySelector('[data-w-act="vitals"]'); return b && b.disabled && /Recording vitals\\.\\.\\./.test(b.textContent);`, 8), "while saving, the button is disabled and says Recording vitals...");
  ok(await waitFor(`var b = document.querySelector('[data-w-act="vitals"]'); var n = b && b.nextElementSibling; return b && !b.disabled && n && /Recorded 2 observations\\./.test(n.textContent);`, 30), "then it is pressable again and the result is said under it");
  const vit = await posts("/ward/vitals");
  ok(vit.length === 1 && vit[0].vitals.sbp === "118" && vit[0].vitals.pulse === "90", "one save, with what was typed: " + JSON.stringify(vit.map((b) => b.vitals)));

  // ---- a hard stop has nothing to sign -----------------------------------------------------------------------------
  await type("wMoDrug", "Paracetamol 1g"); await type("wMoValue", "1000"); await type("wMoUnit", "mg"); await type("wMoFreq", "QDS");
  await click('[data-w-act="medorder"]');
  ok(await waitFor(`return !!document.getElementById("wMoReview");`), "the server's check is shown");
  const review = await ev(`return document.getElementById("wMoReview").innerText;`);
  ok(/Hard stop/.test(review) && /Needs a reason to proceed/.test(review) && !/DOSE_ABSOLUTE_CEILING_CUMULATIVE/.test(review), "the ceiling reads Hard stop and the duplicate Needs a reason to proceed, with no rule code: " + review.replace(/\s+/g, " ").slice(0, 200));
  ok(await ev(`return !document.querySelector('[data-w-act="moconfirm"]') && !document.getElementById("wMoOverride");`), "no Prescribe anyway and no reason box past a hard stop");
  await click('[data-w-act="mocancel"]');

  // ---- known ED arrival with a chief complaint ---------------------------------------------------------------------
  await ev(`WARD._dispatch("edboard"); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="edarrivalopen"]');`), "the ED board opens");
  await click('[data-w-act="edarrivalopen"]');
  await waitFor(`return !!document.getElementById("wEdMrn");`);
  await type("wEdMrn", "SMD-6TEQZM-00030");
  await click('[data-w-act="edmrnlookup"]');
  ok(await waitFor(`return !!document.getElementById("wEdKnownCc");`), "a found patient is offered a chief complaint box");
  await type("wEdKnownCc", "Chest pain since morning");
  await click('[data-w-act="edarriveknown"]');
  ok(await waitFor(`return window.__calls.some(function (c) { return c.url.indexOf("/ward/ed-arrival") >= 0; });`), "the arrival is sent");
  const arr = await posts("/ward/ed-arrival");
  ok(arr.length === 1 && arr[0].arrival.mrn === "SMD-6TEQZM-00030" && arr[0].arrival.chiefComplaint === "Chest pain since morning", "with the MRN and the chief complaint: " + JSON.stringify(arr));

  ok(JSON.parse(await ev(`return JSON.stringify(window.__native);`)).length === 0, "no browser prompt, confirm or alert was opened anywhere in this run");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
