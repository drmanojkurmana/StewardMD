/* WardSynQ TASK 3.2: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a REAL
 * local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository over a
 * real sqlite file). Proves a critical imaging finding (text, no numeric value) opens the SAME
 * closed-loop critical-result mechanism a critical lab value does, and survives a genuine server
 * restart.
 *
 *   node test/run-ward-radiology-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-radiology-persistence.sqlite");
const PORT = 8809, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9407;
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
// Captures the TRUE original fetch exactly once per page, so calling this more than once on the
// SAME page (switching identity mid-flow, e.g. doctor -> lab -> doctor) replaces the shim rather
// than nesting it - a nested shim would let the FIRST-registered identity win forever, since its
// header write runs closest to the real fetch and overwrites every outer shim's header.
const AUTH_SHIM = (email) => `
  if (!window.__realFetch0) window.__realFetch0 = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var h = new Headers(opts.headers || {});
    h.set("Cf-Access-Authenticated-User-Email", ${JSON.stringify(email)});
    return window.__realFetch0(url, Object.assign({}, opts, { headers: h }));
  };
`;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${JOB_DIR}/ward-radiology-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: register, admit, order imaging, release a REAL critical report. -----------------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Radiology Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 39 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));

  const adm = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(reg.mrn)}, ward: "Medical A", bed: "5" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(adm.ok === true, "session A: a REAL POST /ward/admit created a real admission: " + JSON.stringify(adm));

  const sr = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/investigation", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", encounterId: ${JSON.stringify(adm.encounterId)}, code: "Chest X-ray", category: "imaging", priority: "stat" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(sr.ok === true, "session A: a REAL POST /ward/investigation opened a real imaging order: " + JSON.stringify(sr));

  await ev(A, AUTH_SHIM("lab@example.test"));
  const report = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/report-imaging", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", serviceRequestId: ${JSON.stringify(sr.orderId)}, modality: "XR", status: "final",
        findings: "Large right pneumothorax with mediastinal shift.", impression: "Tension pneumothorax.", critical: true }) })
      .then(function(r){ return r.text(); });
  `));
  await ev(A, AUTH_SHIM("doctor@example.test"));
  ok(report.ok === true && report.critical === true, "session A: a REAL critical imaging report released, flag written for real: " + JSON.stringify(report));

  const opened = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/flag-critical", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", reportId: ${JSON.stringify(report.reportId)} }) })
      .then(function(r){ return r.text(); });
  `));
  ok(opened.ok === true && opened.opened === 1 && opened.loops[0].notification.reason === "NO_CHANNEL",
    "session A: the SAME closed-loop mechanism opens for this text finding, against real storage, with an honest NO_CHANNEL notification: " + JSON.stringify(opened.loops[0]));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const listB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/criticals?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(listB.ok === true && listB.open === 1, "session B (independent target/device): sees the SAME open critical loop session A opened - real server state: " + JSON.stringify(listB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const listC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/criticals?orgId=org-wsq&patientId=${adm.patientId}").then(function(r){ return r.text(); });`));
  ok(listC.ok === true && listC.open === 1 && listC.loops[0].display === "Chest X-ray",
    "AFTER A FULL SERVER RESTART: the critical imaging finding is still open, read back from the sqlite FILE, not memory: " + JSON.stringify(listC.loops[0]));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
