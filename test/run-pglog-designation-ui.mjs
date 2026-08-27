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
  ok(/Create your institution/i.test(ti), "Academic Cell can create an institution");
  ok(/institution code/i.test(ti), "explains that this mints the institution code");
  ok(/Institution name/i.test(ti), "asks for the institution name");
  ok(await ev(`return !!document.getElementById("pglInstName")`) === true, "name field is present");
  ok(await ev(`return !!document.querySelector("[data-pgl='create-inst']")`) === true,
     "the create action is wired (this is what pglog-store.js could never do before)");

  // ── 4. The store really did gain the three writes ──
  ok(await ev(`var s=window.SMD_PGLOG_STORE;
     return !!(s && typeof s.createInstitution==="function" && typeof s.createProgramme==="function" && typeof s.enrolPerson==="function")`) === true,
     "store exposes createInstitution / createProgramme / enrolPerson");

  // ── 5. An empty name must not create a nameless institution ──
  await ev(`document.getElementById("pglInstName").value=""; return 1;`);
  await tap("Create institution");
  await sleep(500);
  ok(/Create your institution/i.test(String(await txt())), "empty name does not proceed");

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

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
