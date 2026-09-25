/* Video visits (telehealth) - real headless browser.
 *
 * Part 1, the patient's side: the real tele.html in Chrome at phone width, against a stubbed /api/queue/tele/wait and
 * /tele/room (no network). Waiting (place and people ahead), the doctor is ready (a Join button at least 44px tall),
 * Join asks /tele/room and goes to the room address (the navigation is caught), visit ended, link not valid, link
 * expired, polling every 5s that stops once the page is final, one polite status region, no sideways scroll at 375px.
 *
 * Part 2, the desk's side: the real opd.html (?mock=1 preview board) with telehealth on. The Video chip, the three
 * buttons (44px, labelled), the consent sheet (Save stays off until the agreement is ticked) and the exact request
 * bodies of /tele/enable, /tele/start (the room opens in a new tab with noopener) and /tele/send-link (sent / not sent).
 * The routes themselves are tested in the server tests; this checks the screens.
 *
 * USAGE: CHROME=<chrome binary> node test/run-tele-wait-ui.mjs [--shot <dir>]
 *        (as root in a container: CHROME_FLAGS=--no-sandbox)
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.CDP_PORT || 9398);
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tele-wait-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });
const ROOM = "https://video.example.test/wsq-0123456789abcdef0123456789abcdef";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

// ---- the stub server: the repo's static files, and the queue API answering from `mock` -----------------------------
const mock = { wait: { ok: true }, room: { status: 200, body: { ok: true, roomUrl: ROOM } }, sendLink: { ok: true, sent: true, reason: "", url: "https://stewardmd.in/tele?t=x" }, board: null };
const hits = [];   // every API request: { method, path, search, body }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = null; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    hits.push({ method: req.method, path: url.pathname, search: url.search, body });
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/api/queue/tele/wait") return send(200, mock.wait);
    if (url.pathname === "/api/queue/tele/room") return send(mock.room.status, mock.room.body);
    if (url.pathname === "/api/queue/tele/enable") return send(200, { ok: true, ticket: { id: body && body.ticketId, teleconsult: true } });
    if (url.pathname === "/api/queue/tele/start") return send(200, { ok: true, roomUrl: ROOM, tickets: [] });
    if (url.pathname === "/api/queue/tele/send-link") return send(200, mock.sendLink);
    if (url.pathname === "/api/queue/opd-board" && mock.board) return send(200, mock.board);
    return send(200, { ok: true, rooms: [], members: [], events: [] });
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    let data = await readFile(p);
    // opd.html: expose the page's own state and renderer to the test (the page itself is unchanged).
    if (url.pathname === "/opd.html") data = Buffer.from(data.toString().replace("  // Preview mode (?mock=1):", "window.__opdUITest={st:st,render:renderNurseStation};\n  // Preview mode (?mock=1):"));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/";

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const until = async (e, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { const v = await ev(e); if (v && !String(v).startsWith("ERR:")) return v; await sleep(150); } return null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function shot(name) {
  if (!SHOT) return;
  const { result: { data } } = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOT, name + ".png"), Buffer.from(data, "base64")); console.log("   screenshot " + join(SHOT, name + ".png"));
}
const statusText = `var s=document.getElementById("status"); return s?s.textContent.replace(/\\s+/g," ").trim():"";`;
const noSideScroll = `return document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth;`;
const waitHits = () => hits.filter((h) => h.path === "/api/queue/tele/wait").length;

try {
  // Static: the patient page has no em dash in it, and no API it calls carries anything but the token.
  const teleSrc = readFileSync(join(ROOT, "tele.html"), "utf8");
  ok(!/\u2014/.test(teleSrc), "tele.html contains no em dash");

  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    // The room address: caught here, so the test never leaves for a real video server.
    if (m.method === "Fetch.requestPaused") {
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from("<!doctype html><title>Video room</title><p>room</p>").toString("base64") });
    }
  };
  const targetId = (await call("Target.createTarget", { url: "about:blank" })).result.targetId;
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Network.setBlockedURLs", { urls: ["*gstatic.com*"] });
  await call("Fetch.enable", { patterns: [{ urlPattern: "https://video.example.test/*" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });

  // ================= PART 1: tele.html =================
  // 1. Waiting, with a place in the queue.
  mock.wait = { ok: true, video: true, ready: false, closed: false, status: "waiting", position: 3, ahead: 2, clinicName: "City Clinic", clinicLogo: "", doctorStatus: "consulting", lastUpdated: Date.now() };
  await call("Page.navigate", { url: BASE + "tele.html?t=tok-abc" });
  const w = await until(`var t=(function(){${statusText}})(); return /Please wait/.test(t)?t:"";`);
  ok(!!w, "waiting: the status says Please wait (" + (w || "nothing") + ")");
  ok(/2 people are ahead of you/.test(w || "") && /Your place ?3/.test(w || ""), "waiting: place 3 and 2 people ahead are shown");
  ok(await ev(`var r=document.querySelectorAll('[role="status"]'); return r.length===1 && r[0].id==="status" && r[0].getAttribute("aria-live")==="polite";`) === true, "one status region, role=status and aria-live=polite");
  ok(await ev(`return !document.getElementById("join");`) === true, "waiting: no Join button yet");
  ok(await ev(`return /City Clinic/.test(document.querySelector("header").textContent);`) === true, "the clinic's name is in the header (no patient details anywhere)");
  const firstHit = hits.find((h) => h.path === "/api/queue/tele/wait");
  ok(firstHit && firstHit.search === "?t=tok-abc" && firstHit.method === "GET", "it polls GET /api/queue/tele/wait?t=<token> and sends nothing else");
  ok(await ev(noSideScroll) === true, "waiting: no horizontal scroll at 375px");
  await shot("tele-waiting");

  // 2. It keeps polling about every 5 seconds while the visit is open.
  const before = waitHits(); await sleep(5600);
  ok(waitHits() > before, `it polls again within about 5s (${before} then ${waitHits()})`);

  // 3. The doctor starts: Join appears.
  mock.wait = Object.assign({}, mock.wait, { ready: true, status: "in_consultation", position: 0, ahead: 0 });
  const r = await until(`var t=(function(){${statusText}})(); return /The doctor is ready/.test(t)&&document.getElementById("join")?t:"";`, 8000);
  ok(!!r, "ready: the status says The doctor is ready, with a Join button");
  const jh = await ev(`var b=document.getElementById("join"); return b?Math.round(b.getBoundingClientRect().height):0;`);
  ok(jh >= 44, `ready: the Join button is at least 44px tall (${jh}px)`);
  ok(await ev(`var b=document.getElementById("join"); return !!b && !!b.getAttribute("aria-label") && b.tagName==="BUTTON";`) === true, "ready: Join is a labelled button");
  ok(await ev(noSideScroll) === true, "ready: no horizontal scroll at 375px");
  await shot("tele-ready");

  // 4. Join asks /tele/room and goes to the room address.
  mock.room = { status: 200, body: { ok: true, roomUrl: ROOM } };
  const roomBefore = hits.filter((h) => h.path === "/api/queue/tele/room").length;
  await ev(`document.getElementById("join").click(); return 1;`);
  const landed = await until(`return location.href.indexOf(${JSON.stringify(ROOM)})===0?location.href:"";`, 6000);
  const roomHit = hits.filter((h) => h.path === "/api/queue/tele/room");
  ok(roomHit.length === roomBefore + 1 && roomHit[roomHit.length - 1].method === "POST" && roomHit[roomHit.length - 1].search === "?t=tok-abc", "Join POSTs /api/queue/tele/room?t=<token>");
  ok(!!landed, "and the page goes to the room address (" + (landed || "stayed") + ")");

  // 5. Join when the doctor has not really started (409 not_started): back to waiting, no navigation.
  mock.wait = Object.assign({}, mock.wait, { ready: true });
  await call("Page.navigate", { url: BASE + "tele.html?t=tok-abc" });
  await until(`return !!document.getElementById("join");`);
  mock.room = { status: 409, body: { ok: false, error: "not_started" } };
  mock.wait = Object.assign({}, mock.wait, { ready: false, status: "waiting", position: 1, ahead: 0 });
  await ev(`document.getElementById("join").click(); return 1;`);
  const back = await until(`var t=(function(){${statusText}})(); return /Please wait/.test(t)&&/You are next/.test(t)?t:"";`, 5000);
  ok(!!back && (await ev(`return location.pathname;`)) === "/tele.html", "Join before the call starts (not_started) returns to waiting and stays on the page");

  // 6. Visit ended: polling stops.
  mock.wait = { ok: true, video: true, ready: false, closed: true, status: "done", position: 0, ahead: 0, clinicName: "", clinicLogo: "", doctorStatus: "", lastUpdated: Date.now() };
  await call("Page.navigate", { url: BASE + "tele.html?t=tok-abc" });
  const ended = await until(`var t=(function(){${statusText}})(); return /Your video visit has ended/.test(t)?t:"";`);
  ok(!!ended, "closed: the status says Your video visit has ended");
  ok(await ev(`return !document.getElementById("join");`) === true, "closed: no Join button");
  let n0 = waitHits(); await sleep(5600);
  ok(waitHits() === n0, "closed: polling stops");
  await shot("tele-ended");

  // 7. Link not valid: polling stops.
  mock.wait = { ok: false, error: "invalid_link" };
  await call("Page.navigate", { url: BASE + "tele.html?t=bad" });
  const inv = await until(`var t=(function(){${statusText}})(); return /This link is not valid/.test(t)?t:"";`);
  ok(!!inv, "invalid_link: the status says This link is not valid");
  ok(await ev(noSideScroll) === true, "invalid: no horizontal scroll at 375px");
  n0 = waitHits(); await sleep(5600);
  ok(waitHits() === n0, "invalid_link: polling stops");

  // 8. Link expired.
  mock.wait = { ok: false, error: "link_expired" };
  await call("Page.navigate", { url: BASE + "tele.html?t=old" });
  ok(!!(await until(`var t=(function(){${statusText}})(); return /This link has expired/.test(t)?t:"";`)), "link_expired: the status says This link has expired");

  // 9. No token at all: no request is made.
  n0 = waitHits();
  await call("Page.navigate", { url: BASE + "tele.html" });
  ok(!!(await until(`var t=(function(){${statusText}})(); return /No video link/.test(t)?t:"";`)) && waitHits() === n0, "no token: says No video link and asks the server nothing");

  // 10. Dark mode at 375px, ready state.
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  mock.wait = { ok: true, video: true, ready: true, closed: false, status: "in_consultation", position: 0, ahead: 0, clinicName: "A clinic with a rather long name for a small phone screen", clinicLogo: "", doctorStatus: "consulting", lastUpdated: Date.now() };
  await call("Page.navigate", { url: BASE + "tele.html?t=tok-abc" });
  await until(`return !!document.getElementById("join");`);
  ok(await ev(`return getComputedStyle(document.body).backgroundColor==="rgb(17, 26, 30)";`) === true, "dark mode follows the phone's setting");
  ok(await ev(noSideScroll) === true, "dark, long clinic name: no horizontal scroll at 375px");
  await shot("tele-ready-dark");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  ok(errors.length === 0, "tele.html: no script errors" + (errors.length ? " " + errors.join(" | ") : ""));

  // ================= PART 2: opd.html (the desk) =================
  errors.length = 0;
  await call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: BASE + "opd.html?mock=1" });
  ok(!!(await until(`return !!(window.__opdUITest && document.querySelector(".opd-flow-board"));`, 10000)), "opd.html preview board loads");
  // The board the page would get from opd-board: telehealth on, one video visit (t4) and ordinary visits.
  mock.board = JSON.parse(await ev(`var b=JSON.parse(JSON.stringify(__opdUITest.st.opd)); b.ok=true; b.telehealth=true;
    b.rooms[1].tickets[0].teleconsult=true; return JSON.stringify(b);`));
  const renderBoard = async (on) => ev(`__opdUITest.st.telehealth=${on}; var b=${JSON.stringify(mock.board)}; b.telehealth=${on}; __opdUITest.render(b); return 1;`);

  await renderBoard(false);
  ok(await ev(`return document.querySelectorAll('[data-a^="tele"]').length;`) === 0, "telehealth off: no video buttons anywhere");
  ok(await ev(`var n=document.querySelector('[data-t="t4"]').closest(".row"); return /Video/.test(n.querySelector(".tele-chip").textContent);`) === true, "a video visit still shows the Video chip");

  await renderBoard(true);
  const layout = JSON.parse(await ev(`function acts(id){ var n=document.querySelector('.row [data-t="'+id+'"]').closest(".row"); return [].slice.call(n.querySelectorAll('[data-a^="tele"]')).map(function(b){return b.getAttribute("data-a");}).join(","); }
    return JSON.stringify({ t1: acts("t1"), t2: acts("t2"), t3: acts("t3"), t4: acts("t4"), pool: document.querySelectorAll('.pcard [data-a^="tele"]').length,
      chips: [].slice.call(document.querySelectorAll(".tele-chip")).map(function(c){ return c.closest(".row").querySelector("[data-t]").getAttribute("data-t"); }).join(",") });`));
  ok(layout.t1 === "televisit" && layout.t2 === "televisit" && layout.t3 === "televisit", "telehealth on: Video visit on each ordinary live visit (" + [layout.t1, layout.t2, layout.t3].join(" / ") + ")");
  ok(layout.t4 === "telestart,telelink", "a video visit gets Start video and Send video link, not Video visit (" + layout.t4 + ")");
  ok(layout.pool === 0 && layout.chips === "t4", "not offered before a room is assigned; the Video chip only on t4");
  const small = await ev(`return [].slice.call(document.querySelectorAll('[data-a^="tele"]')).filter(function(b){ return b.getClientRects().length && (b.getBoundingClientRect().height<44 || !b.getAttribute("aria-label")); }).map(function(b){ return b.textContent; }).join(",");`);
  ok(small === "", "every video button is at least 44px tall and has an aria-label" + (small ? " (" + small + ")" : ""));

  // Consent sheet.
  await ev(`document.querySelector('.row [data-a="televisit"][data-t="t3"]').click(); return 1;`);
  ok(await ev(`var s=document.getElementById("sheet"); return document.querySelector(".scrim").classList.contains("on") && !!s.querySelector("#tgiv") && !!s.querySelector("#tagr") && s.querySelector("#ok").disabled===true;`) === true, "Video visit opens the consent sheet with Save disabled");
  ok(await ev(`return [].slice.call(document.querySelectorAll("#tgiv option")).map(function(o){return o.value;}).join(",");`) === "patient,parent,legal-guardian,next-of-kin,power-of-attorney", "who agreed: the five people the server accepts");
  ok(/They agreed to a video consultation/.test(await ev(`return document.getElementById("sheet").textContent;`)), "the agreement checkbox reads They agreed to a video consultation");
  await ev(`var c=document.getElementById("tagr"); c.click(); return 1;`);
  ok(await ev(`return document.querySelector("#sheet #ok").disabled;`) === false, "ticking the agreement enables Save");
  await ev(`var s=document.getElementById("tgiv"); s.value="parent"; s.dispatchEvent(new Event("change")); return 1;`);
  const boardsBefore = hits.filter((h) => h.path === "/api/queue/opd-board").length;
  await ev(`document.querySelector("#sheet #ok").click(); return 1;`);
  await until(`return !document.querySelector(".scrim").classList.contains("on");`, 4000);
  const en = hits.filter((h) => h.path === "/api/queue/tele/enable").pop();
  ok(!!en && en.method === "POST" && JSON.stringify(en.body) === JSON.stringify({ sessionId: "s1", ticketId: "t3", teleConsent: { givenBy: "parent", agreed: true } }), "Save POSTs /tele/enable with who agreed and agreed:true " + JSON.stringify(en && en.body));
  await sleep(600);
  ok(hits.filter((h) => h.path === "/api/queue/opd-board").length > boardsBefore, "and the board is loaded again");

  // Start video.
  await renderBoard(true);
  await ev(`window.__opened=[]; window.open=function(){ __opened.push([].slice.call(arguments)); return null; }; document.querySelector('.row [data-a="telestart"][data-t="t4"]').click(); return 1;`);
  const opened = await until(`return window.__opened.length?JSON.stringify(window.__opened[0]):"";`, 4000);
  const st0 = hits.filter((h) => h.path === "/api/queue/tele/start").pop();
  ok(!!st0 && JSON.stringify(st0.body) === JSON.stringify({ sessionId: "s2", ticketId: "t4" }), "Start video POSTs /tele/start " + JSON.stringify(st0 && st0.body));
  ok(opened === JSON.stringify([ROOM, "_blank", "noopener"]), "and opens the room in a new tab with noopener " + opened);
  ok(await ev(`var a=document.querySelector("#sheet #tjoin"); return !!a && a.getAttribute("href")===${JSON.stringify(ROOM)} && /noopener/.test(a.rel) && a.getBoundingClientRect().height>=44;`) === true, "a 44px Open video call link stays in the sheet in case the tab was blocked");
  await ev(`document.querySelector("#sheet #cx").click(); return 1;`);

  // Send video link: not sent, then sent.
  await renderBoard(true);
  mock.sendLink = { ok: true, sent: false, reason: "no_phone", url: "https://stewardmd.in/tele?t=x" };
  await ev(`document.querySelector('.row [data-a="telelink"][data-t="t4"]').click(); return 1;`);
  const t1 = await until(`var t=document.getElementById("toast").textContent; return /Link not sent/.test(t)?t:"";`, 4000);
  ok(/Link not sent: no mobile number on file/.test(t1 || ""), "Send video link, no phone: toast says not sent and why (" + t1 + ")");
  const sl = hits.filter((h) => h.path === "/api/queue/tele/send-link").pop();
  ok(!!sl && JSON.stringify(sl.body) === JSON.stringify({ sessionId: "s2", ticketId: "t4" }), "Send video link POSTs /tele/send-link");
  await renderBoard(true);
  mock.sendLink = { ok: true, sent: true, reason: "", url: "https://stewardmd.in/tele?t=x" };
  await ev(`document.querySelector('.row [data-a="telelink"][data-t="t4"]').click(); return 1;`);
  ok(!!(await until(`return /Video link sent to the patient/.test(document.getElementById("toast").textContent)?1:"";`, 4000)), "Send video link, delivered: toast says sent");

  // Phone width.
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await renderBoard(true);
  ok(await ev(`var bad=[].slice.call(document.querySelectorAll('#app [data-a^="tele"]')).filter(function(n){ return n.getClientRects().length && n.getBoundingClientRect().right>innerWidth+1; }); return document.documentElement.scrollWidth<=innerWidth+1 && !bad.length;`) === true, "opd.html at 375px: no horizontal scroll, no clipped video buttons");
  await shot("opd-tele-375");
  ok(errors.length === 0, "opd.html: no script errors" + (errors.length ? " " + errors.join(" | ") : ""));

  console.log(fails === 0 ? "\nALL GREEN: the video waiting page and the desk's video buttons work" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e && e.stack || e); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); server.close(); try { rmSync(userDir, { recursive: true, force: true }); } catch {} process.exit(fails === 0 ? 0 : 1); }
