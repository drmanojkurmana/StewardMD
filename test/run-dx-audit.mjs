/* StewardMD - diagnostic + antibiotic-gate audit (kb/validation/AUDIT-2026-09-26.md,
 * kb/validation/PLAN-DX-ABX-10.md). Drives the REAL app in headless Chrome over CDP.
 *
 * Two case sets:
 *   gold    - kb/validation/cases.json + cases/*.json (engine keys + chart narrative)
 *   heldout - test/dx-heldout.json (doctor-style text only; independent author)
 *   heldout2 - test/dx-heldout-2.json (same, written later; only ever read in aggregate)
 * Three input paths per case:
 *   cur - curated engine keys -> SMD_REASON.assess (what a doctor tapping findings gets)
 *   txt - the full chart as text (complaint, history, exam, vitals, labs, imaging, micro)
 *         -> DX.findingsFromText -> assess, plus the OPD re-ranker (OPDEMR._clinicalRerank)
 *   pc  - presenting complaint only -> findingsFromText -> assess
 * Splits come from kb/validation/splits.json (kb/tools/make-validation-splits.mjs). Test-split
 * misses are never printed: tune on train, confirm on dev, look at test only at phase gates.
 *
 * Gate metrics use gate.ab (the engine's own "antibiotics appropriate" bit):
 *   abxSens    - gold lists an antibiotic -> gate.ab true
 *   overcall   - gold lists no antibiotic -> gate.ab true
 *   critical   - time-critical infections (CRITICAL below) -> gate.ab true
 *   noAbxInf   - infections the app's own ASP_DATA marks "Need antibiotics? NO" whose gold also
 *                lists no antibiotic (clean viral / self-limited subset) -> gate.ab true (want 0)
 *   specific   - infections ASP_DATA marks "N/A" (malaria: antimalarial, not antibacterial) ->
 *                gate names a specific therapy (infection_specific). These cases are left out of
 *                abxSens / overcall, whose gold "antibiotics" list for malaria holds antimalarials.
 *
 * ENV: BASE (default http://localhost:8804/), CHROME, CHROME_FLAGS, CDP_PORT, CLAUDE_JOB_DIR, OUT,
 *      FLAGS="smd_gate_v2=1,..." (localStorage, set before the engine loads; config name for floors),
 *      SETS=gold,heldout (default both)
 * ARGS: --check        exit 1 if any metric is worse than kb/validation/dx-floors.json[config]
 *       --write-floors record the current numbers as the floors for this config (reviewed change)
 *       --misses       print train + dev misses (tuning aid)
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-dx-audit.mjs
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
const SETS = (process.env.SETS || "gold,heldout,heldout2").split(",");
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
  `--user-data-dir=${JOB}/dx-audit-prof-${process.pid}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
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

  const rows = [];
  for (const { set, c } of cases) {
    const exp = c.expected || {};
    const r = await ev(`
      var c=${lit({ findings: c.findings || {}, acc: exp.acceptableIds || [], pc: c.presentingComplaint || c.chiefComplaint || c.text || "", full: chartText(c) })};
      var acc=c.acc.map(function(s){return String(s).toLowerCase();});
      function ok(x){ return !!x && (acc.indexOf(String(x.id).toLowerCase())>=0 || acc.some(function(a){return a && String(x.name||'').toLowerCase().indexOf(a)>=0;})); }
      function run(f){ var ab=negOf(f); var a=ab?SMD_REASON.assess(f,{absent:ab}):SMD_REASON.assess(f); var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||(y.confidence-x.confidence);});
        var pos=0; for(var i=0;i<all.length;i++){ if(ok(all[i])){pos=i+1;break;} }
        return { gate:a.gate.cls, ab:!!a.gate.ab, top1:all[0]?all[0].name:null, conf:all[0]?all[0].confidence:0, margin:all[1]?all[0].confidence-all[1].confidence:100, pos:pos, n:Object.keys(f).length, top3:all.slice(0,3).map(function(x){return x.name+'('+x.confidence+')';}) }; }
      // the text path keeps the note's explicit negatives when the engine can use them (smd_rank_v3), as OPD Ask MaiK does
      var useNeg=!!(DX._rankV3&&DX._rankV3()&&DX.extractText), NEG={};
      function fromText(t){ var ks, ab=[]; if(useNeg){ var e=DX.extractText(t); ks=e.present; ab=e.absent; } else ks=DX.findingsFromText(t)||[]; var f={}; ks.forEach(function(k){f[k]=true;}); NEG[JSON.stringify(Object.keys(f))]=ab; return f; }
      function negOf(f){ return NEG[JSON.stringify(Object.keys(f))]||null; }
      // the real OPD Ask MaiK ordering: opd-emr.js differentialFor -> clinicalRerank
      function opd(f){ var rr=OPDEMR._clinicalRerank(OPDEMR._differentialFor(Object.keys(f),negOf(f)),Object.keys(f)); var pos=0; for(var i=0;i<rr.length;i++){ if(ok({id:rr[i].id,name:rr[i].dx})){pos=i+1;break;} } return pos; }
      var hasKeys=Object.keys(c.findings).length>0;
      var cur=hasKeys?run(c.findings):null; if(cur) cur.opd=opd(c.findings);
      var ft=fromText(c.full); var txt=run(ft); txt.opd=opd(ft);
      var pc=run(fromText(c.pc));
      var gold=Object.keys(c.findings);
      var rec=gold.length? gold.filter(function(k){return ft[k];}).length/gold.length : null;
      var prec=Object.keys(ft).length&&gold.length? Object.keys(ft).filter(function(k){return c.findings[k];}).length/Object.keys(ft).length : null;
      var lead=String(c.acc[0]||'').toUpperCase(); var asp=(window.ASP_DATA||{})[lead];
      return JSON.stringify({cur:cur, txt:txt, pc:pc, extractRecall:rec, extractPrecision:prec, aspNeed: asp? asp.needAbx : null});`);
    const j = r && r[0] === "{" ? JSON.parse(r) : { err: String(r) };
    const st = exp.stewardship || {};
    Object.assign(j, {
      id: c.id, set, split: splits[c.id] || "unassigned", expect: (exp.acceptableIds || [])[0], dx: exp.diagnosis,
      abx: typeof c.abx === "boolean" ? c.abx : !!(st.antibiotics && st.antibiotics.length),
    });
    j.critical = CRITICAL.includes(String(j.expect || "").toUpperCase());
    j.noAbxInf = j.aspNeed === "NO" && !j.abx;
    j.specific = j.aspNeed === "N/A";
    rows.push(j);
  }
  writeFileSync(process.env.OUT || join(JOB, "dx-audit.json"), JSON.stringify({ config: CONFIG, base: BASE, rows }, null, 1));

  // ---- metrics ----------------------------------------------------------------------------
  const R = rows.filter((x) => x.expect && !x.err);
  const pct = (a, b) => (b ? `${a}/${b} (${Math.round(100 * a / b)}%)` : "-");
  const metrics = {};
  console.log(`config ${CONFIG} · ${R.length} cases (${rows.filter((r) => r.err).length} errors, ${rows.filter((r) => !r.expect).length} without acceptableIds)`);
  for (const set of SETS) {
    for (const path of ["cur", "txt", "pc"]) {
      const S = R.filter((x) => x.set === set && x[path]);
      if (!S.length || (set !== "gold" && path === "pc")) continue;
      const m = {};
      const by = (split) => split === "all" ? S : S.filter((x) => x.split === split);
      for (const sp of ["all", "train", "dev", "test"]) {
        const T = by(sp); if (!T.length) continue;
        m[sp] = { n: T.length, top1: T.filter((x) => x[path].pos === 1).length, top3: T.filter((x) => x[path].pos && x[path].pos <= 3).length };
      }
      const A = S.filter((x) => x.abx && !x.specific), N = S.filter((x) => !x.abx && !x.specific), C = S.filter((x) => x.critical),
        V = S.filter((x) => x.noAbxInf), SP = S.filter((x) => x.specific);
      Object.assign(m, {
        absent: S.filter((x) => !x[path].pos).length,
        abxSens: A.filter((x) => x[path].ab).length, abxN: A.length,
        overcall: N.filter((x) => x[path].ab).length, overN: N.length,
        critical: C.filter((x) => x[path].ab).length, critN: C.length,
        noAbxInf: V.filter((x) => x[path].ab).length, noAbxN: V.length,
        specific: SP.filter((x) => x[path].gate === "infection_specific").length, specN: SP.length,
      });
      if (path !== "pc") m.opdTop1 = S.filter((x) => x[path].opd === 1).length;
      // smd_calib: "not enough information" should land on the cases the engine would get wrong
      const I = S.filter((x) => x[path].gate === "insufficient"), E = S.filter((x) => x[path].gate !== "insufficient");
      if (I.length) m.insufficient = { n: I.length, top1: I.filter((x) => x[path].pos === 1).length, restTop1: E.filter((x) => x[path].pos === 1).length, restN: E.length };
      // round 20 (idea from Laya: calibration and abstention): is the lead's score honest? ECE and Brier of the top-1
      // score read as a probability, and top-1 accuracy for a clear lead (margin >= 15 over the runner-up, the
      // threshold chosen on train) against a close call. Informational: printed, not a floor.
      const Q = S.filter((x) => x[path].pos != null && x[path].conf != null);
      if (Q.length) {
        let ece = 0, brier = 0;
        [[0, 50], [50, 70], [70, 85], [85, 95], [95, 101]].forEach(([lo, hi]) => { const b = Q.filter((x) => x[path].conf >= lo && x[path].conf < hi); if (!b.length) return;
          ece += b.length / Q.length * Math.abs(b.filter((x) => x[path].pos === 1).length / b.length - b.reduce((a, x) => a + x[path].conf, 0) / b.length / 100); });
        Q.forEach((x) => { brier += (x[path].conf / 100 - (x[path].pos === 1 ? 1 : 0)) ** 2; });
        const clear = Q.filter((x) => x[path].margin >= 15), close = Q.filter((x) => !(x[path].margin >= 15));
        m.honesty = { ece: Math.round(1000 * ece) / 10, brier: Math.round(1000 * brier / Q.length) / 1000, clearN: clear.length, clearTop1: clear.filter((x) => x[path].pos === 1).length,
          closeN: close.length, closeTop1: close.filter((x) => x[path].pos === 1).length, closeTop3: close.filter((x) => x[path].pos && x[path].pos <= 3).length };
      }
      metrics[set + "." + path] = m;
      const sp = (k) => m[k] ? `${k} ${Math.round(100 * m[k].top1 / m[k].n)}/${Math.round(100 * m[k].top3 / m[k].n)}` : "";
      console.log(`${(set + " " + { cur: "keys", txt: "text", pc: "complaint" }[path]).padEnd(18)} top1 ${pct(m.all.top1, m.all.n)} top3 ${pct(m.all.top3, m.all.n)} absent ${m.absent}` +
        `  [top1/top3 % ${["train", "dev", "test"].map(sp).filter(Boolean).join(" · ")}]`);
      console.log(`${"".padEnd(18)} gate: abx when indicated ${pct(m.abxSens, m.abxN)} · when not ${pct(m.overcall, m.overN)} · critical ${pct(m.critical, m.critN)} · viral/self-limited ${pct(m.noAbxInf, m.noAbxN)} · malaria as specific therapy ${pct(m.specific, m.specN)}` +
        (m.opdTop1 != null ? ` · OPD rerank top1 ${pct(m.opdTop1, m.all.n)}` : ""));
      if (m.honesty) { const h = m.honesty; console.log(`${"".padEnd(18)} score honesty: clear lead ${pct(h.clearTop1, h.clearN)} right · close call ${pct(h.closeTop1, h.closeN)} right (top-3 ${pct(h.closeTop3, h.closeN)}) · ECE ${h.ece} · Brier ${h.brier}`); }
      if (m.insufficient) console.log(`${"".padEnd(18)} not enough information: ${m.insufficient.n} cases (top1 among them ${pct(m.insufficient.top1, m.insufficient.n)}; top1 on the rest ${pct(m.insufficient.restTop1, m.insufficient.restN)})`);
    }
  }
  const G = R.filter((x) => x.set === "gold" && x.extractRecall != null);
  if (G.length) {
    const rec = Math.round(100 * G.reduce((a, x) => a + x.extractRecall, 0) / G.length);
    const P = G.filter((x) => x.extractPrecision != null), prec = P.length ? Math.round(100 * P.reduce((a, x) => a + x.extractPrecision, 0) / P.length) : 0;
    metrics.extract = { recall: rec, precision: prec };
    console.log(`text extraction vs gold keys: recall ${rec}% · precision ${prec}% (precision is a lower bound: gold keys are not exhaustive)`);
  }

  if (MISSES) {
    for (const x of R.filter((x) => x.split === "train" || x.split === "dev")) {
      for (const path of ["cur", "txt"]) {
        const p = x[path]; if (!p || p.pos === 1) continue;
        console.log(`  miss ${x.split} ${path} ${x.id} want=${x.expect} pos=${p.pos || "-"} gate=${p.gate} got: ${p.top3.join(" | ")}`);
      }
    }
  }

  // ---- floors (ratchet) -------------------------------------------------------------------
  // higher-is-better counts must not fall; lower-is-better counts must not rise.
  const LOWER = new Set(["absent", "overcall", "noAbxInf"]);
  const flat = {};
  for (const [k, m] of Object.entries(metrics)) {
    if (k === "extract") { flat["extract.recall"] = m.recall; continue; }
    ["top1", "top3"].forEach((q) => { if (m.all) flat[`${k}.${q}`] = m.all[q]; });
    ["absent", "abxSens", "overcall", "critical", "noAbxInf", "specific", "opdTop1"].forEach((q) => { if (m[q] != null) flat[`${k}.${q}`] = m[q]; });
  }
  const floors = existsSync(FLOORS) ? JSON.parse(readFileSync(FLOORS, "utf8")) : {};
  if (WRITE) {
    floors[CONFIG] = flat;
    writeFileSync(FLOORS, JSON.stringify(floors, null, 1) + "\n");
    console.log(`floors written for ${CONFIG} -> ${FLOORS}`);
  }
  if (CHECK) {
    const f = floors[CONFIG];
    if (!f) { console.log(`no floors recorded for config ${CONFIG}`); exitCode = 1; }
    else {
      const bad = [];
      for (const [k, v] of Object.entries(f)) {
        const now = flat[k]; if (now == null) continue;
        const metric = k.split(".").pop();
        if (LOWER.has(metric) ? now > v : now < v) bad.push(`${k}: ${now} (floor ${v})`);
      }
      const better = Object.entries(f).filter(([k, v]) => flat[k] != null && (LOWER.has(k.split(".").pop()) ? flat[k] < v : flat[k] > v)).map(([k, v]) => `${k}: ${v} -> ${flat[k]}`);
      if (better.length) console.log(`improved (raise the floors with --write-floors once reviewed): ${better.join(", ")}`);
      if (bad.length) { console.log(`BELOW FLOOR (${CONFIG}):\n  ` + bad.join("\n  ")); exitCode = 1; }
      else console.log(`floors OK (${CONFIG})`);
    }
  }
} catch (e) { console.log("HARNESS ERROR", e && e.message || e); exitCode = 2; }
finally { chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(exitCode), 300); }
