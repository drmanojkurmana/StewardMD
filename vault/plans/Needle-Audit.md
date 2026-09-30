---
tags: [plan, ai, needle]
status: proposal
---
# Needle x StewardMD: Architecture Assessment

Sources: cactus-compute/needle @ ea68f2e (Python runtime, training/export code), the Hugging Face repo `Cactus-Compute/needle3` (config.json, needle.h, tokenizer, engine binaries), and the StewardMD codebase. Numbers come from quick base-model tests run on a 4-core x86 CPU, not a phone.

## 1. Executive conclusion

**Needle is not an intelligence layer, and it should not sit in front of MaiK as a brain.** It is a 36 MB, English-only model that turns one short sentence into a structured action, run by an engine of about 1 MB. Its real value to StewardMD is narrow but real. It can connect clinicians' plain language to the engines you already have: 446 calculators, the dose engine, interactions, antibiogram, insulin and ICD. You don't have that connection today.

It helps in three ways:
- It removes the need to load a 1 to 6 GB LLM for requests that were never LLM questions.
- It gives you voice commands, which you have none of today.
- It makes the deterministic engines usable offline on phones that cannot run MaiK at all.

Out of the box it is not good enough for clinical input. It becomes useful only if you fine-tune it on SMD's own tool surfaces and wrap every output in deterministic validation.

What the code shows:
- **Your engines are strong but hard to reach.** `MEDCALC.run()` exists and is headless. But `maikCalcFor` (`home.js:7078`) only opens the calculator, and `home.js:9043` calls `MEDCALC.open(calcId)` with no prefill. "calculate CURB-65 for a 72-year-old with RR 32" throws away 72 and 32.
- **MaiKBrain's calculator step can never compute.** `plan()` never sets `args.inputs`, so the `calculator:run` step at `maik-brain.js:316` always returns null.
- **You have no voice commands anywhere.** A dictated prescription never becomes a structured row.
- **Routing is hand-written regex, many times over.** It lives in `maikRoute`, `maikToolChipsHTML`, `maikKitTool`, `CODE_ASK`, `SMD_DOSE.intent`, and MaiKScope (about 696 alternations). There are about nine intent classifiers, six abbreviation tables and six Cockcroft-Gault implementations, and the Cockcroft-Gault versions can disagree for the same patient.
- **The smallest local LLM is 1.1 GB with a 6 GB RAM floor.** Low-end Android gets nothing except the cloud or KB-only mode.

These are exactly the gaps a tiny tool-calling model is shaped for.

## 2. What Needle actually is (claims checked against the code)

**Model.** 121M parameters, most of them in n-gram "engram" tables, so compute is closer to a 50M model. Hidden size 768, 20 layers, attention with 12 query heads and 2 key/value heads.
- Vocabulary is 8,192 tokens.
- `kv_window` is 256 and the sliding window is 1,024.
- Weights are 2-bit, the KV cache is int8.
- Every depth from 2 to 20 layers can be sliced out as its own model.

**Runtime.** The C API is `needle_init`, `needle_complete`, `needle_embed`, `needle_reset`, `needle_load` and `needle_last_error`.
- The header says it is **"one process-global, non-thread-safe model."** One toolset is bound at a time, and switching toolsets means a re-init.
- The engine cannot unload weights.
- A grammar compiled from your schemas guarantees the JSON parses.
- A calibrated confidence score comes from a learned head. When there are more than 5 tools, a retrieval head keeps only the top 5 for each turn.

**Binaries.**

| File | Size |
|---|---|
| `android-arm64/libneedle.a` | 1.66 MB |
| `ios-arm64/libneedle.a` | 1.14 MB |
| `watchos-arm64/libneedle.a` | 1.13 MB |
| `wasm/needle.wasm` | 689 KB (plus 62 KB JS glue) |
| `needle3.cact` weights | 35.3 MB |

The README says 8 to 29 MB and `pyproject.toml` says 14 MB. The shipped 20-layer file is 35 MB.

**Open source, partly.** The Python wrapper, training and export code, and weights are Apache-2.0. The C++/WASM inference engine ships only as prebuilt binaries; its source is not in the GitHub repo.

**Privacy.** The Android static library imports no socket or DNS symbols (`socket`, `connect`, `getaddrinfo`), and none of the embeddable libraries contain URLs. Telemetry exists only in the Python package and the CLI runner. That is a good sign for on-phone use.

