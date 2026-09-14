/* G2 in real headless Chrome: a bedside write made with no connection is kept in the device's real
 * IndexedDB (and survives a reload), is shown as saved on this device and not in the record, is sent on
 * reconnect with the request key it was made with, and a dose whose order changed comes back to the
 * conflict review screen, where a resend with a reason is recorded on the server before it is sent again.
 *
 * Reuses test/ward-golden-path-harness.html (the REAL ward.js and ward.css, network stubbed) and adds the
 * REAL ward-offline.js. Offline is Chrome's own network emulation, so navigator.onLine and the online and
 * offline events are the browser's. Screenshots: $CLAUDE_JOB_DIR (or /tmp)/ward-offline-*.png.
 *
 *   node test/run-ward-offline-conflict.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CLAUDE_JOB_DIR || "/tmp";
const PORT = 9391, userDir = OUT + "/ward-offline-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const until = async (e, n) => { for (let i = 0; i < (n || 40); i++) { if (await ev(e)) return true; await sleep(100); } return false; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); const p = join(OUT, `ward-offline-${name}.png`); writeFileSync(p, Buffer.from(r.result.data, "base64")); console.log("  screenshot " + p); };
const offline = (on) => call("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

/* The page's own set-up after every load: a staff token that names a person, the real ward-offline.js,
 * and a server that says the dose's order changed until the resend names the new version. */
