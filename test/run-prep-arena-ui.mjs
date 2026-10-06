/* PrepNucleus Arena client (prep-arena.js) in the REAL app (headless Chrome over CDP), against the fixture bank and a
 * mocked server: /api/prep/arena/* is answered here through Fetch interception and window.WebSocket is replaced in the
 * page by a stub the test drives. What must hold: with smd_prep on and smd_prep_arena off there is no Compete section and
 * no Arena request, while My stats (practice on this phone) works; with ?arena=1 a guest sees "Sign in to compete" and
 * offline shows "Needs a connection"; signed in, Compete shows the live daily sprint with a ticking countdown and the
 * coming weekly test; the first entry asks consent with the account name ("Not now" closes, "Join Arena" POSTs); the
 * lobby starts the event, the runner shows no key and no feedback, submit sends { ans, ms } once, the result shows the
 * score, rank and leaderboard, and no FSRS card is written for event items; leaderboards (event, week, all) render with
 * the caller's row; a battle queues over a WebSocket opened with the "smd-arena" protocol and the token, plays 7 rounds
 * with a timer bar and round results, ends with the rating change, handles "nobody" and a dropped connection; My stats
 * shows the Arena record; Leave the Arena sends DELETE; no uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-arena-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves dark and light screenshots of each screen)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8996) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9398), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-arena-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

/* ---- the mocked Arena server ---- */
const NOW = Date.now();
const S = { joined: false, submitted: 0, calls: [], lastSubmit: null, startErr: null };
const KEY = { "ev-q1": 0, "ev-q2": 1, "ev-q3": 2, "ev-q4": 3, "ev-q5": 0 };
// GET events as functions/api/prep/arena/[[path]].js answers it: per kind the current and the next event, ms times.
const events = () => ({ events: [
  { role: "current", id: "daily-neet-pg-20261005", kind: "daily", exam: "neet-pg", startsAt: NOW - 86400e3, endsAt: NOW - 86400e3 + 20 * 60e3, n: 5, secs: 300, status: "closed", entry: null },
  { role: "current", id: "daily-neet-pg-20261006", kind: "daily", exam: "neet-pg", startsAt: NOW - 60e3, endsAt: NOW + 19 * 60e3, n: 5, secs: 300, status: "open", entry: S.submitted ? "submitted" : null },
  { role: "next", id: "weekly-neet-pg-20261011", kind: "weekly", exam: "neet-pg", startsAt: NOW + 2 * 86400e3 + 3 * 3600e3, endsAt: NOW + 2 * 86400e3 + 6 * 3600e3, n: 100, secs: 7200, status: "upcoming", entry: null }] });