**Fine-tuning.** There are two routes:
- **Local LoRA** drops the confidence head, so `confidence` comes back as `None`.
- **The hosted Cactus platform** keeps calibration, but your data goes to Cactus. Use synthetic data only, never PHI.

**Base-model results on SMD-style inputs** (quick tests on a CPU, not a phone):

| Test | Result |
|---|---|
| Routing across 26 clinical tools | 8/34 correct |
| Focused 5-tool surfaces | 9/25 correct. Many correct calls were withheld as low confidence. |
| Fact extraction ("patient_facts" schema) | 14/34 fields right, 29 fields invented. Examples: BP 150 became age 150, sugar 342 became weight 342. |
| SMD's own regex extractors (`voice-vitals.js`, `insulin-ask.js`) on the same inputs | Missed some values, invented none |
| Transcript longer than about 150 words | Made up vitals. It is not a scribe. |
| Medical synonym retrieval with its embeddings | Top-1 on 3/25 queries, worse than a plain character-trigram match. It cannot serve medical RAG. |
| Hindi and Telugu | Zero tokens for either script. Hindi input returned nothing; "bukhar 3 din se" was sent to ICD search. |
| Code Blue logging (4 tools) | 7/12. "shocked at 200 joules" was logged as rhythm VF; "prepare adrenaline" was logged as given. |
| Cost | 0.1 to 1.5 s per query, about 100 to 135 MB peak RAM, init 0.7 to 3 s for 1 to 5 tools |

**The most important safety finding.** Needle's grounding check only verifies that a number appears somewhere in the input. It does not verify that the number belongs to that field. When it puts a value in the wrong field, its own validator cannot see the error. Any SMD integration must add a check that each value sits next to its label ("cr", "wt", "RR") in the text.

## 3. Top opportunities (ranked)

| # | Opportunity | Impact | Feasibility | Performance benefit | Product value |
|---|---|---|---|---|---|
| 1 | **One sentence fills an engine**: calculators, dose, electrolytes, insulin, interactions, antibiogram lookup | High | High | Replaces a 2 to 20 s LLM call or manual form filling with about 300 ms | Highest |
| 2 | **OPD voice and command bar**: add Rx line, record vitals, follow-up, next patient, open module | High | Medium (needs on-device ASR) | New capability | High |
| 3 | **MaiK pre-dispatch**: decide when not to call MaiK, and when not to warm the local pack | Medium to high | High | Skips the cold pack load (130 s cold 4B on Pixel 9) and the Gemini cost | High |
| 4 | **Code Blue hands-free logging** on phone or watch | Medium | High (4 tools, closed options, English) | New capability | High, the demo feature |
| 5 | **Low-end Android "MaiK Mini"**: Needle plus engines plus KB, with no LLM | High for reach | Medium | Brings AI to phones under 6 GB | High in the Indian market |
| 6 | **Universal search in natural language** (`search.js calcsProvider` matches nothing for "crcl 70kg 60yo cr 1.2") | Medium | High | Instant | Medium |
| 7 | **MaiK Ask middle tier**: extract one yes/no finding from the patient's reply (English only) | Medium | Medium | Red-flag answers stop waiting on the cloud LLM | Medium |

The same 13 questions for the top four:

**1. Engine slot-filling**
- **Today:** a regex name match opens an empty form. `INSULIN_ASK.parse` is the only natural-language-to-engine path.
- **Problem:** values are discarded, and parsers are duplicated with different label words.
- **Needle adds:** routing the sentence to an engine, and recall on phrasings the regex misses.
- **Architecture:** "facts first". Needle extracts a small `ClinicalFacts` record. Deterministic code converts units, applies `INSULIN_ASK.BOUNDS`, checks label adjacency, then maps the facts to `MEDCALC._calcs` inputs. The CURB-65 checkboxes come from thresholds, the way `ICU_AUTOSCORES` already does it.
- **Newly possible:** one sentence can run every calculator whose inputs are complete.
- **Faster:** seconds become sub-second.
- **Smaller:** no LLM involved.
- **Offline:** fully.
- **Cheaper:** no Gemini turn.
- **More reliable:** yes, because the engines do the arithmetic.
- **Safer:** yes, provided you add the adjacency validator.
- **Worse:** another model to maintain.
- **New failure mode:** a value in the wrong field that looks plausible, such as weight entered as creatinine.

