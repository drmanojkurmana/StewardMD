/* StewardMD — MaiK mobile-layout smoke (Phase 3 QA).
 * Opens the Ask-AI sheet at a 390px phone viewport, sends a stubbed clinical question and a
 * long answer, and asserts the page never scrolls horizontally and the sheet/composer render.
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-mobile.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9478);
const SHOTS = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp/shots";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-mob`, "--no-first-run", "--disable-gpu", "--force-device-scale-factor=2"], { stdio: "ignore" });
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
  await sleep(1500);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(500);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "4" });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  const longMd = "## Clinical take\\nAcute cholangitis is a biliary emergency. **Decompress early.**\\n\\n- Resuscitate, blood cultures, broad-spectrum antibiotics\\n- Biliary drainage (ERCP) within 24-48h; urgent if suppurative\\n- Escalate to ICU if septic shock\\n\\nWant the empiric antibiotic choices or the Tokyo severity grading?";
  await ev(`
    window.SMD_AI = window.SMD_AI || {}; SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(){ return Promise.resolve({ text: "${longMd}" }); };
    window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(a,o){ return Promise.resolve({ retrieved:[{diseaseId:"CHOLANGITIS",section:"management",source:{ref:"guideline"}}], reasoning:{differential:[]}, question:(o&&o.question)||"" }); } };
    try{localStorage.setItem("smd_maik_v2","1");}catch(e){}
    return 1;`);
  let opened = false;
  for (let i = 0; i < 12 && !opened; i++) { await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`); await sleep(400); opened = await ev(`return !!document.getElementById("maikQ")`) === true; }
  chk("Ask-AI sheet opens on mobile", opened);
  chk("composer input + send visible", await ev(`var q=document.getElementById("maikQ"),b=document.getElementById("maikSend"); return !!(q&&b&&q.offsetHeight>0&&b.offsetHeight>0);`) === true);
  await ev(`document.getElementById("maikQ").value="how do we treat acute cholangitis?"; document.getElementById("maikSend").click(); return 1;`);
  await sleep(800);
  const overflow = await ev(`return document.documentElement.scrollWidth - window.innerWidth;`);
  chk("no horizontal page overflow (scrollWidth<=viewport)", overflow <= 1, "overflow=" + overflow + "px");
  const bubbleFits = await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); if(!b.length) return -1; var el=b[b.length-1]; return el.scrollWidth - el.clientWidth;`);
  chk("answer bubble content fits its width", bubbleFits <= 1, "diff=" + bubbleFits + "px");
  chk("answer rendered", await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); return b.length && /cholangitis/i.test(b[b.length-1].innerText);`) === true);
  try { const s = (await call("Page.captureScreenshot", { format: "png" })).result; if (s && s.data) { writeFileSync(SHOTS + "/maik_mobile.png", Buffer.from(s.data, "base64")); console.log("  📸 shot: maik_mobile.png"); } } catch (e) {}
  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — mobile layout verified at 390px"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
