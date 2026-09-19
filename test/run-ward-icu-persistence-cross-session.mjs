/* WardSynQ ICU: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a
 * REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository
 * over a real sqlite file). Extends the pattern in run-ward-ed-persistence-cross-session.mjs to
 * ICU admission (class:"ICU", explicit) and device association, which that script never touches.
 *
 *   node test/run-ward-icu-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-icu-persistence.sqlite");
const PORT = 8802, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9393;
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
  `--user-data-dir=${JOB_DIR}/ward-icu-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A (the admitting doctor): a REAL patient, a REAL ICU admission, a REAL device -----
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  // Registration is a real prerequisite here, unlike a bare admission: device-associate now looks
  // up the real Patient record server-side (the fix that closed the wristband-spoofing gap), so an
  // MRN with no registered patient behind it would 404 at that step rather than merely admit.
  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "ICU Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "male", ageYears: 59 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));
  const mrn = reg.mrn;
  const admitResp = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(mrn)}, ward: "ICU", bed: "9", class: "ICU", admittedAt: new Date().toISOString() }) })
      .then(function(r){ return r.text(); });
  `));
  ok(admitResp.ok === true && admitResp.written === 1, "session A: a REAL POST /ward/admit with class:\"ICU\" wrote a REAL Encounter: " + JSON.stringify(admitResp));

  const assocResp = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/device-associate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", association: { device: { deviceId: "mon-xsess", assetTag: "AT-XSESS" },
        patient: { id: ${JSON.stringify(admitResp.patientId)} }, encounterId: ${JSON.stringify(admitResp.encounterId)},
        scannedWristband: ${JSON.stringify(mrn)}, scannedAssetTag: "AT-XSESS" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(assocResp.ok === true && assocResp.association.patientId === admitResp.patientId, "session A: a REAL POST /ward/device-associate bound a REAL monitor, wristband checked against the REAL registered patient: " + JSON.stringify(assocResp));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const listB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/list?orgId=org-wsq&ward=ICU").then(function(r){ return r.text(); });`));
  ok(listB.ok === true && listB.patients.some((p) => p.encounterId === admitResp.encounterId && p.class === "ICU"), "session B (independent target/device): sees the SAME encounter, correctly still class ICU - real server state, not client state: " + JSON.stringify(listB));
  const statusB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/device-status?orgId=org-wsq&deviceId=mon-xsess").then(function(r){ return r.text(); });`));
  ok(statusB.ok === true && statusB.association && statusB.association.patientId === admitResp.patientId, "session B: sees the SAME device association session A made: " + JSON.stringify(statusB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const listC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/list?orgId=org-wsq&ward=ICU").then(function(r){ return r.text(); });`));
  ok(listC.ok === true && listC.patients.some((p) => p.encounterId === admitResp.encounterId && p.class === "ICU"), "AFTER A FULL SERVER RESTART: the ICU admission is still there, class ICU intact, read back from the sqlite FILE, not memory: " + JSON.stringify(listC));
  const statusC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/device-status?orgId=org-wsq&deviceId=mon-xsess").then(function(r){ return r.text(); });`));
  ok(statusC.ok === true && statusC.association && statusC.association.patientId === admitResp.patientId, "AFTER A FULL SERVER RESTART: the device association survived too: " + JSON.stringify(statusC));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
