/* StewardMD — Clinical Validation: Gold-Standard Case Replay (Phase 6, QA only)
 *
 * Replays every gold-standard case (kb/validation/cases.json [+ cases/*.json])
 * through the REAL deterministic engine (SMD_REASON = Clinical Reasoning AND Dx My
 * Patient), the Stewardship resolver (interface.mjs via StewardRAG.buildPackage),
 * and MaiK (MOCKED — no key, no external call). Compares each output to the gold
 * answer, aggregates metrics, checks regression vs baseline, and writes a report +
 * a standalone Admin Validation Dashboard (HTML). Modifies NO app code.
 *
 * USAGE:
 *   node test/run-case-validation.mjs                 # replay + compare to baseline
 *   node test/run-case-validation.mjs --rebaseline    # write kb/validation/baseline.json
 *   BASE=http://localhost:8799/ node test/run-case-validation.mjs
 * Output: <CLAUDE_JOB_DIR|/tmp>/validation/{cases-report.md,cases-report.json,dashboard.html}
 * Exit: 1 if any case REGRESSED (correct→incorrect) — never merge accuracy drops.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "https://stewardmd.in").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP = Number(process.env.CDP_PORT || 9431);
const REBASELINE = process.argv.includes("--rebaseline");
const OUTDIR = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/validation";
mkdirSync(OUTDIR, { recursive: true });
const BASELINE = join(ROOT, "kb", "validation", "baseline.json");

// ---- load cases (array file + optional per-file dir) ----
let cases = [];
const cf = join(ROOT, "kb", "validation", "cases.json");
if (existsSync(cf)) cases = JSON.parse(readFileSync(cf, "utf8"));
const cdir = join(ROOT, "kb", "validation", "cases");
if (existsSync(cdir)) for (const f of readdirSync(cdir).filter((x) => x.endsWith(".json"))) cases.push(JSON.parse(readFileSync(join(cdir, f), "utf8")));
if (!cases.length) { console.error("no validation cases found"); process.exit(2); }

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${OUTDIR}/cases-prof`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  const t0 = Date.now();
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.SMD_REASON && window.KB_ENRICHMENT && window.StewardRAG);`) === true) { ready = true; break; } }
  if (!ready) throw new Error("engine/RAG not loaded");
  // Default = PRODUCTION config (expanded KB OFF). --expanded opts into the experimental
  // Phase-4 reference diseases (which can currently outrank curated dx — pending review).
  // MaiK is graded structurally via SMD_MaiK.compose (no network/flag needed).
  const EXPANDED = process.argv.includes("--expanded");
  await ev(`try{ if(window.SMD_setKbExpanded) SMD_setKbExpanded(${EXPANDED}); await window.StewardRAG.ready(); }catch(e){} return 1;`);
  const kb = JSON.parse(await ev(`return JSON.stringify({enrichment: Object.keys((window.KB_ENRICHMENT&&KB_ENRICHMENT.byId)||{}).length, expanded: (window.KB_EXPANDED&&KB_EXPANDED.count)||0, treatments: (window.KB_RAG&&KB_RAG.treatments)?Object.keys(KB_RAG.treatments).length:0, expandedOn: (window.SMD_kbExpandedCount?SMD_kbExpandedCount().on:false)});`) || "{}");

  const rows = []; let times = [];
  for (const c of cases) {
    const started = Date.now();
    const r = await ev(`
      var c=${JSON.stringify(c)};
      var t=Date.now();
      var aa=window.SMD_REASON.assess(c.findings||{});
      var top=[].concat(aa.infectious||[],aa.nonInfectious||[]).sort(function(x,y){return ((y.rank!=null?y.rank:y.confidence||0)-(x.rank!=null?x.rank:x.confidence||0))||((y.confidence||0)-(x.confidence||0));});
      var t3=top.slice(0,3);
      var ms=Date.now()-t;
      function idOK(cand){ var acc=(c.expected.acceptableIds||[]).map(function(s){return String(s).toLowerCase();}); return acc.indexOf(String(cand.id).toLowerCase())>=0 || acc.some(function(a){return String(cand.name||'').toLowerCase().indexOf(a)>=0;}); }
      var top1=t3[0]||{}; var top1ok=idOK(top1); var top3ok=t3.some(idOK);
      // stewardship via grounded package (interface.resolveTreatment)
      // stewardship via grounded package — timeout-raced so a stall can NEVER lose the
      // (reliable, synchronous) diagnosis metrics computed above.
      var pkg=null; try{ pkg=await Promise.race([window.StewardRAG.buildPackage(aa,{caseData:{age:c.age,sex:c.sex,findings:(c.symptoms||[])}}), new Promise(function(res){setTimeout(function(){res(null);},8000);})]); }catch(e){}
      var tx=pkg&&pkg.treatment; var drugRefs=[]; if(tx){ if(tx.default&&tx.default.drugRefs)drugRefs=drugRefs.concat(tx.default.drugRefs); (tx.alternatives||[]).forEach(function(a){drugRefs=drugRefs.concat(a.drugRefs||[]);}); }
      var expAbx=(c.expected.stewardship&&c.expected.stewardship.antibiotics||[]).map(function(s){return String(s).toLowerCase();});
      var abxOK = expAbx.length===0 ? null : expAbx.some(function(a){return drugRefs.some(function(d){return String(d).toLowerCase().indexOf(a)>=0||a.indexOf(String(d).toLowerCase())>=0;});});
      var stewOK = !!(tx && tx.default);
      // investigation quality: does the RETRIEVED StewardMD KB (investigation chunks)
      // cover the expected investigations? (measured from the grounded package)
      var invText=[];
      if(pkg){ (pkg.grounding||[]).forEach(function(g){(g.knowledge||[]).forEach(function(k){ if(/investigation/i.test(k.section)) invText.push(String(k.text).toLowerCase()); });});
        (pkg.retrieved||[]).forEach(function(k){ if(/investigation/i.test(k.section)) invText.push(String(k.text).toLowerCase()); }); }
      var blob=invText.join(' ');
      var expInv=(c.expected.investigations||[]).map(function(s){return String(s).toLowerCase();});
      var invHit=expInv.filter(function(e){ var w=e.replace(/[^a-z0-9 ]/g,' ').split(/\\s+/).filter(function(x){return x.length>3;}); return w.some(function(x){return blob.indexOf(x)>=0;}); }).length;
      var invQuality = expInv.length? Math.round(100*invHit/expInv.length):null;
      // MaiK (mock) — structural success only
      var maikOK=false; try{ maikOK = !!(pkg && window.SMD_MaiK && /Independent Clinical Commentary/.test(window.SMD_MaiK.compose(pkg,{text:'### Additional differentials\\n- x',citations:[]}))); }catch(e){}
      return JSON.stringify({ id:c.id, dx:c.expected.diagnosis, top1:top1.name, top1id:top1.id, conf:top1.confidence,
        top1ok:top1ok, top3ok:top3ok, top3:t3.map(function(x){return x.name+'('+x.confidence+')';}),
        stewOK:stewOK, stewTier:tx&&tx.default?tx.default.tier:null, abxOK:abxOK, drugRefs:drugRefs.slice(0,6),
        invQuality:invQuality, maikOK:maikOK, ms:ms });`);
    const j = (typeof r === "string" && r[0] === "{") ? JSON.parse(r) : { id: c.id, error: String(r) };
    j.wallMs = Date.now() - started; times.push(j.ms || j.wallMs);
    rows.push(j);
    console.log(`  ${j.top1ok ? "✅" : "❌"} ${j.id} → "${j.top1}" (${j.conf}) [top3:${j.top3ok ? "y" : "n"} abx:${j.abxOK} inv:${j.invQuality}% ${j.ms}ms]`);
  }

  // ---- aggregate metrics ----
  const n = rows.length;
  const top1 = rows.filter((r) => r.top1ok).length, top3 = rows.filter((r) => r.top3ok).length;
  const stew = rows.filter((r) => r.stewOK).length;
  const abxScored = rows.filter((r) => r.abxOK !== null && r.abxOK !== undefined);
  const abxOK = abxScored.filter((r) => r.abxOK).length;
  const invScored = rows.filter((r) => typeof r.invQuality === "number");
  const invAvg = invScored.length ? Math.round(invScored.reduce((a, r) => a + r.invQuality, 0) / invScored.length) : null;
  const confAvg = Math.round(rows.reduce((a, r) => a + (r.conf || 0), 0) / n);
  const maik = rows.filter((r) => r.maikOK).length;
  const avgMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const metrics = {
    casesTested: n,
    primaryDxCorrect: `${top1}/${n} (${Math.round(100 * top1 / n)}%)`,
    top3Accuracy: `${top3}/${n} (${Math.round(100 * top3 / n)}%)`,
    stewardshipResolved: `${stew}/${n}`,
    antibioticCorrect: abxScored.length ? `${abxOK}/${abxScored.length} (${Math.round(100 * abxOK / abxScored.length)}%)` : "n/a",
    investigationQualityAvg: invAvg != null ? invAvg + "%" : "n/a",
    avgReasoningConfidence: confAvg + "/100",
    maikAgreement: `mock: ${maik}/${n} pipeline-ok (agreement needs live key)`,
    avgResponseMs: avgMs,
    kbIntegrity: kb
  };

  // ---- regression vs baseline ----
  let regression = { status: "no-baseline", improved: [], unchanged: [], regressed: [] };
  const cur = {}; rows.forEach((r) => { cur[r.id] = { top1ok: !!r.top1ok, conf: r.conf || 0 }; });
  if (REBASELINE) { writeFileSync(BASELINE, JSON.stringify({ generatedAt: "rebaseline", cases: cur }, null, 2)); regression.status = "baseline-written"; }
  else if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, "utf8")).cases || {};
    rows.forEach((r) => {
      const b = base[r.id]; if (!b) { regression.improved.push(r.id + " (new)"); return; }
      if (!b.top1ok && r.top1ok) regression.improved.push(r.id + " (now correct)");
      else if (b.top1ok && !r.top1ok) regression.regressed.push(r.id + " (was correct → now wrong)");
      else if (r.top1ok && (r.conf || 0) < b.conf - 5) regression.regressed.push(r.id + ` (confidence ${b.conf}→${r.conf})`);
      else regression.unchanged.push(r.id);
    });
    regression.status = regression.regressed.length ? "REGRESSED" : "OK";
  }

  // ---- reports ----
  const report = { base: BASE, generatedAt: new Date().toISOString(), metrics, regression, cases: rows };
  writeFileSync(OUTDIR + "/cases-report.json", JSON.stringify(report, null, 2));
  const md = [];
  md.push(`# StewardMD — Clinical Validation (Gold-Standard Case Replay)`);
  md.push(`Target: ${BASE} · ${n} cases · engine + expanded KB (${kb.expandedOn ? "ON" : "off"}) · MaiK mocked`);
  md.push(`\n## Metrics`);
  Object.keys(metrics).forEach((k) => { if (k !== "kbIntegrity") md.push(`- **${k}**: ${metrics[k]}`); });
  md.push(`- **kbIntegrity**: enrichment ${kb.enrichment} · expanded ${kb.expanded} · treatments ${kb.treatments}`);
  md.push(`\n## Regression: ${regression.status}`);
  md.push(`- improved: ${regression.improved.join(", ") || "—"}`);
  md.push(`- regressed: ${regression.regressed.join(", ") || "—"}`);
  md.push(`\n## Per-case\n| Case | Expected | Engine top-1 | Conf | Top-1 | Top-3 | Abx | Inv% |\n|---|---|---|---|---|---|---|---|`);
  rows.forEach((r) => md.push(`| ${r.id} | ${esc(r.dx)} | ${esc(r.top1)} | ${r.conf} | ${r.top1ok ? "✅" : "❌"} | ${r.top3ok ? "✅" : "❌"} | ${r.abxOK === null ? "n/a" : r.abxOK ? "✅" : "❌"} | ${r.invQuality == null ? "n/a" : r.invQuality} |`));
  writeFileSync(OUTDIR + "/cases-report.md", md.join("\n") + "\n");

  // ---- Admin Validation Dashboard (standalone HTML; dev/admin-only artifact) ----
  const card = (label, val, ok) => `<div class="c"><div class="v" style="color:${ok === false ? "#dc2626" : ok === true ? "#16a34a" : "#0f172a"}">${esc(val)}</div><div class="l">${esc(label)}</div></div>`;
  const dash = `<!doctype html><meta charset=utf-8><title>StewardMD Clinical Validation Dashboard</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;background:#f6f7f5;color:#0f172a;margin:0;padding:24px}h1{font-size:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:16px 0}.c{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px}.v{font:800 22px system-ui}.l{color:#64748b;font-size:12px;margin-top:4px}table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}th,td{padding:8px 10px;border-bottom:1px solid #eef2f6;text-align:left;font-size:13px}th{background:#0f766e;color:#fff}.b{font-weight:700}.reg{padding:10px 14px;border-radius:10px;font-weight:700;display:inline-block}.ok{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92620a}.note{color:#64748b;font-size:12px;margin-top:18px}</style>
<h1>🧪 StewardMD Clinical Validation Dashboard <span style="font-size:12px;color:#64748b">(Developer / Admin mode)</span></h1>
<div style="color:#64748b;font-size:12px">${esc(BASE)} · ${new Date().toISOString()} · ${n} gold cases</div>
<div class="grid">
${card("Clinical cases tested", n)}
${card("Correct primary diagnosis", metrics.primaryDxCorrect, top1 === n)}
${card("Top-3 accuracy", metrics.top3Accuracy, top3 === n)}
${card("Stewardship resolved", metrics.stewardshipResolved)}
${card("Antibiotic correctness", metrics.antibioticCorrect)}
${card("Avg reasoning confidence", metrics.avgReasoningConfidence)}
${card("Investigation quality", metrics.investigationQualityAvg)}
${card("MaiK agreement", "mock", null)}
${card("Avg response time", metrics.avgResponseMs + " ms")}
${card("KB integrity", kb.enrichment + " dz / " + kb.treatments + " tx")}
${card("Regression", regression.status, regression.status === "OK" || regression.status === "baseline-written")}
</div>
<div class="reg ${regression.status === "REGRESSED" ? "bad" : regression.status === "OK" || regression.status === "baseline-written" ? "ok" : "warn"}">Regression: ${esc(regression.status)} — improved ${regression.improved.length} · regressed ${regression.regressed.length} · unchanged ${regression.unchanged.length}</div>
<h2 style="margin-top:22px">Per-case results</h2>
<table><tr><th>Case</th><th>Expected diagnosis</th><th>Engine top-1</th><th>Conf</th><th>Top-1</th><th>Top-3</th><th>Antibiotic</th><th>Inv%</th><th>ms</th></tr>
${rows.map((r) => `<tr><td class=b>${esc(r.id)}</td><td>${esc(r.dx)}</td><td>${esc(r.top1)}</td><td>${r.conf}</td><td>${r.top1ok ? "✅" : "❌"}</td><td>${r.top3ok ? "✅" : "❌"}</td><td>${r.abxOK === null ? "—" : r.abxOK ? "✅" : "❌"}</td><td>${r.invQuality == null ? "—" : r.invQuality}</td><td>${r.ms}</td></tr>`).join("")}
</table>
<div class="note">MaiK agreement is measured with a MOCKED Gemini (pipeline validation only); real agreement requires a live GEMINI_API_KEY. Expanded KB was ${kb.expandedOn ? "ENABLED" : "off"} for replay so reference diseases participate. Audit only — no application code modified.</div>`;
  writeFileSync(OUTDIR + "/dashboard.html", dash);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Primary dx: ${metrics.primaryDxCorrect} · Top-3: ${metrics.top3Accuracy} · Abx: ${metrics.antibioticCorrect} · Conf: ${metrics.avgReasoningConfidence} · ${avgMs}ms`);
  console.log(`Regression: ${regression.status}` + (regression.regressed.length ? " → " + regression.regressed.join(", ") : ""));
  console.log(`Reports: ${OUTDIR}/cases-report.md · dashboard.html · cases-report.json`);
  process.exitCode = regression.regressed.length ? 1 : 0;
} catch (e) { console.log("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { try { chrome.kill(); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 400); }
