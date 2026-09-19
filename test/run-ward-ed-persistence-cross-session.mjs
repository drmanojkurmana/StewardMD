/* WardSynQ ED: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a
 * REAL local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository
 * over a real sqlite file). Extends test/run-ward-persistence-cross-session.mjs (which proves this
 * for IPD admission) to the ED arrival/triage/board routes, which that script never touches.
 *
 *   node test/run-ward-ed-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-ed-persistence.sqlite");
const PORT = 8801, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9391;
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
  `--user-data-dir=${JOB_DIR}/ward-ed-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A (the triage nurse): a REAL unidentified ED arrival + triage over REAL HTTP ----
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("nurse@example.test"));

  const arrivedAt = new Date().toISOString();
  const arr = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/ed-arrival", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", arrival: { unknown: { sex: "female" }, chiefComplaint: "Chest pain", arrivedAt: ${JSON.stringify(arrivedAt)} } }) })
      .then(function(r){ return r.text(); });
  `));
  ok(arr.ok === true && arr.provisional === true && /^TRAUMA-UNKNOWN-FEMALE-/.test(arr.mrn), "session A: a REAL POST /ward/ed-arrival wrote a REAL provisional-identity Encounter: " + JSON.stringify(arr));

  const triage = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/ed-triage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", encounterId: ${JSON.stringify(arr.encounterId)}, acuity: 1 }) })
      .then(function(r){ return r.text(); });
  `));
  ok(triage.ok === true && triage.acuity === 1, "session A: a REAL POST /ward/ed-triage recorded acuity 1: " + JSON.stringify(triage));

  // ---- SESSION B (independent browser target - "another device"), sharing only server state ----
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("doctor@example.test"));
  const boardB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/ed-list?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(boardB.ok === true && boardB.patients.some((p) => p.encounterId === arr.encounterId && p.acuity === 1), "session B (independent target/device): sees the SAME ED patient with the SAME acuity session A recorded - real server state, not client state: " + JSON.stringify(boardB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file --
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("doctor@example.test"));
  const boardC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/ed-list?orgId=org-wsq").then(function(r){ return r.text(); });`));
  ok(boardC.ok === true && boardC.patients.some((p) => p.encounterId === arr.encounterId && p.acuity === 1), "AFTER A FULL SERVER RESTART: the ED arrival and triage are still there, read back from the sqlite FILE, not memory: " + JSON.stringify(boardC));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
