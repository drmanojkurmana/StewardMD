#!/usr/bin/env node
// PrepNucleus Layer B central fill. Dev-only, never shipped. COSTS MONEY (Vertex Batch). Plan: vault/plans/PrepNucleus.md
// 6.1 (targets), 6.3 (central fill), 6.4 (USMLE profile), 9.1 (cost); gates and contracts from
// vault/plans/PrepNucleus-LayerC.md 6 to 8, all through functions/_prep-core.js (no prompt, schema, gate or shuffle here).
//
// RUN
//   PREP_VERTEX_PROJECT=<gcp project> PREP_GCS_BUCKET=<bucket> node tools/prep-fill.mjs [--module <id>[,<id>]]
//       [--shortfall prep/fill/shortfall.json] [--packs prep/fill/packs] [--packs-extra <dir>] [--work prep/fill/work] [--out prep/fill]
//       [--bank prep/bank/v1] [--tax prep/taxonomy] [--run <id>] [--usmle-share 0.3] [--overgen 1.15] [--need <n>]
//       [--chunk-tok 1500] [--poll-sec 60] [--max-wait-min 1440] [--max-jobs 8] [--no-wait]
//   node tools/prep-fill.mjs --dry-run [...same selection...]          plan + token and cost estimate, zero calls
//   node tools/prep-fill.mjs --dry-run --assume neet-pg=1900,neet-ss=22000,usmle=3000   whole-fill estimate by count
//   node tools/prep-fill.mjs --merge [--from prep/bank/v1] [--to prep/bank/v2]       accepted items -> a NEW bank version
//   Location, model and auth: see tools/prep-vertex.mjs (PREP_VERTEX_LOCATION, PREP_MODEL, gcloud).
//
// INPUT per module   prep/fill/packs/<module>/*.txt     the source pack (plain text; "#" lines or short title lines are
//                                                        headings; a form feed starts a new page)
//                    prep/fill/packs/<module>/pack.json { srcPack: [{ id, title, url? }], avoid?: ["term", ...] }
//                    ids are neutral slugs; titles and urls stay in the work folder (owner audit), never on an item
//                    A second pack root (--packs-extra <dir>, or env PREP_PACKS_EXTRA) holds packs that must stay out
//                    of this public repo (non-commercial licensed text, tools/prep-packs.mjs); --packs wins on a tie.
// STAGES per module  prep/fill/work/<module>/01-facts.jsonl   one request per pack chunk        -> finalizeFacts, fid
//   (one Batch job   02-mcq.jsonl     7 facts a request, exam profile style   -> code gates 1 2 3 5 9b 12, the 12-word
//    each; files                       verbatim check against the WHOLE pack, no book name or page, seeded shuffle
//    between them)   03-solve.jsonl   blind: stems and options only, never the key -> compare
//                    04-review.jsonl  full item + its paragraph -> g4, g6..g11 all true
//                    02-mcq.r1.jsonl, 03-solve.r1.jsonl, 04-review.r1.jsonl   every rejected fact regenerated ONCE, then dropped
//   Each stage: <stage>.jsonl (requests), <stage>.out.json (model text per key), <stage>.json (what passed);
//   state.json holds the run id and every Batch job id. Re-running resumes: a stage with saved output is never called
//   again, a submitted job is polled, not resubmitted.
// OUTPUT             prep/fill/<module>.json  { v, module, subject, run, model, pv, srcPack: [ids], stats, items }
//                    items: engine item + r, kp, et, cog, fid, src { sn }, prov "SMD", gen "AI", pv, mv,
//                    rv { solved, pass, old }, srcPack ids, ex ["usmle"] only on USMLE vignettes. No book name, page or
//                    heading is ever stored.
// MERGE              copies bank v1 to v2 (v1 is never written), appends accepted items per module, recomputes each
//                    touched subject's index with prep-build-bank.mjs subjectIndex, rebuilds its search.json and manifest.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  PREP_PV, PREP_LIMITS, getProfile, normText, wordCount, jaccard, verbatim,
  buildFactsPrompt, buildMcqPrompt, buildSolvePrompt, buildReviewPrompt,
  sanitizeFacts, sanitizeMcq, sanitizeSolve, sanitizeReview, parseModelJson, finalizeFacts, reviewPass,
  gateBatch, mulberry32, seedFrom, keyPositions, shuffleOptions, solveMatches, toStoredItem,
} from "../functions/_prep-core.js";
import { loadTaxonomy, modulesOf, subjectIndex, REF_SURVIVOR } from "./prep-build-bank.mjs";
import { buildSearch } from "./tokos-build-mcq-search.mjs";
import { createVertex, requestBody, promptTokens, costUsd, usdToInr, sumUsage, vertexConfig, estTokens } from "./prep-vertex.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCQ_N = PREP_LIMITS.mcq.maxItems, SOLVE_N = PREP_LIMITS.solve.maxItems, REVIEW_N = PREP_LIMITS.review.maxItems;

