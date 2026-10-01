---
tags: [plan, ai, needle, edge]
status: approved plan v2 (owner decisions in section 15)
owner: Dr Manoj Kurmana
---
# StewardMD Edge: the master plan (v2)

Written as one person who is a doctor, a software engineer and an ML engineer. Built from the whole
investigation: [[Needle-Audit]], [[Needle-Features]], the ChatGPT review, the senior engineer review,
the Gemini review, and the second developer review (v2 changes are listed in section 19).

---

## 0. The plan in one paragraph

We add a **small AI on the phone** that does one job: it turns what a doctor types into a **request
that StewardMD's existing tools already know how to answer**, with every proposed value carrying its
evidence. The small AI never decides anything medical. StewardMD's calculators, drug database, ICD
index and rules do the medicine. MaiK only explains. The doctor always confirms before anything is
saved. Version 1 is **typed only, read-only, five workflows, Android 4 GB and up**. Every riskier
workflow (voice, ICU dictation, Scribe, prescriptions, Code Blue) is a **separate project** that must
earn its own release.

---

## 1. Scope

### Version 1 (this plan, 4 to 6 weeks)
Five **typed, read-only** workflows:

| # | Workflow | Example | Engine that answers |
|---|---|---|---|
| W1 | Open a named calculator | "open CURB-65" | `MEDCALC.open` |
| W2 | Calculator with tightly constrained prefill | "crcl 72F 58 kg creat 1.4" | `MEDCALC.open(id, prefill)`, doctor reviews every field |
| W3 | Drug or monograph section | "meropenem renal dose" | `MEDAPI` / `offline-clinical.js` |
| W4 | ICD candidates | "ICD for CAP with T2DM and CKD" | `SMD_ICD.localSearch` |
| W5 | Open a module or KB topic | "open antibiogram", "loose motions in a child protocol" | `home.js` ACT map, KB |

### Separate projects, each with its own gate, dataset and release
ICU dictation, English Scribe fact log, Live Score Radar, prescription drafts, Code Blue voice log,
Sepsis Hour-1 log, say-it logbook, OSCE examiner, Round Mode, PHI Shield, native Telugu/Hindi.
A routing success does **not** validate any of these.

### Never
An AI that diagnoses, chooses antibiotics, or calculates doses. A replacement for MaiK, Whisper, the
ICU monitor photo reader, or KB search. Anything that saves to a record without a doctor's tap.

---

## 2. Safety rules (never broken)

| # | Rule | Why, in clinical terms |
|---|---|---|
| S1 | The AI **proposes**, the doctor **confirms**. No silent writes. A tap is one barrier, not the only one. | A resident's draft order still needs a senior's signature, and a checker before that. |
| S2 | **Every proposed field carries an evidence record** (section 2.1). A field without a complete record is not shown as filled. | Real numbers in the wrong context are as dangerous as invented ones. |
| S3 | Engines compute, the AI never computes. Doses, scores, codes come from existing code only. | Arithmetic must be auditable and identical every time. |
| S4 | **Never a dead end.** If Edge rejects an unsafe extraction or is unsure, the doctor can always continue through a safe path (the normal screen, or MaiK when policy allows). This is not the same as sending every uncertain request to a bigger model. | Rejecting an unsafe value is correct; leaving the doctor stuck is not. |
| S5 | **Assertion status is mandatory:** present, absent, historical, family, planned, stopped, hypothetical, unknown. Only "present, current, this patient" can fill a calculation input. | "Mother has diabetes", "stop metformin", "BP was 80/50 before fluids" are classic errors. |
| S6 | **Missing is not negative.** An unmentioned checkbox stays unknown, never "no". | "No confusion" must be stated to count as absent; silence is not evidence. |
| S7 | **No stale fields.** Each request starts from an empty proposal; nothing carries over from an earlier extraction. | A checkbox checked by a previous request must not survive into this one. |
| S8 | **Patient and session binding.** Every request and every result carries the patient/session ID; a result for a different ID is discarded. Edge resets on patient switch. | A value from bed 12 must never land in bed 14. |
| S9 | Sound-alike drugs are never auto-resolved (Losec vs Lasix style). Ambiguous names need a tap. | LASA errors are a top medication-safety hazard. |
| S10 | Distinct clinical score versions stay distinct (MELD, MELD-Na, MELD 3.0). Only true aliases of the same calculation are merged. | Different formulas give different numbers and different populations. |
| S11 | No patient data in training. Synthetic data and public datasets only. | PHI rule in CLAUDE.md. |
| S12 | Every feature behind a flag, with a git tag to roll back to. | CLAUDE.md "reversible changes". |
| S13 | Offline failure is visible. If the model is missing or backed off, the old screen works exactly as today. | No silent loss of function on a ward round. |

