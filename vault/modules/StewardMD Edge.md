---
tags: [module, ai, edge]
status: built (JS + dataset); iPhone gates A0.2/A0.3/A0.6 passed 2026-10-02; Android (Pixel 9) mechanisms pass, Needle passes with the thread fix (p95 617 ms), FunctionGemma borderline (1.1-1.4 s); owner options in [[Edge-Options-2026-10-02]]
flag: smd_edge (default OFF)
---
# StewardMD Edge

On-device request router and value extractor. Plan: [[Edge-Master-Plan]]. Evidence: [[Needle-Audit]].

## What exists (2026-10-01 sprint)
| File | Global | Job |
|---|---|---|
| `clinical-params.js` | `SMD_CPARAMS` | Shared parser: typed clinical values as evidence records (span, unit, assertion, time context). `stripValues()` gives the words left for name matching. |
| `calc-prefill.js` | `SMD_CALC_PREFILL` | Usable values onto `MEDCALC` inputs, unit-checked; CURB-65 / qSOFA thresholds; unstated items listed. |
| `edge-runtime.js` | `SMD_EDGE_RUNTIME` | Engine contract: 1 running + 1 waiting, deadline, stuck-call handling, kill + cold reload, session token, back-off, no network. |
| `edge-router.js` | `SMD_EDGE` | Deterministic candidates (max 5) -> rules answer for exact names / ICD -> fixed `choose_option` tool -> validation. Pass = null, caller continues. `needleAdapter()` for the native plugin. |
| `home.js` | | Hook in `maikSendRest` after continuity; `maikEdgeRender` cards with "Ask MaiK anyway" (`data-maik-edgeask`), ICD rows (`data-maik-icd`). |

## Dataset and bake-off scorer (`scripts/edge/`)
| Script | Job |
|---|---|
| `generate.mjs` | Canonical rows from the app's own data (446 calculators, home tools, 109 drugs, ICD index, clinical questions, negations). Candidates come from the REAL `edge-router.js`. Splits by phrasing family; 10% of targets held out; test text never repeats in train. Writes `vault/plans/edge-data/dataset/` (~3 min). |
| `export.mjs` | `cactus` (platform chat JSONL), `needle-local` (`{query,tools,answers}`), `llama-json` (`{"option":n}`), `bakeoff` (device harness input). Only `route_by:"model"` rows; train options shuffled 2x. Checked with Needle 3.0.6's own `read_examples`: 0 skipped. |
| `score.mjs` | Router metrics kept separate (recall@5, coverage, accepted-route accuracy, wrong tool shown, fallback, missed, end-to-end) by language/kind/route/tag; policies `rules`, `top1`, `oracle`, `--pred <device output>`; `--human <tsv>`, `--draft <txt>`, `--extraction` (gold set). |
| `metrics.mjs` | Pure scoring + pass marks (7.4), unit-tested in `test/edge-dataset.test.mjs`. |

Committed: the FROZEN `test.jsonl` + `manifest.json` and `vault/plans/edge-data/gold/cparams-gold.jsonl`.
train/val/canonical/export are gitignored and regenerated.

**Baselines on the frozen test set (4,077 rows, schema `edge-router-2`, same labels as -1):**
| Policy | Coverage | Accepted-route acc. | Wrong shown | Danger | Verdict |
|---|---|---|---|---|---|
| rules (improved Phase 0) | 65.5% (Hinglish 71.8%, Tenglish 32.1%) | 100% | 0.0% | 100% | PASS |
| top1 (always option 1) | 93.5% | 93.9% | 5.7% | 99.6% | FAIL |
| base FunctionGemma 270M + grammar (host CPU, -1 rows) | 93.4% | 91.8% | 7.7% | 99.6% | FAIL: must be fine-tuned |
| oracle (labels) | 88.3% | 100% | 0.0% | 100% | ceiling |
Layer 0 (rules) answers an exact calculator name, an exact home-tool title or generic drug name after
navigation words in English/Hinglish/Tenglish ("antibiogram kholo", "search icd teruvu"), and ICD
requests. A name that fits two things ("insulin": drug and tool) is never exact. Brand names are never
exact until the combination-brand lexicon bug is fixed (Entresto -> valsartan; task queued). Tenglish
test rows are mostly brands, hence 32%. A model has to win coverage beyond 65.5% at under 0.5% wrong.
Extraction gold set (45 rows): 45 exact, 0 unsafe.

**Bugs the scorer found and fixed:** `MEDCALC.find` read "R-ISS" as "iss", "PHQ-9" for "phq-2",
"GAD-7" for "gad-2" (single letters/digits dropped) and called shared names exact ("timi", "meld na",
"framingham"); "search icd" built an ICD lookup; "open fracture" lost "open"; the parser took
"mother has diabetes, her sugar 300", "cr 1.4 or 1.8" and Hinglish/Tenglish past values as current.

