/* ICU alert-engine safety test (recompute) — drives critical imported labs + a septic-shock
 * vitals set through ICU.ingestLabs/ingestMonitor and asserts the alerts that now fire.
 *
 * Proves the P0/P1 fixes: imported labs alert (creat/eGFR/AKI, Hb, platelets, glucose, K/Na);
 * lab units (platelet lakhs→×10⁹/L, glucose no-unit); qSOFA sepsis composite; fever; oliguria
 * (+AKI composite) with default 70 kg; SpO₂ categorised Respiratory not Hemodynamics; ARDS
 * PEEP-gated; K crit constant shared. Deterministic (no AI).  USAGE: node test/run-icu-alerts.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9404, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-alerts-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.ingestLabs && ICU.ingestMonitor && window.SMD_wardToSI)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  const titles = (arr) => arr.map(a => a.title);
  const bySrc = (arr, src) => arr.filter(a => a.source === src).map(a => a.title);

  // ===== P0-units (#2): wardToSI conversions (must land before alerts) =====
  const u = await J(`return JSON.stringify({
    pltLakh: SMD_wardToSI("plt", 1.41, ""),
    pltUnit: SMD_wardToSI("plt", 1.41, "lakhs/cumm"),
    pltAbs: SMD_wardToSI("plt", 141000, "/cumm"),
    pltReal: SMD_wardToSI("plt", 45, "10^9/L"),
    gluMgdlNoUnit: +SMD_wardToSI("glu", 545, "").toFixed(2),
    gluHigh: +SMD_wardToSI("glu", 30, "").toFixed(2),
    urea: +SMD_wardToSI("urea", 120, "mg/dL").toFixed(1)
  });`);
  ok(u.pltLakh === 141 && u.pltUnit === 141 && u.pltAbs === 141 && u.pltReal === 45, `platelets: 1.41 lakhs→141, 141000/cumm→141, true 45 kept (${u.pltLakh}/${u.pltUnit}/${u.pltAbs}/${u.pltReal})`);
  ok(u.gluMgdlNoUnit === 545 && u.gluHigh === 30, `glucose kept in mg/dL (Indian units): 545→545, 30→30 (${u.gluMgdlNoUnit}/${u.gluHigh})`);
  ok(u.urea === 120, `urea kept in mg/dL (Indian units): 120→${u.urea}`);

  // ===== P0 (#1): imported CRITICAL labs now alert (the real patient: creat 910, eGFR 5, Hb 5.4, glu 30) =====
  const c1 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"LABPT",age:60,sex:"M"});
    ICU.ingestLabs({ creat:10.3, egfr:5, hb:5.4, plt:141, glu:545, k:6.8, na:118 });
    var al = ICU.state().alerts || [];
    return JSON.stringify({ n:al.length, titles: al.map(function(a){return a.title;}) });
  `);
  ok(c1.n > 0, `imported critical labs now fire alerts (was "No active alerts"): ${c1.n} alerts`);
  ok(c1.titles.some(t => /renal impairment/i.test(t)) && c1.titles.some(t => /low eGFR|eGFR/i.test(t)), `creatinine 10.3 mg/dL + eGFR 5 → renal alerts [${c1.titles.filter(t=>/renal|eGFR/i.test(t)).join(", ")}]`);
  ok(c1.titles.some(t => /anaemia/i.test(t)), "Hb 5.4 → severe anaemia alert");
  ok(c1.titles.some(t => /hyperglyc/i.test(t)), "glucose 545 mg/dL → severe hyperglycaemia alert");
  ok(c1.titles.some(t => /hyperkal/i.test(t)) && c1.titles.some(t => /sodium/i.test(t)), "K 6.8 + Na 118 → electrolyte alerts");
  ok(!c1.titles.some(t => /thrombocyto/i.test(t)), "platelets 141 ×10⁹/L → NO false thrombocytopenia (unit fix worked)");

  // ===== P0 (#3): septic-shock vitals → qSOFA composite + fever + hypotension + lactate + hypoxaemia =====
  const c3 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"SEPSIS",age:60,sex:"M"});
    ICU.ingestMonitor({ hr:132, rr:34, sbp:78, dbp:40, temp:39.4, spo2:86, lactate:6.2, uop:8 });
    var al = ICU.state().alerts || [];
    return JSON.stringify({ titles: al.map(function(a){return a.title;}), respSrc: al.filter(function(a){return a.source==="Respiratory";}).map(function(a){return a.title;}), sepSrc: al.filter(function(a){return a.source==="Sepsis / Temperature";}).map(function(a){return a.title;}) });
  `);
  ok(c3.titles.some(t => /qSOFA/i.test(t)), `septic-shock → qSOFA composite [${c3.sepSrc.join(", ")}]`);
  ok(c3.titles.some(t => /pyrexia|hyperpyrexia/i.test(t)), "T 39.4 → pyrexia alert (#8)");
  ok(c3.titles.some(t => /hypotension/i.test(t)) && c3.titles.some(t => /lactat/i.test(t)), "MAP + lactate hemodynamic alerts");
  ok(c3.titles.some(t => /hypoxaemia/i.test(t)), "SpO₂ 86 → severe hypoxaemia alert");

  // ===== P1 (#7): alert source categorisation — SpO₂ is Respiratory, not Hemodynamics =====
  ok(c3.respSrc.some(t => /hypoxaemia/i.test(t)), `SpO₂ alert categorised Respiratory (was Hemodynamics): [${c3.respSrc.join(", ")}]`);

  // ===== P1 (#9): oliguria uses default 70 kg when weight absent + AKI composite =====
  const c9 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"OLIG",age:60,sex:"M"});   // no weightKg
    ICU.ingestMonitor({ uop:8 }); ICU.ingestLabs({ creat:350 });
    var al = ICU.state().alerts || [];
    return JSON.stringify({ olig: al.some(function(a){return /oliguria/i.test(a.title);}), aki: al.some(function(a){return /acute kidney injury/i.test(a.title);}) });
  `);
  ok(c9.olig && c9.aki, `oliguria (default 70 kg) + raised creatinine → AKI composite (olig=${c9.olig}, aki=${c9.aki})`);

  // ===== #4/#6 regression: ARDS PEEP-gated; latest vital by ts =====
  const c4 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"ARDS",age:60,sex:"M"});
    ICU.ingestVentilator({ pf:90 }); var noVent = (ICU.state().alerts||[]).map(function(a){return a.title;});
    ICU.ingestVentilator({ peep:8 }); var onVent = (ICU.state().alerts||[]).map(function(a){return a.title;});
    return JSON.stringify({ noVent:noVent, onVent:onVent });
  `);
  ok(c4.noVent.some(t => /hypoxaemia \(P\/F/i.test(t)) && !c4.noVent.some(t => /ARDS/i.test(t)), "P/F 90 without PEEP → hypoxaemia, NOT ARDS (#4)");
  ok(c4.onVent.some(t => /ARDS/i.test(t)), "P/F 90 + PEEP 8 → ARDS called (#4)");

  const c6 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"TS",age:60,sex:"M"});
    ICU.ingestMonitor({ ts:2000, sbp:120, dbp:80 });   // newer, normal
    ICU.ingestMonitor({ ts:1000, sbp:70, dbp:40 });    // older, hypotensive — pushed LAST
    var al = ICU.state().alerts || [];
    return JSON.stringify({ hypo: al.some(function(a){return /hypotension/i.test(a.title);}) });
  `);
  ok(!c6.hypo, "latest vital chosen by max ts, not last-pushed — older hypotensive reading ignored (#6)");

  // C1: a SPARSE follow-up reading must NOT blank still-active critical alerts (forward-filled snapshot)
  const c1s = await J(`
    ICU.reset(); ICU.ingestPatient({name:"SPARSE",age:60,sex:"M"});
    ICU.ingestMonitor({ ts:1000, hr:128, sbp:76, dbp:44, rr:30, spo2:84, temp:38.6, lactate:5.5, gcs:13 });
    ICU.ingestMonitor({ ts:2000, spo2:93 });   // nurse re-charts ONLY the improved SpO2
    var al = ICU.state().alerts || [];
    return JSON.stringify({ titles: al.map(function(a){return a.title;}) });
  `);
  ok(c1s.titles.some(t => /hypotension/i.test(t)), "C1: after a sparse SpO₂-only update, the still-active hypotension alert PERSISTS (not blanked)");
  ok(c1s.titles.some(t => /lactat/i.test(t)) && c1s.titles.some(t => /qSOFA/i.test(t)), "C1: lactate + qSOFA alerts persist through the sparse update");
  ok(!c1s.titles.some(t => /Severe hypoxaemia/i.test(t)), "C1: the improved SpO₂ 93 correctly clears the severe-hypoxaemia alert");

  // C2: lactate from the LAB panel (not the vitals form) must still fire hyperlactataemia + sepsis
  const c2 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"LACT",age:60,sex:"M"});
    ICU.ingestMonitor({ rr:24, sbp:96 });        // 2 qSOFA-ish inputs, NO vitals lactate
    ICU.ingestLabs({ lactate:8 });               // lactate arrives via the lab panel / Ward Sync
    var al = ICU.state().alerts || [];
    return JSON.stringify({ titles: al.map(function(a){return a.title;}) });
  `);
  ok(c2.titles.some(t => /hyperlactat/i.test(t)), "C2: lactate 8 from the lab panel fires hyperlactataemia (was silent unless typed into Vitals)");

  // C2b: lactate from the ABG slip must also fire
  const c2b = await J(`
    ICU.reset(); ICU.ingestPatient({name:"ABGLACT",age:60,sex:"M"});
    var s = ICU.state(); s.abg = { ph:7.28, lactate:9 };
    ICU.ingestMonitor({ hr:96 });                // trigger recompute
    var al = ICU.state().alerts || [];
    return JSON.stringify({ titles: al.map(function(a){return a.title;}) });
  `);
  ok(c2b.titles.some(t => /hyperlactat/i.test(t)), "C2: lactate 9 from the ABG slip fires hyperlactataemia");

  // C2c (R1 blocker): a STALE low bedside lactate must NOT mask a fresher HIGH lab lactate (worst wins)
  const c2c = await J(`
    ICU.reset(); ICU.ingestPatient({name:"STALELACT",age:60,sex:"M"});
    ICU.ingestMonitor({ ts:1000, lactate:1.5 });   // normal bedside lactate on admission
    ICU.ingestLabs({ lactate:6 });                  // later formal lab: deteriorated
    var al = ICU.state().alerts || [];
    return JSON.stringify({ titles: al.map(function(a){return a.title;}) });
  `);
  ok(c2c.titles.some(t => /hyperlactat/i.test(t)), "C2: a stale bedside lactate 1.5 does NOT mask a fresh lab lactate 6 (worst-value wins)");

  // H4: extreme HR / RR now alert
  const h4 = await J(`
    var out = {};
    ICU.reset(); ICU.ingestPatient({name:"BRADY",age:60,sex:"M"}); ICU.ingestMonitor({ hr:30 });
    out.brady = (ICU.state().alerts||[]).some(function(a){return /bradycardia/i.test(a.title);});
    ICU.reset(); ICU.ingestPatient({name:"TACHY",age:60,sex:"M"}); ICU.ingestMonitor({ hr:190 });
    out.tachy = (ICU.state().alerts||[]).some(function(a){return /tachycardia/i.test(a.title);});
    ICU.reset(); ICU.ingestPatient({name:"BRADYP",age:60,sex:"M"}); ICU.ingestMonitor({ rr:6 });
    out.bradyp = (ICU.state().alerts||[]).some(function(a){return /bradypnoea/i.test(a.title);});
    ICU.reset(); ICU.ingestPatient({name:"TACHYP",age:60,sex:"M"}); ICU.ingestMonitor({ rr:44 });
    out.tachyp = (ICU.state().alerts||[]).some(function(a){return /tachypnoea/i.test(a.title);});
    return JSON.stringify(out);
  `);
  ok(h4.brady && h4.tachy, "H4: HR 30 → severe bradycardia, HR 190 → severe tachycardia (were silent)");
  ok(h4.bradyp && h4.tachyp, "H4: RR 6 → bradypnoea, RR 44 → severe tachypnoea (were silent)");

  console.log(fails === 0 ? "\nALL GREEN — ICU alert-engine safety test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
