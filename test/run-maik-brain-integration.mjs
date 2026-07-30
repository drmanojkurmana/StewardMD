/* MaiK Brain integration + PARITY test (flag smd_maik_brain, default off).
 * Boots the real app, stubs the provider (StewardRAG + SMD_AI) with call counters, and checks:
 *   1. flag ON  + "MS"  → deterministic never-guess clarification, ZERO provider calls
 *   2. flag ON  + "DKA treatment" → NOT short-circuited (falls through to the engine)
 *   3. flag OFF + "MS"  → brain gate is INERT (no clarification) = parity with today
 * USAGE: node test/run-maik-brain-integration.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9386, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-brain-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), "8991"], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let mid = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = mid++; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const STUB = `
  window.__calls = { rag: 0, ai: 0 }; window.__lastPkg = null;
  try { if (window.StewardRAG) { StewardRAG.ready = function(){ return Promise.resolve(); };
    StewardRAG.buildPackage = function(){ window.__calls.rag++; return Promise.resolve({ question:"q", grounding:[{ diseaseId:"cap_demo", name:"Community Acquired Pneumonia", knowledge:["Amoxicillin-clavulanate 625 mg PO TDS 5-7 days; add a macrolide for atypical cover"] }], topicMatch:{ matched:true, mode:"confident" } }); }; } } catch(e){}
  try { if (window.MaiKKB) MaiKKB.compose = function(){ return null; }; } catch(e){}   // force the Gemini synthesis path
  try { if (window.SMD_AI) { SMD_AI.route = function(){ window.__calls.ai++; return Promise.resolve({}); };
    SMD_AI.explainGrounded = function(p){ window.__calls.ai++; window.__lastPkg = p; return Promise.resolve("stub answer"); };
    SMD_AI.explainGroundedStream = function(p){ window.__calls.ai++; window.__lastPkg = p; return Promise.resolve("stub answer"); }; } } catch(e){}
  return 1;`;

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.MaiKBrain)`) === true) return true; }
  return false;
}
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const booted = await attach(BASE);
  ok(booted, "app booted (SMD_askMaik + MaiKBrain present)");
  if (!booted) throw new Error("boot failed");

  const openAndAsk = async (q, brain) => {
    await ev(`try{${brain ? "localStorage.setItem('smd_maik_brain','1')" : "localStorage.removeItem('smd_maik_brain')"}}catch(e){}; window.SMD_askMaik(""); return 1;`); await sleep(400);
    await ev(`var n=document.getElementById("maikNew"); if(n) n.click(); return 1;`); await sleep(250); // FRESH thread (clear prior bubbles)
    await ev(STUB);
    await ev(`var t=document.querySelector("#maikSheet .maik-ta"); if(t){t.value=${JSON.stringify(q)};} var s=document.getElementById("maikSend"); if(s) s.click(); return 1;`);
    await sleep(1200);
  };
  const bodyText = () => ev(`var b=document.getElementById("maikBody"); return b?b.textContent:"";`);
  const calls = () => ev(`return window.__calls || {rag:0,ai:0}`);

  // 1) flag ON + ambiguous acronym → clarify, zero provider calls
  await openAndAsk("MS", true);
  let txt = (await bodyText()) || "", c = await calls();
  ok(/more than one meaning|which did you mean/i.test(txt), "flag ON: 'MS' → never-guess clarification shown");
  ok(/multiple sclerosis/i.test(txt) && /mitral stenosis/i.test(txt), "clarification offers both expansions");
  ok(c.rag === 0 && c.ai === 0, "flag ON: ambiguity short-circuits BEFORE grounding/Gemini (0 provider calls)");

  // 2) flag ON + specific query → NOT short-circuited (engine runs)
  await openAndAsk("diabetic ketoacidosis treatment", true);
  let txt2 = (await bodyText()) || "";
  ok(!/more than one meaning/i.test(txt2), "flag ON: a specific query is NOT wrongly clarified");

  // 3) flag OFF (default) → brain gate inert = parity
  await openAndAsk("MS", false);
  let txt3 = (await bodyText()) || "";
  ok(!/more than one meaning/i.test(txt3), "flag OFF (default): brain gate is inert — no brain clarification (parity)");

  // 4) flag ON + synthesis query → ranked evidence bundle + audience reach the /explain payload
  await openAndAsk("community acquired pneumonia treatment", true);
  const lp = await ev(`return window.__lastPkg ? { bundle: !!(window.__lastPkg.evidenceBundle && window.__lastPkg.evidenceBundle.claims && window.__lastPkg.evidenceBundle.claims.length), audience: window.__lastPkg.audience || null } : null`);
  ok(lp && lp.bundle === true, "flag ON: a RANKED evidence bundle is attached to the synthesis payload");
  ok(lp && !!lp.audience, "flag ON: inferred audience is attached");

  // 5) flag OFF + same query → NO bundle on the payload (server sees today's package = parity)
  await openAndAsk("community acquired pneumonia treatment", false);
  const lp2 = await ev(`return window.__lastPkg ? !!window.__lastPkg.evidenceBundle : "no-call"`);
  ok(lp2 === false, "flag OFF: no evidence bundle attached (server payload unchanged = parity)");

  console.log(fails ? `\n${fails} FAILED` : "\nALL BRAIN INTEGRATION CHECKS PASSED");
} catch (e) { console.error("ERROR:", e && e.message || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails ? 1 : 0); }
