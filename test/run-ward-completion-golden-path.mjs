/* WardSynQ TASK 4.11: open a chart -> Chart check button -> a real, server-computed deficiency list
 * appears, sorted escalate-first, with the responsible role and elapsed time shown -> refresh,
 * driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-completion-golden-path-harness.html stubs only the network). The aggregation itself is
 * proven for real in test/wardsynq-chart-completion-bridge.test.mjs; this proves only the CLIENT half.
 *
 *   node test/run-ward-completion-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9420, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-completion-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-completion-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the chart-completion harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="completionopen"]');`), "the ordinary chart carries a Chart check button");

  await click('[data-w-act="completionopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Unsigned note') >= 0;`), "the real deficiency list appears");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Progress note awaiting signature') >= 0;`), "the server's own detail text is shown verbatim");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('author') >= 0;`), "the responsible role is shown");

  // Escalated sorts first: the escalate-level item's row comes before the due-level consent row.
  const order = await ev(`var t=document.querySelector('.w-mini').textContent; return t.indexOf('Unsigned note') < t.indexOf('Consent');`);
  ok(order, "the escalated item is listed ahead of the merely-due one, matching the server's own sort");

  await click('[data-w-act="completionopen"]');
  const calls = await ev(`return window.__calls.filter(function(c){return c.url.indexOf('/ward/completion-queue')>=0}).length;`);
  ok(calls === 2, "refresh re-fetches the real queue rather than reusing a stale one: " + calls);

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
