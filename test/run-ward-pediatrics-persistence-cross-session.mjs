/* WardSynQ Pediatrics/NICU: persistence across a RELOAD, a second independent browser session
 * ("another device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file -
 * against a REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real
 * D1Repository over a real sqlite file). Extends the pattern in
 * run-ward-maternity-persistence-cross-session.mjs to the core Task 2.5 bug fix: a newborn's own
 * real MRN, admitted to a NICU-class Encounter, must land on the SAME already-registered Patient
 * migrate-maternity.js's registerNewborn() created - proven here against real, persisted storage,
 * not just an in-memory test double, and proven to survive a genuine server restart.
 *
 *   node test/run-ward-pediatrics-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-pediatrics-persistence.sqlite");
const PORT = 8805, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9399;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

function startServer() {
  return spawn("node", ["--experimental-test-module-mocks", "--experimental-sqlite",
    "test/wardsynq-persistence-server.mjs", String(PORT), DB_PATH], { stdio: ["ignore", "pipe", "inherit"] });
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/"); if (r.ok) return true; } catch {} await sleep(200); }
  return false;
}

let server = startServer();
let msgId = 1; const pending = new Map(); let ws;
const call = (sessionId, m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
async function newTarget() {
  const { result: { targetId } } = await call(undefined, "Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call(undefined, "Target.attachToTarget", { targetId, flatten: true });
  await call(sessionId, "Runtime.enable", {});
  return sessionId;
}
async function ev(sessionId, expr) {
  const r = await call(sessionId, "Runtime.evaluate", { expression: `(async function(){try{${expr}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
}
const AUTH_SHIM = (email) => `
  var __realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var h = new Headers(opts.headers || {});
    h.set("Cf-Access-Authenticated-User-Email", ${JSON.stringify(email)});
    return __realFetch(url, Object.assign({}, opts, { headers: h }));
  };
`;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${JOB_DIR}/ward-pediatrics-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: mother -> delivery -> newborn -> NICU admission of that SAME newborn ----------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "NICU Cross-Session Mother", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 33 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real mother: " + JSON.stringify(reg));

  const admit = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(reg.mrn)}, ward: "Labour Ward", bed: "9", class: "MATERNITY" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(admit.ok === true, "session A: a REAL POST /ward/admit (MATERNITY) wrote a REAL Encounter: " + JSON.stringify(admit));

  const delivery = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/delivery", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", patientId: ${JSON.stringify(admit.patientId)}, encounterId: ${JSON.stringify(admit.encounterId)}, delivery: { mode: "vaginal" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(delivery.ok === true, "session A: a REAL delivery recorded: " + JSON.stringify(delivery));

  const newborn = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/newborn", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", motherPatientId: ${JSON.stringify(admit.patientId)}, encounterId: ${JSON.stringify(admit.encounterId)}, sex: "female", name: "Cross-Session Baby" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(newborn.ok === true && !!newborn.newbornId, "session A: a REAL newborn registered with its own MRN: " + JSON.stringify(newborn));

  const babyPatient = JSON.parse(await ev(A, `return fetch("/api/queue/ward/fhir/Patient/${newborn.newbornId}?orgId=org-wsq").then(function(r){ return r.text(); });`));
  const babyMrn = (babyPatient.identifier && babyPatient.identifier[0] && babyPatient.identifier[0].value) || null;
  ok(!!babyMrn, "session A: the newborn's real MRN is readable back from the real Patient record: " + JSON.stringify(babyPatient).slice(0, 200));

  const nicuAdmit = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(babyMrn)}, ward: "NICU", bed: "Cot 7", class: "NICU" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(nicuAdmit.ok === true, "session A: a REAL POST /ward/admit (NICU) using the newborn's own MRN succeeded: " + JSON.stringify(nicuAdmit));
  ok(nicuAdmit.patientId === newborn.newbornId, "THE FIX PROVEN AGAINST REAL STORAGE: the NICU admission's patientId is the SAME Patient registerNewborn() already created - not a second, mismatched record: " + nicuAdmit.patientId + " === " + newborn.newbornId);

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const listB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/list?orgId=org-wsq&ward=NICU").then(function(r){ return r.text(); });`));
  ok(listB.ok === true && listB.patients.some((p) => p.encounterId === nicuAdmit.encounterId && p.patientId === newborn.newbornId), "session B (independent target/device): sees the SAME NICU admission, correct patientId - real server state, not client state: " + JSON.stringify(listB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const listC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/list?orgId=org-wsq&ward=NICU").then(function(r){ return r.text(); });`));
  ok(listC.ok === true && listC.patients.some((p) => p.encounterId === nicuAdmit.encounterId && p.patientId === newborn.newbornId), "AFTER A FULL SERVER RESTART: the NICU admission and its correct patient linkage are still there, read back from the sqlite FILE, not memory: " + JSON.stringify(listC));
  const encC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/fhir/Encounter/${nicuAdmit.encounterId}?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(encC.class && encC.class.code === "IMP", "AFTER A FULL SERVER RESTART: the NICU encounter still exports correctly over FHIR: " + JSON.stringify(encC.class));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
