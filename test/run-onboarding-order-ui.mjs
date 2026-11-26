/* Onboarding order, in the real app bundle.
 *
 * Pins the profile sheet's new sequence: it does not open until the first screen is up, it opens
 * at most once per session, and localStorage smd_onb_legacy="1" restores the immediate old order.
 * The sheet's own layout and save paths are covered by test/run-profile-setup-ui.mjs.
 *
 * USAGE: node test/run-onboarding-order-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9418);
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onb-order-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const formOpen = () => ev(`var r=document.getElementById("pfSetupRoot"); return !!(r && r.classList.contains("on"));`);

function clearBusy() { return ev(`var a=document.getElementById("smdApplock"); if(a) a.remove(); return 1;`); }
function makeBusy() { return ev(`var a=document.getElementById("smdApplock"); if(!a){a=document.createElement("div");a.id="smdApplock";a.style.cssText="position:fixed;inset:0;background:#000;z-index:9";document.body.appendChild(a);} return 1;`); }

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_PROFILE_SETUP`) === true) { ready = true; break; } }
  ok(ready, "profile-setup.js loads with the app");

  await ev(`
    ["introPoster","splash","accountGate","verifyGate","smdBootSplash"].forEach(function(id){var e=document.getElementById(id); if(e) e.remove();});
    try { localStorage.removeItem("smd_onb_legacy"); sessionStorage.clear(); localStorage.setItem("smd_onboarding_tour","0"); } catch(e){}
    var w=document.querySelector(".smdt-wel"); if(w) w.style.display="none";
    window.SMD_AUTH=null; window.SMD_DB=null;
    window.SMD_loadFirebase=function(cb){ cb && setTimeout(cb, 0); };
    window.SMD_PROFILE_SETUP.close(); return 1;`);

  const home = await ev(`var h=document.getElementById("homeV2"); return !!(h && h.classList.contains("on"));`);
  ok(home, "home screen is up (#homeV2.on)");

  await clearBusy();
  await ev(`document.getElementById("homeV2").classList.remove("on"); return 1;`);
  await ev(`SMD_PROFILE_SETUP.request({force:true}); return 1;`);
  await sleep(1200);
  ok(!(await formOpen()), "profile sheet does NOT open before the first screen");

  await ev(`document.getElementById("homeV2").classList.add("on"); return 1;`);
  for (let i = 0; i < 12; i++) { await sleep(300); if (await formOpen()) break; }
  ok(await formOpen(), "profile sheet opens once the first screen is up");

  const budget = await ev(`return sessionStorage.getItem("smd_onb_optional_shown");`);
  ok(budget === "1", "the session's one optional-sheet budget is spent");

  await ev(`SMD_PROFILE_SETUP.close(); SMD_PROFILE_SETUP.request({force:true}); return 1;`);
  await sleep(900);
  ok(!(await formOpen()), "a second optional sheet is refused in the same session");

  // Old order: the legacy switch opens immediately, even before the first screen and over a sheet.
  await ev(`
    localStorage.setItem("smd_onb_legacy","1"); sessionStorage.clear();
    document.getElementById("homeV2").classList.remove("on");
    var a=document.getElementById("smdApplock"); if(!a){a=document.createElement("div");a.id="smdApplock";a.style.cssText="position:fixed;inset:0;background:#000;z-index:9";document.body.appendChild(a);}
    SMD_PROFILE_SETUP.close(); return 1;`);
  await ev(`SMD_PROFILE_SETUP.request({force:true}); return 1;`);
  await sleep(500);
  ok(await formOpen(), "smd_onb_legacy=1 restores the old immediate prompt");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);