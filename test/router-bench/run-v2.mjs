// MaiK router benchmark v2 — full human-language suite scorer.
// Produces the six metrics the report needs: intent accuracy, entity-linking accuracy,
// retrieval accuracy, clarification (precision/recall + false-clarify), latency, and
// Gemini-bypass rate — broken down PER CATEGORY, with every failure logged. Writes
// results-v2.json + REPORT.md.
//
// Usage:  node test/router-bench/run-v2.mjs            (live: hits prod router + retrieve; needs quota)
//         node test/router-bench/run-v2.mjs --dry      (quota-free: skips Vertex router, validates
//                                                        gold labels + retrieval + KB-bypass via the
//                                                        OFFLINE fallback resolver — for harness QA)
//         MAXQ=260 node ... / FILES=hl-voice,hl-typos node ...   (cap / subset)
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..", "..");
const DRY = process.argv.includes("--dry");
const MAXQ = Number(process.env.MAXQ || 260);
const ONLY = (process.env.FILES || "").split(",").map(s => s.trim()).filter(Boolean);
const ROUTER = "https://stewardmd.in/api/ai/route";
const RETRIEVE = "https://stewardmd.in/api/retrieve";
const CONC = 6;

// ---- load KB globals (same pattern as test/maik-v2-kb.test.mjs) ----
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const load = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) { throw new Error("load " + r + ": " + e.message); } };
["kb/dist/kb.core.js", "kb/dist/kb.clinical.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "kb/dist/kb.expanded.js", "dxmgmt.js", "clinical-vocab.js", "kb/ai/maik-kb.js"].forEach(load);
const { KB_ENRICHMENT: KE, DX_MGMT: DXM, KB_RAG: KR, MaiKKB } = globalThis;

// ---- name/id resolution (from the KB test) ----
const SPELL = [[/aemia/g, "emia"], [/aemic/g, "emic"], [/ischaem/g, "ischem"], [/oedem/g, "edem"], [/paediatr/g, "pediatr"], [/tumour/g, "tumor"], [/anaem/g, "anem"], [/haemo/g, "hemo"], [/oesophag/g, "esophag"]];
const norm0 = s => String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
const medNorm = s => { let x = norm0(s); for (const [a, b] of SPELL) x = x.replace(a, b); return x; };
const STOP = new Set("what is are the of for in a an treatment treat manage management dose dosing causes cause differential differentials symptoms features investigations investigation workup red flags prognosis pathophysiology how to do i you clinical signs overview about tell me explain".split(" "));
const GENERIC = new Set("acute chronic severe mild moderate syndrome disease disorder primary secondary".split(" "));
const idx = []; const seen = {};
const NAME = {};
const addIdx = (id, nm) => { if (!id || seen[id]) return; seen[id] = 1; const disp = nm || id.replace(/_/g, " "); NAME[id] = disp; const n = medNorm(disp); const toks = n.split(" ").filter(t => t.length >= 4); if (toks.length) idx.push({ id, nm: n, toks, head: toks.slice().sort((a, b) => b.length - a.length)[0] }); };
Object.keys(KE.byId).forEach(id => addIdx(id, KE.byId[id].name));
Object.keys(DXM).forEach(id => addIdx(id, null));
Object.keys(KR.treatments).forEach(id => addIdx(id, null));
function resolveId(q) {
  const qn = medNorm(MaiKKB.expandAbbrev ? MaiKKB.expandAbbrev(q) : q);
  const qt = new Set(qn.split(" ").filter(t => t.length >= 4 && !STOP.has(t)));
  let best = null, bestFull = 0, bestCov = 0;
  for (const it of idx) {
    if (qn.indexOf(it.nm) >= 0) { if (it.nm.length > bestFull) { best = it; bestFull = it.nm.length; } continue; }
    if (bestFull || !it.head || !qt.has(it.head)) continue;
    const sig = it.toks.filter(t => !GENERIC.has(t));
    const cov = sig.length ? sig.filter(t => qt.has(t)).length / sig.length : 0;
    if (cov >= 0.5 && cov > bestCov) { best = it; bestCov = cov; }
  }
  return best ? best.id : null;
}
function pkgForId(id, q) {
  if (!id) return { question: q, grounding: [], topicMatch: { matched: false } };
  const e = KE.byId[id] || {};
  return { question: q, grounding: [{ diseaseId: id, name: e.name || id.replace(/_/g, " "), knowledge: [] }], topicMatch: { matched: true, mode: "confident" } };
}

// ---- scoring helpers (concept/intent match from run.mjs) ----
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const GEN = new Set("syndrome disease disorder acute chronic the a an of category type primary secondary score criteria test".split(" "));
const toks = s => norm(s).split(" ").filter(w => w.length >= 4 && !GEN.has(w));
const acr = s => norm(s).split(" ").filter(Boolean).map(w => w[0]).join("");
const compact = s => norm(s).replace(/ /g, "");
function conceptMatch(gold, got) {
  if (!got) return false;
  const gn = norm(gold), rn = norm(got); if (!gn) return true;
  const g = toks(gold), r = toks(got);
  if (g.length && g.filter(w => rn.includes(w)).length / g.length >= 0.5) return true;
  if (r.length && r.filter(w => gn.includes(w)).length / r.length >= 0.5) return true;
  const cg = compact(gold), cr = compact(got);
  if (cg.length <= 7 && acr(got).includes(cg)) return true;
  if (cr.length <= 7 && acr(gold).includes(cr)) return true;
  if (cg.length >= 5 && cr.includes(cg)) return true;
  return false;
}
// Only TRUE synonyms are merged — etiology/causes and differential are kept DISTINCT so a
// cause-vs-differential intent error is not silently absorbed (the report must show real failures).
const INTENT_EQ = { causes: "etiology", diagnosis: "investigation", dx: "investigation", management: "treatment", mgmt: "treatment", prophylaxis: "prevention", risk: "risk_factors" };
const ieq = i => INTENT_EQ[i] || i || "";
// does diseaseId `id` correspond to gold concept? (retrieval scoring)
const ALLIDS = Object.keys(KE.byId);
function matchName(gold, id) {
  const nm = NAME[id] || id; const g = toks(gold), r = new Set(toks(nm).concat(toks(String(id).replace(/_/g, " "))));
  if (!g.length) return false;
  return g.filter(w => r.has(w) || norm(nm).includes(w) || String(id).toLowerCase().includes(w)).length / g.length >= 0.5;
}
const isDiseaseGold = gold => ALLIDS.some(id => matchName(gold, id));
const isComplexLocal = q => MaiKKB.isComplex ? MaiKKB.isComplex(q) : /\bvs\b|versus|compare|latest|newest|recent|2023|2024|2025|\byo\b|year old|should i/i.test(q);

// ---- load bank ----
const bank = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith(".json") || f.startsWith("results") || f.startsWith("REPORT")) continue;
  const base = f.replace(".json", "");
  if (ONLY.length && !ONLY.includes(base)) continue;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    if (Array.isArray(a)) a.forEach(x => bank.push({ ...x, cat: x.cat || ("specialty:" + base), file: base, isNew: base.startsWith("hl-") }));
  } catch (e) { console.error("bad bank file", f, e.message); }
}
// NEW-first cap so the human-language categories (the request focus) are always fully covered.
bank.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
const capped = bank.slice(0, MAXQ);
const dropped = bank.length - capped.length;
console.log(`bank ${bank.length} | running ${capped.length}${dropped ? ` (capped, ${dropped} specialty queries dropped to fit budget)` : ""} | mode ${DRY ? "DRY (offline fallback, no Vertex)" : "LIVE"}`);

