/* WardSynQ TASK 4.7: ward list -> Cashier button -> look up a patient by MRN -> raise an invoice
 * from today's charges -> collect a payment -> a real receipt appears -> an over-refund is refused
 * verbatim -> a discount with no reason is refused verbatim, driven in real headless Chrome over
 * CDP against the REAL ward.js and ward.css (test/ward-cashier-golden-path-harness.html stubs only
 * the network). Proves the CLIENT half; the ledger itself is proven for real in
 * test/wardsynq-invoice-bridge.test.mjs and test/wardsynq-invoice.test.mjs.
 *
 *   node test/run-ward-cashier-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9418, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-cashier-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-cashier-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the cashier harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="cashier"]');`), "the ward list carries a Cashier button");

  await click('[data-w-act="cashier"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Cashier') >= 0;`), "the cashier screen opens");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('no clinical detail') >= 0;`), "the screen states plainly it carries no clinical detail");

  await fill("wCashMrn", "SMD-H1-CASH01");
  await click('[data-w-act="cashlookup"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Cashier Testcase') >= 0;`), "the real patient name is shown after lookup");

  await click('[data-w-act="cashraise"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('wsq-invoice-') >= 0;`), "the real raised invoice appears");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Charged 500') >= 0;`), "the real charged amount is shown, priced by the server, not guessed");

  // Collect a payment - a real receipt appears.
  await fill("wCashAmount", "500");
  await click('[data-w-act^="invpay:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Receipts') >= 0;`), "a real receipt appears after a real payment");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('wsq-invoice-smd-h1-cash01-1-1') >= 0;`), "the receipt names the real ledger event it presents");
  ok(await ev(`return document.querySelector('.w-st.paid') && document.querySelector('.w-st.paid').textContent === 'Paid';`), "the invoice reads as Paid once the balance is real zero");

  // An over-refund is refused verbatim.
  await fill("wCashAmount", "600"); await fill("wCashReason", "test");
  await click('[data-w-act^="invrefund:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('at most 500 can be refunded') >= 0;`), "an over-refund is refused, and the real server reason is shown verbatim");

  // A discount with no reason is refused verbatim.
  await fill("wCashAmount", "10"); await fill("wCashReason", "");
  await click('[data-w-act^="invdiscount:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('a discount must say why') >= 0;`), "a discount with no reason is refused, and the real server reason is shown verbatim");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
