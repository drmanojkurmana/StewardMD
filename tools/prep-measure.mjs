#!/usr/bin/env node
// PrepNucleus Phase 0 measurement harness. Dev-only, never shipped. COSTS MONEY (Vertex online, optional Batch).
// Plan: vault/plans/PrepNucleus-LayerC.md 5 (Phase 0 row), 6 to 8; vault/plans/PrepNucleus.md 10 (Phase 0).
//
// RUN
//   node tools/prep-measure.mjs --src <dir of .txt sources> --dry-run            plan + estimated cost, zero calls
//   PREP_VERTEX_PROJECT=<gcp project> node tools/prep-measure.mjs --src <dir> [--temps 1.0,0.2] [--target 100]
//       [--seeds 50] [--exam neet-pg] [--run <id>] [--out prep/measure] [--chunk-tok 1500]
//       [--batch] (also replays the first temperature's requests as ONE Batch job: needs PREP_GCS_BUCKET; measures
//       turnaround and Batch tokens) [--poll-sec 60]
//   Location, model and auth: see tools/prep-vertex.mjs. PDF extraction is out of scope: give text (a form feed in a
//   .txt starts a new page; without one, pages are counted as 1,100 tokens).
//
// What it does, per temperature (facts, mcq and review at that temperature; solve stays at 0.2, LayerC 7):
//   source by source, chunk by chunk: facts -> mcq (7 facts a call) -> code gates (functions/_prep-core.js, plus the
//   whole-source 12-word verbatim check) -> blind solve -> review -> one regeneration of every rejected fact -> until
//   --target questions are kept. Then 50 kept-or-gated items get a deliberately WRONG key and a fresh option order,
//   and are blind-solved in their own calls: the catch rate is the share whose pick differs from the seeded key.
// Records per call (tools/prep-vertex.mjs log): promptTokenCount, candidatesTokenCount, thoughtsTokenCount,
//   cachedContentTokenCount, finishReason, modelVersion, provider, 429s, retries, latency. Every request carries the
//   Vertex labels { app: "prep", run } so the run reconciles against Cloud Billing (filter labels.run = <run>).
// OUT  <out>/<run>/report.json   everything above plus the cost fit usd = a x pages + b x questions kept (least
//                                squares, no intercept), p50/p90 per op, finishReason counts, reject rate per gate,
//                                seeded catch rate, optional Batch comparison
//      <out>/<run>/summary.md    the short version for vault/plans
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREP_TEMPS, getProfile, mulberry32, seedFrom, solveMatches } from "../functions/_prep-core.js";
import { createVertex, requestBody, labelsFor, labelValue, sumUsage, costUsd, usdToInr, percentile, promptTokens, priceUsdPer1M, vertexConfig } from "./prep-vertex.mjs";
import {
  packSents, chunkSents, factsPrompt, readFacts, mergeFacts, mcqPrompt, readMcq, solvePrompt, readSolve, reviewPrompt, readReview,
  groupsOf, parseArgs, perQuestion, EST, WHY,
} from "./prep-fill.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE_TOK = 1100;   // a cleaned page is 900 to 1,300 tokens (LayerC 9)

/* fitCost(rows: [{ pages, kept, usd }]) -> { a, b, rows: [+ pred, err], maxRelErr }: usd = a x pages + b x kept by
 * least squares without an intercept. With one regressor degenerate it falls back to the other alone. */