// ---- per-query pipeline ----
async function routeLive(q) {
  const t0 = Date.now();
  try {
    const r = await fetch(ROUTER, { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://stewardmd.in" }, body: JSON.stringify({ q }) });
    const j = await r.json();
    return { j, ms: Date.now() - t0, quota: (j.error === "quota" || j.error === "route-failed") };
  } catch (e) { return { j: { _err: String(e) }, ms: Date.now() - t0, quota: false }; }
}
function routeOffline(q) {   // stand-in for --dry: the no-Vertex fallback resolver
  const id = resolveId(q);
  const intent = MaiKKB.classifyIntent ? MaiKKB.classifyIntent(q) : "other";
  return { j: { primaryConcept: id ? NAME[id] : "", intent, ambiguous: false, options: [], confidence: id ? 0.85 : 0.3 }, ms: 0, quota: false, offline: true };
}
async function retrieve(q) {
  const t0 = Date.now();
  try {
    const r = await fetch(RETRIEVE, { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://stewardmd.in" }, body: JSON.stringify({ query: q, k: 12 }) });
    const j = await r.json();
    const ids = []; const s = {};
    ((j && j.matches) || []).forEach(m => { const d = m && m.diseaseId; if (d && !s[d]) { s[d] = 1; ids.push(d); } });
    return { ids, ms: Date.now() - t0 };
  } catch (e) { return { ids: null, ms: Date.now() - t0 }; }
}
async function scoreOne(item) {
  const gold = item.concept, dz = isDiseaseGold(gold);
  const R = DRY ? routeOffline(item.q) : await routeLive(item.q);
  if (R.quota) return { ...item, dz, quota: true };
  const j = R.j || {};
  const got = j.primaryConcept || j.topic || "";
  const gotI = j.intent || "";
  const amb = !!j.ambiguous;
  // entity linking: name-level + KB-node-level
  const elName = conceptMatch(gold, got);
  const goldId = item.dz || resolveId(gold);
  const gotId = resolveId(got || item.q);
  const elNode = dz ? (!!goldId && goldId === gotId) : elName;
  // retrieval + RESPONSE TIME: the client fires the vector arm on the query text; time it (this is
  // the network term in the user-perceived KB-instant path alongside the router call).
  const rawRet = await retrieve(item.q);          // client vector arm (raw query) — always, for e2e timing
  const retrieveMs = rawRet.ms;
  const retrRaw = (dz && rawRet.ids) ? rawRet.ids.slice(0, 10).some(id => matchName(gold, id)) : null;
  let retr = null;
  if (dz) { const c = await retrieve(got || item.q); retr = c.ids ? c.ids.slice(0, 10).some(id => matchName(gold, id)) : null; }
  // Gemini bypass: would the KB answer without Gemini? (client route -> concept -> compose, conf gate)
  const composeConcept = got || item.q;
  let kbAnswer = null; const c0 = Date.now();
  try { kbAnswer = MaiKKB.compose(item.q, pkgForId(gotId, item.q), { concept: composeConcept, intent: gotI }); } catch (e) { kbAnswer = null; }
  const composeMs = Date.now() - c0;
  const bypass = !amb && !isComplexLocal(item.q) && !!kbAnswer;
  // Response-time model matched to the ACTUAL client (home.js runClinical): buildPackage (vector arm,
  // client-capped at 3000ms, SKIPPED when the lexical pick is name-sure) -> getRoute -> compose, run
  // SEQUENTIALLY. So:
  //   e2eFast = router + compose           (name-sure: vector arm skipped — the common clean-query case)
  //   e2eVec  = router + min(retr,3000) + compose   (vector arm fires; sequential, as the client does today)
  //   e2ePar  = max(router, min(retr,3000)) + compose  (PROPOSED: router & retrieval parallelised)
  const retrEff = Math.min(retrieveMs, 3000);   // client hard-caps the vector arm at 3000ms then falls back
  const e2eFast = R.ms + composeMs;
  const e2eVec = R.ms + retrEff + composeMs;
  const e2ePar = Math.max(R.ms, retrEff) + composeMs;
  const shouldBypass = dz && !item.ambiguous && !item.defer;
  const shouldDefer = !!item.defer;
  return {
    q: item.q, cat: item.cat, dz, gold, got, goldI: item.intent, gotI,
    iOK: ieq(gotI) === ieq(item.intent),
    elName, elNode,
    retr, retrRaw,
    amb, goldAmb: !!item.ambiguous,
    bypass, shouldBypass, shouldDefer,
    conf: (typeof j.confidence === "number") ? j.confidence : null,
    ms: R.ms, routerMs: R.ms, retrieveMs, composeMs, e2eFast, e2eVec, e2ePar, offline: !!R.offline
  };
}

// SERIAL latency probe (CONC=1) — authoritative SINGLE-USER response time (a clinician issues one query
// at a time; the concurrent accuracy run below inflates /api/retrieve latency via Workers-AI queuing).
const LATN = Number(process.env.LATN || 16);
const step = Math.max(1, Math.floor(capped.length / LATN));
const probeItems = capped.filter((_, i) => i % step === 0).slice(0, LATN);
const probe = [];
for (const it of probeItems) {
  const R = DRY ? routeOffline(it.q) : await routeLive(it.q);
  if (R.quota) continue;
  const ret = await retrieve(it.q);
  const retrEff = Math.min(ret.ms, 3000);
  probe.push({ router: R.ms, retrieve: ret.ms, fast: R.ms + 2, vec: R.ms + retrEff + 2, par: Math.max(R.ms, retrEff) + 2, offline: !!R.offline });
}
console.log("serial latency probe: " + probe.length + " queries measured single-user (CONC=1)");

const out = new Array(capped.length); let idx2 = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (idx2 < capped.length) { const k = idx2++; out[k] = await scoreOne(capped[k]); } }));
const scored = out.filter(r => r && !r.quota);
const quotaN = out.filter(r => r && r.quota).length;

// ---- aggregate ----
const pct = (num, den) => den ? Math.round(1000 * num / den) / 10 + "%" : "n/a";
const dzScored = scored.filter(r => r.dz);
const M = {
  n: scored.length, quota: quotaN,
  intent: pct(scored.filter(r => r.iOK).length, scored.length),
  elName: pct(scored.filter(r => r.elName).length, scored.length),
  elNode: pct(dzScored.filter(r => r.elNode).length, dzScored.length),
  retr: pct(dzScored.filter(r => r.retr === true).length, dzScored.filter(r => r.retr !== null).length),
  retrRaw: pct(dzScored.filter(r => r.retrRaw === true).length, dzScored.filter(r => r.retrRaw !== null).length),
  clarifyRate: pct(scored.filter(r => r.amb).length, scored.length),
  clarifyRecall: pct(scored.filter(r => r.goldAmb && r.amb).length, scored.filter(r => r.goldAmb).length),
  clarifyPrec: pct(scored.filter(r => r.amb && r.goldAmb).length, scored.filter(r => r.amb).length),
  falseClarify: pct(scored.filter(r => r.amb && !r.goldAmb).length, scored.filter(r => !r.goldAmb).length),
  bypass: pct(scored.filter(r => r.bypass).length, scored.length),
  bypassCorrect: pct(scored.filter(r => r.bypass === r.shouldBypass).length, scored.length),
  wrongBypass: scored.filter(r => r.bypass && r.shouldDefer).length,   // answered a defer-query from KB (BAD)
};
const P = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };
// router latency: only meaningful when the router actually ran (live); retrieve/compose always run.
const liveRows = scored.filter(r => !r.offline);
const lat = liveRows.map(r => r.routerMs);
M.p50 = P(lat, 0.5); M.p90 = P(lat, 0.9); M.p95 = P(lat, 0.95);
const retMs = scored.map(r => r.retrieveMs);
M.retP50 = P(retMs, 0.5); M.retP90 = P(retMs, 0.9); M.retP95 = P(retMs, 0.95);
const eFast = scored.map(r => r.e2eFast), eVec = scored.map(r => r.e2eVec), ePar = scored.map(r => r.e2ePar);
M.fastP50 = P(eFast, 0.5); M.fastP90 = P(eFast, 0.9); M.fastP95 = P(eFast, 0.95);
M.vecP50 = P(eVec, 0.5); M.vecP90 = P(eVec, 0.9); M.vecP95 = P(eVec, 0.95);
M.parP50 = P(ePar, 0.5); M.parP90 = P(ePar, 0.9); M.parP95 = P(ePar, 0.95);
M.composeP50 = P(scored.map(r => r.composeMs), 0.5);
// authoritative single-user latency (serial probe)
const pl = probe.filter(p => !p.offline).length ? probe.filter(p => !p.offline) : probe;
M.sRouterP50 = P(pl.map(p => p.router), 0.5); M.sRouterP90 = P(pl.map(p => p.router), 0.9);
M.sRetrP50 = P(pl.map(p => p.retrieve), 0.5); M.sRetrP90 = P(pl.map(p => p.retrieve), 0.9);
M.sFastP50 = P(pl.map(p => p.fast), 0.5); M.sFastP90 = P(pl.map(p => p.fast), 0.9);
M.sVecP50 = P(pl.map(p => p.vec), 0.5); M.sVecP90 = P(pl.map(p => p.vec), 0.9); M.sVecP95 = P(pl.map(p => p.vec), 0.95);
M.sParP50 = P(pl.map(p => p.par), 0.5); M.sParP90 = P(pl.map(p => p.par), 0.9);
M.probeN = pl.length;

