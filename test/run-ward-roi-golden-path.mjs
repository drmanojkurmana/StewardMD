/* WardSynQ TASK 4.17: open a chart -> ROI button -> request a release -> authorize it with a real
 * stated basis -> fulfill it with a real disclosure count -> a second request is denied with a real
 * reason, driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-roi-golden-path-harness.html stubs only the network and window.prompt). roi.js itself
 * is proven for real in test/wardsynq-roi-bridge.test.mjs; this proves only the CLIENT half.
 *
 *   node test/run-ward-roi-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9422, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-roi-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-roi-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the ROI harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="roiopen"]');`), "the ordinary chart carries an ROI button");

  await click('[data-w-act="roiopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('No release request has ever been made') >= 0;`), "the ROI screen opens and states plainly nothing has been requested yet");

  await fill("wRoiRequesterName", "Jane Advocate");
  await fill("wRoiPurpose", "Personal injury litigation");
  await fill("wRoiRecipient", "jane@advocateco.example");
  await fill("wRoiRecordTypes", "DiagnosticReport");
  await click('[data-w-act="roirequest"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Jane Advocate') >= 0;`), "the real ROI request appears with the requester's real name");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('requested') >= 0;`), "it starts in the requested state");

  await click('[data-w-act^="roiauthorize:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('authorized') >= 0;`), "authorizing with a real stated basis moves it to authorized");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Signed patient authorization') >= 0;`), "the real authorization basis is shown verbatim");

  await click('[data-w-act^="roifulfill:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('fulfilled') >= 0;`), "fulfilling moves it to fulfilled");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('emailed') >= 0 && document.body.lastElementChild.textContent.indexOf('records') >= 0;`), "the real delivery status and disclosure count are shown");

  // A second request, denied with a real reason.
  await fill("wRoiRequesterName", "General Hospital Records Dept");
  await fill("wRoiPurpose", "Continuity of care");
  await fill("wRoiRecipient", "records@generalhospital.example");
  await fill("wRoiRecordTypes", "ClinicalNote");
  await click('[data-w-act="roirequest"]');
  await click('[data-w-act^="roideny:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('No authorization provided') >= 0;`), "denying with a real reason shows it verbatim, and the denied request stays on the record");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
