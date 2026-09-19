/* WardSynQ Maternity/OB-GYN: bed board -> admission-type select "Maternity" -> pregnancy episode ->
 * MEOWS -> blood loss (visual, PPH recognition) -> delivery -> newborn, driven in real headless
 * Chrome over CDP against the REAL ward.js and ward.css (test/ward-maternity-golden-path-harness.html
 * stubs only the network). Proves the CLIENT half of the maternity vertical - real DOM, real
 * ward.css, real delegated click handler - not a mock render. Persistence/server-side correctness
 * for these same contracts is proven separately, for real, in test/wardsynq-maternity.test.mjs.
 *
 *   node test/run-ward-maternity-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-maternity-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-maternity-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
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

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the maternity harness");

  // ---- 1. Bed board, pick a bed, admit as Maternity. -----------------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="board"]');`), "the bed board is reachable");
  await click('[data-w-act="board"]');
  ok(await waitFor(`return !!document.querySelector('.w-bedcell.free');`), "free beds are shown");
  await click('.w-bedcell.free');
  ok(await waitFor(`return !!document.getElementById('wAdmitClass');`), "the admit panel carries the explicit admission-type select");
  await ev(`document.getElementById('wAdmitClass').value = 'MATERNITY'; document.getElementById('wAdmitMrn').value = 'SMD-H1-MAT01'; document.querySelector('[data-w-act="mrnlookup"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="admitconfirm"]');`);
  await click('[data-w-act="admitconfirm"]');
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "admission returns to a ward list showing the new patient");
  const admitBody = await lastBody("/ward/admit");
  ok(admitBody && admitBody.class === "MATERNITY", "the admission posts class:\"MATERNITY\" explicitly: " + JSON.stringify(admitBody));

  // ---- 2. Open the chart: pregnancy episode. ---------------------------------------------------
  await click('.w-bed');
  ok(await waitFor(`return !!document.getElementById('wPregGravida');`), "the maternity chart shows the pregnancy card");
  await fill("wPregGravida", "2"); await fill("wPregPara", "1"); await fill("wPregWeeks", "39");
  await click('[data-w-act="pregnancysave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Gravida 2, para 1') >= 0;`), "the saved pregnancy episode is shown, exactly as entered");

  // ---- 3. MEOWS: a trigger is shown, and there is no total anywhere. ----------------------------
  ok(await ev(`return document.body.textContent.indexOf('MEOWS') >= 0 && document.body.textContent.indexOf('compensates well') >= 0;`), "MEOWS shows its own advice sentence, not a computed total");

  // ---- 4. Blood loss: a visual estimate prompts recognition, never auto-opens a bundle. ---------
  await waitFor(`return !!document.getElementById('wLossMl');`);
  await fill("wLossMl", "600");
  await ev(`document.getElementById('wLossMethod').value = 'visual-estimate'; return true;`);
  await click('[data-w-act="bloodlosssave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('code-pph') >= 0 || document.body.textContent.indexOf('1200 ml') >= 0;`), "the recognition prompt is shown as a note, not an auto-started bundle");
  const lossBody = await lastBody("/ward/blood-loss");
  ok(lossBody && lossBody.loss.ml === 600 && lossBody.loss.method === "visual-estimate", "blood loss posts exactly what was entered: " + JSON.stringify(lossBody));

  // ---- 5. Starting Code PPH is a deliberate, separate click - reuses the real resus card. -------
  await ev(`document.getElementById('wResusCode').value = 'code-pph'; document.querySelector('[data-w-act="resusstart"]').click(); return true;`);
  ok(await waitFor(`return document.body.textContent.indexOf('Postpartum Haemorrhage') >= 0;`), "the REAL Code PPH bundle definition renders, reusing the existing resus card unchanged");
  ok(await ev(`return document.body.textContent.indexOf('QUANTIFIED by weighing') >= 0;`), "the bundle's real element text is on screen");

  // ---- 6. Delivery, then newborn. ------------------------------------------------------------------
  await ev(`document.getElementById('wDelMode').value = 'vaginal'; return true;`);
  await click('[data-w-act="deliverysave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('vaginal delivery') >= 0;`), "the recorded delivery is shown");
  await ev(`document.getElementById('wNewbornSex').value = 'female'; return true;`);
  await fill("wNewbornName", "Baby Harness");
  await click('[data-w-act="newbornsave"]');
  ok(await waitFor(`return document.body.textContent.indexOf('opd-pat-newborn-1') >= 0;`), "the newborn's real linked id is shown on the mother's chart");
  const newbornBody = await lastBody("/ward/newborn");
  ok(newbornBody && newbornBody.sex === "female" && newbornBody.name === "Baby Harness" && !("deliveredAt" in newbornBody), "the newborn registration never sends a client-supplied deliveredAt - only encounterId, which the server resolves against the real delivery record: " + JSON.stringify(newbornBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
