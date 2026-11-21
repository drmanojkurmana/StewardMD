/* Screenshots of SURGX screens at a given viewport, light and dark (iPad layout checks).
 * USAGE: W=820 H=1180 SHOTS=<dir> node test/shot-surgx.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8928/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || join(process.env.CLAUDE_JOB_DIR || "/tmp", "surgx-shots");
const W = +process.env.W || 820, H = +process.env.H || 1180;
const PORT = 9465, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/surgx-shot-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROUTES = (process.env.ROUTES || ",protocols,protocol/acute-pancreatitis,procedures,procedure/abscess-drainage,cases,notes").split(",");
mkdirSync(SHOTS, { recursive: true });
let serveProc = null;
try { await fetch(BASE); } catch { serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8928"])[1]], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let id = 1, ws, sessionId; const pending = new Map();
const call = (m, p) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){${e}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot " + join(SHOTS, name + ".png")); };
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: true });
  for (const scheme of ["light", "dark"]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await call("Page.navigate", { url: BASE + "?surgx=1" });
    for (let i = 0; i < 90; i++) { await sleep(400); if ((await ev(`return !!(window.SURGX && document.getElementById("homeV2"))`)) === true) break; }
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
    for (const r of ROUTES) {
      await ev(`SURGX.open(${JSON.stringify(r)}); return 1;`); await sleep(1800);
      await shot(`${scheme}-${(r || "home").replace(/\//g, "_")}`);
    }
  }
} catch (e) { console.error("HARNESS ERROR:", e.message); }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(0); }
