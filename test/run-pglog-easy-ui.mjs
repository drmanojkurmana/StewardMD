/* NMC eLOGBook easy mode (smd_pglog_easy), driven in a real headless browser against the real app.
 *
 * Residents called the eLogbook "a very hard, strict framework". Easy mode changes the words and the
 * number of taps, never a rule. This harness asserts each simplification in the browser, that
 * `smd_pglog_easy=0` restores the previous screens, and that the rules that make the logbook worth
 * anything still hold: every entry is verified by its own call, one at a time; the role is never
 * pre-selected; a refused submission is explained instead of being "queued"; and nothing here asks
 * for a reason through window.prompt().
 *
 * Stubs: a signed-in account and /api/pglog answered in-page from window.__srv (no network, no PHI).
 *
 * USAGE: BASE=http://localhost:8994/ CHROME=<chrome> CHROME_FLAGS=--no-sandbox node test/run-pglog-easy-ui.mjs
 *        SHOTS=<dir> also writes 390px screenshots of the resident home, quick log, guide queue and
 *        month card.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9433, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pgle-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const dialogs = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (c) passes++; else fails++; };
const txt = () => ev(`var r=document.getElementById("pglogRoot"); return r ? r.innerText : "";`);
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return "clicked";`);
const clickText = (sel, re) => ev(`var re=new RegExp(${JSON.stringify(re)},"i"); var b=Array.prototype.filter.call(document.querySelectorAll(${JSON.stringify(sel)}),function(x){return re.test(x.textContent)})[0]; if(!b) return "missing"; b.click(); return "clicked";`);
const reqs = async (re) => JSON.parse(await ev(`return JSON.stringify(window.__reqs.filter(function(r){return ${re}.test(r.method+" "+r.url)}))`) || "[]");
const noOverflow = () => ev(`var s=document.getElementById("pglogScroll"); return !!s && s.scrollWidth <= s.clientWidth + 1;`);
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const h = await ev(`var s=document.getElementById("pglogScroll"); return s ? Math.min(4200, Math.max(844, s.scrollHeight + 90)) : 844;`) || 844;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 1, mobile: true });
  await sleep(350);
  const r = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
}

/* In-page stub, installed before the app's own scripts on every document. Scenario config comes from
 * localStorage (__pgl_srv, __pgl_auth) so a reload starts each scenario clean. */
const INIT = `
(function(){
  window.__toasts = []; window.__reqs = []; window.__inflight = 0; window.__maxInflight = 0;
  try { localStorage.setItem("smd_onboarding_tour","0"); localStorage.setItem("smd_phone_verify","0"); } catch(e){}
  document.addEventListener("DOMContentLoaded", function(){ var st=document.createElement("style"); st.textContent="#verifyGate,.smdt-wel,.smdt-card,#phvRoot{display:none!important}"; document.head.appendChild(st); });
  var signedIn = localStorage.getItem("__pgl_auth") !== "0";
  if (signedIn) {
    var user = { uid: "u-self", displayName: "Test User", email: "t@college.in",
      getIdToken: function(){ return Promise.resolve("tok"); }, getIdTokenResult: function(){ return Promise.resolve({ claims: {} }); } };
    setInterval(function(){
      window.SMD_IDTOKEN = function(){ return "tok"; };
      if (!window.SMD_AUTH || window.SMD_AUTH.currentUser !== user) window.SMD_AUTH = { currentUser: user, onAuthStateChanged: function(cb){ setTimeout(function(){ cb(user); }, 0); } };
    }, 30);
  }
  setInterval(function(){
    if (window.toast && !window.toast.__w) { var o = window.toast; window.toast = function(m){ window.__toasts.push(String(m)); try { return o.apply(this, arguments); } catch(e){} }; window.toast.__w = 1; }
  }, 40);
  window.SMD_VOICE = { listen: function (o) { setTimeout(function () { o && o.onFinal && o.onFinal(window.__spoken || "tolerated well"); }, 50); return { stop: function(){} }; } };
  window.__srv = {}; try { window.__srv = JSON.parse(localStorage.getItem("__pgl_srv") || "{}"); } catch(e){}
  var _f = window.fetch;
  window.fetch = function (u, o) {
    var url = String(u && u.url || u);
    if (url.indexOf("/api/pglog") < 0) return _f.apply(this, arguments);
    var S = window.__srv, method = (o && o.method) || "GET", body = {};
    try { body = JSON.parse(o && o.body || "{}"); } catch (e) {}
    var p = url.replace(/^.*\\/api\\/pglog/, "");
    window.__reqs.push({ method: method, url: p, body: body, at: Date.now() });
    if (S.offline) return Promise.reject(new TypeError("Failed to fetch"));
    var reply = function (j, st, delay) { st = st || 200; var r = { ok: st < 300, status: st, json: function () { return Promise.resolve(j); } };
      return delay ? new Promise(function (res) { setTimeout(function () { res(r); }, delay); }) : Promise.resolve(r); };
    if (/^\\/me/.test(p)) return S.meStatus ? reply(S.me, S.meStatus) : reply(S.me || { ok: true, role: "viewer", caps: [], resident: null, orgId: "" });
    if (/^\\/dashboard\\/resident/.test(p)) return S.dash ? reply(S.dash) : reply({ error: "not_found" }, 404);
    if (/^\\/dashboard\\/faculty/.test(p)) return reply(S.faculty || { ok: true, pending: [], overdue: [], residents: [] });
    if (/^\\/dashboard\\/dept/.test(p)) return reply(S.dept || { ok: true, residents: [] });
    if (/^\\/faculty-roster/.test(p)) return reply({ ok: true, faculty: S.roster || [] });
    if (/^\\/notifications/.test(p)) return reply({ ok: true, notifications: [] });
    if (/^\\/config/.test(p)) return reply({ ok: true, config: {} });
    if (/^\\/certificates/.test(p)) return reply({ ok: true, certificates: [] });
    if (/^\\/programmes/.test(p) && method === "GET") return reply({ ok: true, programmes: S.programmes || [] });
    if (/^\\/join-request$/.test(p) && method === "POST") {
      if (S.joinNotFound) return reply({ error: "org_not_found", message: "No institution has that code. Check it with your department." }, 404);
      return reply({ ok: true, joinRequest: { id: "j-self", status: "pending", orgName: "Govt Medical College", orgCode: body.orgCode } });
    }
    if (/^\\/join-requests\\/[^/]+\\/(approve|reject)/.test(p)) return reply({ ok: true, joinRequest: { id: p.split("/")[2], status: /approve/.test(p) ? "approved" : "rejected" } });
    if (/^\\/join-requests/.test(p)) return reply({ ok: true, joinRequests: S.joins || [] });
    if (/^\\/enrol-bulk/.test(p)) return reply({ ok: true, results: (body.rows || []).map(function (r) { return { email: r.email, ok: true, status: "enrolled" }; }) });
    if (/^\\/enrol/.test(p)) return reply({ ok: true, status: "enrolled" });
    if (/^\\/residents\\/[^/?]+/.test(p) && method === "PATCH") return reply({ ok: true, resident: Object.assign({ id: p.split("/")[2] }, body) });
    if (/^\\/entries\\?/.test(p) && method === "GET") return reply({ ok: true, entries: S.resEntries || [] });
    if (/^\\/entries$/.test(p) && method === "POST") {
      var id = "srv" + window.__reqs.length; (S.created = S.created || {})[id] = body;
      return reply({ ok: true, entry: Object.assign({ id: id, status: "draft" }, body) });
    }
    if (/^\\/entries\\/[^/]+\\/submit/.test(p)) {
      if (S.refuseSubmit) return reply({ error: "supervisor_unresolved", message: "That supervisor is not on your department's faculty list. Pick your guide or a listed faculty member." }, 400);
      return reply({ ok: true, entry: { id: p.split("/")[2], status: "submitted" } });
    }
    if (/\\/verify$/.test(p)) {
      window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
      return new Promise(function (res) { setTimeout(function () { window.__inflight--; res({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, entry: { id: p.split("/")[2], status: "verified" } }); } }); }, 120); });
    }
    if (/\\/amend$|\\/withdraw$|\\/return$/.test(p)) return reply({ ok: true, entry: { id: p.split("/")[2], status: "submitted" } });
    if (/^\\/attest/.test(p)) return reply({ ok: true, attestation: { id: "a1" } });
    return reply({ ok: true });
  };
})();`;

