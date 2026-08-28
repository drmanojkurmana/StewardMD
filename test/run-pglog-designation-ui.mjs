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

  /* myInstitutions() now REJECTS on a failed lookup instead of resolving to [] - a 401 or a 500 must
   * not read as "you belong to no institutions". This harness runs offline, so without a stub every
   * case would render the lookup-failed card. Resolve to [] to mean what the old silent catch used
   * to mean: genuinely none. */
  await ev(`window.SMD_PGLOG_STORE.myInstitutions = function () { return Promise.resolve([]); }; return 1;`);

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
    // Distinct org id per case: ensureContext() only refetches when the org changes, so reusing the
    // previous case's id would keep its ctx (and caps) alive and assert against stale state.
    var HEX="7777cccc7777cccc7777cccc7777cccc";
    var s=window.SMD_PGLOG_STORE, cur={orgId:""};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.myInstitutions=function(){return Promise.resolve([{id:HEX,name:"Test Medical College",code:"SMD-TEST42"}])};
    s.me=function(){ var e=new Error("not_found"); e.code="not_found"; return Promise.reject(e); };
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(700);
  // Home offers "I am setting up our institution" to a user with no role yet, and a plain
  // "Institution" row to one who already holds pglog.configure. Either is a valid way in.
  await tap("setting up our institution|Institution");
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
    // A DIFFERENT org id from the previous case on purpose: these cases share one page, and
    // ensureContext() only refetches when the org actually changes. Reusing the id left the previous
    // test's ctx - and its caps - in place, so this case asserted against stale state.
    var s=window.SMD_PGLOG_STORE, cur={orgId:"8888dddd8888dddd8888dddd8888dddd"};
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

  /* ── 10. Switching institution must not show the previous one's identity ──
   * state.ctx was cached but keyed to nothing, so after the device is pointed at a different
   * college the console kept rendering the old name and code (seen live: /me returned
   * SMD-AKNZGB / "Test Medical College" while the screen still showed the previous org's id). */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"aaaa1111aaaa1111aaaa1111aaaa1111"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.myInstitutions=function(){return Promise.resolve([])};
    s.programmes=function(){return Promise.resolve({programmes:[]})};
    s.seedDemo=function(){return null};
    s.me=function(id){
      var first = id==="aaaa1111aaaa1111aaaa1111aaaa1111";
      return Promise.resolve({uid:"u1",orgId:id,
        orgCode: first?"SMD-FIRST1":"SMD-SECOND",
        orgName: first?"First College":"Second College",
        orgKind:"institution",role:"academic_cell",caps:["pglog.configure"],
        resident:null,programme:null,rotations:[]});
    };
    return 1;`);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1400);
  await tap("setting up our institution");
  await sleep(1800);
  ok(/SMD-FIRST1/.test(String(await txt())), "first college renders");

  // Repoint the device WITHOUT going through pick-inst, then reopen the screen.
  await ev(`SMD_PGLOG_STORE.setContext({orgId:"bbbb2222bbbb2222bbbb2222bbbb2222"}); return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(500);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1400);
  await tap("setting up our institution");
  await sleep(2000);
  const t2 = String(await txt());
  ok(/SMD-SECOND/.test(t2), `the new college's code is shown (got: ${JSON.stringify(t2.slice(0, 150))})`);
  ok(!/SMD-FIRST1/.test(t2), "the previous college's code is NOT still on screen");

  /* ── 11. A faculty member must be able to REACH the faculty screens ──
   * screenHome() returned the trainee setup prompt whenever there was no resident record, and the
   * "Faculty review" / "Department oversight" rows are built BELOW that early return. A guide or HOD
   * therefore opened the module, was told to set up their own trainee logbook, and had no route to
   * the pending queue at all. Separately, `case "go"` did not call loadFaculty/loadDept, so even on
   * arrival the screen sat on a loading skeleton with no request issued. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"9999eeee9999eeee9999eeee9999eeee"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.me=function(id){return Promise.resolve({uid:"fb:guide-1",orgId:id,orgCode:"SMD-FAC001",
      orgName:"Sim Medical College",orgKind:"institution",role:"pg_faculty",
      caps:["pglog.verify","pglog.view.assigned"], resident:null, programme:null, rotations:[]});};
    window.__facultyCalls = 0;
    s.facultyDashboard=function(){ window.__facultyCalls++; return Promise.resolve({pending:[],residents:[],summary:{}}); };
    return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1800);
  const tf2 = String(await txt());
  ok(/Faculty review/i.test(tf2), `a guide sees the faculty entry point (got: ${JSON.stringify(tf2.slice(0, 150))})`);
  ok(!/Set up your logbook|Which of these are you/i.test(tf2),
     "a guide is NOT told to set up a trainee logbook");

  ok(await tap("Faculty review") === true, "the faculty row is tappable");
  await sleep(1600);
  ok(await ev(`return window.__facultyCalls > 0`) === true,
     "navigating to the faculty screen actually requests its data (no permanent skeleton)");

  /* ── 12. A FAILED lookup is not an empty list ──
   * myInstitutions() swallowed everything including the response status, so a 401/500 rendered as
   * "Institutions are set up by StewardMD" - telling an administrator whose own colleges had just
   * failed to load that they had none, and sending them somewhere that cannot help. */
  // Phase 1: point at a DIFFERENT org so ensureContext() drops the previous case's ctx (and its
  // faculty caps), and let /me fail so the replacement is the capability-free stub.
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"cccc3333cccc3333cccc3333cccc3333"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.me=function(){ var e=new Error("signin_required"); e.code="signin_required"; return Promise.reject(e); };
    s.myInstitutions=function(){ var e=new Error("http_500"); e.code="http_500"; return Promise.reject(e); };
    window.__phase1 = cur; return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1600);
  // Phase 2: now unlink, so the screen takes the picker path where myInstitutions() is consulted.
  await ev(`window.__phase1.orgId = ""; return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1400);
  await tap("setting up our institution|Institution");
  await sleep(1600);
  const tm = String(await txt());
  ok(/Could not load your institutions/i.test(tm),
     `a failed institution lookup is reported (got: ${JSON.stringify(tm.slice(0, 150))})`);
  ok(!/set up by StewardMD/i.test(tm),
     "a failed lookup is NOT reported as 'you have no institutions'");

  /* ── 13. A RETURNED entry must actually be correctable ──
   * "Correct" was a toast that told the resident to open the entry and correct the fields - which is
   * exactly what they had just tried to do. screenEntry renders read-only rows and store.editEntry()
   * had no callers anywhere, so the only live control was Resubmit, which sent the identical entry
   * back to the guide who returned it. An infinite return loop. */
  const RET_ID = "entry-returned-1";
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"dddd4444dddd4444dddd4444dddd4444"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.getDraft=function(){return null};
    s.myInstitutions=function(){return Promise.resolve([])};
    s.me=function(id){return Promise.resolve({uid:"fb:res-1",orgId:id,orgCode:"SMD-RET001",
      orgName:"Sim Medical College",orgKind:"institution",role:"pg_resident",
      caps:["pglog.log.own","pglog.submit.own","pglog.view.own"],
      resident:{id:"res-1",name:"Aarav Sharma",programmeId:"prog-1",departmentId:"dept-medicine",
                trainingYear:2,startDate:"2024-05-01",guide:"fb:guide-1"},
      programme:{id:"prog-1",name:"General Medicine",degree:"MD",curriculumId:"md-general-medicine"},
      rotations:[]});};
    s.dashboard=function(){return Promise.resolve({
      resident:{id:"res-1",name:"Aarav Sharma",programmeId:"prog-1",trainingYear:2,startDate:"2024-05-01"},
      programme:{id:"prog-1",name:"General Medicine",degree:"MD"},
      summary:{}, weekly:{}, months:[], rotations:[], assessments:[], attestations:[],
      entries:[{id:${JSON.stringify(RET_ID)},residentId:"res-1",kind:"procedure",status:"returned",
                occurredAt:"2026-08-20",procedureText:"Central venous access",
                role:"performed_supervised",supervisor:"fb:guide-1",
                returnReason:"Name the supervising consultant."}]});};
    /* Reset the module's cached context explicitly. ensureContext() only invalidates between two
     * REAL orgs - going from "no institution" to one does not, because invalidating on an absent org
     * turns every ordinary unlinked state into a refetch loop. In the app the paths that link an
     * institution (pick-inst, save-org) null state.ctx themselves; a harness that pokes the store
     * directly has to do the same. */
    window.SMD_PGLOG_SCREENS._state.ctx = null;
    window.SMD_PGLOG_SCREENS._state.dash = null;
    window.__edits = []; window.__resubmits = [];
    s.editEntry=function(id, body){ window.__edits.push({id:id, hasServerKey: "__serverId" in (body||{})});
      return Promise.resolve({id:id, status:"returned"}); };
    s.resubmit=function(id){ window.__resubmits.push(id); return Promise.resolve({id:id, status:"submitted"}); };
    return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1800);

  ok(await ev(`var d=window.SMD_PGLOG_SCREENS._state.dash;
     return !!(d && d.entries && d.entries.length === 1)`) === true,
     `the stubbed dashboard loaded (state.dash: ${await ev(`var d=window.SMD_PGLOG_SCREENS._state.dash;
        return d ? ("entries=" + ((d.entries||[]).length)) : "null"`)})`);

  // Open the returned entry, then correct it.
  await ev(`window.PGLOG.open(${JSON.stringify("entry/" + RET_ID)}); return 1;`);
  await sleep(1200);
  const tEntry = String(await txt());
  ok(/Correct/i.test(tEntry), `the returned entry offers Correct (got: ${JSON.stringify(tEntry.slice(0, 130))})`);

  ok(await tap("^Correct$") === true, "the Correct action is present");
  await sleep(1400);
  // Field VALUES are not innerText, so read them off the controls themselves.
  const filled = await ev(`var r=document.getElementById("pglogRoot");
    var vals=[].slice.call(r.querySelectorAll("input,textarea,select")).map(function(x){return String(x.value||"")});
    return vals.join(" | ")`);
  ok(/Central venous access/i.test(String(filled)),
     `Correct opens the editor pre-filled with the entry (values: ${JSON.stringify(String(filled).slice(0, 160))})`);

  await tap("Submit");
  await sleep(1600);
  ok(await ev(`return window.__edits.length === 1 && window.__edits[0].id === ${JSON.stringify(RET_ID)}`) === true,
     "saving PATCHes the existing entry rather than creating a second one");
  ok(await ev(`return window.__edits[0].hasServerKey === false`) === true,
     "the internal __serverId marker is not sent to the server");
  ok(await ev(`return window.__resubmits.length === 1`) === true,
     "and the corrected entry goes back for verification");

  /* ── 14. Monthly authentication must be performable, not just counted ──
   * PGMER-2023 5.2(vii). store.attest() existed with zero callers anywhere in the client, while the
   * home, faculty and department screens and the printed report all counted months as OVERDUE. The
   * app told four different people a month was unauthenticated and gave nobody a way to sign it. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"aaaa5555aaaa5555aaaa5555aaaa5555"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.myInstitutions=function(){return Promise.resolve([])};
    s.me=function(id){return Promise.resolve({uid:"fb:guide-1",orgId:id,orgCode:"SMD-ATT001",
      orgName:"Sim Medical College",orgKind:"institution",role:"pg_faculty",
      caps:["pglog.verify","pglog.view.assigned","pglog.attest"],
      resident:null, programme:null, rotations:[]});};
    window.__attests = [];
    s.attest=function(body){ window.__attests.push(body); return Promise.resolve({id:"att-1"}); };
    s.facultyDashboard=function(){ return Promise.resolve({
      pending:[], overdue:[],
      residents:[{ resident:{id:"res-9",name:"Meera Iyer",trainingYear:2},
                   summary:{verified:12}, weekly:{pct:88},
                   attestationOverdue:["2026-06","2026-07"] }]}); };
    window.SMD_PGLOG_SCREENS._state.ctx = null;
    window.SMD_PGLOG_SCREENS._state.dash = null;
    window.SMD_PGLOG_SCREENS._state.faculty = null;
    // headless Chrome answers confirm() with false unless told otherwise
    window.confirm = function(){ return true; };
    return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1600);
  ok(await tap("Faculty review") === true, "the guide can open faculty review");
  await sleep(1600);

  const tAtt = String(await txt());
  ok(/Months to authenticate/i.test(tAtt),
     `the outstanding months are listed (got: ${JSON.stringify(tAtt.slice(0, 170))})`);
  ok(/June 2026/.test(tAtt), "and each month is named in words, not as a raw period key");

  /* Click the control by its ACTION, not its label: the resident row above it carries the subtitle
   * "2 month(s) to authenticate", and tap() matches case-insensitively, so a text match hits the row
   * and navigates away instead. */
  ok(await ev(`var b=document.querySelector('[data-pgl="attest-month"]');
     if(!b) return false; b.click(); return true;`) === true,
     "an Authenticate control exists for the outstanding month");
  await sleep(1500);
  const diag = await ev(`return JSON.stringify({
    attesting: window.SMD_PGLOG_SCREENS._state.attesting || null,
    confirmIsStub: String(window.confirm).indexOf("return true") > -1,
    btn: (function(){ var b=document.querySelector('[data-pgl="attest-month"]');
      return b ? {id:b.getAttribute("data-id"), p:b.getAttribute("data-p"), txt:(b.innerText||"").trim()} : null; })(),
    screen: (document.getElementById("pglogRoot")||{}).innerText ? "ok" : "none"
  })`);
  const sent = await ev(`return JSON.stringify(window.__attests)`);
  if (String(sent) === "[]") console.log("   diag:", String(diag).slice(0, 260));
  ok(/"kind":"monthly"/.test(String(sent)) && /"period":"2026-06"/.test(String(sent)) &&
     /"residentId":"res-9"/.test(String(sent)),
     `it signs that month for that resident (sent: ${String(sent).slice(0, 140)})`);

  /* ── 15. A posting must be recordable by someone ──
   * store.createRotation() had no callers, and the resident's own Rotations screen tells them to ask
   * their department - which had no control either. So a posting could not be recorded anywhere,
   * while the residential-posting requirement is measured from exactly these records. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"bbbb6666bbbb6666bbbb6666bbbb6666"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.myInstitutions=function(){return Promise.resolve([])};
    s.me=function(id){return Promise.resolve({uid:"fb:cell-1",orgId:id,orgCode:"SMD-ROT001",
      orgName:"Sim Medical College",orgKind:"institution",role:"academic_cell",
      caps:["pglog.configure","pglog.view.institution","pglog.view.dept"],
      resident:null, programme:null, rotations:[]});};
    window.__rots = [];
    s.createRotation=function(body){ window.__rots.push(body); return Promise.resolve({id:"rot-1"}); };
    s.deptDashboard=function(){ return Promise.resolve({
      residents:[{ resident:{id:"res-7",name:"Kabir Reddy",trainingYear:1,
                             programmeId:"prog-1",departmentId:"dept-medicine",unit:"Unit A"},
                   summary:{verified:3}, weekly:{pct:75}, attestationOverdue:0 }]}); };
    window.SMD_PGLOG_SCREENS._state.ctx = null;
    window.SMD_PGLOG_SCREENS._state.dash = null;
    window.SMD_PGLOG_SCREENS._state.dept = null;
    window.SMD_PGLOG_SCREENS._state.faculty = null;
    return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1600);
  ok(await tap("Department oversight") === true, "the Academic Cell can open department oversight");
  await sleep(1700);
  ok(await tap("Kabir Reddy") === true, "and open a resident");
  await sleep(1400);

  const tRot = String(await txt());
  ok(/Add a posting/i.test(tRot), `the posting form is offered (got: ${JSON.stringify(tRot.slice(0, 150))})`);

  await ev(`var h=window.SMD_PGLOG_SCREENS._state.host;
    h.querySelector("#pglRotName").value="Medical ICU";
    h.querySelector("#pglRotFrom").value="2026-01-01";
    h.querySelector("#pglRotTo").value="2026-03-31";
    return 1;`);
  await ev(`var b=document.querySelector('[data-pgl="add-rotation"]'); if(b) b.click(); return !!b;`);
  await sleep(1500);
  const rots = await ev(`return JSON.stringify(window.__rots)`);
  ok(/"name":"Medical ICU"/.test(String(rots)) && /"residentId":"res-7"/.test(String(rots)) &&
     /"departmentId":"dept-medicine"/.test(String(rots)),
     `the posting is recorded against that resident (sent: ${String(rots).slice(0, 150)})`);

  /* ── 16. A programme created by mistake must be removable ──
   * The console could create a programme and never remove one, so a mistyped or duplicated
   * programme was permanent. The control is offered for every programme and the SERVER decides:
   * it refuses with 409 while anyone is still enrolled. */
  await ev(`
    var s=window.SMD_PGLOG_STORE, cur={orgId:"cccc7777cccc7777cccc7777cccc7777"};
    s.context=function(){return cur};
    s.setContext=function(o){ if(o&&"orgId" in o) cur.orgId=o.orgId; return cur };
    s.seedDemo=function(){return null};
    s.myInstitutions=function(){return Promise.resolve([])};
    s.me=function(id){return Promise.resolve({uid:"fb:cell-1",orgId:id,orgCode:"SMD-DEL001",
      orgName:"Sim Medical College",orgKind:"institution",role:"academic_cell",
      caps:["pglog.configure","pglog.view.institution"], resident:null, programme:null, rotations:[]});};
    window.__dels = [];
    s.programmes=function(){ return Promise.resolve({ programmes:[
      {id:"prog-keep", name:"General Medicine", degree:"MD", durationMonths:36},
      {id:"prog-dupe", name:"Duplicate created by mistake", degree:"MD", durationMonths:36}]}); };
    s.deleteProgramme=function(pid){
      window.__dels.push(pid);
      if (pid === "prog-keep") { var e=new Error("programme_in_use"); e.code="programme_in_use";
        e.userMessage="4 resident(s) are still on this programme."; return Promise.reject(e); }
      return Promise.resolve({ok:true, deleted:true, id:pid});
    };
    window.SMD_PGLOG_SCREENS._state.ctx = null;
    window.SMD_PGLOG_SCREENS._state.dash = null;
    window.SMD_PGLOG_SCREENS._state.inst = {};
    window.confirm = function(){ return true; };
    return 1;`);
  await ev(`window.PGLOG.close && window.PGLOG.close(); return 1;`);
  await sleep(400);
  await ev(`window.PGLOG.open(); return 1;`);
  await sleep(1500);
  await tap("setting up our institution|Institution");
  await sleep(1800);

  const tDel = String(await txt());
  ok(/Remove/.test(tDel), `each programme offers a Remove control (got: ${JSON.stringify(tDel.slice(0, 160))})`);

  ok(await ev(`var b=document.querySelector('[data-pgl="del-prog"][data-id="prog-keep"]');
     if(!b) return false; b.click(); return true;`) === true, "the in-use programme has a control too");
  await sleep(1400);
  ok(await ev(`return window.__dels.indexOf("prog-keep") > -1`) === true,
     "removing an in-use programme is ATTEMPTED and refused by the server, not hidden by the client");

  ok(await ev(`var b=document.querySelector('[data-pgl="del-prog"][data-id="prog-dupe"]');
     if(!b) return false; b.click(); return true;`) === true, "the duplicate can be removed");
  await sleep(1400);
  ok(await ev(`return window.__dels.indexOf("prog-dupe") > -1`) === true,
     "and the delete reaches the server for the empty one");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
