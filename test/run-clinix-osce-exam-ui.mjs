/* test/run-clinix-osce-exam-ui.mjs — CliniX OSCE exam headless browser test (CDP).
 *
 * Modelled on test/run-clinix-ui.mjs.
 *
 * Exercises:
 * 1. Open CliniX, navigate to OSCE picker, open an OSCE station.
 * 2. Verify station intro card, press Start, verify running clock starts on Start.
 * 3. Answer every step (picking correct option via data attributes), complete Arrange check.
 * 4. Reach result, assert "Pass".
 * 5. Second run: pick a wrong option on a critical step, reach result, assert "Fail on a critical step".
 * 6. Capture screenshots at 390x844 and 820x1180 into work/shots/.
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, "work", "shots");
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9389;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/clinix-exam-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
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
  return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); });
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
  console.log((cond ? "PASS" : "FAIL") + " " + msg);
  if (!cond) fails++;
};

async function setViewport(width, height) {
  await call("Emulation.setDeviceMetricsOverride", {
    width: width,
    height: height,
    deviceScaleFactor: 2,
    mobile: width < 600
  });
  await sleep(150);
}

async function captureShot(filename, width, height) {
  await setViewport(width, height);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r && r.result && r.result.data) {
    const p = join(SHOTS, filename);
    writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("  saved screenshot: " + p);
  }
}

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    const ready = await ev("!!(window.SMD_CLINIX_FLAGS && window.CLINIX)");
    if (ready) break;
    await sleep(400);
  }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(300);
}

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try {
      wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
      break;
    } catch { await sleep(300); }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a debugger. Set CHROME to a chromium binary.");

  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  async function openCx() {
    await ev("window.CLINIX.open()");
    for (let i = 0; i < 80; i++) {
      if (await ev("!!(window.SMD_CLINIX_SCREENS && document.querySelector('#clinixRoot .cx-head'))")) return true;
      await sleep(100);
    }
    return false;
  }

  console.log("\n--- CliniX OSCE Exam UI Harness ---");
  await attach(BASE + "?clinix=1");
  await openCx();
  await sleep(500);

  // Set default phone viewport
  await setViewport(390, 844);

  // Navigate to OSCE stations picker
  console.log("Navigating to OSCE stations picker...");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-practice-osce\"]').click()");
  await sleep(500);

  // Pick Respiratory topic
  console.log("Opening Respiratory topic...");
  await ev("[...document.querySelectorAll('#clinixRoot [data-act=\"cx-practice-open\"]')].find(b => /respiratory|copd/i.test(b.textContent)).click()");
  await sleep(500);

  // Open first station
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-station\"]')")) break;
    await sleep(200);
  }
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-station\"]').click()");
  await sleep(500);

  // Verify Station Intro card
  ok((await ev("!!document.querySelector('#clinixRoot .cx-station-intro')")) === true, "Station intro card renders before exam starts");
  ok((await ev("!document.querySelector('#clinixRoot .cx-timer')")) === true, "Clock is NOT running on intro before Start");
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-station-start\"]')")) === true, "Start button is visible on intro card");

  // Capture Intro screenshots at 390x844 and 820x1180
  await captureShot("clinix-osce-intro-390.png", 390, 844);
  await captureShot("clinix-osce-intro-820.png", 820, 1180);
  await setViewport(390, 844);

  /* ── 1. Pass Run: Answer correctly and complete Arrange check ──────────── */
  console.log("\n--- Test 1: Full Pass Run ---");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-station-start\"]').click()");
  await sleep(400);

  ok((await ev("!!document.querySelector('#clinixRoot .cx-timer')")) === true, "Clock starts running immediately after Start");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-exam-opt').length")) === 5, "What do you do next question has exactly 5 options");

  // Step screenshot
  await captureShot("clinix-osce-step-390.png", 390, 844);
  await setViewport(390, 844);

  // Answer loop: answer each step with correct option
  let stepsAnswered = 0;
  for (let iter = 0; iter < 130; iter++) {
    // Check if result screen reached
    if (await ev("!!document.querySelector('#clinixRoot .cx-result')")) break;

    // Check if in step mode with question options
    const hasOptions = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"true\"]')");
    if (hasOptions) {
      await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"true\"]').click()");
      stepsAnswered++;
      await sleep(120);
      continue;
    }

    // Check if feedback continue button is present
    const hasNext = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-exam-next\"]')");
    if (hasNext) {
      await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-next\"]').click()");
      await sleep(120);
      continue;
    }

    // Check if Arrange check is present
    const hasArrange = await ev("!!document.querySelector('#clinixRoot .cx-arrange-card')");
    if (hasArrange) {
      const hasArrNext = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-next\"]')");
      if (hasArrNext) {
        await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-next\"]').click()");
        await sleep(120);
        continue;
      }

      const hasConfirm = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-confirm\"]')");
      if (hasConfirm) {
        // Tap all available steps from pool to placed
        for (let ap = 0; ap < 15; ap++) {
          const canPlace = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-place\"]')");
          if (!canPlace) break;
          await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-place\"]').click()");
          await sleep(50);
        }
        await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-confirm\"]').click()");
        await sleep(150);
        continue;
      }
    }

    await sleep(150);
  }

  // Verify Result Screen
  ok((await ev("!!document.querySelector('#clinixRoot .cx-result')")) === true, "Station reaches result screen");
  const verdictText = await ev("document.querySelector('#clinixRoot .cx-result-v').textContent");
  ok(/Pass/i.test(verdictText), `All-correct run achieves Pass verdict (got: ${verdictText})`);

  // Capture Pass Result screenshots
  await captureShot("clinix-osce-pass-390.png", 390, 844);
  await captureShot("clinix-osce-pass-820.png", 820, 1180);
  await setViewport(390, 844);

  /* ── 2. Fail Run: Pick wrong option on a critical step ─────────────────── */
  console.log("\n--- Test 2: Fail on Critical Step Run ---");
  // Retry station
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-station-retry\"]').click()");
  await sleep(400);

  // Intro -> Start
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-station-start\"]').click()");
  await sleep(400);

  // Pick incorrect option on first step (hygiene is critical)
  const wrongOpt = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"false\"]')");
  ok(wrongOpt, "Wrong options are available to pick");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"false\"]').click()");
  await sleep(200);

  // Verify mark lost feedback appeared
  ok((await ev("!!document.querySelector('#clinixRoot .cx-exam-feedback')")) === true, "Immediate feedback explains why pick was incorrect");

  // Continue to next step
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-next\"]').click()");
  await sleep(200);

  // Complete the remaining steps correctly
  for (let iter = 0; iter < 130; iter++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-result')")) break;

    const hasOptions = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"true\"]')");
    if (hasOptions) {
      await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-pick\"][data-correct=\"true\"]').click()");
      await sleep(120);
      continue;
    }

    const hasNext = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-exam-next\"]')");
    if (hasNext) {
      await ev("document.querySelector('#clinixRoot [data-act=\"cx-exam-next\"]').click()");
      await sleep(120);
      continue;
    }

    const hasArrange = await ev("!!document.querySelector('#clinixRoot .cx-arrange-card')");
    if (hasArrange) {
      const hasArrNext = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-next\"]')");
      if (hasArrNext) {
        await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-next\"]').click()");
        await sleep(120);
        continue;
      }

      const hasConfirm = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-confirm\"]')");
      if (hasConfirm) {
        for (let ap = 0; ap < 15; ap++) {
          const canPlace = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-arrange-place\"]')");
          if (!canPlace) break;
          await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-place\"]').click()");
          await sleep(50);
        }
        await ev("document.querySelector('#clinixRoot [data-act=\"cx-arrange-confirm\"]').click()");
        await sleep(150);
        continue;
      }
    }

    await sleep(150);
  }

  // Result screen verification for failed critical step
  ok((await ev("!!document.querySelector('#clinixRoot .cx-result')")) === true, "Station finishes and shows result screen");
  const failVerdict = await ev("document.querySelector('#clinixRoot .cx-result-v').textContent");
  ok(/Fail on a critical step/i.test(failVerdict), `Wrong critical pick fails on critical step (got: ${failVerdict})`);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-notice--crit')")) === true, "Critical steps missed alert banner is rendered");
  ok((await ev("!!document.querySelector('#clinixRoot .cx-review-card')")) === true, "Review missed steps section is rendered with your pick vs correct");

  // Capture Fail Result screenshots
  await captureShot("clinix-osce-fail-critical-390.png", 390, 844);
  await captureShot("clinix-osce-fail-critical-820.png", 820, 1180);

  console.log("\nHeadless browser UI tests complete. Fails: " + fails);
} catch (err) {
  console.error("Browser UI test error:", err);
  fails++;
} finally {
  try { if (ws) ws.close(); } catch {}
  try { if (chrome) chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