**2. OPD voice**
- **Today:** there are no commands, and the pad's `parseVoiceRx` takes the first number as the dose and the first search hit as the drug.
- **Needle adds:** a closed toolset of about 5 tools per screen.
- **Architecture:** Whisper tiny or on-device Apple/Android speech recognition, then Needle, then `scribe-drugfix.correct`, then `SMD_BRANDS.generics`, then a pad row marked `source:"ai"`, then `scribe-safety.check`.
- **Newly possible:** hands-free prescribing drafts.
- **Offline:** yes.
- **Worse:** false triggers from room speech.
- **New failure modes:** tense ("start" versus "stop"), and negation ("do not add metformin"; base Needle withheld that one, which is correct).

**3. Pre-dispatch**
- **Today:** `home.js:6270` warms the local pack on every sheet open. Cloud answers are generated whole before any text shows (`MAIK_LIVE_STREAM=0`). `route0` returns null for `refine` in Local mode, so there is no local router at all.
- **Needle adds:** a destination classifier: calculator, dose, interaction, abx, ICD, navigate, or `ask_maik`.
- **Architecture:** warm the pack only when Needle says `ask_maik` or confidence is low.
- **Faster, cooler, less battery:** yes.
- **New failure mode:** a real clinical question misrouted to a tool. The mitigation is that anything below the confidence threshold goes to MaiK; never refuse on Needle's word.

**4. Code Blue**
- **Today:** buttons in `CommandCenterView.swift` call `logDrug`, `logShock(energyJ:)`, `logRhythm` and `logROSC` (`CodeBlueLiveModel.swift:108-116`).
- **Needle adds:** voice to those same four calls, keeping the existing closed choices (Epinephrine/Amiodarone/Other; 150/200/360 J), and preserving the rule that it logs a drug name, never a dose.
- **Watch:** a watchOS library exists.
- **Safety:** it is a record, not a recommendation; keep the confirm/undo step.
- **New failure mode:** a mislog like the one the base model made, which fine-tuning must eliminate.

## 4. Unexpected findings and opportunities

- **Most of the "structured output" win doesn't need Needle.** llama.cpp has a grammar sampler, but `capacitor-llama` doesn't expose it. `maik-local.js generateJSON` just prompts "start with {" and retries. Exposing grammar decoding would fix MedGemma returning prose instead of JSON (a Roadmap item) today.
- **The expensive cloud router is already bypassed.** `/refine` (measured 6 to 7.5 s) is not called in the default LLM-first configuration. The latency problem is now the answer call, not routing.
- **Needle's refusal behaviour would break MaiKScope's zero-false-refusal rule.** Needle returns an empty list for anything unfamiliar. Never let Needle gate or refuse; only let it take the fast path.
- **A calculator engine is a better use of Needle than 446 tools.** Needle degrades badly with many tools, and every toolset switch costs a re-init. Extract once into a fact record, and let deterministic code work out which calculators are computable.
- **Run it in the WebView first.** The WASM build can ship over OTA with no store release, runs single-threaded (like ORT, since `capacitor://` is not cross-origin isolated), and needs about 35 MB of memory. It is the right spike vehicle. A native plugin comes later.
- **Wear OS and Apple Watch get their first on-device model.** Both watch apps have no ML today.

Side bugs found along the way (not Needle-related):
- Native boot deletes all Cache API storage (`index.html:146-155`), which appears to wipe the ThoreX/SknX model cache on every launch.
- The ambient scribe always passes `speaker:"doctor"` (`opd-emr.js:4292`), so a patient's "my BP was 150/90" can fill vitals.
- The "fast" speech-recognition fallback never sets `requiresOnDeviceRecognition`, so consult audio may leave the device.
- `stripIndic` empties Telugu and Hindi source quotes, so scribe grounding never runs for native-script consults.

## 5. What Needle should NOT do

- **Never** produce a dose, a score or a regimen. It fills slots; the engines compute.
- **Not** diagnosis, differentials, antibiotic choice or medication reconciliation decisions.
- **Not** scribe or transcript summarisation. It collapses past about 150 words, and the 256-token KV window explains why.
- **Not** Indic or code-switched input. The tokenizer has no Devanagari or Telugu.
- **Not** RAG embeddings or search. Keep BM25, tf-idf and the bge reranker.
- **Not** the scope firewall.
- **Not** holding conversation state. It warns after 4 turns without a reset. Keep state in SMD's JS and pass context in as text.
- **Not** replacing Whisper or MaiK.

## 6. Proposed architecture