const RES = { id: "r1", uid: "fb:u-self", name: "Dr Asha Rao", orgId: "o1", programmeId: "pr1", trainingYear: 1, startDate: "2026-06-01", guide: "fb:guide1" };
const PROG_MD = { id: "pr1", name: "MD General Medicine", degree: "MD", specialtyId: "md-general-medicine", curriculumId: "md-general-medicine" };
const PROG_MS = { id: "pr1", name: "MS General Surgery", degree: "MS", specialtyId: "ms-general-surgery", curriculumId: "ms-general-surgery" };
const ROSTER = [{ identity: "fb:guide1", role: "pg_faculty", name: "Dr R Menon" }, { identity: "fb:hod1", role: "pg_hod", name: "Dr P Iyer" }];
const RES_CAPS = ["pglog.log_own", "pglog.submit_own", "pglog.view_own"];
function meFor(prog) { return { ok: true, uid: "fb:u-self", role: "pg_resident", caps: RES_CAPS, orgId: "o1", orgCode: "SMD-ABC123", orgName: "Govt Medical College", resident: RES, programme: prog, rotations: [] }; }
const ENTRIES = [
  { id: "e1", residentId: "r1", kind: "clinical", setting: "ipd", title: "Diabetic ketoacidosis", diagnosis: "DKA", occurredAt: "2026-09-10", role: "assisted", status: "returned", returnReason: "Add the outcome.", supervisor: "fb:guide1",
    history: [{ at: 1789000000000, by: "fb:u-self", action: "submit" }, { at: 1789100000000, by: "fb:guide1", action: "return", reason: "Add the outcome." }] },
  { id: "e2", residentId: "r1", kind: "procedure", procedureText: "Lumbar puncture", caseRef: "IP-22871", outcome: "improved", setting: "ipd", occurredAt: "2026-09-02", role: "performed_supervised", status: "verified",
    supervisor: "fb:guide1", verifiedBy: "fb:guide1", verifiedName: "Dr R Menon", verifiedReg: "KMC-12345", verifiedAt: 1789200000000,
    history: [{ at: 1789000000000, by: "fb:u-self", action: "submit" }, { at: 1789200000000, by: "fb:guide1", action: "verify" }] },
  { id: "e3", residentId: "r1", kind: "academic", academicType: "journal_club", topic: "SGLT2 inhibitors in HFpEF", occurredAt: "2026-08-20", role: "presented", status: "submitted", supervisor: "fb:guide1" }
];
function dashFor(prog) {
  return { ok: true, resident: RES, programme: prog, summary: { verified: 1, submitted: 1, draft: 0, returned: 1 },
    weekly: { weeks: 13, logged: 4, pct: 31, missed: ["2026-W27", "2026-W28"], order: ["2026-W27", "2026-W28", "2026-W29", "2026-W30"] },
    months: [{ period: "2026-07", overdue: true }, { period: "2026-08", overdue: true }], rotations: [], entries: ENTRIES, trainingYear: 1, semester: 1,
    attendance: { attendedDays: 40, recordedDays: 42, pctOfRecorded: 95, pctOfWorkingDays: 90, workingDaysElapsed: 44, thresholdPct: 80, counts: { present: 40 }, note: "Institution records." } };
}

