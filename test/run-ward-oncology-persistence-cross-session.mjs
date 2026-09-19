/* WardSynQ ONCqis bridge: persistence across a RELOAD, a second independent browser session
 * ("another device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file -
 * against a REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real
 * D1Repository over a real sqlite file). Proves the core Task 2.6 claim - "no disconnected
 * oncology patient record" - against real, persisted storage: a plan linked by its bare ghisPatientId
 * resolves to the SAME canonical patient a real /patient/register created, and the whole timeline
 * survives a genuine server restart.
 *
 *   node test/run-ward-oncology-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-oncology-persistence.sqlite");
const PORT = 8806, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9401;
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
  `--user-data-dir=${JOB_DIR}/ward-oncology-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: register a real patient, link an ONCqis plan by bare MRN, record everything ----
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Oncology Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 57 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));
  const mrn = reg.mrn;

  const link = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/onco-link", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", plan: { oncoPlanId: "plan-xsess-001", hospitalId: "org-wsq", ghisPatientId: ${JSON.stringify(mrn)}, regimen: "FOLFOX", protocolVersion: "2" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(link.ok === true, "session A: a REAL POST /ward/onco-link wrote a REAL OncologyLink, resolved from a bare MRN: " + JSON.stringify(link));
  ok(link.patientId === "opd-pat-" + mrn.toLowerCase(), "THE BRIDGE PROVEN AGAINST REAL STORAGE: the link's patientId is the SAME canonical id /patient/register's own MRN resolves to - no disconnected record: " + link.patientId);

  const dx = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/onco-diagnosis", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", patientId: ${JSON.stringify(link.patientId)}, condition: { code: "C18.9", display: "Malignant neoplasm of colon" }, staging: { oncoSite: "colon", stageGroup: "III", t: "T3", n: "N1", m: "M0" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(dx.ok === true, "session A: a REAL diagnosis with ONCqis-resolved staging recorded: " + JSON.stringify(dx));

  const chemo = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/onco-chemo", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", patientId: ${JSON.stringify(link.patientId)}, encounterId: "enc-standalone", oncoPlanId: "plan-xsess-001", cycleId: "plan-xsess-001__1", admin: { drug: "Oxaliplatin", doseGiven: 150, bsaUsed: 1.9, route: "IV" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(chemo.ok === true, "session A: a REAL chemo administration, with real dose lineage, recorded: " + JSON.stringify(chemo));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const tlB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/onco-timeline?orgId=org-wsq&patientId=${link.patientId}").then(function(r){ return r.text(); });`));
  ok(tlB.ok === true && tlB.timeline.links.length === 1 && tlB.timeline.diagnoses.length === 1 && tlB.timeline.chemoAdministrations.length === 1,
    "session B (independent target/device): sees the SAME full oncology timeline session A built - real server state, not client state: " + JSON.stringify(tlB.timeline).slice(0, 300));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const tlC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/onco-timeline?orgId=org-wsq&patientId=${link.patientId}").then(function(r){ return r.text(); });`));
  ok(tlC.ok === true && tlC.timeline.links.length === 1 && tlC.timeline.diagnoses[0].oncologyStaging.stageGroup === "III" && tlC.timeline.chemoAdministrations[0].bsaUsed === 1.9,
    "AFTER A FULL SERVER RESTART: the entire oncology timeline - link, staged diagnosis, chemo dose lineage - is still there, read back from the sqlite FILE, not memory: " + JSON.stringify(tlC.timeline).slice(0, 300));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