// =====================================================================================================================
// Shared pipeline helpers (also used by tools/prep-measure.mjs, online)
// =====================================================================================================================
const ABBR = /(?:\b(?:e\.g|i\.e|vs|Dr|Mr|Mrs|Ms|St|approx|Fig|No|cf|al|etc|resp|ca|max|min)\.|\b[A-Z]\.)$/;
/* splitSentences(text) -> [{ p, h, tx }]: p is the page (a form feed starts the next), h the last heading. */
export function splitSentences(text) {
  const out = [];
  String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\f").forEach((page, pi) => {
    let h = "", para = [];
    const flush = () => {
      const t = para.join(" ").replace(/\s+/g, " ").trim();
      para = [];
      if (!t) return;
      let cur = "";
      for (const piece of t.split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/)) {
        cur = cur ? cur + " " + piece : piece;
        if (ABBR.test(cur)) continue;
        out.push({ p: pi + 1, h, tx: cur });
        cur = "";
      }
      if (cur) out.push({ p: pi + 1, h, tx: cur });
    };
    for (const raw of page.split("\n")) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const md = /^#{1,6}\s+(.+)$/.exec(line);
      const titleLike = !md && line.length <= 80 && wordCount(line) <= 10 && !/[.?!;:,]$/.test(line) && /^[A-Z0-9]/.test(line) && !para.length;
      if (md || titleLike) { flush(); h = (md ? md[1] : line).trim(); continue; }
      para.push(line);
    }
    flush();
  });
  return out;
}
/* packSents(files: [{ name, text }]) -> document-wide numbered sentences [{ n, p, h, tx, doc }] (n from 1). */
export function packSents(files) {
  const out = [];
  for (const f of files) for (const s of splitSentences(f.text)) out.push({ n: out.length + 1, p: s.p, h: s.h, tx: s.tx, doc: f.name });
  return out;
}
/* chunkSents(sents, maxTok) -> chunks of whole sentences of at most maxTok estimated tokens each. */
export function chunkSents(sents, maxTok = 1500) {
  const out = [];
  let cur = [], tok = 0;
  for (const s of sents) {
    const t = estTokens(s.tx.length + (s.h || "").length);
    if (cur.length && tok + t > maxTok) { out.push(cur); cur = []; tok = 0; }
    cur.push(s); tok += t;
  }
  if (cur.length) out.push(cur);
  return out;
}
const promptSents = (chunk) => chunk.map((s) => ({ n: s.n, p: 0, h: s.h, tx: s.tx }));   // the model never sees pages
/* factsPrompt(chunk) -> core facts prompt. Pages are hidden from the model (Layer B stores none). */
export function factsPrompt(chunk) { return buildFactsPrompt({ sents: promptSents(chunk) }); }
/* readFacts(text, chunk, deckId) -> { facts, dropped, bad } through sanitizeFacts and finalizeFacts. */
export function readFacts(text, chunk, deckId) {
  const f = sanitizeFacts(parseModelJson(text));
  if (!f) return { facts: [], dropped: [], bad: true };
  const r = finalizeFacts(f, promptSents(chunk), deckId);
  return { facts: r.facts, dropped: r.dropped, bad: false };
}
/* mergeFacts(list) -> facts with duplicate fid or near-duplicate wording (Jaccard >= 0.8) removed, order kept. */
export function mergeFacts(list) {
  const out = [], fids = new Set();
  for (const f of list) {
    if (fids.has(f.fid) || out.some((g) => jaccard(g.ft, f.ft) >= 0.8)) continue;
    fids.add(f.fid); out.push(f);
  }
  return out;
}
const factSents = (f, byN) => f.sn.map((n) => byN.get(n)).filter(Boolean).map((s) => ({ n: s.n, tx: s.tx }));
/* mcqPrompt(facts, profile, byN, avoid?) -> core mcq prompt over <= 7 facts with their cited sentences. */
export function mcqPrompt(facts, profile, byN, avoid) {
  return buildMcqPrompt({ facts: facts.map((f) => ({ ft: f.ft, sents: factSents(f, byN) })), profile, avoid });
}
// Textbook names in their book form, plus every edition / page / chapter / "Ref" locator the bank scrubber counts.
// Eponyms ("Harrison's sulcus", "Nelson syndrome") are not book forms and pass.
export const BOOK_RE = /\b(?:harrison'?s?\s+(?:principles|internal|textbook|medicine)|robbins|sabiston|bailey\s*(?:and|&)\s*love|schwartz'?s\s+principles|guyton|ganong|katzung|goodman\s*(?:and|&)\s*gilman|ananthanarayan|dutta'?s|davidson'?s\s+principles|nelson\s+textbook|williams\s+obstetrics|park'?s\s+textbook|statpearls|uptodate|medscape|textbook|according\s+to\s+(?:the\s+)?(?:source|text|reference|book|chapter))\b/i;
/* bookProblem(item, avoid) -> true when an item text names a book (BOOK_RE or a pack's avoid term) or a locator. */
export function bookProblem(item, avoid) {
  const texts = [item.q, ...(item.o || []), ...(item.r || []), item.kp, item.exp].filter(Boolean);
  const terms = (avoid || []).map(normText).filter((t) => t.length >= 3);
  return texts.some((t) => BOOK_RE.test(t) || REF_SURVIVOR.test(t) || terms.some((w) => (" " + normText(t) + " ").includes(" " + w + " ")));
}
export const WHY = {
  g1: "it did not have exactly four options", g2: "the key also appeared as a distractor", g3: "two options were the same",
  g5: "the key was much longer or shorter than the distractors", g9b: "the key used a number that is not in the source",
  verbatim: "it copied source wording word for word", "verbatim-pack": "it copied source wording word for word",
  book: "it named a book, edition or page", g12: "it was too similar to another question",
  solve: "an independent solver chose a different answer", "bad-output": "the reply was not valid",
};
/* readMcq(text, facts, ctx) -> { items: [{ item, fact }], rejected: [{ fid, gate, why }], generated, bad }.
 * ctx = { deckId, seedKey, prior (string[] of stems; kept stems are appended), packText, avoid, profile, model,
 *         prov, t, srcPack (ids) }. Code gates through gateBatch, then the whole-pack 12-word check (stem too) and
 * the book check; survivors are shuffled with a seeded order spread across A to D and made stored items. */
export function readMcq(text, facts, ctx) {
  const rqs = sanitizeMcq(parseModelJson(text), facts.length);
  if (!rqs) return { items: [], rejected: facts.map((f) => ({ fid: f.fid, gate: "bad-output", why: WHY["bad-output"] })), generated: 0, bad: true };
  const g = gateBatch(rqs, (fi) => facts[fi].quote, ctx.prior);
  const rejected = g.rejected.map((r) => ({ fid: facts[r.fi].fid, gate: r.gate, why: WHY[r.gate] || r.gate }));
  const rnd = mulberry32(seedFrom(ctx.seedKey));
  const pos = keyPositions(g.kept.length, rnd);
  const items = [];
  g.kept.forEach((rq, k) => {
    const fact = facts[rq.fi];
    const sh = shuffleOptions(rq, pos[k], rnd);
    const texts = [rq.st, rq.key.ot, rq.key.wr, rq.kp].concat(rq.dis.map((d) => d.ot), rq.dis.map((d) => d.wr));
    if (ctx.packText && verbatim(texts, ctx.packText, 12)) { rejected.push({ fid: fact.fid, gate: "verbatim-pack", why: WHY["verbatim-pack"] }); return; }
    const item = toStoredItem(rq, sh, { deckId: ctx.deckId, fact: { fid: fact.fid, sn: fact.sn }, prov: ctx.prov || "SMD", exam: ctx.profile.id, mv: ctx.model, t: ctx.t, srcPack: ctx.srcPack });
    if (bookProblem(item, ctx.avoid)) { rejected.push({ fid: fact.fid, gate: "book", why: WHY.book }); return; }
    ctx.prior.push(rq.st);
    items.push({ item, fact });
  });
  return { items, rejected, generated: rqs.length, bad: false };
}
/* solvePrompt(items) -> core solve prompt. Only q and o are passed: the key index never reaches the builder. */
export function solvePrompt(items) { return buildSolvePrompt({ items: items.map((it) => ({ q: it.q, o: it.o.slice() })) }); }
/* readSolve(text, items) -> [{ ok, ot }]; malformed output fails every item of the call. */
export function readSolve(text, items) {
  const picks = sanitizeSolve(parseModelJson(text), items.length);
  return items.map((it, i) => ({ ok: !!picks && solveMatches(picks[i], it), ot: picks ? picks[i] : "", bad: !picks }));
}
/* paraFor(sn, byN, maxChars) -> sentences n-3 .. n+3 around the cited ones (LayerC 6.0), clipped. */
export function paraFor(sn, byN, maxChars = 1000) {
  const lo = Math.min(...sn) - 3, hi = Math.max(...sn) + 3, out = [];
  for (let n = lo; n <= hi; n++) if (byN.has(n)) out.push(byN.get(n).tx);
  return out.join(" ").slice(0, maxChars);
}
export function reviewPrompt(items, byN, profile) {
  const paras = {};
  for (const it of items) paras[it.id] = paraFor(it.src.sn, byN);
  return buildReviewPrompt({ items: items.map((it) => ({ id: it.id, q: it.q, o: it.o, a: it.a, r: it.r, kp: it.kp })), paras, profile });
}
/* readReview(text, items) -> [{ pass, g }]; malformed output fails every item (sanitizeReview's "no verdict"). */
export function readReview(text, items) {
  const gs = sanitizeReview(parseModelJson(text), items.length);
  return items.map((it, i) => ({ pass: !!gs && reviewPass(gs[i]), g: gs ? gs[i] : { why: "bad output", old: false } }));
}
const groupsOf = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
export { groupsOf };

// =====================================================================================================================
// Estimates (dry runs). Token counts come from the core prompt builders over representative text; the per-item output
// sizes are LayerC 6.1 to 6.3 and plan 9.1 figures until Phase 0 measures them.
// =====================================================================================================================
export const EST = {
  factOut: 80,                                   // tokens per fact (LayerC 6.1: 65 to 85)
  mcqOut: { "neet-pg": 280, "ini-cet": 280, "neet-ss": 300, usmle: 420 },   // per question (LayerC 3: 260 to 300; USMLE 1.5x)
  solveOut: 15, reviewOut: 60,                   // per item (plan 5.1: about 15; review cap 800 for 7)
  codePass: 0.85, solvePass: 0.95, finalPass: 0.7, // reject rate 30% before tuning (plan 10), most of it at the code gates
  overgen: 1.15, factsPerChunk: 12, extract: 1.3, chunkTok: 1500,
  stem: { "neet-pg": 45, "ini-cet": 50, "neet-ss": 70, usmle: 95 },        // words per stem
};
const words = (n) => Array.from({ length: n }, (_, i) => ["renal", "tubule", "sodium", "dose", "cardiac", "marker", "therapy", "acute"][i % 8]).join(" ");
/* repCallTokens(profileId) -> input tokens per call of each op over representative content. */
export function repCallTokens(pid) {
  const profile = getProfile(pid) || getProfile("neet-pg");
  const sents = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, p: 0, h: "Section", tx: words(28) + "." }));
  const fact = { ft: words(22), sents: [{ n: 1, tx: words(28) }, { n: 2, tx: words(28) }] };
  const stem = words(EST.stem[pid] || 50), opt = () => words(5);
  const item = { id: "q", q: stem, o: [opt(), opt(), opt(), opt()], a: 0, r: [words(14), words(14), words(14), words(14)], kp: words(18) };
  return {
    factsChunk: promptTokens(buildFactsPrompt({ sents: chunkSents(sents, EST.chunkTok)[0] })),
    mcq7: promptTokens(buildMcqPrompt({ facts: Array(7).fill(fact), profile })),
    mcq1: promptTokens(buildMcqPrompt({ facts: [fact], profile, avoid: { fi: 0, why: WHY.solve } })),
    solve7: promptTokens(buildSolvePrompt({ items: Array(7).fill(item) })),
    review7: promptTokens(buildReviewPrompt({ items: Array(7).fill(item), paras: { q: "x".repeat(1000) }, profile })),
  };
}
/* perQuestion(profileId) -> { in, out } tokens per ACCEPTED question, round 0 plus one regeneration round. */
export function perQuestion(pid) {
  const t = repCallTokens(pid), E = EST;
  const g0 = E.overgen, r0 = g0 * (1 - E.finalPass), g1 = r0;              // generated, rejected, regenerated
  const facts = g0 * E.extract;                                             // facts extracted per accepted question
  const c = (g) => g * E.codePass, v = (g) => c(g) * E.solvePass;          // reach solve, reach review
  const inTok = facts * (t.factsChunk / E.factsPerChunk) + g0 * (t.mcq7 / 7) + g1 * t.mcq1 + (c(g0) + c(g1)) * (t.solve7 / 7) + (v(g0) + v(g1)) * (t.review7 / 7);
  const outTok = facts * E.factOut + (g0 + g1) * (E.mcqOut[pid] || 280) + (c(g0) + c(g1)) * E.solveOut + (v(g0) + v(g1)) * E.reviewOut;
  return { in: Math.round(inTok), out: Math.round(outTok), calls: t };
}
/* estimateCounts({ pid: n }, model) -> { rows: [{ profile, n, in, out, usd }], total } at Batch price. */
export function estimateCounts(counts, model) {
  const rows = [];
  for (const [pid, n] of Object.entries(counts)) {
    const q = perQuestion(pid), inTok = q.in * n, outTok = q.out * n;
    rows.push({ profile: pid, n, inTok, outTok, usd: costUsd({ inTok, outTok }, model, { batch: true }), per100: costUsd({ inTok: q.in * 100, outTok: q.out * 100 }, model, { batch: true }) });
  }
  const total = rows.reduce((a, r) => ({ n: a.n + r.n, inTok: a.inTok + r.inTok, outTok: a.outTok + r.outTok, usd: a.usd + r.usd }), { n: 0, inTok: 0, outTok: 0, usd: 0 });
  return { rows, total };
}

