/* OPD consult-flow UI test (real headless Chrome, CDP). Loads the REAL opd-emr.js + opd-emr.css and
 * exercises the new behaviour end-to-end (only SMD_VOICE / fetch / flags mocked):
 *   - per-field mic dictates into ONLY the tapped column (number field parses the number; textarea
 *     takes verbatim text); a different column stays empty
 *   - a voice-filled field in a collapsed accordion auto-expands its section (vitals visibility fix)
 *   - after Save to GHIS, the post-save panel shows the swipe-to-close + red "Send to Emergency" button
 *   - swipe-close fires smd:consult-end and closes; ER fires smd:consult-emergency (with ticketId) and closes
 * USAGE: node test/run-opd-flow-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8801, DBG = 9390, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-flow-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const val = async (key) => ev(`var e=document.querySelector('#smdOpdEmr [data-oe-inp="assess:${key}"]'); return e?e.value:null;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/opd-flow-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real opd-emr.js loaded (field-mic + consult-flow hooks present)");

  await ev(`window.OPDEMR.openProfile({ patientId:"MR1", name:"Test Patient", tab:"assess", ticketId:"T1" }); return 1;`);
  let loaded = null;
  for (let i = 0; i < 60; i++) { await sleep(150); loaded = await ev(`return !!document.querySelector('#smdOpdEmr .oe-fmic');`); if (loaded === true) break; }
  ok(loaded === true, "assessment renders with per-field mic buttons");

  // --- per-field mic: number field (BP_SYS) fills ONLY that column ---
  ok(await val("BP_SYS") === "", "BP_SYS starts empty");
  ok(await val("Temp") === "", "Temp starts empty");
  await ev(`var b=[].slice.call(document.querySelectorAll('#smdOpdEmr .oe-fmic')).filter(function(x){return x.getAttribute('data-oe-act')==='fieldmic:BP_SYS';})[0]; b.click(); return 1;`);
  ok(await ev(`var b=[].slice.call(document.querySelectorAll('#smdOpdEmr .oe-fmic')).filter(function(x){return x.getAttribute('data-oe-act')==='fieldmic:BP_SYS';})[0]; return b.classList.contains('on');`) === true, "tapping the BP_SYS mic activates it (listening state)");
  await ev(`window.__emitFinal("blood pressure is 120"); return 1;`);
  await sleep(60);
  ok(await val("BP_SYS") === "120", "dictation 'blood pressure is 120' -> BP_SYS = 120 (number parsed)");
  ok(await val("Temp") === "", "SAFETY: only the tapped column filled - Temp still empty");
  ok(await ev(`var b=[].slice.call(document.querySelectorAll('#smdOpdEmr .oe-fmic')).filter(function(x){return x.getAttribute('data-oe-act')==='fieldmic:BP_SYS';})[0]; return b.classList.contains('on');`) === false, "mic returns to idle after the final transcript");

  // --- auto-expand: BP_SYS lives in the collapsed 'vital parameters' accordion; it must now be open ---
  ok(await ev(`var e=document.querySelector('#smdOpdEmr [data-oe-inp="assess:BP_SYS"]'); var d=e&&e.closest('details.oe-acc'); return !!(d&&d.open);`) === true, "the section holding a voice-filled field auto-expands (vitals no longer hidden)");

  // --- per-field mic: textarea (past history) takes verbatim text ---
  await ev(`var b=[].slice.call(document.querySelectorAll('#smdOpdEmr .oe-fmic')).filter(function(x){return x.getAttribute('data-oe-act')==='fieldmic:History_past_illness';})[0]; b.click(); window.__emitFinal("recurrent similar complaints since two years, prior admission at city hospital"); return 1;`);
  await sleep(60);
  ok((await val("History_past_illness") || "").indexOf("prior admission at city hospital") >= 0, "textarea field mic writes the dictated history verbatim into that column");

  // --- Save to GHIS -> post-save panel (swipe + ER) ---
  ok(await ev(`return !document.querySelector('#smdOpdEmr .oe-postsave');`) === true, "no post-save panel before saving");
  await ev(`var s=document.querySelector('#smdOpdEmr [data-oe-act="assess-save"]'); s.click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(80); if (await ev(`return !!document.querySelector('#smdOpdEmr .oe-postsave');`) === true) break; }
  ok(await ev(`return !!document.getElementById('oeSwipe');`) === true, "after save: swipe-to-close-consult control renders");
  ok(await ev(`return !!document.querySelector('#smdOpdEmr [data-oe-act="consult-er"]');`) === true, "after save: red Send-to-Emergency (ER) button renders");

  // --- swipe close (via the exposed hook) fires smd:consult-end and closes the overlay ---
  await ev(`window.__events=[]; window.OPDEMR._endConsult(); return 1;`);
  await sleep(40);
  ok(await ev(`return window.__events.length===1 && window.__events[0].type==="end" && window.__events[0].ticketId==="T1";`) === true, "swipe-close fires smd:consult-end with the ticketId (queue advances)");
  ok(await ev(`return !document.getElementById('smdOpdEmr').classList.contains('on');`) === true, "swipe-close closes the EMR overlay");

  // --- ER button fires smd:consult-emergency (ticketId) + closes ---
  await ev(`window.__events=[]; window.OPDEMR.openProfile({ patientId:"MR1", name:"Test Patient", tab:"assess", ticketId:"T1" }); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`return !!document.querySelector('#smdOpdEmr .oe-fmic');`) === true) break; }
  await ev(`window.OPDEMR._consultToER(); return 1;`);
  await sleep(40);
  ok(await ev(`return window.__events.some(function(e){return e.type==="emergency"&&e.ticketId==="T1";});`) === true, "ER fires smd:consult-emergency with the ticketId (queue flags Emergency + advances)");
  ok(await ev(`return !document.getElementById('smdOpdEmr').classList.contains('on');`) === true, "ER closes the EMR overlay");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll OPD consult-flow checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
