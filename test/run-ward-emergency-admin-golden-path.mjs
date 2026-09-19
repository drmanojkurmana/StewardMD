/* WardSynQ: ward list -> Emergency button -> declare a real emergency with a real relaxation -> it
 * appears in the log AND the visible-status banner elsewhere in the app -> stand it down with a
 * real reason -> the log shows it stood down, driven in real headless Chrome over CDP against the
 * REAL ward.js and ward.css (the harness stubs only the network and window.prompt). The declare/
 * deactivate mechanism itself is proven for real in test/wardsynq-emergency-mode-bridge.test.mjs;
 * this proves only the CLIENT half - the admin controls this session's own audit found missing.
 *
 *   node test/run-ward-emergency-admin-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9426, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-emergency-admin-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-emergency-admin-golden-path-harness.html");
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the emergency-admin harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="emergencyadmin"]');`), "the ward list carries an Emergency button");

  await click('[data-w-act="emergencyadmin"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('No emergency has ever been declared') >= 0;`), "the emergency admin screen opens and states plainly nothing has been declared yet");

  const noReason = await ev(`document.getElementById('wEmergencyReason').value = 'short'; return true;`).then(() => click('[data-w-act="emergencydeclare"]'));
  ok(await waitFor(`return document.body.textContent.indexOf('Say what the emergency is') >= 0;`), "a too-short reason is refused CLIENT-SIDE - no request sent for it");

  await fill("wEmergencyReason", "Multi-vehicle collision, using every held bed on Medical A.");
  await fill("wEmergencyRelaxations", "bed-assignment-conflict-override");
  await click('[data-w-act="emergencydeclare"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Multi-vehicle collision') >= 0;`), "the real declared emergency appears in the log");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('bed-assignment-conflict-override') >= 0;`), "the real named relaxation is shown");

  // The SAME declaration is now visible as a banner anywhere else in the app.
  await click('[data-w-act="back"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Multi-vehicle collision') >= 0;`), "the visible-status banner on the ward list shows the SAME real declaration");

  await click('[data-w-act="emergencyadmin"]');
  await waitFor(`return !!document.querySelector('[data-w-act^="emergencydeactivate:"]');`);
  await click('[data-w-act^="emergencydeactivate:"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('stood down') >= 0;`), "standing it down shows it as stood down in the log");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Surge resolved') >= 0;`), "the real stand-down reason is shown verbatim");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