const board = (field) => ({ rows: [1, 2, 3, 4, 5].map((r) => ({ rank: r, name: ["Meera K", "Arjun S", "Asha Rao", "Vikram Desai", "Fatima N"][r - 1], [field]: field === "score" ? 20 - r * 2 : 1300 - r * 15, ms: 200000 + r * 1000, ...(r === 3 ? { me: true } : {}) })), me: { rank: 3, name: "Asha Rao", [field]: field === "score" ? 14 : 1255 } });
function arena(method, path, body) {
  S.calls.push(method + " " + path);
  if (path === "consent") {
    if (method === "GET") return [200, { joined: S.joined, name: S.joined ? "Asha Rao" : "" }];
    if (method === "POST") { S.joined = true; return [200, { joined: true, name: "Asha Rao" }]; }
    if (method === "DELETE") { S.joined = false; return [200, { left: true }]; }
  }
  if (!S.joined && !/^events\?/.test(path)) return [403, { error: "consent" }];
  if (/^events\?exam=/.test(path)) return [200, events()];
  if (path === "events/daily-neet-pg-20261006/start" && S.startErr) return S.startErr;
  if (path === "events/daily-neet-pg-20261006/start") return [200, { id: "daily-neet-pg-20261006", startedAt: NOW, items: Object.keys(KEY).map((id, i) => ({ id, q: "Arena question " + (i + 1) + ": which nerve supplies the deltoid muscle?", o: ["Axillary", "Radial", "Musculocutaneous", "Ulnar"] })), secs: 300, endsAt: NOW + 19 * 60e3 }];
  if (path === "events/daily-neet-pg-20261006/submit") {
    S.submitted++; S.lastSubmit = body;
    if (S.submitted > 1) return [409, { error: "already-submitted" }];
    let right = 0, wrong = 0; Object.keys(KEY).forEach((id) => { if (body.ans[id] == null) return; if (body.ans[id] === KEY[id]) right++; else wrong++; });
    return [200, { score: right * 4 - wrong, right, wrong, blank: 5 - right - wrong, ms: 61000, rank: 3, of: 40, key: KEY }];
  }
  if (/^events\/daily-neet-pg-20261006\/board/.test(path)) return [200, board("score")];
  if (/^board\?exam=neet-pg&period=(week|all)$/.test(path)) return [200, board("rating")];
  if (path === "me/stats") return [200, { player: { name: "Asha Rao", rating: 1255, battles: 6, wins: 3, since: NOW - 9 * 86400e3 },
    events: [{ id: "daily-neet-pg-20261006", kind: "daily", exam: "neet-pg", score: 7, right: 2, wrong: 1, blank: 2, ms: 61000, at: NOW }],
    battles: [{ id: "b1", exam: "neet-pg", opp: "Rohan Mehta", score: [17, 72], result: "loss", rating: 1188, endedAt: NOW - 3600e3 }, { id: "b0", exam: "neet-pg", opp: "Former player", score: [60, 60], result: "draw", rating: 1200, endedAt: NOW - 7200e3 }],
    trend: [{ t: NOW - 7200e3, rating: 1200 }, { t: NOW - 3600e3, rating: 1188 }] }];
  return [404, { error: "nope" }];
}

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = []; const reqs = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
// Dark and light, each at 390x844 and, when the body scrolls, also the whole body ("-full").
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  for (const mode of ["dark", "light"]) {
    await ev(`document.body.classList.toggle("dark", ${mode === "dark"}); return 1;`); await sleep(120);
    let r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) fs.writeFileSync(join(process.env.SHOTS, `arena-${mode}-${name}.png`), Buffer.from(r.result.data, "base64"));
    const h = await ev(`var b=document.querySelector("#smdPrep .pn-body"); return b && b.scrollHeight > b.clientHeight + 4 ? Math.ceil(b.scrollHeight - b.clientHeight + 844) : 0;`);
    if (h) {
      await call("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.min(h, 4000), deviceScaleFactor: 2, mobile: true }); await sleep(200);
      r = await call("Page.captureScreenshot", { format: "png" });
      if (r.result) fs.writeFileSync(join(process.env.SHOTS, `arena-${mode}-${name}-full.png`), Buffer.from(r.result.data, "base64"));
      await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(120);
    }
  }
  await ev(`document.body.classList.add("dark"); return 1;`);
};

