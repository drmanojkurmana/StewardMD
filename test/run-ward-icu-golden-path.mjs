/* WardSynQ ICU: bed board -> admit with the explicit ICU checkbox -> chart -> device association ->
 * device removal, driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-icu-golden-path-harness.html stubs only the network). Proves the CLIENT half of the
 * ICU vertical - real DOM, real ward.css, real delegated click handler - not a mock render.
 * Persistence/server-side correctness for these same contracts is proven separately, for real, in
 * test/wardsynq-icu.test.mjs.
 *
 *   node test/run-ward-icu-golden-path.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9392, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-icu-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-icu-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the ICU harness (${ready})`);

  // ---- 1. Bed board, pick a free bed. ------------------------------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="board"]');`)) break; }
  await ev(`document.querySelector('[data-w-act="board"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bedcell.free');`)) break; }
  await ev(`document.querySelector('.w-bedcell.free').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.getElementById('wAdmitIcu');`)) break; }
  ok(await ev(`return !!document.getElementById('wAdmitIcu');`), "the admit panel carries the explicit ICU checkbox - never inferred from the ward's name");

  // ---- 2. Check ICU, look up the (registered) patient, confirm the admit. -----------------------
  await ev(`document.getElementById('wAdmitIcu').checked = true; document.getElementById('wAdmitMrn').value = 'SMD-H1-ICU01'; document.querySelector('[data-w-act="mrnlookup"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="admitconfirm"]');`)) break; }
  await ev(`document.querySelector('[data-w-act="admitconfirm"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('.w-bed');`)) break; }
  const admitBody = await lastBody("/ward/admit");
  ok(admitBody && admitBody.class === "ICU", "checking the box posts class:\"ICU\" - explicit on the wire, not guessed: " + JSON.stringify(admitBody));

  // ---- 3. Open the chart: the ICU-class encounter shows the device card. -------------------------
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="deviceassociate"]');`)) break; }
  ok(await ev(`return document.body.textContent.indexOf('Devices') >= 0;`), "an ICU-class encounter's chart shows the device-association card");
  ok(await ev(`return document.body.textContent.indexOf('No monitor currently associated') >= 0;`), "no device associated yet, stated plainly rather than left blank");

  // ---- 4. Associate a monitor: device ID, asset tag, and the patient's own wristband. ------------
  await ev(`document.getElementById('wDevId').value = 'mon-h1'; document.getElementById('wDevTag').value = 'AT-9001'; document.getElementById('wDevWrist').value = 'SMD-H1-ICU01'; document.querySelector('[data-w-act="deviceassociate"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('mon-h1') >= 0;`)) break; }
  const assocBody = await lastBody("/ward/device-associate");
  ok(assocBody && assocBody.association.device.deviceId === "mon-h1" && assocBody.association.scannedAssetTag === "AT-9001" && assocBody.association.scannedWristband === "SMD-H1-ICU01", "association posts the real device ID, the real scanned asset tag, and the real scanned wristband: " + JSON.stringify(assocBody));
  ok(await ev(`return document.body.textContent.indexOf('mon-h1') >= 0 && document.body.textContent.indexOf('AT-9001') >= 0;`), "the associated device is shown on the chart, by its real ID and tag");

  // ---- 5. Remove the device. ----------------------------------------------------------------------
  await ev(`document.querySelector('[data-w-act^="devicedissociate:"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return document.body.textContent.indexOf('No monitor currently associated') >= 0;`)) break; }
  const dissocBody = await lastBody("/ward/device-dissociate");
  ok(dissocBody && dissocBody.deviceId === "mon-h1", "removing the device posts the real device ID: " + JSON.stringify(dissocBody));
  ok(await ev(`return document.body.textContent.indexOf('No monitor currently associated') >= 0;`), "the chart reflects the device is gone, not just the button click");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
