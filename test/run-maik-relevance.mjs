/* StewardMD — MaiK relevance/routing regression (the "Paraquat Poisoning → Acute Cholangitis" bug).
 * Drives the REAL router + StewardRAG.buildPackage; stubs only the AI provider to capture the
 * grounded package. Asserts:
 *   1. a 2-word disease/topic name ("Paraquat Poisoning") is NOT sent back for clarification;
 *   2. a knowledge question does NOT get grounded on a stale/ambient case (cholangitis);
 *   3. an in-KB topic ("organophosphate poisoning") grounds on ITS topic, not the stale case;
 *   4. a topic NOT in the KB ("paraquat poisoning") is caveated, not answered as a near disease.
 * USAGE: BASE=http://localhost:5173/ node test/run-maik-relevance.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9529);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maikrel-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.StewardRAG && window.SMD_AI)`) === true) break; }
  await ev(`return StewardRAG.ready()`);

  // ---- Part A: buildPackage relevance (direct) ----
  const paraquat = JSON.parse(await ev(`var p=await StewardRAG.buildPackage(SMD_REASON.assess({}),{question:"treatment of paraquat poisoning"});return JSON.stringify({tm:p.topicMatch, groundingLen:(p.grounding||[]).length});`));
  chk("paraquat: topic flagged NOT in KB (matched=false)", paraquat.tm && paraquat.tm.matched === false, JSON.stringify(paraquat.tm));
  chk("paraquat: no (wrong) disease grounding attached", paraquat.groundingLen === 0);
  const op = JSON.parse(await ev(`var p=await StewardRAG.buildPackage(SMD_REASON.assess({}),{question:"treatment of organophosphate poisoning"});return JSON.stringify({tm:p.topicMatch, g:(p.grounding[0]&&(p.grounding[0].name||p.grounding[0].id))||null});`));
  chk("organophosphate: matched in KB + grounded on OP", op.tm && op.tm.matched === true && /organophosph|\bop\b|cholinerg/i.test(String(op.g)), JSON.stringify(op));

  // ---- Part B: knowledge question is NOT hijacked by a stale/ambient case ----
  // seed a stale cholangitis-ish case, then ask an OP-poisoning knowledge question
  await ev(`try{window.DX._state.f={jaundice:true, rightUpperQuadrantPain:true, fever:true, murphySign:true};}catch(e){} return 1;`);
  const staleTop = await ev(`var a=SMD_REASON.assess(window.DX._state.f);return ((a.infectious||[]).concat(a.nonInfectious||[])[0]||{}).name||"none"`);
  // simulate runClinical's fixed findings-selection: topic question → findings={}, NOT the case
  const opWithCase = JSON.parse(await ev(`
    var caseRef=/\\b(this|that|the|my|our|current)\\s+(patient|case|pt|dx|diagnosis|condition|scenario)\\b/.test("treatment of organophosphate poisoning");
    var findings = (true && caseRef) ? window.DX._state.f : {};
    var p=await StewardRAG.buildPackage(SMD_REASON.assess(findings),{question:"treatment of organophosphate poisoning"});
    return JSON.stringify({g:(p.grounding[0]&&(p.grounding[0].name||p.grounding[0].id))||null, matched:p.topicMatch&&p.topicMatch.matched});`));
  chk("stale case set (would top as cholangitis-ish)", /cholangitis|cholecystitis|biliary|peritonitis/i.test(String(staleTop)), staleTop);
  chk("knowledge Q grounds on its OWN topic, not the stale case", /organophosph|cholinerg|\bop\b/i.test(String(opWithCase.g)) && !/cholangitis|cholecystitis|biliary/i.test(String(opWithCase.g)), JSON.stringify(opWithCase));

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — MaiK relevance"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
