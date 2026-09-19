/* WardSynQ TASK 4.17: open a chart -> Billing button -> a real invoice and a real claim appear ->
 * the screen carries no collection button anywhere, unlike Cashier - the exact distinction TASK
 * 4.13's `billing` role (BILLING_VIEW, never BILLING_CHARGE) exists to enforce, driven in real
 * headless Chrome over CDP against the REAL ward.js and ward.css. Proves the CLIENT half only.
 *
 *   node test/run-ward-billing-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9424, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-billing-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-billing-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the billing harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="billingopen"]');`), "the ordinary chart carries a Billing button");

  await click('[data-w-act="billingopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('wsq-invoice-bill01-1') >= 0;`), "the real invoice appears");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('J18.9') >= 0;`), "the real claim appears alongside it");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('500') >= 0;`), "the real balance is shown");

  const buttonList = await ev(`return Array.from(document.body.lastElementChild.querySelectorAll('button')).map(function(b){return b.getAttribute('data-w-act');});`);
  ok(!buttonList.some((a) => a && /pay|refund|discount|deposit|writeoff|raise/i.test(a)), "no collection/write button of any kind exists on this screen: " + JSON.stringify(buttonList));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
