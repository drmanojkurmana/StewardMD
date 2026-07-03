/* StewardMD — MaiK KNOWLEDGE COVERAGE / GAP report (Phase 2, lawful coverage program).
 *
 * Runs a tagged clinician question set (test/maik-coverage-questions.json) through the REAL
 * production retrieval path — StewardRAG.buildPackage(SMD_REASON.assess({}), {question}) in a
 * headless page — and classifies whether the KB can ground each question, by capability:
 *   STRONG      expected topic retrieved AND a capability-relevant section is present
 *   PARTIAL     expected topic retrieved but the asked capability (dose/mgmt/redflag/…) is absent
 *   TOPIC_MISS  expected topic NOT among retrieved (topic confusion / not covered)
 *   MISS        nothing retrieved
 *   OOS_OK      out-of-scope probe that did NOT falsely lock onto one topic (honest limit — good)
 *   OOS_FALSEHIT out-of-scope probe that confidently grounded an unrelated topic (bad)
 * It measures coverage; it invents NO content. Writes kb/manifest/coverage-gap-report.json.
 *
 * USAGE: BASE=http://localhost:8903/ node test/run-maik-coverage.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9475);
const ROOT = new URL("../", import.meta.url).pathname;
const QFILE = ROOT + "test/maik-coverage-questions.json";
const OUT = ROOT + "kb/manifest/coverage-gap-report.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const questions = JSON.parse(readFileSync(QFILE, "utf8")).questions || JSON.parse(readFileSync(QFILE, "utf8"));

// capability-relevant chunk sections per question type
const SECT = {
  management: /management|treatment|pathogen|stewardship/i,
  empiric_antibiotics: /management|treatment|pathogen|stewardship/i,
  dosing: /management\.treatment|treatment|management/i,
  red_flags: /redflag/i,
  investigations: /investigation/i,
  differential: /differential|mimic/i,
  clinical_features: /pearl|overview|pathophysiolog/i,
  diagnosis: /overview|reasoning|pearl/i,
  severity: /severity/i,
  special_population: /management|treatment/i,
  follow_up: /./,
  out_of_scope: /./,
};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/maik-chrome-cov`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  await sleep(1500);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(500);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "2" });
  for (let i = 0; i < 100; i++) { await sleep(400); if (await ev(`return !!(window.StewardRAG && window.SMD_REASON && window.StewardRAG.ready)`) === true) break; }
  await ev(`try{if(window.SMD_AI&&SMD_AI.setFlag)SMD_AI.setFlag(true);}catch(e){} return 1;`);
  await ev(`return window.StewardRAG.ready().then(function(){return 1;});`);

  async function retrieveFor(q) {
    const expr = `return window.StewardRAG.ready().then(function(){ return window.StewardRAG.buildPackage(window.SMD_REASON.assess({}), { question: ${JSON.stringify(q)} }); }).then(function(pkg){ var r=(pkg&&pkg.retrieved)||[]; var titles=(window.SMD_MaiK&&SMD_MaiK.sourceTitles)?SMD_MaiK.sourceTitles(r):[]; return JSON.stringify({ n:r.length, top:r.slice(0,8).map(function(c){return {d:c.diseaseId, s:c.section, sc:c.score};}), titles:titles }); });`;
    const raw = await ev(expr);
    try { return JSON.parse(raw); } catch { return { n: 0, top: [], titles: [], err: raw }; }
  }

  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const it = questions[i];
    const r = await retrieveFor(it.q);
    const expId = it.expectTopicId ? norm(it.expectTopicId) : null;
    const topicChunks = r.top.filter((c) => norm(c.d) === expId);
    const topicHit = expId && topicChunks.length > 0;
    const capRe = SECT[it.qType] || /./;
    const capHit = topicHit ? topicChunks.some((c) => capRe.test(c.s)) : false;
    let verdict;
    if (it.qType === "out_of_scope" || !it.expectTopicId) {
      // out-of-scope probe. A very high dominant score means the named topic is ACTUALLY in the KB
      // (the generator mislabeled an in-KB topic as out-of-scope) — that is correct retrieval, not a
      // false hit. A moderate dominant lock on a genuinely unseen topic is a real false-fit. Low /
      // scattered retrieval is the honest "can't answer" behaviour we want.
      const topScore = r.top[0] ? r.top[0].sc : 0;
      const nTop = r.top[0] ? r.top.filter((c) => norm(c.d) === norm(r.top[0].d)).length : 0;
      if (topScore >= 40 && nTop >= 2) verdict = "INKB_MISLABELED";      // topic is really covered
      else if (nTop >= 3 && topScore >= 8) verdict = "OOS_FALSEHIT";     // locked an unseen topic
      else verdict = "OOS_OK";                                           // honest limit (good)
    } else if (r.n === 0) verdict = "MISS";
    else if (!topicHit) verdict = "TOPIC_MISS";
    else if (capHit) verdict = "STRONG";
    else verdict = "PARTIAL";
    const harrisonLeak = (r.titles || []).some((tt) => /harrison/i.test(tt));
    results.push({ ...it, verdict, retrievedTop: r.top[0] || null, topicRank: topicHit ? r.top.findIndex((c) => norm(c.d) === expId) : -1, sources: r.titles, harrisonLeak });
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${questions.length}`);
  }

  // tallies
  const tally = (arr, key) => arr.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  const byVerdict = tally(results, "verdict");
  const bySpecialty = {};
  results.forEach((r) => { const s = bySpecialty[r.specialty] = bySpecialty[r.specialty] || {}; s[r.verdict] = (s[r.verdict] || 0) + 1; });
  const byType = {};
  results.forEach((r) => { const s = byType[r.qType] = byType[r.qType] || {}; s[r.verdict] = (s[r.verdict] || 0) + 1; });
  const inScope = results.filter((r) => r.expectTopicId);
  const good = inScope.filter((r) => r.verdict === "STRONG").length;
  const partial = inScope.filter((r) => r.verdict === "PARTIAL").length;
  const leaks = results.filter((r) => r.harrisonLeak).length;
  const gapProbeMiss = results.filter((r) => r.isGapProbe && /MISS|PARTIAL|OOS_OK/.test(r.verdict)).length;

  const report = {
    generated: "run-maik-coverage.mjs",
    base: BASE,
    totals: { questions: results.length, inScope: inScope.length,
      strongPct: Math.round((good / inScope.length) * 1000) / 10,
      partialPct: Math.round((partial / inScope.length) * 1000) / 10 },
    byVerdict, byType, bySpecialty,
    proprietaryLabelLeaks: leaks,
    gapProbesBehavingAsExpected: gapProbeMiss + "/" + results.filter((r) => r.isGapProbe).length,
    results,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\nCOVERAGE GAP REPORT — ${results.length} questions (${inScope.length} in-scope)`);
  console.log("Verdicts:", JSON.stringify(byVerdict));
  console.log(`In-scope STRONG: ${report.totals.strongPct}%  · PARTIAL: ${report.totals.partialPct}%`);
  console.log("Proprietary (Harrison) label leaks in Sources:", leaks, leaks === 0 ? "✅" : "❌");
  console.log("By qType (verdict counts):");
  Object.entries(byType).forEach(([k, v]) => console.log("  " + k.padEnd(20) + JSON.stringify(v)));
  console.log("\n→ " + OUT);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
