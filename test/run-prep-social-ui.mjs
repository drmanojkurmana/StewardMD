/* PrepNucleus friends, challenges, college boards, study groups and the accuracy page (prep-social.js) in the REAL app
 * (headless Chrome over CDP) against a mocked server: /api/prep/social/* and /api/prep/arena/* are answered here through
 * Fetch interception, window.WebSocket is a stub. prep-social.js and prep-social.css are injected and PrepSocial.open()
 * is called directly, so this does not depend on the prep.js entry. What must hold: the first open asks Arena consent
 * (the Arena flag stays OFF); Friends lists friends and requests, adds by StewardMD ID (an error shows next to the
 * field), accepts a request; a challenge is sent and an incoming one accepted, each opening a private battle whose
 * socket URL carries the room and exam; the college tag is set from the list and the college and state boards render,
 * then the tag is removed; a group is created, shows its code, members and weekly board, another joined by code, one
 * left; the accuracy screen and prep/accuracy.html render accuracy.json with "Not yet published" for null figures; no
 * uncaught PrepNucleus error. Screenshots (light and dark) go to SHOTS (default /tmp/prep-social-shots).
 *
 * USAGE: node test/run-prep-social-ui.mjs   (CHROME=<path>; SHOTS=<dir>)
 */
import { freePort } from "./free-port.mjs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-social-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
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

/* ---- the mocked server ---- */
const NOW = Date.now();
const S = { joined: false, calls: [], bodies: {}, friends: [{ smdId: "SMD-ROHAN1", name: "Rohan Mehta", since: NOW - 20 * 86400e3 }, { smdId: "SMD-MEERA2", name: "Meera Krishnan", since: NOW - 3 * 86400e3 }],
  incoming: [{ smdId: "SMD-ARJUN3", name: "Arjun Singh", at: NOW - 3600e3 }], outgoing: [], chIn: [{ room: "RIN42", from: { smdId: "SMD-MEERA2", name: "Meera Krishnan" }, expiresAt: NOW + 12 * 60e3, exam: "neet-pg" }], chOut: [],
  college: null, groups: [], progress: [] };
