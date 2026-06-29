/* StewardMD reasoning-engine GOLDEN-CASE regression harness  (P0a)
 *
 * WHY: reasoning.js is a live, clinical, data-driven engine that scores
 * window.SYNDROMES (infective) + DDX_NI (non-infective) for every finding set.
 * Before any Knowledge-Base migration we must be able to prove the engine's
 * ranked differential does NOT change unintentionally. This harness drives the
 * REAL engine headlessly (DX._differential) over a fixed set of clinical
 * vignettes and snapshots the ranked output.
 *
 * USAGE:
 *   node test/run-golden.mjs --update     # capture/refresh the baseline snapshot
 *   node test/run-golden.mjs              # compare current engine vs baseline (CI/regression)
 *
 * Requires a local static server on $BASE (default http://localhost:8799) and
 * Google Chrome. Snapshots: test/golden/baseline.json
 *
 * NOT shipped to users — development/test tooling only.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8799/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9350;
const TOPN = 6; // capture the top-N of each column (the clinically meaningful head of the differential)
const UPDATE = process.argv.includes("--update");
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/golden-chrome-prof";
const GOLDEN = join(HERE, "golden", "baseline.json");

const { vignettes } = JSON.parse(readFileSync(join(HERE, "vignettes.json"), "utf8"));

// Auto-spawn our own static server if BASE is a localhost we can't already reach,
// so the harness is fully self-contained (no external server needed).
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return; // remote BASE — assume it's up
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8799";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

function snapshotExpr(findings) {
  const f = JSON.stringify(findings);
  return `
    if(!window.DX||!window.DX._differential) return '__ERR__engine-not-loaded';
    DX._state.f = {}; ${"" }
    ${f}.forEach(function(k){ DX._state.f[k]=true; });
    var d = DX._differential();
    function top(arr){ return (arr||[]).slice(0,${TOPN}).map(function(r){ return r.id+':'+r.score; }); }
    return JSON.stringify({ inf: top(d.inf), ni: top(d.ni), nInf:(d.inf||[]).length, nNi:(d.ni||[]).length });
  `;
}

function diffRows(a, b) {
  // returns array of human-readable difference lines, or [] if identical
  const out = [];
  const cmp = (label, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`    ${label}: baseline ${JSON.stringify(x)}  ->  now ${JSON.stringify(y)}`); };
  cmp("inf", a.inf, b.inf); cmp("ni", a.ni, b.ni);
  if (a.nInf !== b.nInf) out.push(`    nInf: ${a.nInf} -> ${b.nInf}`);
  if (a.nNi !== b.nNi) out.push(`    nNi: ${a.nNi} -> ${b.nNi}`);
  return out;
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
  await call("Page.navigate", { url: BASE });

  // wait for the engine + syndrome DB to be present
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await ev(`return !!(window.DX && window.DX._differential && window.SYNDROMES && Object.keys(window.SYNDROMES).length>0 && window.DX._ni);`);
    if (r === true) { ready = true; break; }
  }
  if (!ready) throw new Error("reasoning engine / SYNDROMES not loaded within timeout");
  // warm up engine internals (IDF, ontology) the way the live app does
  await ev(`try{ if(DX.open){DX.open();} }catch(e){}; return 1;`); await sleep(400);
  const synCount = await ev(`return Object.keys(window.SYNDROMES).length;`);
  const niCount = await ev(`return (window.DX._ni||[]).length;`);

  const results = {};
  for (const v of vignettes) {
    const raw = await ev(snapshotExpr(v.findings));
    if (typeof raw === "string" && raw.startsWith("__ERR__")) throw new Error(`vignette ${v.id}: ${raw}`);
    results[v.id] = JSON.parse(raw);
  }

  if (UPDATE) {
    mkdirSync(join(HERE, "golden"), { recursive: true });
    const payload = { _meta: { capturedAtNote: "baseline of CURRENT engine before KB migration", topN: TOPN, syndromeCount: synCount, ddxNiCount: niCount, vignetteCount: vignettes.length }, results };
    writeFileSync(GOLDEN, JSON.stringify(payload, null, 2));
    console.log(`✅ baseline written: ${GOLDEN}`);
    console.log(`   syndromes=${synCount}  ddx_ni=${niCount}  vignettes=${vignettes.length}  topN=${TOPN}`);
    for (const v of vignettes) console.log(`   ${v.id.padEnd(18)} inf=${results[v.id].inf.length} ni=${results[v.id].ni.length}  lead_inf=${results[v.id].inf[0]||"-"}  lead_ni=${results[v.id].ni[0]||"-"}`);
  } else {
    if (!existsSync(GOLDEN)) throw new Error("no baseline.json — run with --update first");
    const base = JSON.parse(readFileSync(GOLDEN, "utf8")).results;
    let changed = 0, missing = 0;
    for (const v of vignettes) {
      if (!base[v.id]) { console.log(`?  ${v.id}: no baseline entry (new vignette)`); missing++; continue; }
      const d = diffRows(base[v.id], results[v.id]);
      if (d.length) { console.log(`❌ ${v.id} (${v.label}) CHANGED:`); d.forEach(l => console.log(l)); changed++; }
      else console.log(`✅ ${v.id}`);
    }
    console.log(`\n${changed === 0 && missing === 0 ? "ALL GREEN — engine output unchanged" : `${changed} changed, ${missing} new`}`);
    if (changed > 0) process.exitCode = 1;
  }
  ws.close();
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
  if (serveProc) serveProc.kill("SIGKILL");
}