// =====================================================================================================================
// Files and taxonomy
// =====================================================================================================================
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
function writeJson(p, obj, pretty) { fs.mkdirSync(path.dirname(p), { recursive: true }); const b = pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj); fs.writeFileSync(p, b); return Buffer.byteLength(b); }
const writeJsonl = (p, lines) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : "")); };
const readJsonl = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
export function moduleMap(subjects) {
  const m = new Map();
  for (const s of subjects) for (const mod of modulesOf(s)) m.set(mod.id, { subject: s, mod });
  return m;
}
/* profilesFor(subject) -> { base, usmle }: SS subjects use neet-ss; MBBS uses neet-pg, plus USMLE vignettes when the
 * subject lists usmle (plan 6.4). */
export function profilesFor(subject) {
  if (subject.branch !== "mbbs") return { base: "neet-ss", usmle: false };
  return { base: "neet-pg", usmle: (subject.exams || []).includes("usmle") };
}
/* groupProfiles(nGroups, subject, share) -> profile id per mcq group; about share of an MBBS usmle subject's groups
 * are USMLE vignettes, spread evenly. */
export function groupProfiles(n, subject, share) {
  const p = profilesFor(subject);
  return Array.from({ length: n }, (_, i) => (p.usmle && share > 0 && Math.floor((i + 1) * share) > Math.floor(i * share) ? "usmle" : p.base));
}
/* packDirOf(roots, module) -> the first root's folder that holds the module's pack (else the first root's). */
export function packDirOf(roots, module) {
  const dirs = roots.map((r) => path.join(r, module));
  return dirs.find((d) => fs.existsSync(d)) || dirs[0];
}
export function loadPack(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort().map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
  if (!files.length) return null;
  const meta = readJson(path.join(dir, "pack.json"), {});
  const srcPack = Array.isArray(meta.srcPack) ? meta.srcPack : [];
  const bad = srcPack.filter((s) => !s || !/^[a-z0-9-]{1,60}$/.test(String(s.id || "")));
  if (bad.length) throw new Error(`${dir}/pack.json: every srcPack id must be a neutral slug [a-z0-9-] (no book names)`);
  return { files, srcPack, avoid: Array.isArray(meta.avoid) ? meta.avoid.map(String) : [] };
}
function bankModuleItems(bankDir, subjectId, moduleId) {
  const j = readJson(path.join(bankDir, subjectId, "mcq", moduleId + ".json"), null);
  return j && Array.isArray(j.items) ? j.items : [];
}

