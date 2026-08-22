/* Bug B1 (2026-08-22 ward-round audit): two patients admitted in the same millisecond used to
 * collide into ONE record — the id was Date.now() alone, with no per-call entropy. Reproduced
 * live: freeze the clock, admit "Mrs Lakshmi" (septic shock) then "Mr Rao" (post-op), and the
 * board showed only one patient. Since the roster upserts by id and the SAME id is the Firestore
 * document key, the loss was silent on-device and in the cloud copy.
 * USAGE: node test/run-icu-idcollision.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9445, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-idcol-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // The exact reproduction from the audit: freeze the clock so BOTH admissions land in the same
  // millisecond (a real-world equivalent: any loop that saves several patients in one tick).
  const r = await J(`
    try { localStorage.setItem("smd_icu_groups","0"); } catch(e){}
    try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
    var real = Date.now; Date.now = function(){ return 1787400000000; };
    ICU.reset(); ICU.ingestPatient({ name:"Mrs Lakshmi", diagnosis:"Septic shock", bed:"1" }); ICU.ingestMonitor({ hr:130, sbp:70, dbp:40, spo2:88 }); ICU.savePatient();
    ICU.reset(); ICU.ingestPatient({ name:"Mr Rao", diagnosis:"Post-op observation", bed:"2" }); ICU.ingestMonitor({ hr:76, sbp:124, dbp:76, spo2:98 }); ICU.savePatient();
    Date.now = real;
    var list = ICU.listPatients();
    return JSON.stringify({ n: list.length, names: list.map(function(p){return p.name}).sort(), ids: list.map(function(p){return p.id}) });
  `);
  ok(r.n === 2, `both patients survive a same-millisecond admit (got ${r.n}: ${JSON.stringify(r.names)})`);
  ok(r.names.includes("Mrs Lakshmi") && r.names.includes("Mr Rao"), `neither name was silently replaced by the other (${JSON.stringify(r.names)})`);
  ok(new Set(r.ids).size === r.ids.length, `the two records have DISTINCT ids (${JSON.stringify(r.ids)})`);

  // Ward Sync re-ingest of the SAME ward patient must still resolve to the SAME record — the fix
  // must not turn a legitimate re-sync into a duplicate. patientId present -> no random suffix.
  // addWardPatientToRoster (not ingestFromWard, which only fills the live buffer) is the actual
  // roster-writing path this fix touches — it returns a Promise, resolved once the upsert lands.
  const resync = await J(`
    try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
    var real = Date.now; Date.now = function(){ return 1787400000000; };
    var bundle = { patient:{ name:"Ward Patient", age:50, sex:"M", bed:"9" }, patientId:"WARD-STABLE-1", source:"Ward Sync" };
    return ICU.addWardPatientToRoster(bundle).then(function(entryA){
      Date.now = function(){ return 1787400099999; };   // a different millisecond, SAME ward patientId
      return ICU.addWardPatientToRoster(bundle).then(function(entryB){
        Date.now = real;
        return JSON.stringify({ n: ICU.listPatients().length, same: entryA.id === entryB.id, idA: entryA.id, idB: entryB.id });
      });
    });
  `);
  ok(resync.n === 1, `re-syncing the SAME ward patient never creates a duplicate record (${resync.n} on board)`);
  ok(resync.same === true, `...because a real ward patientId keeps a STABLE id across re-syncs (not randomised) — ${resync.idA} vs ${resync.idB}`);

  // Two DIFFERENT ward patients, neither with a usable patientId (e.g. a manual/legacy feed),
  // admitted in the same millisecond, must still not collide.
  const noWardId = await J(`
    try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
    var real = Date.now; Date.now = function(){ return 1787400000000; };
    ICU.reset(); ICU.ingestFromWard({ patient:{ name:"No ID A" }, source:"Ward Sync" }); ICU.savePatient();
    ICU.reset(); ICU.ingestFromWard({ patient:{ name:"No ID B" }, source:"Ward Sync" }); ICU.savePatient();
    Date.now = real;
    var list = ICU.listPatients();
    return JSON.stringify({ n: list.length, names: list.map(function(p){return p.name}).sort() });
  `);
  ok(noWardId.n === 2, `two ward-sourced patients with no usable patientId still don't collide (${noWardId.n}: ${JSON.stringify(noWardId.names)})`);

  console.log(fails === 0 ? "\nALL GREEN — B1 (same-millisecond patient-id collision) fixed, ward re-sync stays stable" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