### 2.1 The evidence record (required for every proposed field)

```
{ field, value, unit, span: [start, end], source_text, patient_session_id,
  time_context: "current" | "past" | "unknown",
  assertion: "present" | "absent" | "historical" | "family" | "planned" | "stopped" | "hypothetical" | "unknown",
  extractor: "rules" | "edge:<model-hash>", schema_version, request_id }
```

Acceptance for a calculation input requires all of:
1. `span` exists and the text at `span` is the value (Appendix C label check).
2. `assertion = present` and `time_context = current`. Anything else is shown as context, never filled.
3. `unit` is known and converted by deterministic code, or the field is left empty.
4. `patient_session_id` matches the open patient.
5. `schema_version` matches the calculator version in use.

Example: "Creatinine was 1.4 last month, now 2.1" gives two well-labelled numbers. Only 2.1
(`time_context = current`) may fill CrCl; 1.4 is shown as "previous value" context.

---

## 3. What we know, worded precisely

### 3.1 About Needle
Bench details, hashes and scripts: `vault/plans/edge-data/bench/README.md`. Results come from a
4 vCPU cloud container, not a phone, with base (untuned) weights; raw logs were not retained.

| Statement | Evidence | What it does **not** prove |
|---|---|---|
| Shipped base weights are 35,335,380 bytes, not "8 to 29 MB" | HF file size, sha256 in bench README | Smaller ladder depths may be smaller; unmeasured |
| C API has no cancel and no unload; one process-global, non-thread-safe model; one tool list bound at a time | `needle.h` comment and signatures | Whether a future engine adds them |
| Config sets `kv_window: 256`; extraction quality collapsed from about 169 words in our test | `config.json`; `longctx.py` | It does **not** by itself set a hard 256-token input limit. The supported input length must be measured and written as a contract |
| Tokenizer has 8,192 pieces and no Devanagari or Telugu pieces | tokenizer scan | Latin-letter coverage does **not** prove Hinglish/Tenglish understanding; that must be tested |
| Embeddings have 3,072 dimensions; 3 of 25 medical synonym queries top-1 | `emb2.py` | Fine-tuned embeddings are untested |
| Base model: 8/34 routing over 26 tools; fact extraction filled 29 fields with real numbers from the wrong place | `route.py`, `facts.py` | Fine-tuned performance is unknown |
| `android-arm64/libneedle.a` imports no socket, connect or DNS functions | `nm -u` symbol scan | A symbol scan is evidence, **not proof**, that the whole app sends nothing; see section 10 |
| Local LoRA export drops the confidence head; hosted fine-tuning keeps a head | `needle/__init__.py` | A kept head is **not** automatically calibrated for SMD; it must be validated on held-out SMD requests |
| CPU fine-tuning ran at about 60 s per step | `gen.py` run, stopped | Nothing about GPU or hosted training time |

