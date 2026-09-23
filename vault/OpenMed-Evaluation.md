---
tags: [research, ai, privacy]
status: evaluated 2026-09-23
---
# OpenMed evaluation (2026-09-23)

OpenMed (github.com/maziyarpanahi/openmed, site openmed.life, code Apache-2.0) is a local-first
clinical NLP stack: token-classification models for PII/PHI de-identification and biomedical NER,
plus Python/Swift/Kotlin/JS runtimes. Evaluated for StewardMD on the owner's request.

## Sources actually read
- The OpenMed repo at commit `4213739cc49fb7aac6e2f32fdab73622e323e6cb` (shallow clone), including
  `docs/` (the source of openmed.life) and `models.jsonl`, the committed catalog of every checkpoint.
- The `openmed` npm package 2.5.0 and the PyPI wheel 2.5.0 (both declare Apache-2.0).
- NOT read: openmed.life itself and huggingface.co. Both were blocked by the session's network policy,
  so no model card or weight file was opened and no checkpoint was downloaded or run.

## Catalog, by licence
2,266 catalog rows. Declared licence in `models.jsonl`: **2,255 apache-2.0**, 4 MIT
(`maple-preview-*`), 4 "other" (`laneformer-2b-it-q4-mlx`, `privacy-filter-nemotron-v2` and its two
MLX builds), 3 with no licence (`Ministral-3B-Medical-v1`, `Qwen2.5-VL-3B-Medical-v1`,
`Qwen3.5-2B-Medical-v1`). The 11 non-Apache rows are excluded outright.

Apache-2.0 rows by family: NER 1,093 (13 specialisations x ~83 size/backbone variants: Anatomy,
Chemical, Pharma, Disease, Pathology, Oncology, BloodCancer, DNA, Genome, Genomic, Protein, Organism,
Species, plus one ClinicalNER-SuperClinical-434M); PII 1,018 (English plus 32 languages, including
102 Hindi and 102 Telugu rows); ZeroShot/GLiNER 143 (**no ONNX build**, PyTorch/MLX only). Sizes run
33M to 600M parameters. `-onnx-android` builds exist for most NER/PII variants.

**Licence verification status.** "apache-2.0" above is the licence OpenMed's own catalog declares for
each checkpoint. The Hugging Face model card of each checkpoint has NOT been checked (network), and
the PII models are trained on `nvidia/Nemotron-PII` (dataset licence not checked either). Per the
owner's rule, **no OpenMed weights are bundled or downloaded by the app** until both are verified.

## What OpenMed cannot do here
- It does not answer, reason, summarise or draft. Every model is a token tagger. It **does not
  replace or offload** MaiK Cloud, MedGemma (MxCore/Neural), Bonsai or MaiK Lite.
- The 1.7B to 4B on-device models currently do only answering; no extraction job runs on them that a
  tagger could take over. Real savings are limited to replacing regex heuristics, not LLM work.
- NER families are trained on biomedical literature corpora (PubMed-style), not Indian bedside notes
  or prescriptions. Recall on "T. PCM 650 1-0-1" style text is unknown.

## Recommendations
Runtime for any model below: the vendored `vendor/onnxruntime-web` 1.20.1 WASM that ThoreX and
KardiQ X already use (single-threaded: `capacitor://` is not cross-origin isolated). Device figures
are OpenMed's "Tiny" tier targets (<= 350 MB RAM, <= 60/150 ms p50/p95 per page), not measured on our
phones; single-threaded WASM will be slower.

