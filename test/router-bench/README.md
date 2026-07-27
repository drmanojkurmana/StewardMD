# MaiK router benchmark

Scores the LIVE production semantic router (`/api/ai/route`) + retrieval (`/api/retrieve`) against a
gold-labelled physician-query bank covering real human-language variation.

## Suite (`*.json` = `[{q, concept, intent, ambiguous, cat?, defer?, options?}]`)
- `cardiology / emergency-icu / …` — 196 multi-specialty queries (abbreviations, brands, eponyms, codes).
- `hl-voice` — voice/ASR transcription errors ("die a betes", "meta prolol", "see oh pee dee").
- `hl-typos` — misspellings ("diabetis", "pnemonia", "anaphlaxis").
- `hl-shorthand` — telegraphic clinical shorthand ("afib rvr rx", "aki w/u prerenal vs atn").
- `hl-ambiguous` — bare acronyms that SHOULD trigger clarification ("MS", "DM", "PCP") paired with
  context-resolved twins that should NOT ("MS severity on echo") → measures clarification precision.
- `hl-abbrev-brand`, `hl-bre-ame`, `hl-defer` (complex/comparison/latest → must route to Gemini).

## Runners
- **`run-v2.mjs`** (current) — full metric suite → `REPORT.md` + `results-v2.json`:
  intent accuracy · entity-linking (concept-name + KB-node) · retrieval recall@10 (router-concept vs
  raw-query) · clarification rate/recall/precision/false-clarify · **response time** (single-user serial
  probe: fast/name-sure, vector-arm, if-parallelised; + concurrent-load bound) · router latency ·
  Gemini-bypass rate — all per-category, every failure listed.
  - `node test/router-bench/run-v2.mjs` (LIVE, needs Vertex quota; MAXQ=260 default, new-first).
  - `node test/router-bench/run-v2.mjs --dry` (quota-free harness QA via the offline fallback resolver).
  - env: `MAXQ` (cap), `FILES=hl-voice,hl-typos` (subset), `LATN` (serial-probe size), `CONC`.
- `run.mjs` (v1) — concept/intent/ambiguity + latency only. Superseded by v2.

See **`RUNBOOK.md`** for the run → analyse-architecturally → fix → verify loop. The token cap
(`MAIK_DAILY_TOKEN_LIMIT`, 200k, UTC-day-keyed) resets 00:00 UTC / 05:30 IST — run live after that.
Every router change must be re-scored here (no optimisation counts without a measured, regression-free gain).
