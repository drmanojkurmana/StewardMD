/* WardSynQ KardiQ X bridge: open a chart -> Cardiology button -> link a KardiQ X record ->
 * record an ECG reference, driven in real headless Chrome over CDP against the REAL ward.js and
 * ward.css (test/ward-cardiology-golden-path-harness.html stubs only the network). Proves the
 * CLIENT half of the KardiQ X bridge - real DOM, real ward.css, real delegated click handler - not
 * a mock render. Persistence/server-side correctness for these same contracts is proven separately,
 * for real, in test/wardsynq-cardiology.test.mjs.
 *
 *   node test/run-ward-cardiology-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9402, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-cardiology-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-cardiology-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the KardiQ X bridge harness");

  // ---- 1. Open the ward list, open the one patient's chart. ---------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="cardiologyopen"]');`), "the ordinary chart carries a Cardiology button - reachable from any patient, not a separate ward");

  // ---- 2. Open the KardiQ X bridge view. -------------------------------------------------------------
  await click('[data-w-act="cardiologyopen"]');
  ok(await waitFor(`return !!document.getElementById('wCardioRecordId');`), "the KardiQ X bridge view opens");
  ok(await ev(`return document.body.textContent.indexOf('No KardiQ X record linked') >= 0;`), "no record linked yet, stated plainly");

  // ---- 3. Link a KardiQ X record. --------------------------------------------------------------------
  await fill("wCardioRecordId", "kx-rec-999");
  await click('[data-w-act="cardiolinksave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('kx-rec-999') >= 0;`), "the linked record's id is shown");
  const linkBody = await lastBody("/ward/cardio-link");
  ok(linkBody && linkBody.link.kardioxRecordId === "kx-rec-999", "the link posts exactly what was entered: " + JSON.stringify(linkBody));

  // ---- 4. Record an ECG reference; the unvalidated status is stated, not hidden. --------------------
  await fill("wCardioVerdict", "STEMI pattern suspected"); await fill("wCardioHeart", "6"); await fill("wCardioTimi", "4");
  await click('[data-w-act="cardioecgsave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('STEMI pattern suspected') >= 0;`), "the recorded verdict is shown, never re-interpreted by this screen");
  ok(await ev(`return document.body.textContent.indexOf('unvalidated AI output') >= 0;`), "the unvalidated status is shown structurally, not buried");
  const ecgBody = await lastBody("/ward/cardio-ecg");
  ok(ecgBody && ecgBody.ecg.kardioxRecordId === "kx-rec-999" && ecgBody.ecg.heartScore === 6 && ecgBody.ecg.timiScore === 4,
    "the ECG reference posts the real verdict, HEART and TIMI scores, tied to the ALREADY-LINKED record: " + JSON.stringify(ecgBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
