/* StewardMD — focused regression test for Phase-2 Tier-4 recall PROMOTIONS.
 *
 * New diagnosable entities promoted from reference-only. Asserts each recovered
 * case now carries its intended dx in the top-3, AND (for delirium tremens) that
 * the CNS-infection lead is PRESERVED — DT is surfaced as a co-consideration in a
 * febrile/altered patient, it must NOT displace empiric meningitis/encephalitis
 * cover from the #1 slot. Drives the REAL engine headlessly.
 *
 * USAGE:  BASE=http://localhost:8903/ node test/run-recall-tier4.mjs
 * Exit:   1 if any assertion fails.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9467);

const RECOVER = [
  { id: "gc_062", accept: ["sickle_cell_disease"] },
  { id: "gc_098", accept: ["delirium_tremens"] },
];

function loadCase(id) {
  const p = join(ROOT, "kb", "validation", "cases", id + ".json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const arr = join(ROOT, "kb", "validation", "cases.json");
  if (existsSync(arr)) { const a = JSON.parse(readFileSync(arr, "utf8")); const f = a.find((c) => c.id === id); if (f) return f; }
  throw new Error("case not found: " + id);
}

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/recall-t4-prof`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:x.message})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

let fails = 0;
function check(name, ok, detail) { console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails++; }

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  let ready = false; for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.KB_CORE && window.KB_CLINICAL)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("engine not loaded");

  async function ranked(c) {
    return JSON.parse(await ev(`
      var c=${JSON.stringify(c)};
      var a=window.SMD_REASON.assess(c.findings||{});
      var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||((y.confidence||0)-(x.confidence||0));});
      return JSON.stringify(all.slice(0,4).map(function(x){return {id:x.id,name:x.name,inf:!!x.matched||a.infectious.indexOf(x)>=0};}));`));
  }
  function inTop3(list, acc) { const a = acc.map((s) => s.toLowerCase()); return list.slice(0, 3).some((x) => a.indexOf(String(x.id).toLowerCase()) >= 0 || a.some((k) => String(x.name || "").toLowerCase().indexOf(k) >= 0)); }

  console.log("\nTier-4 promotions (intended dx in top-3):");
  for (const r of RECOVER) { const l = await ranked(loadCase(r.id)); check(r.id + " → " + r.accept.join("/"), inTop3(l, r.accept), l.slice(0, 3).map((x) => x.id).join(",")); }

  console.log("\nSafety: DT must NOT lead a febrile/altered patient (CNS-infection cover preserved):");
  {
    const l = await ranked(loadCase("gc_098"));
    const leadIsCNSinfection = /encephalitis|meningitis|abscess/i.test(l[0] && l[0].name || "");
    check("gc_098 lead is a CNS infection (not DT)", leadIsCNSinfection, "lead=" + (l[0] && l[0].name));
  }

  console.log(`\n${fails ? "❌ " + fails + " assertion(s) FAILED" : "✅ ALL GREEN — Tier-4 promotions verified (recall + DT safety)"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
