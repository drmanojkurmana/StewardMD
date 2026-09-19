/* WardSynQ TASK 4.5: ward list -> Scheduling button -> book an appointment -> a clash is refused
 * -> a blackout is refused even with overbook -> cancel an appointment -> book/cancel a resource
 * -> block/unblock a period, driven in real headless Chrome over CDP against the REAL ward.js and
 * ward.css (test/ward-scheduling-golden-path-harness.html stubs only the network and
 * window.prompt). Proves the CLIENT half; the server contracts are proven for real in
 * test/wardsynq-scheduling-blackout.test.mjs.
 *
 *   node test/run-ward-scheduling-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9417, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-scheduling-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-scheduling-golden-path-harness.html");
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
const body = () => ev(`return document.body.lastElementChild.textContent;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the scheduling harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="scheduling"]');`), "the ward list carries a Scheduling button");

  await click('[data-w-act="scheduling"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Scheduling') >= 0;`), "the scheduling screen opens");

  // Book a real appointment.
  await fill("wSchedClinician", "dr-smith"); await fill("wSchedPatient", "pat-1"); await fill("wSchedStart", "2026-09-10T10:00:00.000Z"); await fill("wSchedMinutes", "15"); await fill("wSchedReason", "Review");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('dr-smith') >= 0;`), "the real appointment appears after booking");

  // A clash is refused without overbook. (Each field re-filled: the form resets on the reload
  // the successful booking above just triggered - a real desk would re-enter the next patient too.)
  await fill("wSchedClinician", "dr-smith"); await fill("wSchedPatient", "pat-2"); await fill("wSchedStart", "2026-09-10T10:00:00.000Z"); await fill("wSchedMinutes", "15");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('already has an appointment overlapping') >= 0;`), "a clash is refused, and the real server reason is shown verbatim");

  // Block the clinician, then even overbook cannot get past a blackout.
  await fill("wBoClinician", "dr-smith"); await fill("wBoFrom", "2026-09-11T00:00:00.000Z"); await fill("wBoTo", "2026-09-12T00:00:00.000Z"); await fill("wBoReason", "Annual leave");
  await click('[data-w-act="blackoutadd"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Annual leave') >= 0;`), "the real blackout appears after blocking");

  await fill("wSchedClinician", "dr-smith"); await fill("wSchedPatient", "pat-3"); await fill("wSchedStart", "2026-09-11T10:00:00.000Z"); await fill("wSchedMinutes", "15");
  await click('[data-w-act="apptoverbook"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('dr-smith is unavailable') >= 0;`), "a blackout is refused even with overbook - there is nothing to override");

  // Cancel the first appointment.
  await click('[data-w-act^="apptcancel:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Cancelled') >= 0;`), "cancelling reflects the real state, not silently removing the row");

  // Resource booking and cancellation.
  await fill("wResId", "ct-1"); await fill("wResStart", "2026-09-13T09:00:00.000Z"); await fill("wResMinutes", "30"); await fill("wResPurpose", "CT abdomen");
  await click('[data-w-act="resbook"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('CT abdomen') >= 0;`), "the real resource booking appears");

  await click('[data-w-act^="rescancel:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('CT abdomen') < 0;`), "cancelling a resource booking removes it from the live list");

  // Unblock the blackout.
  await click('[data-w-act^="blackoutcancel:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Annual leave') < 0;`), "unblocking removes the real blackout");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
