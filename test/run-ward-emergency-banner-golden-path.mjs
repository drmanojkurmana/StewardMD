/* WardSynQ TASK 4.15: a real, server-reported active emergency shows as a banner on the ward list
 * -> opening a chart still shows the SAME banner, without navigating back -> the banner names the
 * kind, the real reason, and what it relaxes, driven in real headless Chrome over CDP against the
 * REAL ward.js and ward.css (test/ward-emergency-banner-golden-path-harness.html stubs only the
 * network). The declare/deactivate mechanism itself is proven for real in
 * test/wardsynq-emergency-mode-bridge.test.mjs; this proves only the CLIENT half - visible status.
 *
 *   node test/run-ward-emergency-banner-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9421, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-emergency-banner-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-emergency-banner-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the emergency-banner harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return document.body.textContent.indexOf('Multi-vehicle collision') >= 0;`), "the real active emergency's reason appears as a banner on the ward LIST");
  ok(await ev(`return document.body.textContent.indexOf('mass-casualty') >= 0;`), "the kind is shown");
  ok(await ev(`return document.body.textContent.indexOf('triage-priority-override') >= 0;`), "the named relaxation is shown - never a vague 'emergency mode is on'");

  await click('.w-bed');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="consentopen"]');`), "a chart opened");
  ok(await ev(`return document.body.textContent.indexOf('Multi-vehicle collision') >= 0;`), "the SAME banner is still visible on the chart, without navigating back to the ward list");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
