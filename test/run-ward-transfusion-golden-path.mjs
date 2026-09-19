/* WardSynQ TASK 3.5: open a chart -> Blood bank button -> request -> crossmatch -> issue -> a
 * WRONG-UNIT bedside check refused -> the correct scan passes -> start -> observe -> complete,
 * driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-transfusion-golden-path-harness.html stubs only the network and window.prompt).
 * Proves the CLIENT half of the blood-bank workstation - specifically that NO ONE-CLICK TRANSFUSE
 * holds client-side too (both scans and both checkers required before the button even calls the
 * server). Server-side correctness is proven separately, for real, in
 * test/wardsynq-transfusion-bridge.test.mjs and the underlying engine's own 22 tests in
 * test/wardsynq-transfusion.test.mjs.
 *
 *   node test/run-ward-transfusion-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9412, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-transfusion-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-transfusion-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the blood bank harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="txopen"]');`), "the ordinary chart carries a Blood bank button");

  await click('[data-w-act="txopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Requests') >= 0;`), "the blood bank view opens");
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="txpick:"]');`), "the requested episode appears in the queue");

  await click('[data-w-act^="txpick:"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Crossmatch') >= 0;`), "picking the episode opens the crossmatch panel");

  await fill("wTxUnitId", "UNIT-777");
  await click('[data-w-act="txcrossmatch"]');
  const xmBody = await lastBody("/ward/transfusion-crossmatch");
  ok(xmBody && xmBody.unitId === "UNIT-777", "the crossmatch posts the real unit id: " + JSON.stringify(xmBody));
  ok(await waitFor(`return !!document.querySelector('[data-w-act="txissue"]');`), "a crossmatched episode offers Issue");

  await click('[data-w-act="txissue"]');
  ok(await waitFor(`return document.body.textContent.indexOf('two people, two scans') >= 0;`), "an issued unit opens the two-person bedside verification screen");
  ok(await ev(`return document.body.textContent.indexOf('NO ONE-CLICK TRANSFUSE') >= 0;`), "the no-one-click-transfuse warning is stated plainly");

  // Missing fields: the client refuses to even call the server.
  await click('[data-w-act="txbedside"]');
  ok(await waitFor(`return document.body.textContent.indexOf('both checkers and both scans') >= 0;`), "an incomplete bedside form is refused CLIENT-SIDE - no request is even sent");
  const callsBeforeWrongUnit = await ev(`return window.__calls.filter(function(c){return c.url.indexOf('/ward/transfusion-bedside-check')>=0}).length;`);
  ok(callsBeforeWrongUnit === 0, "confirmed: zero bedside-check requests were sent for the incomplete attempt");

  // The wrong unit scanned: server refuses, shown verbatim.
  await fill("wTxChecker1", "nurse-a"); await fill("wTxChecker2", "nurse-b"); await fill("wTxScanPatient", "MRN-X"); await fill("wTxScanUnit", "UNIT-WRONG");
  await click('[data-w-act="txbedside"]');
  ok(await waitFor(`return document.body.textContent.indexOf('is not the unit crossmatched') >= 0;`), "a wrong-unit scan is refused, and the real server reason is shown verbatim, not a generic error");

  // The correct scan passes.
  await fill("wTxChecker1", "nurse-a"); await fill("wTxChecker2", "nurse-b"); await fill("wTxScanPatient", "MRN-X"); await fill("wTxScanUnit", "UNIT-777");
  await click('[data-w-act="txbedside"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Start transfusion') >= 0;`), "the correct scan passes and offers Start");

  await click('[data-w-act="txstart"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Running - observations') >= 0;`), "starting opens the running/observation panel");

  await fill("wTxPulse", "88"); await fill("wTxTemp", "37.2");
  await click('[data-w-act="txobserve"]');
  const obsBody = await lastBody("/ward/transfusion-observe");
  ok(obsBody && obsBody.vitals.pulse === 88, "the observation posts the real vitals: " + JSON.stringify(obsBody));

  await click('[data-w-act="txcomplete"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Completed.') >= 0;`), "completing the transfusion is confirmed on screen");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
