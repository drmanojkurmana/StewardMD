/* test/shot-clinix.mjs — capture CliniX screens from the REAL app at phone size.
 * Not a test: a demo tool. Same CDP harness as test/run-clinix-ui.mjs.
 *   CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/shot-clinix.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, "..", "shots");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9391;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/clinix-shot`, "--no-first-run", "--disable-gpu", "--mute-audio",
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
}

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable"); await call("Runtime.enable");
  // iPhone 14 Pro logical size, 2x for a crisp image.
  await call("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) { if (await ev("!!(window.SMD_CLINIX_FLAGS && window.CLINIX)")) break; await sleep(400); }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(400);
}
const click = (sel) => ev(`(function(){ var e = document.querySelector('${sel}'); if (e) e.click(); return !!e; })()`);
const clickText = (sel, txt) => ev(`(function(){ var b = [...document.querySelectorAll('${sel}')].find(x => x.textContent.indexOf('${txt}') >= 0); if (b) b.click(); return !!b; })()`);

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) { try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl; break; } catch { await sleep(300); } }
  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  console.log("capturing:");

  /* --- what a STUDENT sees today: the review gate --- */
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(900);
  await shot("home");
  await clickText("#clinixRoot .cx-sys", "Respiratory"); await sleep(500);
  await shot("system-respiratory");
  await click('#clinixRoot [data-act="cx-disease"]'); await sleep(1200);
  await shot("review-gate-student-view");

  /* --- author mode: the full thing --- */
  await attach(BASE + "?clinix=1&clinixdraft=1&clinixtutor=1");
  await ev("window.CLINIX.open()"); await sleep(900);
  await clickText("#clinixRoot .cx-sys", "Respiratory"); await sleep(500);
  await click('#clinixRoot [data-act="cx-disease"]'); await sleep(1200);
  await shot("copd-pathway");

  await clickText("#clinixRoot .cx-rail-btn", "Respiratory examination"); await sleep(500);
  await shot("chapter-skills");

  // Percussion lesson: the interactive diagram (a CLEARED, self-authored asset)
  await clickText('#clinixRoot [data-act="cx-lesson"]', "Percussion"); await sleep(600);
  await shot("lesson-diagram");
  await ev(`(function(){ var z = document.querySelectorAll('#clinixRoot [data-act="cx-dia-zone"]')[4]; z.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(400); await shot("lesson-diagram-tapped");

  // Walk to the ask turn, then answer it
  for (let i = 0; i < 6; i++) { if (await ev(`!!document.querySelector('#clinixRoot .cx-turn--ask')`)) break; await click('#clinixRoot [data-act="cx-turn-next"]'); await sleep(250); }
  await shot("lesson-ask-before-tell");
  await ev(`(function(){ var t = document.getElementById('cxAnswer'); if (t) { t.value = 'side to side comparing both sides'; } var b = document.querySelector('#clinixRoot [data-act="cx-answer-text"]'); if (b) b.click(); return true; })()`);
  await sleep(500); await shot("lesson-feedback");

  // Reveal turn
  for (let i = 0; i < 8; i++) { if (await ev(`!!document.querySelector('#clinixRoot .cx-turn--reveal')`)) break; await click('#clinixRoot [data-act="cx-turn-next"]'); await sleep(250); }
  await shot("lesson-reveal-hidden");
  await click('#clinixRoot [data-act="cx-reveal"]'); await sleep(400);
  await shot("lesson-reveal-shown");

  /* --- the case --- */
  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()"); await sleep(900);
  await clickText("#clinixRoot .cx-sys", "Respiratory"); await sleep(500);
  await click('#clinixRoot [data-act="cx-disease"]'); await sleep(1200);
  await click('#clinixRoot [data-act="cx-case"]'); await sleep(600);
  await shot("case-opening");
  for (const q of ["what brings you in", "do you smoke", "how far can you walk", "any ankle swelling"]) {
    await ev(`(function(){ document.getElementById('cxCaseQ').value = '${q}'; document.querySelector('#clinixRoot [data-act="cx-case-ask"]').click(); return true; })()`);
    await sleep(350);
  }
  await shot("case-history");
  await click('#clinixRoot [data-act="cx-case-next"]'); await sleep(400);
  await ev(`(function(){ var b = document.querySelectorAll('#clinixRoot [data-act="cx-case-exam"]'); [0,1,5].forEach(i => b[i] && b[i].click()); return true; })()`);
  await sleep(500); await shot("case-examination");
  await click('#clinixRoot [data-act="cx-case-next"]'); await sleep(400);
  await ev(`(function(){ var b = document.querySelectorAll('#clinixRoot [data-act="cx-case-ix"]'); b[0] && b[0].click(); b[7] && b[7].click(); return true; })()`);
  await sleep(500); await shot("case-investigations");
  await click('#clinixRoot [data-act="cx-case-next"]'); await sleep(400);   // investigations -> differential
  for (const txt of ["COPD, heart failure, pneumonia", "COPD with infective exacerbation", "controlled oxygen 88 to 92, bronchodilators, steroid, antibiotic"]) {
    await ev(`(function(){ var t = document.getElementById('cxCaseText'); if (t) t.value = '${txt}'; document.querySelector('#clinixRoot [data-act="cx-case-next"]').click(); return true; })()`);
    await sleep(400);
  }
  await sleep(500); await shot("case-result");

  /* --- OSCE: fail on a missed critical step --- */
  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()"); await sleep(900);
  await clickText("#clinixRoot .cx-sys", "Respiratory"); await sleep(500);
  await click('#clinixRoot [data-act="cx-disease"]'); await sleep(1200);
  await click('#clinixRoot [data-act="cx-station"]'); await sleep(600);
  await shot("osce-station");
  await ev(`(function(){ document.querySelectorAll('#clinixRoot [data-act="cx-station-check"]').forEach(function(b){ if (b.getAttribute('data-id').indexOf('consent') < 0) b.click(); }); return true; })()`);
  await sleep(400);
  await click('#clinixRoot [data-act="cx-station-finish"]'); await sleep(600);
  await shot("osce-critical-fail");

  console.log("\ndone: " + n + " screens");
} catch (e) { console.error("error:", e); }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(0); }