## Native (iPhone 15 Pro and Pixel 9 runs, 2026-10-02): [[Edge-Runbook]]
| Piece | Where | State |
|---|---|---|
| Needle engine plugin | `local-plugins/capacitor-needle` | Android: engine in `:edge` process (Messenger IPC, `kill()` ends it), JNI mmap's weights, 16 KB link flags. iOS: serial queue + token cap, no kill. iOS: built and run on an iPhone 15 Pro (base weights: 150/150 `ok`, p95 259 ms; stuck calls resolve `busy`). Android (Pixel 9, charging-throttled): `:edge` isolation and kill work, but `complete` takes 8.5-10 s (fixed 8-thread spin pool, no thread knob in `needle.h`); out for Android until Cactus adds one or an unplugged re-time says otherwise. NOT in `package.json` (owner's call after the gates). Binaries + weights via `scripts/fetch-needle.sh` (pinned sha256). |
| llama grammar | `local-plugins/capacitor-llama` | Opt-in `grammar` (GBNF) on `generate`, both platforms; draft decoding off when constrained. No grammar = unchanged. iPhone: FunctionGemma 270M Q8_0 + grammar 50/50 valid, p95 221 ms; MaiK local answers unaffected (A0.3 step 1). Pixel 9: grammar holds, but 2.5-4.8 s per call on CPU. |
| Score version map | `edge-schemas.js` (`SMD_EDGE_SCHEMAS`), generated by `scripts/edge/schemas.mjs` from `calculators.js` | 23 families (MELD, PHQ, GAD, QTc, Wells...). A calculator card (MaiK or Edge, flags `smd_calc_prefill`/`smd_edge`) offers the other versions, each prefilled from the same words. Also exports all 446 calculator schemas to `vault/plans/edge-data/schemas/calculators.json`. `--check` keeps both in sync (test). |
| Android build | `test/native-host/run.sh android` | Both plugins compile and link (NDK r27.2): 16 KB LOAD alignment, JNI exports, every import resolvable at API 26, no network symbols in Needle. |
| Host engine runs | `test/native-host/run.sh llama` / `needle` | The REAL JNI code on a Linux CPU. FunctionGemma: grammar on 1,512/1,512 valid `{"option":n}`, off 0/60. Needle: envelopes parse; base model below the 0.5 floor on all rows (passes); p50 513 ms (x86, not a phone). Found and fixed: Needle replies cut mid-character broke `NewStringUTF` (now UTF-8 bytes across JNI). |
| On-device speech (A1.2) | `local-plugins/capacitor-community-speech-recognition` (Android + iOS), `native-bridge.js`, `voice.js`; flag `smd_speech_ondevice` | `start({onDevice: "off" \| "prefer" \| "require"})`, `available()` reports on-device support, a `recognitionMode` event reports what ran. Android compiles (NDK/AGP build); Swift not compiled here; device test pending (Mac prompt). |
| JS adapters | `edge-router.js` | `needleAdapter(plugin, {weightsPath, calibrated, killable})`, `llamaAdapter(plugin, {modelPath})` (bake-off only: evicts MaiK's pack), `grammarFor(n)`, `bakeoff(rows, engine)`. |

## Gotchas
- Back-off (plan A0.5) is the default env in `edge-router.js` (`SMD_EDGE_ENV`, when set, replaces it):
  low memory, thermal SEVERE+ (iOS .serious = 3), MaiK generating or Whisper decoding skip the model;
  Layer 0 rules still answer. Device numbers come from `Needle.available()` and are one request stale.
  `SMD_EDGE.backoff()` shows the current verdict.
- llama.cpp does not run a GGUF's Jinja template: `llama_chat_apply_template` detects Gemma and folds the
  system text into the user turn. Training text must match that (`export.mjs` `llama-json`, A0.3 step 4).
- The delegated chip handler in `home.js` only fires for attributes listed in its `closest(...)`
  selector. A new chip attribute must be added there or the chip is dead.
- MaiK continuity runs before Edge: a repeated short question with no new subject is a follow-up and
  never reaches Edge. Tests reset the topic with `__MAIK_TEST.setTopic(null)`.
- `SMD_SEARCH.rank` needs every term to match; the router ranks content words and falls back per word.
- Layer 0 trusts `MEDCALC.find(...).exact`. Exact now means ONE calculator carries the name; keep it
  that way or rules open the wrong score. Regression check: diff `find()` over every title + kw.
- `negated()` guard (don't / do not / stop / hold / cancel) runs before rules and the model.
- Drug and KB options get their slots before the ranked list, or weak word overlaps fill all five.
- Capacitor's plugin proxy answers ANY method name, so "plugin.kill exists" proves nothing; the
  adapter takes `killable` (default: Android only).
- Cactus replaced every needle3 binary and the header on `main` on 2026-10-02 (revision f84005f8). Our pins
  are the 2026-09-28 files, so `fetch-needle.sh` and `test/native-host/run.sh` fetch from revision
  `27c0a9a5` and keep a copy that already matches. The new upstream build is unaudited; it may change the
  thread fallback that a62e9fbab works around. Re-audit it before moving the pin.
- No engine is bundled. `SMD_EDGE.autoEngine()` uses `Capacitor.Plugins.Needle` on native when the
  plugin exists (Day 4 work). Until then only the rules layer answers.

## Tests
`test/clinical-params.test.mjs`, `test/calc-prefill.test.mjs`, `test/maik-brain-prefill.test.mjs`,
`test/edge-runtime.test.mjs`, `test/edge-router.test.mjs`, `test/voice-ambient-reported.test.mjs`;
`test/edge-dataset.test.mjs`, `test/calc-find.test.mjs`, `test/edge-schemas.test.mjs`, `test/cockcroft-gault-agree.test.mjs`;
headless `test/run-maik-calc-prefill-ui.mjs`, `test/run-maik-edge-ui.mjs` (mock engine), `test/run-maik-calc-route-ui.mjs`.