// =====================================================================================================================
// Stage engine
// =====================================================================================================================
export class Pending extends Error { constructor(msg) { super(msg); this.pending = true; } }
/* stage(ctx, m, name, makeLines, op) -> Map key -> { text, finishReason, error }. Saved output wins; a submitted job is
 * polled; otherwise the lines are written, submitted, and the job id saved before anything else. */
async function stage(ctx, m, name, makeLines, op) {
  const st = m.state.stages[name] || (m.state.stages[name] = {});
  const outFile = path.join(m.work, name + ".out.json"), inFile = path.join(m.work, name + ".jsonl");
  if (st.status === "done") return new Map(Object.entries(readJson(outFile, {})));
  const lines = makeLines();
  if (!st.jobId) {
    writeJsonl(inFile, lines);
    if (!lines.length) { Object.assign(st, { status: "done", n: 0 }); writeJson(outFile, {}); m.save(); return new Map(); }
    if (ctx.active >= ctx.maxJobs) throw new Pending(`${m.module} ${name}: waiting for a Batch slot (${ctx.active}/${ctx.maxJobs} jobs running)`);
    const job = await ctx.vx.batch.submit({ name: `${m.module}/${name}`, run: m.state.run, lines });
    ctx.active++;
    Object.assign(st, { status: "submitted", n: lines.length, ...job });
    m.save();
    ctx.log(`  ${m.module} ${name}: submitted ${lines.length} requests as ${job.jobId}`);
  } else {
    const saved = fs.existsSync(inFile) ? readJsonl(inFile) : lines;
    if (JSON.stringify(saved) !== JSON.stringify(lines)) ctx.log(`  ${m.module} ${name}: note, the rebuilt requests differ from the submitted file; using the submitted file`);
  }
  const submitted = readJsonl(inFile);
  const info = await ctx.vx.batch.wait(st.jobId, { pollMs: ctx.pollMs, maxWaitMs: ctx.noWait ? 0 : ctx.stageWaitMs });
  if (info.pending) throw new Pending(`${m.module} ${name}: job ${st.jobId} ${info.state}`);
  if (info.state !== "JOB_STATE_SUCCEEDED" && info.state !== "JOB_STATE_PARTIALLY_SUCCEEDED") {
    st.status = "failed"; st.error = info.error || info.state; m.save();
    ctx.active = Math.max(0, ctx.active - 1);
    throw new Error(`${m.module} ${name}: Batch job ${st.jobId} ended ${info.state} ${info.error || ""}. Delete stages["${name}"] from ${path.join(m.work, "state.json")} to resubmit.`);
  }
  const before = ctx.vx.log.length;
  const res = await ctx.vx.batch.results(info, submitted, { run: m.state.run, op });
  const saved = {};
  for (const [k, v] of res) saved[k] = { text: v.text, finishReason: v.finishReason, error: v.error || "" };
  writeJson(outFile, saved);
  ctx.active = Math.max(0, ctx.active - 1);
  Object.assign(st, { status: "done", state: info.state, doneAt: new Date().toISOString(), usage: sumUsage(ctx.vx.log.slice(before), ctx.model, { batch: true }) });
  m.save();
  ctx.log(`  ${m.module} ${name}: ${res.size} results, $${st.usage.usd.toFixed(4)}`);
  return new Map(Object.entries(saved));
}
const textOf = (out, k) => (out.get(k) || {}).text || "";

