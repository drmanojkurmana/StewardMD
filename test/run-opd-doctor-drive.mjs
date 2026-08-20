/* Live drive of the REAL doctor app (queue.js) in headless Chrome against a mocked backend.
 * Boots a personal-clinic doctor session, then CLICKS every core control and records any runtime
 * error (sync throw, unhandled rejection, console error) plus which endpoints were hit. This is the
 * "bug-test each button" pass: it catches things unit tests miss (dead buttons, handlers that throw
 * on real DOM events, sheets that fail to open).  USAGE: node test/run-opd-doctor-drive.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8802, DBG = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-doctor-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const consoleErrs = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// click a control by its data-q-act (exact cmd, or the first "cmd:*"); returns true if an element was clicked
const clickAct = (cmd) => ev(`var el=document.querySelector('#smdQueue [data-q-act="${cmd}"]')||document.querySelector('#smdQueue [data-q-act^="${cmd}:"]'); if(!el)return false; el.click(); return true;`);
const errCount = () => ev(`return (window.__errs||[]).length;`);
const errsFrom = (n) => ev(`return JSON.stringify((window.__errs||[]).slice(${n}));`);
// run one action, then report any NEW runtime error it produced
async function act(label, cmd, waitMs) {
  const before = await errCount();
  const clicked = await clickAct(cmd);
  await sleep(waitMs || 250);
  const after = await errCount();
  const newErrs = after > before ? JSON.parse(await errsFrom(before)) : [];
  ok(clicked === true, `[click] ${label}  (data-q-act ${cmd})` + (clicked ? "" : "  -- BUTTON NOT FOUND"));
  ok(newErrs.length === 0, `[no-error] ${label}` + (newErrs.length ? "  -- " + JSON.stringify(newErrs) : ""));
  return clicked;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") consoleErrs.push("exception: " + (m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "?"));
    if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") consoleErrs.push("console.error: " + (m.params.args || []).map(a => a.value || a.description || "").join(" "));
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: BASE + "test/opd-doctor-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real queue.js loaded (window.QUEUE.open present)");

  // ---- boot: open -> chooser -> Personal clinic -> pick clinic -> dashboard ----
  await ev(`window.QUEUE.open();`); await sleep(200);
  ok(await ev(`return !!document.querySelector('#smdQueue [data-q-act="typeclinic"]');`), "chooser renders (Hospital / Personal clinic)");
  await clickAct("typeclinic"); await sleep(300);
  ok(await ev(`return !!document.querySelector('#smdQueue [data-q-act^="pickclinic:"]');`), "clinic list renders from GET /orgs");
  await clickAct("pickclinic"); await sleep(400);
  const onDash = await ev(`return !!document.querySelector('#smdQueue .q-app');`);
  ok(onDash === true, "dashboard renders after picking clinic (GET /my-room resolved)");
  ok(await ev(`return (document.querySelectorAll('#smdQueue [data-q-act^="call:"]').length>0);`), "ticket rows render with per-patient actions");
  ok(await ev(`return !!document.querySelector('#smdQueue [data-q-act^="sendback:"]');`), "in-consult / called patient shows a Send-back control");

  // ---- core per-patient + session actions (each re-renders from the mock; order-independent) ----
  await act("Priority a waiting patient", "prio");
  await act("Call a waiting patient", "call");
  await act("Send patient back to waiting", "sendback");
  await act("Start consult (opens assessment)", "start", 350);
  await act("View EMR profile", "profile", 300);
  await act("Assessment + Ask MaiK", "assess", 300);
  await act("Remove patient (confirm)", "remove");
  await act("Emergency toggle", "emergency");
  await act("Pause / resume queue", "pause");
  await act("Doctor status chip", "docstatus");
  await act("Add patient (prompts)", "add", 300);
  await act("Import / refresh queue", "importopd", 400);

  // ---- profile sheet + clinic staff admin ----
  await act("Open doctor profile sheet", "docprofile", 400);
  ok(await ev(`return !!document.querySelector('#smdQueue .q-profile');`), "profile sheet opened");
  ok(await ev(`return /SMD-CLN001/.test((document.querySelector('#smdQueue .q-clinic-id')||{}).textContent||"");`), "Clinic ID (server org.code) shown in staff admin");
  ok(await ev(`return document.querySelectorAll('#smdQueue .q-staff-row').length>0;`), "existing staff list renders from GET /members");
  await act("Copy Clinic ID", "copyclinic");
  // fill the add-staff form then submit
  await ev(`var n=document.getElementById('qStaffName'); if(n)n.value='nurse2'; var p=document.getElementById('qStaffPin'); if(p)p.value='1234'; var r=document.getElementById('qStaffRole'); if(r)r.value='nurse'; return true;`);
  await act("Add staff (nurse2 / PIN 1234)", "addstaff", 400);
  await act("Remove a staff member (confirm)", "staffremove", 350);
  await act("Close profile sheet", "profile-close", 250);

  // ---- views: analytics, settings, back ----
  await act("Nav -> Analytics", "nav", 400);   // clicks first nav; may be dashboard - then analytics below
  await ev(`var a=document.querySelector('#smdQueue [data-q-act="nav:analytics"]'); if(a)a.click(); return true;`); await sleep(400);
  ok(await ev(`return /Analytics|analytics|Avg|wait/i.test((document.querySelector('#smdQueue .q-app')||document.body).textContent||"");`), "analytics view renders from GET /analytics");
  await ev(`var s=document.querySelector('#smdQueue [data-q-act="nav:settings"]'); if(s)s.click(); return true;`); await sleep(400);
  ok(await ev(`return document.querySelectorAll('#smdQueue [data-cfg]').length>0;`), "settings view renders editable config from GET /config");
  await act("Save settings", "savecfg", 350);
  await ev(`var d=document.querySelector('#smdQueue [data-q-act="nav:dashboard"]'); if(d)d.click(); return true;`); await sleep(300);

  // ---- switch workplace (destructive: returns to chooser) LAST ----
  await act("Switch clinic / hospital", "switch", 300);
  ok(await ev(`return !!document.querySelector('#smdQueue [data-q-act="typeclinic"]');`), "Switch returns to the workplace chooser");

  // ---- coverage + any console/runtime errors seen across the whole run ----
  const fetched = JSON.parse(await ev(`return JSON.stringify(window.__fetched||[]);`) || "[]");
  console.log("\n-- endpoints exercised --\n" + [...new Set(fetched)].join("\n"));
  const allErrs = JSON.parse(await ev(`return JSON.stringify(window.__errs||[]);`) || "[]");
  ok(allErrs.length === 0, "no in-page runtime errors across the whole drive" + (allErrs.length ? "\n   " + allErrs.join("\n   ") : ""));
  ok(consoleErrs.length === 0, "no console.error / uncaught exceptions" + (consoleErrs.length ? "\n   " + consoleErrs.join("\n   ") : ""));

  console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nAll doctor-app live-drive checks passed");
} catch (e) {
  console.log("HARNESS ERROR: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill(); } catch {} try { serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