// per-category
const cats = [...new Set(scored.map(r => r.cat))].sort();
const catRows = cats.map(c => {
  const rs = scored.filter(r => r.cat === c); const d = rs.filter(r => r.dz);
  return { cat: c, n: rs.length, intent: pct(rs.filter(r => r.iOK).length, rs.length), elName: pct(rs.filter(r => r.elName).length, rs.length), elNode: pct(d.filter(r => r.elNode).length, d.length), retr: pct(d.filter(r => r.retr === true).length, d.filter(r => r.retr !== null).length), clarify: pct(rs.filter(r => r.amb).length, rs.length), bypass: pct(rs.filter(r => r.bypass).length, rs.length) };
});

// ---- console summary ----
console.log("\n=== MaiK ROUTER BENCHMARK v2 (" + (DRY ? "DRY / offline-fallback" : "LIVE") + ") ===");
console.log("scored:", M.n, "| quota-skipped:", M.quota);
console.log("intent accuracy      :", M.intent);
console.log("entity-link (name)   :", M.elName);
console.log("entity-link (KB node):", M.elNode, "  [disease golds n=" + dzScored.length + "]");
console.log("retrieval @10 (router):", M.retr, " vs raw-query:", M.retrRaw);
console.log("clarification rate   :", M.clarifyRate, " recall:", M.clarifyRecall, " precision:", M.clarifyPrec, " false-clarify:", M.falseClarify);
console.log("Gemini-bypass rate   :", M.bypass, " (bypass-decision correct:", M.bypassCorrect + ", wrong bypass of defer-Q:", M.wrongBypass + ")");
console.log("router latency ms    : p50", M.p50, "p90", M.p90, "p95", M.p95, DRY ? "(offline=0)" : "");
console.log("--- SINGLE-USER (serial probe, n=" + M.probeN + ", authoritative) ---");
console.log("  router", M.sRouterP50 + "/" + M.sRouterP90, " retrieve", M.sRetrP50 + "/" + M.sRetrP90, " (p50/p90 ms)");
console.log("  RESPONSE TIME ms: fast/name-sure p50", M.sFastP50, "p90", M.sFastP90, "| vector-path p50", M.sVecP50, "p90", M.sVecP90, "| if-parallelised p50", M.sParP50, "p90", M.sParP90);
console.log("--- under concurrent load (accuracy run, pessimistic) ---");
console.log("  retrieve p50", M.retP50, "p90", M.retP90, " response(vec) p50", M.vecP50, "p90", M.vecP90);
console.log("\nper-category:"); catRows.forEach(r => console.log("  " + r.cat.padEnd(22), "n=" + String(r.n).padStart(3), "intent", r.intent.padStart(6), "elNode", r.elNode.padStart(6), "retr", r.retr.padStart(6), "clarify", r.clarify.padStart(6), "bypass", r.bypass));

