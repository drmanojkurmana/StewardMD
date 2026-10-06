/* PrepNucleus smart nudges (prep-nudges.js through prep-native.js) in the REAL app (headless Chrome over CDP), against
 * the fixture bank, with Capacitor's LocalNotifications mocked. What must hold: with reminders on and Smart (the
 * default), opening PrepNucleus schedules nudges in the stable id range (at most 2 a local day, 4 h apart, none in quiet
 * hours, no dash, no claim about friends); tomorrow's main nudge says the real due count at the learned study time; the
 * settings sheet shows the mode, the learned time and quiet hours; new quiet hours move the nudges; "Daily reminder only"
 * and turning reminders off cancel every nudge; an Arena player's phone registers its push token with the quiet hours;
 * a nudge tap's options open the exact screen (a subject, the reviews, the plan), also when PrepNucleus is already open.
 *
 * USAGE: CHROME=<path> node test/run-prep-nudges.mjs   (SHOTS=<dir> saves the settings sheet light and dark; PORT=, CHROME_PORT=)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-nudges-chrome-" + PORT + "-" + Date.now();
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
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(400); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) fs.writeFileSync(join(process.env.SHOTS, "nudges-" + name + ".png"), Buffer.from(r.result.data, "base64")); };
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

const sheet = async () => { await ev(`var s=document.getElementById("pnPlanSheet"); if(s) PREP.back(); return 1;`); await click("#smdPrep [data-act=p-settings]"); return until(`return !!document.querySelector("#pnPlanSheet [data-act=p-n-rem]");`, 3000); };
const lastSet = async () => JSON.parse(await P(`JSON.stringify((L.ln.filter(function(c){return c[0]==="schedule";}).pop()||[0,{notifications:[]}])[1].notifications)`));
const ndg = (e) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_ndg")||"{}"); return ${e};`);
const inQuiet = (ms, a, b) => { const d = new Date(ms), m = d.getHours() * 60 + d.getMinutes(); return a < b ? m >= a && m < b : m >= a || m < b; };
function checkSet(list, qa, qb, label) {
  const by = {};
  list.forEach((n) => { const d = new Date(n.schedule.at); const k = d.toDateString(); (by[k] = by[k] || []).push(d.getTime()); });
  ok(Object.values(by).every((ts) => ts.length <= 2 && ts.sort((a, b) => a - b).every((t, i) => !i || t - ts[i - 1] >= 4 * 3600e3)), label + ": at most 2 a day, 4 h apart");
  ok(list.every((n) => !inQuiet(new Date(n.schedule.at).getTime(), qa, qb)), label + ": none in quiet hours");
  ok(list.every((n) => n.id >= 2147483001 && n.id < 2147483061 && n.extra && n.extra.route === "prep" && typeof n.extra.prep === "object"), label + ": stable ids, route prep with options");
  ok(list.every((n) => !/[—–]|undefined|null|\{|friend/i.test(n.title + " " + n.body)), label + ": no dash, no unfilled variable, no claim about friends");
  ok(list.every((n) => new Date(n.schedule.at).getTime() > Date.now()), label + ": all in the future");
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_ONBOARD=false; window.confirm=function(){return true;};` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  // 25 questions due, 4 study days before today (a real 4 day streak, not studied today), 6 sessions around 9 pm.
  await ev(`localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_rem","1"); localStorage.removeItem("smd_prep_ndg_mode"); localStorage.setItem("smd_prep_arena_in","1");
    var now=Date.now(), off=new Date().getTimezoneOffset(), today=Math.floor((now - off*60000)/864e5), cards={}, days={};
    for (var i=0;i<25;i++) cards["p:ana-placenta:q"+i]=[5,3,today-6,today-2,2,0];
    for (var d=1; d<=4; d++) days[today-d]=6;
    var ses=[]; for (var k=1;k<=6;k++){ var x=new Date(now - k*864e5); x.setHours(21,5,0,0); ses.push(x.getTime()); }
    localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, exam: "neet-pg", cards: cards, days: days, mod: { "ana-placenta": { t: 60, ok: 40 } }, pl: { ob: 1, exam: "neet-pg", date: null, min: 30, rem: "19:00" } }));
    localStorage.setItem("smd_prep_ndg", JSON.stringify({ ses: ses })); indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  ok(await ev("return " + MOCKS) === 1, "mocks installed");
  await P(`(L.perm = "granted", L.api = [], 1)`);
  await ev(`window.SMD_nativePushToken = function(){ return "apns-token-0123456789"; }; return 1;`);

  // ---- open: Smart nudges scheduled
  await ev(`PREP_LOADER.load().then(function(){ if (window.PrepSocial) PrepSocial.api = function(m,p,b){ window.__pn.api.push([m,p,b]); return Promise.resolve({ ok: true }); }; window.__ld = 1; }); return 1;`);
  ok(await until(`return window.__ld === 1;`, 20000), "PrepNucleus files load");
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-list .pl-item");`, 20000), "home shows today's plan");
  ok(await until(`return window.__pn.ln.some(function(c){return c[0]==="schedule"&&c[1].notifications[0].id>=2147483001&&c[1].notifications[0].id<2147483061;});`, 5000), "opening schedules nudges");
  ok(await P(`L.ln.filter(function(c){return c[0]==="requestPermissions";}).length`) === 0, "no permission prompt on open");
  ok(await P(`L.ln.filter(function(c){return c[0]==="schedule"&&c[1].notifications[0].id===2147483100;}).length`) === 0, "no single daily reminder in Smart mode");
  let set = await lastSet();
  checkSet(set, 22 * 60 + 30, 7 * 60 + 30, "default quiet");
  const plan = JSON.parse(await ndg(`JSON.stringify(s.plan)`));
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const due1 = set.find((n) => new Date(n.schedule.at).toDateString() === tomorrow.toDateString() && /25/.test(n.title + n.body));
  ok(!!due1 && new Date(due1.schedule.at).getHours() === 21 && new Date(due1.schedule.at).getMinutes() === 15, "tomorrow: the real due count (25) at the learned time, 21:15: " + JSON.stringify(due1));
  ok(!!due1 && JSON.stringify(due1.extra.prep) === '{"mode":"plan"}', "the due nudge opens the reviews");
  ok(plan.length === set.length && plan.every((p) => p.k && typeof p.at === "number"), "the plan is remembered for back-off: " + plan.map((p) => p.k).join(","));
  const st = set.find((n) => /streak|day 5/i.test(n.title + n.body));
  ok(!st || /4/.test(st.title + st.body), "a streak nudge, if it fits today, names the real 4 day streak: " + (st ? st.title + " / " + st.body : "none today"));
  await sleep(300);
  const reg = JSON.parse(await P(`JSON.stringify(L.api)`));
  ok(reg.length === 1 && reg[0][0] === "POST" && reg[0][1] === "nudges" && reg[0][2].on === true && reg[0][2].token === "apns-token-0123456789" && reg[0][2].quiet === "22:30-07:30" && typeof reg[0][2].tz === "number", "an Arena player's phone registers for social pushes: " + JSON.stringify(reg));

  // ---- settings: mode, learned time, quiet hours
  ok(await sheet(), "settings sheet opens");
  ok(await ev(`return document.querySelector('#pnPlanSheet [data-act=p-n-mode][data-v=smart]').getAttribute("aria-checked");`) === "true", "Smart nudges is the default");
  ok(/around 9 pm/.test(await text("#pnPlanSheet .pl-when")), "the learned time is shown: " + await text("#pnPlanSheet .pl-when"));
  ok(await ev(`return document.getElementById("plQa").value + "|" + document.getElementById("plQb").value;`) === "22:30|07:30", "quiet hours default 22:30 to 07:30");
  ok(await ev(`return document.querySelector("#pnPlanSheet .pl-quiet legend").textContent;`) === "Quiet hours", "quiet hours are labelled");
  ok(!/[—–]/.test(await text("#pnPlanSheet")), "no dashes in the sheet");
  await ev(`document.querySelector("#pnPlanSheet .pl-quiet").scrollIntoView({block:"end"}); return 1;`);
  await shot("sheet-smart-dark");
  await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); await shot("sheet-smart-light"); await ev(`document.body.classList.add("dark"); return 1;`);
  const n0 = await P(`L.ln.filter(function(c){return c[0]==="schedule";}).length`);
  await ev(`var a=document.getElementById("plQa"), b=document.getElementById("plQb"); a.value="20:00"; b.value="09:00"; b.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  ok(await until(`return window.__pn.ln.filter(function(c){return c[0]==="schedule";}).length > ${n0};`, 3000), "new quiet hours reschedule");
  set = await lastSet();
  checkSet(set, 20 * 60, 9 * 60, "quiet 20:00 to 09:00");
  const due2 = set.find((n) => new Date(n.schedule.at).toDateString() === tomorrow.toDateString() && /25/.test(n.title + n.body));
  ok(!!due2 && new Date(due2.schedule.at).getHours() === 19 && new Date(due2.schedule.at).getMinutes() === 30, "a learned time inside quiet hours moves to 30 min before them: " + (due2 && new Date(due2.schedule.at)));
  ok(await ndg(`s.q`) === "20:00-09:00", "quiet hours kept on this phone");
  await sleep(200);
  ok(await P(`L.api.length`) === 2 && await P(`L.api[1][2].quiet`) === "20:00-09:00", "the server learns the new quiet hours");

  // ---- Daily reminder only, back to Smart, then off
  await click('#pnPlanSheet [data-act=p-n-mode][data-v=daily]');
  ok(await until(`return window.__pn.ln.some(function(c){return c[0]==="schedule"&&c[1].notifications[0].id===2147483100;});`, 3000), "daily: the single reminder");
  ok(await P(`L.ln.some(function(c){return c[0]==="cancel"&&c[1].notifications.length===60;})`) === true && await ndg(`s.plan.length`) === 0, "daily: every nudge cancelled");
  ok(await P(`L.api.some(function(c){return c[1]==="nudges"&&c[2].on===false;})`) === true, "daily: social pushes stop");
  ok(!await ev(`return !!document.getElementById("plQa");`), "daily: no quiet hours to set");
  await click('#pnPlanSheet [data-act=p-n-mode][data-v=smart]');
  ok(await until(`return JSON.parse(localStorage.getItem("smd_prep_ndg")||"{}").plan.length > 0;`, 3000), "back to smart: nudges again");
  const nc = await P(`L.ln.filter(function(c){return c[0]==="cancel"&&c[1].notifications.length===60;}).length`);
  await click("#pnPlanSheet [data-act=p-n-rem]");
  ok(await until(`return window.__pn.ln.filter(function(c){return c[0]==="cancel"&&c[1].notifications.length===60;}).length > ${nc};`, 3000) && await ndg(`s.plan.length`) === 0, "off: every nudge cancelled");
  ok(/Off\. Nothing is sent\./.test(await text("#pnPlanSheet [data-act=p-n-rem]")) && !await ev(`return !!document.querySelector("[data-act=p-n-mode]");`), "off: the switch says so, no mode choice");
  await ev(`PREP.back(); return 1;`);

  // ---- taps open the exact screen, also when PrepNucleus is already open
  ok(await ev(`return PREP.isOpen();`) === true, "PrepNucleus is open");
  await ev(`window.SMD_openRoute("prep", { subject: "anatomy" }); return 1;`);
  ok(await until(`return PREP.isOpen() && PREP._st.sub === "anatomy" && PREP._st.stack.length === 2;`, 8000), "a weak subject nudge opens that subject");
  await ev(`window.SMD_openRoute("prep", { mode: "plan" }); return 1;`);
  ok(await until(`return PREP.isOpen() && PREP._st.stack.length >= 2 && !!PREP._st.run && /Question 1 of/.test(document.getElementById("smdPrep").textContent);`, 8000), "a due nudge opens today's reviews");
  await ev(`PREP.close(); window.SMD_openRoute("prep", {}); return 1;`);
  const okHome = await until(`return PREP.isOpen() && !!document.querySelector("#smdPrep #pnPlanTop");`, 8000);
  ok(okHome, "a plan nudge opens home with the plan" + (okHome ? "" : ": " + await ev(`return PREP.isOpen() + " " + PREP._st.stack.length + " " + (document.getElementById("smdPrep")||{}).textContent;`)));
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
