/* StewardMD - differential ordering v3 (smd_rank_v3) real-browser test.
 * Phase 3 of kb/validation/PLAN-DX-ABX-10.md. Drives the REAL app in headless Chrome:
 *   1. flag OFF: the classic order and scores; assess(f, {absent}) is accepted and changes nothing
 *   2. flag ON: ORDER changes, scores and the antibiotic gate do not
 *      - anchors: "fever" alone no longer leads with HLH; pneumonia needs a lower-respiratory sign
 *      - disqualifiers: non-severe CAP cannot lead a septic-shock pneumonia
 *      - parsimony: a TB picture (weeks, weight loss, night sweats) beats fever + cough -> CAP
 *      - pertinent negatives from the note lower a candidate, only through assess(f, {absent})
 *   3. purity: live workspace findings and negatives are untouched by assess()
 *   4. OPD Ask MaiK ordering (opd-emr.js) follows the engine rank when the flag is on
 * Population-level numbers: test/run-dx-audit.mjs (FLAGS=...,smd_rank_v3=1).
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-rank-v3.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// data -> a JS literal safe to splice into code evaluated in the page (CodeQL js/bad-code-sanitization):
// JSON.stringify leaves <, >, U+2028 and U+2029 raw, so escape them (the pattern CodeQL documents)
const LIT_ESC = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => LIT_ESC[c]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9487);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/rank-v3-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE&&window.OPDEMR);`);
    if (r === true) return true;
  }
  return false;
}
// ordered candidate list (ids), scores and gate for a finding set
const run = async (keys, absent) => JSON.parse(await ev(`var f={}; ${lit(keys)}.forEach(function(k){f[k]=true;});
  var a=${absent ? `SMD_REASON.assess(f,{absent:${lit(absent)}})` : "SMD_REASON.assess(f)"};
  var all=[].concat(a.infectious,a.nonInfectious).sort(function(x,y){return (y.rank-x.rank)||(y.confidence-x.confidence);});
  var sc={}; all.slice().sort(function(x,y){return x.id<y.id?-1:1;}).forEach(function(x){sc[x.id]=x.confidence;});
  return JSON.stringify({order: all.map(function(x){return x.id;}), scores: sc, gate: a.gate.cls, ab: a.gate.ab});`));

const CASES = {
  feverOnly: ["fever"],
  urti: ["fever", "cough", "coryza", "soreThroat", "nasalCongestion"],
  shockPneumonia: ["fever", "cough", "purulentSputum", "crepitations", "consolidation", "hypoxia", "hypotension", "alteredSensorium", "tachycardia"],
  tb: ["fever", "cough", "purulentSputum", "crepitations", "weightLoss", "nightSweats", "eveningFever", "subacuteOnset"],
  headache: ["fever", "headacheSevere", "nauseaVomiting", "photophobia"],
  // round 2 discriminators
  ruqFever: ["fever", "rigors", "rightUpperQuadrantPain", "murphySign", "nauseaVomiting", "abdominalPain"],
  copdNoPus: ["knownCOPD", "increasedDyspnea", "wheeze", "increasedSputumVolume", "dyspnea", "hypoxia"],
  bleedLowPlt: ["petechialRash", "mucocutaneousBleeding", "thrombocytopenia", "bleedingManifestation", "afebrile"],
  gpaCavity: ["hemoptysis", "cavitatingLesion", "hematuria", "renalImpairment", "polyarthralgia", "fever", "weightLoss"],
  focalNow: ["focalNeuroDeficit", "ageOver50", "hypertensionHx", "atrialFibHx"],
  // round 12 discriminators
  viralHep: ["fever", "jaundice", "darkUrine", "nauseaVomiting", "rightUpperQuadrantPain", "myalgiaArthralgia", "contaminatedFoodWaterExposure"],
  viralMen: ["fever", "headacheSevere", "neckStiffness", "photophobia", "myalgiaArthralgia"],
  anasarca: ["proteinuria", "legSwellingBilateral", "ascites", "oliguria"],
  thyroCalm: ["tachycardia", "weightLoss", "palpitations", "diarrhea"],
  // round 14
  crab: ["backPain", "renalImpairment", "weightLoss", "constipationOrDiarrhea", "polyuriaPolydipsia", "nauseaVomiting"],
  hhsDry: ["polyuriaPolydipsia", "alteredSensorium", "dehydration", "diabetesHx", "tachycardia"],
  slowK: ["renalImpairment", "bradycardia", "oliguria", "hypotension"],
  // round 17
  acuteCrackles: ["fever", "cough", "purulentSputum", "bilateralCrackles", "dyspnea", "hypoxia", "tachypnea"],
  // round 31
  // (the tapped findings of dev gc_490 and dev gc_095)
  boringPain: ["severeAbdominalPain", "backPain", "nauseaVomiting", "abdominalDistension", "ascites", "jaundice", "liverDisease", "alcoholExcess", "dehydration", "tachycardia", "tachypnea"],
  htnLung: ["headacheSevere", "visualDisturbance", "papilledema", "dyspnea", "orthopnea", "raisedJVP", "bilateralCrackles", "legSwellingBilateral", "alteredSensorium", "chestPain", "hypertensionHx"],
  // round 47 (the typed reading of train gc_135)
  malariaHlh: ["fever", "headache", "rigors", "toxicAppearing", "hepatosplenomegaly", "nightSweats", "nauseaVomiting", "jaundice", "paroxysmalFever", "travelEndemicArea",
    "splenomegaly", "myalgiaArthralgia", "tachycardia", "thrombocytopenia", "organDysfunction"],
};

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. OFF ------------------------------------------------------------------------------
  ok(await load(BASE + "?rankv3=0&gatev2=0"), "app + KB load with ?rankv3=0 (classic gate: v3 is order only)");
  const off = {};
  for (const [k, keys] of Object.entries(CASES)) off[k] = await run(keys);
  ok(off.feverOnly.order[0] === "HLH", `off · fever alone leads with HLH (the classic behaviour v3 fixes): ${off.feverOnly.order[0]}`);
  const offNeg = await run(CASES.headache, ["neckStiffness"]);
  ok(JSON.stringify(offNeg.order) === JSON.stringify(off.headache.order), "off · assess(f, {absent}) accepted, order unchanged");
  ok(await ev(`return DX._rankV3()`) === false, "off · DX._rankV3() is false");

  // ---- 2. ON -------------------------------------------------------------------------------
  ok(await load(BASE + "?rankv3=1&gatev2=0"), "app + KB load with ?rankv3=1 (classic gate: v3 is order only)");
  const on = {};
  for (const [k, keys] of Object.entries(CASES)) on[k] = await run(keys);
  for (const k of Object.keys(CASES)) {
    ok(JSON.stringify(on[k].scores) === JSON.stringify(off[k].scores), `on  · ${k}: every score unchanged (order only)`);
    ok(on[k].gate === off[k].gate && on[k].ab === off[k].ab, `on  · ${k}: gate unchanged (${on[k].gate})`);
  }
  ok(on.feverOnly.order[0] !== "HLH" && on.feverOnly.order.indexOf("HLH") > 2, `on  · fever alone: HLH no longer leads (now #${on.feverOnly.order.indexOf("HLH") + 1}; lead ${on.feverOnly.order[0]})`);
  ok(on.urti.order.indexOf("CAP") > on.urti.order.indexOf("URTI"), `on  · fever + cough + coryza without a chest sign: URTI above CAP (URTI #${on.urti.order.indexOf("URTI") + 1}, CAP #${on.urti.order.indexOf("CAP") + 1})`);
  ok(on.shockPneumonia.order.indexOf("SEVERE_CAP") < on.shockPneumonia.order.indexOf("CAP"), `on  · pneumonia with shock: severe CAP above non-severe CAP (#${on.shockPneumonia.order.indexOf("SEVERE_CAP") + 1} vs #${on.shockPneumonia.order.indexOf("CAP") + 1})`);
  ok(on.tb.order.indexOf("PULMONARY_TB") < on.tb.order.indexOf("CAP"), `on  · weeks of cough, weight loss, night sweats: TB above CAP (#${on.tb.order.indexOf("PULMONARY_TB") + 1} vs #${on.tb.order.indexOf("CAP") + 1})`);
  const pos = (k, id) => on[k].order.indexOf(id) + 1;
  ok(pos("ruqFever", "CHOLECYSTITIS") < pos("ruqFever", "biliary_colic"), `on  · RUQ pain + Murphy + fever: cholecystitis above biliary colic (#${pos("ruqFever", "CHOLECYSTITIS")} vs #${pos("ruqFever", "biliary_colic")})`);
  ok(pos("copdNoPus", "copd_exac_ni") < pos("copdNoPus", "COPD_EXACERBATION"), `on  · COPD flare without purulent sputum or fever: non-infective first (#${pos("copdNoPus", "copd_exac_ni")} vs #${pos("copdNoPus", "COPD_EXACERBATION")})`);
  ok(on.bleedLowPlt.order[0] === "itp", `on  · bleeding + low platelets alone, afebrile: ITP leads (${on.bleedLowPlt.order.slice(0, 3).join(", ")})`);
  ok(pos("gpaCavity", "vasculitis") < pos("gpaCavity", "LUNG_ABSCESS"), `on  · cavity + haemoptysis + kidney involvement: vasculitis above lung abscess (#${pos("gpaCavity", "vasculitis")} vs #${pos("gpaCavity", "LUNG_ABSCESS")})`);
  ok(pos("focalNow", "ischemic_stroke") < pos("focalNow", "tia"), `on  · a focal deficit still present: stroke above TIA (#${pos("focalNow", "ischemic_stroke")} vs #${pos("focalNow", "tia")})`);
  ok(pos("viralHep", "VIRAL_HEPATITIS") < pos("viralHep", "CHOLANGITIS"), `on  · jaundice after a viral prodrome, no rigors: hepatitis above cholangitis (#${pos("viralHep", "VIRAL_HEPATITIS")} vs #${pos("viralHep", "CHOLANGITIS")})`);
  ok(pos("viralMen", "VIRAL_MENINGITIS") < pos("viralMen", "MENINGITIS"), `on  · meningism with myalgia and a clear sensorium: viral above bacterial (#${pos("viralMen", "VIRAL_MENINGITIS")} vs #${pos("viralMen", "MENINGITIS")})`);
  ok(pos("anasarca", "nephrotic") < pos("anasarca", "ckd"), `on  · proteinuria with ascites, bland urine: nephrotic above CKD (#${pos("anasarca", "nephrotic")} vs #${pos("anasarca", "ckd")})`);
  ok(pos("thyroCalm", "hyperthyroidism") < pos("thyroCalm", "thyroid_storm"), `on  · thyrotoxic without fever or confusion: not a storm (#${pos("thyroCalm", "hyperthyroidism")} vs #${pos("thyroCalm", "thyroid_storm")})`);
  ok(pos("crab", "myeloma") <= 3 && pos("crab", "myeloma") < off.crab.order.indexOf("myeloma") + 1, `on  · bone pain + renal impairment + hypercalcaemic symptoms: myeloma rises into the top three (#${off.crab.order.indexOf("myeloma") + 1} -> #${pos("crab", "myeloma")})`);
  ok(pos("hhsDry", "hhs") < pos("hhsDry", "hypercalcemia"), `on  · a dry, confused diabetic after polyuria, no ketones: HHS above hypercalcaemia (#${pos("hhsDry", "hhs")})`);
  ok(pos("slowK", "hyperkalemia") < pos("slowK", "hypovolemic_shock"), `on  · renal failure with a slow pulse and low BP: hyperkalaemia above volume-loss shock (#${pos("slowK", "hyperkalemia")} vs #${pos("slowK", "hypovolemic_shock")})`);
  ok(pos("acuteCrackles", "ild") > pos("acuteCrackles", "CAP"), `on  · fever + purulent sputum + bilateral crackles: pneumonia above interstitial lung disease (#${pos("acuteCrackles", "CAP")} vs #${pos("acuteCrackles", "ild")})`);
  ok(pos("boringPain", "pancreatitis") < pos("boringPain", "VIRAL_HEPATITIS"), `on  · severe abdominal pain through to the back in a drinker: pancreatitis above hepatitis (#${pos("boringPain", "pancreatitis")} vs #${pos("boringPain", "VIRAL_HEPATITIS")})`);
  ok(pos("malariaHlh", "MALARIA") < pos("malariaHlh", "HLH"), `on  · fever with rigors after travel to an endemic area, big spleen: malaria above HLH (#${pos("malariaHlh", "MALARIA")} vs #${pos("malariaHlh", "HLH")})`);
  ok(pos("htnLung", "htn_emergency") <= 2, `on  · papilloedema with pulmonary oedema: hypertensive emergency in the top two (#${pos("htnLung", "htn_emergency")}; it was 5th)`);
  // default ON since 2026-09-27 (owner decision); localStorage "0" is the opt-out
  ok(await load(BASE + "?gatev2=0"), "app + KB load without ?rankv3");
  ok(await ev(`return DX._rankV3()`) === true, "default · DX._rankV3() is on without any flag");
  await ev(`localStorage.setItem("smd_rank_v3","0"); return 1`);
  ok(await load(BASE + "?gatev2=0"), "reload with localStorage smd_rank_v3=0");
  ok(await ev(`return DX._rankV3()`) === false, "opt-out · localStorage \"0\" turns v3 off");
  const optOut = await run(CASES.feverOnly);
  ok(optOut.order[0] === "HLH", `opt-out · classic order again (fever alone leads with ${optOut.order[0]})`);
  await ev(`localStorage.removeItem("smd_rank_v3"); return 1`);
  ok(await load(BASE + "?rankv3=1&gatev2=0"), "back to ?rankv3=1");
  const neg = await run(CASES.headache, ["neckStiffness"]);
  // a denied strong finding costs its diagnoses rank (12 each, at most 30), never score; absent neck
  // stiffness does not exclude meningitis (the sign is insensitive), so it lowers rather than removes it
  const rk = JSON.parse(await ev(`var f={}; ${lit(CASES.headache)}.forEach(function(k){f[k]=true;});
    function r(a){ return a.infectious.filter(function(x){return x.id==="MENINGITIS";})[0].rank; }
    return JSON.stringify([r(SMD_REASON.assess(f)), r(SMD_REASON.assess(f,{absent:["neckStiffness"]}))]);`));
  ok(Math.round(rk[0] - rk[1]) === 12, `on  · fever + severe headache, "no neck stiffness": meningitis rank ${Math.round(rk[0])} -> ${Math.round(rk[1])} (-12)`);
  ok(JSON.stringify(neg.scores) === JSON.stringify(on.headache.scores), "on  · negatives change order, not scores");

  // ---- 3. purity -----------------------------------------------------------------------------
  const pure = JSON.parse(await ev(`try{DX.openWorkspace();}catch(e){} DX.reset&&DX.reset(); DX.addFindings(["fever","cough"]);
    var before=JSON.stringify({f:DX._state.f,n:DX._state.neg||{}});
    SMD_REASON.assess({fever:true,neckStiffness:true},{absent:["photophobia"]}); SMD_REASON.assess({fever:true});
    var after=JSON.stringify({f:DX._state.f,n:DX._state.neg||{}}); DX.reset&&DX.reset(); return JSON.stringify({same: before===after});`));
  ok(pure.same, "assess() leaves live findings and negatives untouched");
  const ext = JSON.parse(await ev(`return JSON.stringify(DX.extractText("fever with severe headache, no neck stiffness, no rash"))`));
  ok(ext.present.includes("fever") && ext.absent.includes("neckStiffness"), `DX.extractText returns present + absent (${ext.present.join(",")} | no ${ext.absent.join(",")})`);

  // ---- 4. OPD ordering follows the engine rank ------------------------------------------------
  const opd = JSON.parse(await ev(`var k=${lit(CASES.feverOnly)}; var rr=OPDEMR._clinicalRerank(OPDEMR._differentialFor(k),k); return JSON.stringify(rr.slice(0,3).map(function(x){return x.id;}));`));
  ok(opd[0] !== "HLH", `OPD Ask MaiK ordering under v3: fever alone does not lead with HLH (${opd.join(", ")})`);

  console.log(fails === 0 ? "\nALL GREEN: differential ordering v3" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
