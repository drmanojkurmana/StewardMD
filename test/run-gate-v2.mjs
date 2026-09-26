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
  ["gc_070", "malaria with a close bacterial rival", "very_likely", "very_likely", true, /Malaria leads .*specific, not antibacterial.* is competitive and does/],
  ["gc_390", "chikungunya in a neutropenic host", "very_likely", "very_likely", true, /these change that: .*Neutropenia/],
  ["gc_149", "URTI with pneumonia competitive", "likely", "likely", true, /Community Acquired Pneumonia .* is competitive/],
  ["gc_152", "viral vs bacterial meningitis", "very_likely", "very_likely", true, null],
  ["gc_143", "SBP (fever)", "noninfective", "likely", true, /Can't-miss: spontaneous bacterial peritonitis/],
  ["gc_036", "hepatic encephalopathy with ascites", "noninfective", "rule_out_sbp", true, /diagnostic paracentesis now/],
  ["gc_238", "variceal bleed in cirrhosis", "noninfective", "abx_prophylaxis", true, /Baveno VII/],
  ["gc_019", "ACS (non-infective)", "noninfective", "noninfective", false, null],
];
const V2_CLASSES = ["infection_no_abx", "infection_conditional", "infection_specific", "abx_prophylaxis", "rule_out_sbp"];
const ALL_CLASSES = ["very_likely", "likely", "possible", "unlikely", "noninfective"].concat(V2_CLASSES);

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
const assess = async (f) => JSON.parse(await ev(`return JSON.stringify(SMD_REASON.assess(${JSON.stringify(f)}).gate);`));

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. flag OFF: classic ----------------------------------------------------------------
  ok(await load(BASE + "?gatev2=0"), "app + KB load with ?gatev2=0");
  await ev(`localStorage.removeItem("smd_gate_v2"); return 1`);
  for (const [id, what, classic] of FIX) {
    const g = await assess(keys(id));
    ok(g.cls === classic && g.why === undefined && g.rule === undefined && g.message === undefined, `off · ${what} (${id}): classic "${classic}" (${g.cls}), no v2 fields`);
  }
  const fn = { fever: true, neutropenia: true };
  const fnOff = await assess(fn);
  ok(fnOff.ab === true, `off · fever + "Neutropenia (ANC <500)" -> antibiotics (${fnOff.cls}; the syndrome itself scores on this key)`);

  // ---- 2. flag ON --------------------------------------------------------------------------
  ok(await load(BASE + "?gatev2=1"), "app + KB load with ?gatev2=1");
  for (const [id, what, , v2cls, v2ab, re] of FIX) {
    const g = await assess(keys(id));
    ok(g.cls === v2cls && g.ab === v2ab, `on  · ${what} (${id}): ${v2cls}, antibiotics ${v2ab ? "yes" : "no"} (${g.cls}, ${g.ab})`);
    if (re) ok(re.test(g.message || ""), `on  · ${what}: message says why ("${String(g.message || "").slice(0, 90)}...")`);
    if (g.message) ok(!/\u2014/.test(g.message), `on  · ${what}: v2 message has no em-dash`);
  }
  const fnOn = await assess(fn);
  ok(fnOn.ab === true && fnOn.cls === fnOff.cls, `on  · fever + "Neutropenia (ANC <500)" unchanged by v2 (${fnOn.cls})`);

  // ---- 3. localStorage flag without the query ----------------------------------------------
  await ev(`localStorage.setItem("smd_gate_v2","1"); return 1`);
  ok(await load(BASE), "reload without query, localStorage smd_gate_v2=1");
  ok((await assess(keys("gc_118"))).cls === "infection_no_abx", "localStorage flag alone turns v2 on");
  await ev(`localStorage.removeItem("smd_gate_v2"); return 1`);
  ok(await load(BASE), "reload with the flag cleared");
  ok((await assess(keys("gc_118"))).cls === "very_likely", "cleared flag = classic gate (default OFF)");

  // ---- 4. Dx workspace renders the v2 decision ---------------------------------------------
  ok(await load(BASE + "?gatev2=1"), "reload with ?gatev2=1 for the workspace");
  const ws1 = JSON.parse(await ev(`try{DX.openWorkspace();}catch(e){} DX.reset&&DX.reset(); DX.addFindings(${JSON.stringify(Object.keys(keys("gc_118")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText.trim():'', live: Object.keys(DX._state.f).length});`));
  ok(/antibiotics not indicated/i.test(ws1.gate) && /Dengue Fever leads/.test(ws1.gate), `workspace gate card: dengue -> "${ws1.gate.replace(/\s+/g, " ").slice(0, 80)}..."`);
  ok(ws1.policy === "", "workspace: no empiric-therapy card when antibiotics are not indicated");
  const before = await ev(`return JSON.stringify(DX._state.f)`);
  await assess(keys("gc_143"));
  ok((await ev(`return JSON.stringify(DX._state.f)`)) === before, "assess() is pure: live workspace findings untouched");
  const ws2 = JSON.parse(await ev(`DX.reset&&DX.reset(); DX.addFindings(${JSON.stringify(Object.keys(keys("gc_238")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText.trim():''});`));
  ok(/Antibiotic prophylaxis indicated/.test(ws2.gate) && /Baveno VII/.test(ws2.gate), "workspace: cirrhosis + GI bleed -> prophylaxis card with the regimen");
  ok(ws2.policy === "", "workspace: prophylaxis does not show an empiric-treatment card for an unrelated infection");
  const ws3 = JSON.parse(await ev(`DX.reset&&DX.reset(); DX.addFindings(${JSON.stringify(Object.keys(keys("gc_143")))});
    var g=document.querySelector('#dxGate'), p=document.querySelector('#dxPolicy');
    return JSON.stringify({gate: g?g.innerText:'', policy: p?p.innerText:''});`));
  ok(/spontaneous bacterial peritonitis/i.test(ws3.gate), "workspace: SBP rule shown on the gate card");
  ok(/Spontaneous Bacterial Peritonitis/i.test(ws3.policy), "workspace: stewardship card is for SBP (the rule's lead), not another infection");
  await ev(`DX.reset&&DX.reset(); return 1`);

  // ---- 5. wizard severity mapping ----------------------------------------------------------
  const sev = JSON.parse(await ev(`return JSON.stringify(${JSON.stringify(ALL_CLASSES)}.map(function(c){var s=window.ABX_WIZARD&&ABX_WIZARD._sevOf?ABX_WIZARD._sevOf(c):null;return [c, s&&s.k, s&&s.label];}));`));
  sev.forEach(([c, k, label]) => ok(k && k !== "none" && label, `wizard severity for "${c}": ${k} "${label}"`));
  const noAbx = sev.find((x) => x[0] === "infection_no_abx");
  ok(noAbx && noAbx[1] === "green" && !/antibiotics required|recommended/i.test(noAbx[2]), "wizard: viral lead is green, never 'Immediate antibiotics required'");

  console.log(fails === 0 ? "\nALL GREEN: antibiotic gate v2" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
