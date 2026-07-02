/* StewardMD — focused regression test for the Phase-2 (Tier 1+2) recall fixes.
 *
 * Proves each audited recall fix keeps the intended diagnosis in the top-3 AND
 * that the guardrail cases (mimics that must NOT be displaced, and antibiotic
 * outputs that must stay byte-identical) are preserved. Drives the REAL engine
 * (window.SMD_REASON.assess) headlessly against the actual gold-case findings.
 *
 * USAGE:  BASE=http://localhost:8902/ node test/run-recall-fixes.mjs
 * Exit:   1 if any assertion fails.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9461);

// Tier 1 (fixture corrections) + Tier 2 (finding-mapping recall fixes): the
// intended diagnosis must appear in the top-3 of the merged differential.
const RECOVER = [
  { id: "gc_059", accept: ["vasculitis"] },        // T1 fixture: GPA -> vasculitis
  { id: "gc_083", accept: ["drug_intox"] },         // T1 fixture: TCA overdose -> drug_intox
  { id: "gc_328", accept: ["hypoglycemia"] },        // T2 hypoglycaemia stroke-mimic
  { id: "gc_468", accept: ["hypoglycemia"] },
  { id: "gc_012", accept: ["aki"] },                 // T2 AKI (pre-renal)
  { id: "gc_013", accept: ["aki"] },                 // T2 AKI (ATN, sepsis)
  { id: "gc_045", accept: ["hyperkalemia"] },        // T2 severe hyperkalaemia + ECG
  { id: "gc_061", accept: ["dic"] },                 // T2 sepsis-associated DIC
];
// Guardrails: mimic cases whose correct diagnosis must REMAIN in the top-3
// (the recall boosts must not displace them).
const GUARD = [
  { id: "gc_323", accept: ["hhs"] },                 // HHS must not be lost to the hypoglycaemia boost
  { id: "gc_067", accept: ["hypoglycemia"] },        // (internally-mixed case) must stay in top-3
];
// Antibiotic byte-identical guardrails: the leading infective treatment's
// drugRefs must be unchanged by these NON-infective signature edits.
const ABX = {
  gc_013: ["piperacillin-tazobactam or meropenem", "vancomycin or linezolid", "add antifungal"],
  gc_061: ["piperacillin-tazobactam or meropenem", "vancomycin or linezolid", "add antifungal"],
  gc_014: ["ciprofloxacin", "trimethoprim-sulfamethoxazole", "ceftriaxone + azithromycin/doxycycline"],
};

function loadCase(id) {
  const p = join(ROOT, "kb", "validation", "cases", id + ".json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const arr = join(ROOT, "kb", "validation", "cases.json");
  if (existsSync(arr)) { const a = JSON.parse(readFileSync(arr, "utf8")); const f = a.find((c) => c.id === id); if (f) return f; }
  throw new Error("case not found: " + id);
}

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/recall-fixes-prof`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
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

  // top-3 membership check (mirrors the case-validation merge: rank desc, confidence fallback)
  async function top3(c) {
    return JSON.parse(await ev(`
      var c=${JSON.stringify(c)};
      var a=window.SMD_REASON.assess(c.findings||{});
      var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||((y.confidence||0)-(x.confidence||0));});
      return JSON.stringify(all.slice(0,3).map(function(x){return {id:x.id,name:x.name};}));`));
  }
  function inTop3(t3, accept) {
    const acc = accept.map((s) => s.toLowerCase());
    return t3.some((x) => acc.indexOf(String(x.id).toLowerCase()) >= 0 || acc.some((a) => String(x.name || "").toLowerCase().indexOf(a) >= 0));
  }

  console.log("\nTier 1+2 recall recoveries (intended dx in top-3):");
  for (const r of RECOVER) { const t3 = await top3(loadCase(r.id)); check(r.id + " → " + r.accept.join("/"), inTop3(t3, r.accept), t3.map((x) => x.id).join(",")); }

  console.log("\nGuardrails (mimic cases must remain in top-3):");
  for (const r of GUARD) { const t3 = await top3(loadCase(r.id)); check(r.id + " keeps " + r.accept.join("/"), inTop3(t3, r.accept), t3.map((x) => x.id).join(",")); }

  console.log("\nAntibiotic byte-identical (NON-infective edits must not change treatment):");
  for (const cid of Object.keys(ABX)) {
    const c = loadCase(cid);
    const drugRefs = JSON.parse(await ev(`
      var c=${JSON.stringify(c)};
      return (async function(){
        var a=window.SMD_REASON.assess(c.findings||{});
        var pkg=await window.StewardRAG.buildPackage(a,{caseData:{age:c.age,sex:c.sex,findings:(c.symptoms||[])}});
        var tx=pkg&&pkg.treatment, out=[]; if(tx){ if(tx.default&&tx.default.drugRefs)out=out.concat(tx.default.drugRefs); (tx.alternatives||[]).forEach(function(x){out=out.concat(x.drugRefs||[]);}); }
        return JSON.stringify(out);
      })();`));
    check(cid + " abx unchanged", JSON.stringify(drugRefs) === JSON.stringify(ABX[cid]), "[" + drugRefs.join(",") + "]");
  }

  console.log(`\n${fails ? "❌ " + fails + " assertion(s) FAILED" : "✅ ALL GREEN — recall fixes verified, guardrails + antibiotics preserved"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