```
 voice (Whisper tiny / on-device OS ASR)      typed text (MaiK bar, search, OPD)
                     \                          /
                      v                        v
            +------------------------------------------+
            | SMD Intent Layer (JS, deterministic first)|
            | 1. MaiKScope / existing regex fast paths  |
            | 2. Needle (per-surface toolset <=5,       |
            |    ClinicalFacts record, confidence)      |
            | 3. Validators: bounds, units, label       |
            |    adjacency, negation, tense             |
            +------------------------------------------+
               | high confidence       | low / none / ask_maik
               v                       v
   +---------------------------+   +-----------------------------+
   | Deterministic engines     |   | MaiK (warm pack only now)   |
   | MEDCALC.run, DOSECALC,    |   | Cloud Gemini / local GGUF   |
   | ELYTE, INSULIN_ENGINE,    |   | + BM25/tf-idf RAG + claim   |
   | INTERACTIONS, ABG_STORE,  |   |   grounding                 |
   | SMD_ICD, queue, Rx pad,   |   +-----------------------------+
   | CodeBlue log              |
   +---------------------------+
               |
               v
   Confirmation card (prefilled form, "Using MEDCALC.run(crcl)")
   -> clinician taps. Nothing writes to a record without a tap.

 Native: capacitor-needle plugin (libneedle.a, one serial queue,
 weights in Filesystem, sha-pinned download reusing the Llama
 plugin downloader). Spike: needle.wasm in WebView behind smd_needle.
```

## 7. Concrete interactions

Each row is: input, then what Needle produces, then the SMD code that runs, then what the clinician sees.

| # | Input | Needle output | SMD path | Result |
|---|---|---|---|---|
| 1 | "crcl 72F 58kg cr 1.4" | facts {age 72, sex F, wt 58, scr 1.4} | `MEDCALC.run("crcl",…)` | CrCl card, tap to open prefilled |
| 2 | "vanc dose 70 kg crcl 40" | dose {drug, wt, crcl} | `SMD_DOSECALC.engine.compute` | renal-adjusted rows; no number from Needle |
| 3 | "warfarin with clarithro ok?" | interactions {drugs} | `INTERACTIONS.checkInteractions` | major interaction |
| 4 | "CURB65 78 confused RR 32 BP 88/50 urea 9" | facts | threshold map to checkboxes, `MEDCALC.run("curb65")` | 5/5, admit and assess for ICU |
| 5 | "Na 118, 60 kg woman 70" | electrolyte facts | `ELYTE.analyze` | correction plan |
| 6 | "sugar 342 on basal bolus" | insulin slots | `INSULIN_ASK.toEngineArgs`, `INSULIN_ENGINE.correctionDose`, `INSULIN_SAFETY.evaluate` | dose with warnings |
| 7 | "klebsiella urine sensitivity" | abg {organism, specimen} | `ABG_STORE.susceptibility` | local % susceptible |
| 8 | "empiric abx pyelo ward pen allergic" | {syndrome, setting, allergy} | `ASP_DATA.PYELONEPHRITIS` + `ABG_STORE.rank` | regimen. Gap: the engine has no allergy input yet; add one. |
| 9 | "tab augmentin 625 bd 5 days after food" | rx line | `scribe-drugfix`, `SMD_BRANDS`, pad row `source:"ai"`, `scribe-safety` | unverified row to confirm |
| 10 | "next patient" | queue.next | queue API | next token called |
| 11 | "review after 1 week with CBC" | follow-up {7 d, CBC} | no follow-up field today (gap) | scheduled |
| 12 | "open antibiogram" | navigate | `home.js ACT` | screen opens |
| 13 | "icd T2DM with nephropathy" | icd {dx} | `codeAnswer` / `SMD_ICD.localSearch` | E11.2x |
| 14 | "adrenaline given" (Code Blue) | log_drug | `logDrug("Epinephrine")` | timeline entry with undo |
| 15 | "why refractory hyponatremia despite fluid restriction" | ask_maik | pack warmed now, MaiK answers | grounded answer |
| 16 | Telugu or Hindi dictation | nothing | Whisper, then the existing Gemini / MaiK Lite scribe | unchanged |

## 8. Low-end Android (3 to 4 GB RAM)

**Today:** no MaiK pack fits (6 GB floor), so these phones get cloud or KB-only.

**With Needle:** about 36 MB of weights and about 130 MB of RAM, plus Whisper tiny (32 MB), gives a fully offline command-and-engine assistant:
- calculators
- dose rules (`data/dose-rules.json.gz` already ships in www)
- interactions
- ICD
- antibiogram
- KB answers
- voice commands

