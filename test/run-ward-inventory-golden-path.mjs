/* WardSynQ TASK 3.4: Inventory button (ward-wide, not patient-scoped) -> stock levels/near-expiry
 * -> receipt -> adjustment blocked without a reason, then recorded with one -> reconciliation,
 * driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-inventory-golden-path-harness.html stubs only the network). Proves the CLIENT half.
 * Server-side correctness is proven separately, for real, in test/wardsynq-inpatient-emar.test.mjs's
 * TASK 3.4 tests and test/wardsynq-stock.test.mjs.
 *
 *   node test/run-ward-inventory-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9410, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-inventory-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-inventory-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the inventory harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="inventoryboard"]');`), "the ward-wide Inventory button appears on the ward list, not inside a patient chart");

  await click('[data-w-act="inventoryboard"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Stock levels') >= 0;`), "the inventory board opens");
  ok(await ev(`return document.body.textContent.indexOf('Metformin 500mg') >= 0;`), "the real stock level is shown");
  ok(await ev(`return document.body.textContent.indexOf('Insulin Glargine') >= 0 && document.body.textContent.indexOf('12 days left') >= 0;`), "the near-expiry batch is shown with its real days-remaining");

  await fill("wStkCode", "Paracetamol 500mg"); await fill("wStkQty", "100"); await fill("wStkUnit", "tablet"); await fill("wStkLoc", "Main");
  await click('[data-w-act="stockreceive"]');
  const receiptBody = await lastBody("/ward/stock-move");
  ok(receiptBody && receiptBody.kind === "receipt" && receiptBody.code === "Paracetamol 500mg" && receiptBody.quantity.value === 100, "the receipt posts exactly what was entered: " + JSON.stringify(receiptBody));

  // An adjustment with no reason is refused; an error repaints the panel (clearing the form, same
  // as every other uncontrolled form in this codebase), so the retry re-enters every field.
  await fill("wAdjCode", "Metformin 500mg"); await fill("wAdjQty", "-5"); await fill("wAdjUnit", "tablet");
  await click('[data-w-act="stockadjust"]');
  ok(await waitFor(`return document.body.textContent.indexOf('needs a reason') >= 0;`), "an adjustment with no reason is refused, client-side, before the server even needs to say so");
  await fill("wAdjCode", "Metformin 500mg"); await fill("wAdjQty", "-5"); await fill("wAdjUnit", "tablet"); await fill("wAdjReason", "Damaged strip found on shelf.");
  await click('[data-w-act="stockadjust"]');
  const adjustBody = await lastBody("/ward/stock-move");
  ok(adjustBody && adjustBody.kind === "adjustment" && adjustBody.reason === "Damaged strip found on shelf.", "the adjustment posts the real reason: " + JSON.stringify(adjustBody));

  await fill("wRecCode", "Metformin 500mg"); await fill("wRecUnit", "tablet"); await fill("wRecCounted", "65");
  await click('[data-w-act="stockreconcile"]');
  ok(await waitFor(`return document.body.textContent.indexOf('variance -5 tablet') >= 0;`), "reconciliation shows the server's own expected/counted/variance sentence verbatim");
  const reconBody = await lastBody("/ward/stock-reconcile");
  ok(reconBody && reconBody.code === "Metformin 500mg" && reconBody.counted === 65, "the reconciliation posts the real counted quantity: " + JSON.stringify(reconBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
