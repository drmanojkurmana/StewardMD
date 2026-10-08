/* PrepNucleus Pro client (prep-pro.js) in the REAL app (headless Chrome over CDP) against the fixture bank, with
 * /api/entitlements/* answered by a page-side fetch stub. What must hold: flag OFF never shows the limit sheet even past
 * 50 questions and the home shows only the "PrepNucleus Pro" row; flag ON with 50 used stops a new set outside the open
 * modules with the limit sheet (focus inside, Escape closes), while an open module and a set started at 49 (finished
 * past 50, never stopped mid-set) run; the pricing screen shows the launch price from the quote (percent, strike of the
 * list price only, real date), the renewal, "Cancel anytime", the 7-day refund line and link, and no countdown; after
 * the launch date the quote's list price shows with no strike or launch line; the win-back card shows the real expiry on
 * home and dismissing it calls the endpoint and removes it; a store subscriber gets the manage link, a one-time buyer the no-auto-renewal line, and Request refund posts to support.
 *
 * USAGE: node test/run-prep-pro-ui.mjs   (CHROME=<path>; SHOTS=<dir>, default /tmp/prep-social-shots)
 */
import { freePort } from "./free-port.mjs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-pro-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "/tmp/prep-social-shots";
const FIX = "/test/fixtures/prep/";
fs.mkdirSync(SHOTS, { recursive: true });

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

