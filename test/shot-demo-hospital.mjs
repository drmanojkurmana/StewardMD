/* test/shot-demo-hospital.mjs — prove the StewardMD Hospital demo actually works, from
 * the REAL app: hospital picker → StewardMD Hospital → 25 patients → StewardMD MICU
 * auto-populated (5 patients, labs, vitals) → a Nephrology patient's per-day labs →
 * bridging one into ICU. Not a test: a demo tool. Same CDP harness as shot-clinix.mjs.
 *   CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/shot-demo-hospital.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, "..", "shots");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9393;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = `/tmp/demo-hospital-shot-${Date.now()}`;   // fresh every run — no stale HTTP cache

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, "--no-first-run", "--disable-gpu", "--mute-audio",
  "--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => (await call("Runtime.evaluate", { expression: `(() => { try { return (${e}); } catch (x) { return { __err: String(x) }; } })()`, returnByValue: true, awaitPromise: true }))?.result?.result?.value;

let n = 0;
async function shot(name) {
  await sleep(500);
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = join(OUT, String(++n).padStart(2, "0") + "-" + name + ".png");
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  console.log("  " + file);
  return file;
}

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable"); await call("Runtime.enable");
  await call("Network.enable"); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  // First load marks "returning user" so the SECOND load skips the splash/intro carousel
  // (index.html:11-12) instead of racing its auto-advance timer mid-script.
  await call("Page.navigate", { url });
  await sleep(600);
  await ev(`(localStorage.setItem("stewardmd_guest_used", "1"), true)`);
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) { if (await ev("!!(window.GHIS && window.ghisLoadDemoHospital && window.SMD_TEST_HOSPITAL && window.ICU && ICU.ingestWardHistory)")) break; await sleep(400); }
  await ev(`(["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }), true)`);
  await sleep(400);
}

function ok(cond, label) { console.log((cond ? "  OK  " : "  FAIL ") + label); if (!cond) process.exitCode = 1; }

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); wsUrl = r.webSocketDebuggerUrl; break; } catch { await sleep(200); } }
  ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  await attach(BASE);
  console.log("app loaded, opening the hospital picker...");
  await ev(`(window.openGHIS(), window.showGhisScreen('hospital'), true)`);
  await shot("hospital-picker-with-stewardmd-hospital-button");

  console.log("tapping 'StewardMD Hospital'...");
  await ev(`(window.ghisLoadDemoHospital(), true)`);
  await sleep(1500);
  await shot("ward-sync-25-demo-patients");

  const count = await ev(`(document.getElementById('ghisCount') || {}).textContent || ''`);
  console.log("Ward Sync patient count:", count);
  ok(/25/.test(count || ""), "Ward Sync shows 25 patients");

  const micu = await ev(`(function(){
    var label = window.ICU && ICU.currentUnitLabel ? ICU.currentUnitLabel() : null;
    var key = Object.keys(localStorage).find(function(k){ return k.indexOf("stewardmd_icu_patients") === 0 && /micu/i.test(k); });
    var entries = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
    return { label: label, entryCount: entries.length, names: entries.map(function(e){ return e.name; }),
      vitalsCount: (entries[0] && entries[0].state && entries[0].state.vitals) ? entries[0].state.vitals.length : 0,
      labsRecentCount: (entries[0] && entries[0].state && entries[0].state.labs) ? Object.keys(entries[0].state.labs.recent || {}).length : 0 };
  })()`);
  console.log("StewardMD MICU:", JSON.stringify(micu));
  ok(micu.label === "StewardMD MICU", "the ICU unit switched to StewardMD MICU");
  ok(micu.entryCount === 5, "StewardMD MICU roster has 5 patients");
  ok(micu.vitalsCount === 9, "the first roster entry carries a 9-reading vitals timeline");
  ok(micu.labsRecentCount >= 20, "the first roster entry carries the full lab panel");

  console.log("filtering to Nephrology...");
  await ev(`(function(){ var sel = document.getElementById('ghisFBranch'); if(!sel) return false; sel.value = 'Nephrology'; sel.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(400);
  await shot("ward-sync-nephrology-branch");

  const severeId = await ev(`window.SMD_TEST_HOSPITAL.branches.find(b=>b.dept==='Nephrology').patients.find(p=>p.name==='Chandrasekhar Rao').patientId`);
  const severeEp = await ev(`window.SMD_TEST_HOSPITAL.branches.find(b=>b.dept==='Nephrology').patients.find(p=>p.name==='Chandrasekhar Rao').episodeId`);
  console.log("opening the severe-CKD patient's lab drawer...");
  await ev(`(GHIS.openLab('${severeEp}', '${severeId}', 'Chandrasekhar Rao'), true)`);
  await sleep(1200);
  const drawerState = await ev(`(function(){
    var d = document.getElementById('ghisLabDrawer'); var s = document.getElementById('splash');
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var hit = null;
    while (walker.nextNode()) { if (/Built by clinicians/.test(walker.currentNode.nodeValue || "")) { hit = walker.currentNode; break; } }
    var el = hit ? hit.parentElement : null;
    var chain = [];
    while (el) { chain.push(el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ").join(".") : "")); el = el.parentElement; }
    return { drawerVisible: !!(d && d.style.display !== 'none'), splashPresent: !!s,
      bodyHTML: (document.getElementById('ghisLabBody')||{}).innerHTML ? (document.getElementById('ghisLabBody').innerHTML.length) : -1,
      splashTextFound: !!hit, splashAncestorChain: chain, bodyChildCount: document.body.children.length };
  })()`);
  console.log("lab drawer state:", JSON.stringify(drawerState));
  await shot("severe-ckd-patient-labs-per-day");

  console.log("bridging this patient into the ICU dashboard...");
  await ev(`(window.__bridgeDone = false, GHIS.loadIntoICU('${severeId}', function(){ window.__bridgeDone = true; }), true)`);
  for (let i = 0; i < 30; i++) { if (await ev(`!!window.__bridgeDone`)) break; await sleep(400); }
  await sleep(800);
  await shot("icu-dashboard-after-bridge");

  const trends = await ev(`(window.ICU && ICU.state) ? (ICU.state().labs.trends || []).length : -1`);
  console.log("ICU Trends points for this patient:", trends);
  ok(trends === 6, "6 distinct dated trend points (one per day), not fewer");

  console.log("done. screenshots in", OUT, process.exitCode ? "— SOME CHECKS FAILED, see above" : "— all checks passed");
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
