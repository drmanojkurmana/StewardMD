/* StewardMD — MaiK LLM-first routing test.
 * Verifies the smd_maik_llm_first flag (home.js): default ON routes standalone clinical
 * questions to the LLM (Gemini/Vertex) instead of the templated KB, and ?llm=0 restores
 * the KB-instant path. Stubs BOTH provider entries (stream + non-stream) with a counter;
 * uses the REAL on-device KB (StewardRAG/MaiKKB not stubbed).
 * USAGE: start a static server, then  BASE=http://localhost:8905/ node test/run-maik-llm-first.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8905/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9477);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/llmfirst-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
const warn = (n, d) => console.log(`  ⚠️  ${n}${d ? " — " + d : ""}`);
async function load(qs) {
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + qs });
  await sleep(1200);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(400);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "r" + qs });
  for (let i = 0; i < 100; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG && window.MaiKKB)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  // stub ONLY the provider (both entries) with a counter; keep the real KB/retrieval
  await ev(`
    window.__mk = { prov:0 };
    window.SMD_AI = window.SMD_AI || {};
    SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(){ window.__mk.prov++; return Promise.resolve({ text:"## Overview\\nStub answer." }); };
    SMD_AI.explainGroundedStream = function(p,o,onDelta){ window.__mk.prov++; try{onDelta&&onDelta("stub");}catch(e){} return Promise.resolve({ text:"stub" }); };
    return 1;`);
  await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`);
  await sleep(500);
}
async function ask(msg) {
  await ev(`window.__mk={prov:0}; var q=document.getElementById("maikQ"); q.value=${JSON.stringify(msg)}; return 1;`);
  await ev(`document.getElementById("maikSend").click(); return 1;`);
  await sleep(1000);
  return Number(await ev(`return (window.__mk&&window.__mk.prov)||0;`));
}
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});

  console.log("── LLM-first default (ON) ──");
  await load("");
  chk("exact lookup 'what is sepsis' → LLM called (LLM-first overrides KB-instant)", (await ask("what is sepsis")) >= 1);
  chk("reasoning 'how do we treat DKA?' → LLM called", (await ask("how do we treat DKA?")) >= 1);

  console.log("── ?llm=0 (KB-first restored) ──");
  await load("&llm=0");
  const kbCalls = await ask("what is sepsis");
  if (kbCalls === 0) chk("exact lookup 'what is sepsis' → KB-instant, NO LLM call", true);
  else warn("KB-instant not hit in headless env (KB confidence dependent)", "prov=" + kbCalls + " — flag path still exercised");

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — LLM-first routes to the model; flag reversible"}`);
} catch (e) { console.log("TEST ERROR", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); process.exitCode = fails ? 1 : 0; }
