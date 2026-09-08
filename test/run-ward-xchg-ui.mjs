/* WardSynQ ward: the held-from-other-systems card, driven in real headless Chrome over CDP.
 *
 * The pure render tests (ward-ui.test.mjs) prove the HTML. This proves the part they cannot: the
 * delegated click handler reads the radio, the select and the textarea from the real DOM, refuses
 * to post without a reason, posts exactly what the server needs, renders the server's refusal
 * verbatim, and repaints from the reloaded queue.
 *
 *   node test/run-ward-xchg-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-xchg-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-xchg-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

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
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector(".w-xchg");`)) break; }
  ok(await ev(`return !!document.querySelector(".w-xchg");`), "the held-from-other-systems card rendered from the loaded queue");
  ok(await ev(`return document.querySelectorAll(".w-xchg li").length;`) === 2, "two held messages listed");
  ok(await ev(`return getComputedStyle(document.querySelector(".w-xchg li")).borderRadius !== "0px";`), "the real ward.css styled the row");

  // 1. No reason: nothing is posted, the screen says why.
  await ev(`document.querySelector('[data-w-act="xchg:wsq-xchg-1"]').click(); return true;`);
  await sleep(100);
  ok(await ev(`return (window.__calls.filter(function(c){return c.url.indexOf("fhir-exception-resolve")>=0}).length);`) === 0, "no reason, no request");
  ok(await ev(`return /A reason is required/.test(document.getElementById("smdWard").textContent);`), "and the screen says a reason is required");

  // 2. Pick the second candidate, keep "link", give a reason: the post carries exactly that.
  await ev(`document.querySelector('input[name="wxP-wsq-xchg-1"][value="wsq-pat-2"]').checked = true; document.getElementById("wxW-wsq-xchg-1").value = "Same person, confirmed by phone."; document.querySelector('[data-w-act="xchg:wsq-xchg-1"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return document.querySelectorAll(".w-xchg li").length === 1;`)) break; }
  const posted = JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf("fhir-exception-resolve")>=0}).map(function(c){return c.body}));`));
  ok(posted.length === 1 && posted[0].exceptionId === "wsq-xchg-1" && posted[0].resolution === "link" && posted[0].localPatientId === "wsq-pat-2" && posted[0].reason === "Same person, confirmed by phone.",
    "the decision posted is the one the person made: link to the chosen candidate, with the reason (" + JSON.stringify(posted[0]) + ")");
  ok(await ev(`return document.querySelectorAll(".w-xchg li").length;`) === 1, "the queue was reloaded and the decided message is gone");
  ok(await ev(`return /Decided: link, 2 records filed\\./.test(document.getElementById("smdWard").textContent);`), "the server's own count is shown, not a generic done");

  // 3. A refusal from the server is rendered verbatim, and the message stays.
  await ev(`document.getElementById("wxR-wsq-xchg-2").value = "keep-local"; document.getElementById("wxW-wsq-xchg-2").value = "Ours is right."; document.querySelector('[data-w-act="xchg:wsq-xchg-2"]').click(); return true;`);
  await sleep(300);
  ok(await ev(`return /Your role here is "nurse", which cannot decide this/.test(document.getElementById("smdWard").textContent);`), "the server's refusal is shown verbatim");
  ok(await ev(`return document.querySelectorAll(".w-xchg li").length;`) === 1, "and the refused message is still held");
  ok(await ev(`return !/\\bfailed\\b/i.test(document.getElementById("smdWard").textContent);`), "never flattened into a generic failure");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
