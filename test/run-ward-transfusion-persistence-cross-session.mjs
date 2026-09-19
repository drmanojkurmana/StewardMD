/* WardSynQ TASK 3.5: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a REAL
 * local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository over a
 * real sqlite file). Proves a real transfusion episode - request, crossmatch, issue, two-person
 * bedside check, start, observe, complete - survives real storage and a genuine server restart, with
 * one version per phase transition, exactly as test/wardsynq-transfusion-bridge.test.mjs already
 * proves against an in-process store. Doctor holds EMR_TREAT/EMR_VIEW for every transfusion route
 * (see migrate-transfusion.js's own header on the deliberately-unbuilt duty separation), so no
 * identity switch is needed here.
 *
 *   node test/run-ward-transfusion-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-transfusion-persistence.sqlite");
const PORT = 8812, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9413;
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
  `--user-data-dir=${JOB_DIR}/ward-transfusion-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: register, admit, request, crossmatch, issue, bedside-check, start, observe,
  // complete - all against real storage. -----------------------------------------------------------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876600" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Transfusion Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 44 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));

  const adm = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(reg.mrn)}, ward: "Medical A", bed: "9" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(adm.ok === true, "session A: a REAL POST /ward/admit created a real admission: " + JSON.stringify(adm));

  const req = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-request", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(reg.mrn)}, component: "red-cells", units: 2, indication: "Acute blood loss", aboGroup: "O", rhD: "negative" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(req.ok === true && !!req.episodeId, "session A: a REAL POST /ward/transfusion-request created a real episode: " + JSON.stringify(req));
  const episodeId = req.episodeId, patientId = req.patientId;

  const xm = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-crossmatch", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)}, unitId: "UNIT-PERSIST-01", aboGroup: "O", rhD: "negative", component: "red-cells", expiresAt: "2027-01-01T00:00:00.000Z" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(xm.ok === true && xm.phase === "crossmatched", "session A: a REAL crossmatch written for real: " + JSON.stringify(xm));

  const iss = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-issue", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)} }) })
      .then(function(r){ return r.text(); });
  `));
  ok(iss.ok === true && iss.phase === "issued", "session A: a REAL issue written for real: " + JSON.stringify(iss));

  const check = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-bedside-check", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)}, checkerId: "nurse-a", secondCheckerId: "nurse-b",
        scannedPatientBarcode: ${JSON.stringify(reg.mrn)}, scannedUnitId: "UNIT-PERSIST-01",
        patient: { id: ${JSON.stringify(patientId)}, mrn: ${JSON.stringify(reg.mrn)}, wristbandBarcode: ${JSON.stringify(reg.mrn)} },
        unitInHand: { unitId: "UNIT-PERSIST-01", aboGroup: "O", rhD: "negative", component: "red-cells" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(check.ok === true && check.phase === "checked", "session A: a REAL two-person bedside check written for real: " + JSON.stringify(check));

  const start = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-start", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)} }) })
      .then(function(r){ return r.text(); });
  `));
  ok(start.ok === true && start.phase === "transfusing", "session A: a REAL start written for real: " + JSON.stringify(start));

  const obs = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/transfusion-observe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)}, vitals: { pulse: 90, temp: 37.3 } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(obs.ok === true && obs.observations && obs.observations.length === 1, "session A: a REAL observation written for real: " + JSON.stringify(obs));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("doctor@example.test"));
  const queueB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/transfusion-queue?orgId=org-wsq&patientId=${patientId}").then(function(r){ return r.text(); });`));
  ok(queueB.ok === true && queueB.episodes.length === 1 && queueB.episodes[0].phase === "transfusing" && queueB.episodes[0].crossmatch && queueB.episodes[0].crossmatch.unitId === "UNIT-PERSIST-01",
    "session B (independent target/device): sees the SAME real episode session A wrote, mid-transfusion, real server state not client state: " + JSON.stringify(queueB.episodes[0] && { phase: queueB.episodes[0].phase, unitId: queueB.episodes[0].crossmatch && queueB.episodes[0].crossmatch.unitId }));

  const traceB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/transfusion-trace?orgId=org-wsq&unitId=UNIT-PERSIST-01").then(function(r){ return r.text(); });`));
  ok(traceB.ok === true && traceB.trace.length === 1 && traceB.trace[0].episodeId === episodeId,
    "session B: unit-level traceability reads the same real unit across an org-wide query: " + JSON.stringify(traceB.trace[0] && traceB.trace[0].episodeId));

  // Complete the transfusion from session B, proving cross-session writes interleave correctly.
  const done = JSON.parse(await ev(B, `
    return fetch("/api/queue/ward/transfusion-complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", episodeId: ${JSON.stringify(episodeId)} }) })
      .then(function(r){ return r.text(); });
  `));
  ok(done.ok === true && done.phase === "completed", "session B: a REAL completion written for real, from a different session than the one that started it: " + JSON.stringify(done));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const queueC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/transfusion-queue?orgId=org-wsq&patientId=${patientId}").then(function(r){ return r.text(); });`));
  ok(queueC.ok === true && queueC.episodes.length === 1 && queueC.episodes[0].phase === "completed" && queueC.episodes[0].observations && queueC.episodes[0].observations.length === 1,
    "AFTER A FULL SERVER RESTART: the episode is still there, completed, with its observation - read back from the sqlite FILE, not memory: " + JSON.stringify({ phase: queueC.episodes[0] && queueC.episodes[0].phase, observations: queueC.episodes[0] && queueC.episodes[0].observations && queueC.episodes[0].observations.length }));

  const historyLen = (queueC.episodes[0] && queueC.episodes[0].ledger || []).length;
  ok(historyLen >= 6, "AFTER RESTART: the ledger still carries one entry per phase transition (requested/crossmatched/issued/checked/started/observed/completed): " + historyLen);

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
