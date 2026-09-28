/* StewardMD - knowledge-base additions (smd_kb_v2) real-browser test.
 *   1. flag OFF: the classic KB. General "Fever" + jaundice + RUQ pain does NOT match cholangitis
 *      (the rule was written against feverGU, "fever with urinary symptoms"), and the new findings
 *      do not exist.
 *   2. flag ON: fever satisfies the infection rules; the new hepatobiliary findings exist and
 *      separate cholangitis from viral hepatitis; SBP matches on fever or ascitic neutrophils.
 *   3. with smd_nlp_v2, the note's numbers reach the new findings (ALT, ALP, ascitic PMN).
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-kb-v2.mjs
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
const PORT = Number(process.env.CDP_PORT || 9488);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/kb-v2-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
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

const CHARCOT = ["fever", "jaundice", "rightUpperQuadrantPain"];
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. OFF --------------------------------------------------------------------------------
  ok(await load(BASE + "?kbv2=0"), "app + KB load with ?kbv2=0");
  const c0 = await q(CHARCOT, "CHOLANGITIS");
  // the matching defect stands; since round 23 the acute-fever rule (gate v2, v3 order) calls it "likely" anyway
  ok(!c0.m && (c0.gate === "possible" || c0.gate === "likely"), `off · fever + jaundice + RUQ pain: cholangitis NOT matched (${c0.s}), gate "${c0.gate}" (the defect)`);
  const s0 = await q(["fever", "ascites", "liverDisease"], "SBP");
  ok(!s0.m, `off · fever + ascites in cirrhosis: SBP not matched (${s0.s})`);
  ok(!(await catalogHas("dilatedCBD")), "off · the new findings are not in the catalog");

  // ---- 2. ON ---------------------------------------------------------------------------------
  ok(await load(BASE + "?kbv2=1"), "app + KB load with ?kbv2=1");
  for (const k of ["knownGallstones", "dilatedCBD", "transaminasesVeryHigh", "cholestaticLFT", "asciticPMNHigh"]) ok(await catalogHas(k), `on  · catalog has ${k}`);
  const c1 = await q(CHARCOT, "CHOLANGITIS");
  ok(c1.m && (c1.gate === "likely" || c1.gate === "very_likely"), `on  · Charcot's triad with ordinary fever: cholangitis matched (${c1.s}), gate "${c1.gate}"`);
  const c2 = await q(["fever", "jaundice", "dilatedCBD"], "CHOLANGITIS");
  ok(c2.m, `on  · fever + jaundice + dilated CBD, no pain: cholangitis matched (${c2.s})`);
  const vh = await q(["fever", "jaundice", "rightUpperQuadrantPain", "nauseaVomiting", "transaminasesVeryHigh"], "VIRAL_HEPATITIS");
  const vhC = await q(["fever", "jaundice", "rightUpperQuadrantPain", "nauseaVomiting", "transaminasesVeryHigh"], "CHOLANGITIS");
  ok(vh.m && vh.pos < vhC.pos, `on  · jaundice + tender liver + ALT > 1000: viral hepatitis matched and above cholangitis (#${vh.pos} vs #${vhC.pos})`);
  const ch = await q(["fever", "jaundice", "rightUpperQuadrantPain", "knownGallstones", "cholestaticLFT"], "CHOLANGITIS");
  ok(ch.pos === 1, `on  · + gallstones + cholestatic LFTs: cholangitis leads (${ch.lead})`);
  const s1 = await q(["fever", "ascites", "liverDisease"], "SBP");
  ok(s1.m, `on  · fever + ascites in cirrhosis: SBP matched (${s1.s})`);
  const s2 = await q(["ascites", "liverDisease", "asciticPMNHigh"], "SBP");
  ok(s2.m && s2.s > s1.s - 10, `on  · ascitic neutrophils >= 250: SBP matched without fever (${s2.s})`);
  const cy = await q(["fever", "dysuria", "urinaryFrequency"], "CYSTITIS");
  ok(!cy.m, `on  · fever with dysuria is not simple cystitis (cystitis matched: ${cy.m})`);
  // round 52: timing and exposure are no organ system (they sat in the "Respiratory" group and made a subacute fever after
  // prior antibiotics a lung-dominant picture)
  const ef = await q(["fever", "prolongedFever", "abdominalDiscomfort", "headache", "subacuteOnset", "priorAntibiotics", "antibioticsLast90Days"], "ENTERIC_FEVER");
  ok(ef.lead === "ENTERIC_FEVER" && ef.s >= 70 && (ef.gate === "likely" || ef.gate === "very_likely"), `on  · 10 days of fever with abdominal discomfort after two antibiotic courses: enteric fever leads (${ef.s}, ${ef.gate})`);

  // ---- 3. the note's numbers (with smd_nlp_v2) --------------------------------------------------
  ok(await load(BASE + "?kbv2=1&nlpv2=1"), "app + KB load with ?kbv2=1&nlpv2=1");
  const ext = JSON.parse(await ev(`return JSON.stringify(DX.findingsFromText("fever and jaundice, ALT 2200, ALP 180, USG: no gallstones, CBD not dilated. Ascitic fluid PMN 450"))`));
  ok(ext.includes("transaminasesVeryHigh") && ext.includes("asciticPMNHigh"), `on  · note -> transaminases > 1000, ascitic PMN >= 250 (${ext.join(",")})`);
  ok(!ext.includes("cholestaticLFT") && !ext.includes("knownGallstones"), "on  · ALP 180 is not cholestatic; 'no gallstones' is negated");

  console.log(fails === 0 ? "\nALL GREEN: knowledge-base additions" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
