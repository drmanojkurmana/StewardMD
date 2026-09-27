/* Admin console: the Bug Centre pane (stewardmd.in/admin), in real headless Chrome against admin/index.html.
 * Owner request 2026-09-27: "create a bug center in admin panel stewardmd.in/admin to solve".
 * Harness pattern from run-admin-dashboard-ui.mjs: fake Firebase at document-start, /api/* answered in-page.
 * USAGE: CHROME=<chrome> node test/run-admin-bugs-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8919/").replace(/\/?$/, "/");
const PORT = 9463, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/admbug-chrome-"+process.pid;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8919"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
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


// Fake owner sign-in + an in-page /api/ai/admin/support* that behaves like the real route.
const H = 3600000;
const BOOT = `
  window.__sent = []; var NOW = Date.now(), H = ${H}; window.__events = []; window.__seq = 0;
  window.__docMsg = function (id, text) { var t = window.__tickets.filter(function (x) { return x.id === id; })[0]; var now = Date.now();
    t.messages.push({ from: "user", text: text, ts: now }); t.unread = true; t.updatedAt = now; window.__push({ ticket: id, owner: t.owner, sender: "user", kind: "msg", text: text, ts: now }); };
  window.__waiters = [];
  window.__push = function (e) { e.seq = ++window.__seq; e.ts = e.ts || Date.now(); window.__events.push(e); var w = window.__waiters; window.__waiters = []; w.forEach(function (f) { f(); }); };
  window.__tickets = [
    { id: "SMD-LATE01", kind: "bug", owner: "fb:d1", email: "late@doc.in", subject: "Bug: ICU chart blank", status: "open", unread: true, createdAt: NOW - 30*H, dueAt: NOW - 6*H, updatedAt: NOW - 30*H,
      platform: "ios", build: "3.1", hasShot: true, bug: { route: "#icu | icuModal", element: { label: "Save", tag: "button", sel: "button#icuSave" }, screen: { w: 390, h: 844, dpr: 3 }, ua: "iPhone OS 26" },
      messages: [{ from: "user", text: "Tapping Save does nothing", ts: NOW - 30*H }] },
    { id: "SMD-SOON02", kind: "bug", owner: "fb:d2", email: "soon@doc.in", subject: "Bug: drug search slow", status: "open", createdAt: NOW - 20*H, dueAt: NOW + 4*H, updatedAt: NOW - 20*H,
      hasShot: false, bug: { route: "#drugs" }, messages: [{ from: "user", text: "Search takes 10 s", ts: NOW - 20*H }] },
    { id: "SMD-FIXD03", kind: "bug", owner: "fb:d3", email: "fixed@doc.in", subject: "Bug: typo", status: "resolved", createdAt: NOW - 50*H, dueAt: NOW - 26*H, resolvedAt: NOW - 40*H, updatedAt: NOW - 40*H,
      hasShot: false, bug: {}, messages: [{ from: "user", text: "typo", ts: NOW - 50*H }] },
    { id: "SMD-HELP04", owner: "fb:d4", email: "help@doc.in", subject: "How do I export?", status: "open", createdAt: NOW - H, updatedAt: NOW - H, messages: [] }
  ];
  var FAKE_USER = { email: "owner@stewardmd.in", getIdToken: function () { return Promise.resolve("faketoken"); } };
  window.firebase = { initializeApp: function () {},
    auth: function () { window.__auth = { currentUser: FAKE_USER, onAuthStateChanged: function (cb) { cb(FAKE_USER); }, signOut: function () {} }; return window.__auth; } };
  window.firebase.auth.GoogleAuthProvider = function () {};
  var realFetch = window.fetch.bind(window);
  function row(t) { var r = {}; ["id","kind","owner","email","subject","status","unread","createdAt","updatedAt","dueAt","resolvedAt"].forEach(function (k) { if (t[k] !== undefined) r[k] = t[k]; }); var m = (t.messages || []).slice(-1)[0]; if (m) r.last = { from: m.from, text: m.text, ts: m.ts }; return r; }
  window.fetch = function (url, opts) {
    opts = opts || {}; url = String(url);
    if (url.indexOf("/api/") !== 0) return realFetch(url, opts);
    window.__sent.push({ url: url, method: opts.method || "GET", body: opts.body || null, auth: opts.headers && opts.headers.Authorization });
    var J = function (d, s) { return Promise.resolve(new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json" } })); };
    if (url.indexOf("/api/ai/admin/support-live") === 0) {
      var am = /after=([0-9]+)/.exec(url);
      if (!am) return J({ ok: true, live: true, seq: window.__seq, events: [] });
      var since = function () { var evs = window.__events.filter(function (e) { return e.seq > +am[1]; }); return { ok: true, live: true, seq: evs.length ? evs[evs.length - 1].seq : +am[1], events: evs }; };
      var wm = /wait=([0-9]+)/.exec(url);
      if (!wm || since().events.length) return J(since());
      // Held like the server: answers the moment an event lands.
      return new Promise(function (res, rej) {
        var done = false, fin = function () { if (done) return; done = true; clearTimeout(tm); res(); };
        var tm = setTimeout(fin, +wm[1] * 1000); window.__waiters.push(fin);
        if (opts.signal) opts.signal.addEventListener("abort", function () { if (done) return; done = true; clearTimeout(tm); rej(new DOMException("aborted", "AbortError")); });
      }).then(function () { return J(since()); });
    }
    if (url.indexOf("/api/ai/admin/support-typing") === 0) return J({ ok: true });
    if (url.indexOf("/api/ai/admin/support-seen") === 0) {
      var sb = JSON.parse(opts.body || "{}"); window.__tickets.forEach(function (t) { if (t.id === sb.id) t.unread = false; }); return J({ ok: true });
    }
    if (url.indexOf("/api/ai/admin/support-shot") === 0) {
      var c = document.createElement("canvas"); c.width = 20; c.height = 40; var g = c.getContext("2d"); g.fillStyle = "#e5484d"; g.fillRect(0, 0, 20, 40);
      return new Promise(function (res) { c.toBlob(function (b) { res(new Response(b, { status: 200, headers: { "Content-Type": "image/png" } })); }); });
    }
    if (url.indexOf("/api/ai/admin/support-reply") === 0) {
      var b = JSON.parse(opts.body || "{}"), t = window.__tickets.filter(function (x) { return x.id === b.id; })[0];
      if (!t) return J({ ok: false, error: "not-found" }, 404);
      if (b.text) t.messages.push({ from: "support", text: b.text, ts: Date.now() });
      if (b.resolve) { t.status = "resolved"; t.resolvedAt = Date.now(); t.hasShot = t.hasShot; }
      else if (b.status) { t.status = b.status; if (b.status !== "resolved") delete t.resolvedAt; }
      return J({ ok: true, ticket: t });
    }
    if (url.indexOf("/api/ai/admin/support") === 0) {
      var m = /[?&]id=([^&]+)/.exec(url);
      if (m) return J({ ticket: window.__tickets.filter(function (x) { return x.id === decodeURIComponent(m[1]); })[0] || null });
      var st = (/[?&]status=([^&]+)/.exec(url) || [])[1] || "";
      var list = window.__tickets.filter(function (t) { return !st || (st === "open" ? t.status !== "resolved" : t.status === st); }).map(row);
      return J({ tickets: list });
    }
    return J({ audit: [], daily: {}, doctors: [], items: [], tickets: [], errors: [], config: {} });
  };
  window.confirm = function () { return true; };
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

  // The selector travels as a CDP ARGUMENT, never spliced into page code (CodeQL: code construction
  // from an unsanitised value).
  const { result: { result: { objectId: gObj } } } = await call("Runtime.evaluate", { expression: "globalThis" });
  const click = async (sel) => {
    const r = await call("Runtime.callFunctionOn", { objectId: gObj, returnByValue: true, arguments: [{ value: sel }],
      functionDeclaration: "function (sel) { var e = document.querySelector(sel); if (!e) return 'missing'; e.click(); return 'ok'; }" });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const waitFor = async (expr, ms = 6000) => { const t0 = Date.now(); do { if (await ev(expr) === true) return true; await sleep(120); } while (Date.now() - t0 < ms); return false; };

  ok(await ev(`return !!document.querySelector('[data-p="bugs"]') && /Help & Support/.test(document.querySelector('[data-p="bugs"]').textContent) && !document.querySelector('[data-p="support"]')`) === true, "the admin sidebar has ONE Help & Support inbox (no separate Support tickets)");
  await click('[data-p="bugs"]');
  ok(await waitFor(`return document.querySelectorAll("#bgBox [data-bug]").length===3`), "Open lists every open conversation: the two open bugs and the open question");
  ok(await waitFor(`return document.getElementById("navBugs").textContent==="1"`), "the badge counts what is waiting on us (1 unread)");
  ok(await ev(`return document.getElementById("bgOpen").textContent==="3" && document.getElementById("bgLate").textContent==="1" && document.getElementById("bgWork").textContent==="0" && document.getElementById("bgFixed").textContent==="1" && document.getElementById("bgSla").textContent==="100%"`) === true,
     "counts: 3 open, 1 bug past the 24 h promise, 0 in progress, 1 solved this week, 100% of bugs fixed within 24 h");
  ok(await ev(`var r=document.querySelectorAll("#bgBox [data-bug]"); return r[0].getAttribute("data-bug")==="SMD-LATE01" && /Overdue 6 h/.test(r[0].innerText) && /Due in 4 h/.test(r[1].innerText)`) === true, "most urgent first: the overdue bug on top, with its hours");
  ok(await ev(`return /Question/.test(document.getElementById("bgBox").innerText) && /How do I export/.test(document.getElementById("bgBox").innerText)`) === true, "questions sit in the same inbox, marked Question");
  await click('#bgFilters [data-bf="help"]');
  ok(await waitFor(`var r=document.querySelectorAll("#bgBox [data-bug]"); return r.length===1 && r[0].getAttribute("data-bug")==="SMD-HELP04"`), "the Questions filter shows only questions");
  await click('#bgFilters [data-bf="open"]');
  await waitFor(`return document.querySelectorAll("#bgBox [data-bug]").length===3`);
  await click('#bgFilters [data-bf="late"]');
  ok(await waitFor(`return document.querySelectorAll("#bgBox [data-bug]").length===1`), "the Overdue filter shows only the late one");
  await click('#bgFilters [data-bf="fixed"]');
  ok(await waitFor(`var r=document.querySelectorAll("#bgBox [data-bug]"); return r.length===1 && /Fixed in 10 h/.test(r[0].innerText)`), "the Fixed filter shows how long the fix took");
  await click('#bgFilters [data-bf="open"]');
  await waitFor(`return document.querySelectorAll("#bgBox [data-bug]").length===2`);

  // ── the detail: everything needed to fix it ──
  await click('#bgBox [data-bug="SMD-LATE01"]');
  ok(await waitFor(`return /ICU chart blank/.test(document.getElementById("bgBox").innerText)`), "opening a bug shows it");
  const detail = await ev(`return document.getElementById("bgBox").innerText`);
  ok(/Save/.test(detail) && /button#icuSave/.test(detail), "with the element the doctor pointed at and its selector");
  ok(/#icu \| icuModal/.test(detail) && /ios 3\.1/.test(detail) && /390x844/.test(detail), "the screen, the app build and the viewport");
  ok(/Tapping Save does nothing/.test(detail), "and what the doctor wrote");
  ok(await waitFor(`var i=document.getElementById("bgShot"); return !!(i && /^blob:/.test(i.src) && i.naturalWidth>0)`), "the screenshot loads through the owner-only route");
  ok(await ev(`return window.__sent.some(function(x){return x.url.indexOf("/api/ai/admin/support-shot?id=SMD-LATE01")===0 && x.auth==="Bearer faketoken"})`) === true, "with the owner's token");
  if (process.env.SHOT) { const s = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(s.result.data, "base64")); }

  // ── working on it -> reply -> fixed ──
  await click("#bgWorkBtn");
  ok(await waitFor(`return window.__tickets[0].status==="in_progress"`), "Working on it marks it in progress (the doctor sees it)");
  ok(await waitFor(`return /Working on it/.test(document.getElementById("bgBox").innerText) && !document.getElementById("bgWorkBtn")`, 4000), "and the page shows it");
  await ev(`document.getElementById("bgTx").value=""; return 1;`); await click("#bgReplyBtn");
  ok(await waitFor(`return /Write a reply first/.test(document.getElementById("bgTMsg").textContent)`), "an empty reply is caught");
  await ev(`document.getElementById("bgTx").value="Found it, the save handler threw on iOS 26."; return 1;`); await click("#bgReplyBtn");
  ok(await waitFor(`var t=window.__tickets[0]; return t.messages.some(function(m){return m.from==="support" && /save handler/.test(m.text)})`), "Reply goes to the doctor");
  ok(await waitFor(`return /Found it, the save handler/.test(document.getElementById("bgBox").innerText)`), "and appears in the thread");
  await click("#bgFixBtn");
  ok(await waitFor(`return window.__tickets[0].status==="resolved"`), "Mark fixed & notify resolves it");
  ok(await ev(`var b=JSON.parse(window.__sent.filter(function(x){return /support-reply/.test(x.url)}).pop().body); return b.resolve===true && /next app update/.test(b.text)`) === true, "with a default note to the doctor when none was typed");
  ok(await waitFor(`return !!document.getElementById("bgReopenBtn") && /Screenshot deleted when fixed/.test(document.getElementById("bgBox").innerText)`), "a fixed bug offers Reopen and says the screenshot is gone");
  await click("#bgReopenBtn");
  ok(await waitFor(`return window.__tickets[0].status==="open"`), "Reopen puts it back in the queue");

  // ── copy for GitHub: plain text, no screenshot ──
  await ev(`window.__copied=null; try{ Object.defineProperty(navigator,"clipboard",{value:{writeText:function(t){window.__copied=t; return Promise.resolve();}},configurable:true}); }catch(e){} return 1;`);
  await waitFor(`return !!document.getElementById("bgCopyBtn")`);
  await click("#bgCopyBtn");
  ok(await waitFor(`return typeof window.__copied==="string" && /Bug SMD-LATE01/.test(window.__copied) && /button#icuSave/.test(window.__copied) && /Tapping Save does nothing/.test(window.__copied)`), "Copy for GitHub gives a plain-text summary");
  await click("#bgBack");
  ok(await waitFor(`return document.querySelectorAll("#bgBox [data-bug]").length===3`), "back to the list");

  // ── LIVE: the doctor writes while the developer has the conversation open ──
  await click('#bgBox [data-bug="SMD-SOON02"]');
  ok(await waitFor(`return /drug search slow/.test(document.getElementById("bgBox").innerText)`), "open another conversation");
  ok(await waitFor(`return window.__sent.some(function(x){return /support-seen/.test(x.url) && /SMD-SOON02/.test(x.body||"")})`), "opening it tells the doctor it was Seen");
  ok(await waitFor(`return window.__sent.some(function(x){return /support-live[?]after=[0-9]+&wait=20&fast=1/.test(x.url)})`), "the open conversation holds a fast long-poll");
  await ev(`var x=document.getElementById("bgTx"); x.focus(); x.value="half-typed reply"; x.dispatchEvent(new Event("input")); return 1;`);
  ok(await waitFor(`return window.__sent.some(function(x){return /support-typing/.test(x.url) && /SMD-SOON02/.test(x.body||"")})`), "the doctor is told the developer is typing");
  await ev(`window.__push({ ticket: "SMD-SOON02", owner: "fb:x", sender: "user", kind: "typing" }); return 1;`);
  ok(await waitFor(`return /Doctor is typing/.test(document.getElementById("bgBox").innerText)`, 3000), "and the developer sees \"Doctor is typing\"");
  await ev(`window.__t0=Date.now(); window.__docMsg("SMD-SOON02", "It is worse on 4G"); return 1;`);
  ok(await waitFor(`return /It is worse on 4G/.test(document.getElementById("bgBox").innerText)`, 8000), "the doctor's new message appears, no reload");
  const lat = await ev(`return Date.now()-window.__t0`);
  ok(lat < 800, "at once, like a messenger (" + lat + " ms)");
  ok(await ev(`return document.getElementById("bgTx").value==="half-typed reply" && document.activeElement===document.getElementById("bgTx")`) === true, "without losing what the developer was typing, or the cursor");
  ok(await ev(`return !/Doctor is typing/.test(document.getElementById("bgBox").innerText)`) === true, "the typing line gives way to the message");

  console.log(fails === 0 ? "\nALL GREEN - admin Help & Support inbox: every kind, counts, urgency order, detail, LIVE doctor messages, Seen, reply, fix, reopen, copy" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
