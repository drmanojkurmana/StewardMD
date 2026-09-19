/* WardSynQ Maternity: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a
 * REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository
 * over a real sqlite file). Extends the pattern in run-ward-surgery-persistence-cross-session.mjs
 * to a MATERNITY admission, a pregnancy episode, a delivery, and a newborn FamilyLink.
 *
 *   node test/run-ward-maternity-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-maternity-persistence.sqlite");
const PORT = 8804, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9397;
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
  `--user-data-dir=${JOB_DIR}/ward-maternity-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A (the admitting midwife): real registration, real MATERNITY admission -----------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mobile = "9876500" + String(Date.now()).slice(-3);
  const reg = JSON.parse(await ev(A, `
    return fetch("/api/queue/patient/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", name: "Maternity Cross-Session Patient", mobile: ${JSON.stringify(mobile)}, gender: "female", ageYears: 31 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(reg.ok !== false && !!reg.mrn, "session A: a REAL POST /patient/register created a real patient: " + JSON.stringify(reg));
  const mrn = reg.mrn;

  const admit = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(mrn)}, ward: "Labour Ward", bed: "4", class: "MATERNITY" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(admit.ok === true && admit.written === 1, "session A: a REAL POST /ward/admit with class:\"MATERNITY\" wrote a REAL Encounter: " + JSON.stringify(admit));

  const preg = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/pregnancy", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", patientId: ${JSON.stringify(admit.patientId)}, pregnancy: { gravida: 3, para: 2, gestationWeeks: 40 } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(preg.ok === true, "session A: a REAL POST /ward/pregnancy recorded the episode: " + JSON.stringify(preg));

  const delivery = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/delivery", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", patientId: ${JSON.stringify(admit.patientId)}, encounterId: ${JSON.stringify(admit.encounterId)}, delivery: { mode: "vaginal" } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(delivery.ok === true, "session A: a REAL POST /ward/delivery recorded the delivery, incrementing para: " + JSON.stringify(delivery));

  const newborn = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/newborn", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", motherPatientId: ${JSON.stringify(admit.patientId)}, encounterId: ${JSON.stringify(admit.encounterId)}, sex: "male", name: "Baby Cross-Session" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(newborn.ok === true && !!newborn.newbornId, "session A: a REAL POST /ward/newborn registered a real Patient + FamilyLink: " + JSON.stringify(newborn));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("nurse@example.test"));
  const pregB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/pregnancy-get?orgId=org-wsq&patientId=${admit.patientId}").then(function(r){ return r.text(); });`));
  ok(pregB.ok === true && pregB.pregnancy && pregB.pregnancy.para === 3, "session B (independent target/device): sees the SAME pregnancy episode with para incremented by the delivery - real server state, not client state: " + JSON.stringify(pregB.pregnancy));
  const linksB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/family-links?orgId=org-wsq&patientId=${admit.patientId}").then(function(r){ return r.text(); });`));
  ok(linksB.ok === true && linksB.links.some((l) => l.relatedPatientId === newborn.newbornId), "session B: sees the SAME FamilyLink to the newborn session A registered: " + JSON.stringify(linksB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const pregC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/pregnancy-get?orgId=org-wsq&patientId=${admit.patientId}").then(function(r){ return r.text(); });`));
  ok(pregC.ok === true && pregC.pregnancy && pregC.pregnancy.para === 3, "AFTER A FULL SERVER RESTART: the pregnancy episode (with its post-delivery para) is still there, read back from the sqlite FILE, not memory: " + JSON.stringify(pregC.pregnancy));
  const babyC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/fhir/Patient/${newborn.newbornId}?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(babyC.resourceType === "Patient" || babyC.name, "AFTER A FULL SERVER RESTART: the newborn's own real Patient record is still there: " + JSON.stringify(babyC).slice(0, 200));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
