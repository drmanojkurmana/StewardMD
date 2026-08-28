/* Admin console · App updates (OTA) pane — real headless Chrome against the actual admin/index.html.
 *
 * functions/_ota.js is covered by test/ota.test.mjs (pure logic, no HTTP). This test covers the OTHER
 * way the feature can break: the console calling the wrong endpoint, sending the wrong payload, or
 * rendering the wrong thing — none of which a server-side unit test would ever catch.
 *
 * admin/index.html wraps its ENTIRE script in `(function(){ ... })()` — deliberately, so nothing it
 * declares (auth, PANES, goPane, ...) leaks onto window for a stray global to collide with. That
 * means this test cannot reach in and call goPane()/inspect `auth` directly; it drives the page the
 * only way a real admin would — real clicks — and gets Firebase auth into the closure by replacing
 * `window.firebase` BEFORE the script runs (via Page.addScriptToEvaluateOnNewDocument), which the
 * script's own `auth = firebase.auth()` then picks up as normal. fetch is intercepted the same way,
 * for /api/ota/* only, to serve canned responses and record what the console actually sent.
 * USAGE: node test/run-ota-admin-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9438, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ota-admin-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
// This test environment DOES have outbound internet: the real Firebase SDK loads from gstatic.com and
// would overwrite our fake `window.firebase` the instant it does. Fail those two requests at the
// network layer so the fake stub (injected at document-start, before either script tag) survives —
// a CI run must never depend on Google's CDN being reachable, or on it NOT being reachable either.
function wireFetchBlock() {
  const orig = ws.onmessage;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Fetch.requestPaused") { call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }); return; }
    orig(e);
  };
}

const CANDIDATE = { commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", message: "fix ICU acuity", manifestKey: "ota/manifests/a1b2.json", builtAt: "2026-08-22T10:00:00Z", totalFiles: 814, totalBytes: 93000000 };
const CHANNEL = { version: 3, commit: "9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f", message: "prior release", publishedAt: "2026-08-21T09:00:00Z", publishedBy: "owner@stewardmd.in", minNativeBuild: 0 };
const HISTORY = [
  { version: 3, action: "publish", commit: CHANNEL.commit, message: "prior release", at: CHANNEL.publishedAt, by: "owner@stewardmd.in", manifestKey: "ota/manifests/9f9f.json" },
  { version: 2, action: "kill", at: "2026-08-20T09:00:00Z", by: "owner@stewardmd.in" },
];

// Runs at document-start, BEFORE the page's own script — so its closure-local `auth = firebase.auth()`
// picks up this fake implementation, and its unqualified `fetch(...)`/`confirm(...)` calls resolve to
// these overrides via the normal global scope chain (an IIFE closure doesn't insulate against that).
const BOOT = `
  window.__sent = [];
  window.__killOn = false;
  window.__alerts = [];
  var CANDIDATE = ${JSON.stringify(CANDIDATE)};
  var CHANNEL = ${JSON.stringify(CHANNEL)};
  var HISTORY = ${JSON.stringify(HISTORY)};
  var FAKE_USER = { email: "owner@stewardmd.in", getIdToken: function () { return Promise.resolve("faketoken"); } };
  window.firebase = {
    initializeApp: function () {},
    auth: function () { return { currentUser: FAKE_USER, onAuthStateChanged: function (cb) { cb(FAKE_USER); }, signOut: function () {} }; }
  };
  window.firebase.auth.GoogleAuthProvider = function () {};
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    if (String(url).indexOf("/api/ota/") !== 0) return realFetch(url, opts);
    window.__sent.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
    var body;
    if (url === "/api/ota/candidate") body = { ok: true, candidate: CANDIDATE };
    else if (url === "/api/ota/channel") body = { ok: true, channel: CHANNEL, kill: { on: window.__killOn } };
    else if (url === "/api/ota/history") body = { ok: true, history: HISTORY };
    else if (url === "/api/ota/publish") body = { ok: true, channel: Object.assign({}, CHANNEL, { version: 4, commit: CANDIDATE.commit }) };
    else if (url === "/api/ota/kill") { window.__killOn = JSON.parse(opts.body).on; body = { ok: true, kill: { on: window.__killOn } }; }
    else if (url === "/api/ota/rollback") body = { ok: true, channel: Object.assign({}, CHANNEL, { version: 5 }) };
    else body = { error: "unhandled-in-test:" + url };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
  window.confirm = function () { return true; };
  window.alert = function (m) { window.__alerts.push(m); };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "https://www.gstatic.com/firebasejs/*" }] });
  wireFetchBlock();
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });   // must exist before the page's own IIFE runs
  await call("Page.navigate", { url: BASE + "admin/index.html" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return !!document.getElementById("nav")`) === true) { ready = true; break; } }
  if (!ready) throw new Error("admin console did not load");
  await sleep(400);   // let the fake onAuthStateChanged callback + showActivePane() settle

  const signedIn = await ev(`return document.getElementById("who").textContent;`);
  ok(/owner@stewardmd\.in/.test(signedIn || ""), `the fake sign-in took (header shows "${signedIn}")`);

  // Open the pane exactly the way a real admin does: click the sidebar link.
  const opened = await J(`
    document.querySelector('[data-p="ota"]').click();
    return JSON.stringify({ visible: document.getElementById("pane-ota").classList.contains("on"), title: document.getElementById("hTitle").textContent });
  `);
  ok(opened.visible === true, `the OTA pane opens on a real nav click`);
  ok(opened.title === "App updates (OTA)", `header title updates (got "${opened.title}")`);
  await sleep(300);

  const rendered = await J(`
    return JSON.stringify({
      candidateHtml: document.getElementById("otaCandidate").innerHTML,
      channelHtml: document.getElementById("otaChannel").innerHTML,
      killBtn: document.getElementById("otaKillBtn").textContent,
      historyRows: document.querySelectorAll("#otaHistory .list-item").length,
      calls: window.__sent.map(function (s) { return s.method + " " + s.url; })
    });
  `);
  ok(/814 files/.test(rendered.candidateHtml) && /93\.0 MB/.test(rendered.candidateHtml), `candidate shows file count + size (${rendered.candidateHtml})`);
  ok(/Version <b>3<\/b>/.test(rendered.channelHtml), `live channel shows the current version`);
  ok(/owner@stewardmd\.in/.test(rendered.channelHtml), `live channel shows who published it`);
  ok(/Turn ON/.test(rendered.killBtn), `kill switch shows OFF state correctly (button offers to turn it ON)`);
  ok(rendered.historyRows === 2, `history renders both entries (got ${rendered.historyRows})`);
  ok(rendered.calls.includes("GET /api/ota/candidate") && rendered.calls.includes("GET /api/ota/channel") && rendered.calls.includes("GET /api/ota/history"), `all three reads fire on open (${JSON.stringify(rendered.calls)})`);

  // Push to devices. api() goes through getIdToken() — a real Promise — before it ever calls fetch(),
  // so the network call lands in a microtask AFTER the click handler already returned; every
  // click-then-read pair here is two separate round trips with a settle in between, not one.
  await ev(`window.__sent = []; document.getElementById("otaPublish").click(); return 1;`);
  await sleep(250);
  const published = await J(`return JSON.stringify({ sent: window.__sent });`);
  ok(published.sent.length >= 1 && published.sent[0].method === "POST" && published.sent[0].url === "/api/ota/publish", `Push to devices POSTs /api/ota/publish (${JSON.stringify(published.sent)})`);
  const afterPublish = await ev(`return document.getElementById("otaMsg").textContent;`);
  ok(/v4/.test(afterPublish || ""), `success message reflects the new live version (got "${afterPublish}")`);

  // Kill switch: OFF -> ON, correct payload
  await ev(`window.__sent = []; document.getElementById("otaKillBtn").click(); return 1;`);
  await sleep(250);
  const killed = await J(`return JSON.stringify({ sent: window.__sent });`);
  ok(killed.sent[0] && killed.sent[0].url === "/api/ota/kill", `kill button POSTs /api/ota/kill FIRST (${JSON.stringify(killed.sent)})`);
  ok(killed.sent[0] && JSON.parse(killed.sent[0].body).on === true, `turning the switch ON sends {on:true} (got ${killed.sent[0] && killed.sent[0].body})`);
  await sleep(250);
  const killBtnNow = await ev(`return document.getElementById("otaKillBtn").textContent;`);
  ok(/currently BLOCKED/.test(killBtnNow || ""), `after killing, the button reflects the blocked state (got "${killBtnNow}")`);

  // Kill switch: ON -> OFF
  await ev(`window.__sent = []; document.getElementById("otaKillBtn").click(); return 1;`);
  await sleep(250);
  const unkilled = await J(`return JSON.stringify({ sent: window.__sent });`);
  ok(unkilled.sent[0] && unkilled.sent[0].url === "/api/ota/kill" && JSON.parse(unkilled.sent[0].body).on === false, `turning it back OFF sends {on:false} (${JSON.stringify(unkilled.sent)})`);

  // Rollback
  const foundBtn = await ev(`return !!document.querySelector('[data-ota-rollback="3"]');`);
  ok(foundBtn === true, `history offers a "Roll back to this" action on a real published version`);
  await ev(`window.__sent = []; var b=document.querySelector('[data-ota-rollback="3"]'); if(b) b.click(); return 1;`);
  await sleep(250);
  const rolled = await J(`return JSON.stringify({ sent: window.__sent });`);
  ok(rolled.sent[0] && rolled.sent[0].url === "/api/ota/rollback" && JSON.parse(rolled.sent[0].body).toVersion === 3, `rollback POSTs the exact version clicked (${JSON.stringify(rolled.sent)})`);
  const noRollbackOnKill = await ev(`return !document.querySelector('[data-ota-rollback="2"]');`);
  ok(noRollbackOnKill === true, `a kill/unkill history row (no manifest) does NOT offer a rollback button`);

  console.log(fails === 0 ? "\nALL GREEN — the OTA admin console pane is wired correctly end to end" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
