/* PrepNucleus Play, squads and revenge in the REAL app (headless Chromium over raw CDP), owner 2026-10-30.
 * Every /api/prep/play, /api/prep/social and /api/prep/arena call is MOCKED here; the bank is the fixture bank with a
 * richer anatomy module. What must hold:
 *  - home has a Play section (feed, spot, boss, quick fire, voice, focus, Wrapped, season, freezes);
 *  - feed: snapped cards, an answer marks right and wrong in place and is recorded (study hour, month counts);
 *  - spot: intro, one image, four options, the answer is stored for the day and POSTed, the board shows;
 *  - boss: 3 wrong ends the fight ("The boss won"); all right beats it and stores the win;
 *  - quick fire starts a one-question set; voice mode reads, hears "B" (stubbed recognizer) and answers B by itself;
 *  - focus: the live count is the server's, start posts a heartbeat, end posts on:false and logs the minutes;
 *  - mnemonics show under an explained question, Helpful posts a vote, Post sends the text;
 *  - Wrapped: story cards to a share card; season shows the tier from the server;
 *  - a freeze covers yesterday's gap on the next home paint; squads show the streak and the squad board; revenge
 *    replays a battle's missed rounds without recording them;
 *  - ?play=0 removes Play; no em or en dash on screen; new screens' buttons at least 44 px; no uncaught error.
 * SHOTS=<dir>: phone 390 x 844, light and dark.
 * USAGE: node test/run-prep-play-ui.mjs   (CHROME, CHROME_PORT, BASE, SHOTS)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-play-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
function moduleFile() {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ id: "bp-" + i, q: "Which root forms nerve " + i + "?", o: ["C5", "C6", "C7", "C8"], a: i % 4, exp: "Fixture explanation " + i + ". More text.", kp: i % 3 === 1 ? "Pearl number " + i : undefined, t: "ana-brachial-plexus", d: i < 24 ? 3 : 2, prov: "LIC" });
  return { topic: "ana-brachial-plexus", items };
}
const IMG = { v: 1, set: "eyetest", items: [0, 1, 2, 3, 4, 5].map((i) => ({ img: "i-" + i + ".webp", deck: "OCT", modality: "OCT", dx: "Diagnosis " + i, finding: "Finding " + i, reason: "Reason " + i, credit: "Test", licence: "CC BY 4.0" })) };
const api = { calls: [], posts: [] };
function playReply(method, path, body) {
  api.calls.push(method + " " + path);
  if (path === "focus") return [200, { now: body && body.on === false ? 11 : 12 }];
  if (path === "spot") return [200, { day: body ? body.day : "x", n: 3, rows: [{ rank: 1, name: "Bilal K", ms: 2100 }, { rank: 2, name: "Asha Rao", ms: 4000, me: true }], me: { rank: 2, ok: true, ms: 4000 } }];
  if (/^mn\?/.test(path)) return [200, { items: [{ id: "mn0000000000000001", text: "ARMS: axillary, radial, musculocutaneous", up: 4, mine: false, voted: false }, { id: "mn0000000000000002", text: "Mine: C5 C6 deltoid", up: 1, mine: true, voted: false }] }];
  if (path === "mn") return [200, { id: "mn0000000000000003" }];
  if (path === "mn/vote") return [200, { up: 5 }];
  if (/^season/.test(path)) return [200, { season: { n: 6, start: Date.now() - 10 * 864e5, end: Date.now() + 46 * 864e5 }, me: { points: 22, rank: 7, tier: "Silver", at: 15, next: { tier: "Gold", at: 40 } }, rows: [{ rank: 1, name: "Bilal K", points: 90, tier: "Platinum" }, { rank: 7, name: "Asha Rao", points: 22, tier: "Silver", me: true }], last: { n: 5, points: 44, tier: "Gold" } }];
  return [404, { error: "not-found" }];
}
function socialReply(method, path) {
  api.calls.push("social " + method + " " + path);
  if (path === "groups") return [200, { groups: [{ code: "ABC234", name: "Ward 5", dailyTarget: 20, owner: "Asha Rao", mine: true, squad: true, streak: 4, todayAll: false, members: [{ name: "Asha Rao", todayDone: 25 }, { name: "Bilal K", todayDone: 10 }, { name: "Chitra M", todayDone: 21 }] }] }];
  if (path === "squads/board") return [200, { week: "2026-10-26", rows: [{ rank: 1, name: "Night shift", size: 5, score: 900 }, { rank: 2, name: "Ward 5", size: 3, score: 610, mine: true }], me: [{ name: "Ward 5", rank: 2, score: 610 }] }];
  if (/^groups\/board/.test(path)) return [200, { week: "2026-10-26", rows: [] }];
  if (path === "progress") return [200, { ok: true }];
  return [200, {}];
}

await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const small = (scope) => ev(`var r=document.querySelector(${JSON.stringify(scope)}); if(!r) return "none"; return [].filter.call(r.querySelectorAll("button"), function(b){ return b.offsetParent && !b.closest(".pn-bar") && b.getBoundingClientRect().height < 44 * 0.95 - 0.5; }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + Math.round(b.getBoundingClientRect().height); }).join(",");`);
const act = (a, v) => ev(`var r=document.getElementById("smdPrep"), b=document.createElement("button"); b.type="button"; b.setAttribute("data-act", ${JSON.stringify(a)}); ${v != null ? `b.setAttribute("data-v", ${JSON.stringify(String(v))});` : ""} b.hidden=true; r.appendChild(b); b.click(); if (b.parentNode) b.parentNode.removeChild(b); return 1;`);
const home = () => ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._st.run = null; PREP._host.rerender(); return 1;`);
const store = (expr) => ev(`var s=PREP._host.store(); return ${expr};`);
async function shot(name) {
  if (!SHOTS) return;
  for (const dark of [false, true]) {
    await ev(`document.body.classList.toggle("dark", ${dark}); document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    await sleep(200);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(SHOTS, name + (dark ? "-dark" : "-light") + ".png"), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.body.classList.remove("dark"); return 1;`);
}
// The app's own auth bootstrap may assign window.SMD_AUTH after boot; pin the signed-in stub for the whole run.
const SIGN_IN = `(function(){var A={currentUser:{uid:"u1",displayName:"Asha Rao",getIdToken:function(){return Promise.resolve("tok-asha");}}}; try{Object.defineProperty(window,"SMD_AUTH",{configurable:true,get:function(){return A;},set:function(){}});}catch(e){window.SMD_AUTH=A;}})(); try{localStorage.setItem("smd_prep_arena_in","1");}catch(e){}`;
// Speech stubs: speaking ends at once; the recognizer hears "B" the first time and nothing after.
const SPEECH = `window.SpeechSynthesisUtterance=function(t){this.text=t;}; window.__said=[]; Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{speak:function(u){window.__said.push(u.text); setTimeout(function(){u.onend&&u.onend();},20);},cancel:function(){}}});
window.SpeechRecognition=window.webkitSpeechRecognition=function(){var self=this; this.start=function(){window.__heard=(window.__heard||0)+1; setTimeout(function(){ if (!window.__heardB) { window.__heardB = 1; self.onresult&&self.onresult({results:[[{transcript:"B"}]]}); } self.onend&&self.onend();},30);}; this.stop=function(){};};`;

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-600));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url, method = p.request.method;
      let post = p.request.postData;
      if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
      const body = post ? JSON.parse(post) : null;
      let status = 404, out = { error: "not-found" };
      const pm = url.match(/\/api\/prep\/play\/(.*)$/), sm = url.match(/\/api\/prep\/social\/(.*)$/), am = url.match(/\/api\/prep\/arena\/(.*)$/);
      if (pm) { if (method === "POST") api.posts.push([pm[1], body]); [status, out] = playReply(method, pm[1], body); }
      else if (sm) [status, out] = socialReply(method, sm[1]);
      else if (am) { status = 200; out = am[1] === "consent" ? { joined: true, name: "Asha Rao" } : { events: [] }; }
      else if (/imglearn\/eye\.json/.test(url)) { status = 200; out = IMG; }
      else if (/imglearn\/psm\.json/.test(url)) { status = 200; out = { v: 1, set: "psm", items: [] }; }
      else if (/ana-brachial-plexus\.json/.test(url)) { status = 200; out = moduleFile(); }
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(out)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  await call("Fetch.enable", { patterns: ["*/api/prep/play/*", "*/api/prep/social/*", "*/api/prep/arena/*", "*imglearn/*", "*ana-brachial-plexus.json*"].map((u) => ({ urlPattern: u, requestStage: "Request" })) });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_SETUP=false; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1");}catch(e){} ${SPEECH}` });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_focus");}catch(e){} indexedDB.deleteDatabase("prep-bank"); ${SIGN_IN} return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_PLAY && !!document.querySelector("#smdPrep [data-act=v-feed]");`, 20000), "Play loads and home shows its section");
  ok(await ev(`return ["v-feed","v-spot","v-boss","v-quick","v-voice","v-focus","v-wrap","v-season","v-freeze"].every(function(a){ return !!document.querySelector("#smdPrep [data-act="+a+"]"); }) && PREP_LOADER.V === "prep113";`) === true, "all nine Play rows; loader prep113");
  // Header: Close and Search at the same gutter (owner screenshot 2026-10-30: Search sat one slot in from the edge).
  const gut = await ev(`var c=document.querySelector("#smdPrep .pn-bar-brand [data-act=close]"), f=document.querySelector("#smdPrep .pn-bar-brand [data-act=find]"), m=document.querySelector("#smdPrep .pn-bar-brand [data-act=menu]"); var a=c.getBoundingClientRect(), b=f.getBoundingClientRect(); return JSON.stringify({ l: Math.round(a.left), r: Math.round(innerWidth - b.right), nav: document.getElementById("smdPrep").classList.contains("pn-navon"), menu: m ? getComputedStyle(m).display : "none" });`);
  const g = JSON.parse(gut);
  ok(!g.nav || (Math.abs(g.l - g.r) <= 2 && g.menu === "none"), "header: Search flush right, same gutter as Close " + gut);
  await shot("play-home");

  // ---- feed
  await click("#smdPrep [data-act=v-feed]");
  ok(await until(`return document.querySelectorAll("#pvFeed .vf-q").length > 3;`, 15000), "feed: question cards");
  ok(await ev(`var f=document.getElementById("pvFeed"), cs=getComputedStyle(f); return cs.scrollSnapType.indexOf("y") === 0 && cs.overflowY === "auto" && getComputedStyle(f.querySelector(".vf-c")).scrollSnapAlign.indexOf("start") >= 0;`) === true, "feed: a vertical snap scroller");
  ok(await ev(`return !!document.querySelector("#pvFeed .vf-pearl") && !!document.querySelector("#pvFeed .vf-img img");`) === true, "feed: pearl and image cards between questions");
  await shot("play-feed");
  const fid = await ev(`return PREP_PLAY._p.feed.cards[0].it.id;`);
  const fa = await ev(`return PREP_PLAY._p.feed.cards[0].it.a;`);
  await click(`#pvFeed .vf-c[data-i="0"] .pn-opt[data-k="${(fa + 1) % 4}"]`);
  ok(await ev(`var c=document.querySelector('#pvFeed .vf-c[data-i="0"]'); return !!c.querySelector(".pn-opt.wrong") && !!c.querySelector('.pn-opt.right[data-k="${fa}"]') && !c.querySelector(".vf-why").hidden && /answer is/.test(c.querySelector(".vf-why").textContent);`) === true, "feed: wrong marked, right shown, the why line");
  ok(await store(`!!s.mt["${fid}"] && (s.hr||[]).reduce(function(a,b){return a+(b||0);},0) === 1 && !!s.wm`) === true, "feed: the answer is recorded (mistakes, study hour, month counts)");
  ok(/0 of 1 right/.test(await text("#smdPrep .pn-bar .pn-t p")), "feed: the bar counts right answers");

  // ---- spot
  await home(); await click("#smdPrep [data-act=v-spot]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=v-spotgo]");`, 8000), "spot: intro with Start");
  await click("#smdPrep [data-act=v-spotgo]");
  ok(await until(`return !!document.querySelector("#smdPrep .pv-spot-fig img") && document.querySelectorAll("#smdPrep [data-act=v-spota]").length === 4 && !!document.querySelector("#smdPrep .pv-tbar i");`, 5000), "spot: the image, 4 options and the 10 s bar");
  await shot("play-spot");
  const sa = await ev(`return PREP_PLAY._p.spot.pick.a;`);
  await click(`#smdPrep [data-act=v-spota][data-k="${sa}"]`);
  ok(await until(`return /Right/.test(document.querySelector("#smdPrep .pn-verdict").textContent);`, 3000), "spot: right");
  ok(await store(`!!s.spot && s.spot.ok === true && s.spot.ms >= 0 && s.spot.ms <= 10000`) === true, "spot: stored for the day");
  ok(await until(`return document.querySelectorAll("#smdPrep .pv-board li").length === 2;`, 5000) && api.posts.some((x) => x[0] === "spot" && x[1].ok === true), "spot: result POSTed, the board shows");
  await shot("play-spot-done");

  // ---- boss: lose
  await home(); await click("#smdPrep [data-act=v-boss]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=v-bossgo][data-v=anatomy]');`, 5000), "boss: subjects listed");
  ok(await small("#smdPrep .pv-boss") === "", "boss list buttons at least 44 px " + await small("#smdPrep .pv-boss"));
  await click('#smdPrep [data-act=v-bossgo][data-v=anatomy]');
  ok(await until(`var r=PREP._st.run; return !!r && r.items.length === 20 && /3 lives/.test(r.title);`, 15000), "boss: 20 questions, 3 lives");
  ok(await ev(`return PREP._st.run.items.every(function(x){ return x.d >= 2; }) && PREP._st.run.items.slice(0,20).filter(function(x){return x.d===3;}).length === 20;`) === true, "boss: the hard questions");
  for (let i = 0; i < 3; i++) {
    await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+((it.a+1)%4)+'"]').click(); return 1;`);
    if (i < 2) { await until(`return !!document.querySelector("#smdPrep [data-act=next]");`, 3000); ok(await ev(`return /${2 - i} li/.test(PREP._st.run.title);`) === true, "boss: " + (2 - i) + " left after " + (i + 1) + " wrong"); await click("#smdPrep [data-act=next]"); }
  }
  ok(await until(`return /The boss won/.test(document.querySelector("#smdPrep .pv-boss-end").textContent);`, 5000), "boss: three wrong ends it");
  ok(await store(`s.boss.anatomy.tries === 1 && !s.boss.anatomy.won`) === true, "boss: the try is stored");
  await shot("play-boss-lost");
  // win
  await click('#smdPrep [data-act=v-bossgo][data-v=anatomy]');
  await until(`var r=PREP._st.run; return !!r && !r.done && r.items.length === 20;`, 10000);
  for (let i = 0; i < 20; i++) {
    await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+it.a+'"]').click(); return 1;`);
    await until(`return !!document.querySelector("#smdPrep [data-act=next]");`, 3000);
    await click("#smdPrep [data-act=next]");
  }
  ok(await until(`return /Boss beaten/.test(document.querySelector("#smdPrep .pv-boss-end").textContent);`, 5000), "boss: all right beats it");
  ok(await store(`!!s.boss.anatomy.won && s.boss.anatomy.best === 20 && s.boss.anatomy.tries === 2`) === true, "boss: the win is stored");
  await shot("play-boss-won");

  // ---- quick fire
  await home(); await click("#smdPrep [data-act=v-quick]");
  ok(await until(`var r=PREP._st.run; return !!r && r.items.length === 1 && r.title === "Quick fire";`, 10000), "quick fire: one question");

  // ---- mnemonics (under the explanation of the quick fire question)
  await ev(`var r=PREP._st.run, it=r.items[0]; document.querySelector('#smdPrep .pn-opt[data-k="'+it.a+'"]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll("#smdPrep .pv-mnl li").length === 2;`, 5000), "mnemonics: two under the explanation");
  ok(/not checked by StewardMD/.test(await text("#smdPrep .pv-mn")), "mnemonics: labelled as students' and unchecked");
  await click('#smdPrep [data-act=v-mnup][data-v="mn0000000000000001"]');
  ok(await until(`var b=document.querySelector('#smdPrep [data-act=v-mnup]'); return !!b && b.getAttribute("aria-pressed")==="true" && /5/.test(b.textContent);`, 3000) && api.posts.some((x) => x[0] === "mn/vote" && x[1].up === true), "mnemonics: Helpful posts a vote");
  await click("#smdPrep [data-act=v-mnadd]");
  ok(await until(`return !!document.querySelector("#pvSheet #pvMnIn");`, 3000), "mnemonics: the add sheet");
  await ev(`document.getElementById("pvMnIn").value = "Deltoid = Axillary, C5 C6"; return 1;`);
  await click("#pvSheet [data-act=v-mnsave]");
  ok(await until(`return !document.getElementById("pvSheet");`, 3000) && api.posts.some((x) => x[0] === "mn" && x[1].text === "Deltoid = Axillary, C5 C6"), "mnemonics: Post sends the text");
  await shot("play-mnemonics");

  // ---- voice mode (stubbed speech and recognizer that hears "B")
  await home(); await click("#smdPrep [data-act=v-voice]");
  ok(await until(`var r=PREP._st.run; return !!r && r.title === "Voice mode" && !!document.getElementById("pvVoice");`, 10000), "voice: a set with the voice bar");
  ok(await until(`var r=PREP._st.run; return r && r.ans[0] === 1;`, 8000), "voice: heard B and answered B");
  ok(await until(`return PREP._st.run.i >= 1;`, 8000), "voice: told the verdict and moved on by itself");
  ok(await ev(`return window.__said.length >= 2 && /Option A\\./.test(window.__said[0]);`) === true, "voice: read the question and the options aloud");
  await shot("play-voice");
  // The stub hears "B" once only, so question 2 hears nothing: two tries, then "Tap your answer" (no endless loop).
  await until(`return /Tap your answer/.test((document.getElementById("pvVoiceT")||{}).textContent || "");`, 8000);
  const sorry = await ev(`return window.__said.filter(function(t){ return /^Sorry/.test(t); }).length;`);
  await sleep(1500);
  ok(sorry === 1 && await ev(`return window.__said.filter(function(t){ return /^Sorry/.test(t); }).length;`) === 1, "voice: hears nothing twice, then waits for a tap (" + sorry + " sorry)");
  await click("#smdPrep [data-act=v-voicestop]");
  ok(await until(`return !document.getElementById("pvVoice") && !PREP_PLAY._p.voice;`, 3000), "voice: Stop voice ends it");

  // ---- focus
  await home(); await click("#smdPrep [data-act=v-focus]");
  ok(await until(`return /12 doctors are in a focus session now/.test(document.querySelector("#smdPrep .pv-focus").innerText);`, 5000), "focus: the live count from the server");
  ok(await small("#smdPrep .pv-focus") === "", "focus buttons at least 44 px " + await small("#smdPrep .pv-focus"));
  await click('#smdPrep [data-act=v-fstart][data-v="25"]');
  ok(await until(`return /25 min/.test(document.querySelector("#pvFocusLeft").textContent);`, 3000) && api.posts.some((x) => x[0] === "focus" && x[1].on === true), "focus: in session, heartbeat sent");
  await shot("play-focus");
  await click("#smdPrep [data-act=v-fend]");
  ok(await until(`return !document.getElementById("pvFocusLeft");`, 3000) && api.posts.some((x) => x[0] === "focus" && x[1].on === false), "focus: End posts on:false");
  ok(await store(`!s.fxm || !s.fxm[PREP_PLAY._pure.ym(Date.now())]`) === true, "focus: a session under a minute logs nothing");
  await ev(`localStorage.setItem("smd_prep_focus", JSON.stringify({ start: Date.now() - 31 * 60e3, end: Date.now() + 60e3, min: 32 })); PREP._host.rerender(); return 1;`);
  await click("#smdPrep [data-act=v-fend]");
  ok(await until(`var s=PREP._host.store(); return !!s.fxm && s.fxm[PREP_PLAY._pure.ym(Date.now())] === 31;`, 3000), "focus: 31 minutes logged for the month");

  // ---- Wrapped
  await home(); await click("#smdPrep [data-act=v-wrap]");
  ok(await until(`return !!document.querySelector("#smdPrep .pv-slide .pv-num");`, 3000), "wrapped: the first card");
  await shot("play-wrapped");
  for (let i = 0; i < 8 && await ev(`return !!document.querySelector("#smdPrep [data-act=v-wnext]");`) === true; i++) await click("#smdPrep [data-act=v-wnext]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=v-wshare]");`, 3000), "wrapped: tapping through ends on the share card");
  await click("#smdPrep [data-act=v-wshare]");
  ok(await until(`return PREP_PLAY._p.lastShare > 1000;`, 5000), "wrapped: the share image is drawn");
  await shot("play-wrapped-share");

  // ---- season
  await home(); await click("#smdPrep [data-act=v-season]");
  ok(await until(`return /Silver/.test(document.querySelector("#smdPrep .pv-tname") ? document.querySelector("#smdPrep .pv-tname").textContent : "") && /18 more to Gold/.test(document.querySelector("#smdPrep .pv-season").innerText);`, 8000), "season: tier, points to the next");
  await shot("play-season");

  // ---- streak freeze covers yesterday
  await ev(`var s=PREP._host.store(), td=PREP._host.today(); s.days={}; s.days[td-2]=12; s.days[td-3]=9; s.frz={bank:1,used:[]}; PREP._host.save(); PREP_PLAY._p.freezeDay=null; return 1;`);
  await home();
  ok(await until(`var s=PREP._host.store(), td=PREP._host.today(); return s.frz.bank === 0 && s.frz.used.indexOf(td-1) >= 0 && PREP._host.core().streak(s, td) === 2;`, 3000), "freeze: yesterday covered, the streak holds at 2");

  // ---- squads
  await ev(`PrepSocial.open("groups"); return 1;`);
  ok(await until(`return /Squad · 4 days all in/.test(document.getElementById("smdPrep").innerText);`, 8000), "squads: the streak on the group row");
  await click('#smdPrep [data-act=s-group][data-v="ABC234"]');
  ok(await until(`return !!document.querySelector("#smdPrep .ps-squad") && /1 still to hit the target today/.test(document.querySelector("#smdPrep .ps-squad").textContent);`, 5000), "squads: streak card says who is still to hit the target");
  await shot("play-squad");
  await ev(`PREP._host.back(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=s-squads]");`, 3000);
  await click("#smdPrep [data-act=s-squads]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length === 2 && !!document.querySelector("#smdPrep .pn-lb.me");`, 5000), "squads: the board with my squad marked");

  // ---- revenge: a lost battle's missed rounds
  await home();
  await ev(`PREP_ARENA._a.battle = { phase: "end", id: "b1", result: "loss", score: [1, 3], opp: { name: "Bilal K", rating: 1210 }, log: [{ q: "Battle Q one?", o: ["w","x","y","z"], a: 1, k: 0 }, { q: "Battle Q two?", o: ["w","x","y","z"], a: 2, k: 2 }, { q: "Battle Q three?", o: ["w","x","y","z"], a: 3, k: -1 }] }; PREP_ARENA.act("a-revenge", document.createElement("button"), PREP._host); return 1;`);
  ok(await until(`var r=PREP._st.run; return !!r && r.title === "Revenge" && r.items.length === 2 && r.norec === true;`, 3000), "revenge: the two missed rounds, not recorded");
  const before = await store(`Object.keys(s.cards).length`);
  for (let i = 0; i < 2; i++) { await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+it.a+'"]').click(); return 1;`); await until(`return !!document.querySelector("#smdPrep [data-act=next]");`, 3000); await click("#smdPrep [data-act=next]"); }
  ok(await until(`return /2 of 2/.test(document.querySelector("#smdPrep .pn-score").textContent) && !!document.querySelector("#smdPrep [data-act=a-again]");`, 3000), "revenge: 2 of 2, Battle again");
  ok(await store(`Object.keys(s.cards).length`) === before, "revenge: nothing written to memory");

  ok(!DASH.test(await screenText()), "no em or en dash");

  // ---- flag off
  await call("Page.navigate", { url: BASE + "?play=0" });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "boots with ?play=0");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-home");`, 20000) && await ev(`return !window.PREP_PLAY && !document.querySelector("#smdPrep [data-act=v-feed]");`) === true, "?play=0: no Play section");
  ok(errors.length === 0, "no uncaught error " + errors.join(" | "));
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
finally {
  try { chrome.kill(); } catch {} try { if (serveProc) serveProc.kill(); } catch {}
  console.log(fails ? fails + " failed" : "all passed");
  process.exit(fails ? 1 : 0);
}