async function scenario(srv, opts) {
  opts = opts || {};
  await ev(`localStorage.clear(); sessionStorage.clear();
    localStorage.setItem("__pgl_srv", ${JSON.stringify(JSON.stringify(srv))});
    localStorage.setItem("__pgl_auth", ${JSON.stringify(opts.signedOut ? "0" : "1")});
    ${opts.easy === false ? 'localStorage.setItem("smd_pglog_easy","0");' : ""}
    return 1;`);
  await call("Page.navigate", { url: BASE + "?pglog=1" });
  for (let i = 0; i < 80; i++) { await sleep(300); if (await ev(`return !!(window.PGLOG && window.SMD_PGLOG_SCREENS && window.SMD_PGLOG_QUICK && window.SMD_PGLOG_STORE)`) === true) break; }
  await sleep(500);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","onboardRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  if (opts.before) await ev(opts.before);
  await ev(`PGLOG.open(${JSON.stringify(opts.route || "home")}); return 1;`);
  await sleep(opts.wait || 2200);
}
const provOutsideWhy = () => ev(`return Array.prototype.filter.call(document.querySelectorAll("#pglogScroll .pgl-prov"), function (b) { return !b.closest(".pgl-why"); }).length;`);

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push({ type: m.params.type, message: m.params.message });
      call("Page.handleJavaScriptDialog", { accept: true, promptText: "" });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
  await call("Page.navigate", { url: BASE + "?pglog=1" }); await sleep(2500);

  /* ── flag ── */
  console.log("\n— the flag —");
  ok(await ev(`return SMD_PGLOG_FLAGS.DEFS.smd_pglog_easy && SMD_PGLOG_FLAGS.DEFS.smd_pglog_easy.def === true`) === true, "smd_pglog_easy is registered, default ON");
  ok(await ev(`return SMD_PGLOG_FLAGS.bool("smd_pglog_demo")`) === false, "the demo flag stays OFF");
  ok(await ev(`return SMD_PGLOG_AI.reminders({ months: [{ period: "2026-07", overdue: true }], today: "2026-09-26" })[0].clause`) === "5.2(vii)",
    "reminders() cites monthly authentication as 5.2(vii), not the stale 5.2(vi)");

  /* ── 5. signed out ── */
  console.log("\n— 5. signed out and unlinked —");
  await scenario({}, { signedOut: true });
  let t = await txt();
  ok(/Sign in to use your logbook/i.test(t) && !/Which of these are you/i.test(t), "signed out: 'Sign in', not the role question");
  ok(await ev(`return !!document.querySelector('#pglogRoot [data-pgl="signin"]')`) === true, "a Sign in button");
  await scenario({}, { signedOut: true, easy: false });
  ok(/Which of these are you/i.test(await txt()), "smd_pglog_easy=0: signed out sees the old role question");

  // Signed in, not a member: /me answers 403 with no join request yet.
  const NOT_MEMBER = { me: { error: "forbidden", message: "You are not part of this institution yet.", joinRequest: null }, meStatus: 403 };
  await scenario(NOT_MEMBER);
  t = await txt();
  ok(/Which of these are you/i.test(t), "signed in, unlinked: the role question (it picks instructions only)");
  ok(await ev(`return !!document.querySelector('#pglogRoot .pgl-actionbar [data-r="quick"]')`) === true, "the unlinked home offers Log it now");
  await clickText("#pglogScroll [data-pgl='go']", "PG resident"); await sleep(600);
  t = await txt();
  ok(!/5\.2\(/.test(t), "the resident set-up screen shows no clause numbers (they are behind 'Why is this required?')");
  await ev(`window.__srv.joinNotFound = true; document.getElementById("pglOrg").value = "SMD-WRONG1"; return 1;`);
  await click('#pglogScroll [data-pgl="save-org"]'); await sleep(1800);
  t = await txt();
  ok(/No institution has that code|No college has that code/i.test(t) && !!(await ev(`return !!document.getElementById("pglOrg")`)), "a wrong code is a field error on the set-up screen");
  await ev(`window.__srv.joinNotFound = false; document.getElementById("pglOrg").value = "smd-abc123"; return 1;`);
  await click('#pglogScroll [data-pgl="save-org"]'); await sleep(2000);
  t = await txt();
  ok(/Found Govt Medical College\. Your request to join has been sent/i.test(t), "the code is found: 'Found <college>. Your request to join has been sent'");
  ok(/waiting for your department/i.test(t) && !/Which of these are you/i.test(t), "then the status, not a loop back to the 3-way question");
  const jr = await reqs("/POST \\/join-request$/");
  const jrLast = jr[jr.length - 1] || { body: {} };
  ok(jr.length === 2 && jrLast.body.orgCode === "SMD-ABC123" && !("role" in jrLast.body), "POST /join-request carries the code, normalised, and no self-declared role " + JSON.stringify(jr.map(r => r.body)));
  // Reopen: /me now carries the pending request.
  await ev(`window.__srv.me.joinRequest = { id: "j-self", status: "pending", orgName: "Govt Medical College", orgCode: "SMD-ABC123" }; SMD_PGLOG_SCREENS._state.ctx = null; SMD_PGLOG_SCREENS._state.joinLocal = null; PGLOG.close(); PGLOG.open(); return 1;`);
  await sleep(1800);
  ok(/Your request to join has been sent/i.test(await txt()), "reopening shows the request's status from /me");
  // Log it now while unlinked -> a local draft, listed on the unlinked home.
  await click('#pglogRoot .pgl-actionbar [data-r="quick"]'); await sleep(900);
  await ev(`var b=document.querySelector('#pglogScroll [data-pgl="q-pick"]'); b && b.click(); return 1;`); await sleep(250);
  await click('#pglogScroll [data-pgl="q-role"][data-v="observed"]'); await sleep(250);
  await click('#pglogRoot [data-pgl="q-save"]'); await sleep(1500);
  ok(await ev(`return SMD_PGLOG_STORE.drafts().length`) === 1, "quick log while unlinked saves a local draft");
  t = await txt();
  ok(/Saved on this device/i.test(t) && await ev(`return document.querySelectorAll('#pglogScroll [data-r^="entry/loc_"]').length`) === 1,
    "and the unlinked home lists it");

  /* ── 10 / 9. resident home ── */
  console.log("\n— 10 / 9. resident home —");
  const LINKED = { me: meFor(PROG_MD), dash: dashFor(PROG_MD), roster: ROSTER };
  await scenario(LINKED, { before: `SMD_PGLOG_STORE.saveDraft({ kind: "procedure", procedureText: "Pleural tap", role: "observed", occurredAt: "2026-09-20", residentId: "r1" }); return 1;` });
  t = await txt();
  ok(/Waiting on your guide/i.test(t) && /July 2026: monthly sign-off/i.test(t), "guide attestation shows as 'Waiting on your guide', by month name");
  ok(!/Guide authentication missing/i.test(await ev(`var s=Array.prototype.filter.call(document.querySelectorAll("#pglogScroll .pgl-row"),function(r){return !r.classList.contains("pgl-waiting")}).map(function(r){return r.innerText}).join("|"); return s;`)),
    "and is not in the resident's own to-do list");
  ok(/Add at least one entry this week/i.test(t), "softer weekly copy");
  ok(await provOutsideWhy() === 0 && await ev(`return document.querySelectorAll("#pglogScroll .pgl-why .pgl-prov").length`) > 0,
    "home: every provenance badge is inside 'Why is this required?'");
  const needs = await ev(`var s=Array.prototype.filter.call(document.querySelectorAll("#pglogScroll .pgl-stat"),function(x){return /Needs you/.test(x.innerText)})[0]; return s ? s.querySelector("b").textContent : null;`);
  ok(needs === "2", "'Needs you' = 1 returned + 1 local draft, with no double count (got " + needs + ")");
  ok(/Draft: Pleural tap/.test(t), "and the unfinished draft is listed under Needs you, where it is counted");
  ok(/Guide:\s*Dr R Menon/.test(t), "the guide is shown by name");
  ok(await noOverflow(), "home fits 390px with no horizontal scroll");
  await shot("E01-resident-home");
  await scenario(LINKED, { easy: false });
  ok(await provOutsideWhy() > 0 && /Guide authentication missing for/i.test(await txt()), "smd_pglog_easy=0: badges and the attestation rows are back on home");

  /* ── 8. quick log ── */
  console.log("\n— 8 / 2. quick log —");
  await scenario(LINKED, { route: "quick" });
  t = await txt();
  ok(/Today/.test(t) && /Yesterday/.test(t) && /Pick a date/.test(t), "Today / Yesterday / Pick a date chips");
  ok(/Dr R Menon/.test(t) && /your guide/.test(t), "the supervisor is prefilled from the guide, shown as a NAME chip");
  ok(!(await ev(`return !!document.getElementById("pglQuickSup")`)), "an MD resident is not asked to type a supervisor");
  await click('#pglogScroll [data-pgl="q-date"][data-v="yesterday"]'); await sleep(300);
  ok(await ev(`var b=document.querySelector('#pglogScroll [data-pgl="q-date"][data-v="yesterday"]'); return b && b.getAttribute("aria-pressed")`) === "true", "tapping Yesterday selects it");
  await clickText('#pglogScroll [data-pgl="q-kind"]', "Procedure"); await sleep(250);
  await ev(`var b=document.querySelector('#pglogScroll [data-pgl="q-pick"]'); b && b.click(); return 1;`); await sleep(250);
  ok(await ev(`return document.querySelectorAll('#pglogScroll [data-pgl="q-role"][aria-pressed="true"]').length`) === 0, "no role pre-selected on the quick screen");
  await click('#pglogScroll [data-pgl="q-role"][data-v="assisted"]'); await sleep(250);
  ok(await noOverflow(), "quick log fits 390px");
  await shot("E02-quick-log");
  await click('#pglogRoot [data-pgl="q-save"]'); await sleep(1800);
  let posts = await reqs("/POST \\/entries$/");
  const yday = await ev(`return SMD_PGLOG_MODEL.addDays(SMD_PGLOG_MODEL.isoDate(Date.now()), -1)`);
  ok(posts.length === 1 && posts[0].body.occurredAt === yday && posts[0].body.supervisor === "fb:guide1",
    "the saved entry is dated yesterday and goes to the guide " + JSON.stringify(posts.map(p => [p.body.occurredAt, p.body.supervisor])));
  await scenario(LINKED, { route: "quick", easy: false });
  ok(!/Yesterday/.test(await txt()), "smd_pglog_easy=0: no date chips on the quick screen");

  // MS: the supervising consultant is still required.
  await scenario({ me: meFor(PROG_MS), dash: dashFor(PROG_MS), roster: ROSTER }, { route: "quick" });
  await clickText('#pglogScroll [data-pgl="q-kind"]', "Procedure"); await sleep(250);
  ok(/Supervising consultant/i.test(await txt()) && /Dr R Menon/.test(await txt()), "MS: 'Supervising consultant', prefilled with the guide's name");

  /* ── 3. failed submits ── */
  console.log("\n— 3. a refused submission —");
  await scenario(Object.assign({}, LINKED, { refuseSubmit: true }), { route: "quick" });
  await clickText('#pglogScroll [data-pgl="q-kind"]', "Procedure"); await sleep(250);
  await ev(`var b=document.querySelector('#pglogScroll [data-pgl="q-pick"]'); b && b.click(); return 1;`); await sleep(250);
  await click('#pglogScroll [data-pgl="q-role"][data-v="assisted"]'); await sleep(250);
  await click('#pglogRoot [data-pgl="q-save"]'); await sleep(2200);
  const toasts = JSON.parse(await ev(`return JSON.stringify(window.__toasts)`));
  ok(!toasts.some(x => /when you are (back )?online/i.test(x)) && toasts.some(x => /faculty list/i.test(x)),
    "the real reason is shown, never 'will be submitted when you are online' " + JSON.stringify(toasts.slice(-2)));
  ok(await ev(`return SMD_PGLOG_STORE.queued().length`) === 0, "a refused entry is not queued");
  ok(await ev(`return document.querySelectorAll('#pglogScroll [data-fix="1"]').length`) === 1 && /Fix:/.test(await txt()), "home shows a 'Fix' row for it");
  await click('#pglogScroll [data-fix="1"]'); await sleep(700);
  t = await txt();
  ok(/Not submitted\./.test(t) && /faculty list/i.test(t) && await ev(`return !!document.querySelector('#pglogRoot [data-pgl="edit-draft"]')`), "the entry says why, and offers Fix");

  /* ── 11 / 13 / 9. the full form ── */
  console.log("\n— 11 / 13 / 9. the full form —");
  await scenario(LINKED, { route: "add/procedure" });
  t = await txt();
  ok(await ev(`return document.querySelectorAll('#pglogScroll [data-f-chip="role"][aria-pressed="true"]').length`) === 0, "the full form does NOT pre-select a role");
  ok(/LOG A PROCEDURE|Log a procedure/.test(t), "plain title 'Log a procedure'");
  ok(!/PGMER|5\.2\(/.test(t), "no clause numbers in the form's visible text");
  ok(!/MS \/ M\.Ch/.test(t), "the MS/M.Ch hint is not shown to an MD resident");
  ok(/Theatre/.test(t) && !/\bEMERGENCY\b/.test(t), "settings have human labels");
  ok(/Dr R Menon/.test(t), "the supervisor is the guide's name chip");
  ok(await ev(`return !!document.querySelector('#pglogScroll [data-pgl="f-mic"][data-field="remarks"]')`) === true, "dictation is offered on the free-text fields");
  await ev(`window.SMD_VOICE = { listen: function (o) { setTimeout(function () { o.onFinal(window.__spoken); }, 50); return { stop: function(){} }; } }; window.__spoken = "patient tolerated the procedure well"; document.querySelector('#pglogScroll [data-pgl="f-mic"][data-field="remarks"]').click(); return 1;`); await sleep(500);
  ok(/tolerated the procedure well/.test(await ev(`return SMD_PGLOG_SCREENS._state.draft.remarks`)), "dictation fills the field");
  await ev(`var s=SMD_PGLOG_SCREENS._state; s.draft.procedureText="Pleural tap"; return 1;`);
  await click('#pglogRoot [data-pgl="save-draft"]'); await sleep(600);
  ok(await ev(`return SMD_PGLOG_STORE.drafts().length`) === 0 && /Tap your role/i.test(await txt()), "saving without a role is refused, so 'assisted' is never stored by default");
  await ev(`var s=SMD_PGLOG_SCREENS._state; s.draft.outcome=""; SMD_PGLOG_SCREENS._render(); return 1;`); await sleep(200);
  ok(await ev(`var s=document.querySelector('#pglogScroll select[data-f="outcome"]'); return s.options[s.selectedIndex].textContent`) === "Choose", "a blank outcome shows 'Choose', not 'improved'");
  ok(await noOverflow(), "the form fits 390px");
  // MS hint appears for MS only.
  await scenario({ me: meFor(PROG_MS), dash: dashFor(PROG_MS), roster: ROSTER }, { route: "add/procedure" });
  ok(/MS \/ M\.Ch/.test(await txt()), "the MS/M.Ch hint is shown to an MS resident");

  /* ── 12. attendance ── */
  console.log("\n— 12. attendance —");
  await scenario(LINKED, { route: "add" });
  ok(!(await ev(`return !!document.querySelector('#pglogScroll [data-r="add/attendance"]')`)), "attendance is not on the resident's add picker");
  await ev(`SMD_PGLOG_SCREENS.go("progress"); return 1;`); await sleep(500);
  ok(await ev(`return !!document.querySelector('#pglogScroll [data-r="attendance"]')`) === true, "it is reachable from Progress");
  ok(await ev(`return document.querySelectorAll("#pglogScroll .pgl-prov").length`) > 0, "Progress keeps its provenance badges");
  await ev(`SMD_PGLOG_SCREENS.go("attendance"); return 1;`); await sleep(400);
  ok(!/PGMER-2023 5\.5/.test(await ev(`return document.querySelector("#pglogRoot .pgl-htitle").innerText`)), "the Attendance header carries no clause number");
  await scenario(LINKED, { route: "add", easy: false });
  ok(await ev(`return !!document.querySelector('#pglogScroll [data-r="add/attendance"]')`) === true, "smd_pglog_easy=0: attendance is back on the add picker");

  /* ── 8 / 13 / 2. the entry screen ── */
  console.log("\n— entry: Log again, Correct, amend, withdraw —");
  await scenario(LINKED, { route: "entry/e2" });
  t = await txt();
  ok(/Supervisor\s*Dr R Menon/.test(t) && !/guide1/.test(t), "the entry shows the supervisor by name");
  ok(/Dr R Menon/.test(await ev(`return document.querySelector("#pglogScroll .pgl-audit").innerText`)), "the audit trail shows names");
  ok(/Ward \/ IPD/.test(t) && /Improved/.test(t), "raw codes read as words (ipd, improved)");
  await click('#pglogRoot [data-pgl="log-again"]'); await sleep(700);
  const again = JSON.parse(await ev(`var d=SMD_PGLOG_SCREENS._state.draft; return JSON.stringify({p:d.procedureText, r:d.role, c:d.caseRef, o:d.outcome, at:d.occurredAt, id:d.id})`));
  ok(again.p === "Lumbar puncture" && again.r === "" && !again.c && again.at === await ev(`return SMD_PGLOG_MODEL.isoDate(Date.now())`) && /^loc_/.test(again.id),
    "Log again: same procedure, today, role CLEARED, no case reference " + JSON.stringify(again));
  await ev(`SMD_PGLOG_SCREENS.go("entry/e1"); return 1;`); await sleep(500);
  await click('#pglogRoot [data-pgl="edit-server"]'); await sleep(600);
  const head = await ev(`return document.querySelector("#pglogRoot .pgl-htitle").innerText`);
  ok(/Correct entry/i.test(head) && !/NEW ENTRY/i.test(head), "the correction form is titled 'Correct entry' (" + JSON.stringify(head) + ")");
  // Amend a verified entry: prefilled form, real patch, in-app reason sheet.
  await ev(`SMD_PGLOG_SCREENS.go("entry/e2"); return 1;`); await sleep(500);
  await click('#pglogRoot [data-pgl="amend"]'); await sleep(600);
  ok(/Amend entry/i.test(await ev(`return document.querySelector("#pglogRoot .pgl-htitle").innerText`)) &&
     await ev(`return document.querySelector('#pglogScroll [data-f="procedureText"]').value`) === "Lumbar puncture", "amend opens the form prefilled");
  await ev(`var i=document.querySelector('#pglogScroll [data-f="caseRef"]'); i.value="IP-22872"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await click('#pglogRoot [data-pgl="amend-save"]'); await sleep(400);
  ok(await ev(`return !!document.querySelector(".pgl-reason")`) === true, "the reason is asked in an in-app sheet");
  await ev(`document.getElementById("pglReasonTxt").value = "Wrong IP number"; document.getElementById("pglReasonGo").click(); return 1;`); await sleep(1200);
  const am = await reqs("/POST \\/entries\\/e2\\/amend/");
  ok(am.length === 1 && am[0].body.patch && am[0].body.patch.caseRef === "IP-22872" && am[0].body.reason === "Wrong IP number" && Object.keys(am[0].body.patch).length === 1,
    "the amendment sends the real patch, not an empty one " + JSON.stringify(am.map(a => a.body)));
  await ev(`PGLOG.close(); PGLOG.open("entry/e3"); return 1;`); await sleep(1800);
  await click('#pglogRoot [data-pgl="withdraw"]'); await sleep(400);
  ok(await ev(`return !!document.querySelector(".pgl-reason")`) === true, "withdraw asks in the in-app sheet too");
  await ev(`document.getElementById("pglReasonTxt").value = "Wrong date"; document.getElementById("pglReasonGo").click(); return 1;`); await sleep(1200);
  ok((await reqs("/POST \\/entries\\/e3\\/withdraw/")).length === 1, "and the withdrawal is sent");
  ok(!dialogs.some(d => d.type === "prompt"), "window.prompt() was never used for a reason");

  /* ── 4. offline cold start ── */
  console.log("\n— 4. offline cold start —");
  await scenario(LINKED);
  ok(/Dr Asha Rao/.test(await txt()), "online first (the store keeps the last good context)");
  await call("Network.enable", {});
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev(`window.__srv.offline = true; PGLOG.close(); var s=SMD_PGLOG_SCREENS._state; s.ctx=null; s.dash=null; PGLOG.open(); return 1;`); await sleep(2200);
  t = await txt();
  ok(/Showing your last synced copy/i.test(t) && /Dr Asha Rao/.test(t) && !/Set up your logbook/i.test(t), "offline cold start lands an enrolled resident on home with the stale banner, not setup");
  ok(await ev(`return !!document.querySelector('#pglogRoot .pgl-actionbar [data-r="quick"]')`) === true, "with the quick log");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* ── 7. guide batch review ── */
  console.log("\n— 7. guide batch review —");
  const PENDING = [
    { id: "p1", residentId: "r1", residentName: "Dr Asha Rao", kind: "procedure", procedureText: "Lumbar puncture", occurredAt: "2026-08-20", role: "performed_supervised", status: "submitted" },
    { id: "p2", residentId: "r1", residentName: "Dr Asha Rao", kind: "clinical", title: "Acute coronary syndrome", occurredAt: "2026-08-21", role: "assisted", status: "submitted", setting: "emergency" },
    { id: "p3", residentId: "r2", residentName: "Dr Vikram Nair", kind: "academic", academicType: "seminar", topic: "Hyponatraemia", occurredAt: "2026-09-18", role: "presented", status: "submitted" }
  ];
  const FAC = { me: { ok: true, uid: "fb:guide1", role: "pg_faculty", caps: ["pglog.view.assigned", "pglog.verify", "pglog.assess", "pglog.attest"], orgId: "o1", orgName: "Govt Medical College", resident: null,
      signer: { ok: true, name: "Dr R Menon", regNo: "KMC-12345", council: "Karnataka Medical Council" } },
    faculty: { ok: true, pending: PENDING, overdue: [], residents: [
      { resident: { id: "r1", name: "Dr Asha Rao", trainingYear: 1 }, summary: { verified: 3, submitted: 2 }, weekly: { pct: 62 }, attestationOverdue: ["2026-08"] },
      { resident: { id: "r2", name: "Dr Vikram Nair", trainingYear: 2 }, summary: { verified: 9 }, weekly: { pct: 91 }, attestationOverdue: [] }] },
    roster: ROSTER,
    resEntries: [PENDING[0], PENDING[1], { id: "v1", residentId: "r1", kind: "procedure", procedureText: "Ascitic tap", occurredAt: "2026-08-05", role: "assisted", status: "verified" }] };
  await scenario(FAC, { route: "faculty" });
  t = await txt();
  const groups = await ev(`return Array.prototype.map.call(document.querySelectorAll("#pglogScroll .pgl-resgrp span:first-child"),function(s){return s.textContent}).join("|")`);
  ok(groups === "Dr Asha Rao|Dr Vikram Nair", "the queue is grouped by resident NAME (" + groups + ")");
  ok(/August 2026/.test(t) && await ev(`return document.querySelectorAll('#pglogScroll [data-bsel]').length`) === 3, "month cards list submitted entries with checkboxes");
  ok(/Clinical · Emergency/.test(t) && !/EMERGENCY/.test(t), "settings read as words in the queue too");
  ok(await noOverflow(), "the guide queue fits 390px");
  await shot("E03-guide-queue");
  await click('#pglogScroll [data-pgl="batch-all"][data-key="r1|2026-08"]'); await sleep(200);
  ok(/Verify selected \(2\)/.test(await ev(`return document.querySelector('[data-pgl="verify-selected"][data-key="r1|2026-08"]').innerText`)), "Select all ticks the month's two entries");
  await ev(`document.querySelector('.pgl-month[data-key="r1|2026-08"]').scrollIntoView(); return 1;`);
  await shot("E04-month-card");
  await click('#pglogScroll [data-pgl="verify-selected"][data-key="r1|2026-08"]'); await sleep(1500);
  const ver2 = await reqs("/POST \\/entries\\/p[0-9]\\/verify/");
  ok(ver2.length === 2 && ver2[0].url === "/entries/p1/verify" && ver2[1].url === "/entries/p2/verify", "each selected entry is verified by its OWN existing call");
  ok(await ev(`return window.__maxInflight`) === 1, "one at a time, sequentially (max in flight = 1)");
  ok(!(await reqs("/verify/")).some(r => r.url.indexOf("p3") > -1), "an entry that was not selected is not verified");
  await click('#pglogScroll [data-pgl="attest-month"][data-p="2026-08"]'); await sleep(1500);
  const conf = dialogs.filter(d => d.type === "confirm").pop();
  ok(conf && /3 entries, 2 still unverified/.test(conf.message), "Authenticate month confirms 'N entries, M still unverified' (" + JSON.stringify(conf && conf.message) + ")");
  const at = await reqs("/POST \\/attest/");
  ok(at.length === 1 && at[0].body.residentId === "r1" && at[0].body.period === "2026-08" && at[0].body.kind === "monthly", "then the month is authenticated once, by the guide");
  await scenario(FAC, { route: "faculty", easy: false });
  ok(/Awaiting your verification/i.test(await txt()) && !(await ev(`return !!document.querySelector("[data-bsel]")`)), "smd_pglog_easy=0: the old flat queue");

  /* ── 1. resident detail ── */
  console.log("\n— 1. resident detail —");
  const HOD = JSON.parse(JSON.stringify(FAC));
  HOD.me.caps = HOD.me.caps.concat(["pglog.view.dept"]);
  HOD.me.role = "pg_hod";
  await scenario(HOD, { route: "faculty" });
  await click('#pglogScroll [data-r="resident/r1"]'); await sleep(1500);
  t = await txt();
  const monthsStat = await ev(`var s=Array.prototype.filter.call(document.querySelectorAll("#pglogScroll .pgl-stat"),function(x){return /Months to authenticate/.test(x.innerText)})[0]; return s ? s.querySelector("b").textContent : null;`);
  ok(monthsStat === "1", "'Months to authenticate' is a count, not the array (got " + JSON.stringify(monthsStat) + ")");
  ok(/Ascitic tap/.test(t) && await ev(`return !!document.querySelector('#pglogScroll .pgl-month [data-pgl="attest-month"][data-p="2026-08"]')`), "the resident's entries are listed, with Authenticate per month");
  const opts = await ev(`var s=document.getElementById("pglAssignGuide"); return s ? Array.prototype.map.call(s.options,function(o){return o.textContent}).join("|") : ""`);
  ok(/Dr R Menon/.test(opts) && !/guide1/.test(opts), "Assign guide lists NAMES (" + opts + ")");
  await ev(`var s=document.getElementById("pglAssignGuide"); s.value="fb:hod1"; return 1;`);
  await click('#pglogScroll [data-pgl="assign-guide"]'); await sleep(900);
  const pg = await reqs("/PATCH \\/residents\\/r1/");
  ok(pg.length === 1 && pg[0].body.guide === "fb:hod1", "Assign guide PATCHes the resident's guide");

  /* ── 6 / 1. Academic Cell ── */
  console.log("\n— 6 / 1. Academic Cell —");
  const AC = { me: { ok: true, uid: "fb:ac1", role: "academic_cell", caps: ["pglog.configure", "pglog.view.institution", "pglog.view.dept"], orgId: "o1", orgCode: "SMD-ABC123", orgName: "Govt Medical College", orgKind: "institution", resident: null },
    programmes: [{ id: "pr1", name: "General Medicine", degree: "MD", durationMonths: 36 }], roster: ROSTER,
    joins: [{ id: "j1", name: "Dr New Resident", email: "new@college.in", status: "pending", createdAt: 1790000000000 },
            { id: "j2", name: "Dr Wrong Person", email: "wrong@x.in", status: "pending", createdAt: 1790000000000 }] };
  await scenario(AC, { before: `SMD_PGLOG_STORE.setContext({ orgId: "o1" }); return 1;` });
  await click('#pglogScroll [data-r="institution"]'); await sleep(1800);
  t = await txt();
  ok(/Requests to join/i.test(t) && /Dr New Resident/.test(t), "a 'Requests to join' card");
  ok(await ev(`var c=document.querySelector('[data-jr="j1"]'); return c.querySelector('[data-jr-f="programmeId"]').value === "pr1" && !!c.querySelector('[data-jr-f="startDate"]').value`) === true,
    "programme and start date are prefilled");
  await ev(`document.querySelector('[data-jr="j1"] [data-jr-f="guide"]').value = "fb:guide1"; document.querySelector('[data-jr="j1"] [data-jr-f="trainingYear"]').value = "2"; return 1;`);
  await click('#pglogScroll [data-pgl="jr-approve"][data-id="j1"]'); await sleep(1000);
  const ap = await reqs("/POST \\/join-requests\\/j1\\/approve/");
  ok(ap.length === 1 && ap[0].body.programmeId === "pr1" && ap[0].body.guide === "fb:guide1" && ap[0].body.trainingYear === 2 && /^\d{4}-\d{2}-\d{2}$/.test(ap[0].body.startDate),
    "one-tap Approve sends programme, guide, start date and year " + JSON.stringify(ap.map(a => a.body)));
  await click('#pglogScroll [data-pgl="jr-reject"][data-id="j2"]'); await sleep(300);
  await ev(`document.getElementById("pglReasonTxt").value = "Not in our PG programme"; document.getElementById("pglReasonGo").click(); return 1;`); await sleep(900);
  const rj = await reqs("/POST \\/join-requests\\/j2\\/reject/");
  ok(rj.length === 1 && rj[0].body.reason === "Not in our PG programme", "Reject carries a reason, from the in-app sheet");
  const gopts = await ev(`return Array.prototype.map.call(document.getElementById("pglGuide").options,function(o){return o.textContent}).join("|")`);
  ok(/Dr R Menon/.test(gopts), "the enrol card has a guide picker with names (" + gopts + ")");
  ok(await ev(`return Array.prototype.map.call(document.getElementById("pglYear").options,function(o){return o.value}).join(",")`) === "1,2,3", "training year is selectable 1-3");
  await ev(`document.getElementById("pglEmail").value="a@b.in"; document.getElementById("pglProg").value="pr1"; document.getElementById("pglGuide").value="fb:guide1"; document.getElementById("pglYear").value="3"; return 1;`);
  await click('#pglogScroll [data-pgl="enrol-person"]'); await sleep(900);
  const en = await reqs("/POST \\/enrol$/");
  ok(en.length === 1 && en[0].body.guide === "fb:guide1" && en[0].body.trainingYear === 3, "enrol sends the guide and the training year");
  await ev(`document.getElementById("pglBulk").value = "one@c.in\\ntwo@c.in\\n\\nthree@c.in"; document.getElementById("pglBulkProg").value = "pr1"; document.getElementById("pglBulkYear").value = "2"; return 1;`);
  await click('#pglogScroll [data-pgl="enrol-bulk"]'); await sleep(1000);
  const bk = await reqs("/POST \\/enrol-bulk/");
  ok(bk.length === 1 && bk[0].body.programmeId === "pr1" && bk[0].body.rows.length === 3 && bk[0].body.rows[0].trainingYear === 2, "bulk enrol: one email per line, 3 rows " + JSON.stringify(bk.map(b => b.body.rows)));
  ok(/3 of 3 enrolled/.test(await txt()), "and reports the result");
  ok(await noOverflow(), "the Academic Cell console fits 390px");

  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nALL GREEN - ${passes} passed. Easy mode simplifies the words and the taps, and every rule still holds`);
} catch (e) {
  console.error("HARNESS ERROR:", e && e.stack || e);
  fails++;
} finally {
  try { ws.send(JSON.stringify({ id: 999999, method: "Browser.close" })); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
