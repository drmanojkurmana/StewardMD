/* WardSynQ TASK 3.3: open a chart -> Pharmacy button -> pick an order -> see its safety verdict
 * (including a NOT_CHECKED honesty warning) -> verify -> dispense, driven in real headless Chrome
 * over CDP against the REAL ward.js and ward.css (test/ward-pharmacy-golden-path-harness.html stubs
 * only the network). Proves the CLIENT half of the pharmacy workstation. Server-side correctness is
 * proven separately, for real, in test/wardsynq-inpatient-emar.test.mjs's pharmacy tests.
 *
 *   node test/run-ward-pharmacy-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9408, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-pharmacy-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-pharmacy-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
const fill = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the pharmacy harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="pharmacyopen"]');`), "the ordinary chart carries a Pharmacy button - reachable from any patient, not a doctor-only screen");

  await click('[data-w-act="pharmacyopen"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Verification queue') >= 0;`), "the pharmacy verification queue opens");
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="phpick:"]');`), "the unverified Warfarin order appears in the queue");

  await click('[data-w-act^="phpick:"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Safety verdict') >= 0;`), "picking an order opens its safety verdict");
  ok(await ev(`return document.body.textContent.indexOf('NOT_CHECKED_ACTIVE_MED') >= 0;`), "a NOT_CHECKED finding is shown as a real warning, never silently as clear");

  await click('[data-w-act="phverify"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Verified.') >= 0;`), "verifying records the outcome and shows it");
  const verifyBody = await lastBody("/ward/verify-order");
  ok(verifyBody && verifyBody.orderId && verifyBody.outcome === "verified", "the verify call posts the real order id and outcome: " + JSON.stringify(verifyBody));

  await fill("wPhQty", "28"); await fill("wPhUnit", "tablet"); await fill("wPhBatch", "B4471"); await fill("wPhExpiry", "2027-06-30");
  await click('[data-w-act="phdispense"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Issued to the ward') >= 0;`), "dispensing shows the server's own note verbatim - never a bare 'done'");
  const dispenseBody = await lastBody("/ward/dispense");
  ok(dispenseBody && dispenseBody.quantity.value === 28 && dispenseBody.quantity.unit === "tablet" && dispenseBody.batch === "B4471",
    "the dispense posts the real quantity, unit and batch: " + JSON.stringify(dispenseBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
