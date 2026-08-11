/* OPD AI Suggestions panel + ambient consultation UI test (real headless Chrome, CDP).
 * Loads the REAL opd-emr.js + opd-emr.css into a minimal harness (SMD_AMBIENT + fetch stubbed so the
 * consultation UI renders and the profile/assessment loads land without hitting st.error). Drives
 * OPDEMR.openProfile() then OPDEMR._applyRefine() directly (the same seam a real onRefine callback
 * would call) and asserts:
 *   - emrFields fold into the assessment form (cc filled)
 *   - the AI suggestions panel is labelled, shows Dx/DD/investigation rows each tagged "Review"
 *   - nothing lands in the provisional-diagnosis EMR field until the doctor taps Accept
 *   - tapping Accept on the Dx writes it into the provisional-diagnosis field
 *   - tapping Accept on an investigation adds an inv-order draft
 *   - a manual edit (assessTouched) survives a second _applyRefine pass (override still holds)
 * USAGE: node test/run-scribe-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8798, DBG = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/scribe-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/scribe-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real opd-emr.js loaded into the harness (window.OPDEMR._applyRefine present)`);

  await ev(`window.OPDEMR.openProfile({ patientId:"MR1", name:"Test Patient", tab:"assess" }); return 1;`);
  let loaded = null;
  for (let i = 0; i < 60; i++) { await sleep(150); loaded = await ev(`return !!document.querySelector('[data-oe-inp="assess:Chief_complaints_duration"]');`); if (loaded === true) break; }
  ok(loaded === true, "assessment tab renders (Chief complaints field present)");

  ok(await ev(`return document.querySelector('[data-oe-inp="assess:Chief_complaints_duration"]').value;`) === "", "cc field starts empty");
  ok(await ev(`return !document.querySelector('.oe-ai-panel');`) === true, "no AI suggestions panel before any refine result");

  await ev(`window.OPDEMR._applyRefine({ emrFields:{cc:"fever x3d"}, suggestions:{ provisionalDx:"viral fever", ddx:[{label:"Dengue",source:"ai"}], investigations:[{label:"CBC",source:"engine"}] } }); return 1;`);
  await sleep(150);

  ok(await ev(`return document.querySelector('[data-oe-inp="assess:Chief_complaints_duration"]').value;`) === "fever x3d", "emrFields folded: cc box filled from the refine result");

  ok(await ev(`var h=document.querySelector('.oe-ai-panel .oe-h3'); return !!h && h.textContent.indexOf("AI suggestions")>=0;`) === true, "a labelled 'AI suggestions' panel renders");
  const panelTxt = await ev(`return document.querySelector('.oe-ai-panel').textContent;`);
  ok(panelTxt.indexOf("viral fever") >= 0, "panel shows the provisional Dx (viral fever)");
  ok(panelTxt.indexOf("Dengue") >= 0, "panel shows the differential (Dengue)");
  ok(panelTxt.indexOf("CBC") >= 0, "panel shows the investigation (CBC)");
  ok(await ev(`return document.querySelectorAll('.oe-ai-panel .oe-review').length >= 3;`) === true, "each suggestion row (+ the panel header) carries a 'Review' tag");

  ok(await ev(`return document.querySelector('[data-oe-inp="assess:provisional_diagnosis"]').value;`) === "", "nothing written to the provisional-diagnosis EMR field yet (review-first, pre-accept)");

  await ev(`document.querySelector('[data-oe-act="scribe-accept:dx:0"]').click(); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelector('[data-oe-inp="assess:provisional_diagnosis"]').value;`) === "viral fever", "tapping Accept on the Dx writes it into the provisional-diagnosis field");
  ok(await ev(`return !document.querySelector('[data-oe-act="scribe-accept:dx:0"]');`) === true, "the accepted Dx row swaps its Accept button for an 'Added' state");

  await ev(`document.querySelector('[data-oe-act="scribe-accept:inv:0"]').click(); return 1;`);
  await sleep(150);
  await ev(`document.querySelector('[data-oe-act="tab:inv"]').click(); return 1;`);
  await sleep(150);
  ok(await ev(`var d=document.querySelector('.oe-draft-h b'); return !!d && d.textContent==="CBC";`) === true, "tapping Accept on CBC adds an inv-order draft (visible on the Investigations tab)");

  // Manual-edit / override still holds: doctor types over the cc field, then a second refine pass
  // for the SAME field must not stomp the manual edit.
  await ev(`document.querySelector('[data-oe-act="tab:assess"]').click(); return 1;`);
  await sleep(150);
  await ev(`var el=document.querySelector('[data-oe-inp="assess:Chief_complaints_duration"]'); el.value="doctor typed this"; el.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await ev(`window.OPDEMR._applyRefine({ emrFields:{cc:"a different AI value"}, suggestions:{ ddx:[], investigations:[] } }); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelector('[data-oe-inp="assess:Chief_complaints_duration"]').value;`) === "doctor typed this", "manual edit survives a later refine pass (override still holds, never stomped)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll scribe-panel checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