const group = (code, name, target, mine) => ({ code, name, dailyTarget: target, mine, owner: mine ? "Asha Rao" : "Kavya Iyer", members: [{ name: "Asha Rao", todayDone: 14 }, { name: "Kavya Iyer", todayDone: 42 }, { name: "Neil D'Souza", todayDone: 30 }, { name: "Priya Nair", todayDone: 0 }] });
function social(method, path, body) {
  S.calls.push(method + " " + path); S.bodies[path] = body;
  if (!S.joined) return [403, { error: "consent-required" }];
  if (path === "friends" && method === "GET") return [200, { friends: S.friends, incoming: S.incoming, outgoing: S.outgoing }];
  if (path === "friends/add") {
    if (body.smdId === "SMD-NOBODY") return [404, { error: "not_found" }];
    S.outgoing.push({ smdId: body.smdId, name: "Kavya Iyer", at: NOW }); return [200, { ok: true }];
  }
  if (path === "friends/accept") { const f = S.incoming.find((x) => x.smdId === body.smdId); S.incoming = S.incoming.filter((x) => x !== f); S.friends.push({ smdId: f.smdId, name: f.name, since: NOW }); return [200, { ok: true }]; }
  if (path === "friends/remove") { S.friends = S.friends.filter((x) => x.smdId !== body.smdId); S.outgoing = S.outgoing.filter((x) => x.smdId !== body.smdId); return [200, { ok: true }]; }
  if (path === "challenges") return [200, { incoming: S.chIn, outgoing: S.chOut }];
  if (path === "challenge") { S.chOut.push({ room: "ROUT7", to: { smdId: body.smdId, name: "Rohan Mehta" }, expiresAt: NOW + 3 * 60e3, exam: body.exam, status: "waiting" }); return [200, { room: "ROUT7", expiresAt: NOW + 3 * 60e3, exam: body.exam }]; }
  if (path === "challenge/accept") { S.chIn = []; return [200, { room: body.room, exam: "neet-pg" }]; }
  if (path === "college-list") return [200, { colleges: [{ name: "AIIMS New Delhi", state: "Delhi" }, { name: "Grant Medical College, Mumbai", state: "Maharashtra" }, { name: "Madras Medical College", state: "Tamil Nadu" }] }];
  if (path === "college" && method === "GET") return [200, S.college || { college: null }];
  if (path === "college" && method === "POST") { S.college = { college: body.college, state: body.state, key: "grant-medical-college-mumbai", stateKey: "maharashtra" }; return [200, { ok: true }]; }
  if (path === "college" && method === "DELETE") { S.college = null; return [200, { ok: true }]; }
  if (path.startsWith("board?scope=")) {
    const st = /scope=state/.test(path);
    return [200, { scope: st ? "state" : "college", rows: (st ? ["Sneha Patil", "Asha Rao", "Omkar Joshi", "Ritu Shah", "Aditya Rane"] : ["Asha Rao", "Farhan Shaikh", "Ishita Kulkarni"]).map((n, i) => ({ rank: i + 1, name: n, rating: 1320 - i * 18, me: n === "Asha Rao" })), me: { rank: st ? 2 : 1, name: "Asha Rao", rating: st ? 1302 : 1320 } }];
  }
  if (path === "progress") { S.progress.push(body.done); return [200, { ok: true }]; }
  if (path === "groups" && method === "GET") return [200, { groups: S.groups }];
  if (path === "groups/create") { S.groups.push(group("K7P2QX", body.name, body.dailyTarget, true)); return [200, { code: "K7P2QX" }]; }
  if (path === "groups/join") { if (body.code === "FULL01") return [409, { error: "full" }]; S.groups.push(group(body.code, "Night owls", 50, false)); return [200, { ok: true }]; }
  if (path === "groups/leave") { S.groups = S.groups.filter((g) => g.code !== body.code); return [200, { ok: true }]; }
  if (path.startsWith("groups/board?code=")) return [200, { rows: [{ name: "Kavya Iyer", score: 118 }, { name: "Asha Rao", score: 96 }, { name: "Neil D'Souza", score: 71 }], week: "30 Sep to 6 Oct" }];
  return [404, { error: "nope" }];
}
function arena(method, path) {
  S.calls.push("arena " + method + " " + path);
  if (path === "consent") { if (method === "POST") S.joined = true; if (method === "DELETE") S.joined = false; return [200, { joined: S.joined, name: S.joined ? "Asha Rao" : "" }]; }
  return [404, { error: "nope" }];
}

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: finite animations (entrances, ring draw) are finished first; loops keep running.
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const type = (sel, v) => ev(`var i=document.querySelector(${JSON.stringify(sel)}); if(!i) return "missing"; i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
const submit = (sel) => ev(`var f=document.querySelector(${JSON.stringify(sel)}); if(!f) return "missing"; f.requestSubmit(); return 1;`);
const text = () => ev(`return document.querySelector("#smdPrep").textContent;`);
// Light and dark at 390x844; when the body scrolls, also the whole body ("-full").
const shot = async (name, sel = "#smdPrep .pn-body") => {
  for (const mode of ["light", "dark"]) {
    await ev(`document.body.classList.toggle("dark", ${mode === "dark"}); return 1;`); await sleep(150);
    let r = await shotCall({ format: "png" });
    if (r.result) fs.writeFileSync(join(SHOTS, `${name}-${mode}.png`), Buffer.from(r.result.data, "base64"));
    const h = await ev(`var b=document.querySelector(${JSON.stringify(sel)}); return b && b.scrollHeight > b.clientHeight + 4 ? Math.ceil(b.scrollHeight - b.clientHeight + 844) : 0;`);
    if (h) {
      await call("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.min(h, 5000), deviceScaleFactor: 2, mobile: true }); await sleep(200);
      r = await shotCall({ format: "png" });
      if (r.result) fs.writeFileSync(join(SHOTS, `${name}-${mode}-full.png`), Buffer.from(r.result.data, "base64"));
      await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(120);
    }
  }
};
const WS_STUB = `(function(){
  var list = window.__ws = [];
  function FakeWS(url, protocols) { this.url = url; this.protocols = protocols; this.sent = []; this.readyState = 0; var self = this; list.push(this);
    setTimeout(function () { self.readyState = 1; if (self.onopen) self.onopen({}); }, 30); }
  FakeWS.prototype.send = function (d) { this.sent.push(JSON.parse(d)); };
  FakeWS.prototype.close = function () { if (this.readyState === 3) return; this.readyState = 3; var self = this; setTimeout(function () { if (self.onclose) self.onclose({}); }, 0); };
  FakeWS.prototype.emit = function (m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); };
  window.WebSocket = FakeWS;
})();`;
const SIGN_IN = `window.SMD_AUTH={currentUser:{uid:"u1",displayName:"Asha Rao",email:"asha@example.com",getIdToken:function(){return Promise.resolve("tok-asha");},getIdTokenResult:function(){return Promise.resolve({token:"tok-asha",claims:{}});}}}; return 1;`;
const INJECT = `if(!window.PrepSocial){var l=document.createElement("link"); l.rel="stylesheet"; l.href="/prep-social.css?t="+Date.now(); document.head.appendChild(l); var s=document.createElement("script"); s.src="/prep-social.js?t="+Date.now(); document.head.appendChild(s);} return 1;`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request, isSocial = rq.url.includes("/api/prep/social/"), path = rq.url.split(isSocial ? "/api/prep/social/" : "/api/prep/arena/")[1] || "";
      let body = null; try { body = rq.postData ? JSON.parse(rq.postData) : null; } catch {}
      const auth = (rq.headers && (rq.headers.Authorization || rq.headers.authorization)) || "";
      const [code, json] = auth !== "Bearer tok-asha" ? [401, { error: "auth" }] : isSocial ? social(rq.method, decodeURIComponent(path), body) : arena(rq.method, path);
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(json)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|Social/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(m){(window.__confirms=window.__confirms||[]).push(m);return true;}; window.SMD_PREP_ONBOARD=false; window.toast=function(m){(window.__toasts=window.__toasts||[]).push(m);}; ${WS_STUB}` });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/social/*" }, { urlPattern: "*/api/prep/arena/*" }] });
  await call("Page.navigate", { url: BASE + "?prep=1&tour=0" });
  await until(`return !!(window.PREP && window.SMD_showHome);`, 30000);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_prep_arena","0"); localStorage.setItem("smd_onboarding_tour","0");}catch(e){} return 1;`);
  await ev(SIGN_IN);
  await until(`return !!window.PrepSocial;`, 5000); // prep-loader.js loads it once the prep-pro entry is in; else inject
  await ev(INJECT);
  ok(await until(`return !!(window.PrepSocial && PrepSocial.open && PrepSocial.openAccuracy);`, 8000), "prep-social.js exposes PrepSocial.open and openAccuracy");
    // record what the battle start receives (PREP_ARENA loads with the first open)
  await ev(`window.__wrap=setInterval(function(){ if(!window.PREP_ARENA||window.__sb) return; clearInterval(window.__wrap); var f=PREP_ARENA.startBattle; window.__sb=[]; PREP_ARENA.startBattle=function(o,h){window.__sb.push(o); return f(o,h);}; },20); return 1;`);

  // ---- consent, then Friends
  await ev(`PrepSocial.open("friends"); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-sheet [data-act=a-join]");`, 15000), "first open (closed overlay, Arena flag off) asks Arena consent");
  const flag = await ev(`return PREP_ARENA.enabled();`); ok(flag === false, "the Arena flag is off (social does not need it): " + flag);
  await shot("social-consent");
  await click("#smdPrep .pn-sheet [data-act=a-join]");
  ok(await until(`return /Friends and groups/.test(document.querySelector("#smdPrep .pn-t h1").textContent) && /Rohan Mehta/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 8000) && S.joined, "Join Arena, then Friends lists friends");
  ok(await until(`return /Arjun Singh/.test(document.querySelector("#smdPrep .pn-body").textContent) && /Meera Krishnan/.test(document.querySelector("#smdPrep .ps-list").textContent);`, 4000), "friend request and incoming challenge show");
  ok(S.progress.length === 1 && Number.isInteger(S.progress[0]) && S.progress[0] === await ev(`return PREP._host.store().days[PREP._host.today()]||0;`), "opening reports today's answered count from the store to /progress: " + S.progress.join(","));
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .ps-body button, #smdPrep .ps-body input")).every(function(b){var r=b.getBoundingClientRect(); return !r.width || b.offsetHeight>=44;});`) === true, "every control on Friends is at least 44px tall");
  await shot("social-friends");
  await type("#psFrId", "smd-nobody"); await submit("[data-sform=s-fradd]");
  ok(await until(`var m=document.getElementById("psFrMsg"); return !!m && !m.hidden && /No one has that ID/.test(m.textContent);`, 4000) && S.bodies["friends/add"].smdId === "SMD-NOBODY", "unknown ID: plain error next to the field; the ID is sent upper case");
  await type("#psFrId", " smd kavya9 "); await submit("[data-sform=s-fradd]");
  ok(await until(`return /Request sent/.test(document.querySelector("#smdPrep .ps-body").textContent) && /Kavya Iyer/.test(document.querySelector("#smdPrep .ps-quiet").textContent);`, 4000) && S.bodies["friends/add"].smdId === "SMDKAVYA9", "add by StewardMD ID: request sent, listed as pending");
  await click("#smdPrep [data-act=s-fryes][data-v=SMD-ARJUN3]");
  ok(await until(`return !document.querySelector("[data-act=s-fryes]") && document.querySelectorAll("#smdPrep [data-act=s-frrm][data-n]").length===3;`, 4000), "accept a request: Arjun becomes a friend");
  await shot("social-friends-after");

  // ---- challenge: send (challenger enters the room), accept an incoming one
  await click("#smdPrep [data-act=s-chsend][data-v=SMD-ROHAN1]");
  ok(await until(`return /Waiting for your friend/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 5000), "sending a challenge opens the private battle, waiting for the friend");
  ok(S.bodies["challenge"] && S.bodies["challenge"].smdId === "SMD-ROHAN1" && S.bodies["challenge"].exam === "neet-pg", "the challenge POST carries the friend's ID and the exam");
  ok(await ev(`return window.__sb[0].room==="ROUT7" && window.__sb[0].exam==="neet-pg";`) === true, "PREP_ARENA.startBattle receives the room and exam");
  ok(await until(`var w=window.__ws[window.__ws.length-1]; return !!w && /\\/battle\\?exam=neet-pg&room=ROUT7$/.test(w.url) && w.protocols[0]==="smd-arena" && w.sent.length && w.sent[0].t==="queue";`, 3000), "the battle socket URL carries room=ROUT7 and queues as usual");
  await shot("social-battle-wait");
  await ev(`window.__ws[window.__ws.length-1].emit({t:"nobody"}); return 1;`);
  ok(await until(`return /Your friend did not join in time/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "room timeout reads: Your friend did not join in time");
  await click("#smdPrep [data-act=back]");
  ok(await until(`return /Friends and groups/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 3000), "back returns to Friends");
  await ev(`PREP._host.rerender(); return 1;`);
  await click("#smdPrep [data-act=s-chyes][data-v=RIN42]");
  ok(await until(`var w=window.__ws[window.__ws.length-1]; return !!w && /room=RIN42/.test(w.url);`, 5000) && S.bodies["challenge/accept"].room === "RIN42", "accepting an incoming challenge opens room RIN42");
  await ev(`var w=window.__ws[window.__ws.length-1]; w.emit({t:"match",opp:{name:"Meera Krishnan",rating:1240},n:7,secs:20,id:"b9"}); return 1;`);
  ok(await until(`return /Matched/.test(document.querySelector("#smdPrep .pn-body").textContent) && /Meera Krishnan/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "the friend battle matches like any battle");
  await ev(`var w=window.__ws[window.__ws.length-1]; w.emit({t:"end",result:"win",score:[64,51],rating:{before:1240,after:1256}}); return 1;`);
  ok(await until(`return /You won/.test(document.querySelector("#smdPrep .pn-body").textContent) && !document.querySelector("#smdPrep [data-act=a-again]");`, 3000), "friend battle end: no public Play again");
  await shot("social-battle-end");
  await click("#smdPrep [data-act=back]");
  await until(`return /Friends and groups/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 3000);

  // remove a friend with a plain confirm
  await click("#smdPrep [data-act=s-frrm][data-v=SMD-MEERA2]");
  ok(await until(`return !document.querySelector("[data-act=s-frrm][data-v=SMD-MEERA2]");`, 4000) && await ev(`return /Remove Meera Krishnan from your friends\\?/.test(window.__confirms.join("|"));`) === true, "remove a friend after a plain confirm");

  // ---- college boards
  await click("#smdPrep [data-act=s-tab][data-v=boards]");
  ok(await until(`return !!document.getElementById("psCol") && document.querySelectorAll("#psColList option").length===3;`, 5000), "boards: opt-in form with the college list");
  await shot("social-boards-optin");
  await type("#psCol", "Grant Medical College, Mumbai"); await submit("[data-sform=s-colset]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===3 && /Grant Medical College/.test(document.querySelector(".ps-tag").textContent);`, 5000) && S.bodies["college"].state === "Maharashtra", "picked college: state filled from the list, college board shows");
  ok(S.calls.some((c) => c === "GET board?scope=college&key=Grant Medical College, Mumbai"), "college board asked by the college (the server normalises the key)");
  await shot("social-boards-college");
  await click("#smdPrep [data-act=s-scope][data-v=state]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===5 && !!document.querySelector("#smdPrep .pn-lb.me");`, 5000), "state board with your row marked");
  await shot("social-boards-state");
  await click("#smdPrep [data-act=s-coldel]");
  ok(await until(`return !!document.getElementById("psCol");`, 4000) && S.college === null, "remove the college tag: back to the opt-in");

  // ---- study groups
  await ev(`PREP._host.store().days[PREP._host.today()]=37; return 1;`);
  await click("#smdPrep [data-act=s-tab][data-v=groups]");
  ok(await until(`return !!document.getElementById("psGName");`, 4000), "groups: empty state with create and join");
  ok(S.progress[S.progress.length - 1] === 37, "the groups tab reports today's 37 answered questions to /progress");
  await shot("social-groups-empty");
  await type("#psGName", "Batch 2021 PG prep"); await type("#psGTarget", "3"); await submit("[data-sform=s-gnew]");
  ok(await until(`var m=document.getElementById("psGNewMsg"); return !!m && !m.hidden && /5 to 500/.test(m.textContent);`, 3000), "a target below 5 is refused next to the field");
  await type("#psGTarget", "40"); await submit("[data-sform=s-gnew]");
  ok(await until(`return /K7P2QX/.test(document.querySelector("#smdPrep .ps-share").textContent) && document.querySelectorAll("#smdPrep .ps-members li").length===4 && document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===3;`, 5000)
    && S.bodies["groups/create"].dailyTarget === 40, "create: the group opens with its code, members today and the weekly board");
  ok(await ev(`return document.querySelectorAll("#smdPrep .ps-members li.ok").length===1;`) === true, "one member (42) reached the target of 40 today");
  await shot("social-group");
  await click("#smdPrep [data-act=back]");
  await until(`return !!document.getElementById("psGCode");`, 3000);
  await type("#psGCode", "full01"); await submit("[data-sform=s-gjoin]");
  ok(await until(`var m=document.getElementById("psGJoinMsg"); return !!m && !m.hidden && /full/.test(m.textContent);`, 3000), "joining a full group: plain error");
  await type("#psGCode", "night5"); await submit("[data-sform=s-gjoin]");
  ok(await until(`return /Night owls/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 5000) && S.bodies["groups/join"].code === "NIGHT5", "join by code opens the group");
  await click("#smdPrep [data-act=back]");
  ok(await until(`return document.querySelectorAll("#smdPrep [data-act=s-group]").length===2 && /Yours/.test(document.querySelector("#smdPrep [data-act=s-group]").textContent);`, 4000), "both groups listed, yours marked");
  await shot("social-groups");
  await click("#smdPrep [data-act=s-group][data-v=NIGHT5]");
  await until(`return !!document.querySelector("#smdPrep [data-act=s-gleave]");`, 3000);
  await click("#smdPrep [data-act=s-gleave]");
  ok(await until(`return document.querySelectorAll("#smdPrep [data-act=s-group]").length===1;`, 4000) && !S.groups.some((g) => g.code === "NIGHT5"), "leave a group");
  ok(/Leaving the Arena deletes your friends, challenges, college tag and groups/.test(await text()), "the screen says Leave the Arena deletes all of it");
  await click("#smdPrep [data-act=s-leave]");
  ok(await until(`return /friends, challenges, college tag and study groups are deleted/.test((window.__confirms||[]).join("|"));`, 3000), "Leave the Arena confirm names the social data");
  await sleep(300); ok(S.calls.includes("arena DELETE consent"), "Leave the Arena sends DELETE consent");
  ok(!/—/.test(await text()), "no em-dash in the screens");
  await ev(`PREP.close(); return 1;`);

  // ---- accuracy in the app
  await ev(`PrepSocial.openAccuracy(); return 1;`);
  ok(await until(`var b=document.querySelector("#smdPrep .ps-acc"); return !!b && document.querySelectorAll("#smdPrep .ps-bars li").length>=10 && /Not yet published/.test(b.textContent) && /How these numbers are made/.test(b.textContent) && /Updated \\d{4}-\\d{2}-\\d{2}/.test(b.textContent) && !/\\bAI\\b|MedMCQA/.test(b.textContent);`, 15000), "in-app accuracy: per subject bars, Not yet published, how made, update date, no AI or source naming (owner rule)");
  const acc = JSON.parse(fs.readFileSync(join(HERE, "..", "prep/accuracy.json"), "utf8"));
  ok(await ev(`return document.querySelector("#smdPrep .ps-acc").textContent;`).then((t) => t.includes(acc.keys.disputed.toLocaleString("en-IN")) && t.includes(acc.keys.screened.toLocaleString("en-IN"))), "the figures shown are accuracy.json's");
  await shot("accuracy-app");
  await ev(`PREP.close(); return 1;`);

  // ---- accuracy as a web page
  await call("Page.navigate", { url: BASE + "prep/accuracy.html" });
  ok(await until(`return document.querySelectorAll(".ps-bars li").length>=10 && /Not yet published/.test(document.body.textContent) && /How these numbers are made/.test(document.body.textContent);`, 10000), "prep/accuracy.html renders accuracy.json");
  ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth;`) === true, "no horizontal scroll at 390 px");
  await shot("accuracy-web", "html");
  for (const mode of ["light", "dark"]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(250);
    const r = await shotCall({ format: "png" }); if (r.result) fs.writeFileSync(join(SHOTS, `accuracy-web-desktop-${mode}.png`), Buffer.from(r.result.data, "base64"));
  }
  ok(await ev(`return document.body.classList.contains("dark");`) === true, "the web page follows the system dark setting");

  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
