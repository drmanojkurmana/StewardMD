# SknX AI (Dermatology AI) — Design Spec

- **Status:** Approved design, pre-implementation
- **Date:** 2026-08-03
- **Owner:** Diwakar Kurmana (physician-owner)
- **Module flag:** `smd_sknx` (default OFF public / ON private dev), experimental-access gated, `v2beta` = both engines
- **Platform:** native iOS + Android only (Capacitor WebView). No web target.
- **Delivery:** ONE module, ONE project, built in **three phases** (build order, not shipped versions). Each phase lands behind the flag via PRs and is owner-approved; the flag flips public only after Phase 3 + R1 clinical review + validation.

---

## 1. Vision

An AI dermatology assistant inside StewardMD that (a) **educates** clinicians/students with evidence-grounded reasoning and (b) produces a **clinician-confirmed, KB-grounded suggested prescription** for treatable conditions — never autonomous, never patient-facing, and hard-stopped on anything suspicious for malignancy. It mirrors ThoreX/KardioX's on-device + reasoning + report skeleton, adds a richer computer-vision pipeline (native), and grounds every explanation in retrieved medical evidence with citations.

## 2. Core principles

- Clinician decision support, **not** autonomous diagnosis or prescribing.
- Ground every explanation in retrieved evidence; **never hallucinate references** (citation integrity is a test gate).
- Every answer carries confidence + limitations + an explicit safety block.
- Vendor-independent preprocessing; modular, testable units.
- Reuse existing StewardMD infra (Vertex via `kardiox-vertex.js`, drug KB, `SMD_RX`, capture/PHI masking, branded PDF, experimental gating). Do not re-invent.
- Cloudflare-native backend (Functions/Workers, Vectorize, R2). No self-hosted infra (no Qdrant).

## 3. Non-goals / hard safety boundaries

- No autonomous diagnosis: output is an **educational differential**, explicitly "not a confirmed diagnosis; no substitute for exam + histopathology."
- No autonomous prescribing: Rx is an **editable suggestion the clinician must review + confirm** via `SMD_RX`; never auto-sent; never shown to patients.
- **Malignancy / red-flag hard-stop:** if the lesion engine signals suspected melanoma/BCC/SCC (or ABCDE/red-flag rules fire) above a false-negative-averse threshold, the result becomes "Refer — do not prescribe" and the Rx path is suppressed.
- Image + PHI: face/identity masked before analysis; cloud reasoning requires consent (mirrors ThoreX cloud-consent); DPDP-compliant.

## 4. Architecture overview

```
Capture (camera / photo / files)
  -> PHI / face mask
  -> [native plugin] Image-quality gate  --(fail)--> interactive guidance, stop
  -> [native plugin] Lesion detection (bbox, crop, multi-lesion)
  -> [native plugin] Segmentation (mask, morphometrics)
  -> [native plugin] Dual classifiers:
        - General engine (inflammatory/infective) -> differential + confidence
        - Lesion engine  (melanoma/BCC/SCC/nevus/AK) -> risk + REFERRAL guardrail
  -> Clinical feature extraction (morphology from mask + class outputs) + Grad-CAM heatmap
  -> RAG retrieval (Cloudflare Vectorize: our KB + curated derm evidence)
  -> Gemini 2.5 (Vertex) via /api/sknx  [image + classifier + features + evidence -> reasoning]
  -> Educational report (+ Explain-Like / Compare / learning features)
  -> [Rx-eligible + not-suspicious] Clinician-confirmed KB-grounded Rx (SMD_RX)
```

Gemini **never** receives only the raw image — always image + classifier outputs + extracted features + retrieved evidence.

## 5. Components

### 5.1 Native vision plugin — `local-plugins/capacitor-sknx-vision`
- iOS: Core ML (or ONNX-mobile); Android: TFLite/ONNX-mobile. Modeled on `capacitor-fundx-depth` / `capacitor-ecg-digitiser` / `capacitor-vision-ocr`.
- API: `assessQuality(image)`, `detectLesions(image)`, `segment(crop)`, `classify(crop)` → `{ boxes, masks, morphometrics, generalProbs, lesionProbs, heatmap }`.
- Models downloaded natively (no CapacitorHttp/WASM limits) and cached on device; verified by sha256.

