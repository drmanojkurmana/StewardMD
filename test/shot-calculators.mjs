/* Phone screenshots of Calculators (list, search, open calculator with a result), light and dark.
 * USAGE: SHOTS=<dir> node test/shot-calculators.mjs   (needs Chrome; serves the repo like the other UI tests) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8927/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || join(process.env.CLAUDE_JOB_DIR || "/tmp", "calc-shots");
const PORT = 9464, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/calc-shot-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(SHOTS, { recursive: true });
let serveProc = null;
try { await fetch(BASE); } catch { serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8927"])[1]], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
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
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const scheme of ["light", "dark"]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await call("Page.navigate", { url: BASE });
    for (let i = 0; i < 90; i++) { await sleep(400); if ((await ev(`return !!(window.MEDCALC && MEDCALC.openList);`)) === true) break; }
    await sleep(800);
    await sleep(4000); await ev(`MEDCALC.openList(); return 1;`); await sleep(1500); await shot(`${scheme}-1-list`);
    await ev(`var si=document.getElementById("mcSearch"); si.value="sofa"; si.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(400); await shot(`${scheme}-2-search`);
    await ev(`MEDCALC.open("oakland_lgib"); return 1;`); await sleep(700); await shot(`${scheme}-3-calc`);
    await ev(`var set=function(sel,v){var e=document.querySelector(sel); if(!e) return; if(e.type==="checkbox"){e.checked=!!v;} else e.value=v; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true}));};
      ["age","hb","hr","sbp"].forEach(function(k,i){ var el=document.querySelector('[data-k="'+k+'"],#mc_oakland_lgib_'+k+',[name="'+k+'"]'); if(el){ el.value=[72,10,95,115][i]; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); } });
      return 1;`); await sleep(500);
    await ev(`var r=document.querySelector(".mc-result,.mc-res,[class*=result]"); if(r) r.scrollIntoView({block:"center"}); return 1;`); await sleep(300); await shot(`${scheme}-4-result`);
    await ev(`var s=document.getElementById("mc_oakland_lgib_sex"); if(s){ s.value="M"; s.dispatchEvent(new Event("input",{bubbles:true})); s.dispatchEvent(new Event("change",{bubbles:true})); } return 1;`); await sleep(400); await shot(`${scheme}-5-half`);
    await ev(`var b=document.getElementById("mcScoreBar_oakland_lgib"); if(b) b.click(); return 1;`); await sleep(400); await shot(`${scheme}-6-expanded`);
    await ev(`MEDCALC.open("saps2"); return 1;`); await sleep(600); await shot(`${scheme}-7-saps2`);
    await ev(`MEDCALC.open("chadsvasc"); return 1;`); await sleep(600); await shot(`${scheme}-8-chads`);
    await ev(`var back=document.getElementById("mcCvBack"); if(back) back.click(); var si2=document.getElementById("mcSearch"); if(si2){ si2.value="zzzznomatch"; si2.dispatchEvent(new Event("input",{bubbles:true})); } return 1;`); await sleep(400); await shot(`${scheme}-9-empty`);
    await ev(`var si3=document.getElementById("mcSearch"); if(si3){ si3.value=""; si3.dispatchEvent(new Event("input",{bubbles:true})); } var body=document.getElementById("mcBody"); if(body) body.scrollTop=900; return 1;`); await sleep(400); await shot(`${scheme}-10-scrolled`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 90; i++) { await sleep(400); if ((await ev(`return !!(window.MEDCALC && MEDCALC.openList);`)) === true) break; }
  await ev(`MEDCALC.open("oakland_lgib"); return 1;`); await sleep(700); await shot(`narrow-320-calc`);
} catch (e) { console.error("HARNESS ERROR:", e.message); }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(0); }
