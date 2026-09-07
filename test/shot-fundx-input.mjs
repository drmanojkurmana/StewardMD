import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = "/Users/diwakarkumar/.gemini/antigravity-cli/brain/f5ad1f2a-70cf-4ffc-90cb-89f42a02763c";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8925/").replace(/\/?$/, "/");
const PORT = 9480;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/smd-shot-fundx-code`, "--no-first-run", "--disable-gpu", "--mute-audio",
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

  await call("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)" });

  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) {
    if (await ev("return !!(window.SMD_openExperimental && window.SMD_XACCESS);") === true) break;
    await sleep(300);
  }

  await ev(`
    var s = document.createElement("style");
    s.textContent = "#smdBootSplash,#introPoster,#splash,#accountGate{display:none!important}";
    document.head.appendChild(s);
    window.SMD_AUTH = { currentUser: { uid: "tester-123", email: "dr.manoj@stewardmd.in" } };
    window.SMD_openExperimental();
    var exp = document.getElementById("sbrExperimental");
    if (exp) exp.scrollTop = 0;
    setTimeout(function() {
      if (window.SMD_XACCESS && SMD_XACCESS.openGate) SMD_XACCESS.openGate("fundx");
    }, 100);
    return true;
  `);
  await sleep(700);

  const r = await call("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, "iphone-06-fundx-code-input.png");
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  console.log("📸 Shot saved: " + file);
} catch (e) {
  console.error("Shot failed:", e);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
