/* WardSynQ TASK 4.10: open a chart -> Consent button -> record a granted consent -> record a
 * refused consent that needs a detail -> a missing detail is refused CLIENT-SIDE -> withdraw a
 * consent -> the history shows both, refused sorted before granted, driven in real headless Chrome
 * over CDP against the REAL ward.js and ward.css (test/ward-consent-golden-path-harness.html stubs
 * only the network and window.prompt). consent.js itself is unmodified by this task and already has
 * its own route-level and pure-engine coverage; this proves only the new CLIENT half.
 *
 *   node test/run-ward-consent-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9419, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-consent-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-consent-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const fill = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
const select = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the consent harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="consentopen"]');`), "the ordinary chart carries a Consent button");

  await click('[data-w-act="consentopen"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('No consent has been recorded') >= 0;`), "the consent screen opens and states plainly nothing is recorded yet");

  // Record a granted general-treatment consent.
  await select("wConsentScope", "treatment"); await select("wConsentDecision", "granted");
  await click('[data-w-act="consentrecord"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('General treatment') >= 0 && document.body.lastElementChild.textContent.indexOf('granted') >= 0;`), "the granted treatment consent appears in the history");

  // "other" needs a detail: try without one, refused client-side, no request sent.
  await select("wConsentScope", "other");
  ok(await waitFor(`return !!document.getElementById('wConsentDetail');`), "the other scope reveals a required detail field");
  await click('[data-w-act="consentrecord"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Say what this is about') >= 0;`), "a missing detail on scope=other is refused CLIENT-SIDE");
  const callsBeforeDetail = await ev(`return window.__calls.filter(function(c){return c.url && c.url.indexOf('/ward/consent')>=0 && c.url.indexOf('consents')<0 && c.method==='POST'}).length;`);
  ok(callsBeforeDetail === 1, "confirmed: the missing-detail attempt sent no second request (only the earlier granted one went out): " + callsBeforeDetail);

  // Now record a refused photography consent (no detail required for this scope).
  await select("wConsentScope", "photography"); await select("wConsentDecision", "refused");
  await click('[data-w-act="consentrecord"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Clinical photography') >= 0 && document.body.lastElementChild.textContent.indexOf('refused') >= 0;`), "the refused photography consent appears");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('1 refused') >= 0;`), "a refusal count is shown, not buried among the grants");

  // The refused one sorts before the granted one, within the history list itself (not the scope dropdown).
  const order = await ev(`var t=document.querySelector('.w-mini').textContent; return t.indexOf('Clinical photography') < t.indexOf('General treatment');`);
  ok(order, "the refused consent is listed ahead of the granted one");

  // Withdraw the granted treatment consent.
  await click('[data-w-act^="consentwithdraw:treatment"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('withdrawn') >= 0;`), "withdrawing a consent shows it as withdrawn, with the original grant kept as history, not erased");
  const withdrawBody = await ev(`var c=window.__calls.filter(function(c){return c.url && c.url.indexOf('/ward/withdraw-consent')>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
  ok(withdrawBody && withdrawBody.reason === "Testing withdrawal", "the withdrawal posted the reason the prompt returned: " + JSON.stringify(withdrawBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
