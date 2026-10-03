---
tags: [module, ai, edge]
status: built (JS + dataset); Needle linked into the app (package.json, 2026-10-03; flag still OFF; live on both phones). iPhone 2026-10-02: A0.2/A0.3 passed; A0.6 runbook marks passed but MISSED the plan's "no SEVERE" thermal mark (Serious from minute 2). 2026-10-03: FunctionGemma digit pick p95 37 ms (iPhone) / 171 ms (Pixel, unplugged); Needle Pixel p95 747 ms with the thread fix; back-off verified on the Pixel, simulated on the iPhone (real MaiK-busy and availMB with MaiK Lite verified 2026-10-03 evening; real Serious pending); owner options in [[Edge-Options-2026-10-02]]. Pixel 2026-10-03 22:30 round (edge8): renderer-gone PASS (first request after the recreate skips the model); Needle p95 797 ms, +123 MB PSS PASS; FunctionGemma pick p95 395 ms PASS but +575 MB PSS MISS (+400 budget); 30-min unplugged mixed session: no SEVERE (LIGHT max, skin 41 C), battery 100 -> 92%, app never died, Needle 127 ok / 22 timeout / 1 unavailable under MaiK load (MISS); iPhone with real MaiK Lite generation: back-off skips the engine (0 calls), rules answer, Edge resumes; availMB minimum 5,349 MB during an answer (PASS); real iPhone Serious still open (thermal stayed fair)
flag: smd_edge (default ON for all since 2026-10-04, owner; "0" turns it off)
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
KB page (2026-10-04): a navigation word (open/show/page/screen/kholo/dikhao/teruvu/chupinchu) plus words that
are EXACTLY a disease's KB name or a `MaiKKB._alias` entry, resolved `confident`, is exact ("sepsis kholo",
"tb chupinchu"); "open pneumonia antibiotics" or a name only matched by prefix ("dengue" -> Dengue Fever) is not.
The frozen test set has no KB rows and `score.mjs` does not load MaiKKB, so rules coverage is unchanged by it.
Extraction gold set (45 rows): 45 exact, 0 unsafe.

**Bugs the scorer found and fixed:** `MEDCALC.find` read "R-ISS" as "iss", "PHQ-9" for "phq-2",
"GAD-7" for "gad-2" (single letters/digits dropped) and called shared names exact ("timi", "meld na",
"framingham"); "search icd" built an ICD lookup; "open fracture" lost "open"; the parser took
"mother has diabetes, her sugar 300", "cr 1.4 or 1.8" and Hinglish/Tenglish past values as current.