### 5.2 JS module (mirrors ThoreX file family)
`sknx.js` (entry + home tile + `isOn`), `sknx-screens.js` / `sknx-screens.css` (capture, processing, report UI), `sknx-vision.js` (plugin bridge + graceful web/dev fallback), `sknx-engines.js` (dual-classifier logic, thresholds, ABCDE/red-flag rules, referral guardrail), `sknx-features.js` (morphometrics → structured findings), `sknx-rag.js` (Vectorize retrieval + rerank client), `sknx-llm.js` (Gemini/Vertex reasoning contract), `sknx-report.js` (educational report + branded PDF, reuse ThoreX report pattern), `sknx-rx.js` (KB-grounded Rx + `SMD_RX` handoff), `sknx-entitlement.js` (free/v1/v2beta resolver, clone of `thorex-entitlement.js`), `sknx-flags.js` (flag registry, clone of `thorex-flags.js`), `sknx-store.js` (local history).

### 5.3 Server (Cloudflare)
- `functions/api/sknx/[[path]].js` — Gemini/Vertex proxy (reuse the `kardiox-vertex.js` credential path), RAG retrieval endpoint, citation enforcement, `_usage`/`_aibudget` metering, PHI-safe logging. Client only ever calls `/api/sknx`.
- **Vectorize** index for the derm evidence corpus; embeddings via Workers AI / BGE-M3; rerank.

### 5.4 Infra
- **R2**: `sknx/` model bucket (quality, detection, segmentation, general classifier, lesion classifier) + labels/manifests + sha256.
- **Vectorize**: `sknx-derm` index seeded from our 5,000-disease KB (derm subset) + curated AAD/BAD/NICE/WHO/CDC/DermNet summaries.
- **Vertex**: Gemini 2.5 Flash/Pro via Worker secrets (reuse existing setup).

## 6. Models (source + convert + host)

Public, license-checked, converted to Core ML/ONNX; **experimental-grade, uncalibrated** (labeled like ThoreX %):
- Quality gate: FastViT / MobileNetV4-class.
- Detection: YOLOv11 (lesion/mole/plaque/ulcer/rash/vesicle/nodule).
- Segmentation: MobileSAM / EdgeSAM (mobile-viable SAM; **not** full SAM2 on-device).
- General classifier: DermNet / Fitzpatrick17k / PAD-UFES-derived.
- Lesion classifier: ISIC / HAM10000 / Derm7pt-derived.