// The WebSocket stub: every socket is kept in window.__ws; the test pushes server messages with __ws[i].emit(obj).
const WS_STUB = `(function(){
  var list = window.__ws = [];
  function FakeWS(url, protocols) { this.url = url; this.protocols = protocols; this.sent = []; this.readyState = 0; var self = this; list.push(this);
    setTimeout(function () { self.readyState = 1; if (self.onopen) self.onopen({}); }, 30); }
  FakeWS.prototype.send = function (d) { this.sent.push(JSON.parse(d)); };
  FakeWS.prototype.close = function () { if (this.readyState === 3) return; this.readyState = 3; var self = this; setTimeout(function () { if (self.onclose) self.onclose({}); }, 0); };
  FakeWS.prototype.emit = function (m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); };
  FakeWS.prototype.drop = function () { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006 }); };
  window.WebSocket = FakeWS;
})();`;
const SIGN_IN = `window.SMD_AUTH={currentUser:{uid:"u1",displayName:"Asha Rao",email:"asha@example.com",getIdToken:function(){return Promise.resolve("tok-asha");},getIdTokenResult:function(){return Promise.resolve({token:"tok-asha",claims:{}});}}}; return 1;`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request, path = rq.url.split("/api/prep/arena/")[1] || "";
      let body = null; try { body = rq.postData ? JSON.parse(rq.postData) : null; } catch {}
      const auth = (rq.headers && (rq.headers.Authorization || rq.headers.authorization)) || "";
      const [code, json] = auth === "Bearer tok-asha" ? arena(rq.method, path, body) : [401, { error: "auth" }];
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(json)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; ${WS_STUB}` });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/arena/*" }] });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { reqs.length = 0; await call("Page.navigate", { url }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await sleep(300); };
  const openPrep = async () => { await ev(`PREP.close(); PREP.open(); return 1;`); return until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy] small") && /MCQs/.test(document.querySelector("#smdPrep .pn-tile[data-s=anatomy] small").textContent);`, 20000); };

  // ---- flag default: prep on, arena off
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.removeItem("smd_prep_arena"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await load(BASE + "?prep=1");
  await ev(SIGN_IN);
  ok(await openPrep(), "PrepNucleus opens with the fixture bank");
  ok(await ev(`return PREP_ARENA.enabled();`) === false, "smd_prep_arena is OFF by default");
  ok(await ev(`return !document.getElementById("pnCompete") && !Array.from(document.querySelectorAll("#smdPrep .pn-h")).some(function(h){return /Compete/.test(h.textContent);});`) === true, "arena off: no Compete section");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-h")).map(function(h){return h.textContent;}).join("|");`) === "Today's plan|Practise|Subjects", "home sections: Today's plan, Practise, Subjects");
  ok(await ev(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy] .pn-ic svg") && !/[A-Z]{3}/.test(document.querySelector("#smdPrep .pn-tile[data-s=anatomy] .pn-ic").textContent);`) === true, "subject cards carry an SVG icon, not a text monogram");
  await shot("home-off");
  // some local practice so My stats has something to show
  await ev(`var s=PREP._st.store, td=PREP._host.today(); s.mod["ana-gametogenesis"]={t:12,ok:9,last:td}; s.mod["ana-brachial-plexus"]={t:6,ok:2,last:td}; s.days[td]=14; s.days[td-1]=22; s.days[td-3]=9; s.days[td-9]=31; s.mh=[{ts:Date.now()-86400e3,label:"NEET-PG pattern (mini)",marks:96,max:200,n:50}]; PREP._host.save(); return 1;`);
  await click("#smdPrep [data-act=a-stats]");
  ok(await until(`return /My stats/.test(document.querySelector("#smdPrep .pn-t h1").textContent) && document.querySelectorAll("#smdPrep .pn-days i").length===30;`, 5000), "My stats works with the arena off: 30 day bars");
  ok(await ev(`var t=document.querySelector("#smdPrep .pn-acc").textContent; return /Anatomy/.test(t) && /61%/.test(t);`) === true, "accuracy by subject sums the subject's modules (11 of 18 = 61%)");
  ok(await ev(`return /NEET-PG pattern \\(mini\\)/.test(document.querySelector("#smdPrep .pn-body").textContent) && !document.getElementById("pnArenaStats");`) === true, "mock history shows; no Arena section while the flag is off");
  await shot("stats-local");
  ok(!S.calls.length && !reqs.some((u) => /\/api\/prep\/arena/.test(u)), "arena off: no Arena request: " + S.calls.join(", "));

  // ---- arena on: guest, then offline
  await load(BASE + "?prep=1&arena=1");
  await ev(`window.SMD_AUTH={currentUser:null}; return 1;`);
  ok(await openPrep(), "opens with ?arena=1");
  ok(await ev(`return /Sign in to compete/.test(document.getElementById("pnCompete").textContent);`) === true, "guest: Compete says Sign in to compete");
  await shot("home-guest");
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev(SIGN_IN);
  await openPrep();
  ok(await ev(`return /Needs a connection/.test(document.getElementById("pnCompete").textContent);`) === true, "offline: Compete says Needs a connection");
  await shot("home-offline");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ---- signed in: Compete
  await openPrep();
  ok(await until(`var c=document.getElementById("pnCompete"); return !!c && /Live now, ends in 1\\d:\\d\\d/.test(c.textContent) && /Starts in 2 d/.test(c.textContent);`, 8000), "Compete: live daily sprint with its countdown, weekly test coming: " + await ev(`return (document.getElementById("pnCompete")||{}).textContent;`));
  const cd1 = await ev(`return document.querySelector("#pnCompete [data-cd]").textContent;`); await sleep(1300);
  ok(await ev(`return document.querySelector("#pnCompete [data-cd]").textContent;`) !== cd1, "the countdown ticks");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-h")).map(function(h){return h.textContent;}).join("|");`) === "Today's plan|Compete|Practise|Subjects", "home sections: Today's plan, Compete, Practise, Subjects");
  await shot("home");

  // ---- consent
  await click('#smdPrep [data-act=a-event][data-k=daily]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-sheet");`, 5000), "first Arena entry opens the consent sheet");
  ok(await ev(`var t=document.querySelector("#smdPrep .pn-sheet").textContent; return /Asha Rao/.test(t) && !/asha@example/.test(t) && /Practice stays on this phone/.test(t);`) === true, "the sheet names the account (never the email) and says practice stays on the phone");
  await shot("consent");
  await click("#smdPrep .pn-sheet [data-act=a-nojoin]");
  ok(await until(`return !document.querySelector("#smdPrep .pn-sheet") && !!document.getElementById("pnCompete");`, 3000) && !S.joined, "Not now closes the sheet and joins nothing");
  await click('#smdPrep [data-act=a-event][data-k=daily]');
  await until(`return !!document.querySelector("#smdPrep .pn-sheet [data-act=a-join]");`, 5000);
  await click("#smdPrep .pn-sheet [data-act=a-join]");
  ok(await until(`return /Daily sprint/.test(document.querySelector("#smdPrep .pn-t h1").textContent) && !!document.querySelector("#smdPrep [data-act=a-start]");`, 5000) && S.joined, "Join Arena posts consent and opens the lobby");
  ok(await ev(`var t=document.querySelector("#smdPrep .pn-lobby").textContent; return /5 questions, 5 min/.test(t) && /Right \\+4, wrong minus 1/.test(t);`) === true, "lobby: count, time and the exam's marking");
  await shot("lobby");
  for (const [code, err, re, stays] of [[425, "not-open", /not opened yet/, true], [410, "closed", /has closed/, false], [503, "bank-empty", /Coming soon/, false]]) {
    S.startErr = [code, { error: err }];
    await click("#smdPrep [data-act=a-start]");
    ok(await until(`var e=document.getElementById("pnLobbyErr"); return !!e && !e.hidden && ${re}.test(e.textContent);`, 4000) && await ev(`return !document.querySelector("#smdPrep [data-act=a-start]").disabled;`) === stays, `start ${code} ${err}: plain message, Start ${stays ? "stays on" : "turns off"}`);
    if (code === 503) await shot("lobby-503");
    await ev(`PREP._st.stack[PREP._st.stack.length-1](); return 1;`);
  }
  S.startErr = null;

  // ---- event run
  await click("#smdPrep [data-act=a-start]");
  ok(await until(`return !!document.getElementById("pnClock") && !!document.querySelector("#smdPrep .pn-q");`, 5000), "Start runs the timed runner");
  ok(await ev(`return PREP._st.run.items.every(function(it){return it.a===undefined;});`) === true, "event items carry no answer key before submit");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await ev(`return !document.querySelector("#smdPrep .pn-fb") && !document.querySelector("#smdPrep .pn-opt.right");`) === true, "no feedback and no marking during the event");
  await shot("event-run");
  await click("#smdPrep [data-act=next]"); await click('#smdPrep .pn-opt[data-k="1"]');
  await click("#smdPrep [data-act=next]"); await click('#smdPrep .pn-opt[data-k="0"]');
  await click("#smdPrep [data-act=qgrid]");
  await click("#smdPrep .pn-qgrid + p + [data-act=submit]");
  ok(await until(`return /Rank 3 of 40/.test(((document.querySelector("#smdPrep .pn-rank")||{}).textContent)||"");`, 5000), "submit shows the server's mark and rank");
  ok(S.submitted === 1 && S.lastSubmit && JSON.stringify(S.lastSubmit.ans) === JSON.stringify({ "ev-q1": 0, "ev-q2": 1, "ev-q3": 0 }) && S.lastSubmit.ms >= 0, "submit sends { ans: itemId -> option, ms } once: " + JSON.stringify(S.lastSubmit));
  ok(await ev(`return document.querySelector("#smdPrep .pn-score .pn-big").textContent;`) === "7", "score from the server (2 right x4, 1 wrong -1)");
  ok(await ev(`return /1:01/.test(document.querySelector("#smdPrep .pn-score").textContent);`) === true, "time taken is the server's ms");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===5 && !!document.querySelector("#smdPrep .pn-lb.me");`, 5000), "the event leaderboard loads with the caller marked");
  ok(await ev(`return document.querySelectorAll("#smdPrep [data-act=reviewq]").length;`) === 3, "the missed (1 wrong, 2 blank) are listed for review with the key now known");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return !Object.keys(s.cards).some(function(k){return /ev-q/.test(k);}) && !Object.keys(s.mt).some(function(k){return /ev-q/.test(k);});`) === true, "event items write no FSRS card and no mistake");
  await shot("event-result");
  await click("#smdPrep [data-act=donerun]");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-lobby [data-act=a-board]');`, 3000), "back on the lobby, which now offers the leaderboard instead of Start");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.getElementById("pnCompete");`, 3000);

  // ---- leaderboards
  await click("#smdPrep [data-act=a-boards]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===5;`, 5000), "Leaderboard opens on today's sprint");
  await shot("board-event");
  await click('#smdPrep [data-act=a-tab][data-v=week]');
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===5 && /1285/.test(document.querySelector("#smdPrep .pn-board").textContent);`, 5000) && S.calls.includes("GET board?exam=neet-pg&period=week"), "This week shows battle ratings");
  await shot("board-week");
  await click('#smdPrep [data-act=a-tab][data-v=all]');
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-board .pn-lb").length===5;`, 5000) && S.calls.includes("GET board?exam=neet-pg&period=all"), "All time loads");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.getElementById("pnCompete");`, 3000);

  // ---- NEET-SS: Arena coming soon (no bank yet)
  await click('#smdPrep .pn-tab[data-v=neet-ss]');
  ok(await until(`return /NEET-SS Arena: coming soon/.test((document.getElementById("pnCompete")||{}).textContent||"");`, 4000), "NEET-SS Compete says coming soon");
  await shot("home-ss");
  await click('#smdPrep .pn-tab[data-v=neet-pg]');
  await until(`return !!document.querySelector("#smdPrep [data-act=a-battle]");`, 4000);

  // ---- battle
  await click("#smdPrep [data-act=a-battle]");
  ok(await until(`return window.__ws.length===1 && window.__ws[0].sent.length===1;`, 5000), "battle opens a socket and queues");
  ok(await ev(`var w=__ws[0]; return /\\/battle\\?exam=neet-pg$/.test(w.url) && w.protocols[0]==="smd-arena" && w.protocols[1]==="tok-asha" && w.sent[0].t==="queue";`) === true, "socket: /battle?exam=, protocols smd-arena + the ID token, {t:queue}");
  ok(await ev(`return /Finding an opponent/.test(document.querySelector("#smdPrep .pn-body").textContent);`) === true, "matchmaking state");
  await shot("battle-queue");
  await ev(`__ws[0].emit({t:"waiting"}); __ws[0].emit({t:"match",id:"b1",opp:{name:"Rohan Mehta",rating:1240},n:7,secs:20}); return 1;`);
  ok(await until(`return /Rohan Mehta/.test(document.querySelector("#smdPrep .pn-vs").textContent);`, 3000), "match: versus header with the opponent");
  const q = (i) => `__ws[0].emit({t:"q",i:${i},q:"Battle question ${i + 1}: drug of choice for absence seizures in a 7 year old?",o:["Ethosuximide","Phenytoin","Carbamazepine","Gabapentin"],deadline:Date.now()+20000}); return 1;`;
  await ev(q(0));
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tbar i") && document.querySelectorAll("#smdPrep .pn-opt").length===4 && /Round 1 of 7/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 3000), "round 1: question, options and a timer bar");
  await shot("battle-q");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await ev(`var s=__ws[0].sent; return JSON.stringify(s[s.length-1]);`) === JSON.stringify({ t: "a", i: 0, k: 0 }), "a pick sends {t:a,i,k}");
  await click('#smdPrep .pn-opt[data-k="1"]');
  ok(await ev(`return __ws[0].sent.length;`) === 2, "a second pick in the same round is not sent");
  await ev(`__ws[0].emit({t:"r",i:0,a:0,you:{k:0,pts:17},opp:{k:2,pts:0},score:[17,0]}); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-round") && /Right, \\+17/.test(document.querySelector("#smdPrep .pn-round").textContent) && document.querySelector("#smdPrep .pn-vs-s").textContent.replace(/\\s/g,"")==="170";`, 3000), "round result: the key, both picks, points and score");
  await shot("battle-round");
  for (let i = 1; i < 7; i++) { await ev(q(i)); await ev(`__ws[0].emit({t:"r",i:${i},a:0,you:{k:-1,pts:0},opp:{k:0,pts:12},score:[17,${12 * i}]}); return 1;`); }
  ok(await ev(`return /Round 7 of 7/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`) === true, "seven rounds played");
  await ev(`__ws[0].emit({t:"end",score:[17,72],result:"loss",rating:{before:1200,after:1188}}); return 1;`);
  ok(await until(`var t=document.querySelector("#smdPrep .pn-final"); return !!t && /You lost/.test(t.textContent) && /1200 to 1188/.test(t.textContent) && /minus 12/.test(t.textContent);`, 3000), "final result with the rating change");
  await shot("battle-end");
  await click("#smdPrep [data-act=a-again]");
  ok(await until(`return window.__ws.length===2 && __ws[1].sent.length===1;`, 5000), "Play again queues on a new socket");
  await ev(`__ws[1].emit({t:"nobody"}); return 1;`);
  ok(await until(`return /Nobody is free right now/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "nobody found");
  await shot("battle-nobody");
  await click("#smdPrep [data-act=a-again]");
  await until(`return window.__ws.length===3 && __ws[2].sent.length===1;`, 5000);
  await ev(`__ws[2].emit({t:"match",id:"b2",opp:{name:"Rohan Mehta",rating:1240},n:7,secs:20}); __ws[2].emit({t:"q",i:0,q:"Q",o:["a","b","c","d"],deadline:Date.now()+20000}); __ws[2].drop(); return 1;`);
  ok(await until(`return /Reconnecting/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "a drop mid-battle shows Reconnecting");
  await shot("battle-reconnect");
  ok(await until(`return window.__ws.length===4;`, 4000) && await ev(`return __ws[3].sent.length;`) === 0, "the client reconnects once, without queueing again");
  await ev(`__ws[3].emit({t:"match",id:"b2",opp:{name:"Rohan Mehta",rating:1240},n:7,secs:20,resume:true,score:[12,10]}); __ws[3].emit(${JSON.stringify({ t: "q", i: 2, q: "Resumed question 3", o: ["a", "b", "c", "d"] }).replace("}", ",deadline:Date.now()+15000}")}); return 1;`);
  ok(await until(`return /Round 3 of 7/.test(document.querySelector("#smdPrep .pn-t h1").textContent) && document.querySelector("#smdPrep .pn-vs-s").textContent.replace(/\s/g,"")==="1210";`, 3000), "match resume restores the score and the open question");
  await ev(`__ws[3].emit({t:"end",score:[12,10],result:"win",rating:{before:1188,after:1203},forfeit:"opp"}); return 1;`);
  ok(await until(`var t=document.querySelector("#smdPrep .pn-final"); return !!t && /You won/.test(t.textContent) && /Rohan Mehta left the battle/.test(t.textContent) && t.textContent.indexOf("(+15)")>=0;`, 3000), "a forfeit end says who left");
  await shot("battle-forfeit");
  await click("#smdPrep [data-act=a-again]");
  await until(`return window.__ws.length===5 && __ws[4].sent.length===1;`, 5000);
  await ev(`__ws[4].emit({t:"busy"}); return 1;`);
  ok(await until(`return /already in a battle/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "busy: already in a battle");
  await shot("battle-busy");
  await click("#smdPrep [data-act=a-again]");
  await until(`return window.__ws.length===6 && __ws[5].sent.length===1;`, 5000);
  await ev(`__ws[5].emit({t:"slow"}); return 1;`);
  ok(await until(`return /Too many tries/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "slow: the queue rate limit");
  await click("#smdPrep [data-act=a-again]");
  await until(`return window.__ws.length===7 && __ws[6].sent.length===1;`, 5000);
  await ev(`__ws[6].emit({t:"match",id:"b3",opp:{name:"Rohan Mehta",rating:1240},n:7,secs:20}); __ws[6].drop(); return 1;`);
  await until(`return window.__ws.length===8;`, 4000);
  await ev(`__ws[7].drop(); return 1;`);
  ok(await until(`return /Connection lost/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "when the reconnect fails too: Connection lost with Try again");
  await shot("battle-lost");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.getElementById("pnCompete");`, 3000), "back from the battle to home");

  // ---- stats with the Arena, then leave
  await click("#smdPrep [data-act=a-stats]");
  ok(await until(`var a=document.getElementById("pnArenaStats"); return !!a && /1255/.test(a.textContent) && /Won/.test(a.textContent);`, 5000), "My stats adds the Arena record");
  ok(await ev(`var r=Array.from(document.querySelectorAll("#pnArenaStats .pn-rec b")).map(function(b){return b.textContent;}).join(","); return r;`) === "1255,3,2,1", "rating 1255, won 3, lost 2, drawn 1 (from player and the battle list)");
  ok(await ev(`return /vs Rohan Mehta/.test(document.getElementById("pnArenaStats").textContent) && /2 right, 1 wrong/.test(document.getElementById("pnArenaStats").textContent);`) === true, "recent battles and event history listed");
  await shot("stats");
  await click("#smdPrep #pnArenaStats [data-act=a-leave]");
  ok(await (async () => { for (let i = 0; i < 30; i++) { if (S.calls.includes("DELETE consent")) return true; await sleep(100); } return false; })() && !S.joined, "Leave the Arena sends DELETE consent");
  ok(await until(`return !!document.getElementById("pnCompete");`, 3000), "leaving returns home");
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