A 4- or 8-layer slice could shrink it further; the 8-layer rung keeps 2 of the 5 engram tables. Queries are short bursts rather than 10 to 130 s of sustained LLM decoding, so thermals and battery stay flat.

## 9. Offline architecture (zero internet)

**Works fully offline:**
- Needle and Whisper
- every deterministic engine
- the offline drug SQLite and `offline-clinical.json.gz`
- the ICD-10 bundle and the antibiogram bundle
- KB tf-idf and `MaiKKB.compose`
- the queue and Rx pad drafts
- Code Blue

**Optional offline:** the MaiK local pack, only if the phone has 6 GB or more.

**Still online-only:** `SMD_DOSE`/MEDAPI brand search, web research, Evidence Review, rerank, and Indic cloud scribing.

## 10. The MaiK relationship

**Needle handles:** short English commands, navigation, slot-filling for an engine, closed-set classification, and pre-dispatch.

**MaiK handles:** anything that needs medical knowledge or free-text generation. That means explanation, reasoning, differentials, synthesis, scribe and long text, translation, Indic languages, and summaries.

**Rules:**
1. Needle never writes clinical prose.
2. MaiK never computes a number an engine can compute.
3. Needle may speed up a request but may never refuse one. Low confidence or an empty result goes to MaiK.
4. Warm the MaiK pack only on an `ask_maik` result.

## 11. Implementation roadmap

**Phase 0 (no Needle, 1 to 2 weeks).** These are wins on their own:
- one shared patient-parameter parser, extending `INSULIN_ASK.parse` with cr/scr/s.cr, yo, 65M, K and Na
- wire `maikCalcFor` to call `MEDCALC.open(id, prefill)`
- fix MaiKBrain `plan()` inputs
- pick one Cockcroft-Gault implementation
- expose llama.cpp grammar decoding in `capacitor-llama`
- build a labelled eval set of real, de-identified clinician utterances

This eval set is the go/no-go gate for everything after it.

**Phase 1 (spike, flag `smd_needle`).**
- WASM in the WebView, shipped by OTA; weights downloaded on demand to Filesystem (not the Cache API).
- Three surfaces: pre-dispatch, calculator fill, OPD commands.
- Fine-tune on the hosted platform with synthetic data generated from `MEDCALC._calcs` and templates (no PHI).
- Gate: 0 wrong-field errors surviving the validators, at least 95% argument precision, measured on a Pixel 9, a 4 GB Android and an iPhone.
- If the gate fails, stop. The Phase 0 regex path already captures much of the value.

**Phase 2.** Native `capacitor-needle` plugin (store release), on-device speech recognition for commands, and Code Blue voice logging on phone and watch.

**Phase 3.** The low-end "MaiK Mini" profile.

## 12. Technical risks

- **Vendor and binary risk.** A closed-source engine from a small vendor, which matters for auditability as regulated medical software.
- **Engine shape.** One global engine, not thread-safe, one toolset at a time, with a re-init to switch.
- **Language.** English only.
- **Calibration.** Local LoRA loses the confidence head; keeping calibration requires the hosted platform.
- **Silent wrong-field errors.** Its grounding check cannot see them.
- **Base quality is poor on clinical text.** This is measured, and the claimed 18 to 36 point lift from fine-tuning is unverified for SMD.
- **Phone performance is unmeasured.**
- **Format churn.** Needle 2 to 3 changed the weights format, and the engine is pinned at 3.0.3 while `config.json` says 3.0.2.
- **Regulatory.** Adding an ML step to dosing input paths needs a documented validator layer.

## Final verdict

**Needle is strategically useful to StewardMD, but only in a narrow role.** In most of the places you'd first think to put it (scribe, RAG, reasoning, multilingual input, MaiK replacement), it is an interesting small model looking for a use case. The code and the base-model results rule those out.

In one role it is a genuine fit, and nothing else in your stack fills it: an offline, sub-second, sub-40 MB layer that turns short commands into calls to the engines you already built.

The evidence for that role:
- 446 headless calculators that MaiK can name but never fill
- no voice commands anywhere
- a 6 GB RAM floor for any on-device AI
- about nine duplicated regex intent layers

The ceiling is set by fine-tuning quality plus your validators, not by Needle as shipped. So do Phase 0 first, because it captures part of the value with no new dependency. Then let a measured Phase 1 decide.
