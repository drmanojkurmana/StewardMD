/* StewardMD Phase-3 next-question engine test (additive + purity gate)
 *
 * WHY: DX._nextQuestions() is an ADDITIVE consultant-style "what to ask next"
 * layer. It must (1) return a sane ranked list of unentered findings, and
 * (2) NOT perturb the engine — calling it must leave DX._differential output
 * byte-identical (it simulates candidates by cloning + restoring state). This
 * harness drives the REAL engine headlessly and asserts both properties over
 * the same clinical vignettes used by the golden harness.
 *
 * USAGE:  node test/run-nextq.mjs        (exit 0 = pass, 1 = fail)
 * Requires a local static server on $BASE (auto-spawned) and Google Chrome.
 * NOT shipped — development/test tooling only.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8799/";
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9351;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/nextq-chrome-prof";
const { vignettes } = JSON.parse(readFileSync(join(HERE, "vignettes.json"), "utf8"));

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8799";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

function probeExpr(findings) {
  const f = JSON.stringify(findings);
  return `
    if(!window.DX||!window.DX._differential||!window.DX._nextQuestions) return '__ERR__engine-not-loaded';
    DX._state.f = {};
    ${f}.forEach(function(k){ DX._state.f[k]=true; });
    function snap(){ var d=DX._differential();
      return JSON.stringify({inf:d.inf.map(function(r){return r.id+':'+r.score;}),
                             ni:d.ni.map(function(r){return r.id+':'+r.score;})}); }
    var before = snap();
    var nq = DX._nextQuestions(5);
    var after = snap();
    return JSON.stringify({ pure: before===after, before: before, after: after,
      n: nq.length,
      ok: Array.isArray(nq) && nq.every(function(q){ return q.key && q.label && typeof q.value==='number'; }),
      top: nq.slice(0,3).map(function(q){ return q.label+' ('+q.value+(q.discriminates?', discriminates':'')+')'; }) });
  `;
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await ev(`return !!(window.DX && window.DX._nextQuestions && window.SYNDROMES && Object.keys(window.SYNDROMES).length>0);`);
    if (r === true) { ready = true; break; }
  }
  if (!ready) throw new Error("reasoning engine / _nextQuestions not loaded within timeout");
  await ev(`try{ if(DX.open){DX.open();} }catch(e){}; return 1;`); await sleep(400);

  let fails = 0, impure = 0;
  for (const v of vignettes) {
    const raw = await ev(probeExpr(v.findings));
    if (typeof raw === "string" && raw.startsWith("__ERR__")) throw new Error(`vignette ${v.id}: ${raw}`);
    const r = JSON.parse(raw);
    const purityBad = !r.pure;
    const shapeBad = !r.ok;
    if (purityBad) impure++;
    if (purityBad || shapeBad) { fails++;
      console.log(`❌ ${v.id}: ${purityBad ? "IMPURE (differential changed!)" : ""} ${shapeBad ? "bad shape" : ""}`);
    } else {
      console.log(`✅ ${v.id.padEnd(18)} q=${r.n}  ${r.top.join("  |  ")}`);
    }
  }
  console.log(`\n${fails === 0 ? "ALL GREEN — next-question engine sane & PURE (differential unchanged)" : `${fails} failed (${impure} purity violations)`}`);
  if (fails > 0) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
  if (serveProc) serveProc.kill("SIGKILL");
}