// Page-side stub for /api/entitlements*: window.__ent decides the answers; window.__calls records them.
const STUB = `(function(){
  window.__calls = []; window.__ent = { pro: null, quote: null, offer: null };
  var f0 = window.fetch;
  window.fetch = function (u, o) {
    var url = String(u && u.url || u), m = (o && o.method) || "GET";
    if (url.indexOf("/api/support") >= 0) { window.__calls.push(m + " support " + ((o && o.body) || "")); return Promise.resolve(new Response("{\\"ok\\":true}", { status: 200, headers: { "Content-Type": "application/json" } })); }
    if (url.indexOf("/api/entitlements") < 0) return f0.apply(this, arguments);
    var p = url.split("/api/entitlements")[1] || "", E = window.__ent, code = 200, body;
    window.__calls.push(m + " " + p);
    if (p === "") body = { prepPro: E.pro || { active: false } };
    else if (/^\\/prep-quote/.test(p)) { if (E.quote) body = E.quote; else { code = 404; body = {}; } }
    else if (p === "/prep-offer") body = { offer: E.offer };
    else if (p === "/prep-offer/dismiss") { E.offer = null; body = { ok: true }; }
    else if (p === "/prep-referral") body = { ok: true };
    else { code = 404; body = {}; }
    return Promise.resolve(new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } }));
  };
})();`;
const SIGN_IN = `window.SMD_AUTH={currentUser:{uid:"u1",getIdToken:function(){return Promise.resolve("tok");},getIdTokenResult:function(){return Promise.resolve({claims:{}});}}}; return 1;`;

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: finite animations (entrances, ring draw) are finished first; loops keep running.
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const key = (k) => ev(`var t=document.activeElement||document.body; t.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true})); return 1;`);
const shot = async (name) => {
  for (const mode of ["dark", "light"]) {
    await ev(`document.body.classList.toggle("dark", ${mode === "dark"}); return 1;`); await sleep(150);
    const r = await shotCall({ format: "png", captureBeyondViewport: false });
    if (r.result) fs.writeFileSync(join(SHOTS, `pro-${mode}-${name}.png`), Buffer.from(r.result.data, "base64"));
  }
};
const text = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const sheetOpen = () => ev(`return !!document.getElementById("ppSheet");`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|PrepPro/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; ${STUB}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{["smd_prep_v1","smd_prep_pro_day","smd_prep_pro_enforce","smd_prep_pro"].forEach(function(k){localStorage.removeItem(k);});}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await sleep(300);

  const DAY = `(function(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})()`;
  const setUsed = (n) => ev(`localStorage.setItem("smd_prep_pro_day", JSON.stringify({d:${DAY},questions:${n},cards:0,lessons:{}})); return 1;`);
  const used = () => ev(`return JSON.parse(localStorage.getItem("smd_prep_pro_day")||"{}").questions;`);
  const openHome = async () => { await ev(`PREP.close(); PREP.open(); return 1;`); return until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy] small") && /MCQs/.test(document.querySelector("#smdPrep .pn-tile[data-s=anatomy] small").textContent);`, 20000); };
  const startModule = async (mid) => {
    await openHome(); await click("#smdPrep .pn-tile[data-s=anatomy]");
    await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m="${mid}"]');`); await click(`#smdPrep .pn-mod[data-m="${mid}"]`);
    await until(`return !!document.querySelector("#smdPrep [data-act=start][data-k=study]");`); await click("#smdPrep [data-act=start][data-k=study]");
    await until(`return !!document.querySelector("#smdPrep .pn-opt") || !!document.getElementById("ppSheet");`, 8000);
  };

  ok(await openHome(), "PrepNucleus opens with the fixture bank");
  ok(await ev(`return !!window.PrepPro && PrepPro.status().enforce === false;`) === true, "PrepPro loaded, enforcement OFF by default");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=pro-open]") && !document.querySelector("#smdPrep .pp-offer");`) === true, "flag off: home shows the PrepNucleus Pro row and nothing else");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=soc-open]") || typeof PrepSocial === "object";`) === true, "social rows only when prep-social.js loaded");

  // ---- flag OFF: past the cap, no sheet
  await setUsed(80);
  await startModule("ana-brachial-plexus");
  ok(!(await sheetOpen()) && await ev(`return !!document.querySelector("#smdPrep .pn-opt");`) === true, "flag off with 80 used: the set starts, no limit sheet" + (process.env.DEBUG ? " | " + (await text()).slice(0, 300) : ""));

  // ---- flag ON
  await ev(`localStorage.setItem("smd_prep_pro_enforce","1"); return 1;`);
  await setUsed(50);
  await startModule("ana-brachial-plexus");
  ok(await sheetOpen(), "flag on, 50 used: a set outside the open modules shows the limit sheet");
  const st = await text();
  ok(/50 of 50/.test(st) && /daily sprint/.test(st) && /midnight/.test(st) && /See Pro/.test(st) && /Close/.test(st), "sheet: used today, what stays free, reset time, See Pro and Close");
  ok(await ev(`return document.getElementById("ppSheet").contains(document.activeElement);`) === true, "focus moves into the sheet");
  ok(!/\u2014/.test(st), "no em-dash in the sheet");
  await shot("limit");
  await key("Tab"); await key("Tab"); await key("Tab");
  ok(await ev(`return document.getElementById("ppSheet").contains(document.activeElement);`) === true, "Tab stays inside the sheet");
  await key("Escape");
  ok(!(await sheetOpen()) && await ev(`return !!document.getElementById("smdPrep");`) === true, "Escape closes the sheet and leaves PrepNucleus open");

  await startModule("ana-gametogenesis");
  ok(!(await sheetOpen()) && await ev(`return !!document.querySelector("#smdPrep .pn-opt");`) === true, "an open module (first 2 of the subject) still runs at the cap");

  await setUsed(49);
  await startModule("ana-brachial-plexus");
  ok(!(await sheetOpen()), "49 used: the set starts");
  let answered = 0;
  for (let i = 0; i < 3; i++) {
    await click("#smdPrep .pn-opt[data-k='0']"); answered++;
    await until(`return !!document.querySelector("#smdPrep [data-act=next]");`, 3000);
    if (await sheetOpen()) break;
    await click("#smdPrep [data-act=next]"); await sleep(150);
  }
  ok(answered === 3 && !(await sheetOpen()) && await until(`return /Set finished/.test(document.getElementById("smdPrep").innerText);`, 3000), "never mid-set: all 3 answered and finished with no sheet");
  ok(await used() === 52, "the answers past 50 were counted (52)");

  // ---- pricing: launch quote
  const LAUNCH_END = new Date(2027, 2, 31, 23, 59).getTime();
  await ev(SIGN_IN);
  await ev(`window.__ent.quote={plan:"year",productId:"prep_pro_year",listPaise:599900,firstYearPaise:149900,renewalPaise:599900,priceReason:"launch",offPct:75,saveRupees:4500,studentVerified:false,studentPaise:479920,storeFirstYearPaise:149900,firstYear:true,referralCreditDays:30,launchEndsAt:${LAUNCH_END}}; return 1;`);
  await openHome(); await click("#smdPrep [data-act=pro-open]");
  ok(await until(`return /Launch price/.test((document.getElementById("ppPricing")||{}).innerText||"");`, 5000), "pricing opens with the quote");
  const pt = await text();
  ok(/Rs 1,499/.test(pt) && /Launch price until 31 Mar 2027/.test(pt) && /75% off Rs 5,999, then Rs 5,999\/year/.test(pt), "launch price, real date, quote percent and renewal");
  ok(await ev(`var s=document.querySelectorAll("#ppPricing s"); return s.length===1 && s[0].textContent==="Rs 5,999";`) === true, "the only strikethrough is the list price");
  ok(/Cancel anytime: no auto-renewal/.test(pt) && /7-day full refund/.test(pt) && !!(await ev(`return !!document.querySelector("#ppPricing [data-act=pro-refund]");`)), "Cancel anytime, 7-day refund line and Request refund");
  ok(/Free/.test(pt) && /No limit/.test(pt) && /StewardMD ID/.test(pt) && !/verify your college ID/.test(pt), "comparison, referral field; no student line while launch (Rs 1,499) beats student (Rs 4,799)");
  ok(!/\d+:\d\d:\d\d/.test(pt) && await ev(`return !document.querySelector("#ppPricing [role=timer], #ppPricing .pn-cd");`) === true, "no countdown");
  ok(!/\u2014/.test(pt) && !/3 months/.test(pt), "no em-dash, no 3-month plan");
  const short = await ev(`return Array.from(document.querySelectorAll("#ppPricing button")).filter(function(b){var h=b.offsetHeight;return h>0&&h<44;}).map(function(b){return b.getAttribute("data-act")+":"+b.offsetHeight;}).join(",");`);
  ok(short === "", "every pricing button is at least 44px tall" + (short ? ": " + short : ""));
  await shot("pricing");
  await ev(`window.SMD_PRO={buy:function(b){window.__buy=b;}}; return 1;`); await click("#ppPricing [data-act=pro-buy]");
  ok(await ev(`return JSON.stringify(window.__buy);`) === '{"productId":"prep_pro_year","prepPlan":"year"}', "Razorpay checkout sends the product and plan only, never a price");

  // ---- after the launch date: list price
  await ev(`window.__ent.quote={plan:"year",productId:"prep_pro_year",listPaise:599900,firstYearPaise:599900,renewalPaise:599900,priceReason:"base",studentVerified:false,studentPaise:479920}; return 1;`);
  await click("#smdPrep [data-act=back]"); await click("#smdPrep [data-act=pro-open]");
  await until(`return /Rs 5,999/.test((document.getElementById("ppPricing")||{}).innerText||"");`, 5000); await sleep(300);
  const lt = await text();
  ok(/Rs 5,999/.test(lt) && !/Launch price/.test(lt) && !/% off/.test(lt) && await ev(`return !document.querySelector("#ppPricing s");`) === true, "after launch: list price, no strike, no launch line");
  ok(/verify your college ID/.test(lt), "after launch: student (Rs 4,799) beats list, so the verify line shows");

  // ---- iOS store path with a win-back quote: the store's price only, no offer fetch, store cancel link
  await ev(`window.SMD_IAP={isIOS:function(){return true;},available:function(){return true;}}; window.__calls.length=0; window.__ent.offer={kind:"winback",finalPaise:99900,listPaise:599900,basePaise:149900,saveRupees:500,expiresAt:Date.now()+864e5,productId:"prep_pro_year"}; window.__ent.quote={plan:"year",productId:"prep_pro_year",listPaise:599900,firstYearPaise:99900,storeFirstYearPaise:149900,renewalPaise:599900,priceReason:"winback",offPct:83,firstYear:true,studentVerified:false,studentPaise:479920,launchEndsAt:${LAUNCH_END}}; return 1;`);
  await click("#smdPrep [data-act=back]"); await click("#smdPrep [data-act=pro-open]");
  await until(`return /Rs 1,499/.test((document.getElementById("ppPricing")||{}).innerText||"");`, 5000); await sleep(400);
  const it = await text();
  ok(/Rs 1,499/.test(it) && /Launch price until 31 Mar 2027/.test(it) && !/Rs 999/.test(it) && !/83%/.test(it) && !/website|stewardmd\.in/i.test(it) && !/verify your college ID/.test(it), "iOS: store price (launch intro), no win-back or student price, no web steering");
  ok(await ev(`return !document.querySelector("#smdPrep .pp-offer") && window.__calls.indexOf("GET /prep-offer")<0;`) === true, "iOS: no win-back card and the offer window is never started");
  ok(await ev(`var a=document.querySelector("#ppPricing a.pp-cancel"); return !!a && a.href==="https://apps.apple.com/account/subscriptions" && a.offsetHeight>=44;`) === true, "iOS: Cancel anytime links to App Store subscriptions (44px)");
  await shot("pricing-ios");
  await ev(`delete window.SMD_IAP; window.__ent.quote=null; return 1;`);

  // ---- win-back card on home
  const EXP = new Date(2026, 9, 8, 16, 30).getTime();
  await ev(`window.__ent.offer={kind:"winback",finalPaise:99900,listPaise:599900,basePaise:599900,offPct:83,saveRupees:5000,expiresAt:${EXP},productId:"prep_pro_year_wb"}; return 1;`);
  await openHome();
  ok(await until(`return !!document.querySelector("#smdPrep .pp-offer");`, 5000), "win-back card shows on home");
  const ot = await ev(`return document.querySelector("#smdPrep .pp-offer").innerText;`);
  ok(/Rs 999/.test(ot) && /first year/.test(ot) && /Then Rs 5,999 a year\. One time offer, valid until Thu 8 Oct, 4:30 pm\./.test(ot) && /83% off/.test(ot) && /Save Rs 5,000/.test(ot) && /Cancel anytime: no auto-renewal/.test(ot), "offer: price, real static expiry, quote percent, saving, Cancel anytime");
  await ev(`document.querySelector("#smdPrep .pp-offer").scrollIntoView({block:"center"}); return 1;`); await sleep(150);
  await shot("offer");
  await click("#smdPrep [data-act=pro-odismiss]"); await sleep(200);
  ok(await ev(`return !document.querySelector("#smdPrep .pp-offer") && window.__calls.indexOf("POST /prep-offer/dismiss")>=0;`) === true, "dismiss calls the endpoint and removes the card");
  await openHome(); await sleep(500);
  ok(await ev(`return !document.querySelector("#smdPrep .pp-offer");`) === true, "dismissed offer does not return");

  // ---- refund request goes to the in-app support desk
  await click("#smdPrep [data-act=pro-open]");
  await until(`return !!document.querySelector("#ppPricing [data-act=pro-refund]");`, 5000);
  await click("#ppPricing [data-act=pro-refund]");
  ok(await until(`return window.__calls.some(function(c){return /^POST support .*Refund request \\(PrepNucleus\\)/.test(c);});`, 5000), "Request refund posts a support request");
  await click("#smdPrep [data-act=back]");

  // ---- Pro on a store subscription: manage or cancel link
  const UNTIL = new Date(2027, 9, 6).getTime();
  await ev(`window.__ent.pro={active:true,until:${UNTIL},source:"apple",autoRenews:true,manageUrl:"https://apps.apple.com/account/subscriptions"}; window.open=function(u){window.__opened=u;}; return 1;`);
  await click("#smdPrep [data-act=pro-open]");
  ok(await until(`return !!document.querySelector("#ppPricing [data-act=pro-manage]");`, 5000), "Pro (store, renewing): Manage or cancel subscription shows");
  ok(await ev(`return !document.querySelector("#ppPricing [data-act=pro-buy]") && /active until 6 Oct 2027/.test(document.getElementById("ppPricing").innerText);`) === true, "Pro: active until date, no buy button");
  await sleep(3500); await shot("manage");
  await click("#ppPricing [data-act=pro-manage]");
  ok(await ev(`return window.__opened;`) === "https://apps.apple.com/account/subscriptions", "manage opens the store's manageUrl");
  ok(await ev(`return PrepPro.can("questions",{items:[{_m:"ana-brachial-plexus",_s:"anatomy"}]});`) === true, "Pro unlocks the capped module");

  // ---- one-time purchase: truthful line
  await ev(`window.__ent.pro={active:true,until:${UNTIL},source:"razorpay",autoRenews:false}; return 1;`);
  await click("#smdPrep [data-act=back]"); await click("#smdPrep [data-act=pro-open]");
  ok(await until(`return /no auto-renewal, you choose whether to renew/.test((document.getElementById("ppPricing")||{}).innerText||"");`, 5000), "one-time purchase: truthful no-auto-renewal line");
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