export function fitCost(rows) {
  let pp = 0, pk = 0, kk = 0, pc = 0, kc = 0;
  for (const r of rows) { pp += r.pages * r.pages; pk += r.pages * r.kept; kk += r.kept * r.kept; pc += r.pages * r.usd; kc += r.kept * r.usd; }
  const det = pp * kk - pk * pk;
  let a = 0, b = 0;
  if (Math.abs(det) > 1e-12 * Math.max(1, pp * kk)) { a = (pc * kk - kc * pk) / det; b = (kc * pp - pc * pk) / det; }
  else if (kk > 0) b = kc / kk;
  else if (pp > 0) a = pc / pp;
  const out = rows.map((r) => { const pred = a * r.pages + b * r.kept; return { ...r, pred, err: r.usd ? (pred - r.usd) / r.usd : 0 }; });
  return { a, b, rows: out, maxRelErr: out.reduce((m, r) => Math.max(m, Math.abs(r.err)), 0) };
}
/* catchRate(seeds: [{ caught }]) -> { seeded, caught, rate } */
export function catchRate(seeds) {
  const caught = seeds.filter((s) => s.caught).length;
  return { seeded: seeds.length, caught, rate: seeds.length ? caught / seeds.length : null };
}
/* seedWrongKeys(pool, n, run) -> [{ id, q, o, a (wrong), trueA, from }]: a fresh option order and a key that points at
 * a distractor. The solver sees exactly what it sees for a real item: the key never enters the prompt. */
