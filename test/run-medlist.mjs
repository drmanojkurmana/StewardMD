/* Medication list builder — deterministic free-text parser (PR 1, Task 1/N).
 *
 * Verifies MEDLIST.parseEntry mechanically extracts strength/unit/form/route/freq
 * and the residual drug name from free-text medication entries. Generic-name
 * resolution and confidence scoring are added in Task 2 and are NOT asserted here.
 *
 * USAGE: BASE=http://localhost:8902/ node test/run-medlist.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9376, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/medlist-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && MEDLIST.parseEntry)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDLIST not loaded");

  const p1 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Tab amlodipine 5 mg OD"))`));
  ok(p1.strength === 5 && p1.unit === "mg" && p1.form === "tablet" && p1.freq === "OD", "parse 'Tab amlodipine 5 mg OD' — strength/unit/form/freq");
  ok(p1.name === "amlodipine", "parse 'Tab amlodipine 5 mg OD' — residual name");

  const p2 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("metformin 500 bd"))`));
  ok(p2.strength === 500 && p2.freq === "BD", "parse 'metformin 500 bd' — strength/freq");
  ok(p2.name === "metformin", "parse 'metformin 500 bd' — residual name");

  const p3 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("inj ceftriaxone 1 g iv bd"))`));
  ok(p3.strength === 1 && p3.unit === "g" && p3.route === "IV" && p3.form === "injection", "parse 'inj ceftriaxone 1 g iv bd' — strength/unit/route/form");
  ok(p3.name === "ceftriaxone", "parse 'inj ceftriaxone 1 g iv bd' — residual name");

  const p4 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("dextrose 5% iv"))`));
  ok(p4.strength === 5 && p4.unit === "%" && p4.route === "IV", "parse 'dextrose 5% iv' — percent-concentration unit/route");

  const e = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("T. Ecosprin 75"))`));
  ok(e.generic === "aspirin" && e.confidence === "high", "'Ecosprin' -> aspirin");
  const pz = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Piptaz 4.5 q6h"))`));
  ok(pz.generic === null && pz.candidates.some(c => c.generic.indexOf("piperacillin") === 0), "'Piptaz' stays unmapped w/ candidate (needs confirm)");

  const om = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("omez 20 od"))`));
  ok(om.generic === "omeprazole" && om.confidence === "high", "'omez' (formulary brand alias, not in BRAND_SEED) -> omeprazole");
  const am = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("amlodipine 5 od"))`));
  ok(am.generic === "amlodipine" && am.confidence === "high", "'amlodipine' (known generic via formulary, not in BRAND_SEED) -> amlodipine");

  const list = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parsePasted("1. Tab Amlodipine 5 mg OD\\n2) Metformin 500 BD\\n- T. Ecosprin 75"))`));
  ok(list.length === 3 && list[0].generic === "amlodipine" && list[2].generic === "aspirin", "paste 3-line list parses each");

  // --- Task 4: list state (add/remove/undo/clear, session-scoped) ---
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "add -> 1 med");
  const rid = await ev(`return MEDLIST.getList()[0].id`);
  await ev(`MEDLIST.remove(${JSON.stringify(rid)}); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "remove -> 0");
  await ev(`MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "undoRemove -> 1");

  // Edge case: undoRemove with nothing to undo is a no-op (does not throw, does not duplicate)
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "undoRemove with nothing to undo is a no-op");

  // Edge case: clearAll empties the list and clears any pending undo
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 2, "clearAll setup -> 2 meds");
  await ev(`MEDLIST.clearAll(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "clearAll -> 0 meds");
  await ev(`MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "undoRemove after clearAll does not resurrect meds");

  // Each med extends parseEntry() result with id/brand/indication/startDate/source
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("Tab amlodipine 5 mg OD"),"index"); return 1;`);
  const shaped = JSON.parse(await ev(`return JSON.stringify(MEDLIST.getList()[0])`));
  ok(typeof shaped.id === "string" && shaped.id.length > 0, "med has generated id");
  ok(shaped.brand === null && shaped.indication === null && shaped.startDate === null, "med has brand/indication/startDate defaulted to null");
  ok(shaped.source === "index", "med carries the given source");
  ok(shaped.generic === "amlodipine" && shaped.strength === 5 && shaped.unit === "mg" && shaped.form === "tablet" && shaped.freq === "OD", "med retains parseEntry() fields");

  // Persistence: list survives reload via sessionStorage['smd_medlist']
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"paste"); return 1;`);
  const stored = JSON.parse(await ev(`return sessionStorage.getItem("smd_medlist")`));
  ok(Array.isArray(stored) && stored.length === 1 && stored[0].source === "paste", "list persisted to sessionStorage['smd_medlist']");
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await ev(`return !!(window.MEDLIST && MEDLIST.getList)`) === true) break; }
  ok(await ev(`return MEDLIST.getList().length`) === 1, "list reloaded from sessionStorage after navigation");
  await ev(`MEDLIST.clearAll(); return 1;`);

  console.log(fails === 0 ? "\nALL GREEN — medlist parser test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
