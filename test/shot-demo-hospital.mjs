/* test/shot-demo-hospital.mjs — prove the Test Hospital demo actually works, from the
 * REAL app: open Ward Sync, load the demo, browse Nephrology, bridge a patient into
 * ICU, show its labs. Not a test: a demo tool. Same CDP harness as shot-clinix.mjs.
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

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/demo-hospital-shot`, "--no-first-run", "--disable-gpu", "--mute-audio",
  "--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => (await call("Runtime.evaluate", { expression: `(() => { try { return (${e}); } catch (x) { return { __err: String(x) }; } })()`, returnByValue: true, awaitPromise: true }))?.result?.result?.value;

let n = 0;
async function shot(name) {
  await sleep(600);
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
  await call("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) { if (await ev("!!(window.GHIS && window.ghisLoadDemoHospital && window.SMD_TEST_HOSPITAL && window.ICU && ICU.ingestWardHistory)")) break; await sleep(400); }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(400);
}

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); wsUrl = r.webSocketDebuggerUrl; break; } catch { await sleep(200); } }
  ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  await attach(BASE);
  console.log("app loaded, opening Ward Sync setup screen...");
  await ev(`window.openGHIS(); window.showGhisScreen('setup'); true`);
  await shot("ward-sync-setup-with-demo-button");

  console.log("tapping 'Load Demo: Test Hospital'...");
  await ev(`window.ghisLoadDemoHospital(); true`);
  await sleep(1200);
  const count = await ev(`(document.getElementById('ghisCount') || {}).textContent || ''`);
  console.log("patient count line:", count);
  await shot("ward-sync-25-demo-patients");

  console.log("filtering to Nephrology...");
  await ev(`(function(){ var sel = document.getElementById('ghisFBranch'); if(!sel) return false; sel.value = 'Nephrology'; sel.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(400);
  await shot("ward-sync-nephrology-branch");

  console.log("opening the severe-CKD patient's lab drawer...");
  const patientsBefore = await ev(`window.SMD_TEST_HOSPITAL.branches.find(b=>b.dept==='Nephrology').patients.map(p=>({id:p.patientId,name:p.name}))`);
  console.log("nephrology patients:", JSON.stringify(patientsBefore));
  const severeId = await ev(`window.SMD_TEST_HOSPITAL.branches.find(b=>b.dept==='Nephrology').patients.find(p=>p.name==='Chandrasekhar Rao').patientId`);
  const severeEp = await ev(`window.SMD_TEST_HOSPITAL.branches.find(b=>b.dept==='Nephrology').patients.find(p=>p.name==='Chandrasekhar Rao').episodeId`);
  await ev(`GHIS.openLab('${severeEp}', '${severeId}', 'Chandrasekhar Rao'); true`);
  await sleep(1200);
  await shot("severe-ckd-patient-labs");

  console.log("--- DIAGNOSTIC: wrapping ICU.ingestWardHistory to see the real input bundle ---");
  const wrapResult = await ev(`(function () {
    window.__bundles = [];
    var _orig = ICU.ingestWardHistory;
    ICU.ingestWardHistory = function (bundle) {
      window.__bundles.push(JSON.parse(JSON.stringify(bundle)));
      return _orig(bundle);
    };
    return true;
  })()`);
  console.log("wrap installed:", wrapResult);

  const preChecks = await ev(`JSON.stringify({ hasICU: !!window.ICU, hasIngestFromWard: !!(window.ICU && ICU.ingestFromWard), hasLoadIntoICU: !!(window.GHIS && GHIS.loadIntoICU), demoActive: null })`);
  console.log("pre-bridge checks:", preChecks);

  console.log("bridging this patient into the ICU dashboard...");
  const bridgeCallResult = await ev(`(function(){ try { window.__bridgeDone = false; GHIS.loadIntoICU('${severeId}', function(){ window.__bridgeDone = true; }); return "called, no sync throw"; } catch (e) { return "SYNC THROW: " + e.message; } })()`);
  console.log("loadIntoICU call result:", bridgeCallResult);
  for (let i = 0; i < 30; i++) { if (await ev(`!!window.__bridgeDone`)) break; await sleep(400); }
  await sleep(1000);
  await shot("icu-dashboard-after-bridge");

  const bundleCount = await ev(`window.__bundles.length`);
  console.log("ingestWardHistory was called", bundleCount, "time(s)");
  for (let i = 0; i < bundleCount; i++) {
    const labCount = await ev(`window.__bundles[${i}].labs ? window.__bundles[${i}].labs.length : 0`);
    const sample = await ev(`JSON.stringify((window.__bundles[${i}].labs||[]).slice(0,3))`);
    console.log(`  call ${i}: ${labCount} lab rows, patientId=${await ev(`window.__bundles[${i}].patientId`)}, sample:`, sample);
  }

  const recentFull = await ev(`(window.ICU && ICU.state && ICU.state().labs && ICU.state().labs.recent) ? JSON.stringify(ICU.state().labs.recent) : null`);
  console.log("full ICU_STATE.labs.recent:", recentFull);
  const trendsFull = await ev(`(window.ICU && ICU.state && ICU.state().labs && ICU.state().labs.trends) ? JSON.stringify(ICU.state().labs.trends) : null`);
  console.log("full ICU_STATE.labs.trends:", trendsFull);
  const demoFetchLog = await ev(`JSON.stringify(window.__demoFetchLog || [])`);
  console.log("demoFetch call log:", demoFetchLog);

  console.log("done. screenshots in", OUT);
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