export function seedWrongKeys(pool, n, run) {
  const rnd = mulberry32(seedFrom("seeds:" + run));
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order.slice(0, Math.min(n, pool.length)).map((pi, k) => {
    const it = pool[pi], idx = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const o = idx.map((i) => it.o[i]), trueA = idx.indexOf(it.a);
    const wrong = [0, 1, 2, 3].filter((x) => x !== trueA);
    return { id: "seed_" + k, q: it.q, o, a: wrong[Math.floor(rnd() * 3)], trueA, from: it.id };
  });
}
function readSources(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  if (!files.length) throw new Error("no .txt sources in " + dir);
  return files.map((f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const sents = packSents([{ name: f, text }]);
    const tok = sents.reduce((a, s) => a + s.tx.length, 0) / 4;
    return { name: f, text, sents, ff: text.includes("\f"), pages: text.includes("\f") ? text.split("\f").length : tok / PAGE_TOK, tok };
  });
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/* estimate(sources, opts) -> the dry-run plan: calls and tokens per op, USD online (and Batch replay). No calls. */
export function estimate(sources, o) {
  const pid = o.exam, q = perQuestion(pid), model = o.model;
  const per = (n) => costUsd({ inTok: q.in * n, outTok: q.out * n }, model);
  const factsNeeded = Math.ceil(o.target * EST.overgen * EST.extract / EST.factsPerChunk);
  const chunks = sources.flatMap((s) => chunkSents(s.sents, o.chunkTok));
  const used = chunks.slice(0, factsNeeded);
  const exactFactsIn = used.reduce((a, c) => a + promptTokens(factsPrompt(c)), 0);
  const repFactsIn = o.target * EST.overgen * EST.extract * (q.calls.factsChunk / EST.factsPerChunk);
  const inTok = q.in * o.target - repFactsIn + exactFactsIn, outTok = q.out * o.target;
  const perTemp = costUsd({ inTok, outTok }, model);
  const seedCalls = Math.ceil(o.seeds / 7), seedIn = seedCalls * q.calls.solve7, seedOut = o.seeds * EST.solveOut;
  const seedUsd = costUsd({ inTok: seedIn, outTok: seedOut }, model);
  const batchUsd = o.batch ? costUsd({ inTok, outTok }, model, { batch: true }) : 0;
  const calls = { facts: used.length, mcq: Math.ceil(o.target * EST.overgen / 7) + Math.ceil(o.target * EST.overgen * (1 - EST.finalPass)), solve: Math.ceil(o.target * 1.5 / 7), review: Math.ceil(o.target * 1.4 / 7) };
  const total = perTemp * o.temps.length + seedUsd + batchUsd;
  return {
    sources: sources.map((s) => ({ name: s.name, sentences: s.sents.length, pages: r4(s.pages), pagesFrom: s.ff ? "form feeds" : "tokens / " + PAGE_TOK })),
    chunksAvailable: chunks.length, chunksNeeded: factsNeeded, enoughText: chunks.length >= factsNeeded,
    perTemperature: { calls, inTok: Math.round(inTok), outTok: Math.round(outTok), usd: r4(perTemp) },
    seeds: { n: o.seeds, calls: seedCalls, usd: r4(seedUsd) }, batchReplayUsd: r4(batchUsd),
    totalUsd: r4(total), totalInr: Math.round(usdToInr(total) * 100) / 100, perQuestion: { in: q.in, out: q.out, usd: r4(per(1)) },
  };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const root = deps.root || ROOT, log = deps.log || console.log;
  if (!args.src) throw new Error("--src <dir of .txt sources> is required");
  const cfg = { ...vertexConfig(deps.env || process.env), ...(deps.config || {}) };
  const temps = String(args.temps || "1.0,0.2").split(",").map(Number).filter((x) => Number.isFinite(x));
  const target = Number(args.target) || 100, nSeeds = args.seeds != null ? Number(args.seeds) : 50;
  const exam = args.exam || "neet-pg", profile = getProfile(exam);
  if (!profile) throw new Error("unknown exam " + exam);
  const chunkTok = Number(args["chunk-tok"]) || EST.chunkTok;
  const sources = readSources(path.resolve(root, args.src));
  const run = args.run || "measure-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

  if (args.flags.has("dry-run")) {
    const e = estimate(sources, { exam, target, seeds: nSeeds, temps, chunkTok, model: cfg.model, batch: args.flags.has("batch") });
    log(`DRY RUN (no calls). run ${run}, model ${cfg.model}, exam ${exam}, temperatures ${temps.join(" and ")}, target ${target} kept each, ${nSeeds} seeded wrong keys.`);
    for (const s of e.sources) log(`  source ${s.name}: ${s.sentences} sentences, ${s.pages} pages (${s.pagesFrom})`);
    const c = e.perTemperature.calls;
    log(`  per temperature: about ${c.facts} facts + ${c.mcq} mcq + ${c.solve} solve + ${c.review} review calls, in ${e.perTemperature.inTok} out ${e.perTemperature.outTok} tokens, $${e.perTemperature.usd}`);
    if (!e.enoughText) log(`  note: the sources have ${e.chunksAvailable} chunks; about ${e.chunksNeeded} are needed for ${target} kept. Add text or lower --target.`);
    log(`  seeds: ${e.seeds.calls} solve calls, $${e.seeds.usd}${args.flags.has("batch") ? `; Batch replay $${e.batchReplayUsd}` : ""}`);
    log(`  estimated total $${e.totalUsd} (Rs ${e.totalInr}) at online price $${priceUsdPer1M(cfg.model).in} in / $${priceUsdPer1M(cfg.model).out} out per 1M`);
    return { dryRun: true, run, ...e };
  }

  const vx = deps.vertex || createVertex({ env: deps.env, config: deps.config, fetch: deps.fetch, exec: deps.exec, sleep: deps.sleep, now: deps.now });
  const labels = labelsFor(run);
  const solveT = PREP_TEMPS.solve;
  const report = { v: 1, run, model: vx.cfg.model, location: vx.cfg.location, exam, labels, created: new Date().toISOString(), temps: {}, rows: [], seeds: null };
  const gatePool = [];
  const replay = [];

  for (const T of temps) {
    const tk = String(T);
    const S = { temperature: T, generated: 0, kept: 0, rejects: {}, regenerated: 0, errors: 0, items: [] };
    report.temps[tk] = S;
    const tStart = vx.log.length;
    const call = async (prompt, op, temperature) => {
      try {
        const r = await vx.generate(prompt, { temperature, op, run, labels });
        if (T === temps[0]) replay.push(r.body);
        return r.text;
      } catch (e) { S.errors++; return ""; }
    };
    for (const src of sources) {
      if (S.kept >= target) break;
      const before = vx.log.length;
      const byN = new Map(src.sents.map((s) => [s.n, s]));
      const deckId = "measure_" + labelValue(src.name) + "_" + tk;
      const row = { source: src.name, temperature: T, pages: 0, kept: 0, usd: 0 };
      const pagesSeen = new Set();
      let tokSeen = 0, seenFacts = [];
      const prior = [];
      const ctxBase = { deckId, packText: src.text, avoid: [], model: vx.cfg.model, prov: "SMD", t: "measure", profile };
      const roundOnline = async (reqs, tag) => {
        const made = [], rejected = [];
        for (let i = 0; i < reqs.length; i++) {
          const text = await call(mcqPrompt(reqs[i].facts, profile, byN, reqs[i].avoid), "mcq", T);
          const res = readMcq(text, reqs[i].facts, { ...ctxBase, seedKey: `${deckId}:${tag}:${S.generated}:${i}`, prior });
          S.generated += res.generated;
          made.push(...res.items); rejected.push(...res.rejected);
        }
        gatePool.push(...made.map((x) => x.item));
        const solved = [];
        for (const g of groupsOf(made, 7)) {
          const v = readSolve(await call(solvePrompt(g.map((x) => x.item)), "solve", solveT), g.map((x) => x.item));
          v.forEach((r, k) => { if (r.ok) solved.push(g[k]); else rejected.push({ fid: g[k].fact.fid, gate: "solve", why: WHY.solve }); });
        }
        const accepted = [];
        for (const g of groupsOf(solved, 7)) {
          const v = readReview(await call(reviewPrompt(g.map((x) => x.item), byN, profile), "review", T), g.map((x) => x.item));
          v.forEach((r, k) => { if (r.pass) accepted.push(g[k]); else rejected.push({ fid: g[k].fact.fid, gate: "review", why: r.g.why || "failed review" }); });
        }
        rejected.forEach((r) => { S.rejects[r.gate] = (S.rejects[r.gate] || 0) + 1; });
        return { accepted, rejected };
      };
      for (const chunk of chunkSents(src.sents, chunkTok)) {
        if (S.kept >= target) break;
        chunk.forEach((s) => pagesSeen.add(s.p));
        tokSeen += chunk.reduce((a, s) => a + s.tx.length, 0) / 4;
        const got = readFacts(await call(factsPrompt(chunk), "facts", T), chunk, deckId).facts;
        const facts = mergeFacts(seenFacts.concat(got)).slice(seenFacts.length);
        seenFacts = seenFacts.concat(facts);
        for (const g of groupsOf(facts, 7)) {
          if (S.kept >= target) break;
          const r0 = await roundOnline([{ facts: g }], "r0");
          const ok = new Set(r0.accepted.map((x) => x.fact.fid)), redo = [], seen = new Set();
          for (const r of r0.rejected) {
            const f = g.find((x) => x.fid === r.fid);
            if (!f || ok.has(r.fid) || seen.has(r.fid)) continue;
            seen.add(r.fid); redo.push({ facts: [f], avoid: { fi: 0, why: r.why } });
          }
          S.regenerated += redo.length;
          const r1 = redo.length ? await roundOnline(redo, "r1") : { accepted: [] };
          const acc = r0.accepted.concat(r1.accepted);
          S.kept += acc.length; row.kept += acc.length;
          S.items.push(...acc.map((x) => x.item));
        }
      }
      row.pages = src.ff ? pagesSeen.size : r4(tokSeen / PAGE_TOK);
      row.usd = sumUsage(vx.log.slice(before), vx.cfg.model, { batch: false }).usd;
      report.rows.push(row);
    }
    S.usage = sumUsage(vx.log.slice(tStart), vx.cfg.model, { batch: false });
    S.rejectRate = S.generated ? r4(Object.values(S.rejects).reduce((a, b) => a + b, 0) / S.generated) : null;
    S.rejectRateByGate = Object.fromEntries(Object.entries(S.rejects).map(([g, n]) => [g, S.generated ? r4(n / S.generated) : null]));
    S.itemCount = S.items.length;
    S.items = S.items.slice(0, 20).map((it) => ({ id: it.id, q: it.q, o: it.o, a: it.a, kp: it.kp }));   // a sample for the doctor-free read
  }

  // seeded wrong keys, solved blind in their own calls
  const seeds = seedWrongKeys(gatePool, nSeeds, run);
  const seedOut = [];
  for (const g of groupsOf(seeds, 7)) {
    let text = "";
    try { text = (await vx.generate(solvePrompt(g), { temperature: solveT, op: "solve-seed", run, labels })).text; } catch (e) { text = ""; }
    readSolve(text, g).forEach((r, k) => {
      const s = g[k];
      seedOut.push({ id: s.id, from: s.from, a: s.a, trueA: s.trueA, picked: r.ot, caught: !solveMatches(r.ot, s), pickedTrueKey: solveMatches(r.ot, { o: s.o, a: s.trueA }), bad: r.bad });
    });
  }
  report.seeds = { ...catchRate(seedOut), pickedTrueKey: seedOut.filter((s) => s.pickedTrueKey).length, list: seedOut };

  // optional Batch replay of the first temperature's requests
  if (args.flags.has("batch") && replay.length) {
    const lines = replay.map((request, i) => ({ key: "b" + i, request }));
    const t0 = (deps.now || Date.now)();
    const job = await vx.batch.submit({ name: "measure-batch", run, lines });
    const info = await vx.batch.wait(job.jobId, { pollMs: (args["poll-sec"] != null ? Number(args["poll-sec"]) : 60) * 1000 });
    const wall = (deps.now || Date.now)() - t0;
    const before = vx.log.length;
    if (!info.pending && (info.state === "JOB_STATE_SUCCEEDED" || info.state === "JOB_STATE_PARTIALLY_SUCCEEDED")) await vx.batch.results(info, lines, { run, op: "batch-replay" });
    const b = sumUsage(vx.log.slice(before), vx.cfg.model, { batch: true });
    const onl = report.temps[String(temps[0])].usage;
    const turn = info.createTime && info.endTime ? Date.parse(info.endTime) - Date.parse(info.createTime) : wall;
    report.batch = { jobId: job.jobId, state: info.state, requests: lines.length, turnaroundMs: turn, usage: b, onlineSameSetUsd: onl.usd };
  }

  // aggregates
  const online = vx.log.filter((r) => r.mode === "online");
  const ops = [...new Set(online.map((r) => r.op))];
  report.pct = {};
  report.finish = {};
  for (const op of ops) {
    const rs = online.filter((r) => r.op === op);
    const pc = (f) => ({ p50: percentile(rs.map(f), 50), p90: percentile(rs.map(f), 90) });
    report.pct[op] = { latencyMs: pc((r) => r.latencyMs), promptTokens: pc((r) => r.promptTokenCount), candidatesTokens: pc((r) => r.candidatesTokenCount), thoughtsTokens: pc((r) => r.thoughtsTokenCount) };
    report.finish[op] = {};
    for (const r of rs) report.finish[op][r.finishReason] = (report.finish[op][r.finishReason] || 0) + 1;
  }
  report.http = { calls: online.length, n429: online.reduce((a, r) => a + r.n429, 0), retries: online.reduce((a, r) => a + r.retries, 0), errors: online.filter((r) => !(r.status >= 200 && r.status < 300)).length };
  report.modelVersions = [...new Set(online.map((r) => r.modelVersion).filter(Boolean))];
  report.usage = sumUsage(online, vx.cfg.model, { batch: false });
  report.thinkingBilled = report.usage.thinkTok > 0;
  const fitRows = report.rows.filter((r) => r.kept > 0 || r.pages > 0);
  report.fit = fitCost(fitRows);
  const perKept = report.rows.filter((r) => r.kept > 0).map((r) => r.usd / r.kept);
  report.costPerKept = { p50: percentile(perKept, 50), p90: percentile(perKept, 90) };
  const per100 = report.fit.b * 100 + report.fit.a * (fitRows.reduce((a, r) => a + r.pages, 0) / Math.max(1, fitRows.reduce((a, r) => a + r.kept, 0))) * 100;
  report.per100 = { onlineUsd: r4(per100), batchUsd: r4(per100 / 2), planBatchUsd: 0.08 };
  report.calls = vx.log;

  const outDir = path.resolve(root, args.out || "prep/measure", run);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(outDir, "summary.md"), summaryMd(report));
  log(`wrote ${path.join(outDir, "report.json")} and summary.md`);
  return report;
}

