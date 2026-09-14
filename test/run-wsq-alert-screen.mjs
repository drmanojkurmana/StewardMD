/* S3 P1: the WardSynQ critical-result alert screen in real headless Chrome, API stubbed.
 *
 * Page: test/wsq-alert-screen-harness.html (the real wardsynq-flags.js, hospital-auth.js,
 * wardsynq-alert-ui.js and swipe-back.js). Stubbed routes: GET /api/push/notice/<nid>,
 * POST /api/queue/ward/acknowledge, POST /api/push/notice/<nid>/decline, POST /api/push/wardsynq-receipt.
 * Checks: nothing fetched under app lock; the detail at phone width with no horizontal scroll;
 * acknowledge needs a sentence and records it; a failed load and a failed acknowledgement are shown
 * as failures; the cross-hospital guard shows no patient; Escape and the back gesture do not dismiss.
 *
 * USAGE: node test/run-wsq-alert-screen.mjs   (BASE=http://localhost:8995/ to reuse a server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const PORT = 9395, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/wsq-alert-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NID = "0123456789abcdef0123456789abcdef";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8995"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=390,844"], { stdio: "ignore" });
let msgId = 1, ws, sessionId; const pending = new Map();
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return {__err:String(x&&x.message||x)}}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const until = async (expr, ms = 4000) => { for (let t = 0; t < ms; t += 100) { if (await ev(`return !!(${expr})`)) return true; await sleep(100); } return false; };

const notice = (orgId) => ({ status: 200, body: { ok: true, notice: { nid: NID, kind: "critical", level: "due", orgId, hospital: orgId === "org-a" ? "Asha Hospital" : "Bharat Hospital", loopId: "loop-1", state: "open", reportedAt: "2026-09-14T03:00:00Z", patient: { id: "pat-1", name: "Ramesh Kumar", mrn: "MRN-778812" }, location: { ward: "Medical A", bed: "7" }, result: { code: "K", display: "Potassium", value: 7.2, unit: "mmol/L" } } } });
const PUSH = { type: "wardsynq-alert", v: "2", nid: NID, kind: "critical", urgency: "high", title: "Ramesh Kumar", body: "MRN-778812 Potassium 7.2" };

async function fresh(setup) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "test/wsq-alert-screen-harness.html" });
  ok(await until("window.SMD_WSQ_ALERT && window.SMD_HOSPITAL_AUTH && window.SMD_SWIPE_BACK"), "harness loaded the real modules");
  await ev(setup);
}
const text = () => ev(`var e=document.getElementById("wsq-alert"); return e ? e.innerText : "";`);
const clickAct = (act) => ev(`document.querySelector('#wsq-alert [data-wsq-act="${act}"]').click(); return 1;`);

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // 1. App lock, then detail, then acknowledge.
  await fresh(`localStorage.setItem("smd_opd_workplace","wardsynq:org-a"); window.__locked = true;
    __routes["GET /api/push/notice/${NID}"] = ${JSON.stringify(notice("org-a"))};
    __routes["POST /api/push/wardsynq-receipt"] = {status:200, body:{ok:true}};
    __routes["POST /api/queue/ward/acknowledge"] = {status:200, body:{ok:true, written:1, state:"acknowledged"}}; return 1;`);
  ok(await ev(`return SMD_WSQ_ALERT.handle(${JSON.stringify(PUSH)})`) === true, "a v2 push opens the screen");
  await sleep(300);
  ok((await ev(`return __calls.length`)) === 0, "nothing fetched while app lock is up");
  const lockedText = await text();
  ok(lockedText.includes("Unlock StewardMD") && !/Ramesh|MRN-778812|Potassium|7\.2/.test(lockedText), "locked screen shows no push text and no patient");
  ok((await ev(`return getComputedStyle(document.getElementById("wsq-alert")).zIndex`)) === "2147482500", "sits under the app lock layer");
  await ev(`window.__locked = false; __unlocks[0](); return 1;`);
  ok(await until(`document.querySelector('#wsq-alert [data-wsq-act="ack"]')`), "detail loads after unlock");
  const detail = await text();
  for (const w of ["Ramesh Kumar", "MRN-778812", "Ward Medical A, bed 7", "Potassium 7.2 mmol/L", "Asha Hospital"]) ok(detail.includes(w), "detail shows " + w);
  ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth`), "no horizontal scroll at 390px");
  ok(await ev(`var b=document.querySelector('#wsq-alert [data-wsq-act="ack"]').getBoundingClientRect(); return b.height >= 44`), "Acknowledge is a 44px+ target");

  // Escape and the back gesture do not dismiss.
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`);
  ok(await ev(`return SMD_SWIPE_BACK.hardwareBack() === true && !!document.getElementById("wsq-alert")`), "Escape and Android back leave the alert on screen");

  await clickAct("ack");
  await sleep(150);
  ok((await text()).includes("Write what you did"), "acknowledge without a sentence is refused on screen");
  ok(!(await ev(`return __calls.some(function(c){return c.path==="/api/queue/ward/acknowledge"})`)), "and nothing is sent");
  await ev(`var t=document.getElementById("wsq-action"); t.value="Repeated K, insulin-dextrose started"; t.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await clickAct("ack");
  ok(await until(`document.getElementById("wsq-alert") && document.getElementById("wsq-alert").innerText.indexOf("Acknowledged.") >= 0`), "acknowledged screen after a written record");
  const sent = await ev(`return __calls.filter(function(c){return c.path==="/api/queue/ward/acknowledge"})[0]`);
  ok(sent && sent.body.action === "Repeated K, insulin-dextrose started" && sent.body.loopId === "loop-1" && sent.headers.Authorization === "Bearer acct-jwt", "POST /api/queue/ward/acknowledge carried loop, action and the account credential");
  await clickAct("close");
  ok(await ev(`return !document.getElementById("wsq-alert")`), "Close after the answer removes the screen");

  // 2. A failed acknowledgement stays a failure.
  await fresh(`localStorage.setItem("smd_opd_workplace","wardsynq:org-a");
    __routes["GET /api/push/notice/${NID}"] = ${JSON.stringify(notice("org-a"))};
    __routes["POST /api/push/wardsynq-receipt"] = {status:200, body:{ok:true}};
    __routes["POST /api/queue/ward/acknowledge"] = "network"; return 1;`);
  await ev(`SMD_WSQ_ALERT.handle(${JSON.stringify(PUSH)}); return 1;`);
  await until(`document.getElementById("wsq-action")`);
  await ev(`var t=document.getElementById("wsq-action"); t.value="Seen"; t.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await clickAct("ack");
  ok(await until(`document.getElementById("wsq-alert-state") && /Could not reach the server/.test(document.getElementById("wsq-alert-state").innerText)`), "a network failure on acknowledge is shown, not a success");
  ok(await ev(`return !!document.querySelector('#wsq-alert [data-wsq-act="ack"]:not([disabled])') && !document.querySelector('#wsq-alert [data-wsq-act="close"]')`), "Acknowledge is available again and there is no Close");

  // 3. A failed load.
  await fresh(`localStorage.setItem("smd_opd_workplace","wardsynq:org-a"); __routes["GET /api/push/notice/${NID}"] = {status:500, body:{ok:false, error:"record_read_failed"}}; return 1;`);
  await ev(`SMD_WSQ_ALERT.handle(${JSON.stringify(PUSH)}); return 1;`);
  ok(await until(`document.querySelector('#wsq-alert [data-wsq-act="retry"]')`), "a failed load shows Try again");
  ok(/could not be loaded: record_read_failed/.test(await text()) && /keeps escalating/.test(await text()), "names the failure and that the result is still escalating");

  // 4. Cross-hospital guard.
  await fresh(`localStorage.setItem("smd_opd_workplace","wardsynq:org-b");
    __routes["GET /api/push/notice/${NID}"] = ${JSON.stringify(notice("org-a"))};
    __routes["POST /api/push/wardsynq-receipt"] = {status:200, body:{ok:true}}; return 1;`);
  await ev(`SMD_WSQ_ALERT.handle(${JSON.stringify(PUSH)}); return 1;`);
  ok(await until(`document.querySelector('#wsq-alert [data-wsq-act="switch"]')`), "an alert from another hospital asks to switch");
  ok(/\?orgId=org-b$/.test(await ev(`return __calls.filter(function(c){return c.path.indexOf("/api/push/notice/")===0})[0].url`)), "GET /api/push/notice/<nid> named the workplace, so the real server refuses it before reading");
  const sw = await text();
  ok(sw.includes("Asha Hospital") && !/Ramesh|MRN-778812|Potassium|7\.2/.test(sw), "names the hospital, shows no patient or result");
  await clickAct("switch");
  ok(await until(`document.querySelector('#wsq-alert [data-wsq-act="ack"]')`), "switching opens the alert");
  ok((await ev(`return localStorage.getItem("smd_opd_workplace")`)) === "wardsynq:org-a", "the workplace is now hospital A");
} catch (e) {
  console.error(e); fails++;
} finally {
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
