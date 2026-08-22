/* Bug B5 (2026-08-22 ward-round audit): two live patients could hold the same bed with nothing
 * said — bed number is how a nurse names a patient at 3am ("bed 7 needs review"), so two patients
 * in bed 7 makes every verbal instruction ambiguous. Not a hard block (bed swaps mid-transfer are
 * real) but never silent: the manual Save path confirms (naming who else is there); the bulk
 * ward-import path (ticking several patients in a row) surfaces it as a toast instead, so a batch
 * import is never interrupted per-row.
 * USAGE: node test/run-icu-bedclash.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9446, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-bedclash-chrome";
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

function clearRoster() {
  return `try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}`;
}

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
  await ev(`try { localStorage.setItem("smd_icu_groups","0"); } catch(e){} return 1;`);

  // ---- manual Save: a bed clash is confirmed, naming who else is there ----
  const confirmed = await J(`
    ${clearRoster()}
    ICU.reset(); ICU.ingestPatient({ name:"First In Bed 7", bed:"7" }); ICU.savePatient();
    window.__confirmMsg = null; window.confirm = function (m) { window.__confirmMsg = m; return false; };   // simulate Cancel
    ICU.reset(); ICU.ingestPatient({ name:"Second In Bed 7", bed:"7" }); ICU.savePatient();
    var list = ICU.listPatients();
    return JSON.stringify({ msg: window.__confirmMsg, names: list.map(function(p){return p.name}).sort() });
  `);
  ok(/Bed 7/.test(confirmed.msg || "") && /First In Bed 7/.test(confirmed.msg || ""), `save asks for confirmation, naming the patient already in that bed (got "${confirmed.msg}")`);
  ok(!confirmed.names.includes("Second In Bed 7"), `Cancel actually aborts the save — the clashing patient is NOT written (${JSON.stringify(confirmed.names)})`);
  ok(confirmed.names.includes("First In Bed 7"), `...and the first patient is untouched`);

  // ---- manual Save: confirming the clash proceeds normally ----
  const proceeded = await J(`
    window.confirm = function () { return true; };   // simulate OK — "yes, save anyway"
    ICU.reset(); ICU.ingestPatient({ name:"Second In Bed 7", bed:"7" }); ICU.savePatient();
    var list = ICU.listPatients();
    return JSON.stringify({ n: list.length, names: list.map(function(p){return p.name}).sort() });
  `);
  ok(proceeded.n === 2 && proceeded.names.includes("Second In Bed 7"), `confirming proceeds — a genuine bed swap/transfer stays possible (${JSON.stringify(proceeded.names)})`);

  // ---- manual Save: re-saving YOUR OWN patient in YOUR OWN bed is never treated as a clash ----
  const ownBed = await J(`
    ${clearRoster()}
    window.confirm = function () { window.__wronglyAsked = true; return true; };
    window.__wronglyAsked = false;
    ICU.reset(); ICU.ingestPatient({ name:"Same Patient", bed:"3", diagnosis:"v1" }); ICU.savePatient();
    ICU.ingestPatient({ diagnosis:"v2 update" }); ICU.savePatient();   // re-save, same bed, same record
    return JSON.stringify({ asked: window.__wronglyAsked, n: ICU.listPatients().length });
  `);
  ok(ownBed.asked === false, `updating your own patient in their own bed never triggers the clash prompt`);
  ok(ownBed.n === 1, `...and it's a single record, not a duplicate (${ownBed.n})`);

  // ---- bulk ward import: never blocks per-row, surfaces the clash as a toast instead ----
  const bulk = await J(`
    ${clearRoster()}
    delete window.confirm;   // if this path used confirm(), calling the deleted global would throw
    window.__toasts = [];
    window.toast = function (m) { window.__toasts.push(m); };
    return ICU.addWardPatientToRoster({ patient:{ name:"Ward A", bed:"12" }, patientId:"WA1", source:"Ward Sync" })
      .then(function(){ return ICU.addWardPatientToRoster({ patient:{ name:"Ward B", bed:"12" }, patientId:"WB1", source:"Ward Sync" }); })
      .then(function(){
        return JSON.stringify({ n: ICU.listPatients().length, toasts: window.__toasts, names: ICU.listPatients().map(function(p){return p.name}).sort() });
      });
  `);
  ok(bulk.n === 2, `the bulk import never gets blocked by a clash (${bulk.n} patients landed)`);
  ok(bulk.names.includes("Ward A") && bulk.names.includes("Ward B"), `both ward patients are present (${JSON.stringify(bulk.names)})`);
  ok(bulk.toasts.some(t => /Bed 12/.test(t) && /Ward A/.test(t)), `...but the clash is surfaced as a toast naming the other patient (${JSON.stringify(bulk.toasts)})`);

  console.log(fails === 0 ? "\nALL GREEN — B5 (silent duplicate bed) fixed: confirmed on manual save, toasted (never blocked) on bulk ward import" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