export function summaryMd(r) {
  const f = (x, d = 4) => (x == null ? "n/a" : Number(x).toFixed(d));
  const L = [];
  L.push(`# PrepNucleus Phase 0 run ${r.run}`, "");
  L.push(`Model ${r.model} (${r.modelVersions.join(", ") || "version not reported"}), location ${r.location}, exam ${r.exam}. Vertex labels app=prep, run=${r.labels.run}: reconcile in Cloud Billing by that label.`, "");
  L.push("## Cost fit", "", `usd = ${f(r.fit.a, 6)} x pages + ${f(r.fit.b, 6)} x questions kept (least squares, ${r.fit.rows.length} source x temperature rows, max row error ${f(r.fit.maxRelErr * 100, 1)}%).`);
  L.push(`Per 100 kept: $${f(r.per100.onlineUsd)} online, $${f(r.per100.batchUsd)} at Batch price (plan 9.1: $${r.per100.planBatchUsd}). Cost per kept question p50 $${f(r.costPerKept.p50, 5)}, p90 $${f(r.costPerKept.p90, 5)}.`);
  L.push(`Total online: ${r.usage.calls} calls, ${r.usage.inTok} in, ${r.usage.outTok} out, ${r.usage.thinkTok} thinking tokens${r.thinkingBilled ? " (THINKING IS BILLED)" : ""}, $${f(r.usage.usd)} (Rs ${f(usdToInr(r.usage.usd), 2)}).`, "");
  L.push("## Per temperature", "", "| temperature | kept | generated | reject rate | rejects by gate | regenerated | errors | usd |", "|---|---|---|---|---|---|---|---|");
  for (const [t, s] of Object.entries(r.temps)) L.push(`| ${t} | ${s.kept} | ${s.generated} | ${s.rejectRate == null ? "n/a" : f(s.rejectRate * 100, 1) + "%"} | ${Object.entries(s.rejectRateByGate).map(([g, x]) => `${g} ${f(x * 100, 1)}%`).join(", ") || "none"} | ${s.regenerated} | ${s.errors} | ${f(s.usage.usd)} |`);
  L.push("", "## Per op (p50 / p90)", "", "| op | latency ms | prompt tok | output tok | thinking tok | finishReason |", "|---|---|---|---|---|---|");
  for (const [op, p] of Object.entries(r.pct)) L.push(`| ${op} | ${p.latencyMs.p50} / ${p.latencyMs.p90} | ${p.promptTokens.p50} / ${p.promptTokens.p90} | ${p.candidatesTokens.p50} / ${p.candidatesTokens.p90} | ${p.thoughtsTokens.p50} / ${p.thoughtsTokens.p90} | ${Object.entries(r.finish[op]).map(([k, v]) => k + " " + v).join(", ")} |`);
  L.push("", `HTTP: ${r.http.calls} calls, ${r.http.n429} x 429, ${r.http.retries} retries, ${r.http.errors} failed.`, "");
  L.push("## Seeded wrong keys", "", `${r.seeds.caught} of ${r.seeds.seeded} caught (${r.seeds.rate == null ? "n/a" : f(r.seeds.rate * 100, 1) + "%"}; target >= 90%). The solver picked the true key on ${r.seeds.pickedTrueKey}. This measures only what the solver knows; an error shared by writer and solver does not show here.`);
  if (r.batch) L.push("", "## Batch replay", "", `Job ${r.batch.jobId} ${r.batch.state}: ${r.batch.requests} requests, turnaround ${Math.round(r.batch.turnaroundMs / 60000)} min, $${f(r.batch.usage.usd)} at Batch price vs $${f(r.batch.onlineSameSetUsd)} online for the same requests.`);
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
