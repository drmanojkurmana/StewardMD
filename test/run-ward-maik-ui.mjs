/* TASK 8.5: MaiK on the chart, driven in real headless Chrome over CDP.
 *
 * The render tests (ward-maik-ui.test.mjs) prove the HTML. This proves what they cannot: that the
 * delegated clicks fire, that a rejection without a reason posts NOTHING, that an edit is read from
 * the real textarea and is what gets filed, that a server refusal is rendered verbatim, and - the
 * one that matters most - that switching patient CLEARS MaiK's panel, so one patient's answer can
 * never sit on another patient's chart.
 *
 *   node test/run-ward-maik-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-maik-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-maik-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const text = () => ev(`return document.getElementById("smdWard").textContent;`);
const calls = async (frag) => JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}).map(function(c){return c.body}));`));

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
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act^="open:"]');`)) break; }
  await ev(`document.querySelector('[data-w-act="open:enc-1"]').click(); return true;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="maikask:summarise"]');`)) break; }
  ok(await ev(`return !!document.querySelector('[data-w-act="maikask:summarise"]');`), "MaiK is on the patient's chart");
  ok(await ev(`return getComputedStyle(document.querySelector(".w-card")).borderRadius !== "0px";`), "the real ward.css styled it");

  // 1. Ask. The request names the patient the chart is open on.
  await ev(`document.querySelector('[data-w-act="maikask:draft-note"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (/If you accept/.test(await text())) break; }
  const asked = await calls("/ward/maik-ask");
  ok(asked.length === 1 && asked[0].patientId === "pat-1" && asked[0].task === "draft-note",
    "the ask names the open patient and the chosen task (" + JSON.stringify(asked[0]) + ")");
  const t1 = await text();
  ok(/Read 1 record version from this chart/.test(t1), "it shows what MaiK read");
  ok(/Includes text written by another system: fhir-partner-his/.test(t1), "and that another hospital's text was in it");
  ok(/contained something that reads like an instruction/.test(t1), "and that a document looked like an instruction");
  ok(/stated no measure of its own certainty/.test(t1), "and that MaiK stated no certainty of its own");
  ok(/A ClinicalNote will be created, authored by ai:maik and unsigned/.test(t1.replace(/\s+/g, " ")), "and what accepting would write");

  // 2. Reject with no reason: nothing is posted, and the screen says why.
  await ev(`window.prompt = function(){ return ""; }; document.querySelector('[data-w-act="maikreview:rejected"]').click(); return true;`);
  await sleep(150);
  ok((await calls("/ward/maik-review")).length === 0, "no reason, no request");
  ok(/rejection needs a reason/.test(await text()), "and the screen says a rejection needs a reason");

  // 3. Edit: the textarea's real value is what gets filed.
  await ev(`document.querySelector('[data-w-act="maikedit"]').click(); return true;`);
  for (let i = 0; i < 20; i++) { await sleep(100); if (await ev(`return !!document.getElementById("wMaikEdit");`)) break; }
  ok(await ev(`return document.getElementById("wMaikEdit").value.indexOf("Comfortable overnight") >= 0;`), "the edit box opens with MaiK's own text");
  await ev(`document.getElementById("wMaikEdit").value = "Seen with the registrar. Chest clear on examination."; document.querySelector('[data-w-act="maikreview:edited"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (/Edited by/.test(await text())) break; }
  const reviewed = await calls("/ward/maik-review");
  ok(reviewed.length === 1 && reviewed[0].decision === "edited" && reviewed[0].editedOutput === "Seen with the registrar. Chest clear on examination.",
    "the clinician's own text is what is filed (" + JSON.stringify(reviewed[0]) + ")");
  const t3 = await text();
  ok(/Edited by cfa:doctor/.test(t3), "the decision and who made it are shown");
  ok(/wrote 1 record/.test(t3), "and what it wrote");
  ok(!/data-w-act="maikreview:accepted"/.test(await ev(`return document.getElementById("smdWard").innerHTML;`)), "a second decision is not offered");

  // 4. THE WRONG-PATIENT PROPERTY: switching chart clears MaiK entirely.
  await ev(`document.querySelector('[data-w-act="back"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="open:enc-2"]');`)) break; }
  await ev(`document.querySelector('[data-w-act="open:enc-2"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (await ev(`return !!document.querySelector('[data-w-act="maikask:summarise"]');`)) break; }
  const t4 = await text();
  ok(!/Seen with the registrar/.test(t4) && !/Comfortable overnight/.test(t4), "the previous patient's MaiK answer is GONE from the new chart");
  ok(!/Edited by/.test(t4), "and so is the previous decision");

  // 5. A refusal is shown verbatim, not flattened.
  await ev(`document.querySelector('[data-w-act="maikask:summarise"]').click(); return true;`);
  for (let i = 0; i < 30; i++) { await sleep(100); if (/approved no model provider/.test(await text())) break; }
  ok(/approved no model provider to receive it/.test(await text()), "the server's own refusal is rendered verbatim");
  ok(!/\bunavailable\b/i.test(await text()), "not flattened into a generic unavailable");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
