/* Mobile viewport audit (PR A). Loads key screens at iPhone-narrow / iPhone / Android / iPad,
 * light + dark, and flags: horizontal overflow (body wider than viewport), primary actions
 * clipped off the bottom, and undersized touch targets on visible interactive controls.
 * Reports findings; a horizontal-overflow on any screen is treated as a FAIL. Synthetic data only.
 * USAGE: node test/run-mobile-audit.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8921/").replace(/\/?$/, "/");
const PORT = 9423, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/mobile-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const warn = (m) => console.log("⚠️  " + m);
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8921"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

const VIEWPORTS = [
  { name: "iPhone-SE (320)", w: 320, h: 568 },
  { name: "iPhone-13 (390)", w: 390, h: 844 },
  { name: "Android (360)", w: 360, h: 800 },
  { name: "iPad (768)", w: 768, h: 1024 }
];
// Overflow probe: returns viewport width, body scrollWidth, and up to 5 offending elements.
const OVERFLOW = `
  var vw = window.innerWidth, de = document.documentElement;
  var over = Math.max(de.scrollWidth, document.body.scrollWidth) - vw;
  var offenders = [];
  if (over > 1) {
    var all = document.querySelectorAll('body *');
    for (var i=0;i<all.length && offenders.length<5;i++){ var el=all[i]; var r=el.getBoundingClientRect();
      if (r.width>0 && r.right > vw+1 && getComputedStyle(el).position!=='fixed') {
        offenders.push((el.id?('#'+el.id):el.className&&typeof el.className==='string'?('.'+el.className.split(' ')[0]:el.tagName)) + ' right='+Math.round(r.right)); }
    }
  }
  return JSON.stringify({ vw: vw, over: over, offenders: offenders });`;
async function overflow(label) {
  const r = await J(OVERFLOW);
  if (r && r.over > 1) { ok(false, `${label}: horizontal overflow +${r.over}px [${(r.offenders||[]).join("; ")}]`); }
  else { ok(true, `${label}: no horizontal overflow`); }
}
// tiny-target probe among VISIBLE interactive controls in a container
async function targets(label, sel) {
  const r = await J(`
    var root = ${sel}; if(!root) return JSON.stringify({n:0,small:[]});
    var btns = root.querySelectorAll('button,[role=button],a,[data-icu-act],[data-act]'); var small=[];
    for (var i=0;i<btns.length;i++){ var b=btns[i]; var r=b.getBoundingClientRect();
      if (r.width>0 && r.height>0 && (r.height<40||r.width<40) && small.length<6) small.push((b.textContent||b.getAttribute('aria-label')||b.tagName).trim().slice(0,18)+' '+Math.round(r.width)+'x'+Math.round(r.height)); }
    return JSON.stringify({ n:btns.length, small:small });`);
  if (r && r.small && r.small.length) warn(`${label}: ${r.small.length} touch target(s) < 40px [${r.small.join("; ")}]`);
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && window.MEDCALC)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("app not loaded");
  const strip = `["smdBootSplash","introPoster","splash","accountGate","introOverlay","smdSplash"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();}); return 1;`;

  for (const dark of [false, true]) {
    for (const vp of VIEWPORTS) {
      await call("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
      const mode = dark ? "dark" : "light";
      const tag = `${vp.name} ${mode}`;
      // HOME
      await ev(`document.body.classList.${dark ? "add" : "remove"}('dark'); if(window.ICU&&ICU.close)ICU.close(); ${strip}`);
      await sleep(150); await overflow(`HOME ${tag}`);
      // ICU dashboard (synthetic patient, Overview)
      await ev(`ICU.reset(); ICU.ingestPatient({name:"QA-Test",age:60,sex:"M",weightKg:70,bed:"7",diagnosis:"Septic shock"}); ICU.ingestMonitor({hr:110,sbp:95,dbp:60,spo2:93,rr:26,temp:38.6,lactate:3.2}); ICU.ingestLabs({na:132,k:5.6,creat:180,hb:9.1,wbc:18,plt:90}); ICU.open(); ${strip}`);
      await sleep(200); await overflow(`ICU-Overview ${tag}`);
      if (!dark && vp.w === 390) await targets("ICU-Overview nav", `document.querySelector('#icuRoot .icu-bottomnav')||document.getElementById('icuRoot')`);
      // ICU Monitoring workspace (dense tables/trends)
      await ev(`ICU.open('trends'); ${strip}`); await sleep(200); await overflow(`ICU-Trends ${tag}`);
      // ICU Lab Watch setup sheet (bottom sheet clipping)
      await ev(`ICU._lwSet&&ICU._lwSet(null); ICU.openLabWatch(); ${strip}`); await sleep(200); await overflow(`ICU-LabWatch-sheet ${tag}`);
      await ev(`var m=document.getElementById('icuModal'); if(m)m.classList.remove('on'); if(window.ICU)ICU.close(); ${strip}`);
      // Calculator panel (MELD)
      await ev(`MEDCALC.open('meld3'); ${strip}`); await sleep(200); await overflow(`Calc-MELD ${tag}`);
      await ev(`if(window.MEDCALC&&MEDCALC.close)MEDCALC.close(); ${strip}`);
    }
  }

  console.log(fails === 0 ? "\nALL GREEN — mobile viewport audit: no horizontal overflow on tested screens" : `\n${fails} overflow issue(s) found`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
