/* StewardMD — MaiK multi-turn conversation memory (Phase 3).
 * Stubs the provider (capturing the package it receives) and verifies that across a real
 * multi-turn dialogue the client ships RECENT CONVERSATION HISTORY (prior question + answer
 * gist) to the model — so follow-ups are answered with continuity, like a real chat AI.
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-conversation.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9477);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-conv`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
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
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(500);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "3" });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  await ev(`
    window.__hist = [];
    window.SMD_AI = window.SMD_AI || {};
    SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(pkg, opts){ window.__hist.push(pkg && pkg.history ? pkg.history.map(function(h){return {q:h.q, hasA:!!h.a};}) : null); return Promise.resolve({ text: "## Answer\\nManagement guidance for the topic, complete to the last sentence." }); };
    window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(a,o){ return Promise.resolve({ retrieved:[], reasoning:{differential:[]}, question:(o&&o.question)||"" }); } };
    try { localStorage.setItem("smd_maik_v2","1"); } catch(e){}
    return 1;`);
  let opened = false;
  for (let i = 0; i < 12 && !opened; i++) { await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`); await sleep(400); opened = await ev(`return !!document.getElementById("maikQ")`) === true; }
  async function ask(msg) { await ev(`document.getElementById("maikQ").value=${JSON.stringify(msg)}; document.getElementById("maikSend").click(); return 1;`); await sleep(700); }

  await ask("how do we treat acute cholangitis?");
  await ask("what antibiotics?");
  await ask("give in detail");
  const hist = JSON.parse(await ev(`return JSON.stringify(window.__hist);`));
  chk("3 provider calls captured", hist.length === 3, "got " + hist.length);
  chk("turn 1 sends NO prior history", !hist[0] || hist[0].length === 0, JSON.stringify(hist[0]));
  chk("turn 2 sends history incl. the cholangitis turn", !!(hist[1] && hist[1].length >= 1 && /cholangitis/i.test(hist[1][0].q)), JSON.stringify(hist[1]));
  chk("turn 2 history carries the prior answer gist", !!(hist[1] && hist[1][0] && hist[1][0].hasA), JSON.stringify(hist[1] && hist[1][0]));
  chk("turn 3 history has >=2 prior turns", !!(hist[2] && hist[2].length >= 2), "len=" + (hist[2] && hist[2].length));
  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — multi-turn conversation history reaches the model"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