/* fillModule(ctx, row) -> summary. Deterministic from the pack and the saved stage outputs, so a resumed run rebuilds
 * every intermediate result without a call. Throws Pending while a Batch job runs. */
export async function fillModule(ctx, row) {
  const ent = ctx.modules.get(row.module);
  if (!ent) throw new Error(`unknown module ${row.module}`);
  const { subject } = ent;
  const packDir = packDirOf(ctx.packRoots || [ctx.packs], row.module);
  const pack = loadPack(packDir);
  if (!pack) return { module: row.module, skipped: "no source pack at " + packDir };
  const work = path.join(ctx.workDir, row.module);
  const stFile = path.join(work, "state.json");
  const state = readJson(stFile, null) || { v: 1, module: row.module, subject: subject.id, run: ctx.run, model: ctx.model, created: new Date().toISOString(), stages: {} };
  const m = { module: row.module, work, state, save: () => writeJson(stFile, state, true) };
  if (!fs.existsSync(stFile)) { m.save(); writeJson(path.join(work, "pack.json"), { srcPack: pack.srcPack, files: pack.files.map((f) => f.name) }, true); }
  const model = state.model, deckId = "fill_" + row.module;
  const sents = packSents(pack.files), byN = new Map(sents.map((s) => [s.n, s]));
  const packText = pack.files.map((f) => f.text).join("\n");
  const srcIds = pack.srcPack.map((s) => s.id);
  const base = { deckId, packText, avoid: pack.avoid, model, prov: "SMD", t: row.module, srcPack: srcIds };
  const stats = { facts: 0, generated: 0, rejected: {}, regenerated: 0, accepted: 0 };
  const rej = (r) => { stats.rejected[r.gate] = (stats.rejected[r.gate] || 0) + 1; };

  // 01 facts
  const chunks = chunkSents(sents, ctx.chunkTok);
  const fOut = await stage(ctx, m, "01-facts", () => chunks.map((c, i) => ({ key: "c" + i, request: requestBody(factsPrompt(c)) })), "facts");
  const facts = mergeFacts(chunks.flatMap((c, i) => readFacts(textOf(fOut, "c" + i), c, deckId).facts));
  stats.facts = facts.length;
  writeJson(path.join(work, "01-facts.json"), { facts });
  const target = Math.max(10, Math.min(100, Math.round(1.5 * facts.length)));
  const kept = row.kept | 0;
  const need = ctx.need != null ? ctx.need : Math.max(0, target - kept);
  const use = facts.slice(0, Math.min(facts.length, Math.ceil(need * ctx.overgen)));
  const groups = groupsOf(use, MCQ_N);
  const gp = groupProfiles(groups.length, subject, ctx.usmleShare);
  const profOfFid = new Map();
  groups.forEach((g, i) => g.forEach((f) => profOfFid.set(f.fid, gp[i])));
  const bankStems = bankModuleItems(ctx.bank, subject.id, row.module).map((x) => x.q);

  // one round: mcq -> solve -> review. reqs: [{ facts, profile, avoid? }]
  async function round(tag, reqs, prior) {
    const sfx = tag ? "." + tag : "";
    const mOut = await stage(ctx, m, "02-mcq" + sfx, () => reqs.map((r, i) => ({ key: "g" + i, request: requestBody(mcqPrompt(r.facts, getProfile(r.profile), byN, r.avoid)) })), "mcq");
    const made = [], rejected = [];
    reqs.forEach((r, i) => {
      const res = readMcq(textOf(mOut, "g" + i), r.facts, { ...base, seedKey: `${deckId}:02${sfx}:${i}`, prior, profile: getProfile(r.profile) });
      stats.generated += res.generated;
      res.items.forEach((x) => made.push({ ...x, profile: r.profile }));
      rejected.push(...res.rejected);
    });
    writeJson(path.join(work, "02-mcq" + sfx + ".json"), { items: made.map((x) => x.item), rejected });
    const sGroups = groupsOf(made, SOLVE_N);
    const sOut = await stage(ctx, m, "03-solve" + sfx, () => sGroups.map((g, i) => ({ key: "s" + i, request: requestBody(solvePrompt(g.map((x) => x.item))) })), "solve");
    const solved = [];
    sGroups.forEach((g, i) => readSolve(textOf(sOut, "s" + i), g.map((x) => x.item)).forEach((v, k) => {
      if (v.ok) solved.push(g[k]); else rejected.push({ fid: g[k].fact.fid, gate: "solve", why: WHY.solve });
    }));
    writeJson(path.join(work, "03-solve" + sfx + ".json"), { passed: solved.map((x) => x.item.id), rejected: rejected.filter((r) => r.gate === "solve") });
    const rGroups = [];
    for (const pid of [...new Set(solved.map((x) => x.profile))]) for (const g of groupsOf(solved.filter((x) => x.profile === pid), REVIEW_N)) rGroups.push({ pid, g });
    const rOut = await stage(ctx, m, "04-review" + sfx, () => rGroups.map((rg, i) => ({ key: "r" + i, request: requestBody(reviewPrompt(rg.g.map((x) => x.item), byN, getProfile(rg.pid))) })), "review");
    const accepted = [];
    rGroups.forEach((rg, i) => readReview(textOf(rOut, "r" + i), rg.g.map((x) => x.item)).forEach((v, k) => {
      const x = rg.g[k];
      if (v.pass) { x.item.rv = { solved: true, pass: true, old: !!v.g.old }; accepted.push(x); }
      else rejected.push({ fid: x.fact.fid, gate: "review", why: v.g.why || "failed review" });
    }));
    writeJson(path.join(work, "04-review" + sfx + ".json"), { accepted: accepted.map((x) => x.item.id), rejected });
    rejected.forEach(rej);
    return { accepted, rejected };
  }

  const r0 = await round("", groups.map((g, i) => ({ facts: g, profile: gp[i] })), bankStems.slice());
  // regenerate every rejected fact once (one fact a request, so avoid names it), then drop
  const factBy = new Map(use.map((f) => [f.fid, f]));
  const okFids = new Set(r0.accepted.map((x) => x.fact.fid));
  const redo = [], seenFid = new Set();
  for (const r of r0.rejected) {
    if (seenFid.has(r.fid) || okFids.has(r.fid) || !factBy.has(r.fid)) continue;
    seenFid.add(r.fid);
    redo.push({ facts: [factBy.get(r.fid)], profile: profOfFid.get(r.fid), avoid: { fi: 0, why: r.why } });
  }
  stats.regenerated = redo.length;
  const r1 = await round("r1", redo, bankStems.concat(r0.accepted.map((x) => x.item.q)));
  const all = r0.accepted.concat(r1.accepted).slice(0, need);
  const items = all.map((x) => {
    const it = { ...x.item };
    if (x.profile === "usmle") it.ex = ["usmle"]; else delete it.ex;   // subjectIndex counts any ex as a USMLE item
    return it;
  });
  stats.accepted = items.length;
  const usage = sumUsage([], model);
  for (const s of Object.values(state.stages)) if (s.usage) for (const k of ["calls", "inTok", "outTok", "thinkTok", "cachedTok", "usd"]) usage[k] += s.usage[k];
  const out = { v: 1, module: row.module, subject: subject.id, branch: subject.branch, run: state.run, model, pv: PREP_PV, srcPack: srcIds, target, kept, need, stats, usage, items };
  writeJson(path.join(ctx.outDir, row.module + ".json"), out);
  return { module: row.module, need, accepted: items.length, stats, usage };
}

