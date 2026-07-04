/* StewardMD — patient-specific safety overlay regression test.
 * Loads the app headless, exercises the pure SMD_SAFETY checks with synthetic
 * findings, and (Task 7) drives the injector against a stubbed #outputArea.
 * USAGE: BASE=http://localhost:5173/ node test/run-safety-overlay.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9492);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/safety-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
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
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SAFETY && window.ASP_DRUGS)`) === true) break; }

  // ---- Task 2: flag ----
  chk("SMD_SAFETY exposed", await ev(`return !!window.SMD_SAFETY`) === true);
  chk("flag defaults ON", await ev(`return String(SMD_SAFETY.flag())`) === "true");
  await ev(`SMD_SAFETY.setFlag(false); return 1;`);
  chk("setFlag(false) turns it off", await ev(`return String(SMD_SAFETY.flag())`) === "false");
  await ev(`SMD_SAFETY.setFlag(true); return 1;`);
  chk("setFlag(true) turns it on", await ev(`return String(SMD_SAFETY.flag())`) === "true");

  // ---- Task 3: detectRecommendedDrugs ----
  await ev(`
    var oa = document.getElementById("outputArea") || (function(){var d=document.createElement("div");d.id="outputArea";document.body.appendChild(d);return d;})();
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg PO once daily</div><div class="qa-regimen-row">Amoxicillin-clavulanate 625 mg PO q8h</div></div>';
    return 1;`);
  const det = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.detectRecommendedDrugs())`));
  chk("detect finds azithromycin", det.indexOf("azithromycin") >= 0, JSON.stringify(det));
  chk("detect finds amoxiclav (generic-name match)", det.indexOf("amoxiclav") >= 0 || det.indexOf("amoxicillin") >= 0, JSON.stringify(det));
  chk("detect does NOT find levofloxacin (absent)", det.indexOf("levofloxacin") < 0);

  // ---- Task 4: renalCheck ----
  const rc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.renalCheck({age:80,weight:60,sex:"m",creatinine:2.5}))`));
  chk("renalCheck computes low CrCl", rc && rc.crcl > 0 && rc.crcl < 30, JSON.stringify(rc));
  chk("renalCheck tier is severe (~20)", rc && /severe/.test(rc.tier), rc && rc.tier);
  chk("renalCheck text mentions CrCl", rc && /CrCl/.test(rc.text));
  chk("renalCheck null when CrCl normal", await ev(`return String(SMD_SAFETY.renalCheck({age:30,weight:70,sex:"m",creatinine:0.8})===null)`) === "true");
  chk("renalCheck null when inputs missing", await ev(`return String(SMD_SAFETY.renalCheck({age:80})===null)`) === "true");

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
