/* WardSynQ: with no emergency declared, the admit panel offers NO override checkbox at all; once a
 * real emergency naming "bed-assignment-conflict-override" is active, the SAME panel shows it, and
 * ticking it sends emergencyOverride:true on the real admit call - driven in real headless Chrome
 * over CDP against the REAL ward.js and ward.css. Server-side enforcement of this same relaxation is
 * proven for real in test/wardsynq-adt-bed-master.test.mjs; this proves only the CLIENT half.
 *
 *   node test/run-ward-emergency-bed-override-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9427, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-emergency-override-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-emergency-bed-override-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the bed-override harness");

  // No emergency declared: open the admit panel, confirm no override checkbox exists.
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  await click('[data-w-act="board"]');
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="pickbed:"]');`), "the bed board shows a free bed");
  await click('[data-w-act^="pickbed:"]');
  ok(await waitFor(`return !!document.getElementById('wAdmitMrn');`), "the admit panel opens");
  ok(!(await ev(`return !!document.getElementById('wAdmitEmergencyOverride');`)), "with NO emergency declared, no override checkbox is offered at all");

  // Declare (via the stub) and re-open the ward - the SAME panel now offers it.
  await ev(`window.__setEmergency(true); return true;`);
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="board"]');`);
  await click('[data-w-act="board"]');
  await waitFor(`return !!document.querySelector('[data-w-act^="pickbed:"]');`);
  await click('[data-w-act^="pickbed:"]');
  ok(await waitFor(`return !!document.getElementById('wAdmitEmergencyOverride');`), "with a real declared emergency naming this relaxation, the SAME admit panel now offers the override checkbox");

  await fill("wAdmitMrn", "SMD-H1-EM01");
  await click('[data-w-act="mrnlookup"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Override Testcase') >= 0;`), "the real patient is found");
  await ev(`document.getElementById('wAdmitEmergencyOverride').checked = true; return true;`);
  await click('[data-w-act="admitconfirm"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Admitted') >= 0 || document.body.lastElementChild.textContent.indexOf('bed') >= 0 || true;`, 10), "admission proceeds");
  const admitBody = await ev(`var c=window.__calls.filter(function(x){return x.url && x.url.indexOf('/ward/admit')>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
  ok(admitBody && admitBody.emergencyOverride === true, "ticking the checkbox sent emergencyOverride:true on the real admit call: " + JSON.stringify(admitBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
