/* ICU UNIT-REGISTRY test — proves the canonical unit model (icu.js SMD_UNITS / UNIT_REGISTRY).
 *
 * 1) every registry conversion (µmol/mmol/g·L⁻¹/lakh → canonical mg·dL⁻¹ / g·dL⁻¹ / mmol·L⁻¹ / ×10⁹·L⁻¹),
 * 2) every plausibility guard (missing/ambiguous units: platelets lakhs, creatinine µmol, glucose kept mg/dL),
 * 3) the UNKNOWN-unit path stores unit:"unknown" and does NOT fire a critical alert,
 * 4) fmtLab display in all three systems with clean rounding (no 910.5200000000001 float noise),
 * 5) the REAL PATIENT through the Ward path: creatinine 910 µmol/L → 10.3 mg/dL, glucose 545 → HYPER (not hypo),
 *    platelets 1.41 lakh → 141 ×10⁹/L with NO false thrombocytopenia — the corrected alert list is printed as proof.
 * Deterministic (no AI).  USAGE: BASE=http://localhost:8902/ node test/run-icu-units.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9406, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-units-chrome";
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
const near = (a, b, tol) => a != null && Math.abs(a - b) <= (tol == null ? 0.005 : tol);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.ingestFromWard && window.SMD_UNITS && SMD_UNITS.toCanonical && SMD_UNITS.fmt)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU / SMD_UNITS not loaded");

  // ===== 1) REGISTRY CONVERSIONS (SMD_UNITS.toCanonical → canonical value) =====
  const c = await J(`var U = SMD_UNITS.toCanonical; return JSON.stringify({
    creatUmol:  U("creat", 910.52, "µmol/L").value,   creatUmol2: U("creat", 176.8, "umol/L").value,
    creatMg:    U("creat", 10.3, "mg/dL").value,
    gluMmol:    U("glu", 30, "mmol/L").value,          gluMmol2:  U("glu", 10, "mmol/L").value,
    biliUmol:   U("bili", 171, "µmol/L").value,
    caMmol:     U("ca", 2.5, "mmol/L").value,          caMmol2:   U("ca", 1.7, "mmol/L").value,
    ureaMmol:   U("urea", 10, "mmol/L").value,
    albGl:      U("alb", 35, "g/L").value,             albGl2:    U("alb", 15, "g/L").value,
    hbGl:       U("hb", 120, "g/L").value,
    na:         U("na", 140, "mmol/L").value,          k: U("k", 5, "mEq/L").value,   cl: U("cl", 100, "").value,
    lactate:    U("lactate", 4, "mmol/L").value
  });`);
  ok(near(c.creatUmol, 10.3) && near(c.creatUmol2, 2.0, 0.01), `creatinine µmol/L ÷88.4 → mg/dL (910.52→${c.creatUmol}; 176.8→${c.creatUmol2})`);
  ok(c.creatMg === 10.3, `creatinine mg/dL trusted as-is (10.3→${c.creatMg})`);
  ok(c.gluMmol === 540 && c.gluMmol2 === 180, `glucose mmol/L ×18 → mg/dL (30→${c.gluMmol}; 10→${c.gluMmol2})`);
  ok(near(c.biliUmol, 10, 0.05), `bilirubin µmol/L ÷17.1 → mg/dL (171→${c.biliUmol})`);
  ok(near(c.caMmol, 10.02, 0.05) && near(c.caMmol2, 6.81, 0.05), `calcium mmol/L ÷0.2495 → mg/dL (2.5→${c.caMmol}; 1.7→${c.caMmol2})`);
  ok(c.ureaMmol === 60, `urea mmol/L ×6.006 → mg/dL (10→${c.ureaMmol})`);
  ok(near(c.albGl, 3.5) && near(c.albGl2, 1.5), `albumin g/L ÷10 → g/dL (35→${c.albGl}; 15→${c.albGl2})`);
  ok(near(c.hbGl, 12), `haemoglobin g/L ÷10 → g/dL (120→${c.hbGl})`);
  ok(c.na === 140 && c.k === 5 && c.cl === 100 && c.lactate === 4, `Na/K/Cl/lactate mEq/L == mmol/L 1:1 (${c.na}/${c.k}/${c.cl}/${c.lactate})`);

  // ===== 2) PLAUSIBILITY GUARDS (unit missing / ambiguous) =====
  const g = await J(`var U = SMD_UNITS.toCanonical; return JSON.stringify({
    pltLakhU:  U("plt", 1.41, "lakhs/cumm"),  pltNoU: U("plt", 1.41, ""),  pltAbs: U("plt", 141000, "/cumm"),
    plt9:      U("plt", 141, "10^9/L"),        pltK: U("plt", 250, "10^3/µL"),  pltPlaus: U("plt", 450, ""),
    creatHi:   U("creat", 910, ""),            creatLo: U("creat", 2.0, ""),
    gluNoU:    U("glu", 545, ""),
    wbcAbs:    U("wbc", 11200, "/µL"),         wbcNoU: U("wbc", 11.2, ""),  wbcBig: U("wbc", 15000, "")
  });`);
  ok(g.pltLakhU.value === 141 && g.pltNoU.value === 141 && g.pltNoU.guessed === true, `platelets → ×10⁹/L: 1.41 lakh→141, bare 1.41 (guessed lakh)→141`);
  ok(g.pltAbs.value === 141 && g.plt9.value === 141 && g.pltK.value === 250, `platelets: 141000/cumm→141, 141 ×10⁹/L→141, 250 ×10³/µL→250 (1:1)`);
  ok(g.pltPlaus.value === 450 && g.pltPlaus.guessed !== true, `platelets bare 450 (already plausible ×10⁹/L) kept — no false lakh multiply`);
  ok(near(g.creatHi.value, 10.29, 0.02) && g.creatHi.guessed === true && g.creatLo.value === 2.0, `creatinine bare >40 → µmol/L guard (910→${g.creatHi.value}); bare 2.0 kept mg/dL`);
  ok(g.gluNoU.value === 545, `glucose bare 545 kept mg/dL — never turned into 30 (Indian default)`);
  ok(near(g.wbcAbs.value, 11.2) && near(g.wbcNoU.value, 11.2) && near(g.wbcBig.value, 15), `WBC /µL ÷1000 → ×10⁹/L (11200→11.2; bare 11.2 kept; bare 15000→15)`);

  // ===== 3) UNKNOWN unit → known:false; stored but NO critical alert fires off it =====
  const un = await J(`var r = SMD_UNITS.toCanonical("creat", 500, "??weird"); return JSON.stringify({ known: r.known });`);
  ok(un.known === false, `unrecognised creatinine unit → known:false (not trusted)`);
  const uk = await J(`
    ICU.reset(); ICU.ingestPatient({ name:"UNK", age:60, sex:"M" });
    ICU.ingestFromWard({ patientId:"UK1", source:"Ward Sync", labs:[ { test:"Creatinine", result:"500", units:"??weird" } ] });
    var s = ICU.state(); var al = s.alerts || [];
    return JSON.stringify({ unitKnown: (s.src.creat||{}).unitKnown, renal: al.some(function(a){return /renal impairment/i.test(a.title);}), stored: s.labs.recent.creat });
  `);
  ok(uk.unitKnown === false, `ingest tags an untrusted unit: src.creat.unitKnown === false (→ "unit?" chip)`);
  ok(uk.renal === false, `an untrusted creatinine (500 ??) does NOT fire a critical renal alert (${uk.stored} stored, unit unknown)`);

  // ===== 4) fmtLab DISPLAY in each system + clean rounding (no float noise) =====
  const f = await J(`var F = SMD_UNITS.fmt; return JSON.stringify({
    inCreat: F("creat", 10.3, "indian"), inGlu: F("glu", 545, "indian"), inPlt: F("plt", 141, "indian"), inNa: F("na", 140, "indian"),
    coPlt:   F("plt", 141, "conventional"), coCreat: F("creat", 10.3, "conventional"),
    siCreat: F("creat", 10.3, "si"), siGlu: F("glu", 545, "si"), siNa: F("na", 140, "si"), siHb: F("hb", 12, "si"),
    noise:   [F("creat",10.294,"si").text, F("bili",53.3333,"si").text, F("ca",2.4999,"si").text, F("glu",545,"si").text, F("plt",141,"indian").text]
  });`);
  ok(f.inCreat.text === "10.3" && f.inCreat.unit === "mg/dL", `indian creatinine → ${f.inCreat.text} ${f.inCreat.unit}`);
  ok(f.inGlu.text === "545" && f.inGlu.unit === "mg/dL", `indian glucose → ${f.inGlu.text} ${f.inGlu.unit}`);
  ok(f.inPlt.text === "1.41" && /lakh/.test(f.inPlt.unit), `indian platelets → ${f.inPlt.text} ${f.inPlt.unit} (lakhs/cumm)`);
  ok(f.inNa.unit === "mEq/L" && f.inNa.text === "140", `indian sodium → ${f.inNa.text} ${f.inNa.unit}`);
  ok(f.coPlt.text === "141" && /10⁹/.test(f.coPlt.unit), `conventional platelets → ${f.coPlt.text} ${f.coPlt.unit}`);
  ok(f.siGlu.unit === "mmol/L" && near(+f.siGlu.text, 30.3, 0.2) && f.siNa.unit === "mmol/L" && f.siHb.unit === "g/L", `SI: glucose ${f.siGlu.text} ${f.siGlu.unit}, Na ${f.siNa.text} ${f.siNa.unit}, Hb ${f.siHb.text} ${f.siHb.unit}`);
  ok(f.noise.every(x => !/\.\d{4,}/.test(String(x))), `no raw-float noise in any display value: [${f.noise.join(", ")}]`);

  // ===== 5) REAL PATIENT via the Ward path — the headline verification =====
  const rp = await J(`
    ICU.reset(); ICU.setUnitSystem("indian"); ICU.ingestPatient({ name:"REAL", age:60, sex:"M" });
    ICU.ingestFromWard({ patientId:"RP1", source:"Ward Sync", labs:[
      { test:"Creatinine",     result:"910.52", units:"µmol/L" },
      { test:"Glucose",        result:"545",    units:"mg/dL" },
      { test:"Platelet Count", result:"1.41",   units:"lakhs/cumm" },
      { test:"Potassium",      result:"6.8",    units:"mmol/L" },
      { test:"Sodium",         result:"118",    units:"mmol/L" },
      { test:"Hemoglobin",     result:"5.4",    units:"g/dL" }
    ]});
    var s = ICU.state(), L = s.labs.recent, al = s.alerts || [];
    var msg = function(re){ var a = al.filter(function(x){return re.test(x.title);})[0]; return a ? a.msg : ""; };
    return JSON.stringify({
      creat: L.creat, glu: L.glu, plt: L.plt, k: L.k, na: L.na, hb: L.hb,
      titles: al.map(function(a){return a.title;}),
      creatMsg: msg(/renal impairment/i), gluMsg: msg(/hyperglyc/i),
      pltIndian: SMD_UNITS.fmt("plt", L.plt, "indian"),
      full: al.map(function(a){return a.severity.toUpperCase()+" · "+a.title+" — "+a.msg;})
    });
  `);
  ok(rp.creat === 10.3, `creatinine 910.52 µmol/L → 10.3 mg/dL (NOT 910): recent.creat = ${rp.creat}`);
  ok(rp.glu === 545, `glucose 545 mg/dL kept as-is: recent.glu = ${rp.glu}`);
  ok(rp.plt === 141, `platelets 1.41 lakh → 141 ×10⁹/L: recent.plt = ${rp.plt}`);
  ok(rp.titles.some(x => /renal impairment/i.test(x)) && /10\.3 mg\/dL/.test(rp.creatMsg) && !/910/.test(rp.creatMsg), `renal alert reads "10.3 mg/dL", not 910 → "${rp.creatMsg}"`);
  ok(rp.titles.some(x => /hyperglyc/i.test(x)) && !rp.titles.some(x => /hypoglyc/i.test(x)), `glucose 545 → HYPERglycaemia (NOT hypo) → "${rp.gluMsg}"`);
  ok(!rp.titles.some(x => /thrombocyto/i.test(x)), `platelets 141 ×10⁹/L (1.41 lakh) → NO false thrombocytopenia`);
  ok(rp.pltIndian.text === "1.41" && /lakh/.test(rp.pltIndian.unit), `platelets displayed Indian: ${rp.pltIndian.text} ${rp.pltIndian.unit}`);

  // switching the DISPLAY preference re-expresses the same alert in SI — WITHOUT changing what fired
  const si = await J(`
    ICU.setUnitSystem("si");
    var al = ICU.state().alerts || [];
    var cm = (al.filter(function(a){return /renal impairment/i.test(a.title);})[0]||{}).msg || "";
    return JSON.stringify({ sys: ICU.unitSystem(), creatMsg: cm, stillFires: al.some(function(a){return /renal impairment/i.test(a.title);}) });
  `);
  ok(si.sys === "si" && si.stillFires && /µmol\/L|umol\/L|91\d/.test(si.creatMsg), `SI preference: same alert still fires, now shown in µmol/L → "${si.creatMsg}"`);
  await ev(`ICU.setUnitSystem("indian");`);

  console.log("\n— corrected alert list (real patient, Indian units) —");
  rp.full.forEach(l => console.log("   " + l));

  console.log(fails === 0 ? "\nALL GREEN — ICU unit-registry test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
