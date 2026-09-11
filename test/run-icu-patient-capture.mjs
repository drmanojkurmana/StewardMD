/* ICU "Patient details / Case sheet" capture (2026-09-07): a Snapshot step that reads a
 * photographed case sheet / admission note / EMR screen (name, age, sex, MRN, hospital, bed,
 * doctor, dept, allergies, presenting complaints, past history / comorbidities, working diagnosis,
 * code status) and shows it in a dedicated review sheet (openPatientReview) before it is applied to
 * STATE.patient via ICU.ingestPatient() — mirrors, but does not reuse, the numeric-only
 * openImportReview sheet used for vitals/labs (identity/history text needs its own field types).
 *
 * This test drives the review sheet directly via the test hooks (ICU._patientReview,
 * ICU._savePatientCapture) rather than a real photo capture — the vision call itself is
 * prod-only/server-side (same convention as test/run-icu-import.mjs).
 * USAGE: node test/run-icu-patient-capture.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9458, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-patient-capture-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8921"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU._patientReview && ICU._savePatientCapture)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU patient-capture API not loaded");

  // ---- schema: pastHistory exists on a fresh patient object and in the capture field list ----
  const schema = await J(`
    ICU.reset();
    return JSON.stringify({ hasField: "pastHistory" in ICU.state().patient, capKeys: ICU._patientCapFields.map(function(f){return f.k;}) });
  `);
  ok(schema.hasField === true, "STATE.patient has a pastHistory field");
  ok(schema.capKeys.indexOf("pastHistory") !== -1 && schema.capKeys.indexOf("complaints") !== -1 && schema.capKeys.indexOf("name") !== -1,
    `capture review shows the full patient-detail field set (${JSON.stringify(schema.capKeys)})`);

  // ---- capture with an existing patient (bed already set) → review pre-filled, nothing applied yet ----
  const preview = await J(`
    ICU.reset(); ICU.ingestPatient({ name: "placeholder", bed: "5" });
    ICU._patientReview({ name: "Ramesh Kumar", age: 54, sex: "M", mrn: "UHID1234", hospital: "GIMSR",
      doctor: "Dr Rao", dept: "Cardiology", allergies: "Penicillin (rash)",
      complaints: "Chest pain since 2 days", pastHistory: "Diabetes, hypertension",
      diagnosis: "NSTEMI" });
    function v(k){ var el = document.querySelector('[data-pk="'+k+'"]'); return el ? el.value : null; }
    return JSON.stringify({
      name: v("name"), age: v("age"), sex: v("sex"), mrn: v("mrn"), pastHistory: v("pastHistory"),
      diagnosis: v("diagnosis"), stillPlaceholder: ICU.state().patient.name === "placeholder"
    });
  `);
  ok(preview.name === "Ramesh Kumar", `review sheet pre-fills the captured name (got "${preview.name}")`);
  ok(preview.age === "54" && preview.sex === "M", `age/sex pre-filled (age="${preview.age}" sex="${preview.sex}")`);
  ok(preview.mrn === "UHID1234", `MRN pre-filled (got "${preview.mrn}")`);
  ok(preview.pastHistory === "Diabetes, hypertension", `past history pre-filled (got "${preview.pastHistory}")`);
  ok(preview.stillPlaceholder === true, "nothing is applied to the patient record until Save is tapped");

  // ---- edit a misread field, then Save → applied; fields not shown in capture (bed) untouched ----
  const saved = await J(`
    document.querySelector('[data-pk="age"]').value = "55";   // clinician corrects a misread age
    ICU._savePatientCapture();
    var p = ICU.state().patient;
    return JSON.stringify({ name: p.name, age: p.age, sex: p.sex, mrn: p.mrn, hospital: p.hospital,
      doctor: p.doctor, dept: p.dept, allergies: p.allergies, complaints: p.complaints,
      pastHistory: p.pastHistory, diagnosis: p.diagnosis, bed: p.bed,
      modalClosed: !document.querySelector(".icu-modal.on") });
  `);
  ok(saved.name === "Ramesh Kumar" && saved.age === 55, `Save applies the (corrected) fields to STATE.patient (name="${saved.name}", age=${saved.age})`);
  ok(saved.mrn === "UHID1234" && saved.hospital === "GIMSR" && saved.doctor === "Dr Rao" && saved.dept === "Cardiology",
    "identity/admin fields (MRN, hospital, doctor, dept) all applied");
  ok(saved.allergies === "Penicillin (rash)" && saved.complaints.indexOf("Chest pain") !== -1 &&
    saved.pastHistory === "Diabetes, hypertension" && saved.diagnosis === "NSTEMI",
    "allergy / presenting-complaint / past-history / diagnosis text fields all applied verbatim");
  ok(saved.bed === "5", "a field NOT present in the capture (bed, set earlier) is left untouched — ingestPatient never blanks what it wasn't given");
  ok(saved.modalClosed === true, "the review sheet closes after Save");

  // ---- Cancel discards a capture instead of applying it ----
  const cancelled = await J(`
    ICU.reset(); ICU.ingestPatient({ name: "Unchanged", bed: "9" });
    ICU._patientReview({ name: "Wrong Person", age: 30 });
    document.querySelector('[data-icu-act="closeform"]').click();
    return JSON.stringify({ name: ICU.state().patient.name, modalClosed: !document.querySelector(".icu-modal.on") });
  `);
  ok(cancelled.name === "Unchanged", "Cancel discards the captured fields — the existing patient name is untouched");
  ok(cancelled.modalClosed === true, "Cancel closes the review sheet");

  console.log(fails === 0 ? "\nALL GREEN — Patient / EMR case-sheet capture review + save/cancel" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
