/* Tokós in the REAL app (headless Chrome): flag off hides the tile; flag on shows it, it opens Tokós, the hub shows the
 * CTG clinic, back() returns to home, no uncaught Tokós errors. The module's own behaviour is in test/run-tokos-ui.mjs.
 * USAGE: node test/run-tokos-app-ui.mjs   (BASE=http://localhost:8996/ to use a running server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-app-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Like ev, for a promise-returning body.
const evp = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/tokos|TOKOS/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const tile = `return !!document.querySelector('.rnav-tile[data-act=tokos]');`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.TOKOS && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(600); };

  // flag off (default): no tile
  await call("Page.navigate", { url: BASE }); await until(`return !!(window.TOKOS && window.SMD_showHome);`, 30000);
  await ev(`try{localStorage.removeItem("smd_tokos"); localStorage.setItem("smd_home_tools", JSON.stringify({tokos:true}));}catch(e){} return 1;`);
  await load(BASE);
  ok(await ev(tile) === false, "flag off: the Tokós home tile is absent");
  // flag off: no other entry opens it either (ACT.tokos is the one door for tile, deep link and MaiK tool chip)
  await ev(`SMD_openRoute("tokos"); return 1;`); await sleep(400);
  ok(await ev(`return !TOKOS.isOpen();`) === true, "flag off: stewardmd://tokos (SMD_openRoute) does not open Tokós");

  // flag on: tile shows and opens Tokós
  await ev(`localStorage.setItem("smd_tokos","1"); return 1;`);
  await load(BASE);
  ok(await until(tile, 10000), "flag on (smd_tokos=1): the Tokós home tile renders");
  await ev(`var t=document.querySelector('.rnav-tile[data-act=tokos]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return TOKOS.isOpen() && !!document.getElementById("smdTokos");`, 10000), "tile opens the Tokós overlay");
  ok(await until(`return !!document.querySelector('#smdTokos .tok-clinic[data-t=ctg]');`, 20000), "hub shows the CTG clinic");
  await ev(`TOKOS.back(); return 1;`);
  ok(await until(`return !TOKOS.isOpen();`, 5000), "back() closes Tokós and returns to home");
  ok(await ev(`var a=document.activeElement; return !!(a && a.matches && a.matches('.rnav-tile[data-act=tokos]'));`) === true, "closing Tokós returns focus to the tile that opened it");
  ok(await ev(`return !document.getElementById("smdTokos") || !document.getElementById("smdTokos").offsetParent;`) === true, "overlay is gone");

  // URL override
  await ev(`localStorage.removeItem("smd_tokos"); return 1;`);
  await load(BASE + "?tokos=1");
  ok(await until(tile, 10000), "?tokos=1 shows the tile without the flag");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Tokós wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
