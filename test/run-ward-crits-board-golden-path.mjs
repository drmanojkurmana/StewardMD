/* WardSynQ TASK 3.6: ward list -> Critical results button -> the hospital-wide open loop for a
 * patient with no chart open on this screen -> Acknowledge -> the loop drops off the open list,
 * driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-crits-board-golden-path-harness.html stubs only the network and window.prompt).
 * Proves the CLIENT half of TASK 3.6's one genuine gap (a hospital-wide critical-result queue);
 * the backend's own no-patientId branch and RBAC are exercised for real elsewhere already.
 *
 *   node test/run-ward-crits-board-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9414, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-crits-board-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-crits-board-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the crits-board harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="critsboard"]');`), "the ward list carries a Critical results button");

  await click('[data-w-act="critsboard"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Open loops') >= 0;`), "the critical-results board opens");
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('opd-pat-smd-h1-other') >= 0;`), "the board names the patient the loop belongs to, with no chart for that patient ever opened on this screen");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('ESCALATE') >= 0;`), "the escalation level is shown");

  await click('[data-w-act^="ackboard:"]');
  const ackBody = await lastBody("/ward/acknowledge");
  ok(ackBody && ackBody.loopId === "loop-1" && !!ackBody.action, "acknowledging posts the real loop id and the real free-text action: " + JSON.stringify(ackBody));
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('acknowledged by') >= 0;`), "the acknowledged state is reflected after the board reloads");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
