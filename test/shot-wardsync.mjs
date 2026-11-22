/* Ward Sync screenshots on the built-in demo hospital: hospital picker, patient list, an opened patient.
 * USAGE: W=390 H=844 SHOTS=<dir> node test/shot-wardsync.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8930/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || join(process.env.CLAUDE_JOB_DIR || "/tmp", "ward-shots");
const W = +process.env.W || 390, H = +process.env.H || 844, DPR = W > 700 ? 1 : 2;
const PORT = 9467, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-shot-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(SHOTS, { recursive: true });
let serveProc = null;
try { await fetch(BASE); } catch { serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8930"])[1]], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let id = 1, ws, sessionId; const pending = new Map();
const call = (m, p) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){${e}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(`return !!(${e})`)) === true) return true; await sleep(250); } return false; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot " + join(SHOTS, name + ".png")); };
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  for (const scheme of (process.env.SCHEMES || "light,dark").split(",")) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await call("Page.navigate", { url: BASE });
    await until(`window.openGHIS && document.getElementById("homeV2")`, 40000);
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.clear();}catch(e){} return 1;`);
    await ev(`openGHIS(); return 1;`); await sleep(1500);
    await shot(`${scheme}-1-hospital`);
    // demo hospital via its own button
    await ev(`var b=[].slice.call(document.querySelectorAll("#ghisPanel button")).filter(function(x){return /StewardMD Hospital/.test(x.textContent);})[0]; if(b) b.click(); return !!b;`);
    await until(`document.querySelectorAll("#ghisPatientList .ghis-pt-card").length > 3`, 15000); await sleep(800);
    await shot(`${scheme}-2-list`);
    await ev(`ghisToggleFilters(); var f=document.getElementById('ghisFFloor'); if(f){ f.value=f.options[1]?f.options[1].value:''; ghisApplyFilters(); } return 1;`); await sleep(500);
    await shot(`${scheme}-2b-filters`);
    await ev(`ghisClearFilters(); ghisToggleFilters(); return 1;`); await sleep(300);
    await ev(`var p=document.getElementById("ghisWard"); if(p) p.scrollTop=600; var l=document.querySelector("#ghisPanel .ghis-body[style*='block'], #ghisWard"); if(l) l.scrollTop=700; return 1;`); await sleep(300);
    await shot(`${scheme}-3-list-scrolled`);
    await ev(`var c=document.querySelector("#ghisPatientList .ghis-pt-card"); if(c) c.click(); return 1;`); await sleep(2500);
    await shot(`${scheme}-4-patient`);
  }
} catch (e) { console.error("HARNESS ERROR:", e.message); }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(0); }
