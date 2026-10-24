/* test/run-clinix-practicals-ui.mjs - Real-browser UI runner for CliniX Practicals screen (CDP).
 * Modelled on test/run-clinix-ui.mjs.
 * Drives the real app: real index.html, real script load order, real practicals JSON fetched over HTTP.
 * Actions tested:
 *   1. Open CliniX
 *   2. Open Obstetrics and gynaecology system screen -> verify Practicals tile
 *   3. Open Practicals -> verify subject decks
 *   4. Open instruments deck -> verify item list, chips, filter
 *   5. Open an item -> assert image/placeholder, blocks, viva render and tap-to-reveal
 *   6. Run a spotter quiz (10 questions) to completion -> assert scoring and review
 *   7. Open Paediatrics subject -> open development deck
 *   8. Capture screenshots at 390x844 (phone) and 820x1180 (iPad) into work/shots/
 * Run: node test/run-clinix-practicals-ui.mjs
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, "work/shots");
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const PORT = 9389;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/clinix-practicals-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE); return; } catch { await sleep(200); }
  }
}
await ensureServer();

try { rmSync(userDir, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--no-sandbox"
], { stdio: "ignore" });

let msgId = 1;
const pending = new Map();
let ws, sessionId;

const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => {
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }));
  });
};

const ev = async (expr) => {
  const r = await call("Runtime.evaluate", {
    expression: `(() => { try { return (${expr}); } catch (e) { return { __err: String(e) }; } })()`,
    returnByValue: true, awaitPromise: true
  });
  return r?.result?.result?.value;
};

let fails = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  OK: " : "FAIL: ") + msg);
  if (!cond) fails++;
};

async function setViewport(w, h, isMobile = true) {
  await call("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: isMobile
  });
  await sleep(150);
}

async function takeShot(filename) {
  await sleep(200);
  const r = await call("Page.captureScreenshot", { format: "png" });
  const data = r?.result?.data;
  if (data) {
    const dest = join(SHOTS, filename);
    writeFileSync(dest, Buffer.from(data, "base64"));
    console.log("  📸 Saved screenshot:", filename);
  }
}

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.SMD_PRO = { isProSync: function () { return true; }, proState: function () { return { pro: true }; } };
      window.__isPro = true;
      document.addEventListener("DOMContentLoaded", function () {
        if (document.body) document.body.classList.add("pro-verified");
      });
    `
  });
  await call("Page.navigate", { url });

  for (let i = 0; i < 80; i++) {
    const ready = await ev("!!(window.SMD_CLINIX_FLAGS && window.CLINIX)");
    if (ready) break;
    await sleep(300);
  }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); if (document.body) document.body.classList.add("pro-verified"); true`);
  await sleep(200);
}

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try {
      wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a debugger port " + PORT);

  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  console.log("=== Running CliniX Practicals UI Harness ===");

  // 1. Phone Viewport Setup (390 x 844)
  await setViewport(390, 844, true);
  await attach(BASE + "?clinix=1");

  // 2. Open CliniX
  console.log("\n--- 1. Open CliniX ---");
  await ev("window.CLINIX.open()");
  for (let i = 0; i < 60; i++) {
    const mounted = await ev("!!(window.SMD_CLINIX_SCREENS && document.querySelector('#clinixRoot .cx-head'))");
    if (mounted) break;
    await sleep(150);
  }
  ok(await ev("document.getElementById('clinixRoot').classList.contains('cx-open')"), "CliniX root is open");
  await takeShot("01-clinix-home-phone.png");

  // 3. Open Obstetrics and Gynaecology System
  console.log("\n--- 2. Open Obstetrics and Gynaecology System ---");
  await ev(`document.querySelector('[data-act="cx-system"][data-id="obgyn"]').click()`);
  await sleep(400);

  const sysTitle = await ev(`document.querySelector('#clinixRoot .cx-head-title')?.textContent`);
  ok(sysTitle && sysTitle.includes("Obstetrics"), "Opened Obstetrics and gynaecology system: " + sysTitle);

  // Check Practicals tile on system screen
  const hasPracTile = await ev(`!!document.querySelector('[data-act="cx-practicals-system"]')`);
  ok(hasPracTile, "Practicals row/tile exists on O&G system screen");
  await takeShot("02-obgyn-system-phone.png");

  // 4. Open Practicals from System Screen
  console.log("\n--- 3. Open Practicals Decks ---");
  await ev(`document.querySelector('[data-act="cx-practicals-system"]').click()`);
  for (let i = 0; i < 40; i++) {
    const deckCount = await ev(`document.querySelectorAll('.cx-row--prac-deck').length`);
    if (deckCount > 0) break;
    await sleep(150);
  }

  const obgynDeckCount = await ev(`document.querySelectorAll('.cx-row--prac-deck').length`);
  ok(obgynDeckCount >= 8, `O&G Practicals decks rendered (count: ${obgynDeckCount})`);
  await takeShot("03-obgyn-practicals-decks-phone.png");

  // 5. Open Instruments Deck
  console.log("\n--- 4. Open Instruments Deck ---");
  await ev(`document.querySelector('[data-act="cx-prac-open-deck"][data-file="practicals/obgyn/instruments.json"]').click()`);
  for (let i = 0; i < 40; i++) {
    const itemsCount = await ev(`document.querySelectorAll('.cx-row--prac-item').length`);
    if (itemsCount > 0) break;
    await sleep(150);
  }

  const instrItemCount = await ev(`document.querySelectorAll('.cx-row--prac-item').length`);
  ok(instrItemCount >= 80, `Instruments deck browse view loaded (${instrItemCount} items)`);
  await takeShot("04-instruments-browse-phone.png");

  // 6. Open an Item Detail View (Sims speculum)
  console.log("\n--- 5. Open Item Detail View ---");
  await ev(`document.querySelector('.cx-row--prac-item').click()`);
  await sleep(400);

  const detailTitle = await ev(`document.querySelector('.cx-prac-item-title')?.textContent`);
  ok(detailTitle && detailTitle.length > 0, "Item detail title rendered: " + detailTitle);

  const hasPlaceholderOrImg = await ev(`!!document.querySelector('.cx-prac-img-stage, .cx-prac-placeholder')`);
  ok(hasPlaceholderOrImg, "Item image or quiet placeholder rendered without broken image");

  const hasBullets = await ev(`document.querySelectorAll('.cx-prac-bullets li').length > 0`);
  ok(hasBullets, "Item blocks rendered structured bullet points");

  const vivaCount = await ev(`document.querySelectorAll('.cx-prac-viva-pair').length`);
  ok(vivaCount >= 2, `Item has ${vivaCount} viva questions`);

  // Reveal a viva answer
  await ev(`document.querySelector('[data-act="cx-prac-toggle-viva"]').click()`);
  await sleep(200);
  const vivaRevealed = await ev(`document.querySelector('.cx-prac-viva-a').style.display !== 'none'`);
  ok(vivaRevealed, "Viva model answer reveals on tap");
  await takeShot("05-instrument-detail-phone.png");

  // 7. Spotter Quiz
  console.log("\n--- 6. Run Spotter Quiz (10 Questions) ---");
  await ev(`document.querySelector('[data-act="cx-prac-set-mode"][data-id="quiz"]').click()`);
  await sleep(300);
  await takeShot("06-quiz-start-phone.png");

  await ev(`document.querySelector('.cx-prac-start-btn').click()`);
  await sleep(300);

  for (let q = 0; q < 10; q++) {
    const optCount = await ev(`document.querySelectorAll('.cx-prac-opt-btn').length`);
    ok(optCount === 5, `Question ${q + 1}: exactly 5 options present`);

    // Click first option
    await ev(`document.querySelectorAll('.cx-prac-opt-btn')[0].click()`);
    await sleep(150);

    const hasFeedback = await ev(`!!document.querySelector('.cx-prac-feedback-banner')`);
    ok(hasFeedback, `Question ${q + 1}: immediate recognition feedback displayed`);

    // If follow-up viva present, reveal and self-grade
    const hasVivaReveal = await ev(`!!document.querySelector('[data-act="cx-prac-quiz-viva-reveal"]')`);
    if (hasVivaReveal) {
      await ev(`document.querySelector('[data-act="cx-prac-quiz-viva-reveal"]').click()`);
      await sleep(100);
      await ev(`document.querySelector('[data-act="cx-prac-quiz-viva-grade"][data-g="got"]')?.click()`);
    }

    // Next question
    await ev(`document.querySelector('[data-act="cx-prac-quiz-next"]').click()`);
    await sleep(250);
  }

  // Quiz Results
  const scoreTxt = await ev(`document.querySelector('.cx-prac-results-score')?.textContent`);
  ok(scoreTxt && scoreTxt.includes("/"), "Quiz completed and final score rendered: " + scoreTxt);
  const reviewCount = await ev(`document.querySelectorAll('.cx-row--prac-review').length`);
  ok(reviewCount === 10, "Review list contains all 10 questions");
  await takeShot("07-quiz-results-phone.png");

  // 8. Subject Picker Navigation & Paediatrics Decks
  console.log("\n--- 7. Navigate to Subject Picker & Paediatrics Decks ---");
  await ev(`document.querySelector('[data-act="cx-prac-back-to-browse"]').click()`);
  await sleep(200);
  await ev(`document.querySelector('[data-act="cx-prac-back-to-decks"]').click()`);
  await sleep(200);
  await ev(`document.querySelector('[data-act="cx-prac-back-to-subjects"]').click()`);
  await sleep(300);

  const subPickerCount = await ev(`document.querySelectorAll('.cx-row--prac-sub').length`);
  ok(subPickerCount >= 2, "Subject picker lists practical subjects (O&G, Paediatrics)");
  await takeShot("08-subject-picker-phone.png");

  // Open Paediatrics
  await ev(`document.querySelector('[data-act="cx-prac-pick-subject"][data-id="paediatrics"]').click()`);
  await sleep(400);

  const paedsDeckCount = await ev(`document.querySelectorAll('.cx-row--prac-deck').length`);
  ok(paedsDeckCount >= 19, `Paediatrics practicals decks rendered (count: ${paedsDeckCount})`);

  // Open Paediatrics Development Deck
  await ev(`document.querySelector('[data-act="cx-prac-open-deck"][data-file="practicals/paediatrics/development.json"]').click()`);
  await sleep(400);

  const devCount = await ev(`document.querySelectorAll('.cx-row--prac-item').length`);
  ok(devCount >= 9, "Paediatrics development items loaded: " + devCount);

  // Open development item detail
  await ev(`document.querySelector('.cx-row--prac-item').click()`);
  await sleep(300);
  await takeShot("09-paediatrics-development-item-phone.png");

  // 9. iPad Viewport (820 x 1180)
  console.log("\n--- 8. iPad Viewport Verification (820 x 1180) ---");
  await setViewport(820, 1180, false);
  await sleep(300);
  await takeShot("10-paediatrics-item-ipad.png");

  // Open iPad Quiz
  await ev(`document.querySelector('[data-act="cx-prac-set-mode"][data-id="quiz"]').click()`);
  await sleep(200);
  await ev(`document.querySelector('.cx-prac-start-btn').click()`);
  await sleep(300);
  await takeShot("11-quiz-ipad.png");

} catch (err) {
  console.error("Harness error:", err);
  fails++;
} finally {
  console.log(`\n=== Practicals UI Harness Complete: ${fails === 0 ? "ALL PASS" : fails + " FAILS"} ===`);
  try { if (ws) ws.close(); } catch {}
  try { if (chrome) chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
