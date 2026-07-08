/* ICU complaints + clinical-engine diagnosis search/select test.
 *
 * Proves: the presenting-complaints field saves + renders (Care Plan → Diagnosis);
 * the clinical reasoning engine's KB disease search is reused (window.SMD_REASON.search);
 * searching + selecting a diagnosis sets the patient's WORKING diagnosis (clinician-editable,
 * not auto-applied elsewhere); and it is scoped to the selected patient.
 *
 * Reuses the engine — does NOT modify reasoning/ranking. USAGE: node test/run-icu-dx.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9378, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-dx-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && window.SMD_REASON && SMD_REASON.search)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU + SMD_REASON.search not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) engine search is reused (KB disease search) and returns relevant hits
  const r1 = await ev(`return JSON.stringify(SMD_REASON.search("sepsis", 6).map(function(d){return d.name;}));`);
  const hits = JSON.parse(r1);
  ok(hits.length > 0 && hits.some(function (n) { return /sepsis/i.test(n); }), "SMD_REASON.search('sepsis') returns KB diseases incl. Sepsis (" + hits.slice(0, 3).join(", ") + ")");

  // 2) complaints field saves + renders in Care Plan → Diagnosis
  //    (single synchronous ev — onClick paints synchronously, so no debounce race)
  const r2 = await ev(`
    ICU.reset(); ICU.ingestPatient({name:"DXPT",age:52,sex:"M",complaints:"Fever x5 days, abdominal distension"});
    ICU.open();
    var cp=document.querySelector('[data-icu-act="ws:careplan"]'); if(cp) cp.click();
    return JSON.stringify({ cc: (document.querySelector('.icu-dx-cc')||{}).textContent||"", stateCc: ICU.state().patient.complaints||"", sub: Array.prototype.map.call(document.querySelectorAll('.icu-subnav .icu-seg'),function(s){return s.textContent;}) });
  `);
  const D2 = JSON.parse(r2);
  ok(/Fever x5 days/.test(D2.cc), "presenting complaints saved + rendered in Care Plan → Diagnosis");
  ok(D2.stateCc === "Fever x5 days, abdominal distension", "complaints persisted on the patient model");
  ok(D2.sub.indexOf("Diagnosis") >= 0, "Care Plan sub-nav exposes the Diagnosis view");

  // 3) search → select sets the WORKING diagnosis (single synchronous ev)
  const r3 = await ev(`
    var b=document.querySelector('[data-icu-act="dxsearch"]'); if(b) b.click();
    var i=document.getElementById('icuDxq'); if(i){ i.value="pancreatit"; i.dispatchEvent(new Event('input',{bubbles:true})); }
    var results=Array.prototype.map.call(document.querySelectorAll('#icuDxResults .icu-dx-hit .nm'),function(x){return x.textContent;}).slice(0,4);
    var h=document.querySelector('#icuDxResults .icu-dx-hit'); if(h) h.click();
    return JSON.stringify({ results: results, dx: ICU.state().patient.diagnosis||"" });
  `);
  const D3 = JSON.parse(r3);
  ok(D3.results.length > 0 && D3.results.some(function (n) { return /pancreatitis/i.test(n); }), "live search 'pancreatit' → KB matches (" + D3.results.slice(0, 2).join(", ") + ")");
  ok(D3.dx && /pancreatitis/i.test(D3.dx), "selecting a result set the working diagnosis (" + D3.dx + ")");

  // 4) patient isolation — new patient does not inherit prior complaints/diagnosis
  const iso = JSON.parse(await ev(`ICU.reset(); ICU.ingestPatient({name:"DXPT2",age:40,sex:"F"}); var p=ICU.state().patient; return JSON.stringify({name:p.name, complaints:p.complaints||"", diagnosis:p.diagnosis||""});`));
  ok(iso.name === "DXPT2" && !iso.complaints && !iso.diagnosis, "patient isolation — new patient has no prior complaints/diagnosis");

  console.log(fails === 0 ? "\nALL GREEN — ICU complaints + diagnosis test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
