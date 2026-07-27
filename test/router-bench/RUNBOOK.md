# MaiK Router Benchmark — Runbook (run AFTER the UTC quota reset)

The MaiK per-IP daily token cap (`MAIK_DAILY_TOKEN_LIMIT`, default 200k, `functions/_usage.js`) is
keyed by UTC day (`dayKey = toISOString().slice(0,10)`), so it resets at **00:00 UTC = 05:30 IST**.
The live router benchmark needs Vertex and therefore quota — run it only after the reset.

## 0. Preconditions
- Current time is past 00:00 UTC (05:30 IST).
- Quick quota probe: `curl -s https://stewardmd.in/api/ai/route -X POST -H 'Content-Type: application/json' -H 'Origin: https://stewardmd.in' -d '{"q":"dm2 rx"}'` — expect JSON with `primaryConcept`, NOT `{"error":"quota"}`.

## 1. Run the full suite (LIVE)
```
node test/router-bench/run-v2.mjs           # MAXQ=260 default (new-first). ~155k tokens < 200k cap.
```
Produces `test/router-bench/REPORT.md` + `results-v2.json`. Metrics: intent accuracy, entity-linking
(concept-name + KB-node), retrieval recall@10 (router-concept vs raw-query), clarification
rate/recall/precision/false-clarify, **response time** (KB-instant path, concurrent + sequential-UB
p50/p90/p95), router latency, Gemini-bypass rate — all per-category, every failure listed.

If the run hits the cap partway it reports `quota-skipped: N` and scores the rest (honest partial).

## 2. Analyse failures for ARCHITECTURE, not special-cases
Read `REPORT.md`. For each failure section look for a GENERAL cause, and fix the mechanism — never add
a per-disease/per-abbreviation rule (that violates the universal-router design). Candidate levers:
- **Intent misses** → the router intent taxonomy / inference rules in the `/route` system prompt
  (`functions/api/ai/[[path]].js` ~line 795). E.g. a whole intent class mislabelled = a rule gap, not 12 special cases.
- **Entity-link (KB node) misses** → brand→generic / code→full-name / eponym expansion rule in the prompt,
  OR the client concept→diseaseId resolver (`resolveId`/`bestNameMatch` in `kb/ai/maik-kb.js`).
- **Retrieval misses** → whether we retrieve on the router concept vs raw query; section bias; the
  disease-level vs chunk-level mix. Note: many "misses" are non-disease entities with no disease doc.
- **False-clarify** (asked when context sufficient) → the ambiguity rule (`ambiguous ONLY if >1 common
  meaning AND no disambiguating context`), server gate `ambiguous && options>=2`.
- **Missed-clarify** → same rule, opposite direction.
- **Wrong bypass** (answered a defer/complex query from KB) → `isComplex` in `maik-kb.js` + client policy.

## 3. Implement + deploy the architectural fix
- Edit the prompt/policy. Behind a flag / recovery tag per the reversible-changes norm.
- If client JS changed, bump its `?v=goldNNNN` in `index.html`.
- Commit + `git push origin main` (Cloudflare Pages serves repo root; deploy is automatic, ~1-2 min).
  Verify with `curl -sL https://stewardmd.in/ | grep goldNNNN`.

## 4. Verify — regression-free improvement
Re-run ONLY the affected queries (cheap, stays under the cap):
```
FILES=hl-voice,hl-ambiguous node test/router-bench/run-v2.mjs      # subset by file basename
```
Confirm the target metric rose AND no category regressed. "No optimisation counts without a measured,
regression-free improvement." If budget is exhausted, verify on the next UTC reset.

## 5. Record
Update `REPORT.md` with before/after, and append the outcome to memory `stewardmd-maik-v2.md`.

## Budget math
~595 tokens/router-call. 260 queries ≈ 155k of the 200k/day cap → one full run + a ~40k targeted
re-run fit the same day. Bigger iteration spills to the next reset.
