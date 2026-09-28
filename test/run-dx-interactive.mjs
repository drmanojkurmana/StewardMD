/* StewardMD - interactive differential, real browser: how often the right diagnosis leads AFTER the doctor answers the
 * app's own next-finding questions (SMD_REASON.nextFindings, the "consultant suggestions" on the differential).
 * Measurement only: nothing here tunes the engine.
 * Two starts per gold case:
 *   pc   - the findings read from the presenting complaint alone (as a doctor typing only the complaint)
 *   cur  - the full tapped findings (every later question is then answered "no": pertinent negatives)
 * Each step asks the top suggested finding not yet asked; the answer comes from the case: gold true -> present,
 * anything else -> denied (a numeric gold value, e.g. an age or a lab, is skipped: not a yes/no question).
 * Reports top-1 / top-3 after 0, 1, 2, 3 and 5 questions, per split, and how often a question was a "yes".
 * USAGE: BASE=http://localhost:8804/ CHROME=<chrome> node test/run-dx-interactive.mjs   (FLAGS=, SETS=gold, OUT=)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
// data -> a JS literal safe to splice into code evaluated in the page (CodeQL js/bad-code-sanitization):
// JSON.stringify leaves <, >, U+2028 and U+2029 raw, so escape them (the pattern CodeQL documents)
const LIT_ESC = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => LIT_ESC[c]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CDP = Number(process.env.CDP_PORT || 9477);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";
const FLAGS = (process.env.FLAGS || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split("="));
const CONFIG = FLAGS.length ? FLAGS.map((f) => f.join("=")).sort().join(",") : "default";
const SETS = (process.env.SETS || "gold").split(",");
const CHECK = process.argv.includes("--check"), WRITE = process.argv.includes("--write-floors"), MISSES = process.argv.includes("--misses");
const FLOORS = join(ROOT, "kb", "validation", "dx-floors.json");

// Time-critical infections: a delay in antibiotics costs lives. MIXED_MALARIA / CNS_TB are
// time-critical too but their first therapy is not an antibacterial, so they are not scored here.
const CRITICAL = ["MENINGITIS", "ENCEPHALITIS", "SEPSIS", "SEPTIC_SHOCK", "FEBRILE_NEUTROPENIA", "NECROTIZING_FASCIITIS",
  "CHOLANGITIS", "BRAIN_ABSCESS", "SBP", "SEVERE_CAP", "VAP", "IE"];

const splits = JSON.parse(readFileSync(join(ROOT, "kb", "validation", "splits.json"), "utf8")).splits || {};
const cases = [];
if (SETS.includes("gold")) {
  const gold = JSON.parse(readFileSync(join(ROOT, "kb", "validation", "cases.json"), "utf8"));
  for (const f of readdirSync(join(ROOT, "kb", "validation", "cases")).filter((x) => x.endsWith(".json")).sort()) gold.push(JSON.parse(readFileSync(join(ROOT, "kb", "validation", "cases", f), "utf8")));
  gold.forEach((c) => cases.push({ set: "gold", c }));
}
if (SETS.includes("heldout")) JSON.parse(readFileSync(join(ROOT, "test", "dx-heldout.json"), "utf8")).forEach((c) => cases.push({ set: "heldout", c }));
// heldout2: written after Phase 2 began, never inspected case by case (the first held-out set's misses were
// printed in the audit and informed a few Phase-2 phrases, so it is no longer fully independent)
if (SETS.includes("heldout2")) JSON.parse(readFileSync(join(ROOT, "test", "dx-heldout-2.json"), "utf8")).forEach((c) => cases.push({ set: "heldout2", c }));

// start the static server if nothing answers at BASE (same pattern as run-reason-api.mjs)
let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) {
    serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
  }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${JOB}/dx-inter-prof-${process.pid}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
// The KB (kb/dist/*, ~4.8 MB) is lazy-loaded after first paint by kb-loader.js; scoring reads it at
// call time, so starting before window.SMD_KB_READY resolves gives load-order-dependent numbers.
const ready = async () => {
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__auditKb){window.__auditKb=1;SMD_KB_READY.then(function(){window.__auditKb=2;});}
      return !!(window.__auditKb===2&&window.KB_CORE&&window.KB_CLINICAL&&window.SMD_REASON&&window.DX&&window.SMD_NLP&&DX.findingsFromText&&window.OPDEMR&&window.ASP_DATA);`);
    if (r === true) return true;
  }
  return false;
};

// gold labs are stored as keys like platelets_10e3_uL: 98 -> write them as a doctor would:
// "platelets 98 x10^3/uL" (no real note has underscores, and \b cannot match inside one)
const UNIT = /^(10e\d+|x10e\d+|mg|g|mmol|umol|ng|pg|u|iu|ml|dl|l|ul|pct|percent|meq|mcg|ug|mm|mmhg|sec|s|per|fl|mm3|hr|min)$/i;
function labText(k, v) {
  const parts = String(k).split("_"), i = parts.findIndex((p, j) => j > 0 && UNIT.test(p));
  if (i < 0) return parts.join(" ") + " " + v;
  const unit = parts.slice(i).map((p) => /^10e\d+$/i.test(p) ? "x10^" + p.slice(3) : p).join("/").replace(/^(x10\^\d+)\//, "$1/");
  return parts.slice(0, i).join(" ") + " " + v + " " + unit;
}
function chartText(c) {
  if (c.text) return c.text;
  return [c.presentingComplaint || c.chiefComplaint || "", c.history || "", c.examination || "",
    c.vitals ? "Vitals: " + Object.entries(c.vitals).map(([k, v]) => k + " " + v).join(", ") : "",
    c.labs ? "Labs: " + Object.entries(c.labs).map(([k, v]) => labText(k, v)).join("; ") : "",
    typeof c.imaging === "string" ? c.imaging : "", typeof c.microbiology === "string" ? c.microbiology : ""].join(". ");
}

let exitCode = 0;
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable"); await call("Page.navigate", { url: BASE });
  if (!(await ready())) throw new Error("engine did not load at " + BASE);
  // flags are read by the engine at call time from localStorage; set them, then reload so any
  // load-time reader sees them too
  await ev(`${lit(FLAGS)}.forEach(function(kv){localStorage.setItem(kv[0],kv[1]);}); ["smd_gate_v2","smd_nlp_v2","smd_rank_v3","smd_kb_v2","smd_calib","smd_prior_v1"].forEach(function(k){ if(!${lit(FLAGS.map((f) => f[0]))}.includes(k)) localStorage.removeItem(k); }); localStorage.removeItem("smd_prior_counts"); return 1`);
  await call("Page.navigate", { url: BASE });
  if (!(await ready())) throw new Error("engine did not reload");
  await ev(`DX.findingCatalog(); return 1`);

  const STEPS = [0, 1, 2, 3, 5], MAXQ = 5, rows = [];
  for (const { set, c } of cases) {
    const exp = c.expected || {};
    if (!(exp.acceptableIds || []).length) continue;
    const r = await ev(`
      var c=${lit({ findings: c.findings || {}, acc: exp.acceptableIds || [], pc: c.presentingComplaint || c.chiefComplaint || c.text || "" })};
      var acc=c.acc.map(function(s){return String(s).toLowerCase();});
      function ok(x){ return !!x && (acc.indexOf(String(x.id).toLowerCase())>=0 || acc.some(function(a){return a && String(x.name||'').toLowerCase().indexOf(a)>=0;})); }
      function pos(f, neg){ var a=neg.length?SMD_REASON.assess(f,{absent:neg}):SMD_REASON.assess(f);
        var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||(y.confidence-x.confidence);});
        for(var i=0;i<all.length;i++) if(ok(all[i])) return i+1; return 0; }
      function nextQ(f, neg){ var S=DX._state, sf=S.f, sn=S.neg; S.f={}; Object.keys(f).forEach(function(k){S.f[k]=true;}); S.neg={}; neg.forEach(function(k){S.neg[k]=true;});
        var q=[]; try { q=SMD_REASON.nextFindings(12)||[]; } finally { S.f=sf; S.neg=sn; } return q.map(function(x){return x.key;}); }
      function walk(f0, neg0){ var f={}, neg=neg0.slice(), asked={}, trace=[pos(f0,neg0)], yes=0, n=0; Object.keys(f0).forEach(function(k){f[k]=f0[k];});
        Object.keys(f).forEach(function(k){asked[k]=1;}); neg.forEach(function(k){asked[k]=1;});
        while(n<${MAXQ}){ var q=nextQ(f,neg).filter(function(k){return !asked[k];}); if(!q.length) break; var k=q[0]; asked[k]=1; var v=c.findings[k];
          if(v===true){ f[k]=true; yes++; } else if(v===undefined||v===false||v===null){ neg.push(k); } else { continue; }
          n++; trace.push(pos(f,neg)); }
        return { trace:trace, yes:yes, asked:n }; }
      var e=DX.extractText(c.pc), fpc={}; e.present.forEach(function(k){fpc[k]=true;});
      var fcur={}; Object.keys(c.findings).forEach(function(k){ if(c.findings[k]) fcur[k]=c.findings[k]; });
      return JSON.stringify({ pc: walk(fpc, e.absent||[]), cur: Object.keys(fcur).length ? walk(fcur, []) : null });`);
    const j = r && r[0] === "{" ? JSON.parse(r) : { err: String(r) };
    rows.push(Object.assign(j, { id: c.id, set, split: set === "gold" ? (splits[c.id] || "unassigned") : "test" }));
  }
  const at = (t, s) => t[Math.min(s, t.length - 1)];   // fewer questions available: the last position stands
  for (const path of ["cur", "pc"]) {
    for (const grp of ["all", "train", "dev", "test"]) {
      const R = rows.filter((x) => x[path] && x[path].trace && (grp === "all" || x.split === grp));
      if (!R.length) continue;
      const cells = STEPS.map((s) => { const t1 = R.filter((x) => at(x[path].trace, s) === 1).length, t3 = R.filter((x) => { const p = at(x[path].trace, s); return p > 0 && p <= 3; }).length;
        return `${s}q ${t1}/${t3}`; });
      const asked = R.reduce((a, x) => a + x[path].asked, 0), yes = R.reduce((a, x) => a + x[path].yes, 0);
      console.log(`${(path === "cur" ? "tapped" : "complaint").padEnd(9)} ${grp.padEnd(5)} n=${String(R.length).padEnd(3)} top1/top3 after questions: ${cells.join(" · ")}  (questions answered "yes": ${yes}/${asked})`);
    }
  }
  const errs = rows.filter((x) => x.err).length; if (errs) { console.log("ERRORS:", errs); exitCode = 1; }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ config: CONFIG, rows }, null, 1));
} catch (e) { console.error(e); exitCode = 1; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(exitCode), 300); }
