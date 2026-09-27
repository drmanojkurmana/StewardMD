/* StewardMD - antibiotic gate v2 (smd_gate_v2) real-browser test.
 * Phase 1 of kb/validation/PLAN-DX-ABX-10.md. Drives the REAL app in headless Chrome:
 *   1. flag OFF (?gatev2=0): every fixture returns the classic gate class and no v2 fields
 *      (the population-level proof is test/run-dx-audit.mjs: 0 per-case diffs with the flag off)
 *   2. flag ON (?gatev2=1): viral -> no antibiotics; conditional syndromes -> criteria; malaria ->
 *      kept with a named rival; modifiers (neutropenia / immunosuppression) and competing bacterial
 *      infections KEEP antibiotics with the reason stated; SBP and cirrhosis-GI-bleed rules
 *   3. the localStorage flag works without the query override
 *   4. the Dx workspace gate card and stewardship card render the v2 decision
 *   5. the antibiotic wizard maps every gate class to a severity (no blank badge)
 *   6. assess() stays pure (live findings untouched)
 * Fixtures are gold validation cases (kb/validation/cases/*.json), so the keys are the engine's own.
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-gate-v2.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// data -> a JS literal safe to splice into code evaluated in the page (CodeQL js/bad-code-sanitization):
// JSON.stringify leaves <, >, U+2028 and U+2029 raw, so escape them (the pattern CodeQL documents)
const LIT_ESC = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => LIT_ESC[c]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9486);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";
const keys = (id) => JSON.parse(readFileSync(join(ROOT, "kb", "validation", "cases", id + ".json"), "utf8")).findings;

// fixture -> [classic class, v2 class, v2 ab, v2 message must match]
const FIX = [
  ["gc_118", "dengue", "very_likely", "infection_no_abx", false, /Dengue Fever leads, and it does not need antibiotics/],
  ["gc_242", "acute bronchitis", "very_likely", "infection_no_abx", false, /does not need antibiotics/],
  ["gc_137", "pharyngitis", "very_likely", "infection_conditional", true, /Antibiotics only if its criteria are met: .*Centor/],
  ["gc_070", "uncomplicated malaria (no bacterial rival meets its criteria)", "very_likely", "infection_specific", false, /Malaria leads\. .*ANTIMALARIAL/],
  ["gc_110", "chikungunya with rickettsial fever matched close behind", "very_likely", "very_likely", true, /leads and does not need antibiotics on its own, but Rickettsial Fever .* is competitive and does/],
  ["gc_390", "chikungunya in a neutropenic host", "very_likely", "very_likely", true, /these change that: .*Neutropenia/],
  ["gc_149", "URTI with pneumonia competitive", "likely", "likely", true, /Community Acquired Pneumonia .* is competitive/],
  ["gc_152", "viral vs bacterial meningitis", "very_likely", "very_likely", true, null],
  ["gc_143", "SBP (fever)", "noninfective", "likely", true, /Can't-miss: spontaneous bacterial peritonitis/],
  // 2026-09-27: "rule out SBP" is tap first, antibiotics on the result (EASL 2018 / AASLD 2021)
  ["gc_036", "hepatic encephalopathy with ascites", "noninfective", "rule_out_sbp", false, /diagnostic paracentesis now/],
  ["gc_238", "variceal bleed in cirrhosis", "noninfective", "abx_prophylaxis", true, /Baveno VII/],
  ["gc_019", "ACS (non-infective)", "noninfective", "noninfective", false, null],
];
const V2_CLASSES = ["infection_no_abx", "infection_conditional", "infection_specific", "abx_prophylaxis", "rule_out_sbp"];
const ALL_CLASSES = ["very_likely", "likely", "possible", "unlikely", "noninfective"].concat(V2_CLASSES);
// smd_calib's class is deliberately neutral (k "none") but must carry a label

// start the static server if nothing answers at BASE (same pattern as run-reason-api.mjs)
let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) {
    serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
  }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/gate-v2-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.ASP_DATA&&window.KB_CORE);`);
    if (r === true) return true;
  }
  return false;
}
const assess = async (f) => JSON.parse(await ev(`return JSON.stringify(SMD_REASON.assess(${lit(f)}).gate);`));

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. flag OFF: classic ----------------------------------------------------------------
  ok(await load(BASE + "?gatev2=0&kbv2=0"), "app + KB load with ?gatev2=0&kbv2=0 (fixtures predate smd_kb_v2 ON)");
  await ev(`localStorage.removeItem("smd_gate_v2"); return 1`);
  for (const [id, what, classic] of FIX) {
    const g = await assess(keys(id));
    ok(g.cls === classic && g.why === undefined && g.rule === undefined && g.message === undefined, `off · ${what} (${id}): classic "${classic}" (${g.cls}), no v2 fields`);
  }
  const fn = { fever: true, neutropenia: true };
  const fnOff = await assess(fn);
  const spOff = await assess({ fever: true, hypotension: true });
  ok(spOff.ab === false, `off · fever + hypotension alone: classic gate withholds antibiotics ("${spOff.cls}"), the gap v2 closes`);
  ok(fnOff.ab === true, `off · fever + "Neutropenia (ANC <500)" -> antibiotics (${fnOff.cls}; the syndrome itself scores on this key)`);

  // ---- 2. flag ON --------------------------------------------------------------------------
  // the fixtures were written against the classic order (?rankv3=0); v3's own effect on the gate is
  // asserted after them, and in test/run-rank-v3.mjs
  ok(await load(BASE + "?gatev2=1&rankv3=0&kbv2=0"), "app + KB load with ?gatev2=1&rankv3=0&kbv2=0");
  for (const [id, what, , v2cls, v2ab, re] of FIX) {
    const g = await assess(keys(id));
    ok(g.cls === v2cls && g.ab === v2ab, `on  · ${what} (${id}): ${v2cls}, antibiotics ${v2ab ? "yes" : "no"} (${g.cls}, ${g.ab})`);
    if (re) ok(re.test(g.message || ""), `on  · ${what}: message says why ("${String(g.message || "").slice(0, 90)}...")`);
    if (g.message) ok(!/\u2014/.test(g.message), `on  · ${what}: v2 message has no em-dash`);
  }
  const sp = await assess({ fever: true, hypotension: true });
  ok(sp.cls === "likely" && sp.ab === true && /sepsis until proven otherwise/.test(sp.message || ""), `on  · fever + hypotension alone: sepsis until proven otherwise (${sp.cls})`);
  const ac = await assess({ fever: true, hypotension: true, steroidUse: true });
  ok(ac.rule !== "sepsis_phys", `on  · fever + hypotension on long-term steroids: the rule does not override a leading adrenal crisis (${ac.cls})`);
  // 2026-09-27 overcall round: an afebrile non-infective lead is not "infection likely"
  const T = (ks) => Object.fromEntries(ks.map((k) => [k, true]));
  const colic = await assess(T(["flankPain", "severeAbdominalPain", "hematuria", "nauseaVomiting", "costovertebralTenderness", "tachycardia"]));
  ok(colic.ab === false && colic.rule === "ni_lead_afebrile" && /No fever/.test(colic.message || "") && !/\u2014/.test(colic.message || ""), `on  · afebrile renal colic picture: not an infection call (${colic.cls}, ${colic.rule})`);
  const colicF = await assess(T(["flankPain", "severeAbdominalPain", "hematuria", "nauseaVomiting", "costovertebralTenderness", "tachycardia", "fever", "rigors"]));
  ok(colicF.ab === true && colicF.rule !== "ni_lead_afebrile", `on  · the same with fever and rigors: infection kept (${colicF.cls})`);
  const colicS = await assess(T(["flankPain", "severeAbdominalPain", "hematuria", "costovertebralTenderness", "hypotension", "lactateElevated"]));
  ok(colicS.rule !== "ni_lead_afebrile", `on  · the same with shock physiology: the rule stands aside (${colicS.cls})`);
  // SBP: encephalopathy or pain alone = tap first; fever = treat; a GI bleed = prophylaxis regardless
  const he = await assess(T(["liverDisease", "ascites", "alteredSensorium", "asterixis", "jaundice"]));
  ok(he.cls === "rule_out_sbp" && he.ab === false && /paracentesis/.test(he.message || ""), `on  · cirrhosis + ascites + encephalopathy: tap first, antibiotics on the result (${he.cls}, ab ${he.ab})`);
  const heF = await assess(T(["liverDisease", "ascites", "alteredSensorium", "asterixis", "jaundice", "fever"]));
  ok(heF.ab === true, `on  · the same with fever: treat as SBP (${heF.cls})`);
  const heP = await assess(T(["liverDisease", "ascites", "abdominalPain", "jaundice"]));
  ok(heP.ab === true && heP.cls !== "rule_out_sbp", `on  · cirrhosis + ascites + abdominal pain, no fever: suspected SBP, tap and treat (${heP.cls})`);
  const heB = await assess(T(["liverDisease", "ascites", "alteredSensorium", "hematemesis", "melena"]));
  ok(heB.ab === true && heB.cls !== "rule_out_sbp", `on  · cirrhosis + ascites + GI bleed: antibiotics kept, never downgraded to 'tap first' (${heB.cls})`);
  // extraction round 2: afebrile septic shock in a host who may not mount a fever (Sepsis-3)
  const shockOld = await assess(T(["hypotension", "alteredSensorium", "lactateElevated", "ageOver50", "tachycardia"]));
  ok(shockOld.ab === true && shockOld.rule === "sepsis_afebrile" && /possible septic shock/i.test(shockOld.message || "") && !/—/.test(shockOld.message || ""),
    `on  · afebrile, over 50, low BP + lactate + confusion: possible septic shock, antibiotics (${shockOld.cls}, ${shockOld.rule})`);
  const shockYoung = await assess(T(["hypotension", "alteredSensorium", "lactateElevated", "tachycardia"]));
  ok(shockYoung.rule !== "sepsis_afebrile", `on  · the same without an at-risk host: the rule stands aside (${shockYoung.cls})`);
  const shockGib = await assess(T(["hypotension", "alteredSensorium", "lactateElevated", "ageOver50", "tachycardia", "hematemesis", "melena"]));
  ok(shockGib.rule !== "sepsis_afebrile", `on  · the same with a GI bleed: haemorrhagic shock is not read as sepsis (${shockGib.cls})`);
  const noShock = await assess(T(["alteredSensorium", "tachypnea", "lactateElevated", "ageOver50"]));
  ok(noShock.rule !== "sepsis_afebrile", `on  · confusion + fast breathing + lactate without low BP: no override (${noShock.cls})`);
  const fnOn = await assess(fn);
  // smd_rank_v3 (default ON): CAP without a lower-respiratory sign cannot hold antibiotics as a rival,
  // so an URTI picture (gc_149, gold: URTI, no antibiotics) reads "only if pharyngitis criteria are met"
  ok(await load(BASE + "?gatev2=1"), "app + KB load with ?gatev2=1 (v3 order, the default)");
  const urtiV3 = await assess(keys("gc_149"));
  ok(urtiV3.cls === "infection_conditional" && urtiV3.rule !== "keep_rival", `on + v3 · URTI with pneumonia only keyword-close (gc_149): conditional, not "likely" (${urtiV3.cls})`);
  // default ON since 2026-09-27 (smd_kb_v2): SBP with fever matches the knowledge base itself
  const sbpDefault = await assess(keys("gc_143"));
  ok(sbpDefault.ab === true, `defaults · SBP (fever) gc_143: antibiotics yes (${sbpDefault.cls})`);
  // round 9: under the v3 order (and the v2 extractor) a non-infective lead is enough; the raw-score check
  // stays for the classic order. Gastroenteritis scores 81 on diarrhoea alone behind a bowel obstruction (train gc_192).
  const obstruction = ["diarrhea", "abdominalPain", "abdominalDistension", "abdominalDiscomfort"];
  // with the note's explicit negatives, as the typed-note path passes them ("no fever, weight loss or blood in stool")
  const obstNeg = ["fever", "weightLoss", "bloodyStool", "malignancy", "lymphadenopathy", "jointSwelling"];
  const assessNeg = async (f, ab) => JSON.parse(await ev(`return JSON.stringify(SMD_REASON.assess(${lit(f)}, { absent: ${lit(ab)} }).gate);`));
  const obst = await assessNeg(T(obstruction), obstNeg);
  ok(obst.ab === false && obst.rule === "ni_lead_afebrile", `defaults · afebrile bowel obstruction leading the order: no antibiotics (${obst.cls}, ${obst.rule})`);
  ok((await assess(T(obstruction.concat(["fever", "rigors"])))).rule !== "ni_lead_afebrile", "defaults · the same with fever: the rule stands aside");
  await load(BASE + "?gatev2=1&nlpv2=0");
  ok((await assessNeg(T(obstruction), obstNeg)).rule !== "ni_lead_afebrile", "classic extractor · raw-score check kept (it reads only a note's first mention of fever)");
  await load(BASE + "?gatev2=1&rankv3=0&kbv2=0");
  ok(fnOn.ab === true && fnOn.cls === fnOff.cls, `on  · fever + "Neutropenia (ANC <500)" unchanged by v2 (${fnOn.cls})`);

  // ---- 3. localStorage flag without the query ----------------------------------------------
  await ev(`localStorage.setItem("smd_gate_v2","1"); return 1`);
  ok(await load(BASE), "reload without query, localStorage smd_gate_v2=1");
  ok((await assess(keys("gc_118"))).cls === "infection_no_abx", "localStorage flag alone turns v2 on");
  await ev(`localStorage.removeItem("smd_gate_v2"); return 1`);
  ok(await load(BASE), "reload with the flag cleared");
  ok((await assess(keys("gc_118"))).cls === "infection_no_abx", "cleared flag = gate v2 (default ON since 2026-09-27, owner decision)");
  await ev(`localStorage.setItem("smd_gate_v2","0"); return 1`);
  ok(await load(BASE), "reload with localStorage smd_gate_v2=0");
  ok((await assess(keys("gc_118"))).cls === "very_likely", "smd_gate_v2=0 = classic gate (the opt-out)");
  await ev(`localStorage.removeItem("smd_gate_v2"); return 1`);

  // ---- 4. Dx workspace renders the v2 decision ---------------------------------------------
  ok(await load(BASE + "?gatev2=1&kbv2=0"), "reload with ?gatev2=1&kbv2=0 for the workspace");
  const ws1 = JSON.parse(await ev(`try{DX.openWorkspace();}catch(e){} DX.reset&&DX.reset(); DX.addFindings(${lit(Object.keys(keys("gc_118")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText.trim():'', live: Object.keys(DX._state.f).length});`));
  ok(/antibiotics not indicated/i.test(ws1.gate) && /Dengue Fever leads/.test(ws1.gate), `workspace gate card: dengue -> "${ws1.gate.replace(/\s+/g, " ").slice(0, 80)}..."`);
  ok(ws1.policy === "", "workspace: no empiric-therapy card when antibiotics are not indicated");
  const before = await ev(`return JSON.stringify(DX._state.f)`);
  await assess(keys("gc_143"));
  ok((await ev(`return JSON.stringify(DX._state.f)`)) === before, "assess() is pure: live workspace findings untouched");
  const ws2 = JSON.parse(await ev(`DX.reset&&DX.reset(); DX.addFindings(${lit(Object.keys(keys("gc_238")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText.trim():''});`));
  ok(/Antibiotic prophylaxis indicated/.test(ws2.gate) && /Baveno VII/.test(ws2.gate), "workspace: cirrhosis + GI bleed -> prophylaxis card with the regimen");
  ok(ws2.policy === "", "workspace: prophylaxis does not show an empiric-treatment card for an unrelated infection");
  const ws3 = JSON.parse(await ev(`DX.reset&&DX.reset(); DX.addFindings(${lit(Object.keys(keys("gc_143")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText:''});`));
  ok(/spontaneous bacterial peritonitis/i.test(ws3.gate), "workspace: SBP rule shown on the gate card");
  ok(/Spontaneous Bacterial Peritonitis/i.test(ws3.policy), "workspace: stewardship card is for SBP (the rule's lead), not another infection");
  await ev(`DX.reset&&DX.reset(); return 1`);

  // ---- 5. wizard severity mapping ----------------------------------------------------------
  const sev = JSON.parse(await ev(`return JSON.stringify(${lit(ALL_CLASSES)}.map(function(c){var s=window.ABX_WIZARD&&ABX_WIZARD._sevOf?ABX_WIZARD._sevOf(c):null;return [c, s&&s.k, s&&s.label];}));`));
  sev.forEach(([c, k, label]) => ok(k && k !== "none" && label, `wizard severity for "${c}": ${k} "${label}"`));
  const ins = JSON.parse(await ev(`return JSON.stringify(ABX_WIZARD._sevOf("insufficient"))`));
  ok(ins && ins.label, `wizard severity for "insufficient": ${ins && ins.k} "${ins && ins.label}"`);
  const noAbx = sev.find((x) => x[0] === "infection_no_abx");
  ok(noAbx && noAbx[1] === "green" && !/antibiotics required|recommended/i.test(noAbx[2]), "wizard: viral lead is green, never 'Immediate antibiotics required'");

  console.log(fails === 0 ? "\nALL GREEN: antibiotic gate v2" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
