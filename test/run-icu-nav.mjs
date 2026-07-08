/* ICU 5-workspace navigation test.
 *
 * Proves the reorganised ICU nav: exactly 5 fixed bottom workspaces (Overview/Monitoring/
 * Care Plan/Documents/More), a segmented sub-nav of each workspace's members, no truncated
 * labels, the camera FAB shown only in monitoring workspaces, the active member persisting
 * across a workspace round-trip, and the selected patient preserved throughout.
 *
 * Nav layer only — every existing render + its data is preserved.
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
const clickWs = async (id) => { await ev(`var b=document.querySelector('[data-icu-act="ws:${id}"]'); if(b) b.click(); return 1;`); await sleep(350); };
const clickTab = async (id) => { await ev(`var b=document.querySelector('[data-icu-act="tab:${id}"]'); if(b) b.click(); return 1;`); await sleep(350); };
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
  await ev(`ICU.reset(); ICU.ingestPatient({name:"NAVPT",age:60,sex:"M",bed:"4",icuDay:3,diagnosis:"Sepsis"}); ICU.ingestMonitor({hr:110,map:64,spo2:92}); return 1;`);
  await sleep(200);
  await ev(`ICU.open(); return 1;`);
  await sleep(500);

  // 1) exactly 5 bottom workspaces, expected labels
  const r1 = await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-ws-bar .icu-tab .tl'), function(x){return x.textContent;}));`);
  const labels = JSON.parse(r1);
  ok(labels.length === 5, "exactly 5 fixed bottom workspaces (" + labels.length + ")");
  ok(JSON.stringify(labels) === JSON.stringify(["Overview", "Monitoring", "Care Plan", "Documents", "More"]), "workspace labels: " + labels.join(" / "));

  // 2) no truncated labels (each label's content fits its box)
  const r2 = await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-ws-bar .icu-tab .tl'), function(x){ return x.scrollWidth - x.clientWidth; }));`);
  ok(JSON.parse(r2).every(function (d) { return d <= 1; }), "no truncated labels (overflow per label = " + JSON.parse(r2).join(",") + ")");

  // 3) camera FAB present in Monitoring, absent in Documents & More
  await clickWs("monitoring");
  const monFab = await ev(`return !!document.getElementById('icuSnap');`);
  const monSub = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-subnav .icu-seg'), function(x){return x.textContent;}));`));
  ok(monFab === true, "camera FAB present in Monitoring");
  ok(monSub.length === 7 && monSub.indexOf("Trends") >= 0, "Monitoring sub-nav lists its members (" + monSub.length + "): " + monSub.join(","));
  await clickWs("documents");
  ok(await ev(`return !!document.getElementById('icuSnap');`) === false, "camera FAB absent in Documents");
  const docBtns = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-card .icu-btn'), function(b){return b.textContent.replace(/\\s+/g," ").trim();}));`));
  ok(docBtns.some(function (b) { return /Discharge Creator/.test(b); }) && docBtns.some(function (b) { return /Daily ICU summary/.test(b); }), "Documents lists Daily summary + Discharge Creator entry");
  await clickWs("more");
  ok(await ev(`return !!document.getElementById('icuSnap');`) === false, "camera FAB absent in More");

  // 4) active member persists across a workspace round-trip
  await clickWs("monitoring"); await clickTab("trends");
  const seg1 = await ev(`return (document.querySelector('.icu-subnav .icu-seg.on')||{}).textContent||"";`);
  await clickWs("documents"); await clickWs("more"); await clickWs("monitoring");
  const seg2 = await ev(`return (document.querySelector('.icu-subnav .icu-seg.on')||{}).textContent||"";`);
  ok(seg1 === "Trends" && seg2 === "Trends", "active member (Trends) persists across Documents→More→Monitoring round-trip");

  // 5) selected patient preserved throughout
  ok(await ev(`return ICU.state().patient.name;`) === "NAVPT", "selected patient preserved across all workspace switches");

  // 6) Trends surfaced up front: Overview has a one-tap Trends shortcut + it's the first Monitoring sub-tab
  await clickWs("overview");
  const ovTrends = await ev(`var root=document.getElementById('icuRoot'); return !!(root.querySelector('[data-icu-act="tab:trends"]'));`);
  ok(ovTrends === true, "Overview exposes a one-tap 'View trends' shortcut");
  await clickWs("monitoring");
  const monFirst = await ev(`return (document.querySelector('.icu-subnav .icu-seg')||{}).textContent||"";`);
  ok(monFirst === "Trends", "Trends is the first Monitoring sub-tab (was last) — now front (" + monFirst + ")");

  console.log(fails === 0 ? "\nALL GREEN — ICU navigation test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
