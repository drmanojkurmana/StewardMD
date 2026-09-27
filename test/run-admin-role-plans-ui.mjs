/* Owner controls for the role-plans rollout (2026-09-26), real admin pages in headless Chrome with a
 * fake Firebase owner and a stubbed API (same pattern as run-admin-dashboard-ui.mjs):
 *   - admin/verifications.html "Legacy trainees": lists students/interns approved before approve-by-role
 *     and re-approves each with the role chosen on its row;
 *   - admin/index.html User Entitlements "Plan": sends set-plan with days / forever;
 *   - admin/index.html "Ultimate for friends and testers": dry run first (nothing written), Convert sends
 *     ONLY the ticked uids, paying subscribers listed apart and never pre-ticked.
 * USAGE: node test/run-admin-role-plans-ui.mjs   (CHROME=... CHROME_FLAGS=--no-sandbox) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9436, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/admin-role-plans-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8921"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
// Values reach the page as call ARGUMENTS (Runtime.callFunctionOn), never spliced into code, so no test
// value can change what runs in the page. The function sources below are fixed literals.
async function callFn(fnSrc, ...args) {
  const w = await call("Runtime.evaluate", { expression: "window" });
  const r = await call("Runtime.callFunctionOn", { objectId: w.result.result.objectId, functionDeclaration: fnSrc, arguments: args.map((v) => ({ value: v })), returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const BOOT = `
  window.__sent = [];
  var FAKE_USER = { email: "owner@stewardmd.in", getIdToken: function () { return Promise.resolve("faketoken"); } };
  window.firebase = { initializeApp: function () {}, auth: function () { window.__auth = { currentUser: FAKE_USER, onAuthStateChanged: function (cb) { cb(FAKE_USER); }, signOut: function () {}, signInWithPopup: function () { return Promise.resolve(); } }; return window.__auth; } };
  window.firebase.auth.GoogleAuthProvider = function () {};
  window.confirm = function () { return true; };
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var u = String(url);
    if (u.indexOf("/api/") < 0) return realFetch(url, opts);
    var body = opts.body ? JSON.parse(opts.body) : null;
    window.__sent.push({ url: u, method: opts.method || "GET", body: body });
    var d = { ok: true };
    if (u.indexOf("/api/verifications/legacy-trainees") >= 0) d = { ok: true, dryRun: true, count: 2, items: [
      { uid: "legacyA", email: "a@college.in", role: "intern", status: "verified", regNo: "INT-1", verifiedAt: "2026-09-10" },
      { uid: "legacyB", email: "b@college.in", role: "student", status: "verified", regNo: "STU-2", verifiedAt: "2026-09-01" } ] };
    else if (u.indexOf("/api/verifications/approve") >= 0) d = { ok: true, doctor: { uid: body.uid, role: body.role } };
    else if (u.indexOf("/api/verifications") >= 0) d = { ok: true, doctors: [] };
    else if (u.indexOf("/api/entitlements/admin/ultimate-migration") >= 0) d = body && body.dryRun === false
      ? { ok: true, dryRun: false, converted: body.uids.map(function (x) { return { uid: x, tierExp: null }; }), skipped: [] }
      : { ok: true, dryRun: true, candidates: [{ uid: "friend1", email: "f1@x.in", source: "manual", proExp: null }, { uid: "friend2", email: "f2@x.in", source: "coupon", proExp: 1893456000000 }, { uid: "done1", email: "d@x.in", source: "manual", proExp: null, tier: "ultimate" }], paying: [{ uid: "payer1", email: "p@x.in", source: "subscription", proExp: 1800000000000 }] };
    else if (u.indexOf("/api/entitlements/admin/lookup") >= 0) d = { ok: true, uid: "u9", smdId: "SMD-ABC123", email: "doc@x.in", role: "physician", tier: "free", tierExp: null, pro: false, verified: true, regNo: "R1", effectiveTiers: {}, overrides: {}, premiumModels: {}, features: [], usage: { used: 0, cap: 0, remaining: 0, resetMonth: "2026-09" } };
    else if (u.indexOf("/api/entitlements/admin/set-plan") >= 0) d = { ok: true, uid: body.uid, tier: body.tier, tierExp: null };
    else d = { ok: true, doctors: [], items: [], audit: [], daily: {}, config: { flags: {}, banners: [] }, tickets: [], errors: [] };
    return Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
`;
const sent = (frag) => callFn("function (frag) { return window.__sent.filter(function (x) { return x.url.indexOf(frag) >= 0; }); }", frag);

async function open(path, selectors) {
  await call("Page.navigate", { url: BASE + path });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await callFn("function (sels) { return sels.every(function (s) { return !!document.querySelector(s); }); }", selectors) === true) return true; }
  return false;
}
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Fetch.requestPaused") { call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }); return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "https://www.gstatic.com/firebasejs/*" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });

  // 1) Legacy trainees
  ok(await open("admin/verifications.html", ["[data-f=legacy]"]), "verifications page shows a 'Legacy trainees' filter");
  await ev(`document.querySelector("[data-f=legacy]").click(); return 1;`); await sleep(300);
  await ev(`var r=document.getElementById("reload"); if(r) r.click(); return 1;`); await sleep(800);
  const rows = await J(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll("[data-approve]"),function(b){ var u=b.getAttribute("data-approve"), s=document.querySelector('[data-role-for="'+u+'"]'); return {uid:u, role:s&&s.value}; }))`);
  ok(rows.length === 2 && rows[0].role === "intern" && rows[1].role === "student", "both legacy approvals listed with their stored role pre-selected: " + JSON.stringify(rows));
  const legacyHint = await ev(`return document.getElementById("list").innerText`);
  ok(/Students and interns lose prescribing/.test(legacyHint) && !/—/.test(legacyHint), "explains the effect in plain words, no em-dash");
  await ev(`var s=document.querySelector('[data-role-for="legacyA"]'); s.value="resident"; document.querySelector('[data-approve="legacyA"]').click(); return 1;`); await sleep(600);
  const ap = await sent("/api/verifications/approve");
  ok(ap.length === 1 && ap[0].body.uid === "legacyA" && ap[0].body.role === "resident", "Approve re-issues with the chosen role (intern corrected to resident): " + JSON.stringify(ap.map((x) => x.body)));

  // 2) Plan setter + 3) Ultimate card on the admin console
  ok(await open("admin/index.html", ["#ultList", "#entlLookup"]), "admin console shows the Ultimate card and User Entitlements");
  await ev(`document.getElementById("ultList").click(); return 1;`); await sleep(700);
  const listed = await J(`return JSON.stringify({ picks: Array.prototype.map.call(document.querySelectorAll(".ultPick"),function(b){return {uid:b.value,checked:b.checked};}), text: document.getElementById("ultResult").innerText, convertDisabled: document.getElementById("ultConvert").disabled })`);
  ok(listed.picks.length === 4 && listed.picks.every((p) => !p.checked), "dry run lists 4 accounts, none pre-ticked");
  ok(await ev(`return document.querySelector('.ultPick[value="done1"]').disabled`) === true && /already Ultimate/.test(listed.text), "an account already Ultimate is marked and cannot be ticked");
  ok(/PAYING/.test(listed.text) && /Paying subscribers \(1\)/.test(listed.text), "paying subscriber listed apart and marked");
  const dry = await sent("/ultimate-migration");
  ok(dry.length === 1 && dry[0].body.dryRun === true, "listing is a dry run (nothing written)");
  await ev(`document.querySelector('.ultPick[value="friend1"]').click(); document.querySelector('.ultPick[value="friend2"]').click(); document.getElementById("ultConvert").click(); return 1;`); await sleep(700);
  const conv = (await sent("/ultimate-migration")).filter((x) => x.body && x.body.dryRun === false);
  ok(conv.length === 1 && JSON.stringify(conv[0].body.uids) === JSON.stringify(["friend1", "friend2"]), "Convert sends only the ticked uids (payer untouched): " + JSON.stringify(conv.map((x) => x.body.uids)));
  const umsg = await ev(`return document.getElementById("ultMsg").textContent`);
  ok(/Converted 2/.test(umsg), "reports the result: " + umsg);

  await ev(`document.getElementById("entlId").value="SMD-ABC123"; document.getElementById("entlLookup").click(); return 1;`); await sleep(700);
  ok(await ev(`return !!document.getElementById("entlPlan")`), "User Entitlements shows a Plan control");
  const opts = await J(`return JSON.stringify(Array.prototype.map.call(document.getElementById("entlPlan").options,function(o){return o.value;}))`);
  ok(opts.indexOf("ultimate") >= 0 && opts.indexOf("physicianpro") >= 0 && opts[0] === "free", "plan list includes free .. ultimate: " + opts.join(","));
  await ev(`document.getElementById("entlPlan").value="ultimate"; document.getElementById("entlPlanForever").checked=true; document.getElementById("entlSavePlan").click(); return 1;`); await sleep(600);
  const sp = await sent("/set-plan");
  ok(sp.length === 1 && sp[0].body.tier === "ultimate" && sp[0].body.forever === true && sp[0].body.uid === "u9", "Save plan sends set-plan {uid, tier:ultimate, forever}: " + JSON.stringify(sp.map((x) => x.body)));
  await ev(`document.getElementById("entlPlan").value="physician"; document.getElementById("entlPlanForever").checked=false; document.getElementById("entlPlanDays").value="30"; document.getElementById("entlSavePlan").click(); return 1;`); await sleep(600);
  const sp2 = (await sent("/set-plan"))[1];
  ok(sp2 && sp2.body.tier === "physician" && sp2.body.days === 30 && !sp2.body.forever, "a plan with days sends days: " + JSON.stringify(sp2 && sp2.body));
} catch (e) { console.log("FAIL harness: " + (e && e.message || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