## Native (iPhone 15 Pro and Pixel 9 runs, 2026-10-02): [[Edge-Runbook]]
| Piece | Where | State |
|---|---|---|
| Needle engine plugin | `local-plugins/capacitor-needle` | Android: engine in `:edge` process (Messenger IPC, `kill()` ends it), JNI mmap's weights, 16 KB link flags. iOS: serial queue + token cap, no kill. iOS: built and run on an iPhone 15 Pro (base weights: 150/150 `ok`, p95 259 ms; stuck calls resolve `busy`). Android (Pixel 9): `:edge` isolation and kill work; with the JNI thread fix (3 threads on the A720s) the unplugged re-time is 50/50 `ok`, p50 370 ms, p95 747 ms (2026-10-03). Back-off verified on the Pixel: MaiK generating and (simulated) thermal SEVERE skip the engine, rules still answer, Edge resumes after. Renderer-gone on the Pixel (2026-10-03, `Page.crash`): `onRenderProcessGone` fired, the activity recreated in the same process, `rendererGone:true`, rules still answer, cleared by a force-stop; the first routed request after the recreate still called the model on `edge7`, fixed in `edge8`; re-tested on the Pixel 2026-10-03 22:34: the FIRST routed request after the recreate skips the engine. Peak PSS (Pixel, 2026-10-03): Needle adds ~123 MB (app 437 + `:edge` 112 MB vs a 411-424 MB baseline; budget +150). 30-minute unplugged mixed session with MaiK Lite: 127 `ok`, 22 `timeout`, 1 `unavailable` of 150 (timeouts cluster after MaiK answers; misses the 800 ms warm p95 under that load), `:edge` restarted 15 times by timeout kills, app process never died, thermal LIGHT max, battery 100 -> 92%. **In `package.json` since 2026-10-03** (`cap sync` links it on both platforms; `Needle.available()` answers in the live WebView on the Pixel and the iPhone). iPhone back-off with MaiK busy and Serious simulated: engine skipped, rules answer, Edge resumes; availMB 6,120 at rest, -47 MB with Needle loaded, -107 MB more with FunctionGemma (2026-10-03). Real MaiK Lite generation (2026-10-03 evening, MaiK Lite side-loaded and left installed): 12 routes during prefill and streaming, `othersBusy:true`, engine not called, null in 19-38 ms, rules answer, Edge resumes after; availMB 5,539 with MaiK Lite idle, minimum 5,349 during an answer. Real Serious not reached (thermal stayed fair). Binaries + weights via `scripts/fetch-needle.sh` (pinned sha256); every native build needs that script first (and `make-xcframework.sh` for iOS). |
| llama grammar | `local-plugins/capacitor-llama` | Opt-in `grammar` (GBNF) on `generate`, both platforms; draft decoding off when constrained. No grammar = unchanged. iPhone: FunctionGemma 270M Q8_0 + grammar 50/50 valid, p95 221 ms; MaiK local answers unaffected (A0.3 step 1). Pixel 9: grammar holds, but 2.5-4.8 s per call on CPU. **`pick` option** (forced `{"option":` prefix, one prefill, softmax over the digit tokens; both platforms): Pixel 9 unplugged 50/50 `ok`, p50 120 ms, p95 171 ms (was 0/50 with the grammar); re-run on the charger 2026-10-03 22:36: 50/50, p50 271, p95 395 ms. **Memory MISS:** the app is 996-1,000 MB with FunctionGemma loaded vs 411-424 MB baseline (~+575 MB, budget +400). iPhone 15 Pro (Metal): 50/50 `ok`, p50 33 ms, p95 37 ms, max 350 ms; `pickTokens` 14937 4485 1083 + digit; the first load after install still exceeds the 8 s cold budget once. `llamaAdapter` sends `pick` + `grammar`; a plugin without `pick` runs the grammar. |
| Score version map | `edge-schemas.js` (`SMD_EDGE_SCHEMAS`), generated by `scripts/edge/schemas.mjs` from `calculators.js` | 23 families (MELD, PHQ, GAD, QTc, Wells...). A calculator card (MaiK or Edge, flags `smd_calc_prefill`/`smd_edge`) offers the other versions, each prefilled from the same words. Also exports all 446 calculator schemas to `vault/plans/edge-data/schemas/calculators.json`. `--check` keeps both in sync (test). |
| Android build | `test/native-host/run.sh android` | Both plugins compile and link (NDK r27.2): 16 KB LOAD alignment, JNI exports, every import resolvable at API 26, no network symbols in Needle. |
| Host engine runs | `test/native-host/run.sh llama` / `needle` | The REAL JNI code on a Linux CPU. FunctionGemma: grammar on 1,512/1,512 valid `{"option":n}`, off 0/60. Needle: envelopes parse; base model below the 0.5 floor on all rows (passes); p50 513 ms (x86, not a phone). Found and fixed: Needle replies cut mid-character broke `NewStringUTF` (now UTF-8 bytes across JNI). |
| On-device speech (A1.2) | `local-plugins/capacitor-community-speech-recognition` (Android + iOS), `native-bridge.js`, `voice.js`; flag `smd_speech_ondevice` | `start({onDevice: "off" \| "prefer" \| "require"})`, `available()` reports on-device support, a `recognitionMode` event reports what ran. Device-tested on both phones (2026-10-02). Android 13+ adds a per-language `onDeviceLanguage` (`checkRecognitionSupport`; Pixel: te-IN `no`) and reports the mode from `onReadyForSpeech`, so no "On-device" flash before a fallback (2026-10-03). |
| JS adapters | `edge-router.js` | `needleAdapter(plugin, {weightsPath, calibrated, killable})`, `llamaAdapter(plugin, {modelPath})` (bake-off only: evicts MaiK's pack), `grammarFor(n)`, `bakeoff(rows, engine)`. |

## Engine choice (owner, 2026-10-04)
Setting `smd_edge_engine`: `needle` (default), `functiongemma`, `rules` (no model; Layer 0 still answers).
`smd_edge` "0" still turns Edge off. `SMD_EDGE.engineChoice()` / `setEngineChoice(v)` (switches at once,
releases the old engine) / `engineName()`. UI: Settings > MaiK, "Edge engine" radio group under "Who
answers" (`maik-engine.js` `edgeEngineHTML`, `data-me-edge`, download `data-me-edgedl`).
- FunctionGemma = ggml-org `functiongemma-270m-it-q8_0.gguf` rev `2566ce14`, 291,557,792 B, sha256
  `83940d4d...5270` (re-hashed 2026-10-04). Registered in `maik-models.js` as the synthetic pack
  `EDGE_FG_ID = "edge-functiongemma"` (not in `PACKS`, so never in the model library); same downloader,
  native sha check, `pathFor`, `remove`. Downloaded from Hugging Face directly (Gemma Terms of Use, as for
  MedGemma; never re-hosted). No file on the phone: `autoEngine()` returns null and the rules answer.
- Caveats: base FunctionGemma is not fine-tuned (bake-off 7.7% wrong shown, FAIL); +575 MB PSS on the
  Pixel (budget +400); it shares the llama plugin with MaiK, so every Edge call after a MaiK answer
  reloads FunctionGemma and the next MaiK answer reloads its pack. `window.SMD_LLAMA_HOLDER` ("edge" /
  "maik") names who loaded last: `maik-local.js` reloads when another holder took the plugin (the plugin's
  `available().loaded` cannot tell), and `llamaAdapter` never picks with, cancels or releases a model it
  did not load. FunctionGemma never loads while MaiK generates: `othersBusy` (MaiK queue running) skips
  the engine before `load()`. MLX MaiK (iOS, flag off) is not evicted, so both stay resident there.
- Pixel 9, 2026-10-04 (OTA v174 + this branch's JS over CDP; GGUF adb-pushed to
  `Android/data/in.stewardmd.app/files/maik-models/`): with no file, choice functiongemma gave no engine and
  route() passed null (rules path). File present: "show me the resistance patterns antibiogram" was
  routed by FunctionGemma (`source: "edge"`, option 1 = tool antibiogram, p 0.83), 394 ms first call
  (2.4 s wall with the load), 100 ms warm; switching back to Needle unloaded it (holder null, Llama
  `loaded:false`). A side-loaded file reads as not installed until `smd_maik_packsha_edge-functiongemma`
  holds the registry sha (the retrain guard); the in-app Download sets it after the native hash check.

## Gotchas
- `:edge` killed outside the runtime (low-memory killer, or `adb shell run-as in.stewardmd.app kill <pid>`; plain `adb shell kill` is refused) restarts with NO weights and configure fails `needle_init: no model loaded`. `needleAdapter` tags that error `notLoaded`; `edge-runtime.js` marks itself cold, reloads under `coldMs` and retries that call once with a fresh 1,200 ms deadline (`edge2`/`edge12`, verified on the Pixel 9 2026-10-04 by injecting the JS). Before this Edge stayed dead until relaunch.
- Owner 2026-10-04: Edge is ON by default for all users, and a hot phone (thermal SEVERE+) no longer skips the model. `DEFAULT_ENV.thermalOk` is always true; MaiK shows "Phone is hot. Answers may be slower." in its footer (`#maikHot`, from `SMD_EDGE.hot()`). Memory, MaiK/Whisper busy and renderer-gone still skip. `maikPrefillOn` follows `SMD_EDGE.enabled()`, so calculator prefill is on wherever Edge is.
- Needle engine hang (2026-10-04, Pixel 9): a loaded engine that only gets `needle_complete` never returns from its ~49th-57th call; `needle_reset` does not help, `needle_init` does. `needleAdapter.complete()` runs `configure` before every call (`edge9`). After MaiK, Needle is slow from clock caps (heat) and paged-out weights (`madvise` readahead in JNI); `:edge` binds `BIND_IMPORTANT` (top-app cpuset). 10-min unplugged session: 3/50 timeouts (was 22/150), all on the first call after a 100 s+ MaiK answer. Runbook A0.6 Pixel.
- An iPhone paired over Wi-Fi is enough: `devicectl` install and `ios_webkit_debug_proxy` 1.9.2 both worked with no cable (2026-10-03). The WebKit page id changes on every relaunch; read it from `curl localhost:9222/json`.
- Pixel thermal SEVERE is not reachable safely by load; test the back-off with `adb shell cmd thermalservice override-status 3`, then `cmd thermalservice reset`.
- Android only: after the WebView renderer dies (`onRenderProcessGone`), `Needle.available()` reports `rendererGone` and the model stays off for the session (`edge7`); iOS has no hook. Device runs recorded in the runbook were on `edge5` (historical).
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
