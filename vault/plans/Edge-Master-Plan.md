---
tags: [plan, ai, needle, edge]
status: approved plan v1 (owner decisions in section 14)
owner: Dr Manoj Kurmana
---
# StewardMD Edge: the master plan

Written as one person who is a doctor, a software engineer and an ML engineer. Built from the whole
investigation: [[Needle-Audit]], [[Needle-Features]], the ChatGPT review, the senior engineer review,
and my own tests of the real Needle model.

---

## 0. The plan in one paragraph

We add a **tiny AI on the phone** (about 35 to 290 MB) that does one job: it turns what a doctor
types or says into a **request that StewardMD's existing tools already know how to answer**. The
tiny AI never decides anything medical. StewardMD's calculators, drug database, ICD index and rules
do the medicine. MaiK (the big AI) only explains. The doctor always confirms before anything is saved.
The result: useful AI offline, on cheap Android phones that cannot run MaiK today, and faster answers
for everyone.

---

## 1. What we are building, and what we are not

**Building (in this order):**
1. A **local request router**: "open CURB-65", "meropenem renal dose", "ICD for CAP" go straight to
   the right StewardMD screen or lookup, offline, in under a second.
2. **Prefilled calculators**: "crcl 72F 58 kg creat 1.4" opens CrCl already filled in.
3. **ICU dictation offline**: "BP 110 by 70, pulse 96, PEEP 8, FiO2 40" becomes a review card.
4. **Scribe fact log (English first)**: each spoken fact is captured with the exact words it came from.
5. **Show-off features** once the above are safe: answer-as-you-type, Live Score Radar, Code Blue
   voice log, say-it logbook.

**Not building:**
- An AI that diagnoses, chooses antibiotics, or calculates doses. Engines do that.
- A replacement for MaiK, Whisper, the ICU monitor photo reader, or the knowledge-base search.
- Anything that saves to a patient record without a doctor's tap.

---

## 2. Doctor's safety rules (never broken)

| # | Rule | Why, in clinical terms |
|---|---|---|
| S1 | The AI **proposes**, the doctor **confirms**. No silent writes. | Same as a resident's draft order: a senior signs it. |
| S2 | Every number the AI fills must sit **next to its own label** in the source text ("cr 1.4", "wt 58"). | Measured: base Needle turned "BP 150" into age 150. Its own check could not see it. |
| S3 | Engines compute, AI never computes. Doses, scores, codes come from existing code only. | Arithmetic must be auditable and identical every time. |
| S4 | If the AI is unsure, it **passes the request on** (to MaiK or the normal screen). It never refuses. | MaiKScope's rule: zero false refusals of real clinical questions. |
| S5 | Negation, tense and person are checked by rules, not trusted to the AI: "no fever", "stopped metformin", "mother has diabetes". | These are the classic documentation errors. |
| S6 | Sound-alike drugs are never auto-resolved (Losec vs Lasix, Zantac vs Xanax style). Ambiguous names need a tap. | LASA errors are a top medication-safety hazard. |
| S7 | Reset the AI between patients and between tasks. | No carry-over of one patient's facts into the next. |
| S8 | No patient data ever goes into training. Training data is synthetic or consented, de-identified phrasing. | PHI rule in CLAUDE.md. |
| S9 | Every feature ships behind a flag, with a git tag to roll back to. | CLAUDE.md "reversible changes". |
| S10 | Offline failure must be visible. If the model is missing, the old screen works exactly as today. | No silent loss of function on a ward round. |

---

## 3. What we already know (facts, with evidence)