| Verdict | Model | Task | StewardMD integration point | Benefit | Size | Device impact | Licence |
|---|---|---|---|---|---|---|---|
| **INTEGRATE NOW (done)** | OpenMed `india_health_id` policy (rules, not a model) | ABHA Address, UPI, PAN, masked Aadhaar, Indic-digit IDs, Indian ID labels | `phi-india.js`, called at the end of `reasoning.js` `redactPHI()` (AI Vision OCR text, ICU photo question) | Closes real leaks: `name@abdm` and UPI IDs passed the old email rule; Devanagari/Telugu digit Aadhaar passed the digit rule | ~5 KB JS | None | Code Apache-2.0 (repo LICENSE); own ES5 implementation, attribution in `licenses/openmed-apache-2.0.txt` |
| **BENCHMARK FIRST** | `OpenMed-PII-ClinicalE5-Small-33M-v1-onnx-android` | English PII spans (unlabelled names, addresses) | Second pass inside `redactPHI()`; later the scribe transcript before `SMD_AI.extract(...,"opd-scribe")` in `opd-emr.js` `doRefine` | Regex only catches labelled names ("Name: ..."); a free-text name in OCR or dictation reaches the cloud today | 33M; INT8 ~70 MB (OpenMed npm README) | Download once; OpenMed Tiny-tier target <= 350 MB RAM, unmeasured on our phones; unload after use | Catalog: apache-2.0; HF card and Nemotron-PII dataset licence unverified |
| **BENCHMARK FIRST** | `OpenMed-PII-Hindi-ClinicalE5-Small-33M-v1-onnx-android`, `...-Telugu-ClinicalE5-Small-33M-v1-onnx-android` | Hindi / Telugu PII | Same, routed by `voice-ambient.js` `detectScript` | Scribe's default route is the Telugu specialist; names in Telugu dictation are unprotected | 33M each | As above, one language pack at a time | As above |
| **BENCHMARK FIRST** | `OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android` | English PII (OpenMed's own offline default) | Alternative to ClinicalE5-33M | Possibly higher recall | 44M | DeBERTa-v2 needs a SentencePiece tokenizer in JS (the BERT WordPiece of ClinicalE5 is far simpler) | As above |
| **INTEGRATED (off, fails closed)** | `OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android` | Drug mentions | `openmed-ner.js` `drugNames` -> `maik-local.js` `withNerDrugs` -> `maik-grounding.js` `opts.drugs` | Closes a measured gap: an answer swapping aspirin for the reference's paracetamol at the same dose was graded SUPPORTED (aspirin is invisible to `DRUG_SUFFIX`); with tagger names it is removed. Stricter checking only | 65M DistilBERT | Download size unverified; unloaded after 60 s idle; 8 s timeout, then grounding runs as before | Catalog: apache-2.0; HF card unverified, so `licence.verified:false` and no sha256: will not load |
| **INTEGRATED (off, fails closed)** | `OpenMed-NER-DiseaseDetect-TinyMed-65M-v1-onnx-android` | Disease mentions | `openmed-ner.js` `diseases` -> `scribe-icdsug.js` `opts.extract` (from `opd-emr.js` `scribeIcdSuggest`) | A combined diagnosis ("CAP with T2DM and CKD 3") is searched per condition, so each gets an ICD code offered; fewer than two conditions or any failure = the old single query | 65M DistilBERT | As above | As above |
| **DON'T USE** | OncologyDetect, AnatomyDetect, Pathology, BloodCancer | NER | Onco / RadioAnatome | These modules are structured (staging tables, dose engines, ontology), not free text; nothing to tag | 33M+ | n/a | n/a |
| **DON'T USE** | DNA, Genome, Genomic, Protein, Organism, Species | NER | none | No StewardMD text flow needs them | n/a | n/a | n/a |
| **DON'T USE** | Any Large/XLarge (>= 278M) | any | phone | 4 GB RAM tier; competes with MaiK packs for memory | 278M-600M | High | n/a |
| **DON'T USE** | GLiNER ZeroShot (143) | zero-shot NER | none | No ONNX build; MLX is iOS-native only, the app runs in a WebView | n/a | n/a | n/a |
| **DON'T USE** | Qwen3.5-2B/Qwen2.5-VL-3B/Ministral-3B-Medical, laneformer, maple-preview, privacy-filter-nemotron-v2 | generation / PII | none | Not Apache-2.0 (or no licence); generation would duplicate MaiK | n/a | n/a | Excluded |
| **DON'T USE (for now)** | any NER for RAG preprocessing | tagging KB passages | `kb/ai/maik-lite-rag.js` | BM25 over a curated KB is deterministic and already grounded claim by claim; tagging adds cost, not accuracy | n/a | n/a | n/a |

## Integration state (2026-09-23, second pass)
`openmed-ner.js` (`window.SMD_OPENMED_NER`) runs both TinyMed-65M packs on the vendored onnxruntime-web
(WordPiece tokenizer read from the checkpoint's own `tokenizer.json`, 510-token windows, BIO/BIOES
decoding, OpenMed's recommended thresholds 0.65 pharma / 0.60 disease). Flags `smd_openmed_pharma` and
`smd_openmed_disease`, DEFAULT OFF. **Fails closed**: a pack loads only when `licence.verified` is true
and every file (`model_int8.onnx`, `tokenizer.json`, `id2label.json`) has a pinned sha256, checked with
WebCrypto after download. Both are empty, so nothing downloads today, flag or no flag.
Tests: `test/openmed-ner.test.mjs` (13) and `test/run-openmed-ner-ui.mjs` (real onnxruntime-web 1.20.1
in Chromium, on a lookup-table fixture model with OpenMed's exact I/O contract,
`scripts/openmed/make-ner-fixture.py`). The real checkpoints have NOT been run: accuracy on Indian
notes is unmeasured.

To switch on: verify each HF licence page, record the three sha256s + byte sizes in `openmed-ner.js`
PACKS, set `licence.verified: true`, benchmark on real text, then set the flag.

## Next steps (owner decision)
1. Open huggingface.co in the environment network policy (openmed.life is optional: its content is
   the repo's `docs/`). Verify each shortlisted card's licence and the Nemotron-PII dataset licence.
2. Benchmark ClinicalE5-Small-33M (en, hi, te) on synthetic Indian notes (OpenMed ships Apache-2.0
   fixtures: `eval/golden/fixtures/indic_name_variants.json`, `india_health_ids.json`) and on AI Vision
   OCR text, through our ORT-web on a real iPhone and Android. Gate: zero clinical-value removal.
3. Only then: flag-gated (default OFF) download-on-demand pack, sha256-pinned like the MaiK packs.