// ---- markdown report ----
const fails = {
  intent: scored.filter(r => !r.iOK),
  entity: scored.filter(r => r.dz && !r.elNode),
  retrieval: dzScored.filter(r => r.retr === false),
  falseClarify: scored.filter(r => r.amb && !r.goldAmb),
  missedClarify: scored.filter(r => r.goldAmb && !r.amb),
  wrongBypass: scored.filter(r => r.bypass && r.shouldDefer),
};
const tbl = rows => rows.map(r => "| `" + r.q + "` | " + r.cat + " | " + JSON.stringify(r.gold) + " | " + JSON.stringify(r.got) + " | " + r.goldI + " → " + r.gotI + " |").join("\n");
const md = [
  "# MaiK Router Benchmark — Full Human-Language Suite" + (DRY ? " (DRY RUN — offline fallback, not Vertex)" : ""),
  "",
  "Suite: **" + M.n + "** scored" + (M.quota ? " (" + M.quota + " quota-skipped)" : "") + " across " + cats.length + " categories. Endpoint `/api/ai/route`" + (DRY ? " — **NOT CALLED** (dry run uses the offline fallback resolver as a stand-in; the LIVE numbers replace these after the UTC quota reset)." : "."),
  "",
  "## Headline metrics",
  "| metric | value |",
  "|---|---|",
  "| Intent accuracy | " + M.intent + " |",
  "| Entity-linking (concept name) | " + M.elName + " |",
  "| Entity-linking (KB node) | " + M.elNode + " |",
  "| Retrieval recall@10 (router concept) | " + M.retr + " |",
  "| Retrieval recall@10 (raw query) | " + M.retrRaw + " |",
  "| Clarification rate | " + M.clarifyRate + " |",
  "| — clarification recall (of should-ask) | " + M.clarifyRecall + " |",
  "| — clarification precision | " + M.clarifyPrec + " |",
  "| — false-clarify rate (of resolvable) | " + M.falseClarify + " |",
  "| Gemini-bypass rate | " + M.bypass + " |",
  "| — bypass decision correct | " + M.bypassCorrect + " |",
  "| — wrong bypass of a defer-query | " + M.wrongBypass + " |",
  "### Response time — SINGLE-USER (serial probe, n=" + M.probeN + ", authoritative)",
  "| metric | p50 | p90 |",
  "|---|---|---|",
  "| Router latency (ms) | " + M.sRouterP50 + " | " + M.sRouterP90 + " |",
  "| Retrieve latency (ms) | " + M.sRetrP50 + " | " + M.sRetrP90 + " |",
  "| **Response — fast path (name-sure, vector skipped)** | **" + M.sFastP50 + "** | **" + M.sFastP90 + "** |",
  "| Response — vector-arm path (current, sequential) | " + M.sVecP50 + " | " + M.sVecP90 + " |",
  "| Response — if router+retrieval parallelised (proposed) | " + M.sParP50 + " | " + M.sParP90 + " |",
  "",
  "### Latency (concurrent accuracy run — pessimistic, /api/retrieve queues under load)",
  "| metric | p50 | p90 | p95 |",
  "|---|---|---|---|",
  "| Router latency (ms) | " + M.p50 + " | " + M.p90 + " | " + M.p95 + " |",
  "| Retrieve latency (ms, capped 3000) | " + M.retP50 + " | " + M.retP90 + " | " + M.retP95 + " |",
  "| Response — vector-arm path (ms) | " + M.vecP50 + " | " + M.vecP90 + " | " + M.vecP95 + " |",
  "| KB compose (local, ms) | " + M.composeP50 + " | | |",
  "",
  "> Response time = user-perceived latency for a KB-answered query, modelled on the real client (`home.js runClinical`): `buildPackage` (vector arm, client-capped at 3000ms, **skipped when the lexical pick is name-sure**) → `getRoute` → local compose, run **sequentially**. The **single-user serial probe is authoritative** (a clinician issues one query at a time); the concurrent run's latencies are inflated by Workers-AI embed queuing and shown only as a pessimistic bound. `fast path` = router + compose (common clean-query case, vector skipped). `vector-arm path` = router + min(retrieve,3000) + compose. `if parallelised` = max(router, retrieve) + compose (proposed fix: fire router & first retrieval concurrently). Gemini-routed queries add full generation latency on top.",
  "",
  "## Per-category",
  "| category | n | intent | entity(KB) | retrieval@10 | clarify | bypass |",
  "|---|---|---|---|---|---|---|",
  catRows.map(r => "| " + r.cat + " | " + r.n + " | " + r.intent + " | " + r.elNode + " | " + r.retr + " | " + r.clarify + " | " + r.bypass + " |").join("\n"),
  "",
  "## Failure cases (every one)",
  "",
  "### Intent misclassified (" + fails.intent.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.intent),
  "",
  "### Entity-linking wrong KB node (" + fails.entity.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.entity),
  "",
  "### Retrieval miss — gold disease not in top-10 (" + fails.retrieval.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.retrieval),
  "",
  "### False clarification — asked when context was sufficient (" + fails.falseClarify.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.falseClarify),
  "",
  "### Missed clarification — should have asked (" + fails.missedClarify.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.missedClarify),
  "",
  "### Wrong bypass — answered a defer/complex query from KB (" + fails.wrongBypass.length + ")",
  "| query | cat | gold concept | got concept | intent gold → got |", "|---|---|---|---|---|", tbl(fails.wrongBypass),
  "",
].join("\n");
fs.writeFileSync(path.join(DIR, DRY ? "REPORT.dry.md" : "REPORT.md"), md);
fs.writeFileSync(path.join(DIR, DRY ? "results-v2.dry.json" : "results-v2.json"), JSON.stringify({ metrics: M, catRows, results: scored }, null, 1));
console.log("\nwrote " + (DRY ? "REPORT.dry.md" : "REPORT.md") + " + results json");