// =====================================================================================================================
// Merge: v1 -> v2, never writing v1
// =====================================================================================================================
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
export function mergeBank({ subjects, fromDir, toDir, fillDir, log = console.log, replace = false }) {
  if (!fs.existsSync(fromDir)) throw new Error("no source bank at " + fromDir);
  if (path.resolve(fromDir) === path.resolve(toDir)) throw new Error("--to must differ from --from");
  if (fs.existsSync(toDir)) {
    if (!replace) throw new Error(`${toDir} exists; a published version is immutable. Pass --replace to rebuild an unpublished one.`);
    fs.rmSync(toDir, { recursive: true, force: true });
  }
  fs.cpSync(fromDir, toDir, { recursive: true });
  const ver = Number((/v(\d+)$/.exec(path.basename(toDir)) || [])[1]) || 2;
  const touched = new Map();
  let added = 0;
  for (const s of subjects) for (const mod of modulesOf(s)) {
    const f = readJson(path.join(fillDir, mod.id + ".json"), null);
    if (!f || !Array.isArray(f.items) || !f.items.length) continue;
    const p = path.join(toDir, s.id, "mcq", mod.id + ".json");
    const cur = readJson(p, { topic: mod.id, items: [] });
    const ids = new Set(cur.items.map((x) => x.id));
    const fresh = f.items.filter((x) => x.prov === "SMD" && x.gen === "AI" && x.t === mod.id && !ids.has(x.id));
    cur.items = cur.items.concat(fresh);
    writeJson(p, cur);
    added += fresh.length;
    touched.set(s.id, s);
  }
  const manifestP = path.join(toDir, "manifest.json");
  const manifest = readJson(manifestP, { v: 1, subjects: [] });
  for (const s of touched.values()) {
    const sdir = path.join(toDir, s.id), mdir = path.join(sdir, "mcq");
    const files = fs.existsSync(mdir) ? fs.readdirSync(mdir).filter((f) => f.endsWith(".json")).sort() : [];
    const byTopic = new Map(files.map((f) => [f.replace(/\.json$/, ""), readJson(path.join(mdir, f), { items: [] }).items]));
    const items = [...byTopic.values()].flat();
    const ix = subjectIndex(s, items);
    ix.v = ver;
    ix.smd = items.filter((x) => x.prov === "SMD").length;
    for (const t of ix.topics) {
      const list = byTopic.get(t.id) || [];
      const smd = list.some((x) => x.prov === "SMD"), lic = list.some((x) => x.prov === "LIC");
      if (smd && !lic) { t.lic = "StewardMD"; t.cite = "StewardMD (AI-generated, auto-checked)"; }
      else if (smd && lic) t.cite = "MedMCQA; StewardMD (AI-generated, auto-checked)";
    }
    if (ix.smd && ix.source === "medmcqa") ix.modifications += " Layer B: AI-generated, auto-checked StewardMD items (prov SMD) added.";
    writeJson(path.join(sdir, "index.json"), ix);
    const topics = ix.topics.map((t) => ({ id: t.id, items: byTopic.get(t.id) || [] })).filter((t) => t.items.length);
    if (topics.length) writeJson(path.join(sdir, "search.json"), buildSearch(topics));
    let bytes = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else bytes += fs.statSync(q).size; } };
    walk(sdir);
    const row = { id: s.id, items: items.length, modules: ix.topics.filter((t) => t.group !== "mixed").length, bytes, index: sha(fs.readFileSync(path.join(sdir, "index.json"))) };
    const i = manifest.subjects.findIndex((x) => x.id === s.id);
    if (i >= 0) manifest.subjects[i] = { ...manifest.subjects[i], ...row }; else manifest.subjects.push(row);
    log(`  ${s.id}: ${ix.smd} SMD items, ${items.length} in all`);
  }
  manifest.v = ver;
  manifest.merged = { from: path.basename(fromDir), fill: added };
  writeJson(manifestP, manifest);
  log(`merged ${added} items into ${toDir} (${touched.size} subjects); ${fromDir} untouched`);
  return { added, subjects: [...touched.keys()] };
}

