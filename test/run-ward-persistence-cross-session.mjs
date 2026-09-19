/* WardSynQ: persistence across reload and a second browser session, against a REAL local server
 * (test/wardsynq-persistence-server.mjs — real onRequest(), real D1Repository over a real on-disk
 * sqlite file). Two independent headless-Chrome CDP targets act as two independent client
 * sessions ("two devices") sharing one server. Real fetch, real ward.js, real network calls -
 * nothing stubbed except the ONE auth header a reverse proxy (Cloudflare Access) would normally
 * add in production (Cf-Access-Authenticated-User-Email; identify() in functions/_usage.js reads
 * it directly - see that file for how a real deployment sets it).
 *
 * Requires test/wardsynq-persistence-server.mjs already running on PORT (spawns and manages it
 * itself if not told otherwise via SERVER_ALREADY_RUNNING=1).
 *
 *   node --experimental-test-module-mocks --experimental-sqlite test/wardsynq-persistence-server.mjs 8799 /tmp/x.sqlite &
 *   node test/run-ward-persistence-cross-session.mjs
 */
import { spawn } from "node:child_process";
const PORT = 8799, BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9390;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-persist-chrome"}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

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
// Injects only the one header a real deployment's reverse proxy (Cloudflare Access) would add;
// every request still goes out for real, over real HTTP, to the real local server.
const AUTH_SHIM = (email) => `
  var __realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var h = new Headers(opts.headers || {});
    h.set("Cf-Access-Authenticated-User-Email", ${JSON.stringify(email)});
    return __realFetch(url, Object.assign({}, opts, { headers: h }));
  };
`;

try {
  let vjson, t = 0; while (t++ < 60) { try { vjson = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(vjson.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // Confirm the real server is actually up before spending a browser on it.
  let serverUp = false; for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + "/"); if (r.ok) { serverUp = true; break; } } catch {} await sleep(200); }
  ok(serverUp, "the real local WardSynQ server (test/wardsynq-persistence-server.mjs) is up");
  if (!serverUp) throw new Error("server not reachable; run it first (see file header)");

  // ---- SESSION A (the admitting doctor) ------------------------------------------------------
  const A = await newTarget();
  await call(A, "Page.navigate", { url: BASE + "/" });
  let ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session A: real ward.js loaded from the real server (" + ready + ")");
  await ev(A, AUTH_SHIM("doctor@example.test"));

  const mrn = "SMD-WARD01-XSESS-" + Date.now().toString(36);
  await ev(A, `window.WARD.open({ orgId: "org-wsq" }); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(150); if (await ev(A, `return !!document.querySelector('.w-card');`)) break; }
  const admitResp = JSON.parse(await ev(A, `
    return fetch("/api/queue/ward/admit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org-wsq", mrn: ${JSON.stringify(mrn)}, ward: "Medical A", bed: "22", admittedAt: new Date().toISOString() }) })
      .then(function(r){ return r.text(); });
  `));
  ok(admitResp.ok === true && admitResp.written === 1, "session A: a REAL POST /ward/admit wrote a REAL Encounter: " + JSON.stringify(admitResp));

  await ev(A, `document.querySelector('[data-w-act="reload"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(150); if (await ev(A, `return document.body.textContent.indexOf(${JSON.stringify(mrn.toLowerCase().replace(/[^a-z0-9]+/gi, "-"))}) >= 0 || !!document.querySelector('.w-bed');`)) break; }
  ok(await ev(A, `return !!document.querySelector('.w-bed');`), "session A: the admitted patient appears on the ward list after a reload of the SAME session");

  // ---- SESSION B (a second, independent browser target - the nurse, on "another device") -----
  const B = await newTarget();
  await call(B, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(B, "return window.__ready;"); if (ready === true) break; }
  ok(ready === true, "session B (independent target): real ward.js loaded fresh, no shared browser state with session A");
  await ev(B, AUTH_SHIM("nurse@example.test"));
  await ev(B, `window.WARD.open({ orgId: "org-wsq" }); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(150); if (await ev(B, `return !!document.querySelector('.w-bed');`)) break; }
  ok(await ev(B, `return !!document.querySelector('.w-bed');`), "session B: the SAME patient session A admitted is visible - the two sessions share real server state, not client state");

  // ---- Persistence across a RELOAD of session A (full page navigation, not just a re-render) --
  await call(A, "Page.navigate", { url: BASE + "/" });
  ready = null; for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(A, "return window.__ready;"); if (ready === true) break; }
  await ev(A, AUTH_SHIM("doctor@example.test"));
  await ev(A, `window.WARD.open({ orgId: "org-wsq" }); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(150); if (await ev(A, `return !!document.querySelector('.w-bed');`)) break; }
  ok(await ev(A, `return !!document.querySelector('.w-bed');`), "session A: the patient survives a full page RELOAD (a fresh WARD.open, no in-memory client state carried over)");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
