/* Added calculators (calculators-ext.js) in the real app: they register into Calculators, show in the list and
 * search with their category chips, open with their source shown, and compute like the core ones.
 * USAGE: node test/run-calc-ext-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8926/").replace(/\/?$/, "/");
const PORT = 9463, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/calc-ext-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8926"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.MEDCALC && MEDCALC.openList);`) === true) { ready = true; break; } }
  ok(ready, "app boots (calculators.js loaded, MEDCALC.openList present)");

  const reg = await J(`var L=MEDCALC.list(); var ids={}; L.forEach(function(c){ids[c.id]=c.cat;}); return JSON.stringify({ n:L.length, elts:!!ids.elts, oak:ids.oakland_lgib||"", aldrete:ids.aldrete||"", asa:ids.asa_status||"" });`);
  ok(reg.n >= 550, `Calculators lists core plus added (${reg.n})`);
  ok(reg.elts, "ELTS is in the list");
  ok(!!reg.oak && !!reg.aldrete && !!reg.asa, `added calculators are registered (Oakland ${reg.oak}, Aldrete ${reg.aldrete}, ASA ${reg.asa})`);

  await ev(`MEDCALC.openList(); return 1;`); await sleep(300);
  const chips = await J(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#mcCats *"), function(e){return e.textContent.trim();}).filter(Boolean));`);
  ok(chips.some((t) => /Anaesthesia/.test(t)), `category chips include Anaesthesia (${chips.length} chip texts)`);
  ok(chips.some((t) => /Radiology/.test(t)), "category chips include Radiology");
  const s = await J(`var si=document.getElementById("mcSearch"); si.value="oakland"; si.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#mcList .mc-card"),function(c){return c.textContent.trim().slice(0,60);}));`);
  ok(s.some((t) => /Oakland/.test(t)), `search "oakland" finds the Oakland score (${s.length} result)`);
  const s2 = await J(`var si=document.getElementById("mcSearch"); si.value="tirads"; si.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#mcList .mc-card"),function(c){return c.textContent.trim().slice(0,60);}));`);
  ok(s2.some((t) => /TI-RADS/.test(t)), `search "tirads" finds ACR TI-RADS (${s2.length})`);

  await ev(`MEDCALC.open("oakland_lgib"); return 1;`); await sleep(500);
  const form = await J(`return JSON.stringify({ title: /Oakland/.test(document.body.textContent), ref: /Lancet Gastroenterol Hepatol 2017/.test(document.body.textContent), inputs: document.querySelectorAll("input, select").length });`);
  ok(form.title && form.ref, `Oakland opens with its title and source shown (${JSON.stringify(form)})`);
  const api = await J(`var r=MEDCALC.run("oakland_lgib",{age:72,sex:"M",prior:false,rectal:false,hb:10,hr:95,sbp:115}); return JSON.stringify({ v:r&&r.value, i:r&&r.interpretation.slice(0,20) });`);
  ok(api.v === 22 && /Admit/.test(api.i), `Oakland computes 22 (Admit) for age 72, male, Hb 10, HR 95, SBP 115 (got ${JSON.stringify(api)})`);

  console.log(fails === 0 ? "\nALL GREEN: added calculators register, list, search, open and compute in the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