Preprocessing parity documented per model (a `scripts/sknx/export_*.md` note per ThoreX's `export_*.py` pattern). Thresholds tuned false-negative-averse for the lesion/malignancy path.

## 7. Clinical safety model

- Every report: educational-support disclaimer + "not a confirmed diagnosis / no substitute for exam + histopathology / consider history + physical / seek specialist when appropriate."
- Malignancy/red-flag → hard referral, Rx suppressed (golden regression case: a melanoma image MUST route to referral).
- Rx = KB-grounded suggestion, editable, clinician-confirmed via `SMD_RX`, never auto-sent, never patient-facing; doses/cautions/interactions pulled from the drug KB + interaction checker.
- Governance: **R1 clinical-safety review mandatory + blocking**; R3 security/DPDP for PHI/image/consent; R2 AI-safety for the prompt/grounding. Flag flips public only after all clear + validation.

## 8. The three phases (single project, build order)

### Phase 1 — On-device vision pipeline ("the eyes")
Native `capacitor-sknx-vision` plugin (quality + detection + segmentation + dual classifiers) + model sourcing/conversion/hosting (R2) + capture UX + PHI/face mask + quality gate + feature extraction + Grad-CAM heatmap + module scaffold (`sknx.js`, screens, engines, features, vision bridge, flags, entitlement, store) + gating + home tile. **Exit:** on-device structured findings + differential + heatmap (pre-reasoning), behind the flag.

### Phase 2 — Evidence reasoning & educational report ("the brain")
Cloudflare Vectorize index (KB + curated derm evidence) + `functions/api/sknx` Gemini/Vertex proxy + `sknx-rag.js` / `sknx-llm.js` / `sknx-report.js` + full educational report (all sections, cited, no-hallucinated-ref guard) + Explain-Like + Compare-Diseases + learning features (MCQ/OSCE/flashcards) + Explain-Every-Drug (reuse drug KB) + branded PDF. **Exit:** grounded educational report from the Phase-1 pipeline.

### Phase 3 — Clinician-confirmed prescribing & safety hardening ("the hands, carefully")
`sknx-rx.js` KB-grounded suggested Rx → `SMD_RX` confirm flow + malignancy/red-flag guardrails + consent/DPDP + audit + R1/R2/R3 reviews + golden regression (melanoma→referral, no-Rx-on-suspicion) + calibration/validation + flag-flip governance. **Exit:** complete module, owner-approved, ready to flip.

## 9. Testing strategy

- Native plugin: per-platform unit tests (pre/post-processing parity vs a reference tensor, like ThoreX's node harness).
- JS unit (`node --test test/*.test.mjs`): engine thresholds, referral guardrail, feature extraction, Rx grounding, RAG citation integrity, entitlement resolver.
- Headless-browser flow test (capture → result → report → Rx-draft), per repo convention.
- Golden/regression: melanoma image → referral (false-negative guard); benign inflammatory → correct differential + Rx-eligible; no-hallucinated-reference assertion on report output.

## 10. Risks & open items

- **Model accuracy** on real phone photos is experimental-grade (esp. general derm) → framed educational/uncalibrated until validated; Rx gated behind that framing.
- **Model sourcing/licensing** (ISIC/HAM10000/DermNet/Fitzpatrick/PAD-UFES + YOLO/SAM/quality weights) — the long pole; each license verified before shipping.
- **Prescribing risk surface** — the reason Phase 3 is last and R1-gated; prescribing on an unvalidated classifier is the core hazard, mitigated by the malignancy hard-stop + clinician confirmation + KB grounding.
- **Native plugin cost** — Swift + Kotlin, per-platform; reuses the existing local-plugins pattern + `cap sync` gotchas (node_modules before sync; verify plugin count).
- **New infra** — Vectorize index + Vertex creds + R2 bucket must be provisioned (fail-closed if absent).

## 11. Out of scope

- Web/PWA target (native only).
- Autonomous diagnosis or prescribing; patient-facing output.
- Teledermatology / storing patient-identifiable images beyond the analysis session.

---

## Delivery status (2026-08-04)
- **Phase 1 (foundation):** merged (PR #621). Flag `smd_sknx` def:false.
- **Phase 2 (evidence RAG + real Gemini educational report + Explain-Like + Compare):** MERGED (PR #622). R2 (AI-safety) + R1 (clinical) APPROVED; three hard invariants tested (no image/PHI to LLM, no hallucinated citations, no Rx); referral guardrail INTACT. 75 unit + 19 CDP e2e green.
- **Phase 3 (clinician-confirmed Rx):** built on branch `claude/sknx-phase3`, flag `smd_sknx_rx` def:false (OFF). `sknx-rx.js` drafts a class-level first-line regimen the clinician confirms/doses/signs via the existing `SMD_RX` pad; malignant/referral cases are never draftable. **The flag must NOT flip on without R1 clinical + R3-DPDP + R7 sign-off.** 82 unit + 23 e2e green.
- **Asset-dependent (not code):** the real vision models (ISIC/HAM10000/DermNet/Fitzpatrick/PAD-UFES) need weights + a native Core ML/TFLite toolchain. Everything else (Gemini reasoning, Vectorize RAG seam) is real or mock-swappable.
