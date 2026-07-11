# Hybrid Retrieval — Design

**Date:** 2026-07-11 · **Status:** Approved design; build the infra-independent parts now, infra parts gated on Cloudflare provisioning.

## Goal
Add a semantic (vector) retrieval arm alongside the existing lexical tf-idf arm so
MaiK follows natural phrasing, synonyms, and lay terms — lifting the lexical-only
ceiling that makes the relevance gate over-refuse and mis-route. Fuse the two arms.

## Key decisions (agreed)
- **Vector arm: Cloudflare Vectorize + Workers AI** (server-side). Not shipped-to-client
  vectors, not in-browser models. (MaiK retrieval is already online-gated by Gemini,
  so "offline retrieval" buys nothing.)
- **Fusion: Reciprocal Rank Fusion (RRF)** at **disease granularity** (matches how
  `buildPackage` assembles grounding; sidesteps chunk-id alignment).
- **Default OFF** behind a `smd_hybrid` flag until an A/B on the eval harness shows it
  beats lexical; then default on.

## Architecture

```
BUILD (offline, run once + on KB change)
  kb/tools/build-kb-index.mjs  ──►  embed each chunk (Workers AI bge-base-en-v1.5, 768-d)
                                    ──►  upsert to Vectorize index "stewardmd-kb"
                                         metadata { chunkId, diseaseId, section }

QUERY (per MaiK question, only when smd_hybrid on)
  client retrieveHybrid(query,k)
     ├─ lexical arm: interface.mjs retrieve() (LOCAL, unchanged)         ─► ranked diseaseIds
     └─ vector arm : POST /api/retrieve {query,k}                        ─► ranked diseaseIds
                        └─ Function: Workers AI embed(query) → Vectorize topK
     └─ RRF-fuse the two diseaseId rankings  ─►  fused top diseases  ─►  buildPackage grounding
```

### Build step — `kb/tools/build-kb-index.mjs` (extend)
- After chunk assembly, for each chunk call Workers AI embeddings
  (`@cf/baai/bge-base-en-v1.5`, 768-d) on `chunk.text` (batched).
- Upsert to Vectorize: `id = chunkId`, `values = embedding`,
  `metadata = { diseaseId, section }`. Idempotent (upsert by id); re-runnable when
  the KB changes. Runnable via `wrangler vectorize` or the Vectorize HTTP API.
- Emits a build report (chunk count, dims, index name). No secrets in the repo.

### Query endpoint — `functions/api/retrieve/[[path]].js` (new)
- `POST /api/retrieve` body `{ query, k }` (k default 12, clamped ≤ 50).
- Reuse `authorise(request, env)` (origin/app-token gate) — same as the AI Function.
- Embed the query via the Workers AI binding; `env.KB_VECTORIZE.query(vec, { topK })`.
- Return `{ matches: [{ diseaseId, chunkId, section, score }] }`.
- **Fail-safe:** any missing binding / error / empty → return `200 { matches: [] }`.
  Never 5xx — the client must degrade to lexical-only with no user impact.

### Client fusion — `kb/ai/interface.mjs` + `kb/ai/steward-ai.browser.js`
- Keep lexical `retrieve(query,k)` exactly as-is (the safe fallback).
- New pure helper `rrf(rankingA, rankingB, K=60)` → fused list of ids by
  `score = Σ 1/(K + rank_in_list)` (rank 0-based; id absent from a list contributes 0).
  Pure, unit-tested.
- New `retrieveHybrid(query, k)` in `steward-ai.browser.js`:
  1. `lexIds` = diseaseIds of local `retrieve(query, k)` (dedup, in rank order).
  2. `vecIds` = diseaseIds from `POST /api/retrieve` matches (dedup, in rank order).
     On any failure → `vecIds = []`.
  3. `fused = rrf(lexIds, vecIds)`; if `vecIds` empty → `fused == lexIds` (identical to today).
  4. Return fused ranked diseaseIds.
- `buildPackage`: when `smd_hybrid` is on AND there is no case differential
  (standalone knowledge question), derive the grounding candidate order from
  `retrieveHybrid` instead of lexical-only. The `topicMatch` gate then keys off the
  hybrid nearest candidate — so more specific/paraphrased questions clear the gate.
- Flag: `smd_hybrid` in localStorage, default OFF (`"0"`/unset = off, `"1"` = on).

## Evaluation (gate to default-on)
- Extend `test/maik-eval/run-eval.mjs` with a retrieval mode toggle: run the case set
  with `smd_hybrid` off vs on, comparing `topic_relevance` and the refusal rate
  (how many cases hit the `matched:false` gate). Hybrid must not regress structural
  score and should improve topic_relevance / reduce false refusals.
- Live vector quality needs the provisioned Vectorize+Workers AI (smoke test).

## Testing
- **Unit (node):** `rrf()` fusion — order, tie-break, empty-arm = passthrough, id in
  one list only; `/api/retrieve` fail-safe (missing binding → `{matches:[]}`, never throws).
- **Client:** `retrieveHybrid` returns lexical order when the vector arm fails
  (no-regression guarantee); fused order when both present (mocked fetch).
- **Eval:** the A/B above.

## Infra (you provision — I can't, no Cloudflare access)
1. Create a **Vectorize index** `stewardmd-kb` (768-d, cosine) and bind it to Pages
   Functions as `KB_VECTORIZE`.
2. Add a **Workers AI** binding (`AI`) to the Pages project.
3. Run the extended `build-kb-index.mjs` embed/upsert once (and on KB changes).
Until these exist, `/api/retrieve` returns `{matches:[]}` and the app behaves exactly
as today (lexical-only) — zero regression.

## Privacy
Only the query text + KB chunk text (non-PHI reference content) reach Workers AI /
Vectorize — same posture as the existing Gemini calls. No patient data.

## YAGNI / out of scope
Neural re-ranker, per-user personalization, chunk-level fusion, query expansion.

## Files
- Build: `kb/tools/build-kb-index.mjs` (extend).
- Endpoint: `functions/api/retrieve/[[path]].js` (new).
- Client: `kb/ai/interface.mjs` (add `rrf`), `kb/ai/steward-ai.browser.js` (`retrieveHybrid`, flag, buildPackage wiring).
- Tests: `kb/ai/rrf.test.mjs` (or extend interface tests), eval harness A/B.
