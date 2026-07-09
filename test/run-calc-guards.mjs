/* Calculator input-guard safety test (PR C).
 *
 * Proves the compute() guards reject missing/implausible inputs (which previously produced
 * SILENT, falsely-reassuring results) while still computing on valid input. NO formula change —
 * validation only. Drives window.MEDCALC._calcs[].compute(v) directly with synthetic values.
 * blank field → readValues() yields NaN; direct compute with a missing key → undefined; both
 * must fail ok(). Deterministic. USAGE: node test/run-calc-guards.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8919/").replace(/\/?$/, "/");
const PORT = 9421, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/calc-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8919"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
// run a calc by id with a synthetic value object; returns {err?, v?, i?}
const calc = async (id, v) => { const r = await ev(`var c=(window.MEDCALC._calcs||[]).filter(function(x){return x.id==="${id}";})[0]; if(!c) return JSON.stringify({__err:"no-calc"}); return JSON.stringify(c.compute(${JSON.stringify(v)}));`); try { return JSON.parse(r); } catch { return {}; } };
const isNum = (o) => o && typeof o.v === "number" && isFinite(o.v);
const isErr = (o) => o && (o.err != null || o.v === "—");

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.MEDCALC && MEDCALC._calcs && MEDCALC._calcs.length)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDCALC not loaded");

  // MELD 3.0 — blank labs must NOT default to normals (was: 6 points ~1.9%)
  ok(isErr(await calc("meld3", { sex: "f" })), "MELD 3.0: blank labs → guarded (no falsely-low score from defaulted normals)");
  ok(isNum(await calc("meld3", { bili: 3.0, creat: 1.6, inr: 1.5, na: 132, alb: 2.8, sex: "f" })), "MELD 3.0: valid labs → still computes a numeric score");

  // PSI/PORT — blank age must NOT score as 0 (was: class I–II, outpatient)
  ok(isErr(await calc("psi", { sex: "m" })), "PSI/PORT: blank age → guarded (no false 'outpatient' from age=0)");
  ok(isNum(await calc("psi", { age: 78, sex: "m", neo: true, ams: true })), "PSI/PORT: valid age → still computes a numeric score");

  // Rumack-Matthew — blank level must NOT read as below-line (was: 'below the treatment line')
  const rBlank = await calc("rumack", { t: 8 });
  ok(isErr(rBlank) && /Enter/i.test(rBlank.i || ""), "Rumack: blank paracetamol level → guarded (never falsely 'below the line')");
  const rHi = await calc("rumack", { t: 8, lvl: 200 });
  ok(isNum(rHi) && /ABOVE the treatment line/i.test(rHi.i || ""), "Rumack: t=8h, level 200 → computes + flags ABOVE the line (start NAC)");

  // Cockcroft-Gault — implausible age must NOT yield a negative CrCl
  const cg = await calc("crcl", { age: 150, wt: 70, scr: 1, sex: "m" });
  ok(isErr(cg), "Cockcroft-Gault: age 150 → guarded (no negative CrCl displayed)");
  ok(isNum(await calc("crcl", { age: 72, wt: 68, scr: 1.4, sex: "m" })), "Cockcroft-Gault: valid inputs → numeric CrCl");

  // Parkland — TBSA > 100% must be rejected
  ok(isErr(await calc("parkland", { wt: 70, tbsa: 150 })), "Parkland: TBSA 150% → guarded (no impossible fluid volume)");
  ok(isNum(await calc("parkland", { wt: 70, tbsa: 40 })), "Parkland: valid TBSA → numeric fluid volume");

  console.log(fails === 0 ? "\nALL GREEN — calculator input-guard safety test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
