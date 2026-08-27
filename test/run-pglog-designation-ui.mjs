/* NMC eLOGBook — designation gate + Academic Cell setup path, real-browser test.
 *
 * REPORTED 2026-08-27: "it is considering itself as resident rather than asking whether I'm faculty
 * or resident ... where is institution dashboard ... if I'm HOD should I first get an institute id?"
 *
 * Two separate defects sat behind that:
 *   1. The unenrolled empty state was written purely in RESIDENT voice, so a professor opening the
 *      module was told their "training record" was not linked.
 *   2. Worse: pglog-store.js could only READ programmes and residents. There was no
 *      create-institution, no create-programme and no enrol anywhere in the client, so nobody could
 *      ever be enrolled and EVERY user sat on that screen permanently, whatever their role.
 *
 * The role itself is still never self-declared — it comes from the server-side membership record,
 * because anyone who could call themselves faculty could sign a trainee's record (PGMER-2023 9.2(c)
 * penalises exactly that). The answer only chooses which INSTRUCTIONS to show.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-pglog-designation-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9401;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pglog-desig-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8991"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=390,844"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const txt = () => ev(`var r=document.getElementById("pglogRoot"); return r?r.innerText:""`);

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}
// Click a row/button in the module by its visible text.
const tap = (re) => ev(`var r=document.getElementById("pglogRoot");
  var b=[].slice.call(r.querySelectorAll("button,[data-pgl]")).filter(function(e){return /${re}/i.test(e.innerText||"")})[0];
  if(b){b.click();return true} return false;`);

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    if (await ev(`return !!(window.PGLOG && window.PGLOG.open)`) === true) { ready = true; break; }
  }
  ok(ready, "PGLOG module loaded");
  if (!ready) throw new Error("PGLOG never loaded");

  // Unenrolled + signed out is exactly the state the bug was reported in.
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1500);
  const t0 = String(await txt());
  ok(t0.length > 0, "module opened");

  // ── 1. It ASKS instead of assuming ──
  ok(/Which of these are you|Set up your logbook/i.test(t0), `entry screen asks for the role (got: ${JSON.stringify(t0.slice(0, 60))})`);
  ok(/I am a PG resident/i.test(t0), "offers: PG resident");
  ok(/I am faculty or HOD/i.test(t0), "offers: faculty or HOD");
  ok(/setting up our institution/i.test(t0), "offers: setting up our institution");
  ok(!/Your training record is not linked yet/i.test(t0),
     "no longer tells a professor their 'training record' is not linked");

  // ── 2. Faculty route speaks to faculty ──
  ok(await tap("I am faculty or HOD") === true, "faculty row is tappable");
  await sleep(600);
  const tf = String(await txt());
  ok(/Faculty and HOD access/i.test(tf), "faculty screen is faculty-voiced");
  ok(/adds you to the programme as/i.test(tf), "explains that the Academic Cell adds them");
  ok(/Signing needs a verified registration/i.test(tf),
     "warns up front that signing needs a verified registration, not at the moment they try");
  ok(/Institution code/i.test(tf), "faculty can enter the institution code too");
  ok(!/your guide's monthly authentication/i.test(tf), "no resident-only copy on the faculty path");

  // ── 3. The Academic Cell path exists at all — this is the part that did not exist ──
  await ev(`var r=document.getElementById("pglogRoot");
            var b=[].slice.call(r.querySelectorAll("[data-pgl='back'],button")).filter(function(e){return /back|close/i.test(e.getAttribute("data-pgl")||"")})[0];
            if(b)b.click(); return 1;`);
  await sleep(500);
  ok(await tap("setting up our institution") === true, "institution row is tappable");
  await sleep(900);
  const ti = String(await txt());
  // Institutions are SOLD, not self-served: provisioned through the owner-gated /api/tenants route.
  ok(/set up by StewardMD/i.test(ti), "the institution path explains it is provisioned, not self-served");
  ok(/institution code/i.test(ti), "explains that a code is issued");
  ok(!/Create institution/i.test(ti), "no self-serve create button that could only 403");
  // These asserted the self-serve create form. It is deliberately gone: the server refuses
  // kind:"institution" from anyone but the platform owner, so the form could only ever 403.
  ok(await ev(`return !document.getElementById("pglInstName")`) === true, "no self-serve name field");
  ok(await ev(`return !document.querySelector("[data-pgl='create-inst']")`) === true,
     "no self-serve create action");

  // ── 4. The store really did gain the three writes ──
  ok(await ev(`var s=window.SMD_PGLOG_STORE;
     return !!(s && typeof s.createInstitution==="function" && typeof s.createProgramme==="function" && typeof s.enrolPerson==="function")`) === true,
     "store exposes createInstitution / createProgramme / enrolPerson");

  // ── 5. The only way forward from here is entering an issued code ──
  ok(await tap("Enter it here") === true, "offers the code entry path");
  await sleep(700);
  ok(/[Ii]nstitution code/.test(String(await txt())), "code entry screen is reachable");

  /* ── 6. REGRESSION: pick an institution, then read the code off the card ──
   * The owner's screenshot showed a raw 32-char org id under the heading "Institution code".
   * "pick-inst" sets state.ctx = null and state.inst = {} and then calls loadInstitution()
   * DIRECTLY - nothing re-ran ensureContext(), so both sources of the code were empty for the
   * render that followed and the orgId fallback is what painted. Drive that exact path. */
  const HEX = "349cdc32210144cca031cccd1e0e2abc";
  await ev(`
    var HEX=${JSON.stringify(HEX)};
    var s=window.SMD_PGLOG_STORE, cur={orgId:""};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&o.orgId) cur.orgId=o.orgId; return cur };
    s.myInstitutions=function(){return Promise.resolve([{id:HEX,name:"Test Medical College",code:"SMD-TEST42"}])};
    s.me=function(id){return Promise.resolve({uid:"u1",orgId:id||HEX,orgCode:"SMD-TEST42",
      orgName:"Test Medical College",role:"academic_cell",
      caps:["pglog.configure","pglog.view.institution"],resident:null,programme:null,rotations:[]})};
    s.programmes=function(){return Promise.resolve({programmes:[]})};
    s.seedDemo=function(){return null};
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(900);
  await tap("setting up our institution");
  await sleep(1200);
  ok(await tap("Test Medical College") === true, "the institution is offered to pick");
  await sleep(1500);
  const tp = String(await txt());
  ok(/SMD-TEST42/.test(tp), `picked institution shows the shareable code (got: ${JSON.stringify(tp.slice(0, 160))})`);
  ok(!new RegExp(HEX).test(tp), "the raw 32-char org id is NOT presented as the institution code");

  /* ── 7. A FAILING /me must be reported, not painted over ──
   * This is the state the owner's second screenshot was actually in: no code, no name, and the raw
   * org id offered under "Share this with your residents and faculty". If the server will not
   * resolve the institution, the screen has to say so. */
  // Fresh context object: test 6 left cur.orgId set, so the picker would not render and pick-inst
  // (the only thing that re-runs ensureContext) would never fire.
  await ev(`
    var HEX=${JSON.stringify(HEX)};
    var s=window.SMD_PGLOG_STORE, cur={orgId:""};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.me=function(){ var e=new Error("not_found"); e.code="not_found"; return Promise.reject(e); };
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(700);
  await tap("setting up our institution");
  await sleep(900);
  await tap("Test Medical College");
  await sleep(1500);
  const te = String(await txt());
  ok(/Cannot open this institution/i.test(te), `a failing /me is reported (got: ${JSON.stringify(te.slice(0, 140))})`);
  ok(!/Share this with your residents/i.test(te), "a broken institution is not offered as shareable");

  /* ── 8. A SIGNED-OUT session must say so, not render an empty institution ──
   * Read off the owner's actual device over ios_webkit_debug_proxy: /me was returning
   * 401 signin_required. pglog-screens.js:2430 deliberately swallows that and installs a viewer
   * stub context (right for a resident's home screen). But ensureContext() short-circuits on
   * `if (state.ctx)`, so the stub became the permanent answer, /me was never retried, and the
   * Academic Cell console rendered a nameless institution with the raw org id - for four builds. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:${JSON.stringify(HEX)}};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.myInstitutions=function(){return Promise.resolve([{id:cur.orgId,name:"Test Medical College",code:"SMD-TEST42"}])};
    s.me=function(){ var e=new Error("signin_required"); e.code="signin_required"; return Promise.reject(e); };
    s.dashboard=function(){ var e=new Error("signin_required"); e.code="signin_required"; return Promise.reject(e); };
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1600);
  await tap("setting up our institution");
  await sleep(1800);
  const ts = String(await txt());
  ok(/Cannot open this institution/i.test(ts), `signed out is reported (got: ${JSON.stringify(ts.slice(0, 150))})`);
  ok(/[Ss]ign in/.test(ts), "it says to sign in");
  ok(!/Choose a different institution/i.test(ts), "it does not offer a picker that cannot succeed");

  /* ── 9. An OPD clinic must not pass as a PG institution ──
   * Read off the owner's account: the ONLY org it owns is "StewardMD Clinic A", an OPD clinic, and
   * the eLOGBook adopted it and called it "your institution". Nothing in q_orgs distinguished the
   * two - mode is native/connect (the EMR coupling), never clinic/college. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:""};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.myInstitutions=function(){return Promise.resolve([
      {id:"c111",name:"StewardMD Clinic A",code:"SMD-W2DG5S"},
      {id:"i222",name:"Test Medical College",code:"SMD-COLL01",kind:"institution"}]);};
    s.me=function(id){return Promise.resolve({uid:"u1",orgId:id,orgCode:"SMD-W2DG5S",
      orgName:"StewardMD Clinic A",orgKind:"clinic",role:"admin",caps:["pglog.configure"],
      resident:null,programme:null,rotations:[]});};
    s.programmes=function(){return Promise.resolve({programmes:[]})};
    s.seedDemo=function(){return null};
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1500);
  await tap("setting up our institution");
  await sleep(1600);
  const tk = String(await txt());
  ok(/OPD clinic, not a PG institution/i.test(tk), `the picker names the clinic as a clinic (got: ${JSON.stringify(tk.slice(0, 170))})`);
  ok(/PG institution/.test(tk), "and names the college as an institution");

  await tap("StewardMD Clinic A");
  await sleep(1800);
  const tw = String(await txt());
  ok(/not a PG institution/i.test(tw), `adopting a clinic is warned about (got: ${JSON.stringify(tw.slice(0, 170))})`);

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
