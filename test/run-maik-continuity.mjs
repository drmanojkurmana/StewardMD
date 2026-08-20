/* StewardMD — MaiK conversation-continuity + query-rewriting regression (smd_maik_v2).
 * Stubs provider (SMD_AI.explainGrounded) + retrieval (StewardRAG.buildPackage) with capture,
 * drives the Ask-AI chat with a topic then follow-ups, and asserts:
 *   • a follow-up ("give in detail") resolves against the prior topic (question mentions it) + depth="detailed"
 *   • "what antibiotics?" resolves to empiric-therapy question for the SAME topic
 *   • bare "dose?" with no prior drug → clarify, ZERO provider calls
 *   • follow-ups never lose the topic (retrieval query references it, not the raw phrase)
 *   • casual "hi" after a topic is still casual (0 calls), does not hijack the topic
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-continuity.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9473);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-cont`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  await sleep(1500);
  // bust any service worker + caches so we test the on-disk home.js and avoid a mid-test SW reload
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(600);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "1" });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  // capturing stubs: record what the topic layer actually shipped to retrieval + provider
  await ev(`
    window.__mk = { prov:0, retr:0, q:"", retrieval:"", depth:"" };
    window.SMD_AI = window.SMD_AI || {};
    SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(pkg, opts){ window.__mk.prov++; window.__mk.q = (pkg&&pkg.question)||""; window.__mk.depth = (opts&&opts.depth)||""; return Promise.resolve({ text: "## Clinical take\\nManagement guidance for the requested topic, complete to the last sentence." }); };
    SMD_AI.explainGroundedStream = function(pkg, opts, onDelta){ window.__mk.prov++; window.__mk.q = (pkg&&pkg.question)||""; window.__mk.depth = (opts&&opts.depth)||""; try{onDelta&&onDelta("stub");}catch(e){} return Promise.resolve({ text: "## Clinical take\\nManagement guidance for the requested topic, complete to the last sentence." }); };
    window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(assess, opts){ window.__mk.retr++; window.__mk.retrieval = (opts&&opts.question)||""; return Promise.resolve({ retrieved:[], grounding:[], reasoning:{differential:[]}, question:(opts&&opts.question)||"" }); } };
    try { localStorage.setItem("smd_maik_v2","1"); } catch(e){}
    return 1;`);
  let opened = false;
  for (let i = 0; i < 12 && !opened; i++) {
    await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`);
    await sleep(400);
    opened = await ev(`return !!document.getElementById("maikQ")`) === true;
  }
  if (!opened) { console.log("WARN: sheet not open"); }
  async function ask(msg) {
    await ev(`window.__mk={prov:0,retr:0,q:"",retrieval:"",depth:""}; document.getElementById("maikQ").value=${JSON.stringify(msg)}; document.getElementById("maikSend").click(); return 1;`);
    await sleep(700);
    return JSON.parse(await ev(`var mk=window.__mk; return JSON.stringify({prov:mk.prov, retr:mk.retr, q:mk.q, retrieval:mk.retrieval, depth:mk.depth, last:(function(){var b=document.querySelectorAll("#maikBody .maik-b.ai");return b.length?b[b.length-1].innerText.slice(0,90):"";})()});`));
  }
  let r;
  // establish topic
  r = await ask("how do we treat acute cholangitis?");
  chk('topic seed "acute cholangitis" → 1 provider call', r.prov===1, "prov="+r.prov);
  chk('  retrieval query is the real topic', /cholangitis/i.test(r.retrieval), "retrieval="+JSON.stringify(r.retrieval));
  // THE headline bug: "give in detail" must NOT lose the topic
  r = await ask("give in detail");
  chk('"give in detail" → 1 provider call (treated as follow-up)', r.prov===1, "prov="+r.prov);
  chk('  resolved question still references cholangitis (topic NOT lost)', /cholangitis/i.test(r.q), "q="+JSON.stringify(r.q));
  chk('  depth escalated to "detailed"', r.depth==="detailed", "depth="+r.depth);
  chk('  retrieval query references cholangitis (not "give in detail")', /cholangitis/i.test(r.retrieval) && !/^give in detail$/i.test(r.retrieval), "retrieval="+JSON.stringify(r.retrieval));
  // "what antibiotics?" follow-up
  r = await ask("what antibiotics?");
  chk('"what antibiotics?" → 1 call, empiric-therapy for cholangitis', r.prov===1 && /cholangitis/i.test(r.q) && /antimicrobial|antibiotic|empiric/i.test(r.q), "q="+JSON.stringify(r.q));
  // bare "dose?" with no prior specific drug → clarify, no call
  r = await ask("dose?");
  chk('"dose?" (no drug) → 0 provider calls (clarify)', r.prov===0, "prov="+r.prov);
  chk('  clarify asks which drug', /which drug/i.test(r.last), "reply="+JSON.stringify(r.last.slice(0,50)));
  // casual after a topic must stay casual and not hijack via follow-up
  r = await ask("thanks");
  chk('"thanks" after a topic → 0 provider calls (casual, not follow-up)', r.prov===0, "prov="+r.prov);
  // new explicit topic replaces the old one
  r = await ask("how to manage status epilepticus?");
  chk('new topic "status epilepticus" → 1 call, references itself not cholangitis', r.prov===1 && /epilepticus/i.test(r.retrieval) && !/cholangitis/i.test(r.retrieval), "retrieval="+JSON.stringify(r.retrieval));
  // follow-up now resolves against the NEW topic
  r = await ask("in detail");
  chk('"in detail" now expands status epilepticus (topic switched)', /epilepticus/i.test(r.q) && r.depth==="detailed", "q="+JSON.stringify(r.q));
  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — conversation continuity + query rewriting verified"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
