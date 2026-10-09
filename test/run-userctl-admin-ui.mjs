/* Real-browser test: admin console > User control (owner, 2026-10-08: "control users who just signed up,
 * see their profile, activate or deactivate, give any subscription, set limits for that account and see
 * usage by account"). Same harness as run-ota-admin-ui.mjs: a fake owner sign-in and fake API answers are
 * installed at document-start; the page is driven only by real clicks and typing.
 *   CHROME=<chrome> node test/run-userctl-admin-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9439, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/userctl-admin-chrome-" + Date.now();
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

const NOW = Date.now(), DAY = 86400000;
const USERS = [
  { uid: "u-new", email: "new.doc@gmail.com", name: "Asha Rao", phone: "", phoneVerified: false, provider: "google.com", signedUpAt: NOW - 3600e3, lastLoginAt: NOW, disabled: false, exists: true, status: "unverified", reviewReason: "", role: "", pro: false, proExp: null, freeWeekUntil: null },
  { uid: "u-pend", email: "sravani.ysn@gmail.com", name: "Sravani Yarrarapu", phone: "+919121974928", phoneVerified: true, provider: "google.com", signedUpAt: NOW - 2 * DAY, lastLoginAt: NOW - DAY, disabled: false, exists: true, status: "pending", reviewReason: "no_nmc_match", role: "doctor", pro: false, proExp: null, freeWeekUntil: NOW + 5 * DAY },
];
const DETAIL = { ok: true, account: USERS[1], claims: { provUntil: NOW + 5 * DAY, phoneVerified: true }, lifecycle: { firstSeen: NOW - 2 * DAY },
  profile: { name: "Sravani Yarrarapu", phone: "+919121974928", hospital: "Gandhi Medical College", degree: "MBBS", smdId: "SMD-MAVWWX" },
  verification: { status: "pending", reason: "no_nmc_match", role: "doctor", nameRead: "SIVA NAGA SRAVANI YARRARAPU", regNoRead: "100286", council: "Delhi Medical Council", confidence: 0.95, hasPhoto: true },
  plan: { tier: "free", tierExp: null, role: "physician", smdId: "SMD-MAVWWX", aiCapTokens: null, monthUsage: { used: 1200, cap: 50000 } },
  features: [{ key: "scribe_dictation", label: "MaiK Scribe clinical dictation", allowed: true, explicit: null }],
  limits: [{ id: "maik", label: "MaiK", defaultLimit: 50, limit: null }, { id: "research", label: "Evidence review", defaultLimit: 2, limit: null }],
  usage: [{ day: "2026-10-08", req: 4, tokens: 5200, costInr: 0.42, byModule: { maik: 4 } }, { day: "2026-10-07", req: 1, tokens: 900, costInr: 0.05, byModule: { maik: 1 } }] };

const BOOT = `
  window.__sent = [];
  var USERS = ${JSON.stringify(USERS)}, DETAIL = ${JSON.stringify(DETAIL)};
  var FAKE_USER = { email: "owner@stewardmd.in", getIdToken: function () { return Promise.resolve("faketoken"); } };
  window.firebase = { initializeApp: function () {}, auth: function () { return { currentUser: FAKE_USER, onAuthStateChanged: function (cb) { cb(FAKE_USER); }, signOut: function () {} }; } };
  window.firebase.auth.GoogleAuthProvider = function () {};
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {}; var u = String(url);
    if (u.indexOf("/api/") !== 0) return realFetch(url, opts);
    window.__sent.push({ url: u, method: opts.method || "GET", body: opts.body || null });
    var body = { ok: true };
    if (u.indexOf("/api/ai/admin/users-recent") === 0) {
      var p = new URL(u, location.origin).searchParams, f = p.get("filter"), q = (p.get("q") || "").toLowerCase();
      var list = USERS.filter(function (x) { return (f === "all" || !f || (f === "pending" && x.status === "pending")) && (!q || (x.email + x.name + x.phone).toLowerCase().indexOf(q) >= 0); });
      body = { ok: true, days: +p.get("days"), counts: { total: 2, today: 1, week: 2 }, users: list };
    } else if (u.indexOf("/api/ai/admin/user-detail") === 0) body = DETAIL;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
  window.confirm = function () { return true; };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "https://www.gstatic.com/firebasejs/*" }] });
  wireFetchBlock();
  await call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });
  await call("Page.navigate", { url: BASE + "admin/index.html" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return !!document.getElementById("nav")`) === true) { ready = true; break; } }
  if (!ready) throw new Error("admin console did not load");
  await sleep(400);
  const sent = () => J(`return JSON.stringify(window.__sent.map(function (s) { return s.method + " " + s.url + (s.body ? " " + s.body : ""); }))`);

  await ev(`window.__sent = []; document.querySelector('[data-p="userctl"]').click(); return 1;`); await sleep(500);
  const list = await J(`return JSON.stringify({ rows: document.querySelectorAll("#ucList .uc-row").length, first: (document.querySelector("#ucList .uc-row .nm")||{}).textContent, today: document.getElementById("ucToday").textContent, tags: (document.querySelectorAll("#ucList .uc-row")[1]||{}).textContent })`);
  ok(list.rows === 2 && list.first === "Asha Rao", `opening User control lists the newest sign-ups first (${JSON.stringify(list)})`);
  ok(list.today === "1", "signed up today is counted");
  ok(/Needs review/.test(list.tags) && /Free week/.test(list.tags) && /Not found on the national register/.test(list.tags), "a row says it needs review, why, and that the free week is on");

  await ev(`document.querySelector('[data-ucf="pending"]').click(); return 1;`); await sleep(400);
  ok((await sent()).some((s) => /users-recent\?days=30&filter=pending/.test(s)), "Needs review filter asks the server for pending accounts");
  ok(await ev(`return document.querySelectorAll("#ucList .uc-row").length`) === 1, "and shows only those");

  await ev(`document.querySelector("#ucList .uc-row").click(); return 1;`); await sleep(500);
  const det = await ev(`return document.getElementById("ucDetail").innerText`);
  ok(/Sravani Yarrarapu/.test(det) && /SMD-MAVWWX/.test(det) && /Gandhi Medical College/.test(det), "the detail shows the profile and StewardMD ID");
  ok(/SIVA NAGA SRAVANI YARRARAPU/.test(det) && /100286/.test(det) && /Delhi Medical Council/.test(det), "and what was read off the certificate");
  ok(/Questions/.test(det) && /Rs 0\.47/.test(det.replace(/\s+/g, " ")), "and 7-day usage with a total cost");
  ok(await ev(`return !!document.querySelector('#ucDetail a[href^="https://wa.me/919121974928"]')`), "WhatsApp link to the doctor");

  const act = async (js, re, label) => { await ev(`window.__sent = []; ${js}; return 1;`); await sleep(500); const s = await sent(); ok(s.some((x) => re.test(x)), label + " " + JSON.stringify(s.filter((x) => x.indexOf("POST") === 0))); };
  await act(`document.querySelector('#ucDetail [data-uv="approve"]').click()`, /POST \/api\/verifications\/approve \{"uid":"u-pend","regNo":"100286"\}/, "Approve calls the verification approve with the number read");
  await act(`document.querySelector('#ucDetail [data-ua="disable"]').click()`, /POST \/api\/ai\/admin\/user-action \{"email":"sravani\.ysn@gmail\.com","action":"disable"\}/, "Deactivate sign-in");
  await act(`document.getElementById("ucTier").value="ultimate"; document.getElementById("ucDur").value="forever"; document.getElementById("ucGive").click()`, /POST \/api\/entitlements\/admin\/set-plan \{"uid":"u-pend","tier":"ultimate","forever":true\}/, "Give plan: Ultimate with no end date");
  await act(`var s=document.querySelector('#ucDetail [data-ff="scribe_dictation"]'); s.value="off"; s.dispatchEvent(new Event("change"))`, /set-flag \{"uid":"u-pend","feature":"scribe_dictation","enabled":false\}/, "Turn a feature off for this account");
  await act(`var i=document.querySelector('#ucDetail [data-ul="maik"]'); i.value="20"; i.dispatchEvent(new Event("change"))`, /user-limit \{"email":"sravani\.ysn@gmail\.com","module":"maik","limit":20\}/, "Set this account's MaiK daily limit");
  await act(`document.getElementById("ucBudget").value="80000"; document.getElementById("ucBudgetSave").click()`, /set-budget \{"uid":"u-pend","tokens":80000\}/, "Set this account's monthly AI budget");
  ok(!/—/.test(await ev(`return document.getElementById("pane-userctl").innerText`)), "no em dash on the pane");
  await ev(`document.querySelector("#ucDetail .uc-sec:nth-of-type(3)").scrollIntoView(); return 1;`); await sleep(200);
  await call("Page.captureScreenshot", { format: "png" }).then(async (r) => { const { writeFile } = await import("node:fs/promises"); await writeFile((process.env.OUT || "/tmp") + "/userctl.png", Buffer.from(r.result.data, "base64")); });
} catch (e) { console.log("❌ harness: " + e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN"); process.exit(fails ? 1 : 0);
