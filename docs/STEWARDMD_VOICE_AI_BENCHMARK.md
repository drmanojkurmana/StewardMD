# StewardMD Voice AI — On-Device ASR Benchmark & Model Selection

**Date:** 2026-08-12 · **Scope:** benchmark pre-trained checkpoints only — **no fine-tuning / no training** (per owner directive). · **Author:** automated research + benchmark harness (`voice-benchmark/`).

**Evidence labels used throughout:** `[MEASURED]` = we ran it · `[PUBLISHED]` = from a cited live source · `[ESTIMATED]` = derived/scaled from published facts · `[UNKNOWN]` = not verifiable, not guessed.

> **Honesty note.** On-device numbers (ANE latency, RAM, RTF on iPhone) are **not `[MEASURED]` in this document** — they require running the shipped `voice-benchmark/` scripts on a GPU VM + a physical iPhone. This report is built on **verified model facts + published WER benchmarks** and a **runnable harness** so the `[MEASURED]` cells get filled for ~$3–6 of spot GPU time. No benchmark number here is fabricated.

---

## 1. Executive recommendation

**Telugu is the gating requirement, and it eliminates most of the field:**

- **Qwen3-ASR 0.6B does NOT support Telugu** (30 langs; Hindi + English yes, Telugu no) `[PUBLISHED: HF Qwen/Qwen3-ASR-0.6B card]`. Without the excluded fine-tune, it **cannot meet the non-negotiable Telugu requirement.**
- **Base Whisper (any size incl. large-v3-turbo) is unusable for Telugu zero-shot** — FLEURS Telugu WER ≈ **150%** with script-hallucination `[PUBLISHED: arXiv 2605.03073]`.
- **IndicConformer supports Telugu but NOT English** (22 Indian langs, English not a target) `[PUBLISHED: HF ai4bharat card]` → it **breaks on English drug names and Telugu-English code-switch**, which is exactly the clinical scenario. Disqualifying for a clinical scribe.
- The ready-made Telugu-capable open checkpoints that are *also* good at English/code-switch are **already-fine-tuned Whisper models** (published checkpoints — using them is a download, not training):
  - `vasista22/whisper-telugu-small` — **Telugu WER 11.59% (FLEURS)**, Apache-2.0, 244M `[PUBLISHED]`
  - `vasista22/whisper-hindi-small` — **Hindi WER 9.02% (FLEURS)**, Apache-2.0, 244M `[PUBLISHED]`
  - `vasista22/whisper-telugu-large-v2` — best open Telugu (single-digit % FLEURS), Apache-2.0 `[PUBLISHED]`

**And these run on the stack StewardMD already ships** — whisper.cpp with the **Core ML encoder on the Apple Neural Engine** (>3× vs CPU) `[PUBLISHED: whisper.cpp README/#548]`. That is a decisive integration + speed advantage: zero new runtime, ANE-accelerated encoder, quantizable to ggml Q5/Q8.

### Recommended tiers (pending `[MEASURED]` confirmation via the harness)

| Tier | Model | Why | Size (ggml) |
|---|---|---|---|
| **FREE — Steward Voice Lite** | Whisper-small **multilingual** (openai), Q5_1 | One 182 MB model covers en/hi/te "acceptably" (te weak but present); smallest honest multilingual floor; MIT | **~182 MB** `[ESTIMATED from published small-q5_1=182MB]` |
| **PRO — Steward Voice Pro** | **Language-routed fine-tuned Whisper-small**: `vasista22/whisper-telugu-small` + `whisper-hindi-small` + base-small(en), Q5_1 each, downloaded per language | Best accuracy/MB with **real Telugu (11.59%) + Hindi (9.02%)**; Apache-2.0; runs on the shipped whisper.cpp/ANE path; Whisper handles English + code-switch (IndicConformer cannot) | **~182 MB per language** loaded (only the needed one on device) |
| **ULTIMATE — Steward Voice Ultra** | **Language-routed**: `vasista22/whisper-telugu-large-v2` (te) + Whisper **large-v3-turbo** Q5_0 (en/hi) | Highest practical accuracy; turbo Q5_0 = **547 MiB confirmed** `[PUBLISHED]`; turbo is unusable for Telugu so Telugu is served by the large-v2 Telugu fine-tune | turbo **547 MiB** + te-large-v2 (~fp16 3 GB / quantize) |

**What StewardMD should actually ship — one answer:** see §11.

---

## 2. Model comparison table

