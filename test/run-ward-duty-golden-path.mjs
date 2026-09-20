/* Owner decision 2026-09-15: a nurse marks herself off duty on the ward screen and sees who a level 2 alert would
 * reach per ward, driven in real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-duty-golden-path-harness.html stubs only the network). The server half is proven through the real
 * router in test/wardsynq-ward-duty-team.test.mjs (GET/POST /api/queue/roster/duty-status, GET /api/queue/ward/alert-cover).
 *
 *   node test/run-ward-duty-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere; SHOT=path.png saves a screenshot)
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9431, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-duty-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-duty-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const text = () => ev(`return document.body.textContent;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}
const has = (s) => `return document.body.textContent.indexOf(${JSON.stringify(s)}) >= 0;`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the duty harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(has("My duty")), "the ward list carries the My duty card");
  ok(await waitFor(has("On the rota now: Day in Medical A")), "the rota shift is named");
  ok(await ev(has("level 2 alert would reach nobody on duty")), "a ward with nobody on duty is visible before an alert");
  ok(await ev(has("2 nurses, 1 resident, 1 consultant")), "counts per role for a covered ward");

  await ev(`window.__refuseNext(); document.querySelector('[data-w-act="dutyset:on"]').click(); return true;`);
  ok(await waitFor(has("is not a ward in this hospital")), "a refusal is shown in words");
  ok(await ev(has("On the rota now: Day in Medical A")), "a refused save leaves the old status on screen");

  await ev(`document.querySelector('[data-w-act="dutyset:off"]').click(); return true;`);
  ok(await waitFor(has("Off duty")), "the card shows Off duty after the server saved it");
  ok(await ev(has("You get no critical-result alerts until then")), "off duty says what it means");
  const posted = await ev(`var c=window.__calls.filter(function(c){return c.method==="POST"&&c.url.indexOf("/roster/duty-status")>=0}); return JSON.stringify(c[c.length-1].body);`);
  const b = JSON.parse(posted);
  ok(b.status === "off" && b.orgId === "org-harness" && !("identity" in b), "the post names the hospital and the status, never an identity: " + posted);
  ok(await ev(`return window.__calls.filter(function(c){return c.url.indexOf("/ward/alert-cover")>=0}).length >= 2;`), "who would be alerted is re-read after the change");

  if (process.env.SHOT) {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64"));
    console.log("screenshot: " + process.env.SHOT);
  }
  void text;
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
