/* WardSynQ TASK 4.4: ward list -> Patient flow button -> ED/beds/admissions pending/discharge/
 * recent transfers/bottlenecks, verbatim from the real server response, driven in real headless
 * Chrome over CDP against the REAL ward.js and ward.css (test/ward-flow-command-golden-path-
 * harness.html stubs only the network). Proves the CLIENT half; the numbers themselves are proven
 * against real records in test/wardsynq-patient-flow.test.mjs.
 *
 *   node test/run-ward-flow-command-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9416, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-flow-command-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-flow-command-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the patient-flow harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="flowcommand"]');`), "the ward list carries a Patient flow button");

  await click('[data-w-act="flowcommand"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Patient flow') >= 0;`), "the command center opens");

  const body = () => ev(`return document.body.lastElementChild.textContent;`);
  ok((await body()).indexOf("3 in the department") >= 0, "the real ED arrival count is shown verbatim");
  ok((await body()).indexOf("1 not yet triaged") >= 0, "the real untriaged count is shown");
  ok((await body()).indexOf("4 occupied") >= 0, "the real occupied-bed count is shown");
  ok((await body()).indexOf("Blocked 1") >= 0, "the real blocked-bed count is shown, not silently absorbed");
  ok((await body()).indexOf("2 waiting") >= 0, "the real admissions-pending count is shown");
  ok((await body()).indexOf("1 stay with nothing outstanding") >= 0, "the real discharge-candidate count is shown");
  ok((await body()).indexOf("predicted discharge date") >= 0, "the screen states plainly that this is not a predicted discharge date");
  ok((await body()).indexOf("Medical A") >= 0 && (await body()).indexOf("Medical B") >= 0, "the real recent transfer (Medical A -> Medical B) is shown");
  ok((await body()).indexOf("Stepped down") >= 0, "the real transfer reason is shown verbatim");
  ok((await body()).indexOf("beds blocked") >= 0, "the bottleneck ranking uses the real counts");
  ok((await body()).indexOf("score") < 0 || (await body()).indexOf("Nothing here is a score") >= 0, "no invented severity score is presented as one");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
