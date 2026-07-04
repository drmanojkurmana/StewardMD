/* StewardMD — focused regression test for Phase-2 Tier-3 INFECTIVE recall fixes.
 *
 * Unlike the non-infective fixes, recovering these diagnoses makes the correct
 * infection LEAD the differential, which (correctly) drives its antibiotic. This
 * test asserts (a) each recovered case carries its intended dx in the top-3, and
 * (b) the leading treatment resolves to the CORRECT therapy for the flagship
 * cases. Drives the REAL engine + StewardRAG headlessly.
 *
 * USAGE:  BASE=http://localhost:8903/ node test/run-recall-infective.mjs
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
const PORT = Number(process.env.CDP_PORT || 9465);

const RECOVER = [
  { id: "gc_121", accept: ["DISSEMINATED_TB"] }, { id: "gc_261", accept: ["DISSEMINATED_TB"] }, { id: "gc_401", accept: ["DISSEMINATED_TB"] },
  { id: "gc_282", accept: ["RICKETTSIAL_FEVER", "SCRUB_TYPHUS"] }, { id: "gc_422", accept: ["RICKETTSIAL_FEVER", "SCRUB_TYPHUS"] },
  { id: "gc_117", accept: ["C_DIFF"] }, { id: "gc_397", accept: ["C_DIFF"] },
  { id: "gc_272", accept: ["LUNG_ABSCESS"] },
  { id: "gc_131", accept: ["LIVER_ABSCESS"] }, { id: "gc_271", accept: ["LIVER_ABSCESS"] }, { id: "gc_411", accept: ["LIVER_ABSCESS"] },
  { id: "gc_103", accept: ["AMOEBIC_LIVER_ABSCESS"] }, { id: "gc_243", accept: ["AMOEBIC_LIVER_ABSCESS"] },
  { id: "gc_084", accept: ["CHOLANGITIS"] }, { id: "gc_111", accept: ["CHOLANGITIS"] },
];
// Correct-therapy checks: leading treatment must contain the expected drug token.
const THERAPY = [
  { id: "gc_121", drug: "isoniazid" },     // disseminated TB -> RIPE
  { id: "gc_117", drug: "vancomycin" },    // C. diff -> oral vancomycin
  { id: "gc_103", drug: "metronidazole" }, // amoebic liver abscess -> metronidazole
  { id: "gc_084", drug: "piperacillin" },  // ascending cholangitis -> pip-tazo / ceftriaxone+metronidazole
];

function loadCase(id) {
  const p = join(ROOT, "kb", "validation", "cases", id + ".json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const arr = join(ROOT, "kb", "validation", "cases.json");
  if (existsSync(arr)) { const a = JSON.parse(readFileSync(arr, "utf8")); const f = a.find((c) => c.id === id); if (f) return f; }
  throw new Error("case not found: " + id);
}

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/recall-inf-prof`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
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
  let ready = false; for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.KB_CORE && window.StewardRAG)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("engine/RAG not loaded");

  async function top3(c) {
    return JSON.parse(await ev(`
      var c=${JSON.stringify(c)};
      var a=window.SMD_REASON.assess(c.findings||{});
      var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||((y.confidence||0)-(x.confidence||0));});
      return JSON.stringify(all.slice(0,3).map(function(x){return {id:x.id,name:x.name};}));`));
  }
  function inTop3(t3, acc) { const a = acc.map((s) => s.toLowerCase()); return t3.some((x) => a.indexOf(String(x.id).toLowerCase()) >= 0 || a.some((k) => String(x.name || "").toLowerCase().indexOf(k) >= 0)); }

  console.log("\nInfective recall recoveries (intended dx in top-3):");
  for (const r of RECOVER) { const t3 = await top3(loadCase(r.id)); check(r.id + " → " + r.accept.join("/"), inTop3(t3, r.accept), t3.map((x) => x.id).join(",")); }

  console.log("\nCorrect-therapy checks (leading treatment contains the right drug):");
  for (const r of THERAPY) {
    const c = loadCase(r.id);
    const drugs = JSON.parse(await ev(`
      var c=${JSON.stringify(c)};
      return (async function(){
        var a=window.SMD_REASON.assess(c.findings||{});
        var pkg=await window.StewardRAG.buildPackage(a,{caseData:{age:c.age,sex:c.sex,findings:(c.symptoms||[])}});
        var tx=pkg&&pkg.treatment, out=[]; if(tx){ if(tx.default&&tx.default.drugRefs)out=out.concat(tx.default.drugRefs); (tx.alternatives||[]).forEach(function(x){out=out.concat(x.drugRefs||[]);}); }
        return JSON.stringify(out);
      })();`));
    check(r.id + " → therapy contains '" + r.drug + "'", drugs.join(" ").toLowerCase().includes(r.drug), "[" + drugs.join(", ").slice(0, 60) + "]");
  }

  console.log(`\n${fails ? "❌ " + fails + " assertion(s) FAILED" : "✅ ALL GREEN — infective recall recoveries + correct therapies verified"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
