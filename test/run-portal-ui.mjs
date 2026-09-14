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
  ok: true, access: { kind: "patient", sections: ["status", "appointments", "bills", "discharge", "documents", "messages"] },
  document: { patient: { name: "Test Patient" }, appointments: [] }, bills: [], failedSections: ["discharge"], messages: [], notEmergency: "This is not a way to get urgent help.",
  documents: [{ documentId: "d1", version: 1, title: "Referral letter", docType: "referral-letter", uploadedAt: "2026-09-01T00:00:00Z" }, { documentId: "d2", version: 1, unavailable: "withdrawn" }],
};
const RECORD_FULL = {
  ok: true, access: { kind: "patient", sections: ["discharge", "discharge-full"] }, document: {}, failedSections: [],
  dischargeSummaries: [{ id: "ds", scope: "full", sections: [{ key: "admission", text: "Ward 5." },
    { key: "diagnoses", items: [{ group: "active", text: "Pneumonia [J18] - confirmed" }, { group: "active", withheld: true }, { group: "closed", text: "Asthma [J45] - confirmed" }] },
    { key: "investigations", items: [{ withheld: true }, { text: "Full blood count (completed)" }] },
    { key: "assessment", withheld: true }] }],
};
/* What the fake server answers for /api/portal/queue. */
let queueMode = "ok";

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
        else body = recordMode === "full" ? RECORD_FULL : RECORD_OK;
      }
      if (sub === "queue") {
        await sleep(600);
        if (queueMode === "fail") { status = 502; body = { ok: false, error: "queue_read_failed" }; }
        else if (queueMode === "ambiguous") body = { ok: true, available: true, ambiguous: true, tickets: [] };
        else body = { ok: true, available: true, ambiguous: false, tickets: [{ label: "Cardiology 7", state: "waiting", ahead: 3, eta: null }] };
      }
      let contentType = "application/json", raw = null;
      if (sub === "document") {
        const asked = JSON.parse(request.postData || "{}");
        if (asked.documentId === "d1") { contentType = "application/pdf"; raw = Buffer.from("%PDF-1.4 test"); }
        else { status = 410; body = { ok: false, error: "withdrawn" }; }
      }
      const b64 = (raw || Buffer.from(JSON.stringify(body))).toString("base64");
      ws.send(JSON.stringify({ id: msgId++, sessionId: m.sessionId, method: "Fetch.fulfillRequest", params: { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: contentType }, { name: "Content-Disposition", value: 'attachment; filename="referral-letter-v1"' }], body: b64 } }));
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

  /* P2 gaps: queue status loads after the record, in place, and typed text survives it. */
  queueMode = "fail";
  await ev(`document.getElementById("pMsgBody").value="half-typed"; document.querySelector('[data-act="queue"]') ? document.querySelector('[data-act="queue"]').click() : 0; return 1;`);
  ok(await waitFor(`document.querySelector('[data-section="status"] [data-state="failed"]')`, 4000), "a failed queue read says it failed");
  queueMode = "ok";
  ok(await ev(`return !!document.querySelector('[data-section="status"] [data-act="queue"]')`), "the failed queue state offers a retry");
  await ev(`document.querySelector('[data-section="status"] [data-act="queue"]').click(); return 1;`);
  ok(await waitFor(`document.querySelector('[data-section="status"] [data-state="loading"]')`, 2000), "queue status shows loading while it checks");
  ok(await waitFor(`/3 people ahead of you/.test((document.querySelector('[data-section="status"]')||{}).textContent||"")`, 4000), "own ticket: place, people ahead, and 'no estimate'");
  ok(await ev(`return /Cardiology 7/.test(document.querySelector('[data-section="status"]').textContent) && /No estimate/.test(document.querySelector('[data-section="status"]').textContent)`), "place and no-estimate text");
  ok(await ev(`return document.getElementById("pMsgBody").value==="half-typed"`), "redrawing queue status does not wipe a message being typed");
  ok(await ev(`var b=document.querySelector('[data-section="status"] [data-act="queue"]').getBoundingClientRect(); return b.height>=44`), "queue refresh button is a 44 px touch target");
  queueMode = "ambiguous";
  await ev(`document.querySelector('[data-section="status"] [data-act="queue"]').click(); return 1;`);
  ok(await waitFor(`document.querySelector('[data-section="status"] [data-state="ambiguous"]')`, 4000), "an ambiguous link shows nothing and says ask at the desk");

  /* Documents: listed, withdrawn line, download through a local object URL. */
  ok(await ev(`return !!document.querySelector('[data-act="doc"][data-id="d1"]') && !!document.querySelector('[data-doc-state="withdrawn"]')`), "released and withdrawn documents are drawn differently");
  await ev(`window.__dl=null; var orig=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ window.__dl={href:this.href, name:this.download}; }; document.querySelector('[data-act="doc"][data-id="d1"]').click(); return 1;`);
  ok(await waitFor(`window.__dl`, 4000), "download is triggered");
  ok(await ev(`return window.__dl.href.indexOf("blob:")===0 && window.__dl.name==="referral-letter-v1"`), "the file is saved from a local object URL, never a store address");

  /* A full discharge summary prints on its own. */
  recordMode = "full";
  await call("Page.reload");
  ok(await waitFor(`document.querySelector('.ds-full [data-withheld="assessment"]')`), "full summary shows a withheld section as withheld");
  ok(await ev(`var d=document.querySelector('.ds-full'); return d.querySelectorAll('[data-withheld-entry="investigations"]').length===1 && d.querySelectorAll('[data-withheld-entry="diagnoses"]').length===1 && /Full blood count/.test(d.textContent) && /Resolved or inactive/.test(d.textContent) && /Please ask your care team/.test(d.textContent)`), "D5: one withheld entry is a line in its place; the other entries still show");
  if (process.env.SHOT) { const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(s.result.data, "base64")); }
  await call("Emulation.setEmulatedMedia", { media: "print" });
  await ev(`document.body.classList.add("printing"); document.querySelector(".ds-full").classList.add("printing"); return 1;`);
  ok(await ev(`return getComputedStyle(document.querySelector('[data-act="signout"]')).visibility==="hidden" && getComputedStyle(document.querySelector('.ds-full h4')).visibility==="visible" && getComputedStyle(document.querySelector('.ds-full [data-act="print"]')).display==="none"`), "print CSS shows only the summary");
  await call("Emulation.setEmulatedMedia", { media: "" });
  recordMode = "ok";

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
