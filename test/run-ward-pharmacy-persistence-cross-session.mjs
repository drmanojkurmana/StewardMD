/* WardSynQ TASK 3.3: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a REAL
 * local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository over a
 * real sqlite file). Proves a pharmacist's verification and a real dispense both survive real
 * storage and a genuine server restart, and that the safety-engine verdict travels WITH the queue.
 *
 *   node test/run-ward-pharmacy-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-pharmacy-persistence.sqlite");
const PORT = 8810, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9409;
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
  if (!window.__realFetch0) window.__realFetch0 = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var h = new Headers(opts.headers || {});
    h.set("Cf-Access-Authenticated-User-Email", ${JSON.stringify(email)});
    return window.__realFetch0(url, Object.assign({}, opts, { headers: h }));
  };
`;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${JOB_DIR}/ward-pharmacy-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: register, admit, order, verify, dispense - all against real storage. ------------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Pharmacy Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "male", ageYears: 61 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));

  const adm = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(reg.mrn)}, ward: "Medical A", bed: "6" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(adm.ok === true, "session A: a REAL POST /ward/admit created a real admission: " + JSON.stringify(adm));

  const ord = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/medication-order", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", order: { patientId: ${JSON.stringify(adm.patientId)}, encounterId: ${JSON.stringify(adm.encounterId)}, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(ord.ok === true, "session A: a REAL POST /ward/medication-order created a real order: " + JSON.stringify(ord));

  await ev(A, AUTH_SHIM("pharmacy@example.test"));
  const queue = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/verification-queue?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });
  `));
  ok(queue.ok === true, "session A: the verification queue reads real orders against real storage: " + JSON.stringify(queue).slice(0, 200));
  ok(!!(queue.orders && queue.orders[0] && queue.orders[0].safety), "session A: the queue carries a REAL safety verdict per order, computed against real storage: " + JSON.stringify(queue.orders && queue.orders[0] && queue.orders[0].safety));

  const verify = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/verify-order", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", orderId: ${JSON.stringify(ord.orderId)}, outcome: "verified" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(verify.ok === true, "session A: a REAL verification written for real: " + JSON.stringify(verify));

  const dispense = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/dispense", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", orderId: ${JSON.stringify(ord.orderId)}, quantity: { value: 21, unit: "capsule" }, batch: "AMX-2201", expiry: "2027-01-31" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(dispense.ok === true && dispense.batch === "AMX-2201", "session A: a REAL dispense with a real batch, written for real: " + JSON.stringify(dispense));
  await ev(A, AUTH_SHIM("doctor@example.test"));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  // "another device" here is a second pharmacist session, not a nurse or doctor - reading dispenses
  // requires ORDER_VERIFY (the same pharmacy-only authority as verifying/dispensing itself, per
  // [[path]].js's own capFor table), which neither nurse nor doctor holds.
  await ev(B, AUTH_SHIM("pharmacy@example.test"));
  const dispensesB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/dispenses?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(dispensesB.ok === true && dispensesB.dispenses.length === 1 && dispensesB.dispenses[0].batch === "AMX-2201",
    "session B (independent target/device): sees the SAME real dispense session A wrote - real server state, not client state: " + JSON.stringify(dispensesB.dispenses[0]));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("pharmacy@example.test"));
  const queueC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/verification-queue?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  const dispensesC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/dispenses?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(queueC.ok === true && queueC.orders[0].state === "verified" && dispensesC.dispenses.length === 1,
    "AFTER A FULL SERVER RESTART: the verification and the dispense are both still there, read back from the sqlite FILE, not memory: " + JSON.stringify({ state: queueC.orders[0].state, dispenses: dispensesC.dispenses.length }));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
