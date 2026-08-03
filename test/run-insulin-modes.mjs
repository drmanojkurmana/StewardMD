/* StewardMD — insulin Simple/Advanced mode split (headless, drives the real app).
 * Simple must hide the setup/specialist calculators but KEEP the safety-critical
 * controls (IOB — which prevents dose stacking — and the patient-context chips).
 * Advanced must expose everything. Dev/test tooling only. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8799/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9368;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ins-modes-" + Date.now();

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/); serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8799"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { fail++; console.log("❌ " + m); } };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.INSULIN && window.INSULIN.open);`)) { ready = true; break; } }
  if (!ready) throw new Error("window.INSULIN not available");
  await ev(`window.INSULIN.open(); return 1;`); await sleep(700);
  // The module opens on the dashboard; the calculator is reached via a quick action.
  await ev(`var b=document.querySelector('[data-ins="qa"]'); if(b) b.click(); return 1;`); await sleep(600);
  if (!(await ev(`return !!document.querySelector('[data-ins="mode"]');`))) throw new Error("calculator screen never rendered");

  const modeLabels = () => ev(`return JSON.stringify([].map.call(document.querySelectorAll('[data-ins="mode"]'), function(b){return b.getAttribute('data-mode');}));`);
  const has = (sel) => ev(`return !!document.querySelector(${JSON.stringify(sel)});`);

  // ---- Simple (default) ----
  ok(await has('[data-ins="adv"]'), "Simple/Advanced toggle is present");
  let modes = JSON.parse(await modeLabels() || "[]");
  console.log("   simple modes:", modes.join(", "));
  ok(JSON.stringify(modes) === JSON.stringify(["basal", "correction", "meal", "combined"]),
    "Simple shows exactly Basal → Correction → Meal → Combined, in that order");
  ok(!modes.includes("dka") && !modes.includes("pediatric"), "specialist protocols (DKA, paediatric) hidden in Simple");
  ok(!modes.includes("isf") && !modes.includes("icr") && !modes.includes("iob"), "ratio-derivation calculators hidden in Simple");
  ok(!(await has('[data-ins="round"]')), "rounding preference hidden in Simple");
  // SAFETY: these must survive the simplification
  await ev(`var b=[].filter.call(document.querySelectorAll('[data-ins="mode"]'),function(x){return x.getAttribute('data-mode')==='correction';})[0]; if(b) b.click(); return 1;`); await sleep(400);
  ok(await has('[data-f="iob"]'), "IOB field STILL shown in Simple correction (prevents dose stacking)");
  ok(await has('[data-ins="ctx"]'), "patient-context chips STILL shown in Simple");

  // ---- Advanced ----
  await ev(`document.querySelector('[data-ins="adv"][data-v="1"]').click(); return 1;`); await sleep(500);
  modes = JSON.parse(await modeLabels() || "[]");
  console.log("   advanced modes:", modes.join(", "));
  ok(JSON.stringify(modes) === JSON.stringify(["isf", "icr", "iob", "pediatric", "dka"]),
    "Advanced shows ONLY the remaining 5 (disjoint from Simple, not a superset)");
  ok(!modes.includes("combined") && !modes.includes("basal"), "Advanced does not repeat the Simple tabs");
  // Rounding shows on dose modes only; in Advanced that is Pediatric (ISF/ICR/IOB have no dose to round).
  await ev(`var b=[].filter.call(document.querySelectorAll('[data-ins="mode"]'),function(x){return x.getAttribute('data-mode')==='pediatric';})[0]; if(b) b.click(); return 1;`); await sleep(400);
  ok(await has('[data-ins="round"]'), "rounding shows on an Advanced dose mode (Pediatric)");

  // ---- neither direction may strand the user on a hidden tab ----
  await ev(`var b=[].filter.call(document.querySelectorAll('[data-ins="mode"]'),function(x){return x.getAttribute('data-mode')==='dka';})[0]; b.click(); return 1;`); await sleep(400);
  await ev(`document.querySelector('[data-ins="adv"][data-v="0"]').click(); return 1;`); await sleep(500);
  let active = await ev(`var b=document.querySelector('[data-ins="mode"][aria-pressed="true"]'); return b?b.getAttribute('data-mode'):null;`);
  ok(active === "basal", "Advanced → Simple from a hidden tab lands on the first Simple tab");
  await ev(`document.querySelector('[data-ins="adv"][data-v="1"]').click(); return 1;`); await sleep(500);
  active = await ev(`var b=document.querySelector('[data-ins="mode"][aria-pressed="true"]'); return b?b.getAttribute('data-mode'):null;`);
  ok(active === "isf", "Simple → Advanced lands on the first Advanced tab (no dead screen either way)");
  await ev(`document.querySelector('[data-ins="adv"][data-v="0"]').click(); return 1;`); await sleep(400);

  // Decluttering Simple must not make rounding unreachable — it lives in Settings,
  // whose gear sits on the dashboard header, so reload to get back there.
  await call("Page.navigate", { url: BASE }); await sleep(1200);
  for (let i = 0; i < 40; i++) { await sleep(300); if (await ev(`return !!(window.INSULIN && window.INSULIN.open);`)) break; }
  await ev(`window.INSULIN.open(); return 1;`); await sleep(700);
  await ev(`var b=document.querySelector('[data-ins="go-settings"]'); if(b) b.click(); return 1;`); await sleep(700);
  ok(await has('[data-ins="round"]'), "rounding preference is still reachable in Settings");

  // ---- preference persists ----
  ok(await ev(`return (localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf('smd_insulin_set')===0;})[0]||'')||'').indexOf('advMode')>-1;`) !== false, "level preference is persisted to settings");

  console.log(`\n${fail === 0 ? "ALL GREEN — Simple/Advanced split works and keeps the safety controls" : fail + " FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
