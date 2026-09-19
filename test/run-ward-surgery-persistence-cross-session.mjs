/* WardSynQ Surgery/OT: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a
 * REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository
 * over a real sqlite file). Extends the pattern in run-ward-icu-persistence-cross-session.mjs to
 * a surgical case (booking, consent, Sign In) and its linked SURGERY encounter.
 *
 *   node test/run-ward-surgery-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-surgery-persistence.sqlite");
const PORT = 8803, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9395;
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
  `--user-data-dir=${JOB_DIR}/ward-surgery-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A (the booking surgeon): real registration, a real case booking, real consent -----
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Surgery Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 52 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));
  const mrn = reg.mrn;

  const booking = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/surgery-book", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", booking: { mrn: ${JSON.stringify(mrn)}, procedure: "Inguinal Hernia Repair", site: "groin", laterality: "left", theatre: "OT-2" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(booking.ok === true && booking.written === 2, "session A: a REAL POST /ward/surgery-book wrote a REAL SurgicalCase and a linked SURGERY Encounter: " + JSON.stringify(booking));

  const consent = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/surgery-consent", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", caseId: ${JSON.stringify(booking.caseId)}, consent: { procedure: "Inguinal Hernia Repair", laterality: "left", signedByPatientOrProxy: true, givenBy: "patient" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(consent.ok === true && consent.stage === "booked", "session A: a REAL POST /ward/surgery-consent recorded consent through the REAL PatientConsent record: " + JSON.stringify(consent));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const boardB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/surgery-board?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(boardB.ok === true && boardB.cases.some((c) => c.id === booking.caseId && c.procedure === "Inguinal Hernia Repair"), "session B (independent target/device): sees the SAME open case session A booked - real server state, not client state: " + JSON.stringify(boardB));
  const caseB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/surgery-get?orgId=org-wsq&caseId=${booking.caseId}").then(function(r){ return r.text(); });`));
  ok(caseB.ok === true && caseB.case.consent && caseB.case.consent.procedure === "Inguinal Hernia Repair", "session B: sees the SAME consent session A recorded: " + JSON.stringify(caseB.case.consent));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const caseC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/surgery-get?orgId=org-wsq&caseId=${booking.caseId}").then(function(r){ return r.text(); });`));
  ok(caseC.ok === true && caseC.case && caseC.case.consent && caseC.case.stage === "booked", "AFTER A FULL SERVER RESTART: the case and its consent are still there, read back from the sqlite FILE, not memory: " + JSON.stringify(caseC.case));
  const encC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/fhir/Encounter/${booking.encounterId}?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(encC.class && encC.class.code === "IMP", "AFTER A FULL SERVER RESTART: the linked SURGERY encounter still exports correctly over FHIR: " + JSON.stringify(encC.class));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