### About Needle (read from code, and tested on a 4-core laptop CPU)
| Fact | Evidence |
|---|---|
| Model file is **35.3 MB**, not 8 to 29 MB | Hugging Face `needle3.cact` = 35,335,380 bytes |
| Engine is about 1 MB per platform; Android, iOS, watchOS, WebAssembly builds exist | HF repo listing |
| Engine **cannot be cancelled or unloaded**, holds **one tool list at a time**, not thread-safe | `needle.h` |
| Reads about **256 tokens** of memory; fails on long text | config `kv_window: 256`; test: made up vitals past about 150 words |
| **No Hindi or Telugu letters** in its 8,192-word vocabulary | tokenizer scan |
| Embeddings are **3,072** numbers long and weak for medical synonyms (3 of 25 right) | test |
| Out of the box on clinical requests: **8 of 34** routed right; fact extraction **invented 29 fields** | test |
| Android library has **no network functions**, so it cannot send telemetry | symbol check |
| Local fine-tuning **loses the confidence score**; Cactus's hosted fine-tuning keeps it | `needle/__init__.py` |
| Fine-tuning on a laptop CPU is far too slow (about 60 s per step); needs a GPU or the hosted platform | test |

### About StewardMD (read from code)
| Fact | Where |
|---|---|
| 446 calculators with a headless `MEDCALC.run(id, inputs)` and `MEDCALC.open(id, prefill)` | `calculators.js:8576`, `:8661` |
| MaiK names a calculator but **opens it empty** | `home.js:7078`, `home.js:9043` |
| MaiKBrain's calculator step **never gets inputs** | `kb/ai/maik-brain.js:316` |
| One place to plug in: `route()`, `route0()`, `localCall()` | `maik-engine.js:538` onward |
| Local mode has **no router** (`refine` returns null) | `maik-engine.js` `route0` |
| Local AI needs a 1.1 GB+ pack and **6 GB RAM**; `localReady()` requires that pack | `maik-models.js`, `maik-engine.js:120` |
| The big model is warmed every time the MaiK sheet opens | `home.js:6270` |
| ICU dictation (kind `monitor`) has **no offline path** | `voice.js:389`, no `REQ` entry |
| ICU review screen already exists | `icu.js:2259 reviewVoice()` |
| Drug lookups already work offline on native | `offline-clinical.js:218 installRouting()` |
| Insulin Ask is the template: rules parse first, bounds on every value, AI only fills blanks | `insulin-ask.js` |
| `capacitor-llama` does not expose grammar (forced-JSON) decoding | plugin source |
| Gemma 3 270M (FunctionGemma's base) already downloads as the MedGemma draft model | `maik-models.js:139` |
| Cache API is wiped on every native launch, so model files must live in Filesystem | `index.html:146-155` |
| New native code needs a store release; JS can ship over OTA, gated by `minNativeBuild` | `native-ota.js` |

---

## 4. The design

```
 Doctor types or speaks
        |
        v
 [Layer 0: Rules]  exact names, regex parsers (voice-vitals, insulin-ask), MaiKScope
        |  resolved? ------------------------------+
        v  not resolved                            |
 [Layer 1: Edge AI]  picks ONE of 3-5 candidate     |
   tools and fills its fields (Needle or            |
   FunctionGemma, chosen by bake-off)               |
        |                                          |
        v                                          v
 [Validators]  label-next-to-number, units, ranges (INSULIN_ASK.BOUNDS),
               negation, tense, person, sound-alike drugs, catalog membership
        |
        +--> unsure / empty --> normal path (MaiK or the existing screen). Never a refusal.
        |
        v
 [Layer 2: StewardMD engines]  MEDCALC.run, SMD_DOSECALC, ICD index, INTERACTIONS,
                               ABG_STORE, ICU review, Rx pad (draft)
        |
        v
 [Confirm card]  "Using MEDCALC.run(crcl): CrCl 38 mL/min. Open / Edit / Dismiss"
        |
        v  (only if the doctor asks "why?")
 [Layer 3: MaiK]  explanation with retrieved evidence and claim grounding
```

### New pieces (all behind flag `smd_edge`, default OFF)
| File | Job |
|---|---|
| `local-plugins/capacitor-needle/` | Native bridge. Android: JNI, Needle linked statically into a uniquely named `.so`. iOS: xcframework. Weights downloaded to Filesystem with a pinned sha256, reusing the Llama plugin's downloader. |
| `edge-runtime.js` | One queue for all calls (the engine is single-threaded); reset between patients; output limits; drops stale jobs; status. Readiness does **not** depend on `localReady()`. |
| `edge-schemas.js` | Small versioned tool lists, generated from `MEDCALC._calcs` and the other engine catalogs. |
| `edge-candidates.js` | Picks the 3 to 5 likely tools per request using existing word matching. Uses a fixed bank of tool groups (renal, sepsis, cardiac, liver, OPD, ICU) so the engine rarely reloads. |
| `edge-router.js` | Plugs into `maik-engine.js route()` before the engine choice, like `doseAnswer()` does today. |
| `edge-grounding.js` | All validators in section 2 (S2, S5, S6) plus units and ranges. |
| `window.SMD_EDGE` | `route(text)`, `extract(text, schema)`, `available()`, `load()`, `release()` |

---

## 5. Which model does what

| Model | Size | Strength | Weakness | Use for |
|---|---|---|---|---|
| **Needle 3** | 35 MB | Tiny, fast, watch build, calibrated confidence | English only, 256-token memory, new native engine | Low-RAM phones, watch, instant commands |
| **FunctionGemma 270M** | about 290 MB | Hindi/Telugu letters, 32K memory, runs on our **existing** llama plugin | 8x bigger, no calibrated confidence, Telugu quality unknown | Main phone router if it wins the bake-off |
| Existing regex parsers | 0 MB | Never invent values | Miss phrasings | Always run first |
| GLiNER-biomed (later) | small | Can only point at words in the text, so it cannot invent | New ONNX model, licence check | Long Scribe transcripts |
| IndicXlit (later) | about 11M params | Turns Telugu/Hindi letters into English letters | Words only, not meaning | Mixed-language input for Needle |
| SNOMED CT India (later) | data | Official synonyms, free licence via NRCeS | Licence paperwork | Synonyms, ICD mapping |
| MaiK packs (existing) | 1.1 to 6 GB | Real medical reasoning | Slow, 6 GB RAM | Explanations only |

**Decision method: a bake-off.** Fine-tune both Needle and FunctionGemma on the same data, test on
the same gold set, on the same phones. Pick per device tier. Do not guess.

---

## 6. Training plan

**Principle:** teach the model **StewardMD's buttons**, not medicine. "Doctor wants the CrCl tool
with these numbers", never "what is the treatment of pneumonia".

| Step | What | Detail |
|---|---|---|
| 6.1 | Tool catalog | Export tool schemas from `MEDCALC._calcs` (use `opts` for choices, not `list()` which drops them), dose engine, ICD search, module list, KB topics, ICU fields. Merge duplicates (`meld3`, `meld`, `meld_na`). |
| 6.2 | Synthetic data | A generator writes thousands of examples per tool: Indian clinical shorthand ("creat", "65M", "E2V3M5", "1-0-1", "bd", "after food"), units, typos, voice-style numbers ("one ten by seventy"), negation, tense, family history, off-topic, and "not enough info". |
| 6.3 | Hard negatives | Pairs that look alike but differ: "start" vs "stop", "patient" vs "mother", "mg" vs "mcg", BP vs age numbers, Losec vs Lasix. |
| 6.4 | Real phrasing | Public datasets (section 16) plus, ideally, 150 lines typed by the owner and the 2 reviewing doctors. Hinglish/Tenglish in English letters (Q3). |
| 6.5 | Train | Hosted platform (keeps the confidence score) or a rented GPU (see decision Q4). Never a laptop CPU. |
| 6.6 | Sizes | Needle can be cut to 4, 8, 12 or 20 layers. Train once, test each size on each phone tier. |

---

## 7. Testing plan (the gate everything must pass)

### 7.1 Test sets (kept separate from training data, never trained on)
| Set | Size | Content |
|---|---|---|
| Router gold set | 1,000 | Real-style requests across the 5 starter tools, plus off-topic and ambiguous ("MS") |
| Extraction gold set | 600 | Short sentences with numbers, negation, tense, family history, units |
| Danger set | 200 | Only the traps from 6.3. **Must score 100%.** |
| Senior engineer's 10 acceptance cases | 10 | Kept as a smoke test on every build |
| Baseline | same sets | Today's regex router, to prove Edge actually adds something |

### 7.2 Pass marks
| Measure | Pass mark |
|---|---|
| Wrong-field numbers that get past the validators | **0** |
| Danger set | **100%** |
| Router: right tool, or correctly passed on | at least 95%, and better than baseline by at least 10 points |
| Router: wrong tool shown to the doctor | under 1% |
| Extracted fields correct (precision) | at least 99% after validators |
| Fields found (recall) | at least 85% |
| False refusals of clinical questions | **0** (S4) |
| Warm latency, 4 GB Android, p95 | under 800 ms |
| Extra memory | under 200 MB |
| Doctor review | 3 clinicians review every error on the danger and extraction sets |

### 7.3 Kill switch
If Edge does not beat the regex baseline by at least 10 points, **stop**. Ship the Phase 0
improvements alone. That is a fine outcome.

---

## 8. Phases

| Phase | What | Key files | Exit test | Rough effort |
|---|---|---|---|---|
| **0. No AI yet** | One shared patient-number parser (extend `INSULIN_ASK.parse`: cr/scr/s.cr, yo, 65M, Na, K, urea); `maikCalcFor` opens calculators **prefilled**; fix `maik-brain.js:316` inputs; pick one Cockcroft-Gault; expose grammar decoding in `capacitor-llama`; build the test sets and baseline. Fix the bugs in section 13. | `insulin-ask.js`, `home.js`, `maik-brain.js`, `calculators.js`, `local-plugins/capacitor-llama` | Baseline numbers recorded; prefill works in headless UI test | 2 weeks |
| **1. Feasibility** | Pin model files and sha256. Link Needle on Android (16 KB pages, arm64). Load FunctionGemma through the existing plugin. Measure load time, memory, latency on 2-3 GB, 4 GB, 6 GB and flagship phones inside the real app. | `capacitor-needle/` | Both load and answer inside the app on all tiers, or we know which tiers fail | 1 to 2 weeks |
| **2. Train and bake-off** | Generate data, fine-tune both models, score both on the gold sets. | data generator, eval scripts | One model passes section 7.2, or we stop (7.3) | 2 weeks |
| **3. Router pilot** | `edge-runtime.js`, `edge-router.js`, `edge-grounding.js`; 5 read-only tools; flag `smd_edge` OFF by default; owner and 3 to 5 doctors test it. | as above | Pass marks hold on real phones; no wrong-tool reports in 2 weeks of use | 2 weeks |
| **4. Prefill + ICU dictation** | Calculator prefill from Edge; ICU dictation to `reviewVoice()`; dose request to `SMD_DOSECALC` prefill. | `icu.js`, `dose-calc.js` | Danger set 100%; doctors confirm values match | 2 weeks |
| **5. Scribe fact log (English)** | Per-chunk facts with source quote, chunk id, speaker, time; correction events; rules map facts to EMR fields; MaiK stays for prose. | `voice-ambient.js`, `opd-emr.js` | Fewer cloud refines, zero unsupported fields accepted | 3 weeks |
| **6. Show-off features** | Answer-as-you-type, Live Score Radar, Silent Safety Net, Code Blue voice (watch), say-it logbook. | per feature | Each passes its own danger set | ongoing |
| **7. Languages** | Hindi/Telugu via FunctionGemma or IndicXlit + romanised training. | `voice.js` | Separate gold set per language | later |

Effort assumes the owner plus Claude sessions. Estimates, not promises.

---

## 9. Phone budget

| Tier | Plan |
|---|---|
| 2 to 3 GB Android | Out of v1 (Q7). Later: Needle cut to 4 to 8 layers, router only. |
| 4 GB Android | Needle full, router + prefill + ICU dictation. **Main new market.** |
| 6 GB+ Android, iPhone | Bake-off winner; MaiK packs also available. |
| Apple Watch | Needle only, Code Blue voice log (later). |

Rules: run rules first; one Edge job at a time; never run Whisper, Edge and a MaiK pack heavily at
the same time on weak phones; back off on heat and low memory (reuse the llama thermal governor
pattern).

---

## 10. Release and rollback

1. Every phase: git tag before merge, flag default OFF, owner approval to flip.
2. Native plugin needs a store release; JS ships over OTA and is held back with `minNativeBuild`
   from builds that lack the plugin.
3. Model files: downloaded on demand (never bundled), sha256 pinned, stored in Filesystem, with a
   "delete model" button in AI settings next to the MaiK packs.
4. Kill switch per feature via remote config.

## 11. What we watch after release (no patient text ever leaves the phone)

Counts only: requests handled by Edge, passed on, confirmed, edited, dismissed; latency; memory;
crashes. A rising "edited" rate on any field is an alarm. Feed counts into the existing AI Control
Center.

## 12. Risks

| Risk | Plan |
|---|---|
| Fine-tuned model still not good enough | Kill switch (7.3); Phase 0 still delivers value |
| Needle engine is closed-source from a small company | Pin versions; keep FunctionGemma path (open weights, our llama plugin) |
| No cancel in Needle's engine | Small output limits; drop stale jobs; separate Android process if needed |
| Doctors trust the card too much (automation bias) | Show the source words under every value; values never pre-accepted |
| Regulators (CDSCO SaMD) | Edge only fills inputs for existing, documented engines; keep the hazard log (section 2) and test reports |
| Licences | Same rule as OpenMed: unverified licence, model does not load |

## 13. Fix now (found during the review, no AI needed)

| Bug | Where |
|---|---|
| Scribe always marks speech as the doctor's, so a patient saying "my BP was 150/90" can fill vitals | `opd-emr.js:4292` |
| "Fast" speech fallback does not force on-device recognition, so audio may leave the phone | `local-plugins/capacitor-community-speech-recognition` iOS + Android |
| Telugu/Hindi source quotes are stripped, so Scribe grounding never runs for those consults | `functions/api/ai/_opd-scribe.js` `stripIndic` on `sources` |
| Cache API wiped on every native launch; ThoreX/SknX model cache may re-download | `index.html:146-155`, `thorex-model-cache.js` |
| Wear OS bridge plugin not registered | `android/.../MainActivity.java` (WearBridgePlugin) |
| Dictated prescriptions never become structured rows; `parseVoiceRx` takes the first number as dose | `opd-emr.js stageScribeRx`, `prescription.js:2434` |

## 14. Owner decisions (2026-10-01)

| # | Question | Decision | What it changes |
|---|---|---|---|
| Q1 | First goal | **A working product now** | Phase 0 (no AI) ships to doctors in week 2; AI router follows in week 4 to 6 |
| Q2 | Model | **Bake-off: Needle vs FunctionGemma** | Both trained on the same data, scored on the same gold sets and phones |
| Q3 | Languages v1 | **English + Hinglish/Tenglish typed in English letters** | Both models can read Latin letters. Native Telugu/Hindi script stays out of v1 |
| Q4 | Training | **Both**: Cactus platform for Needle (synthetic data only, keeps the confidence score); rented GPU for FunctionGemma | Two training pipelines, one shared dataset |
| Q5 | Real phrasing | **Public internet datasets** (section 16) | No consent collection needed; licences must be checked; gap noted below |
| Q6 | Safety review | **Owner + 2 other doctors** | Every danger-set error reviewed by three clinicians before release |
| Q7 | Phones | **Android 4 GB and up** (+ Pixel 9 and iPhone for testing) | 2 to 3 GB phones are out of v1 |
| Q8 | Timeline | **4 to 6 weeks** to a small group of doctors | Week plan in section 15 |

**Gap to know about (Q5):** public datasets contain notes and doctor-patient conversations, not
"doctor talking to an app". They are good for extraction tests and realistic shorthand, but the
router gold set will still be mostly synthetic. Recommendation: the owner and the 2 reviewing doctors
each type 50 requests the way they really would (no patient data). That is 150 real lines and costs
about 30 minutes each.

## 15. Week-by-week (4 to 6 weeks)

| Week | Ship / build | Done when |
|---|---|---|
| **1** | Phase 0 code: shared patient-number parser, calculators open prefilled from MaiK and search, `maik-brain.js:316` inputs fixed. Fix the two privacy/safety bugs first (speaker gate `opd-emr.js:4292`, on-device speech recognition). Feasibility: link `libneedle.a` in a test Android build; load FunctionGemma through `capacitor-llama`. Start the data pipeline. | Headless UI tests pass; both models answer one request inside the app on the 4 GB phone |
| **2** | **Release Phase 0 to doctors** (flag on, git tag). Data generator + public datasets turned into gold sets. First training runs of both models. Expose grammar decoding in `capacitor-llama`. | Phase 0 live; gold sets frozen; both models trained once |
| **3** | Bake-off: score both models on the gold sets and on the 4 GB phone, Pixel 9, iPhone. Pick the winner per tier. Build `edge-runtime.js`, `edge-router.js`, `edge-grounding.js`. | One model passes section 7.2, or we stop and keep Phase 0 |
| **4** | Router pilot (5 read-only tools) behind `smd_edge`, owner + 2 doctors only. Danger-set review by the three doctors. | Zero wrong-field values, zero false refusals, 100% danger set |
| **5** | Fix pilot findings. Add calculator prefill via Edge and ICU dictation to `reviewVoice()`. Hinglish/Tenglish test set run. | Same pass marks hold, including Hinglish/Tenglish |
| **6** | Release to a small invited group of doctors. Decide the next step: Scribe fact log or show-off features. | Counts in AI Control Center look healthy for 1 week |

If week 3 fails the gate, weeks 4 to 6 become more Phase 0 work (search, prefill, parser coverage),
which still helps every user.

## 16. Datasets (checked, licences noted)

| Dataset | What it is | Licence | Use |
|---|---|---|---|
| ACI-Bench | 207 role-played doctor-patient visits with notes | CC BY 4.0 | Extraction gold set, Scribe fact tests |
| PriMock57 | 57 mock primary-care consults: audio, transcripts, notes | CC BY 4.0 | Scribe tests, Whisper-to-facts tests |
| MTSamples | About 5,000 sample transcription reports | Listed CC0 on Kaggle; scraped from mtsamples.com, so check the site's own terms before training | Clinical shorthand and phrasing |
| MMCQS (IIT Patna, MedSumm) | 3,015 Hinglish code-mixed medical queries | CC BY 4.0 | Hinglish test set |
| L3Cube-HingCorpus | 52M Hinglish sentences (Twitter) | check before use | Hinglish word patterns only, not medical |
| Telugu medical words | No good public set found | n/a | Owner writes a romanised list ("jvaram", "daggu", "noppi", "vanthulu") |
| **MIMIC / n2c2 / PhysioNet** | Real hospital notes | Credentialed licence | **Do not use for this.** The licence forbids sending data to third parties, so it can never go to the Cactus platform |

Attribution for CC BY data goes in `licenses/`.

## 17. Words, simply

| Word | Means |
|---|---|
| Edge AI | AI that runs on the phone, no internet |
| Router | Decides which StewardMD tool should handle a request |
| Fine-tune | Extra training on our own examples |
| Gold set | Test questions with known right answers, never used for training |
| Validator | A plain rule that checks the AI's answer |
| Flag | An on/off switch in the app |
| Bake-off | Two options tested side by side, best one wins |
| Hallucination | The AI making up a value that was never said |