### 3.2 About StewardMD
| Fact | Where |
|---|---|
| 446 calculators; headless `MEDCALC.run(id, inputs)`, `MEDCALC.open(id, prefill)` | `calculators.js:8576`, `:8661` |
| MaiK names a calculator but opens it empty | `home.js:7078`, `home.js:9043` |
| MaiKBrain's calculator step never gets inputs | `kb/ai/maik-brain.js:316` |
| Integration seam: `route()`, `route0()`, `localCall()` | `maik-engine.js:538` onward |
| Local mode has no router (`refine` returns null) | `maik-engine.js` `route0` |
| `localReady()` requires an installed MaiK pack (1.1 GB+, 6 GB RAM floor) | `maik-engine.js:120`, `maik-models.js` |
| The big model warms every time the MaiK sheet opens | `home.js:6270` |
| Three different MELD calculators: `meld3` (MELD 3.0), `meld` (MELD and MELD-Na), `meld_na` (MELD-Na) | `calculators.js:36`, `:690`, `:4050` |
| ICU dictation (kind `monitor`) has no offline path | `voice.js:389` |
| Drug lookups already work offline on native | `offline-clinical.js:218 installRouting()` |
| Insulin Ask is the template: rules parse first, bounds on every value | `insulin-ask.js` |
| `capacitor-llama` does not expose grammar decoding; it does expose `cancel()` | plugin source |
| Gemma 3 270M (FunctionGemma's base) already downloads as the MedGemma draft | `maik-models.js:139` |
| Cache API is wiped on every native launch | `index.html:146-155` |
| New native code needs a store release; JS ships over OTA, gated by `minNativeBuild` | `native-ota.js` |

### 3.3 About every extractor (no component is "safe by design")
| Component | Known failure |
|---|---|
| Regex parsers | Can attach a real number to the wrong field ("age 72 wt 58"), and miss phrasings. They do not invent digits, but they can misattribute them |
| Needle / FunctionGemma | Wrong tool, wrong field, wrong assertion, invented values |
| GLiNER (later) | Picks only spans from the text, but can pick the wrong span or the wrong label |
| MaiK packs | Medical reasoning quality is **under evaluation**, not assumed |
| Confidence scores | Must be calibrated on held-out SMD data before any threshold is used |

---

## 4. The design

```
 Doctor types (v1: typed only)
        |
        v
 [Layer 0: Rules]  exact names, shared parser, MaiKScope, ambiguity checks ("MS")
        |  resolved ------------------------------------------+
        v  not resolved                                       |
 [Candidates]  existing word matching picks 3 to 5 tools       |
        |  (measured: did the right tool make the list?)       |
        v                                                     |
 [Layer 1: Edge model]  picks one tool, proposes fields        |
        |                                                     |
        v                                                     v
 [Validators]  evidence record (2.1), label check (App. C), units, ranges,
               assertion, time, patient/session ID, LASA, catalog membership
        |
        +--> rejected / unsure --> safe path: normal screen, or MaiK if policy allows (S4)
        |
        v
 [Engines]  MEDCALC.run, MEDAPI / offline-clinical, SMD_ICD.localSearch, module/KB open
        |
        v
 [Confirm card]  each value shows its source words and status; nothing pre-accepted
        |
        v  (only if the doctor asks "why?")
 [MaiK]  explanation with retrieved evidence and claim grounding
```

### 4.1 New pieces (behind flag `smd_edge`, default OFF)
| File | Job |
|---|---|
| `local-plugins/capacitor-needle/` | Native bridge. Android: JNI wrapper `.so`, Needle linked statically, uniquely named, 16 KB aligned, runs in process `:edge`. iOS: xcframework, serial queue. Weights in Filesystem, sha256 pinned. |
| `edge-runtime.js` | The runtime contract in section 4.2 |
| `edge-schemas.js` | Versioned tool lists from `MEDCALC._calcs` (with `opts`), drug sections, ICD, modules, KB topics |
| `edge-candidates.js` | 3 to 5 candidates per request from a fixed bank of tool groups, so the engine rarely rebinds |
| `edge-router.js` | Plugs into `maik-engine.js route()` before the engine choice, like `doseAnswer()` |
| `edge-grounding.js` | Builds and checks the evidence record (2.1) and the label check (Appendix C) |
| `window.SMD_EDGE` | `route(text, ctx)`, `extract(text, schema, ctx)`, `available()`, `load()`, `release()`; `ctx` must contain `patient_session_id` |

### 4.2 Runtime contract (the engine cannot be cancelled)
| Situation | Behaviour |
|---|---|
| Queue | At most **1 running + 1 waiting**. A new request replaces the waiting one; it never queues behind it. |
| Deadline | Warm call: 1,200 ms (calibrate on the 4 GB phone). Cold init has its own budget and is never killed mid-load. |
| Deadline passed, Android | Kill process `:edge`. The running computation stops with the process. Next request starts a cold load; Edge shows "unavailable" until ready. |
| Deadline passed, iOS | The computation **keeps running** (no process isolation, no cancel). Its result is discarded; the doctor gets the rules result or the normal screen at once. Edge accepts no new work until the stuck call returns. `max_new_tokens` is capped (about 96) so a call cannot run long. |
| FunctionGemma | Runs through `capacitor-llama`, whose `cancel()` really stops generation. |
| Patient switch | Increment the session token. Any in-flight result with the old token is discarded on arrival. Engine `reset` before the next request. |
| Memory pressure / heat | Back-off contract in A0.5: skip Edge, use rules. |
| `release()` | **Honest semantics.** Needle in-process: unbinds the tool list only; weights stay in memory until the app exits. Android `:edge`: release = stop the process, which frees the memory. Documented in code and in AI settings. |
| App backgrounded / resumed | No call starts in the background; in-flight results are re-checked against the session token on resume. |

---

## 5. Which model does what

| Model | Size on disk | Strength | Weakness | v1 role |
|---|---|---|---|---|
| **Needle 3** | 35 MB | Tiny, watch build, confidence head (hosted tune) | No Indic letters, short reliable input, new native engine, no cancel | Bake-off candidate |
| **FunctionGemma 270M** | about 290 MB (Q8) | Existing llama plugin with `cancel()`; multilingual tokenizer | 8x bigger; its own memory and heat budget; Indic and Hinglish quality unknown | Bake-off candidate |
| Shared rules parser | 0 | Predictable, auditable | Misses phrasings; can misattribute | Always first; the baseline |
| MaiK packs | 1.1 to 6 GB | Explanations | Slow, 6 GB RAM; reasoning under evaluation | Explanation only, outside v1 |

Each model has **its own budget** (section 9). FunctionGemma does not inherit Needle's numbers.

---

## 6. Training plan

**Principle:** teach the model StewardMD's buttons and the evidence record, not medicine.

| Step | What | Detail |
|---|---|---|
| 6.1 | Tool catalog | Export from `MEDCALC._calcs` with `opts`, required inputs, units and intended population. **Keep score versions distinct** (`meld3`, `meld`, `meld_na`); merge only true aliases of the same calculation, documented in `edge-schemas.js`. Drug sections, ICD search, modules, KB topics. |
| 6.2 | Synthetic data | Indian shorthand ("creat", "65M", "1-0-1"), units, typos, Hinglish/Tenglish in Latin letters, off-topic, not-enough-info. Every row labels assertion and time context. |
| 6.3 | Hard negatives | start vs stop, patient vs mother, before vs now, mg vs mcg, BP vs age numbers, LASA pairs, score versions (MELD vs MELD 3.0). |
| 6.4 | Public data | Section 17. Owner + 2 doctors' 150 lines go to **test only**, never training. |
| 6.5 | Separation | Test lines come from authors and paraphrase families that the generator never saw. `split` is fixed by hashing a **family ID**, not a row ID, so paraphrases of one test line cannot leak into training. |
| 6.6 | Train | Needle on the Cactus platform (synthetic only); FunctionGemma on a rented GPU. One canonical JSONL, two exporters (A0.4). |
| 6.7 | Calibration | Hold out an SMD calibration set; any confidence threshold is chosen on it and reported with a reliability curve. |

---

## 7. Evaluation

### 7.1 Test sets (frozen before training, never trained on)
| Set | Size | Content |
|---|---|---|
| Routing set | 1,000 | The five workflows, off-topic, ambiguous ("MS"), and multi-tool requests |
| Extraction set | 600 | W2 prefill sentences across all assertion and time types, units, Hinglish/Tenglish |
| Danger set | 200 | Hard negatives (6.3), split by failure type |
| Human set | 150 | Owner + 2 doctors, typed naturally |
| Acceptance cases | 11 | The senior engineer's 10 plus bare "MS" must ask to clarify |

### 7.2 Pipeline metrics (reported separately, never merged into one number)
| Metric | Meaning |
|---|---|
| Candidate recall@5 | The right tool was among the 3 to 5 candidates |
| Coverage | Share of requests Edge acted on (did not pass on) |
| Accepted-route accuracy | Of the requests Edge acted on, share sent to the right tool |
| Fallback rate | Share passed on to the safe path |
| Field precision / recall | Per field type, after validators |
| Unsafe acceptance | Fields accepted with the wrong value, wrong assertion, wrong time or wrong patient |

Every metric is reported **by failure type** (wrong field, wrong assertion, wrong time, wrong unit,
wrong version, LASA, stale, patient carry-over) and **by language** (English, Hinglish, Tenglish).

### 7.3 Outcome metrics (the real benefit)
| Outcome | Why |
|---|---|
| Time to a correct, confirmed result | Fast inference can still mean a slower workflow |
| Taps and corrections per completed task | Prefill must save work, not create review burden |
| Tasks completed with **no MaiK pack installed** | Tests the main promise for 4 GB phones |
| Cloud calls and tokens avoided per completed task | Real cost reduction |
| Battery used in a representative 30-minute session | Includes reloads and retries |
| Safe completion after interruption or patient switch | Workflow safety, not just model accuracy |

### 7.4 Pass marks (fixed safety threshold first, then benefit)
| Measure | Pass mark |
|---|---|
| Unsafe acceptances on all sets | **0** |
| Danger set | **100%**, by failure type. Meaning: these cases passed. It does not mean production risk is zero |
| Accepted-route accuracy | at least 99% |
| Wrong tool shown | under 0.5% |
| Dead ends (S4) | **0** |
| Stale field or patient carry-over in workflow tests | **0** |
| Clinician review | 3 doctors review every error before release |

### 7.5 Decision rule (replaces "baseline + 10 points")
Compare against the **improved Phase 0 rules baseline**, at the same safety threshold (7.4). Edge
ships only if it shows a clear benefit on at least one outcome without losing on any:
more correctly completed requests, fewer taps or corrections, less time to a confirmed result, or
fewer cloud calls. A baseline already near the ceiling cannot gain ten points, and a router that
defers everything can look accurate; both cases are handled by reporting coverage and outcomes.
If Edge adds no measurable benefit, **do not ship it**; Phase 0 stands alone.

---

## 8. Phases

| Phase | What | Exit test |
|---|---|---|
| **0. Rules only** | Shared parser with evidence records; prefill W2 from rules; `maik-brain.js:316` inputs; one Cockcroft-Gault; privacy fixes (section 14). Measure the baseline on all sets. | Baseline report; headless UI tests pass |
| **1. Feasibility** | Day 1 gates (A0); both models load and answer inside the real app; sustained-load test | Budgets in section 9 met, or the failing model is dropped |
| **2. Train and bake-off** | Train, calibrate, score both on frozen sets | Section 7.4 met and 7.5 shows benefit, or stop |
| **3. Pilot** | Five typed workflows, owner + 2 doctors, `smd_edge` on for them only | Pass marks and outcomes hold in 2 weeks of real use |
| **Separate projects** | Each in Appendix B, with its own dataset, gate and release | Its own criteria |

---

## 9. Device budgets (measured in the real app, per model)

Test on: 4 GB Android (MediaTek Helio and low-tier Snapdragon if available), 6 GB Android, Pixel 9,
iPhone. 2 to 3 GB phones are out of v1.

| Measure | Needle budget | FunctionGemma budget |
|---|---|---|
| Cold start to first answer | under 3 s | under 5 s |
| Warm p95 latency | under 800 ms | under 1,500 ms |
| Peak **total app** memory (PSS), not just the model | baseline app + 150 MB | baseline app + 400 MB |
| Process deaths / `onRenderProcessGone` in a 30-minute session | 0 | 0 |
| Battery, 30-minute session | within 3% of baseline app | within 5% of baseline app |
| Thermal | no SEVERE status in the sustained test | same |
| Coexistence | normal app use with a MaiK pack installed but idle | same |

Numbers are starting budgets; calibrate them in week 1 and record the final values here before the
bake-off. A model that misses its budget on the 4 GB tier is not used on that tier.

---

## 10. Privacy and offline policy

1. **Offline execution policy:** Edge code paths make no network calls. Enforced in code
   (`edge-runtime.js` refuses any fetch), and verified by a test that runs the five workflows with the
   network blocked and asserts zero requests.
2. **Network behaviour test:** run the app through an intercepting proxy during the pilot workflows
   and confirm no Edge-related traffic. The symbol scan of `libneedle.a` is supporting evidence only.
3. **Cloud fallback is visible and permission-aware:** if a request goes to MaiK Cloud, the doctor
   sees that before it is sent, and existing MaiK policy (Local, KB-only, hard-local) is obeyed.
4. **Wording:** "no patient text leaves the phone" is said only for paths that guarantee it (Edge,
   rules, local engines). It is never said about MaiK Cloud, cloud Scribe or speech fallbacks.
5. **Speech (for later voice projects):** Android `RecognizerIntent.EXTRA_PREFER_OFFLINE` may have no
   effect. Use `SpeechRecognizer.isOnDeviceRecognitionAvailable()` and
   `SpeechRecognizer.createOnDeviceSpeechRecognizer()` where supported (Android 12+), iOS
   `requiresOnDeviceRecognition`, and show a visible fallback when on-device is unavailable.
6. **PHI Shield** (later) is a redaction aid, never a guarantee that text is safe to send.

---

## 11. Release and rollback

1. Git tag before every merge; flag default OFF; owner approval to flip.
2. Native plugin needs a store release; JS ships over OTA, held back by `minNativeBuild`.
3. Models downloaded on demand, sha256 pinned, stored in Filesystem, with a delete button.
4. Remote kill switch per workflow.

## 12. What we watch after release (counts only, no text)

Per workflow: handled, passed on, confirmed, edited, dismissed; time to confirm; memory; process
deaths; back-off events. A rising "edited" rate on any field is an alarm. Feeds the AI Control Center.

## 13. Risks

| Risk | Plan |
|---|---|
| Tuned models still not good enough | Decision rule 7.5; Phase 0 still ships |
| Needle engine is closed-source from a small company | Pin hashes; FunctionGemma path stays alive |
| No cancel in Needle | Runtime contract 4.2 |
| Automation bias | Source words and status under every value; nothing pre-accepted |
| Clinical meaning lost (assertion, time, person) | Evidence record 2.1; danger set by failure type |
| Regulators (CDSCO SaMD) | Edge fills inputs for documented engines; hazard log (section 2) and reproducible test reports |
| Licences | Unverified licence, model does not load |

## 14. Fix now (no AI needed)

| Bug | Where |
|---|---|
| Scribe always marks speech as the doctor's, so a patient's "my BP was 150/90" can fill vitals | `opd-emr.js:4292`, `:4257` |
| Speech fallback may leave the phone (see 10.5) | `local-plugins/capacitor-community-speech-recognition` |
| Telugu/Hindi source quotes stripped, so Scribe grounding never runs for those consults | `functions/api/ai/_opd-scribe.js` `stripIndic` |
| Cache API wiped on every native launch | `index.html:146-155`, `thorex-model-cache.js` |
| Wear OS bridge plugin not registered | `android/.../MainActivity.java` |
| Dictated prescriptions never become structured rows; `parseVoiceRx` takes the first number as dose | `opd-emr.js stageScribeRx`, `prescription.js:2434` |

## 15. Owner decisions (2026-10-01)

| # | Decision | Effect in v2 |
|---|---|---|
| Q1 | A working product now | Phase 0 ships in week 2 |
| Q2 | Bake-off: Needle vs FunctionGemma | Both scored on frozen sets and per-model budgets |
| Q3 | English + Hinglish/Tenglish in Latin letters | Tested as its own language slice; letters alone prove nothing |
| Q4 | Cactus for Needle, rented GPU for FunctionGemma | One canonical dataset, two exporters |
| Q5 | Public datasets | Plus the 150 human lines for testing only |
| Q6 | Owner + 2 doctors review safety | Every error reviewed before release |
| Q7 | Android 4 GB and up | 2 to 3 GB out of v1 |
| Q8 | 4 to 6 weeks to a small group | Typed five-workflow pilot only |

### Owner's homework
| Task | Format | Needed by |
|---|---|---|
| 50 typed requests each from owner and 2 doctors (test only) | One per line, no patient data | End of week 1 |
| Tenglish/Hinglish word list | `word = meaning`, 100 to 200 words | End of week 1 |
| Names of the 2 reviewing doctors | Name + specialty | Before week 4 |
| Spare 4 GB Android phone | Common model | Week 1 |

Files: `vault/plans/edge-data/owner-requests.txt`, `vault/plans/edge-data/indic-words.txt`.

## 16. Week-by-week

| Week | Work | Done when |
|---|---|---|
| **1** | Day 1 gates (A0). Privacy fixes. Shared parser with evidence records. Baseline measured. Sustained-load test. | Gates pass or the failing model is dropped; baseline report written |
| **2** | **Release Phase 0** (rules prefill, privacy fixes). Freeze test sets. First training runs. | Phase 0 live; sets frozen |
| **3** | Bake-off on frozen sets and devices; calibration; build runtime, router, grounding | 7.4 met and 7.5 shows benefit, or stop |
| **4** | Pilot: five typed workflows, owner + 2 doctors | No unsafe acceptance, no dead end |
| **5** | Fix pilot findings; measure outcomes (7.3) | Outcomes show benefit |
| **6** | Buffer, then release to a small invited group | Counts healthy for 1 week |

Slack: whichever model trains first is scored first; a model not ready by end of week 3 drops out of
v1. If weeks 2 to 3 slip, the pilot moves to week 5. If the decision rule fails, weeks 4 to 6 become
more Phase 0 work.

## 17. Datasets (licences checked)

| Dataset | What | Licence | Use |
|---|---|---|---|
| ACI-Bench | 207 role-played visits with notes | CC BY 4.0 | Extraction phrasing; later Scribe project |
| PriMock57 | 57 mock consults: audio, transcripts, notes | CC BY 4.0 | Later voice and Scribe projects |
| MTSamples | About 5,000 transcription samples | Listed CC0 on Kaggle; check mtsamples.com terms first | Shorthand and phrasing |
| MMCQS (IIT Patna) | 3,015 Hinglish medical queries | CC BY 4.0 | Hinglish slice |
| L3Cube-HingCorpus | 52M Hinglish sentences | check first | Word patterns only |
| MIMIC / n2c2 / PhysioNet | Real notes | Credentialed | **Not used**: cannot be sent to third parties |

Attribution in `licenses/`.

## 18. Words, simply

| Word | Means |
|---|---|
| Edge AI | AI that runs on the phone |
| Router | Decides which StewardMD tool handles a request |
| Evidence record | The value plus where it came from, whose it is, when, and whether it is present or denied |
| Assertion | Present, absent, family, stopped, and so on |
| Coverage | How often Edge acts instead of passing on |
| Fallback | The safe path when Edge does not act |
| Gold / test set | Questions with known answers, never used in training |
| Calibration | Checking that "90% sure" really means right 90% of the time |
| Bake-off | Two options tested side by side |

## 19. What changed in v2 (second developer review, 2026-10-01)

1. Score versions kept distinct; the old "merge `meld3`, `meld`, `meld_na`" was wrong.
2. Label-next-to-number became a full evidence record with assertion, time and patient binding.
3. Router metrics split into candidate recall, coverage, accepted-route accuracy and fallback.
4. "Baseline + 10 points" replaced by a fixed safety threshold plus measured benefit.
5. Privacy claims narrowed; offline policy enforced and tested; Android speech API corrected.
6. Per-model device budgets with total app memory, cold start, battery, heat and process deaths.
7. Runtime contract for the uncancellable engine, including honest `release()`.
8. v1 cut to five typed workflows; voice and ICU moved to separate projects.
9. Facts reworded (kv_window, tokenizer vs competence, regex misattribution, calibration, symbol scan).
10. Bench scripts and model hashes saved for reproducibility (`edge-data/bench/`).

---

## Appendix A. Week 1 engineering checklist

Every item: `npm test` plus a headless-browser test for UI changes (CLAUDE.md). Git tag before merge.

### A0. Day 1 gates
1. **16 KB pages.** `libneedle.a` has no LOAD segments; align **our** wrapper `.so`
   (`-Wl,-z,max-page-size=16384`) and check it with `readelf -lW libsmd_needle.so | grep LOAD`
   (Align 0x4000). The real risk is runtime `mmap` assumptions: run a load and a call on an Android 15
   emulator with the 16 KB image and on a real phone. Failure: report to Cactus, drop Needle from v1.
2. **Process isolation.** Needle in `android:process=":edge"` with Messenger IPC; implement the
   runtime contract (4.2). iOS: serial queue and token cap.
3. **FunctionGemma + grammar.** Expose the llama.cpp grammar sampler in `LlamaEngine.swift` and
   `llama_jni.cpp`; one forced-JSON call with base FunctionGemma on the 4 GB phone; tiny dummy
   fine-tune converted to GGUF (Q8_0, Q4_K_M) to prove the pipeline.
4. **Canonical dataset format.**
   `{ id, family_id, input_text, lang, target_tool, schema_version, slots: { name: { value, unit, span, assertion, time_context } }, negatives, split }`
   with `export_cactus` and `export_llama`; `split` by hashing `family_id`.
5. **Back-off contract** in `edge-runtime.js`: skip Edge when `ActivityManager.MemoryInfo.lowMemory`
   or `availMem` under 250 MB, or thermal SEVERE or above (do not rely on `TRIM_MEMORY_RUNNING_*`,
   not delivered on Android 14+); never during a Whisper chunk decode or a MaiK generation; off for
   the session after `onRenderProcessGone`.
6. **Sustained-load test** on the 4 GB phone for each model: 50 calls in a row, then a 30-minute
   mixed session; record the section 9 measures.

### A1. Week 1 items
1. **Speaker gate fix:** `opd-emr.js:4292`, `:4257` stop hard-coding `speaker:"doctor"`.
2. **On-device speech:** Android `isOnDeviceRecognitionAvailable()` + `createOnDeviceSpeechRecognizer()`
   where available, iOS `requiresOnDeviceRecognition`, visible fallback otherwise
   (`local-plugins/capacitor-community-speech-recognition`; needs a store build).
3. **Shared parser with evidence records:** pure ES5 module extending `INSULIN_ASK.parse`; every value
   returns the evidence record (2.1); assertion and time cues by rule ("was", "before", "now",
   "stopped", "no", "denies", "mother", "family history").
4. **Constrained prefill (W2):** `home.js maikCalcFor` and `search.js calcsProvider` pass only fields
   that pass 2.1 into `MEDCALC.open(id, prefill)`; checkbox calculators by threshold mapping as in
   `icu-autoscores.js`; unknown stays unknown (S6); fresh proposal per request (S7).
5. **MaiKBrain inputs:** `kb/ai/maik-brain.js:316` gets `args.inputs` from the parser.
6. **One Cockcroft-Gault,** with a test that all callers agree.
7. **Score version map:** document `meld3`, `meld`, `meld_na` (and any other families) in
   `edge-schemas.js`, each with its version, inputs, units and population.
8. **Data pipeline start:** schema export from `MEDCALC._calcs` with `opts`; datasets into a
   gitignored folder; licence notes in `licenses/`.

## Appendix B. Separate projects (each earns its own release)

| Project | Must separately validate |
|---|---|
| ICU dictation | Speech accuracy, attribution, units, correction handling, `reviewVoice()` flow |
| English Scribe fact log | Speaker attribution, assertion/time over long consults, correction events |
| Live Score Radar | Per-sentence extraction, stale-field rules, alert fatigue |
| Prescription drafts | Drug, dose, unit, frequency, LASA, read-back and signing gates |
| Code Blue / Sepsis voice log | Noisy-room speech, tense ("prepare" vs "given"), undo |
| Say-it logbook, OSCE examiner | Catalog mapping accuracy |
| Round Mode | Multi-call ordering, DRAFT-only writes |
| PHI Shield | Recall of identifiers; described as a redaction aid only |
| Native Telugu/Hindi | Per-language gold sets; transliteration or FunctionGemma |

Detail: [[Needle-Features]]. Evidence: [[Needle-Audit]].

## Appendix C. Label check (part of the evidence record)

A number is accepted for a field only if the **nearest** label before it, or the unit right after
it, belongs to that field, with **no other number in between**. Composite patterns (BP "150/90",
GCS "E2V3M5") come from the deterministic parsers (`voice-vitals.js`). This check is necessary, not
sufficient: assertion, time and patient checks (2.1) still apply.

```js
// edge-grounding.js (sketch). SLOTS: { age: { labels: ["age","aged"], units: ["yo","y","yrs","years","m","f"] },
//   weight_kg: { labels: ["wt","weight"], units: ["kg","kilo","kilos"] },
//   serum_creatinine_mg_dl: { labels: ["cr","scr","s.cr","creat","creatinine"], units: ["mg/dl"] }, ... }
function norm(t) {
  t = String(t || "").toLowerCase();
  if (window.SMD_VVITALS && SMD_VVITALS.wordsToNumbers) t = SMD_VVITALS.wordsToNumbers(t); // "one ten" -> "110"
  return t.replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2");               // "72F" -> "72 f"
}
function tokens(t) {
  var out = [], re = /\d+(?:\.\d+)?|[a-z][a-z.\/]*/g, m;
  while ((m = re.exec(t))) out.push({ s: m[0], num: /^\d/.test(m[0]) ? parseFloat(m[0]) : null });
  return out;
}
function slotOf(tok, i, SLOTS) {
  var MAX = 2, k, j, name;
  for (k = 1; k <= MAX; k++) {                        // unit directly after: "58 kg", "72 f"
    j = i + k; if (j >= tok.length || tok[j].num !== null) break;
    for (name in SLOTS) if (SLOTS[name].units.indexOf(tok[j].s) >= 0) return name;
  }
  for (k = 1; k <= MAX; k++) {                        // label directly before: "wt 58", "cr 1.4"
    j = i - k; if (j < 0 || tok[j].num !== null) break;
    for (name in SLOTS) if (SLOTS[name].labels.indexOf(tok[j].s) >= 0) return name;
  }
  return null;
}
function validateSlot(rawText, slotName, value, SLOTS) {
  var tok = tokens(norm(rawText)), v = parseFloat(value), i;
  if (isNaN(v)) return false;
  for (i = 0; i < tok.length; i++) {
    if (tok[i].num !== null && Math.abs(tok[i].num - v) < 1e-9 && slotOf(tok, i, SLOTS) === slotName) return true;
  }
  return false;
}
```

**Required tests** (danger set): "age 72 wt 58" age = 58 rejected, weight = 58 accepted;
"bp 150/90 age 50" age = 150 rejected; "wt 70 age 70" both accepted; "crcl 11.4" creatinine = 1.4
rejected; "72F 58kg cr 1.4" all accepted; "72 yo" age = 72.0 accepted; "pulse one ten" HR = 110
accepted; "sugar 342 weight 80" weight = 342 rejected; "65M, cr 2.1" weight = 2.1 rejected;
**"creatinine was 1.4 last month, now 2.1": 2.1 accepted as current, 1.4 shown as previous only**;
"no confusion" sets confusion = absent, while silence leaves it unknown.
