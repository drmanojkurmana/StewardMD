import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || "/Users/diwakarkumar/.gemini/antigravity-cli/brain/f5ad1f2a-70cf-4ffc-90cb-89f42a02763c";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8925/").replace(/\/?$/, "/");
const PORT = 9475;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8925"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/smd-shot-iphone-clean3`, "--no-first-run", "--disable-gpu", "--mute-audio",
  "--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const res = await call("Runtime.evaluate", {
    expression: `(function(){ try { ${e} } catch(x){ return { __err: String(x && x.message || x) }; } })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return res && res.result && res.result.result ? res.result.result.value : null;
};

async function shot(filename) {
  await sleep(600);
  const r = await call("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, filename);
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  console.log("📸 Shot saved: " + file);
  return file;
}

try {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
      wsUrl = v.webSocketDebuggerUrl; if (wsUrl) break;
    } catch {}
    await sleep(200);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable"); await call("Runtime.enable");

  // Emulate iPhone 15 Pro (393 x 852, 2x scale, touch/mobile)
  await call("Emulation.setDeviceMetricsOverride", {
    width: 393,
    height: 852,
    deviceScaleFactor: 2,
    mobile: true
  });
  await call("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
  });

  await call("Page.navigate", { url: BASE });

  for (let i = 0; i < 60; i++) {
    const ok = await ev("return !!(window.SMD_openSettings && window.SMD_openExperimental);");
    if (ok === true) break;
    await sleep(300);
  }

  // Dismiss splash/intro overlays
  await ev(`
    var s = document.createElement("style");
    s.textContent = "#smdBootSplash,#introPoster,#splash,#accountGate,.ip-phase{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}";
    document.head.appendChild(s);
    ["smdBootSplash","introPoster","splash","accountGate","introOverlay"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    // Set user as signed in for XACCESS modal demo
    window.SMD_AUTH = window.SMD_AUTH || {};
    window.SMD_AUTH.currentUser = { email: "doctor@stewardmd.in", uid: "demo-doc-123" };
    return true;
  `);
  await sleep(400);

  // 1. Sidebar Menu open
  await ev(`
    if (window.SB && SB.open) SB.open();
    var m = document.getElementById("sbMenu");
    if (m) m.classList.add("open");
    return true;
  `);
  await sleep(600);
  await shot("iphone-01-sidebar-menu.png");

  // 2. Settings screen (scrolled to Advanced)
  await ev(`
    if (window.SB && SB.close) SB.close();
    window.SMD_openSettings();
    var set = document.getElementById("sbrSettings");
    if (set) set.scrollTop = 240;
    return true;
  `);
  await sleep(600);
  await shot("iphone-02-settings-screen.png");

  // 2b. Settings screen (scrolled to Experimental section)
  await ev(`
    var set = document.getElementById("sbrSettings");
    if (set) set.scrollTop = set.scrollHeight;
    return true;
  `);
  await sleep(600);
  await shot("iphone-02b-settings-experimental.png");

  // 3. Experimental screen (top: Beta Callout Banner + Private Beta Access Codes)
  await ev(`
    var btn = document.querySelector('[data-sbr-act="experimental"]');
    if (btn) btn.click();
    else window.SMD_openExperimental();
    var exp = document.getElementById("sbrExperimental");
    if (exp) exp.scrollTop = 0;
    return true;
  `);
  await sleep(600);
  await shot("iphone-03-experimental-top.png");

  // 4. Experimental screen (scrolled down: AI Diagnostic Modules & Clinical Intelligence toggles)
  await ev(`
    var exp = document.getElementById("sbrExperimental");
    if (exp) exp.scrollTop = 420;
    return true;
  `);
  await sleep(600);
  await shot("iphone-04-experimental-toggles.png");

  // 5. Open FundX AI Access Code Gate Modal inside Experimental
  await ev(`
    var exp = document.getElementById("sbrExperimental");
    if (exp) exp.scrollTop = 0;
    var btn = exp ? exp.querySelector('[data-xa-open="fundx"]') : null;
    if (btn) btn.click();
    return true;
  `);
  await sleep(700);
  await shot("iphone-05-fundx-access-modal.png");

  console.log("All iPhone screenshots captured successfully!");
} catch (e) {
  console.error("Shot capture failed:", e);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  if (serveProc) serveProc.kill();
}
