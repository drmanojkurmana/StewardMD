/* StewardMD - test-result findings (smd_kb_tests, round 72) real-browser test.
 *   1. flag OFF: the test results are not in the catalog and a tapped one changes nothing.
 *   2. default ON: each result settles its close call (CSF pattern, hydronephrosis, CT bleed, dengue test, malaria
 *      smear, gallbladder ultrasound, troponin, D-dimer, echo vegetation), and without a result nothing changes.
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-kb-tests.mjs
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
const PORT = Number(process.env.CDP_PORT || 9492);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/kb-tests-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE);`);
    if (r === true) return true;
  }
  return false;
}
// candidate (score, matched), gate and rank position for a finding set
const q = async (keys, id) => JSON.parse(await ev(`var f={}; ${lit(keys)}.forEach(function(k){f[k]=true;}); var a=SMD_REASON.assess(f);
  var all=[].concat(a.infectious,a.nonInfectious).sort(function(x,y){return (y.rank-x.rank)||(y.confidence-x.confidence);});
  var c=all.filter(function(x){return x.id===${lit(id)};})[0]||{};
  return JSON.stringify({s:c.confidence||0, m:!!c.matched, pos:all.indexOf(c)+1, gate:a.gate.cls, lead:all[0]&&all[0].id});`));
const catalogHas = async (k) => (await ev(`return DX.findingCatalog().some(function(f){return f.key===${lit(k)};})`)) === true;


const MEN = ["fever", "headache", "headacheSevere", "neckStiffness", "photophobia"];
const FLANK = ["flankPain", "hematuria", "costovertebralTenderness", "nauseaVomiting"];
const BLEED = ["thunderclapHeadache", "headache", "alteredSensorium", "nauseaVomiting", "focalNeuroDeficit", "ageOver50", "hypertensionHx"];
const TROP = ["fever", "rigors", "thrombocytopenia", "travelEndemicArea", "myalgiaArthralgia"];
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. OFF: no test-result findings, and a tapped one changes nothing ----------------------
  ok(await load(BASE + "?kbtests=0"), "app + KB load with ?kbtests=0");
  ok(!(await catalogHas("csfViralPattern")), "off · the test results are not in the catalog");
  const offV = await q(MEN.concat(["csfViralPattern"]), "VIRAL_MENINGITIS"), offB = await q(MEN, "VIRAL_MENINGITIS");
  ok(offV.pos === offB.pos && offV.s === offB.s, `off · a CSF result changes nothing (#${offV.pos}, ${offV.s})`);

  // ---- 2. default ON ---------------------------------------------------------------------------
  ok(await load(BASE), "app + KB load with defaults");
  for (const k of ["csfBacterialPattern", "malariaTestPositive", "hydronephrosisStone", "ctSubarachnoidBlood", "troponinRaised", "dDimerNormal", "echoVegetation"]) ok(await catalogHas(k), `on  · catalog has ${k}`);
  const m0 = await q(MEN, "MENINGITIS");
  ok(m0.lead === "MENINGITIS", `on  · meningism with fever, no CSF yet: bacterial meningitis leads (${m0.lead})`);
  const mv = await q(MEN.concat(["csfViralPattern"]), "VIRAL_MENINGITIS");
  ok(mv.lead === "VIRAL_MENINGITIS" && mv.m, `on  · + lymphocytic CSF with normal glucose: viral meningitis leads (${mv.lead}, ${mv.s})`);
  const mb = await q(MEN.concat(["csfBacterialPattern"]), "MENINGITIS");
  ok(mb.lead === "MENINGITIS" && mb.s >= 95 && mb.gate === "very_likely", `on  · + neutrophilic CSF with low glucose: bacterial meningitis, antibiotics (${mb.s}, ${mb.gate})`);
  const mt = await q(MEN.concat(["csfTbPattern", "subacuteOnset"]), "CNS_TB");
  ok(mt.lead === "CNS_TB", `on  · + TB-pattern CSF, subacute: TB meningitis leads (${mt.lead})`);
  const st = await q(FLANK.concat(["hydronephrosisStone"]), "renal_colic");
  ok(st.lead === "renal_colic" && st.gate === "noninfective", `on  · afebrile flank pain + hydronephrosis: stone, no antibiotics (${st.lead}, ${st.gate})`);
  const ob = await q(FLANK.concat(["hydronephrosisStone", "fever"]), "COMPLICATED_UTI");
  ok(ob.lead === "COMPLICATED_UTI" && (ob.gate === "likely" || ob.gate === "very_likely"), `on  · febrile obstructed kidney: complicated UTI leads, antibiotics (${ob.lead}, ${ob.gate})`);
  const sb = await q(BLEED.concat(["ctSubarachnoidBlood"]), "sah");
  ok(sb.lead === "sah", `on  · thunderclap + CT subarachnoid blood: SAH leads (${sb.lead})`);
  const ib = await q(BLEED.concat(["ctIntracerebralBleed"]), "ich");
  ok(ib.lead === "ich", `on  · + CT intracerebral haemorrhage: ICH leads (${ib.lead})`);
  const dg = await q(TROP.concat(["dengueTestPositive"]), "DENGUE");
  ok(dg.lead === "DENGUE" && dg.gate === "infection_no_abx", `on  · febrile thrombocytopenia + NS1 positive: dengue, no antibiotics (${dg.lead}, ${dg.gate})`);
  const mn = await q(TROP.concat(["malariaTestNegative"]), "MALARIA"), mp = await q(TROP, "MALARIA");
  ok(mn.pos > 1 && mp.pos === 1, `on  · malaria leads (#${mp.pos}) until the smear is negative (#${mn.pos})`);
  const gb = await q(["rightUpperQuadrantPain", "nauseaVomiting", "knownGallstones", "fever", "gallbladderInflamed"], "CHOLECYSTITIS");
  ok(gb.lead === "CHOLECYSTITIS" && gb.m, `on  · RUQ pain, fever, inflamed gallbladder on USG: cholecystitis (${gb.lead})`);
  const ac = await q(["exertionalChestPain", "chestPain", "dyspnea", "orthopnea", "bilateralCrackles", "ecgIschemia", "troponinRaised", "ageOver50"], "acs");
  ok(ac.lead === "acs", `on  · chest pain, ischaemic ECG, troponin raised, pulmonary oedema: ACS leads (${ac.lead})`);
  const pe0 = await q(["pleuriticChestPain", "dyspnea", "tachycardia", "hypoxia"], "pe"), pe1 = await q(["pleuriticChestPain", "dyspnea", "tachycardia", "hypoxia", "dDimerNormal"], "pe");
  ok(pe1.s < pe0.s && pe1.pos > pe0.pos, `on  · a normal D-dimer lowers PE (${pe0.s} #${pe0.pos} -> ${pe1.s} #${pe1.pos})`);
  const ie = await q(["fever", "newMurmur", "echoVegetation"], "IE");
  ok(ie.m && ie.lead === "IE" && (ie.gate === "likely" || ie.gate === "very_likely"), `on  · fever + new murmur + vegetation: endocarditis, antibiotics (${ie.lead}, ${ie.gate})`);
  // without any test result the answers are the same as with the flag off
  const n0 = await q(MEN, "VIRAL_MENINGITIS");
  ok(n0.pos === offB.pos && n0.s === offB.s, `on  · no test result tapped: same as flag off (#${n0.pos}, ${n0.s})`);

  console.log(fails === 0 ? "\nALL GREEN: test-result findings" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
