/* Display font-scale / Dynamic Type test (CR5 / UX#11).
 *
 * The in-app font size is applied as a root CSS `zoom` (layout-safe: the page reflows/scrolls). This
 * verifies (a) the cap was raised from 125% to 200% for low vision, (b) old values still work, (c) the
 * Display sheet slider + Accessibility-XL preset, and (d) the OS Dynamic Type seed: on first launch, with
 * no saved in-app prefs, the app font scale is seeded from the native OS text scale (stubbed here via a
 * Capacitor TextZoom plugin, since headless has no real OS Dynamic Type). USAGE: node test/run-display-scale.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8933/").replace(/\/?$/, "/");
const PORT = 9383, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/display-scale-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8933"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const waitApp = async () => { for (let i = 0; i < 80; i++) { await sleep(200); if (await ev(`return typeof window.SMD_openDisplay==="function" && document.documentElement.style.zoom!=="";`) === true) return true; } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const setPrefs = async (fs) => ev(`localStorage.setItem("smd_display_v1", JSON.stringify({fontScale:${fs},density:"large",autoFit:false,theme:"classic",font:"plex",headingStyle:"default",appearance:"standard"})); return 1;`);
const reload = async () => { await call("Page.navigate", { url: BASE }); await waitApp(); await sleep(200); };
const zoom = async () => ev(`return String(document.documentElement.style.zoom||"");`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE });
  if (!(await waitApp())) throw new Error("app not loaded");

  // (a) cap raised to 200%
  await setPrefs(2); await reload();
  ok((await zoom()) === "2", "font scale 200% applies as root zoom 2 (cap raised from the old 1.25)");
  // (b) values above the cap clamp to 200%, not the old 125%
  await setPrefs(3); await reload();
  ok((await zoom()) === "2", "a value above the cap clamps to 2 (200%), not the old 1.25");
  // (c) existing values still work (backward compatible)
  await setPrefs(1.25); await reload();
  ok((await zoom()) === "1.25", "the old 125% value still applies unchanged");

  // (d) Display sheet: slider reaches 200 + the Accessibility-XL preset exists
  await ev(`window.SMD_openDisplay(); return 1;`); await sleep(300);
  ok(await ev(`var e=document.getElementById("hvFs"); return e && e.max==="200";`) === true, "Display sheet font-size slider reaches 200%");
  ok(await ev(`return !!Array.prototype.slice.call(document.querySelectorAll('#hvPre button')).find(function(b){return /Accessibility/i.test(b.textContent);});`) === true, "an 'Accessibility XL' quick preset is offered");

  // (e) OS Dynamic Type seed: no saved prefs + a native OS text scale of 1.5 -> app seeds to zoom 1.5
  await ev(`try{localStorage.removeItem("smd_display_v1");}catch(e){} return 1;`);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.Capacitor = { isNativePlatform:function(){return true;}, Plugins:{ TextZoom:{ getPreferred:function(){ return Promise.resolve({ value: 1.5 }); } } } };` });
  await call("Page.navigate", { url: BASE }); await waitApp(); await sleep(500);
  ok((await zoom()) === "1.5", "first launch with no in-app prefs seeds the app font scale from the OS text size (1.5)");

  console.log(fails === 0 ? "\nALL GREEN — display font-scale / Dynamic Type test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
