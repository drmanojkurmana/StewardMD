/* StewardMD — Phase 4 expanded-KB test (flag-gated, reversible)
 *
 * window.KB_EXPANDED promotes the ~268 Harrison reference diseases to diagnostic
 * candidates ONLY when `smd_kb_expanded` is ON. This asserts:
 *   (1) default OFF → 0 expanded candidates, an expanded-only disease
 *       (pheochromocytoma) is ABSENT (so golden/live differential is untouched);
 *   (2) SMD_setKbExpanded(true) → it registers + surfaces for its findings;
 *   (3) SMD_setKbExpanded(false) → removed again (instant revert).
 *
 * USAGE: node test/run-kb-expanded.mjs   (exit 0 = pass). Auto-spawns server + Chrome.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8803/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9362;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kbexp-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8803";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const PHEO = "(function(){var a=window.SMD_REASON.assess({palpitations:1,hypertensionHx:1,headache:1});return a.nonInfectious.some(function(r){return r.id==='pheochromocytoma';});})()";
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

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
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.KB_EXPANDED && window.SMD_setKbExpanded);`) === true) { ready = true; break; } }
  if (!ready) throw new Error("engine / KB_EXPANDED not loaded");
  await ev(`window.SMD_setKbExpanded(false); return 1;`); await sleep(100);
  ok(await ev(`return window.KB_EXPANDED.count >= 200;`) === true, "KB_EXPANDED loaded (>=200 diseases)");
  ok(await ev(`return window.SMD_kbExpandedCount().on===false && (window.SMD_kbExpandedCount().inf+window.SMD_kbExpandedCount().ni)===0;`) === true, "default OFF → 0 expanded candidates");
  ok(await ev(`return ${PHEO}===false;`) === true, "OFF → expanded-only disease absent (live differential untouched)");
  await ev(`window.SMD_setKbExpanded(true); return 1;`); await sleep(100);
  ok(await ev(`return window.SMD_kbExpandedCount().on===true && (window.SMD_kbExpandedCount().inf+window.SMD_kbExpandedCount().ni)>=200;`) === true, "ON → expanded candidates registered");
  ok(await ev(`return ${PHEO}===true;`) === true, "ON → pheochromocytoma surfaces for its findings");
  await ev(`window.SMD_setKbExpanded(false); return 1;`); await sleep(100);
  ok(await ev(`return ${PHEO}===false;`) === true, "OFF again → removed (instant revert)");
  console.log(`\n${fails === 0 ? "ALL GREEN — expanded KB participates when enabled, zero impact when off" : fails + " failed"}`);
  if (fails > 0) process.exitCode = 1;
} catch (e) { console.log("ERR " + e.message); process.exitCode = 1; }
finally { try { chrome.kill(); } catch {} try { if (serveProc) serveProc.kill(); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 300); }