| Model | Params | Langs | Telugu | Hindi | English | Auto-LID | Code-switch | Streaming | Size (fp16) | Quant size | RAM | iOS | Core ML | Neural Engine | License | Medical suitability | Score* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Whisper small (multi)** | 244M | 99 | ✓ but ~unusable zero-shot | ✓ mid | ✓ strong | ✓ (1-window) | weak | pseudo (sliding) | 466 MiB | Q5_1 ~182 MB | ~low | ✓ (shipped) | ✓ encoder | ✓ encoder | MIT | med (en/hi) / low (te) | — |
| **vasista22 whisper-telugu-small** | 244M | te(+en) | **✓ 11.59% FLEURS** `[PUB]` | — | ✓ | via Whisper | ✓ (Whisper) | pseudo | 466 MiB | ~182 MB | ~low | ✓ | ✓ enc | ✓ enc | Apache-2.0 | **high (te clinical)** | — |
| **vasista22 whisper-hindi-small** | 244M | hi(+en) | — | **✓ 9.02% FLEURS** `[PUB]` | ✓ | via Whisper | ✓ | pseudo | 466 MiB | ~182 MB | ~low | ✓ | ✓ enc | ✓ enc | Apache-2.0 | **high (hi clinical)** | — |
| **vasista22 whisper-telugu-large-v2** | 1.5B | te(+en) | **✓ best open (single-digit%)** `[PUB]` | — | ✓ | via Whisper | ✓ | pseudo | ~3 GB | Q5 ~1 GB `[EST]` | higher | ✓ | ✓ enc | ✓ enc | Apache-2.0 | **highest (te)** | — |
| **Whisper large-v3-turbo** | 809M | 99 | ✗ ~150% zero-shot `[PUB]` | ✓ | ✓ strong | ✓ | weak | pseudo | 1.62 GB | **Q5_0 547 MiB** `[PUB]` | mid | ✓ | ✓ enc | ✓ enc | MIT | high (en/hi) / **fail (te)** | — |
| **IndicConformer 120M (te)** | ~120M | te (1/model) | ✓ ~26.8 IndicVoices `[PUB]` | (hi model separate, 15.0) | **✗ none** | ✗ (per-lang) | ✗ | ✗ | .nemo 523 MB | int8 ~doubles WER | UNK | via sherpa-onnx | ✗ demoed | ✗ (CPU) | MIT | **low (no English → breaks clinical CS)** | — |
| **IndicConformer 600M (multi)** | ~600M | 22 Indian | ✓ (IndicVoices te 26.8 sibling) | ✓ 15.0 | **✗ none** | ✗ (needs lang code) | ✗ | ✗ | ~1.3 GB | int8 ~doubles WER | UNK | sherpa-onnx (CPU) | ✗ | ✗ | MIT | **low (no English)** | — |
| **Qwen3-ASR 0.6B** | 0.6B | 30 (hi,en; **no te**) | **✗ not supported** `[PUB]` | ✓ | ✓ 3.35 FLEURS `[PUB]` | ✓ | not claimed | via vLLM only | 1.88 GB | Q4 685 MB `[PUB]` | mid | ✓ (MLX/GPU) | hybrid only | **✗ (MLX=GPU, not ANE)** `[PUB]` | Apache-2.0 | **fails Telugu req** | — |

\* **Score** left blank deliberately — a single number requires the `[MEASURED]` medical-entity + WER runs from the harness (§3). Ranking by the verified facts above is in §1/§11.

---

## 3. Benchmark results (status)

- **Corpus generated `[MEASURED — produced locally]`:** `voice-benchmark/results/medical_corpus.jsonl` — 500 utterances (100 each: en, hi, te, hi-en, te-en) with ground-truth clinical entities, drug vocab from the repo's 1,464-file gold DB. Reproducible (`scripts/build_corpus.py`, seed 20260812).
- **ASR decoding across models `[PENDING]`:** requires the GPU VM run (`voice-benchmark/gcp/` kit). Local box can't (5.9 GB disk, no torch, Python 3.14 wheel gaps). Not fabricated.
- **Public WER used for selection `[PUBLISHED]`:** see §5.

---

## 4. Medical benchmark (harness ready; run to fill `[MEASURED]`)

`scripts/score.py` scores each model's hypothesis against `medical_corpus.jsonl` on: **drug, dose, unit, route, frequency, number, diagnosis, lab** accuracy + overall clinical-entity accuracy (this is the ranking metric — NOT generic WER). All cells `[PENDING]` until the harness runs on the VM. Method is defined + runnable; no numbers invented.

---

## 5. Language benchmark (published, cited)

