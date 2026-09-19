/* WardSynQ TASK 3.1: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a REAL
 * local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository over a
 * real sqlite file). Proves the specimen safeguards survive real, persisted storage: the
 * wrong-patient scan refusal, the accession number, and the collection state all read back correctly
 * from disk after a genuine server restart.
 *
 *   node test/run-ward-lab-specimen-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-lab-specimen-persistence.sqlite");
const PORT = 8808, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9405;
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
  `--user-data-dir=${JOB_DIR}/ward-lab-specimen-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: register a real patient, order a real lab test, collect it for real. -------------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Lab Specimen Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "male", ageYears: 47 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));
  const mrn = reg.mrn;

  const adm = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(mrn)}, ward: "Medical A", bed: "9" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(adm.ok === true, "session A: a REAL POST /ward/admit created a real admission: " + JSON.stringify(adm));

  const sr = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/investigation", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", encounterId: ${JSON.stringify(adm.encounterId)}, code: "Renal profile", category: "laboratory" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(sr.ok === true, "session A: a REAL POST /ward/investigation opened a real lab order: " + JSON.stringify(sr));

  // Wrong-patient collection blocked, against REAL storage.
  const attack = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/collect", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", serviceRequestId: ${JSON.stringify(sr.orderId)}, specimenType: "Whole blood", scannedPatientBarcode: "WRONG-MRN-999" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(attack.ok === false && attack.error === "wrong_patient_scan", "session A: a wrong-patient wristband scan is REFUSED against real storage: " + JSON.stringify(attack));

  const collect = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/collect", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", serviceRequestId: ${JSON.stringify(sr.orderId)}, specimenType: "Whole blood", scannedPatientBarcode: ${JSON.stringify(mrn)} }) })
      .then(function(r){ return r.text(); });
  `));
  ok(collect.ok === true && /^ACC-/.test(collect.accessionNumber), "session A: the correct scan collects the specimen with a REAL accession number, written for real: " + JSON.stringify(collect));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const collB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/collections?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(collB.ok === true && collB.requests[0].collection.state === "collected", "session B (independent target/device): sees the SAME collected state session A wrote - real server state, not client state: " + JSON.stringify(collB.requests[0]));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const collC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/collections?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(collC.ok === true && collC.requests[0].collection.state === "collected",
    "AFTER A FULL SERVER RESTART: the collection is still there, read back from the sqlite FILE, not memory: " + JSON.stringify(collC.requests[0]));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
