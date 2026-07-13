/* Store screenshot capture — drives the LIVE app in headless Chrome at
 * deviceScaleFactor 3 (430×932 CSS → 1290×2796 px, an App Store-accepted iPhone
 * size) and saves clean, crisp app-screen PNGs. Reuses the repo's CDP pattern.
 *
 *   node scripts/store/capture.mjs
 *
 * Output: store-assets/apple-marketing/screens/<name>.png   (raw app screens, no frame)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "store-assets", "apple-marketing", "screens");
mkdirSync(OUT, { recursive: true });

const BASE = (process.env.BASE || "http://localhost:8917/").replace(/\/?$/, "/");
const PORT = 9412;
const userDir = "/private/tmp/claude-501/store-cap-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---- gate bypass: consent + far-future guest + suppress tour ----
const FUTURE = 4102444800000; // year 2100
const SEED = `
localStorage.setItem('smd_consent', JSON.stringify({v:1,ts:Date.now(),attest:'qualified_hcp'}));
localStorage.setItem('smd_consent_guest', JSON.stringify({userId:'guest',privacyPolicyVersion:'2026-07-05',termsVersion:'2026-07-05',consentAcceptedAt:new Date().toISOString(),clinicalAuthorityConfirmedAt:new Date().toISOString(),optionalImprovementConsent:false,optionalImprovementConsentAt:null,updatedAt:new Date().toISOString()}));
localStorage.setItem('stewardmd_account', JSON.stringify({type:'guest',expiresAt:${FUTURE}}));
localStorage.setItem('smd_guest_day', new Date().toISOString().slice(0,10));
localStorage.setItem('smd_guest_uses','1');
localStorage.setItem('stewardmd_guest_used', String(Date.now()));
localStorage.setItem('smd_onboarding_tour','0');
localStorage.setItem('stewardmd_icu_seen','1');
`;

// ---- keep every screen clean: kill FABs, tour veil/card, tooltips, rotate hint ----
const CLEAN = `
try{['#infFab','#smdBackToTop','.smdt-veil','.smdt-card','.smdt-spot','.smdt-tip','#abgRotate','[id*="abgRotate"]','[class*="abg-rotate"]'].forEach(function(s){document.querySelectorAll(s).forEach(function(e){e.remove&&e.remove();});});}catch(e){}
// generic: remove any small round fixed/absolute floating action button anywhere on screen
try{[...document.querySelectorAll('button,a,div')].forEach(function(e){var s=getComputedStyle(e);if((s.position==='fixed'||s.position==='absolute')&&parseFloat(s.borderRadius)>=24&&e.offsetWidth>=44&&e.offsetWidth<=100&&Math.abs(e.offsetWidth-e.offsetHeight)<12){e.remove();}});}catch(e){}
try{[...document.querySelectorAll('button')].filter(function(b){return /^Got it$/.test((b.textContent||'').trim());}).forEach(function(b){b.remove();});}catch(e){}
try{if(window.SMD_TOUR&&SMD_TOUR.stop)SMD_TOUR.stop();}catch(e){}
`;

// theme: 'light' | 'dark'
function themeSeed(theme) {
  return `localStorage.setItem('stewardmd_theme','${theme}');localStorage.setItem('stewardmd_theme_source','manual');`;
}

const SCREENS = [
  { name: "01-home-light", theme: "light", drive: `if(window.SMD_goHome)SMD_goHome();`, settle: 900 },
  { name: "02-antibiogram-light", theme: "light", drive: `if(window.ABG&&ABG.open)ABG.open();`, settle: 1400 },
  {
    name: "03-watchlab", theme: "light", settle: 1500,
    drive: `
      ICU.reset();
      ICU.ingestPatient({name:'Bed 7 · A. Kumar',age:58,sex:'M',bed:'ICU-7',diagnosis:'Sepsis — urinary source'});
      ICU.ingestWardHistory({source:'Ward Sync', labs:[
        {test:'Sodium',result:129,units:'mmol/L',date:'2026-07-13T06:00:00Z'},
        {test:'Potassium',result:5.3,units:'mmol/L',date:'2026-07-13T06:00:00Z'},
        {test:'Creatinine',result:2.1,units:'mg/dL',date:'2026-07-13T06:00:00Z'},
        {test:'CRP',result:180,units:'mg/L',date:'2026-07-13T06:00:00Z'},
        {test:'WBC',result:18.4,units:'10^3/uL',date:'2026-07-13T06:00:00Z'}
      ]});
      ICU.openLabWatch();
    `
  },
  {
    name: "04-icu-snapshot", theme: "light", settle: 1500,
    drive: `
      ICU.reset();
      ICU.ingestPatient({name:'Bed 3 · S. Rao',age:64,sex:'F',bed:'ICU-3',diagnosis:'Septic shock'});
      ICU.ingestMonitor({hr:118, rr:26, sbp:92, dbp:54, temp:38.6, spo2:93, lactate:3.4, uop:24});
      ICU.ingestLabs({creat:1.8, egfr:34, hb:9.8, plt:118, glu:184, k:4.6, na:134});
      ICU.open();
    `
  },
  { name: "05-antibiogram-dark", theme: "dark", drive: `if(window.ABG&&ABG.open)ABG.open();`, settle: 1400 },
  { name: "06-home-dark", theme: "dark", drive: `if(window.SMD_goHome)SMD_goHome();`, settle: 900 },
  {
    name: "07-interactions", theme: "light", settle: 1600,
    drive: `if(window.MEDDRUGS&&MEDDRUGS.openInteractions)MEDDRUGS.openInteractions();`
  },
  {
    name: "08-drugdb", theme: "light", settle: 3200,
    drive: `
      if(window.MEDDB&&MEDDB.openList)MEDDB.openList();
      var si=document.getElementById('dbSearch');
      if(si){ si.value='augmentin'; si.focus(); si.dispatchEvent(new Event('input',{bubbles:true})); }
    `
  },
];

// ---------- server ----------
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8917"])[1];
  serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
  throw new Error("server did not start");
}

// ---------- CDP ----------
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio"], { stdio: "ignore" });

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });

  const URL = BASE + "?tour=0";
  // First load to establish origin, then seed gate + a theme, then reload past the gate.
  await call("Page.navigate", { url: URL }); await sleep(1500);
  await ev(SEED); await ev(themeSeed("light"));

  for (const s of SCREENS) {
    // wipe any ICU patient / lab-watch state so the home screen stays clean;
    // the ICU & lab-watch screens re-seed their own data in drive.
    await ev(`Object.keys(localStorage).forEach(function(k){ if(/icu|lab_?watch|draft/i.test(k) && !/icu_owner|icu_seen/.test(k)) localStorage.removeItem(k); }); return 1;`);
    await ev(themeSeed(s.theme));
    await call("Page.navigate", { url: URL });
    // wait for app ready
    let ready = false;
    for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return !!(window.SMD_goHome && window.ABG && window.ICU && window.MEDDRUGS);`) === true) { ready = true; break; } }
    if (!ready) { console.log("⚠️  app not ready for", s.name); }
    await sleep(600);
    // force the desired theme regardless of stored state
    await ev(`(function(){var want='${s.theme}'==='dark';var has=document.body.classList.contains('dark');if(want!==has&&window.SB&&SB.toggleTheme)SB.toggleTheme();return 1;})()`);
    await sleep(300);
    await ev(`if(window.SMD_goHome)SMD_goHome();`); // land on home first
    await sleep(500);
    if (s.drive) await ev(s.drive);
    await sleep(s.settle || 1000);
    await ev(CLEAN);
    await sleep(150);
    await ev(CLEAN);
    await ev(`window.scrollTo(0,0); var m=document.querySelector('.abg-scroll,.icu-scroll,.modal-body,[class*="scroll"]'); if(m)m.scrollTop=0;`);
    await sleep(250);
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const buf = Buffer.from(shot.result.data, "base64");
    writeFileSync(join(OUT, s.name + ".png"), buf);
    console.log("✅ captured", s.name, `(${buf.length} bytes)`);
  }
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
process.exit(0);
