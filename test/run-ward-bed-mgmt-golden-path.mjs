/* WardSynQ TASK 4.3: ward list -> Bed management button -> real beds (state, restrictions,
 * isolation) for a real ward -> change a bed's state -> a server-side conflict is shown, not
 * silently swallowed, driven in real headless Chrome over CDP against the REAL ward.js and
 * ward.css (test/ward-bed-mgmt-golden-path-harness.html stubs only the network). Proves the
 * CLIENT half of TASK 4.3's bed-management workstation; the CAS concurrency guard itself is
 * proven for real, against a real store, in test/opd-org-store-ward-bed.test.mjs.
 *
 *   node test/run-ward-bed-mgmt-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9415, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-bed-mgmt-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-bed-mgmt-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the bed-management harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="bedmgmt"]');`), "the ward list carries a Bed management button");

  await click('[data-w-act="bedmgmt"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Bed management') >= 0;`), "the bed-management board opens");
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Medical A') >= 0;`), "the real ward is shown");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('female only') >= 0;`), "a real gender restriction is shown, read from the master record");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('isolation') >= 0;`), "a real isolation flag is shown");
  ok(await ev(`return document.body.lastElementChild.textContent.indexOf('Maintenance') >= 0;`), "the real bed state is shown, not inferred from an encounter");

  // Change bed 1 from available to reserved, and confirm the real state/id are posted.
  await ev(`document.querySelector('[data-bed-state="bed-1"]').value = "reserved"; return true;`);
  await click('[data-w-act="bedstate:bed-1"]');
  const body1 = await lastBody("/bed/update");
  ok(body1 && body1.bedId === "bed-1" && body1.state === "reserved", "applying a state change posts the real bed id and the real target state: " + JSON.stringify(body1));
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('Reserved') >= 0;`), "the board reflects the real state after the server confirms it");

  // A server-side conflict is SHOWN, never silently swallowed - the whole point of TASK 4.3's CAS.
  await ev(`window.__forceNextConflict(); return true;`);
  await ev(`document.querySelector('[data-bed-state="bed-2"]').value = "cleaning"; return true;`);
  await click('[data-w-act="bedstate:bed-2"]');
  ok(await waitFor(`return document.body.lastElementChild.textContent.indexOf('changed under you') >= 0;`), "a real server-side conflict is shown on screen, not silently dropped");

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
