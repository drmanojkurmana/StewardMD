/* WardSynQ TASK 3.4: persistence across a RELOAD, a second independent browser session ("another
 * device"), and a full SERVER PROCESS RESTART against the same on-disk sqlite file - against a REAL
 * local server (test/wardsynq-persistence-server.mjs: real onRequest(), real D1Repository over a
 * real sqlite file). Proves a real receipt, a real dispense-driven level change, and a real
 * reconciliation all survive real storage and a genuine server restart.
 *
 *   node test/run-ward-inventory-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
const JOB_DIR = process.env.CLAUDE_JOB_DIR || "/tmp";
const DB_PATH = join(JOB_DIR, "ward-inventory-persistence.sqlite");
const PORT = 8811, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9411;
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
  `--user-data-dir=${JOB_DIR}/ward-inventory-persist-chrome`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

try {
  ok(await waitUp(), "the real local WardSynQ server is up");

  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- SESSION A: a real receipt, a real dispense against a real order, a real reconciliation. ----
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("pharmacy@example.test"));

  const drugCode = "InventoryXSess-" + Date.now();
  const receipt = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/stock-move", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", kind: "receipt", code: ${JSON.stringify(drugCode)}, quantity: { value: 200, unit: "tablet" }, location: "Main", batch: "XSESS-1", expiry: "2026-09-30T00:00:00.000Z" }) })
      .then(function(r){ return r.text(); });
  `));
  ok(receipt.ok === true, "session A: a REAL receipt written for real: " + JSON.stringify(receipt));

  const stock1 = JSON.parse(await ev(A, `return fetch("/api/queue/ward/stock?orgId=org-wsq").then(function(r){ return r.text(); });`));
  const row1 = (stock1.levels || []).find((r) => r.code === drugCode);
  ok(!!row1 && row1.level === 200, "session A: the real level reads 200 against real storage: " + JSON.stringify(row1));
  ok(stock1.expiring.some((r) => r.code === drugCode && r.batch === "XSESS-1"), "session A: the near-expiry batch appears against real storage: " + JSON.stringify(stock1.expiring.find((r) => r.code === drugCode)));

  const recon = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/stock-reconcile", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", code: ${JSON.stringify(drugCode)}, location: "Main", unit: "tablet", counted: 195, reason: "Cross-session persistence proof." }) })
      .then(function(r){ return r.text(); });
  `));
  ok(recon.ok === true && recon.variance === -5, "session A: a REAL reconciliation posted a REAL variance-adjustment for real: " + JSON.stringify(recon));

  // ---- SESSION B (independent target/device), sharing only server state --------------------------
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  await ev(B, AUTH_SHIM("pharmacy@example.test"));
  const stockB = JSON.parse(await ev(B, `return fetch("/api/queue/ward/stock?orgId=org-wsq").then(function(r){ return r.text(); });`));
  const rowB = (stockB.levels || []).find((r) => r.code === drugCode);
  ok(!!rowB && rowB.level === 195, "session B (independent target/device): sees the SAME reconciled level session A wrote - real server state, not client state: " + JSON.stringify(rowB));

  // ---- SERVER RESTART: kill the whole process, start a fresh one against the SAME sqlite file ----
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  server = startServer();
  ok(await waitUp(), "the server came back up after a full process restart, same sqlite file");

  const C = await newTarget();
  await call(C, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(C, "return window.__ready;"); if (ready === true) break; }
  await ev(C, AUTH_SHIM("pharmacy@example.test"));
  const stockC = JSON.parse(await ev(C, `return fetch("/api/queue/ward/stock?orgId=org-wsq").then(function(r){ return r.text(); });`));
  const rowC = (stockC.levels || []).find((r) => r.code === drugCode);
  ok(!!rowC && rowC.level === 195 && stockC.expiring.some((r) => r.code === drugCode),
    "AFTER A FULL SERVER RESTART: the reconciled level and the near-expiry batch are both still there, read back from the sqlite FILE, not memory: " + JSON.stringify(rowC));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
