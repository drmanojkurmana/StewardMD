/* TASK 7.10: the WardSynQ integration console, driven in real headless Chrome over CDP.
 *
 * The pure render tests (ward-integration-ui.test.mjs) prove the HTML. This proves what they cannot:
 * the delegated click handlers actually fire, an action that needs a reason REFUSES without one and
 * posts nothing, the server's own refusal is rendered verbatim rather than flattened into "failed",
 * a read that fails leaves a "?" rather than a zero, and the real ward.css styles the board.
 *
 *   node test/run-ward-integration-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9389, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-int-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-integration-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const text = () => ev(`return document.getElementById("smdWard").textContent;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the harness (${ready})`);

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="integration"]');`)) break; }
  ok(await ev(`return !!document.querySelector('[data-w-act="integration"]');`), "the console is reachable from the ward list");

  // 1. Open it: four reads, one board.
  await ev(`document.querySelector('[data-w-act="integration"]').click(); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector(".w-int-stats");`)) break; }
  ok(await ev(`return !!document.querySelector(".w-int-stats");`), "the console rendered");
  ok(await ev(`return getComputedStyle(document.querySelector(".w-int-stat")).borderRadius !== "0px";`), "the real ward.css styled it");
  const reads = await ev(`return window.__calls.filter(function(c){return /source-grants|outbound-destinations|fhir-exceptions|\\/ward\\/outbound\\?/.test(c.url)}).length;`);
  ok(reads >= 4, `all four sides were read (${reads} calls)`);
  ok(/lab-old/.test(await text()) && /expired/.test(await text()), "the lapsed authorisation is on the board");
  ok(/the destination answered 500/.test(await text()), "the far end's own error is shown");

  // 2. An action that needs a reason: cancelling the prompt posts nothing and says why.
  await ev(`window.prompt = function(){ return ""; }; document.querySelector('[data-w-act="outreplay:dl-1"]').click(); return true;`);
  await sleep(150);
  ok(await ev(`return window.__calls.filter(function(c){return c.url.indexOf("outbound-replay")>=0}).length;`) === 0, "no reason, no request");
  ok(/needs a reason/.test(await text()), "and the screen says a decision needs a reason");

  // 3. With a reason: exactly that reason is posted and the board reloads without the dead letter.
  await ev(`window.prompt = function(){ return "The partner confirmed their endpoint is fixed."; }; document.querySelector('[data-w-act="outreplay:dl-1"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (!/dead-letter/.test(await text())) break; }
  const posted = JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf("outbound-replay")>=0}).map(function(c){return c.body}));`));
  ok(posted.length === 1 && posted[0].deliveryId === "dl-1" && posted[0].reason === "The partner confirmed their endpoint is fixed.",
    "the replay posted carries the delivery and the person's own reason (" + JSON.stringify(posted[0]) + ")");
  ok(!/dead-letter/.test(await text()), "the board reloaded and the stopped delivery is no longer stopped");

  // 4. A refusal from the server is rendered verbatim.
  await ev(`window.prompt = function(){ return "No longer sharing with them."; }; document.querySelector('[data-w-act="destrevoke:partner-hospital"]').click(); return true;`);
  await sleep(300);
  ok(/which cannot stop a destination/.test(await text()), "the server's refusal is shown verbatim");
  ok(!/\bfailed to\b/i.test(await text()), "never flattened into a generic failure");

  // 5. A read that fails leaves a "?" and a warning, never a zero.
  await ev(`window.__outboundDown = true; document.querySelector('[data-w-act="intload"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (/could not be read/.test(await text())) break; }
  ok(/could not be read/.test(await text()), "an unreachable list says so");
  ok(await ev(`return /\\?/.test(document.querySelector(".w-int-stats").textContent);`), "and its counter shows ? rather than 0");
  ok(/do not read a zero here as nothing outstanding/.test(await text()), "with the warning that the board is incomplete");

  // 6. Dispatch reports the server's own count, and never says "sent".
  await ev(`window.__outboundDown = false; document.querySelector('[data-w-act="outdispatch"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (/attempted/.test(await text())) break; }
  ok(/2 deliveries attempted/.test(await text()), "the server's own count is shown");
  ok(!/\bSent\b/.test(await text()), "and nothing on the screen claims anything was sent");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
