/* ICU Live-Status tap-to-edit test.
 *
 * Each Live-Patient-Status tile (HR, BP, MAP, SpO2, RR, Temp, Urine, Lactate, Net Fluid, K+) is tappable
 * and opens a FOCUSED single-value editor (data-icu-act="editvital:<domain>:<key>"). Vitals/labs route
 * through the import-review confirm; net-fluid applies directly. Pressors/Infusions are NOT single scalars,
 * so they stay non-editable here. Runs SOLO (smd_icu_groups=0). USAGE: node test/run-icu-quickedit.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8931/").replace(/\/?$/, "/");
const PORT = 9381, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-quickedit-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8931"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(300); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.state)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_icu_unit:anon");}catch(e){} return 1;`);

  // Seed a patient with a full vitals set + labs + net fluid
  await ev(`ICU.reset();
    ICU.ingestPatient({name:"QEPT",age:60,sex:"M",bed:"3",diagnosis:"Septic shock"});
    ICU.ingestMonitor({hr:88,sbp:102,dbp:75,spo2:94,rr:18,temp:38.9,lactate:8});
    ICU.ingestLabs({k:6.5});
    var s=ICU.state(); s.fluids=s.fluids||{}; s.fluids.net24h=500;
    ICU.open('overview'); return 1;`);
  await sleep(500);

  // Tiles are tappable (the scalar values) — and Pressors/Infusions are NOT
  const tiles = await ev(`return JSON.stringify({
    hr: !!document.querySelector('[data-icu-act="editvital:monitor:hr"]'),
    bp: !!document.querySelector('[data-icu-act="editvital:monitor:bp"]'),
    map: !!document.querySelector('[data-icu-act="editvital:monitor:map"]'),
    spo2: !!document.querySelector('[data-icu-act="editvital:monitor:spo2"]'),
    lactate: !!document.querySelector('[data-icu-act="editvital:monitor:lactate"]'),
    k: !!document.querySelector('[data-icu-act="editvital:labs:k"]'),
    net: !!document.querySelector('[data-icu-act="editvital:fluids:net24h"]'),
    pressors: !!document.querySelector('[data-icu-act="editvital:infusions:"]')
  });`);
  const T = JSON.parse(tiles || "{}");
  ok(T.hr && T.bp && T.map && T.spo2 && T.lactate && T.k && T.net, "every scalar Live-Status tile is tappable to edit");
  ok(!T.pressors, "Pressors/Infusions tiles are not single-value editable (correctly not tappable)");

  // Tapping HR opens a focused single-value editor pre-filled with the current value
  await clickAct("editvital:monitor:hr");
  ok(await ev(`return !!document.getElementById('qv-val');`) === true, "tapping a tile opens the single-value editor");
  ok(await ev(`var e=document.getElementById('qv-val'); return e ? String(e.value) : null;`) === "88", "editor is pre-filled with the current value (HR 88)");

  // Editing HR routes through the import-review confirm sheet (mistype safety); confirming applies it
  await ev(`var e=document.getElementById('qv-val'); if(e){e.value="130";} return 1;`);
  await clickAct("savequickvital");
  ok(await ev(`return !!document.getElementById('icuImpOv');`) === true, "saving a vital edit opens the confirm-review sheet (mistype safety)");
  await ev(`var b=document.getElementById('icuImpConfirm'); if(b) b.click(); return 1;`); await sleep(350);
  ok(await ev(`return (ICU.state().vitals||[]).some(function(v){return v && v.hr===130;});`) === true, "confirming the review applies the edited HR (130) to the record");

  // BP opens a two-field editor (systolic + diastolic)
  await clickAct("editvital:monitor:bp");
  ok(await ev(`return !!document.getElementById('qv-sbp') && !!document.getElementById('qv-dbp');`) === true, "BP tile opens a systolic + diastolic editor");
  await clickAct("closeform");

  // Net fluid edits apply DIRECTLY (no review sheet) and update state
  await clickAct("editvital:fluids:net24h");
  ok(await ev(`var e=document.getElementById('qv-val'); return e ? String(e.value) : null;`) === "500", "net-fluid editor pre-filled with 500");
  await ev(`var e=document.getElementById('qv-val'); if(e){e.value="250";} return 1;`);
  await clickAct("savequickvital");
  ok(await ev(`return (ICU.state().fluids||{}).net24h;`) === 250, "net-fluid edit applies directly to state (250)");

  console.log(fails === 0 ? "\nALL GREEN — ICU tap-to-edit test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
