/* ICU v2 navigation test (consolidated single dashboard).
 *
 * v2 is now THE ICU (icuV2On() is always true), so this drives + asserts the v2 UI:
 *  - opening ICU with no target lands on the unit BOARD (.icu-v2-board) with a bottom bar
 *    of Unit / Alerts / Team / Admit;
 *  - tapping a patient (openpt:*) opens the patient WORKSPACE with the segmented top-tabs
 *    (Overview / Monitoring / Care Plan / Rounds / Documents);
 *  - Monitoring shows the sub-nav pills (.icu-seg incl. Trends) and the camera FAB (#icuSnap);
 *  - the FAB is contextual (present on Monitoring, absent on Documents + the board);
 *  - Documents lists the Daily summary + Discharge Creator; Overview keeps the one-tap Trends
 *    shortcut; the selected patient name is preserved throughout.
 *
 * Runs SOLO v2 (smd_icu_groups=0) so it never touches Firestore. Nav/presentation layer only —
 * every existing render + its data (RENDER.* bodies, sub-nav, data-icu-act verbs) is preserved.
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-nav.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9376, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-nav-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(350); };
const clickWs = async (id) => clickAct(`ws:${id}`);
const clickTab = async (id) => clickAct(`tab:${id}`);
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.ingestPatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  // v2 is always on; force SOLO (no Firestore) by turning group mode OFF for this run.
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_icu_v2");}catch(e){} ICU.reset(); ICU.ingestPatient({name:"NAVPT",age:60,sex:"M",bed:"4",icuDay:3,diagnosis:"Sepsis"}); ICU.ingestMonitor({hr:110,map:64,spo2:92}); return 1;`);
  await sleep(200);
  await ev(`ICU.open(); return 1;`);
  await sleep(500);

  // 1) opening with no target lands on the unit BOARD
  ok(await ev(`return !!document.querySelector('.icu-v2-board');`) === true, "opening ICU (no target) lands on the v2 unit board (.icu-v2-board)");
  ok(await ev(`return !document.getElementById('icuSnap');`) === true, "no camera FAB on the board (contextual — monitoring only)");

  // 2) bottom bar: Unit / Alerts / Team / Admit
  const bar = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-v2-bottombar .icu-v2-navbtn'), function(b){ var s=b.querySelectorAll('span'); return (s[s.length-1]||{}).textContent||""; }));`));
  ok(JSON.stringify(bar) === JSON.stringify(["Unit", "Alerts", "Team", "Admit"]), "bottom bar: " + bar.join(" / "));

  // 3) tapping a patient opens the v2 patient WORKSPACE with the segmented top-tabs
  await clickAct(`openpt:cur`); await sleep(150);
  const topTabs = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-v2-tabs .icu-v2-tab'), function(x){return x.textContent;}));`));
  ok(topTabs.length === 5, "patient workspace shows 5 segmented top-tabs (" + topTabs.length + ")");
  ok(JSON.stringify(topTabs) === JSON.stringify(["Overview", "Monitoring", "Care Plan", "Rounds", "Documents"]), "top-tab labels: " + topTabs.join(" / "));
  ok(await ev(`return !document.querySelector('.icu-v2-board');`) === true, "the board is replaced by the patient workspace");

  // 4) camera FAB + sub-nav pills present in Monitoring
  await clickWs("monitoring");
  const monFab = await ev(`return !!document.getElementById('icuSnap');`);
  const monSub = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-subnav .icu-seg'), function(x){return x.textContent;}));`));
  ok(monFab === true, "camera FAB (#icuSnap) present in Monitoring");
  ok(monSub.length === 7 && monSub.indexOf("Trends") >= 0, "Monitoring sub-nav pills (.icu-seg) list its members (" + monSub.length + "): " + monSub.join(","));

  // 5) camera FAB absent in Documents; Documents lists Daily summary + Discharge Creator
  await clickWs("documents");
  ok(await ev(`return !!document.getElementById('icuSnap');`) === false, "camera FAB absent in Documents");
  const docBtns = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-card .icu-btn'), function(b){return b.textContent.replace(/\\s+/g," ").trim();}));`));
  ok(docBtns.some(function (b) { return /Discharge Creator/.test(b); }) && docBtns.some(function (b) { return /Daily ICU summary/.test(b); }), "Documents lists Daily summary + Discharge Creator entry");

  // 6) Overview keeps the one-tap Trends shortcut
  await clickTab("overview");
  ok(await ev(`return !!document.querySelector('[data-icu-act="tab:trends"]');`) === true, "Overview exposes a one-tap 'View trends' shortcut");
  await clickWs("monitoring");
  ok((await ev(`return (document.querySelector('.icu-subnav .icu-seg')||{}).textContent||"";`)) === "Trends", "Trends is the first Monitoring sub-tab");

  // 7) bottom-bar Unit returns to the board (no camera FAB there)
  await clickAct(`icuboard`); await sleep(150);
  ok(await ev(`return !!document.querySelector('.icu-v2-board');`) === true, "bottom-bar Unit returns to the unit board");
  ok(await ev(`return !document.getElementById('icuSnap');`) === true, "no camera FAB on the board");

  // 8) selected patient preserved throughout
  ok(await ev(`return ICU.state().patient.name;`) === "NAVPT", "selected patient (NAVPT) preserved across all v2 nav switches");

  console.log(fails === 0 ? "\nALL GREEN — ICU v2 navigation test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
