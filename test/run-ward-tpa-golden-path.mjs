/* WardSynQ TASK 4.17: open a chart -> TPA button -> code a claim -> submit it -> deny it with a
 * real reason -> resubmit it -> record a real pre-authorisation, driven in real headless Chrome
 * over CDP against the REAL ward.js and ward.css (test/ward-tpa-golden-path-harness.html stubs
 * only the network and window.prompt). wardsynq-billing.js/functions/_wardsynq/billing.js are
 * proven for real in their own test suites; this proves only the CLIENT half.
 *
 *   node test/run-ward-tpa-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9423, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-tpa-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tpa-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the TPA harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="tpaopen"]');`), "the ordinary chart carries a TPA button");

  await click('[data-w-act="tpaopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('No claim has been coded') >= 0;`), "the TPA screen opens and states plainly nothing is coded yet");

  await fill("wTpaCodes", "J18.9");
  await click('[data-w-act="claimcode"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('J18.9') >= 0;`), "the real coded claim appears with its real code");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('coded') >= 0;`), "it starts in the coded state");

  await click('[data-w-act^="claimsubmit:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('submitted') >= 0;`), "submitting moves it to submitted");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('5000') >= 0;`), "the real submitted amount is shown");

  await click('[data-w-act^="claimdeny:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('denied') >= 0;`), "denying moves it to denied");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Documentation insufficient') >= 0;`), "the real denial reason is shown verbatim");

  await click('[data-w-act^="claimresubmit:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('submitted') >= 0;`), "resubmitting moves it back to submitted");

  await fill("wTpaTreatment", "Knee replacement");
  await fill("wTpaAuthState", "approved");
  await ev(`document.getElementById('wTpaAuthState').value = 'approved'; return true;`);
  await fill("wTpaAuthAmount", "150000");
  await click('[data-w-act="preauth"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Knee replacement') >= 0;`), "the real pre-authorisation appears");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('150000') >= 0;`), "the real authorized amount is shown");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
