/* PrepNucleus on the phone (prep-native.js) in the REAL app (headless Chrome over CDP), against the fixture bank, with
 * Capacitor's LocalNotifications and PrepWidgets and window.PREP_SYNC mocked.
 * What must hold: the plan settings sheet shows "Sync progress across devices" off by default; signed out it is disabled
 * and says "Sign in to sync"; turning it on calls PREP_SYNC.enable(); Sync now calls sync("manual"); turning it off offers
 * keeping or deleting the server copy and passes { wipe }; opening PrepNucleus syncs when sync is on. The reminder switch
 * (Smart nudges by default, test/run-prep-nudges.mjs; "Daily reminder only" here)
 * asks for notification permission only when tapped, then schedules one notification (stable id, next 07:30, the plan's
 * count, route prep) and cancels it when turned off; a denied permission shows the state inline and keeps the time. The
 * widget gets the snapshot JSON; starting a plan item starts the Live Activity. stewardmd://prep opens PrepNucleus.
 *
 * USAGE: node test/run-prep-native.mjs   (SHOTS=<dir> saves the settings sheet light and dark; CHROME=, PORT=, CHROME_PORT=)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-native-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")||"{}"); return ${expr};`);
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(400); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) fs.writeFileSync(join(process.env.SHOTS, "native-" + name + ".png"), Buffer.from(r.result.data, "base64")); };
// The fixture has no lessons: the lesson index is stubbed with one fixture module, so the plan can offer it.

const MOCKS = `(function(){
  var L = window.__pn = { ln: [], w: [], sync: [], perm: "prompt", denyNext: false, active: false, st: { on: false, signedIn: false, at: null, err: null, busy: false }, fns: [] };
  function rec(arr, m){ return function(a){ arr.push([m, a === undefined ? null : JSON.parse(JSON.stringify(a))]); return Promise.resolve(); }; }
  window.Capacitor = { isNativePlatform: function(){ return true; }, platform: "ios", Plugins: {
    LocalNotifications: { checkPermissions: function(){ L.ln.push(["checkPermissions"]); return Promise.resolve({ display: L.perm }); },
      requestPermissions: function(){ L.ln.push(["requestPermissions"]); L.perm = L.denyNext ? "denied" : "granted"; return Promise.resolve({ display: L.perm }); },
      schedule: rec(L.ln, "schedule"), cancel: rec(L.ln, "cancel"), addListener: function(){ return Promise.resolve({ remove: function(){} }); } },
    PrepWidgets: { setData: rec(L.w, "setData"), activityStatus: function(){ return Promise.resolve({ supported: true, enabled: true, active: L.active }); },
      startActivity: function(a){ L.active = true; return rec(L.w, "startActivity")(a); }, updateActivity: rec(L.w, "updateActivity"), endActivity: function(a){ L.active = false; return rec(L.w, "endActivity")(a); } } } };
  var S = { status: function(){ return Object.assign({}, L.st); }, onChange: function(f){ L.fns.push(f); },
    enable: function(){ L.sync.push(["enable"]); L.st.on = true; L.st.at = Date.now(); L.fns.forEach(function(f){ f(); }); return Promise.resolve(); },
    disable: function(o){ L.sync.push(["disable", o]); L.st.on = false; L.fns.forEach(function(f){ f(); }); return Promise.resolve(); },
    sync: function(r){ L.sync.push(["sync", r]); L.st.at = Date.now(); L.fns.forEach(function(f){ f(); }); return Promise.resolve({ ok: true, changed: false }); } };
  // prep-sync.js, if it exists, must not replace the mock.
  Object.defineProperty(window, "PREP_SYNC", { configurable: true, get: function(){ return S; }, set: function(){} });
  return 1; })()`;
const P = (e) => ev(`var L=window.__pn; return ${e};`);
const isoNow = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const sheetOpen = async () => { await ev(`var s=document.getElementById("pnPlanSheet"); if(s) PREP.back(); return 1;`); await click("#smdPrep [data-act=p-settings]"); return until(`return !!document.querySelector("#pnPlanSheet #plSync");`, 3000); };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;};` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_rem"); localStorage.removeItem("smd_prep_la"); localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, exam: "neet-pg", pl: { ob: 1, exam: "neet-pg", date: null, min: 30, rem: "07:30" } })); indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  ok(await ev("return " + MOCKS) === 1, "mocks installed");

  // ---- open: widget feed, no permission prompt, no reminder while it is off
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-list .pl-item");`, 20000), "home shows today's plan");
  ok(await until(`return window.__pn.w.some(function(c){return c[0]==="setData";});`, 4000), "the widget gets data after home mounts");
  const wd = JSON.parse(await P(`JSON.stringify(JSON.parse(L.w.filter(function(c){return c[0]==="setData";}).pop()[1].data))`));
  const items = await ev(`return Array.from(document.querySelectorAll("#smdPrep .pl-list .pl-item b")).map(function(b){return b.textContent;});`);
  ok(wd.v === 1 && wd.exam === "NEET-PG" && wd.done === 0 && wd.total === items.length && wd.next === items[0] && wd.day === isoNow() && typeof wd.score === "number" && wd.daysLeft === null && typeof wd.updated === "number", "widget JSON: " + JSON.stringify(wd));
  ok(await P(`L.ln.filter(function(c){return c[0]==="requestPermissions"||c[0]==="schedule";}).length`) === 0, "no permission prompt and no reminder at open");
  ok(await P(`L.sync.length`) === 0, "sync off: opening does not sync");

  // ---- sync: off by default, signed out disabled
  ok(await sheetOpen(), "the plan settings sheet has the sync section");
  ok(await ev(`var b=document.querySelector("#plSync [data-act=p-n-sync]"); return b.getAttribute("role")+"|"+b.getAttribute("aria-checked")+"|"+b.disabled;`) === "switch|false|true", "the sync switch is off and disabled when signed out");
  ok(/Sign in to sync/.test(await text("#plSyncSt")), "signed out says Sign in to sync");
  ok(/encrypted on this phone before upload/.test(await text("#plSync")) && /cannot read it without your account/.test(await text("#plSync")), "the privacy line");
  await click("#plSync [data-act=p-n-sync]");
  ok(await P(`L.sync.length`) === 0, "a disabled switch does nothing");
  await shot("sheet-signed-out-dark");

  // ---- signed in: enable, sync now, off with the wipe choice
  await P(`(L.st.signedIn = true, 1)`); ok(await sheetOpen(), "sheet reopens");
  ok(await ev(`return document.querySelector("#plSync [data-act=p-n-sync]").disabled;`) === false && /Off\. Progress stays on this phone/.test(await text("#plSyncSt")), "signed in: enabled and off");
  await click("#plSync [data-act=p-n-sync]");
  ok(await until(`return document.querySelector("#plSync [data-act=p-n-sync]").getAttribute("aria-checked")==="true";`, 3000) && await P(`JSON.stringify(L.sync)`) === '[["enable"]]', "turning it on calls enable()");
  ok(/Last synced just now/.test(await text("#plSyncSt")), "status: Last synced just now");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-act");`) === "p-n-sync", "focus stays on the switch");
  await click("#plSync [data-act=p-n-now]");
  ok(await until(`return window.__pn.sync.some(function(c){return c[0]==="sync"&&c[1]==="manual";});`, 3000), "Sync now calls sync('manual')");
  ok(await until(`return !!document.querySelector("#plSync [data-act=p-n-now]");`, 2000), "Sync now is back after the sync");
  await ev(`document.querySelector("#pnPlanSheet .pl-sheet").scrollTop = 1e6; return 1;`);
  await shot("sheet-sync-on-dark");
  await click("#plSync [data-act=p-n-sync]");
  ok(await until(`return document.querySelectorAll("#plSync .pl-conf [data-act=p-n-off]").length===2;`, 2000), "turning off offers two choices");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-act");`) === "p-n-off", "focus moves to the first choice");
  ok(await P(`L.sync.filter(function(c){return c[0]==="disable";}).length`) === 0, "nothing is turned off before a choice");
  await ev(`document.querySelector("#pnPlanSheet .pl-sheet").scrollTop = 1e6; return 1;`);
  await shot("sheet-sync-off-choice-dark");
  await click('#plSync [data-act=p-n-off][data-v="1"]');
  ok(await until(`return window.__pn.sync.some(function(c){return c[0]==="disable";});`, 2000) && await P(`JSON.stringify(L.sync.filter(function(c){return c[0]==="disable";})[0][1])`) === '{"wipe":true}', "delete passes { wipe: true }");
  ok(await ev(`return document.querySelector("#plSync [data-act=p-n-sync]").getAttribute("aria-checked");`) === "false", "the switch is off again");
  await click("#plSync [data-act=p-n-sync]"); await until(`return document.querySelector("#plSync [data-act=p-n-sync]").getAttribute("aria-checked")==="true";`, 2000);
  await click("#plSync [data-act=p-n-sync]"); await click("#plSync [data-act=p-n-offx]");
  ok(await ev(`return document.querySelector("#plSync [data-act=p-n-sync]").getAttribute("aria-checked");`) === "true" && await P(`L.sync.filter(function(c){return c[0]==="disable";}).length`) === 1, "Keep sync on cancels");
  await click("#plSync [data-act=p-n-sync]"); await click('#plSync [data-act=p-n-off][data-v="0"]');
  ok(await until(`return window.__pn.sync.filter(function(c){return c[0]==="disable";}).length===2;`, 2000) && await P(`JSON.stringify(L.sync.filter(function(c){return c[0]==="disable";})[1][1])`) === '{"wipe":false}', "keep passes { wipe: false }");

  // ---- reminder: permission only on the switch, schedule, cancel
  ok(await ev(`var b=document.querySelector("#pnPlanSheet [data-act=p-n-rem]"); return !!b && b.getAttribute("role")==="switch" && b.getAttribute("aria-checked")==="false" && !b.disabled;`) === true, "the reminder switch is off");
  ok(!/later app update/.test(await text("#pnPlanSheet")), "the later-update note is gone");
  ok(await P(`L.ln.filter(function(c){return c[0]==="requestPermissions";}).length`) === 0, "no permission asked before the tap");
  await click("#pnPlanSheet [data-act=p-n-rem]");
  ok(await until(`return window.__pn.ln.some(function(c){return c[0]==="schedule";});`, 3000), "turning it on schedules a reminder");
  ok(await P(`L.ln.findIndex(function(c){return c[0]==="requestPermissions";}) >= 0`) === true, "permission asked on the tap");
  // Smart nudges are the default: a set in the nudge id range, no single daily reminder.
  const sm = JSON.parse(await P(`JSON.stringify(L.ln.filter(function(c){return c[0]==="schedule";}).pop()[1].notifications)`));
  ok(sm.length >= 1 && sm.every((n) => n.id >= 2147483001 && n.id < 2147483061 && n.extra.route === "prep" && n.title && n.body), "smart by default: " + sm.length + " nudges, first: " + JSON.stringify(sm[0]));
  ok(await ev(`var b=document.querySelector('#pnPlanSheet [data-act=p-n-mode][data-v=smart]'); return !!b && b.getAttribute("aria-checked")==="true";`) === true && /Smart nudges, at most 2 a day/.test(await text("#pnPlanSheet [data-act=p-n-rem]")), "Smart nudges is checked and named on the switch");
  await click('#pnPlanSheet [data-act=p-n-mode][data-v=daily]');
  ok(await until(`return window.__pn.ln.some(function(c){return c[0]==="schedule"&&c[1].notifications[0].id===2147483100;});`, 3000), "Daily reminder only schedules the single reminder");
  ok(await P(`(function(){var i=L.ln.findIndex(function(c){return c[0]==="schedule"&&c[1].notifications[0].id===2147483100;}); return L.ln.slice(0,i).some(function(c){return c[0]==="cancel"&&c[1].notifications.length===60&&c[1].notifications[0].id===2147483001;});})()`) === true, "the nudges are cancelled before");
  const sc = JSON.parse(await P(`JSON.stringify(L.ln.filter(function(c){return c[0]==="schedule";}).pop()[1].notifications[0])`));
  const want = (() => { const n = new Date(), d = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 7, 30); if (d <= n) d.setDate(d.getDate() + 1); return d.getTime(); })();
  const nPlan = items.length, body = new Date(want).getDate() === new Date().getDate() && nPlan ? "Today's plan: " + nPlan + (nPlan === 1 ? " item" : " items") : "Today's plan is ready";
  ok(sc.id === 2147483100 && sc.title === "PrepNucleus" && sc.body === body && new Date(sc.schedule.at).getTime() === want && sc.extra.route === "prep", "schedule: " + JSON.stringify(sc));
  ok(await P(`(function(){var i=L.ln.findIndex(function(c){return c[0]==="schedule";}); return L.ln.slice(0,i).some(function(c){return c[0]==="cancel"&&c[1].notifications[0].id===2147483100;});})()`) === true, "the previous reminder is cancelled first");
  ok(await ev(`return document.querySelector("#pnPlanSheet [data-act=p-n-rem]").getAttribute("aria-checked");`) === "true" && /Every day at 07:30/.test(await text("#pnPlanSheet [data-act=p-n-rem]")), "the switch is on and names the time");
  await ev(`document.querySelector("#pnPlanSheet .pl-sheet").scrollTop = 0; document.querySelector("#pnPlanSheet [data-act=p-n-rem]").scrollIntoView({block:"center"}); return 1;`);
  await shot("sheet-reminder-on-dark");
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await shot("sheet-reminder-on-light");
  await ev(`document.querySelector("#pnPlanSheet .pl-sheet").scrollTop = 1e6; return 1;`);
  await shot("sheet-sync-light");
  await ev(`document.body.classList.add("dark"); return 1;`);
  const nc = await P(`L.ln.filter(function(c){return c[0]==="cancel";}).length`);
  await click("#pnPlanSheet [data-act=p-n-rem]");
  ok(await until(`return window.__pn.ln.filter(function(c){return c[0]==="cancel";}).length > ${nc};`, 2000) && await ev(`return localStorage.getItem("smd_prep_rem");`) === null, "turning it off cancels the reminder");

  // ---- denied: inline state, time kept
  await P(`(L.perm = "prompt", L.denyNext = true, 1)`);
  const ns = await P(`L.ln.filter(function(c){return c[0]==="schedule";}).length`);
  await click("#pnPlanSheet [data-act=p-n-rem]");
  ok(await until(`return /Notifications are off for StewardMD in Settings/.test((document.querySelector("#pnPlanSheet .pl-warn")||{}).textContent||"");`, 3000), "denied: the state is shown inline");
  ok(await P(`L.ln.filter(function(c){return c[0]==="schedule";}).length`) === ns && await store(`s.pl.rem`) === "07:30", "denied: nothing scheduled, the time is kept");
  await shot("sheet-reminder-denied-dark");
  ok(!/[—–]/.test(await text("#pnPlanSheet")), "no dashes in the sheet");
  await ev(`PREP.back(); return 1;`);

  // ---- Live Activity: starting a plan item starts it
  await click("#smdPrep .pl-list .pl-item[data-act=p-go]");
  ok(await until(`return window.__pn.w.some(function(c){return c[0]==="startActivity";});`, 4000), "starting a plan item starts the Live Activity");
  const la = JSON.parse(await P(`L.w.filter(function(c){return c[0]==="startActivity";})[0][1].data`));
  ok(la.v === 1 && la.total === items.length && await ev(`return localStorage.getItem("smd_prep_la");`) === isoNow(), "the activity carries the snapshot and its day");
  // an activity from yesterday ends on open
  await ev(`PREP.close(); localStorage.setItem("smd_prep_la","2020-01-01"); PREP.open(); return 1;`);
  ok(await until(`return window.__pn.w.some(function(c){return c[0]==="endActivity";});`, 5000), "yesterday's activity ends on open");

  // ---- sync on: opening syncs; finished set syncs
  await P(`(L.st.on = true, L.sync.length = 0, 1)`);
  await ev(`PREP.close(); PREP.open(); return 1;`);
  ok(await until(`return window.__pn.sync.some(function(c){return c[0]==="sync"&&c[1]==="open";});`, 3000), "opening PrepNucleus syncs when sync is on");

  // ---- deep link
  await ev(`PREP.close(); return 1;`);
  await ev(`window.SMD_openRoute("prep"); return 1;`);
  ok(await until(`return PREP.isOpen();`, 5000), "stewardmd://prep opens PrepNucleus");
  await ev(`PREP.close(); return 1;`);

  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
