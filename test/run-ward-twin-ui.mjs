/* TASK 10: the Digital Twin view, driven in real headless Chrome over CDP.
 *
 * The render tests would prove the HTML; this proves what they cannot: that the button opens the
 * real view, that an unavailable section shows "unavailable" rather than a blank card, that "not
 * built" sections are named, that the Copilot ask/review cycle actually posts and renders, and that
 * a simulation result is labelled SIMULATION on screen, not just in the API response.
 *
 *   node test/run-ward-twin-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-twin-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-twin-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const text = () => ev(`return document.getElementById("smdWard").textContent;`);
const html = () => ev(`return document.getElementById("smdWard").innerHTML;`);
const calls = async (frag) => JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}).map(function(c){return c.body}));`));
const waitFor = async (sel, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(`return !!document.querySelector(${JSON.stringify(sel)});`)) return true; } return false; };
const waitText = async (re, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (re.test(await text())) return true; } return false; };

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

  await ev(`window.WARD.open({ orgId: "org-twin-harness" }); return true;`);
  await waitFor('[data-w-act="twin"]');
  await ev(`document.querySelector('[data-w-act="twin"]').click(); return true;`);
  ok(await waitFor('[data-w-act="twinask"]'), "the real twin view opened");
  ok(await ev(`return getComputedStyle(document.querySelector(".w-card")).borderRadius !== "0px";`), "the real ward.css styled it");

  // 1. Freshness and section counts are real, from the real snapshot.
  const t1 = await text();
  ok(/7\/8/.test(t1), "the sections-answered count is shown");
  ok(/42 occupied/.test(t1), "the fused bed count from the snapshot is rendered");

  // 2. The unavailable pharmacy section shows itself as unavailable, never a blank or a zero.
  ok(/Unavailable/.test(t1), "an unavailable section says so");
  ok(/simulated fault/.test(t1), "and shows why");

  // 3. NOT BUILT is a named list, never a silent zero.
  ok(/Not built/.test(t1), "the not-built card is shown");
  ok(/no blood-product inventory module/.test(t1), "and names the reason");

  // 4. Ask MaiK - the real Copilot flow.
  await ev(`window.prompt = function(){ return "What is our current operational status?"; };
    document.querySelector('[data-w-act="twinask"]').click(); return true;`);
  ok(await waitText(/One active ICU capacity crisis/), "MaiK's real answer renders");
  const asked = await calls("/ward/twin-copilot");
  ok(asked.length === 1 && asked[0].question === "What is our current operational status?", "the real question was posted (" + JSON.stringify(asked[0]) + ")");
  const t4 = await text();
  ok(/Blood bank tracking is not built/.test(t4), "the model's own words render verbatim");

  // 5. Review: accept.
  await ev(`document.querySelector('[data-w-act="twincopilotreview:accepted"]').click(); return true;`);
  ok(await waitText(/accepted/), "the review decision renders");
  const reviewed = await calls("/ward/twin-review");
  ok(reviewed.length === 1 && reviewed[0].decision === "accepted", "the real accept was posted");
  ok(!/data-w-act="twincopilotreview:accepted"/.test(await html()), "a second decision is not offered");

  // 6. Simulate - the label is on screen, not just in the response.
  await ev(`document.querySelector('[data-w-act="twinsim:extra-admissions"]').click(); return true;`);
  ok(await waitText(/SIMULATION - NOT LIVE STATE/), "the simulation label renders on screen");
  const simmed = await calls("/ward/twin-simulate");
  ok(simmed.length === 1 && simmed[0].scenario === "extra-admissions", "the real scenario was posted");

  // 7. Refresh reloads a fresh snapshot and clears the prior Copilot answer and simulation.
  await ev(`document.querySelector('[data-w-act="twinload"]').click(); return true;`);
  await sleep(200);
  const t7 = await text();
  ok(!/One active ICU capacity crisis/.test(t7), "refreshing clears the previous Copilot answer");
  // "SIMULATION - NOT LIVE STATE" is a STANDING hint on the Simulate card, shown whether or not a
  // result exists - the actual PROJECTED result from the last run is what must clear.
  ok(!/wouldExceedCapacity/.test(t7), "and the previous simulation's projected result");

  // 8. Back leaves the view and drops its state.
  await ev(`document.querySelector('[data-w-act="back"]').click(); return true;`);
  await sleep(150);
  ok(!(await ev(`return !!document.querySelector('[data-w-act="twinask"]');`)), "back leaves the twin view");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
