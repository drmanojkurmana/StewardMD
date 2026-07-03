/* StewardMD — MaiK intent-routing + cost regression test.
 * Stubs the provider (SMD_AI.explainGrounded) + retrieval (StewardRAG.buildPackage)
 * with call counters, drives the Ask-AI chat, and asserts:
 *   casual / app-help / patient-redirect  → ZERO provider calls
 *   clinical question                     → exactly ONE provider call
 *   repeated Send (idempotency)           → still ONE provider call
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-routing.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9471);
const SHOTS = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp/shots";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome`, "--no-first-run", "--disable-gpu", "--force-device-scale-factor=2"], { stdio: "ignore" });
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
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  // Stub provider + retrieval with counters (no real network)
  await ev(`
    window.__mk = { prov:0, retr:0 };
    window.SMD_AI = window.SMD_AI || {};
    SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(){ window.__mk.prov++; return Promise.resolve({ text: "## Overview\\nDKA is treated with fluids, insulin, and potassium repletion." }); };
    window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(){ window.__mk.retr++; return Promise.resolve({ retrieved:[], grounding:[], reasoning:{differential:[]} }); } };
    return 1;`);
  // open Ask AI
  await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();return "clicked";} return "notab";`);
  await sleep(500);
  const opened = await ev(`return !!document.getElementById("maikQ")`);
  if (!opened) { console.log("could not open Ask AI sheet"); }
  async function ask(msg, opts) {
    await ev(`window.__mk={prov:0,retr:0}; var q=document.getElementById("maikQ"); q.value=${JSON.stringify(msg)}; return 1;`);
    if (opts && opts.doubleTap) { await ev(`var b=document.getElementById("maikSend"); b.click(); b.click(); return 1;`); }
    else { await ev(`document.getElementById("maikSend").click(); return 1;`); }
    await sleep(700);
    return JSON.parse(await ev(`var mk=window.__mk||{prov:-1,retr:-1}; return JSON.stringify({prov:mk.prov, retr:mk.retr, last:(function(){var b=document.querySelectorAll("#maikBody .maik-b.ai");return b.length?b[b.length-1].innerText.slice(0,80):"";})()});`));
  }
  let r;
  r = await ask("hi");            chk('"hi" → 0 provider calls (casual)', r.prov===0 && r.retr===0, "prov="+r.prov+" reply="+JSON.stringify(r.last.slice(0,40)));
  r = await ask("hii");           chk('"hii" → 0 provider calls', r.prov===0, "prov="+r.prov);
  r = await ask("hello there");   chk('"hello there" → 0 provider calls', r.prov===0, "prov="+r.prov);
  r = await ask("thanks");        chk('"thanks" → 0 provider calls', r.prov===0);
  r = await ask("what can you do"); chk('"what can you do" → 0 provider calls (app-help)', r.prov===0);
  r = await ask("my patient has fever and hypotension"); chk('patient-specific (no case) → 0 calls + redirect', r.prov===0 && /Dx My Patient|assess/i.test(r.last), r.last.slice(0,50));
  r = await ask("how do we treat DKA?"); chk('"how do we treat DKA?" → exactly 1 provider call', r.prov===1, "prov="+r.prov);
  r = await ask("OP poisoning management"); chk('"OP poisoning management" → 1 provider call', r.prov===1, "prov="+r.prov);
  r = await ask("how do we treat DKA?", { doubleTap:true }); chk('double Send tap → still 1 provider call (idempotency+cache)', r.prov<=1, "prov="+r.prov);
  // screenshots
  await call("Runtime.evaluate",{expression:`(function(){var q=document.getElementById("maikQ");q.value="hi";document.getElementById("maikSend").click();})()`});
  await sleep(400); let s=(await call("Page.captureScreenshot",{format:"png"})).result; if(s&&s.data){writeFileSync(SHOTS+"/maik_casual.png",Buffer.from(s.data,"base64"));console.log("shot maik_casual");}
  await ev(`document.getElementById("maikQ").value="how do we treat DKA?";document.getElementById("maikSend").click();return 1;`); await sleep(700);
  s=(await call("Page.captureScreenshot",{format:"png"})).result; if(s&&s.data){writeFileSync(SHOTS+"/maik_dka.png",Buffer.from(s.data,"base64"));console.log("shot maik_dka");}
  await ev(`document.getElementById("maikQ").value="my patient has chest pain what should I do";document.getElementById("maikSend").click();return 1;`); await sleep(500);
  s=(await call("Page.captureScreenshot",{format:"png"})).result; if(s&&s.data){writeFileSync(SHOTS+"/maik_patient.png",Buffer.from(s.data,"base64"));console.log("shot maik_patient");}
  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — routing + cost behaviour verified"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