// =====================================================================================================================
// CLI
// =====================================================================================================================
export function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith("--")) a.flags.add(k.slice(2)); else { a[k.slice(2)] = v; i++; }
  }
  return a;
}
function selectRows(args, root, modules, bankDir) {
  if (args.module) {
    return String(args.module).split(",").map((s) => s.trim()).filter(Boolean).map((id) => {
      const ent = modules.get(id);
      const ix = ent ? readJson(path.join(bankDir, ent.subject.id, "index.json"), null) : null;
      const t = ix && (ix.topics || []).find((x) => x.id === id);
      return { module: id, kept: t ? t.count | 0 : 0, fill: null };
    });
  }
  const sf = readJson(path.resolve(root, args.shortfall || "prep/fill/shortfall.json"), null);
  if (!sf || !Array.isArray(sf.modules)) throw new Error("no shortfall list: run tools/prep-build-bank.mjs first or pass --module");
  return sf.modules.map((x) => ({ module: x.module, kept: x.kept | 0, fill: x.fill }));
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const root = deps.root || ROOT, log = deps.log || console.log;
  const R = (p, d) => path.resolve(root, args[p] || d);
  const extra = args["packs-extra"] || (deps.env || process.env).PREP_PACKS_EXTRA;
  const packRoots = [R("packs", "prep/fill/packs"), ...(extra ? [path.resolve(root, String(extra).replace(/^~(?=\/|$)/, os.homedir()))] : [])];
  const subjects = loadTaxonomy(R("tax", "prep/taxonomy"));
  const modules = moduleMap(subjects);
  const cfg = { ...vertexConfig(deps.env || process.env), ...(deps.config || {}) };

  if (args.flags.has("merge")) return mergeBank({ subjects, fromDir: R("from", "prep/bank/v1"), toDir: R("to", "prep/bank/v2"), fillDir: R("out", "prep/fill"), log, replace: args.flags.has("replace") });

  const share = args["usmle-share"] != null ? Number(args["usmle-share"]) : 0.3;
  if (args.flags.has("dry-run")) {
    if (args.assume) {
      const counts = Object.fromEntries(String(args.assume).split(",").map((kv) => kv.split("=")).map(([k, v]) => [k.trim(), Number(v)]));
      const e = estimateCounts(counts, cfg.model);
      log(`DRY RUN (no calls). Whole-fill estimate at Batch price, model ${cfg.model}:`);
      for (const r of e.rows) log(`  ${r.profile.padEnd(8)} ${String(r.n).padStart(6)} questions  in ${(r.inTok / 1e6).toFixed(2)}M  out ${(r.outTok / 1e6).toFixed(2)}M  $${r.usd.toFixed(2)}  ($${r.per100.toFixed(3)} per 100)`);
      log(`  total    ${String(e.total.n).padStart(6)} questions  in ${(e.total.inTok / 1e6).toFixed(2)}M  out ${(e.total.outTok / 1e6).toFixed(2)}M  $${e.total.usd.toFixed(2)} (Rs ${Math.round(usdToInr(e.total.usd))})`);
      return { dryRun: true, ...e };
    }
    const rows = selectRows(args, root, modules, R("bank", "prep/bank/v1"));
    let tot = { inTok: 0, outTok: 0, usd: 0, need: 0 };
    const out = [];
    log(`DRY RUN (no calls). ${rows.length} modules, model ${cfg.model}, Batch price:`);
    for (const r of rows) {
      const ent = modules.get(r.module);
      if (!ent) { log(`  ${r.module}: not in the taxonomy`); continue; }
      const pack = loadPack(packDirOf(packRoots, r.module));
      // Same rule as the real run (fillModule): --need wins, else the module's shortfall; 0 means nothing is written.
      const n = args.need != null ? Number(args.need) : (r.fill != null ? r.fill : 0);
      if (!n) { log(`  ${r.module.padEnd(32)} need    0  (not short; pass --need to write anyway)`); continue; }
      const gp = groupProfiles(Math.ceil((n * EST.overgen) / MCQ_N), ent.subject, share);
      const mix = {};
      gp.forEach((p) => { mix[p] = (mix[p] || 0) + MCQ_N; });
      const scale = n / Object.values(mix).reduce((a, b) => a + b, 0);
      let inTok = 0, outTok = 0;
      for (const [pid, k] of Object.entries(mix)) { const q = perQuestion(pid); inTok += q.in * k * scale; outTok += q.out * k * scale; }
      let note = "no pack: facts estimated";
      if (pack) {   // facts input from the real chunks of the pack instead of the representative figure
        const chunks = chunkSents(packSents(pack.files), Number(args["chunk-tok"]) || EST.chunkTok);
        const exact = chunks.reduce((a, c) => a + promptTokens(factsPrompt(c)), 0);
        const est = n * EST.overgen * EST.extract * (repCallTokens(profilesFor(ent.subject).base).factsChunk / EST.factsPerChunk);
        inTok += exact - est;
        outTok += Math.min(chunks.length * PREP_LIMITS.facts.maxItems, Math.ceil(n * EST.overgen * EST.extract)) * EST.factOut - n * EST.overgen * EST.extract * EST.factOut;
        note = `pack ${chunks.length} chunks`;
      }
      const usd = costUsd({ inTok, outTok }, cfg.model, { batch: true });
      tot = { inTok: tot.inTok + inTok, outTok: tot.outTok + outTok, usd: tot.usd + usd, need: tot.need + n };
      out.push({ module: r.module, need: n, profiles: mix, inTok: Math.round(inTok), outTok: Math.round(outTok), usd });
      log(`  ${r.module.padEnd(32)} need ${String(n).padStart(4)}  ${Object.entries(mix).map(([k, v]) => k + ":" + Math.round(v * scale)).join(" ")}  in ${Math.round(inTok)}  out ${Math.round(outTok)}  $${usd.toFixed(4)}  (${note})`);
    }
    log(`  total need ${tot.need}: in ${(tot.inTok / 1e6).toFixed(2)}M out ${(tot.outTok / 1e6).toFixed(2)}M  $${tot.usd.toFixed(2)} (Rs ${Math.round(usdToInr(tot.usd))})`);
    return { dryRun: true, modules: out, total: tot };
  }

  const vx = deps.vertex || createVertex({ env: deps.env, config: deps.config, fetch: deps.fetch, exec: deps.exec, sleep: deps.sleep, now: deps.now });
  const workDir = R("work", "prep/fill/work");
  const rows = selectRows(args, root, modules, R("bank", "prep/bank/v1"));
  let active = 0;
  for (const r of rows) { const st = readJson(path.join(workDir, r.module, "state.json"), null); if (st) for (const s of Object.values(st.stages || {})) if (s.status === "submitted") active++; }
  const ctx = {
    vx, log, modules, model: vx.cfg.model, workDir, packs: packRoots[0], packRoots, outDir: R("out", "prep/fill"), bank: R("bank", "prep/bank/v1"),
    run: args.run || "fill-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""),
    usmleShare: share, overgen: args.overgen != null ? Number(args.overgen) : EST.overgen, need: args.need != null ? Number(args.need) : null,
    chunkTok: Number(args["chunk-tok"]) || EST.chunkTok, pollMs: (args["poll-sec"] != null ? Number(args["poll-sec"]) : 60) * 1000,
    noWait: args.flags.has("no-wait"), stageWaitMs: 0, maxJobs: Number(args["max-jobs"]) || 8, active,
  };
  const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const maxWaitMs = (args["max-wait-min"] != null ? Number(args["max-wait-min"]) : 1440) * 60000;
  const t0 = Date.now(), done = [], errors = [];
  let pending = rows;
  for (let pass = 0; pending.length; pass++) {
    const next = [];
    for (const r of pending) {
      try { const s = await fillModule(ctx, r); done.push(s); log(s.skipped ? `${r.module}: skipped, ${s.skipped}` : `${r.module}: accepted ${s.accepted} of ${s.need} needed, $${s.usage.usd.toFixed(4)}`); }
      catch (e) { if (e.pending) { next.push(r); log("  pending: " + e.message); } else { errors.push({ module: r.module, error: e.message }); log(`${r.module}: ERROR ${e.message}`); } }
    }
    pending = next;
    if (!pending.length || ctx.noWait) break;
    if (Date.now() - t0 > maxWaitMs) { log("max wait reached; re-run to resume"); break; }
    await sleep(ctx.pollMs);
  }
  if (pending.length) log(`${pending.length} modules still waiting on Batch jobs; re-run the same command to resume.`);
  return { done, pending: pending.map((r) => r.module), errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((r) => { if (r && r.errors && r.errors.length) process.exitCode = 1; }).catch((e) => { console.error(e.message); process.exit(1); });
}
