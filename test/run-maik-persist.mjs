/* StewardMD — MaiK conversation-persistence smoke.
 * Verifies the Ask-AI thread survives a full page reload (persisted device-local),
 * and that the header "New" button clears both the on-screen thread and storage.
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-persist.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9481);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/maik-chrome-persist`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
const STUB = `
  window.SMD_AI = window.SMD_AI || {}; SMD_AI.setFlag = function(){};
  SMD_AI.explainGrounded = function(){ return Promise.resolve({ text: "## Take\\nAcute cholangitis needs early biliary drainage." }); };
  window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(a,o){ return Promise.resolve({ retrieved:[{diseaseId:"CHOLANGITIS",section:"management",source:{ref:"guideline"}}], reasoning:{differential:[]}, question:(o&&o.question)||"" }); } };
  try{localStorage.setItem("smd_maik_v2","1");}catch(e){}
  return 1;`;
const boot = async (clearLS) => {
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + Math.floor(id) });
  await sleep(1200);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  if (clearLS) await ev(`try{localStorage.removeItem("smd_maik_thread");}catch(e){} return 1;`);
  await sleep(400);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "b" + Math.floor(id) });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  await ev(STUB);
};
const openSheet = async () => {
  let opened = false;
  for (let i = 0; i < 14 && !opened; i++) { await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`); await sleep(400); opened = await ev(`return !!document.getElementById("maikQ")`) === true; }
  return opened;
};
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});

  // 1. Fresh start (cleared storage) → ask a question → answer renders + thread is persisted.
  await boot(true);
  chk("sheet opens", await openSheet());
  await ev(`document.getElementById("maikQ").value="how do we treat acute cholangitis?"; document.getElementById("maikSend").click(); return 1;`);
  await sleep(900);
  chk("answer rendered", await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); return b.length && /cholangitis/i.test(b[b.length-1].innerText);`) === true);
  const saved = await ev(`try{return localStorage.getItem("smd_maik_thread")||"";}catch(e){return "";}`);
  chk("thread written to localStorage (has user turn)", /maik-b you/.test(saved) && /cholangitis/i.test(saved), "len=" + (saved || "").length);

  // 2. Full reload (storage NOT cleared) → reopen → prior conversation restored without re-asking.
  await boot(false);
  chk("sheet reopens after reload", await openSheet());
  await sleep(300);
  chk("prior question restored across reload", await ev(`var y=document.querySelector("#maikBody .maik-b.you"); return !!(y && /cholangitis/i.test(y.innerText));`) === true);
  chk("prior answer restored across reload", await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); return b.length && /cholangitis/i.test(b[b.length-1].innerText);`) === true);

  // 3. "New" button clears the thread + storage.
  chk("New button present in header", await ev(`return !!document.getElementById("maikNew");`) === true);
  await ev(`document.getElementById("maikNew").click(); return 1;`);
  await sleep(300);
  chk("thread cleared on screen (no user turn)", await ev(`return !document.querySelector("#maikBody .maik-b.you");`) === true);
  chk("welcome shown after New", await ev(`return /MaiK/.test((document.getElementById("maikBody")||{}).innerText||"");`) === true);
  chk("storage cleared after New", await ev(`try{var v=localStorage.getItem("smd_maik_thread"); return !v || !/maik-b you/.test(v);}catch(e){return true;}`) === true);

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — MaiK persistence + New verified"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