const SETUP = `
  localStorage.setItem("smd_opd_staff_tok", btoa("org-harness~cfa:nurse-one.9999999999999").replace(/=+$/, "") + ".sig");
  PATIENT_ID = "wsq-pat-smd-h1-00099"; ENC_ID = "wsq-enc-smd-h1-00099";
  var base = window.fetch;
  window.fetch = function (url, opts) {
    var u = String(url), body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    var reply = function (status, obj) { window.__calls.push({ url: u, method: (opts && opts.method) || "GET", body: body, headers: opts && opts.headers }); return Promise.resolve({ ok: status < 400, status: status, json: function () { return Promise.resolve(obj); } }); };
    if (u.indexOf("/ward/mar") >= 0 && body && body.orderId === "ord-offline") {
      return body.expectedOrderVersion === 2 ? reply(200, { ok: true, written: 1, from: "verified", to: "dispensed", version: 2 })
        : reply(409, { ok: false, error: "order_changed", currentVersion: 2, current: { drug: "Ondansetron", dose: { value: 8, unit: "mg" }, route: "iv", status: "active", version: 2 } });
    }
    if (u.indexOf("/ward/offline-resolve") >= 0) return reply(200, { ok: true, recorded: true, choice: body.choice });
    (window.__hdr = window.__hdr || []).push({ url: u, headers: opts && opts.headers });
    return base(url, opts);
  };
  await new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "../ward-offline.js"; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
  return !!window.WARD_OFFLINE;`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Page.navigate", { url: URL });
  ok(await until(`return window.__ready === true;`), "real ward.js loaded");
  ok(await ev(SETUP) === true, "real ward-offline.js loaded beside it");
  await ev(`await WARD_OFFLINE.idbStore(indexedDB).clear(); return true;`);

  // ---- 1. Open the chart, lose the connection, chart vitals. ------------------------------------------
  await ev(`WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await until(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  ok(await until(`return !!document.querySelector('[data-w-act="vitals"]');`), "the chart opened");
  await offline(true);
  ok(await until(`return navigator.onLine === false;`), "the browser itself reports no connection");
  const before = await ev(`return window.__calls.filter(function(c){return c.url.indexOf("/ward/vitals")>=0}).length;`);
  await ev(`document.getElementById('wv_pulse').value = '124'; document.getElementById('wv_rr').value = '26'; document.querySelector('[data-w-act="vitals"]').click(); return true;`);
  ok(await until(`return document.body.textContent.indexOf("saved on this device, not yet sent") >= 0;`), "the nurse is told the vitals are saved on this device, not yet sent");
  ok(await ev(`return document.body.textContent.indexOf("NOT in the record until it is sent") >= 0 && document.body.textContent.indexOf("Recorded 2 observation") < 0;`), "and that they are not in the record; no success message");
  ok(await ev(`return window.__calls.filter(function(c){return c.url.indexOf("/ward/vitals")>=0}).length;`) === before, "nothing was sent");
  ok(await ev(`return (document.getElementById('wOffBar')||{}).textContent.indexOf("Offline (1 waiting)") >= 0;`), "the bar says Offline (1 waiting)");
  ok(await ev(`return document.getElementById('wv_pulse').value === '';`), "the boxes are cleared so the same set is not charted twice");
  // A dose step made offline on this device, straight into the same outbox.
  await ev(`await WARD_OFFLINE.device().enqueue("mar", { orgId: "org-harness", action: "dispense", orderId: "ord-offline", dueAt: "2026-09-14T09:00:00.000Z", patient: { id: PATIENT_ID } }, { label: "Ondansetron dispense", patientId: PATIENT_ID, expectedVersion: 1 }); return true;`);
  await shot("1-offline-kept");

  // ---- 2. Reload: the entries are in IndexedDB, not in memory. ---------------------------------------
  const keyBefore = await ev(`var l = await WARD_OFFLINE.device().list(); return l[0] && l[0].idempotencyKey;`);
  await call("Page.reload", {});
  ok(await until(`return window.__ready === true;`), "reloaded");
  ok(await ev(SETUP) === true, "set up again after the reload");
  await ev(`WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await until(`return !!WARD_OFFLINE.device() && WARD_OFFLINE.device().state().waiting === 2;`), "both entries survived the reload in the device's IndexedDB");

  // ---- 3. Reconnect: the vitals go with their own key; the dose comes back as a conflict. ------------
  await offline(false);
  ok(await until(`return WARD_OFFLINE.device().state().conflicts === 1;`, 60), "on reconnect the queue sends, and the dose whose order changed is a conflict");
  const sent = await ev(`var c = window.__calls.filter(function(c){return c.url.indexOf("/ward/vitals")>=0}); return JSON.stringify(c[c.length-1]);`).then((s) => JSON.parse(s || "null"));
  ok(sent && sent.body.vitals.pulse === "124" && sent.body.idempotencyKey === keyBefore, "the vitals were sent as charted, with the request key they were made with");
  ok(await ev(`return window.__hdr.filter(function(c){return c.url.indexOf("/ward/vitals")>=0}).some(function(c){return !!(c.headers && c.headers["X-Offline-Created-At"]);});`), "carrying the bedside time for the audit");
  ok(await until(`return (document.getElementById('wOffBar')||{}).textContent.indexOf("Conflicts (1)") >= 0;`), "the bar says Conflicts (1)");
  await ev(`document.querySelector('[data-w-act="offlinereview"]').click(); return true;`);
  ok(await until(`return document.body.textContent.indexOf("The record now") >= 0;`), "Review opens the conflict screen");
  ok(await ev(`var t = document.body.textContent; return t.indexOf("Your entry") >= 0 && t.indexOf("order version now 2, you saw version 1") >= 0 && t.indexOf("the order changed after this dose was charted") >= 0;`), "the entry beside the order as it is now, with both versions");
  ok(await ev(`return !document.querySelector('[data-w-act^="offlineedit:"]') && !!document.querySelector('[data-w-act^="offlineresend:"]') && !!document.querySelector('[data-w-act^="offlinediscard:"]');`), "resend or discard; a dose is not edited");
  await shot("2-conflict-review");

  // ---- 4. Resend with a reason: recorded, then sent against the order now. ---------------------------
  await ev(`document.querySelector('[data-w-act^="offlineresend:"]').click(); return true;`);
  ok(await until(`return document.body.textContent.indexOf("Say why your entry should stand") >= 0;`), "no reason, no resend");
  await ev(`document.querySelector('[id^="wOffWhy_"]').value = "Checked the new dose with the prescriber"; document.querySelector('[data-w-act^="offlineresend:"]').click(); return true;`);
  ok(await until(`return WARD_OFFLINE.device().state().conflicts === 0 && WARD_OFFLINE.device().state().waiting === 0;`, 60), "the conflict is resolved and nothing is left on the device");
  const order = await ev(`var c = window.__calls; var r = -1, m = -1; c.forEach(function (x, i) { if (x.url.indexOf("/ward/offline-resolve") >= 0) r = i; if (x.url.indexOf("/ward/mar") >= 0 && x.body && x.body.expectedOrderVersion === 2) m = i; }); return JSON.stringify({ r: r, m: m, reason: r >= 0 ? c[r].body.reason : null, header: m >= 0 ? decodeURIComponent(c[m].headers["X-Offline-Conflict-Reason"] || "") : null });`).then((s) => JSON.parse(s));
  ok(order.r >= 0 && order.m > order.r, "the decision was recorded on the server before the dose was sent again");
  ok(order.reason === "Checked the new dose with the prescriber" && order.header === "Checked the new dose with the prescriber", "with the reason, on the decision and on the resend");
  await shot("3-resolved");
} catch (e) {
  console.error(e); fails++;
} finally {
  try { chrome.kill(); } catch {}
}
console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
