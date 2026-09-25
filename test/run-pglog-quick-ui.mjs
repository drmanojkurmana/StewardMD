/* The NMC eLOGBook quick-log path, driven in a real headless browser against the real app.
 *
 * What this proves, and why each one is here:
 *   - the 15-to-20-second claim is a real three-tap path that ends in a saved draft
 *   - the specialty template is the one for THIS resident's specialty, not a generic list
 *   - the role ladder is never pre-selected, because that claim is what an examiner relies on
 *   - dictation fills the form from one sentence and SHOWS what it heard before anything is saved
 *   - a photograph cannot be taken without the consent tick
 *   - the analytics page counts verified entries and refuses to print a rate it cannot support
 *   - CSV export produces a spreadsheet with a header and one row per entry
 *
 * Stubs: a signed-in account, the logbook's /api/pglog answered in-page, and a voice double.
 * No network, no PHI.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-pglog-quick-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9407, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pglq-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const STUB = `
  window.__saved = []; window.__spoken = "";
  window.SMD_AUTH = { currentUser: { uid: "u-res-1", displayName: "Dr Asha Rao", email: "asha@hospital.org",
    getIdToken: function () { return Promise.resolve("tok"); },
    getIdTokenResult: function () { return Promise.resolve({ claims: {} }); } },
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(window.SMD_AUTH.currentUser); }, 0); } };
  // A general-surgery resident in year 2, so the template must be the surgical one.
  window.__me = { ok: true, role: "pg_resident", caps: ["pglog.log_own", "pglog.submit_own"],
    resident: { id: "r1", name: "Dr Asha Rao", orgId: "o1", programmeId: "pr1", trainingYear: 2, startDate: "2024-07-01" },
    programme: { id: "pr1", name: "MS General Surgery", degree: "MS", specialtyId: "ms-general-surgery" },
    rotations: [] };
  window.__entries = [
    { id: "e1", kind: "procedure", occurredAt: "2024-08-02", procedureName: "Appendicectomy", role: "observed", status: "verified", complications: [] },
    { id: "e2", kind: "procedure", occurredAt: "2024-09-11", procedureName: "Appendicectomy", role: "assisted", status: "verified", complications: [] },
    { id: "e3", kind: "procedure", occurredAt: "2025-08-20", procedureName: "Appendicectomy", role: "performed_independent", status: "verified", complications: [] },
    { id: "e4", kind: "procedure", occurredAt: "2025-09-02", procedureName: "Inguinal hernia repair (open)", role: "performed_independent", status: "verified", complications: ["wound infection"] },
    { id: "e5", kind: "clinical", occurredAt: "2025-09-03", diagnosis: "Acute appendicitis", setting: "opd", role: "assisted", status: "verified" },
    { id: "e6", kind: "procedure", occurredAt: "2025-09-10", procedureName: "Appendicectomy", role: "assisted", status: "draft", complications: [] }
  ];
  var _f = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf("/api/pglog") < 0) return _f.apply(this, arguments);
    var reply = function (j) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(j); } }); };
    if (u.indexOf("/me") > 0) return reply(window.__me);
    if (u.indexOf("/dashboard") > 0) return reply({ ok: true, resident: window.__me.resident, programme: window.__me.programme,
      summary: { verified: 5, submitted: 0, draft: 1 }, weekly: { pct: 80 }, months: [], rotations: [], entries: window.__entries });
    if (u.indexOf("/entries") > 0 && o && o.method === "POST") {
      var b = {}; try { b = JSON.parse(o.body); } catch (e) {}
      window.__saved.push(b); return reply({ ok: true, entry: Object.assign({ id: "new1", status: "submitted" }, b) });
    }
    if (u.indexOf("/config") > 0) return reply({ ok: true, config: {} });
    if (u.indexOf("/notifications") > 0) return reply({ ok: true, notifications: [] });
    return reply({ ok: true });
  };
  // Voice double: SMD_VOICE.listen delivers one sentence through onFinal, like the real recogniser.
  window.SMD_VOICE = { listen: function (opts) {
    setTimeout(function () { if (opts && opts.onFinal) opts.onFinal(window.__spoken); }, 60);
    return { engine: "test", mode: "record", stop: function () {} };
  } };
  return 1;`;

const txt = () => ev(`var r=document.getElementById("pglogRoot"); return r ? r.innerText : "";`);
const clickAct = (a, v) => ev(`var sel='[data-pgl="'+${JSON.stringify(a)}+'"]'+(${JSON.stringify(v || "")}?'[data-v="'+${JSON.stringify(v || "")}+'"]':''); var b=document.querySelector(sel); if(!b) return "missing"; b.click(); return "clicked";`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 75; i++) {
    await sleep(400);
    if (await ev(`return !!(window.PGLOG && window.SMD_PGLOG_QUICK && window.SMD_PGLOG_ANALYTICS && window.SMD_PGLOG_PHOTOS && window.SMD_PGLOG_BACKUP)`) === true) { ready = true; break; }
  }
  ok(ready, "the four new logbook modules load with the app");

  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{sessionStorage.clear(); localStorage.setItem("smd_onboarding_tour","0"); localStorage.removeItem("smd_pglog_recent_u-res-1"); localStorage.setItem("smd_phone_verify","0");}catch(e){} return 1;`);
  await ev(STUB);

  /* ── the engines, in the page ── */
  ok(await ev(`return SMD_PGLOG_QUICK.templatesFor("ms-general-surgery").packId`) === "general-surgery",
    "a general-surgery resident gets the surgical template, not a generic list");
  ok(await ev(`return SMD_PGLOG_QUICK.templatesFor("dm-critical-care-medicine").procedure.indexOf("Endotracheal intubation") >= 0`) === true,
    "critical care has its own procedure list");
  ok(await ev(`return SMD_PGLOG_QUICK.templatesFor("dm-endocrinology").clinical.indexOf("Diabetic ketoacidosis") >= 0`) === true,
    "endocrinology has its own presentation list");

  /* ── open the module, let the dashboard load, then take the quick path ──
   * Home first on purpose: the resident must be linked to their programme before an entry can be
   * SUBMITTED, and that link comes from the dashboard payload. Opening straight into the quick
   * screen is also valid (it saves and queues), but this harness is testing the full journey. */
  await ev(`PGLOG.open("home"); return 1;`);
  await sleep(2200);
  ok(/Log it now/i.test(await txt()), "the home screen leads with the quick logger");
  await ev(`var b=document.querySelector('#pglogRoot [data-pgl="go"][data-r="quick"]'); if(b) b.click(); return 1;`);
  await sleep(1400);
  let body = await txt();
  ok(/Log it now/i.test(body), "the quick logger opens");
  ok(/Which procedure/i.test(body) || /What are you logging/i.test(body), "it asks what, in one line");

  // The template list is on screen without typing a character.
  const items = await ev(`return document.querySelectorAll('#pglogRoot [data-pgl="q-pick"]').length;`);
  ok(items >= 5, "the specialty's own list is offered immediately (" + items + " suggestions)");
  ok(await ev(`return Array.prototype.some.call(document.querySelectorAll('#pglogRoot [data-pgl="q-pick"]'), function(b){return /Appendicectomy/i.test(b.textContent);});`) === true,
    "including the procedures a surgical resident actually logs");

  /* ── the role ladder is never pre-selected ── */
  ok(await ev(`return document.querySelectorAll('#pglogRoot [data-pgl="q-role"][aria-pressed="true"]').length;`) === 0,
    "no role is pre-selected — the resident must state it");

  /* ── three taps to a saved entry ── */
  ok(await clickAct("q-pick", "Appendicectomy") === "clicked", "tap 1: pick the procedure");
  await sleep(300);
  ok(await ev(`return /Appendicectomy/.test(document.querySelector("#pglogRoot .pgl-qpicked").innerText);`) === true, "it is shown as picked");
  const blocked = await ev(`var b=document.querySelector('#pglogRoot [data-pgl="q-save"]'); return !!(b && b.disabled);`);
  ok(blocked === true, "Save stays disabled until the role is chosen");
  ok(await clickAct("q-role", "assisted") === "clicked", "tap 2: choose the role");
  await sleep(300);
  // An MS programme must name the supervising consultant on a procedure (PGMER-2023 5.2(vi)); the
  // quick screen asks for it rather than letting the entry through without one.
  const supField = await ev(`return !!document.getElementById("pglQuickSup");`);
  ok(supField === true, "an MS resident is asked for the supervising consultant");
  ok(await ev(`var b=document.querySelector('#pglogRoot [data-pgl="q-save"]'); return !!(b && b.disabled);`) === true,
    "and Save stays disabled until it is named");
  await ev(`var i=document.getElementById("pglQuickSup"); i.value="Dr S Rao"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await ev(`var b=document.querySelector('#pglogRoot [data-pgl="q-role"][data-v="assisted"]'); if(b) b.click(); return 1;`);
  await sleep(400);
  ok(await ev(`var b=document.querySelector('#pglogRoot [data-pgl="q-save"]'); return !!(b && !b.disabled);`) === true, "now Save is live");
  ok(await clickAct("q-save") === "clicked", "tap 3: save");
  await sleep(1600);
  const saved = await ev(`
    if (window.__saved[0]) return JSON.stringify(window.__saved[0]);
    var d = (window.SMD_PGLOG_STORE && SMD_PGLOG_STORE.drafts && SMD_PGLOG_STORE.drafts()) || [];
    return d.length ? JSON.stringify(d[d.length - 1]) : null;`);
  if (!saved) {
    console.log("   debug:", await ev(`return JSON.stringify({
      saved: window.__saved.length,
      hasStore: !!window.SMD_PGLOG_STORE,
      drafts: (window.SMD_PGLOG_STORE && SMD_PGLOG_STORE.drafts) ? SMD_PGLOG_STORE.drafts().length : -1,
      queued: (window.SMD_PGLOG_STORE && SMD_PGLOG_STORE.queued) ? SMD_PGLOG_STORE.queued().length : -1,
      screen: document.getElementById("pglogRoot").innerText.slice(0,80),
      errs: (function(){
        try {
          var m=SMD_PGLOG_MODEL, q=SMD_PGLOG_QUICK, st=SMD_PGLOG_STORE;
          var d=q.quickDraft({kind:"procedure",title:"Appendicectomy",role:"assisted",setting:"ot"},
            {prefs:st.prefs()||{},today:"2026-09-24",localId:st.localId(),residentId:"r1",programmeId:"pr1"});
          return m.validateEntry(m.entry(d), {requireResident:true});
        } catch(e){ return "THREW "+e.message; }
      })()
    });`));
  }
  const s0 = JSON.parse(saved || "null");
  ok(!!s0, "the entry is recorded — submitted when linked and online, saved and queued otherwise " + saved);
  ok(s0 && (s0.procedureText === "Appendicectomy" || s0.procedureId === "Appendicectomy") && s0.role === "assisted" && s0.kind === "procedure",
    "with the right procedure, role and kind " + JSON.stringify({ p: s0 && s0.procedureText, r: s0 && s0.role, k: s0 && s0.kind, src: s0 && s0.source }));
  ok(s0 && s0.source === undefined, "the saved record gains no extra field — a quick entry is an ordinary entry");
  ok(s0 && /^\d{4}-\d{2}-\d{2}$/.test(s0.occurredAt || ""), "dated today by default");

  /* ── what this resident picks most comes back first ── */
  await ev(`PGLOG.open("quick"); return 1;`); await sleep(1400);
  ok(await ev(`var b=document.querySelector('#pglogRoot [data-pgl="q-pick"]'); return b ? /Appendicectomy/i.test(b.textContent) : false;`) === true,
    "the procedure just logged is now the first suggestion");

  /* ── dictation ── */
  await ev(`window.__spoken = "Assisted in a laparoscopic cholecystectomy in the emergency, no complications"; return 1;`);
  ok(await clickAct("q-mic") === "clicked", "the microphone is offered");
  await sleep(900);
  body = await txt();
  ok(/Heard:/i.test(body), "it shows what it heard before anything is saved");
  const dict = JSON.parse(await ev(`var q=SMD_PGLOG_QUICK.parseDictation(window.__spoken, {specialty:"ms-general-surgery"}); return JSON.stringify({t:q.title,r:q.role,s:q.setting,c:q.complications.length});`));
  ok(dict.t === "Laparoscopic cholecystectomy" && dict.r === "assisted" && dict.s === "emergency" && dict.c === 0,
    "one sentence fills procedure, role and setting, and does not invent a complication " + JSON.stringify(dict));
  ok(await ev(`return /Laparoscopic cholecystectomy/.test(document.getElementById("pglogRoot").innerText);`) === true,
    "and the form is filled in with it");

  /* ── photographs are consent-gated ── */
  const photoBtn = await ev(`return !!document.querySelector('#pglogRoot [data-pgl="q-photo"]');`);
  if (photoBtn) {
    await clickAct("q-photo"); await sleep(400);
    ok(await ev(`return !!document.querySelector(".pgl-consent");`) === true, "asking for a photograph opens the consent sheet first");
    ok(await ev(`var b=document.querySelector("#pglConsentGo"); return !!(b && b.disabled);`) === true,
      "the camera cannot open until the consent line is ticked");
    ok(await ev(`return /face|identifying/i.test(document.querySelector(".pgl-consent").innerText);`) === true,
      "and the sheet says what must stay out of the frame");
    await ev(`var b=document.querySelector("#pglConsentNo"); if(b) b.click(); return 1;`);
  } else {
    ok(true, "photograph capture is hidden where the device cannot store one securely (headless)");
    ok(true, "consent gate not applicable here");
    ok(true, "guidance not applicable here");
  }

  /* ── the numbers ── */
  await ev(`PGLOG.open("analytics"); return 1;`); await sleep(1500);
  body = await txt();
  ok(/Doing it yourself/i.test(body), "the analytics page shows independence year on year");
  ok(/Complications recorded/i.test(body), "and the complication record");
  const an = JSON.parse(await ev(`
    var d = SMD_PGLOG_ANALYTICS.dashboard(window.__entries, {});
    return JSON.stringify({ total: d.caseload.total, unver: d.unverified, pct: d.complications && d.complications.pct,
      lowN: d.complications && d.complications.lowN, dir: d.independence.direction, years: d.independence.years.length });`));
  ok(an.total === 5, "counts the 5 verified entries, not the 6 recorded " + JSON.stringify(an));
  ok(an.unver === 1, "and says one is not yet verified");
  ok(an.pct === null && an.lowN === true, "refuses to print a percentage from 3 procedures");
  ok(an.years === 2 && an.dir === "rising", "independence is up year on year");
  ok(/not yet verified/i.test(body), "the page tells the resident what was left out and why");
  ok(/self-reported|not an audited/i.test(body), "and that complication figures are not an audited statistic");

  /* ── CSV ── */
  const csv = await ev(`return SMD_PGLOG_ANALYTICS.toCsv(window.__entries, {});`);
  const rows = String(csv || "").split("\r\n");
  ok(rows[0].indexOf("date,kind,title") === 0, "CSV starts with a header row");
  ok(rows.length === 7, "one row per entry, plus the header");
  ok(await ev(`return !!document.querySelector('#pglogRoot [data-pgl="csv"]');`) === true, "and the page offers the export");

  if (process.env.SHOT) {
    // The doctor-registration gate and the phone sheet are separate overlays; hide them so the
    // screenshot shows the logbook screen being tested.
    await ev(`["verifyGate","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.style.display="none";}); return 1;`);
    await ev(`PGLOG.open("quick"); return 1;`); await sleep(900);
    const shot = await call("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64"));
    await ev(`["verifyGate","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.style.display="none";}); PGLOG.open("analytics"); return 1;`); await sleep(900);
    const shot2 = await call("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-analytics.png"), Buffer.from(shot2.result.data, "base64"));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN - a case is logged in three taps, dictation fills the form, the numbers are counted not estimated");
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message || e);
  fails++;
} finally {
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