| Model | English WER | Hindi WER | Telugu WER | Hi-En | Te-En |
|---|---|---|---|---|---|
| Whisper large-v3 (base) | strong `[PUB]` | mid `[PUB]` | **~150% FLEURS** `[PUB arXiv 2605.03073]` | 30–50% rel. worse `[PUB]` | worse (distinct-script ~3× CER) `[PUB]` |
| Whisper large-v3-turbo | strong | ✓ | ~150% (base) `[PUB]` | weak | weak |
| Qwen3-ASR 0.6B | **3.35 FLEURS** `[PUB]` | ✓ (no # published) | **n/a — no Telugu** | UNK | **n/a** |
| **vasista22 whisper-telugu-small** | ✓ | — | **11.59% FLEURS** `[PUB]` | — | via Whisper (measure) |
| **vasista22 whisper-hindi-small** | ✓ | **9.02% FLEURS** `[PUB]` | — | measure | — |
| IndicConformer (IndicVoices) | **none (no English)** | **15.0** `[PUB]` | **26.8** `[PUB arXiv 2403.01926]` | ✗ | ✗ |

CER should be reported alongside WER for te/hi (agglutinative morphology inflates word-WER) `[PUBLISHED]`. Use `whisper_normalizer` Indic normalizer, not the basic one.

---

## 6. Speed benchmark (`[PENDING]` on-device)

Time-to-first-result, RTF, 30s/60s processing, streaming latency: **`[UNKNOWN]` until run on iPhone** via the harness. Only hard published anchor: whisper.cpp Core ML encoder = **>3× vs CPU-only** on Apple Silicon `[PUBLISHED]`; Whisper is 30 s-chunk (pseudo-streaming via sliding window) `[PUBLISHED]`.

---

## 7. Device requirements (verified facts)

- **whisper.cpp iOS:** offline ✓, **encoder on ANE via Core ML** (>3× speedup), decoder on CPU/Metal, XCFramework Swift package, quant fp16/Q8_0/Q5_1/Q5_0/Q4_0 `[PUBLISHED]`. First run slow (ANE compiles model) `[PUBLISHED]`.
- **sherpa-onnx (IndicConformer carrier):** offline ✓ + streaming for zipformer, iOS xcodeproj, **runs on CPU in practice** (CoreML EP silently falls back to CPU on Conformer ops) `[PUBLISHED: ORT #9433/#28022]`. No public IndicConformer-on-iOS demo `[UNKNOWN]`.
- **MLX (Qwen3-ASR):** iOS-capable, **GPU/Metal only, NO ANE** `[PUBLISHED]`; Qwen3-ASR-Swift is macOS-proven, iOS unproven, offline-only today `[PUBLISHED]`.
- **Apple SpeechTranscriber (iOS 26):** offline, ANE-optimized, but **no hi_IN, no te_IN** (en_IN only) `[PUBLISHED]` → unusable for the requirement.

---

## 8. Qwen3-ASR Telugu feasibility (separate — for the record; training is OUT of scope)

**"Can Qwen3-ASR 0.6B be made excellent at Telugu?"** — Technically **yes** (Apache-2.0 open weights, public full-SFT recipe with a `language None` hook for unlisted languages, 151k tokenizer likely already covers Telugu script, abundant CC Telugu data, ~tens-to-low-hundreds USD on 1–2 GPUs) `[PUBLISHED]`. **BUT that is a fine-tune, which the owner excluded.** Out of the box, **Qwen3-ASR has no Telugu → it fails the non-negotiable requirement today.** On iPhone it would be **MLX/GPU (~685 MB Q4), not ANE** `[PUBLISHED]`. **Verdict: not a shippable Telugu candidate without training. Excluded.**

---

## 9. Quantization analysis (published + estimated)

| Model | FP16 | Q8_0 | Q5_1/Q5_0 | Q4_0 | Q3/Q2 | Accuracy loss `[PUB]` |
|---|---|---|---|---|---|---|
| Whisper small | 466 MiB `[PUB]` | ~252 MB `[EST]` | **Q5_1 182 MB** `[PUB]` | ~145 MB `[EST]` | — | Q5_1 <1% WER; Q4_0 2–4% |
| large-v3-turbo | 1.62 GB `[PUB]` | **874 MB** `[PUB]` | **Q5_0 547 MiB** `[PUB]` | 474 MB `[PUB]` | Q3_K 368 / Q2_K 286 `[PUB]` | Q8_0 sweet spot; <Q5_0 "degrades rapidly" |
| Qwen3-ASR 0.6B | 1.88 GB `[PUB]` | — | — | **Q4_K_M 685 MB** `[PUB]` | — | UNK |
| IndicConformer 600M | ~1.3 GB `[EST]` | — | — | int8 | — | **int8 ~doubles WER** `[PUB]` → keep fp16 |

**Rule confirmed:** for Whisper, **Q5_1 (small) / Q5_0–Q8_0 (turbo)** is the max-accuracy-per-MB sweet spot; don't go below Q5 for clinical use. IndicConformer int8 is clinically unusable (WER doubles).

---

## 10. Final architecture (recommended)

```
Microphone (16 kHz mono)
  → VAD (webrtc/silero, on-device)                          # segment speech, drop silence
  → Windowed LID (tiny, only if code-switch routing needed) # VoxLingua107-ECAPA or Whisper LID
  → ASR = whisper.cpp + Core ML encoder (ANE)               # language-routed fine-tuned Whisper checkpoint
  → medical normalization (Indic normalizer + number/unit)  # dose/route/freq canonicalization
  → match against StewardMD gold drug DB (1,464 generics)   # drug-name snap + confidence
  → structured clinical fields (drug/dose/unit/route/freq)
  → DOCTOR CONFIRMATION (mandatory)                          # never auto-write
  → EMR (GHIS) write only after confirm
```

**Why Whisper-family over IndicConformer/Qwen3:** it is the only ready path that (a) has real Telugu (fine-tuned checkpoints), (b) handles English + code-switch (English drug names!), (c) runs on the ANE-accelerated whisper.cpp stack **already in the app**. IndicConformer can't do English; Qwen3 can't do Telugu (without training) and can't use the ANE.

---

## 11. Answers

1. **WINNER — FREE (Lite):** Whisper-small multilingual, Q5_1 (~182 MB) — smallest honest multilingual floor. *(If Telugu quality on the medical set is unacceptable when measured, fall back to shipping the language-routed vasista22 smalls as the floor.)*
2. **WINNER — PRO:** **Language-routed `vasista22/whisper-telugu-small` + `whisper-hindi-small` + Whisper-small(en)**, Q5_1, per-language download (~182 MB each, only the needed one on device). Best accuracy/MB with real Telugu + Hindi, Apache-2.0, ANE-accelerated, already-integrated runtime.
3. **WINNER — ULTIMATE:** **Language-routed** `vasista22/whisper-telugu-large-v2` (te) + Whisper **large-v3-turbo** Q5_0 (547 MiB, en/hi).
4. **BEST TELUGU MODEL:** `vasista22/whisper-telugu-large-v2` (accuracy) / `whisper-telugu-small` (on-device). **11.59% small / single-digit large** `[PUB]`. (IndicConformer 26.8 but no English.)
5. **BEST HINDI MODEL:** `vasista22/whisper-hindi-small` (9.02% FLEURS) or Qwen3-ASR/turbo for pure Hindi.
6. **BEST ENGLISH MODEL:** Qwen3-ASR 0.6B (3.35 FLEURS) or Whisper large-v3-turbo. *(Not the Telugu winner — English-only strength.)*
7. **BEST LANGUAGE DETECTOR:** for one-language utterances, Whisper's built-in LID (free); for **mid-utterance code-switch**, add a windowed **VoxLingua107-ECAPA** classifier `[PUBLISHED]`.
8. **BEST CODE-SWITCHING MODEL:** fine-tuned Whisper (multilingual, transcribes English + Indic in one pass) — IndicConformer/Qwen3 both fail here. Measure hi-en/te-en on the corpus to confirm.
9. **FASTEST MODEL:** smallest quantized Whisper-small on whisper.cpp+ANE (measure RTF on device).
10. **SMALLEST MODEL:** Whisper-small Q4_0 (~145 MB `[EST]`) / Q5_1 (182 MB `[PUB]`).
11. **BEST MEDICAL MODEL:** decided by `score.py` clinical-entity accuracy on the corpus — **run to fill `[MEASURED]`**; strong prior = fine-tuned Whisper-small (Telugu/Hindi) because it keeps English drug names intact.
12. **BEST OVERALL MODEL:** **fine-tuned Whisper-small on whisper.cpp + Core ML/ANE** — the only option that satisfies Telugu + English + code-switch + on-device ANE + already-shipped runtime.

### What should StewardMD actually ship?

> **Ship a Whisper-family, whisper.cpp + Core ML (ANE encoder) voice stack with per-language downloaded checkpoints** — the runtime you already have:
> - **Lite (FREE):** Whisper-small multilingual, Q5_1 (~182 MB).
> - **Pro (PRO):** language-routed **vasista22 Telugu-small + Hindi-small + English-small**, Q5_1 (~182 MB each, one on device at a time).
> - **Ultra (ULTIMATE):** **large-v3-turbo Q5_0** (547 MiB) for en/hi + **vasista22 telugu-large-v2** for te.
>
> **Reject Qwen3-ASR** (no Telugu without training — excluded) and **IndicConformer** (no English → breaks clinical code-switch and English drug names). Confirm the exact tier accuracy with the harness for ~$3–6 of spot GPU before locking the Lite/Pro cut.

---

## 12. Reproducibility

Everything in `voice-benchmark/`: `build_corpus.py` (done), `score.py` (WER/CER + clinical entities), `run_asr.py` (per-runtime adapters), `synth_audio.py` (TTS for the medical set), `gcp/` (one-command spot-VM run). Every benchmark record logs: model, version/commit, quantization, dataset, hardware, runtime, params, model size, command, date. Model weights + audio are git-ignored (LFS/local only).
