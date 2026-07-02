/* StewardMD — SMD_REASON unified engine API test (shape + purity)
 *
 * window.SMD_REASON is the ONE interface-independent reasoning API both the
 * primary form and the sidebar workspace consume. This asserts:
 *   (1) assess(findings) returns the documented structured shape;
 *   (2) assess(findings) is PURE — it does not mutate the live finding state;
 *   (3) topFindings / nextFindings / thresholdMet behave sanely.
 *
 * USAGE: node test/run-reason-api.mjs   (exit 0 = pass). Auto-spawns server + Chrome.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8804/";
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9363;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/reasonapi-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8804";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
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
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.SMD_REASON.assess && window.DX && window.DX._state);`) === true) { ready = true; break; } }
  if (!ready) throw new Error("SMD_REASON not loaded");

  const shape = await ev(`
    var a = window.SMD_REASON.assess({fever:1, neckStiffness:1, headacheSevere:1, photophobia:1});
    var c = (a.infectious[0]) || {};
    return JSON.stringify({
      hasGate: !!a.gate && typeof a.gate.cls==='string',
      inf: a.infectious.length, ni: a.nonInfectious.length, sugg: (a.suggestions||[]).length,
      candOk: !!(c.id && c.name && typeof c.confidence==='number' && Array.isArray(c.supporting) && Array.isArray(c.missing) && Array.isArray(c.mimics)),
      lead: c.name, conf: c.confidence });
  `);
  const s = JSON.parse(shape);
  ok(s.hasGate, "assess() returns gate.cls (" + s.lead + ")");
  ok(s.inf > 0 && s.candOk, "candidate has {id,name,confidence,supporting,missing,mimics}");
  ok(s.conf > 0, "lead confidence is a positive number (" + s.conf + ")");
  ok(s.sugg >= 0, "assess() returns suggestions[]");

  const pure = await ev(`
    window.DX._state.f = { cough:true };
    var before = JSON.stringify(window.DX._state.f);
    window.SMD_REASON.assess({fever:1, neckStiffness:1, headacheSevere:1});
    var after = JSON.stringify(window.DX._state.f);
    return before === after && before === '{"cough":true}';
  `);
  ok(pure === true, "assess(findings) is PURE — live finding state unchanged");

  ok(await ev(`var r = window.SMD_REASON.topFindings('neuro'); return r && Array.isArray(r.top) && r.top.length>0 && r.top.length<=8;`) === true, "topFindings(system) returns <=8 ranked findings");
  ok(await ev(`return Array.isArray(window.SMD_REASON.nextFindings(6));`) === true, "nextFindings(limit) returns an array");
  ok(await ev(`return window.SMD_REASON.thresholdMet({fever:1,neckStiffness:1,headacheSevere:1})===true && window.SMD_REASON.thresholdMet({fever:1})===false;`) === true, "thresholdMet(): 3 findings → true; 1 vague → false");

  console.log(`\n${fails === 0 ? "ALL GREEN — SMD_REASON API shape + purity verified" : fails + " failed"}`);
  if (fails > 0) process.exitCode = 1;
} catch (e) { console.log("ERR " + e.message); process.exitCode = 1; }
finally { try { chrome.kill(); } catch {} try { if (serveProc) serveProc.kill(); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 300); }
