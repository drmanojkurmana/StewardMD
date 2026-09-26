/* StewardMD - diagnostic + antibiotic-gate audit (measurement, not a pass/fail test).
 * Replays every gold case (kb/validation/cases.json + cases/*.json) through the REAL app in headless
 * Chrome three ways: (cur) curated engine keys -> SMD_REASON.assess; (txt) the full chart as text
 * (complaint, history, exam, vitals, labs, imaging, micro) -> DX.findingsFromText -> assess, and the
 * same through the OPD re-ranker (OPDEMR._clinicalRerank); (pc) presenting complaint only.
 * EXTRA=test/dx-heldout.json swaps in the held-out text vignettes (field `text`).
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-dx-audit.mjs
 * Output: $OUT (default <CLAUDE_JOB_DIR|/tmp>/dx-audit.json). See kb/validation/AUDIT-2026-09-26.md.
 */
import { dirname, join } from "node:path"; import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CDP = Number(process.env.CDP_PORT || 9477);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";
let cases = JSON.parse(readFileSync(ROOT + "/kb/validation/cases.json", "utf8"));
for (const f of readdirSync(ROOT + "/kb/validation/cases").filter((x) => x.endsWith(".json"))) cases.push(JSON.parse(readFileSync(ROOT + "/kb/validation/cases/" + f, "utf8")));
const extra = process.env.EXTRA ? JSON.parse(readFileSync(process.env.EXTRA, "utf8")) : null;
if (extra) cases = extra;
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${JOB}/dx-audit-prof`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable"); await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 80; i++) { await sleep(400); if ((await ev(`return !!(window.SMD_REASON&&window.DX&&window.SMD_NLP&&DX.findingsFromText)`)) === true) break; }
  await ev(`DX.findingCatalog(); return 1`);
  const rows = [];
  for (const c of cases) {
    const r = await ev(`
      var c=${JSON.stringify({ id: c.id, findings: c.findings || {}, exp: c.expected || {}, pc: c.presentingComplaint || c.chiefComplaint || "", hx: c.history || "", exam: c.examination || "", text: c.text || "", full: [c.presentingComplaint||c.chiefComplaint||"", c.history||"", c.examination||"", c.vitals? "Vitals: "+Object.entries(c.vitals).map(([k,v])=>k+" "+v).join(", ") : "", c.labs? "Labs: "+Object.entries(c.labs).map(([k,v])=>k+" "+v).join("; ") : "", typeof c.imaging==="string"?c.imaging:"", typeof c.microbiology==="string"?c.microbiology:""].join(". ") })};
      var acc=(c.exp.acceptableIds||[]).map(function(s){return String(s).toLowerCase();});
      function ok(x){ return !!x && (acc.indexOf(String(x.id).toLowerCase())>=0 || acc.some(function(a){return a && String(x.name||'').toLowerCase().indexOf(a)>=0;})); }
      function run(f){ var a=SMD_REASON.assess(f); var all=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence)-(x.rank!=null?x.rank:x.confidence))||(y.confidence-x.confidence);});
        var pos=0; for(var i=0;i<all.length;i++){ if(ok(all[i])){pos=i+1;break;} }
        return { gate:a.gate.cls, top1:all[0]?all[0].name:null, conf:all[0]?all[0].confidence:0, pos:pos, n:Object.keys(f).length, top3:all.slice(0,3).map(function(x){return x.name+'('+x.confidence+')';}) }; }
      function fromText(t){ var ks=DX.findingsFromText(t)||[]; var f={}; ks.forEach(function(k){f[k]=true;}); return f; }
      function opd(f){ var S=DX._state, sv=S.f; try{ S.f={}; Object.keys(f).forEach(function(k){S.f[k]=true;}); var d=DX._differential()||{}; var l=(d.inf||[]).concat(d.ni||[]).map(function(r){return {id:r.id,name:r.name,score:r.score};}); var rr=OPDEMR._clinicalRerank(l,Object.keys(f)); var pos=0; for(var i=0;i<rr.length;i++){ if(ok(rr[i])){pos=i+1;break;} } return {pos:pos, top1:rr[0]&&rr[0].name}; } finally { S.f=sv; } }
      var cur=run(c.findings); cur.opd=opd(c.findings);
      var narr=c.text || c.full;
      var ft=fromText(narr); var txt=run(ft); txt.opd=opd(ft);
      var pcf=fromText(c.pc||c.text); var pc=run(pcf);
      var gold=Object.keys(c.findings); var got=Object.keys(ft);
      var rec = gold.length? gold.filter(function(k){return ft[k];}).length/gold.length : null;
      return JSON.stringify({id:c.id, cur:cur, txt:txt, pc:pc, extractRecall:rec, extracted:got.length});`);
    const j = r && r[0] === "{" ? JSON.parse(r) : { id: c.id, err: r };
    const exp = c.expected || {};
    const st = exp.stewardship || {};
    // antibiotics indicated = gold lists at least one antibiotic (held-out cases carry `abx` directly)
    j.abx = typeof c.abx === "boolean" ? c.abx : !!(st.antibiotics && st.antibiotics.length);
    j.expect = (exp.acceptableIds || [])[0]; j.dx = exp.diagnosis; j.specialty = c.specialty;
    rows.push(j);
  }
  writeFileSync(process.env.OUT || JOB + "/dx-audit.json", JSON.stringify(rows, null, 1));
  const R = rows.filter((x) => x.expect && !x.err), n = R.length, pct = (a, b) => `${a}/${b} (${b ? Math.round(100 * a / b) : 0}%)`;
  const on = (g) => g === "very_likely" || g === "likely";
  console.log(`cases ${n} (errors ${rows.filter((r) => r.err).length})`);
  for (const [m, label] of [["cur", "curated keys"], ["txt", "chart text"], ["pc", "complaint only"]]) {
    if (m === "cur" && R.every((x) => !x.cur.n)) continue;   // held-out text cases carry no curated keys
    if (m === "pc" && extra) continue;                        // held-out text IS the complaint
    const p = R.map((x) => x[m].pos), A = R.filter((x) => x.abx), N = R.filter((x) => !x.abx);
    console.log(`${label.padEnd(15)} top1 ${pct(p.filter((x) => x === 1).length, n)}  top3 ${pct(p.filter((x) => x && x <= 3).length, n)}  absent ${p.filter((x) => !x).length}` +
      `  | gate abx when indicated ${pct(A.filter((x) => on(x[m].gate)).length, A.length)}  abx when not indicated ${pct(N.filter((x) => on(x[m].gate)).length, N.length)}` +
      (x => x ? `  | OPD rerank top1 ${pct(R.filter((y) => y[m].opd.pos === 1).length, n)}` : "")(m !== "pc"));
  }
} catch (e) { console.log("ERR", e); }
finally { chrome.kill(); setTimeout(() => process.exit(0), 300); }
