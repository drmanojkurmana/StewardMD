#!/usr/bin/env node
/* test/run-portal-ui.mjs - P2.9 patient portal in a real headless Chrome.
 *
 *   node test/run-portal-ui.mjs
 *
 * Serves the repo, loads wardsynq/site/portal.html, and answers /api/portal/* through CDP Fetch so each
 * server state can be forced: sign-in, loading, a failed section, a failed record, an ended session.
 * Asserts the screens are distinct, and that the session never appears in the address.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = 8997, CDP = 9397;
const BASE = `http://localhost:${WEB}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(WEB)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/portal-ui-chrome-${process.pid}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });

let msgId = 1, ws, sessionId;
const pending = new Map();
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){${e}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function waitFor(expr, ms) { for (let i = 0; i < (ms || 5000) / 100; i++) { if (await ev(`return !!(${expr})`) === true) return true; await sleep(100); } return false; }

/* What the fake server answers for /api/portal/record. */
let recordMode = "ok";
const RECORD_OK = {
  ok: true, access: { kind: "patient", sections: ["appointments", "bills", "discharge", "messages"] },
  document: { patient: { name: "Test Patient" }, appointments: [] }, bills: [], failedSections: ["discharge"], messages: [], notEmergency: "This is not a way to get urgent help.",
};

try {
  let ver;
  for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      const sub = request.url.split("/api/portal/")[1] || "";
      let status = 200, body = { ok: false };
      if (sub === "redeem") body = { ok: true, token: "t0k3n" };
      if (sub === "record") {
        if (recordMode === "slow") await sleep(1500);
        if (recordMode === "fail") { status = 502; body = { ok: false, error: "record_read_failed" }; }
        else if (recordMode === "ended") { status = 401; body = { ok: false, error: "revoked", detail: "This session has ended. Ask your care team for a new code." }; }
        else body = RECORD_OK;
      }
      const b64 = Buffer.from(JSON.stringify(body)).toString("base64");
      ws.send(JSON.stringify({ id: msgId++, sessionId: m.sessionId, method: "Fetch.fulfillRequest", params: { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: b64 } }));
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Runtime.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/portal/*" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await call("Page.navigate", { url: BASE + "wardsynq/site/portal.html#org=org-demo" });
  ok(await waitFor(`document.querySelector('[data-phase="signin"]')`), "sign-in screen first");
  ok(await ev(`return document.getElementById("pOrg").value`) === "org-demo", "hospital id prefilled from #org");

  recordMode = "slow";
  await ev(`document.getElementById("pGrant").value="wsq-pacc-x"; document.getElementById("pCode").value="12345678"; document.getElementById("pSignin").requestSubmit(); return 1;`);
  ok(await waitFor(`document.querySelector('[data-phase="loading"]')`), "loading screen while the record loads");
  ok(await waitFor(`document.querySelector('[data-phase="ready"]')`, 6000), "record screen after sign-in");
  ok(await ev(`return !!document.querySelector('[data-empty="appointments"]') && !!document.querySelector('[data-empty="bills"]')`), "empty sections say they are empty");
  ok(await ev(`var s=document.querySelector('[data-section="discharge"]'); return !!s && /could not load/.test(s.textContent) && !s.querySelector('[data-empty]')`), "a failed section says it failed, not empty");
  ok(await ev(`return !document.querySelector('[data-section="results"]')`), "ungranted sections are not drawn");
  ok(await ev(`return location.href.indexOf("t0k3n")<0 && location.href.indexOf("wsq-pacc")<0 && sessionStorage.getItem("wsqPortalSession").indexOf("t0k3n")>0`), "session in sessionStorage, never in the address");
  ok(await ev(`var w=document.querySelector('[data-section="messages"] .msg.err'), t=document.getElementById("pMsgBody"); return !!w && !!t && (w.compareDocumentPosition(t) & 4) > 0`), "emergency warning sits above the message box");

  recordMode = "fail";
  await call("Page.reload");
  ok(await waitFor(`document.querySelector('[data-phase="failed"]')`), "a failed record read shows the failed screen");
  recordMode = "ended";
  await ev(`document.querySelector('[data-act="retry"]').click(); return 1;`);
  ok(await waitFor(`document.querySelector('[data-phase="ended"]')`), "a revoked or expired session shows the ended screen");
  ok(await ev(`return sessionStorage.getItem("wsqPortalSession")===null`), "an ended session is forgotten on the device");
} catch (e) {
  console.log("FAIL harness: " + (e && e.message));
  fails++;
} finally {
  try { chrome.kill(); } catch {}
  try { serveProc.kill(); } catch {}
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
