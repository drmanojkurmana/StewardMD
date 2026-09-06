---
tags: [module, ai, imaging, dermatology]
status: phase3-on-branch (rx flag OFF, R1-gated) · real 59-cond cloud classifier on branch claude/sknx-cloud (PR #631, smd_sknx_cloud def:OFF)
flag: smd_sknx (client, def:false) + v2beta access + smd_sknx_rx (Phase 3, def:false, R1-gated) + smd_sknx_cloud (cloud classifier, def:false, ?sknxcloud=1) · sknx_llm (server FEATURES_ON)
---
# SknX

## 2026-09-06 UI refresh (local branch `codex/sknx-ux-refresh`)

- Capture now leads to a photo review with optional clinical history, then an explicit Analyze action.
- Review preserves history across retries/refinement. Back to review and close invalidate pending UI
  callbacks; they do not abort an already-issued remote inference request. Object URLs are revoked
  when replacing a photo, starting a fresh case, closing, or signing out.
- Results retain the differential-first ordering and existing clinical gates, with report/history
  navigation, readable confidence labels (neutral colour, not severity), larger controls, dark mode,
  keyboard focus management and reduced-motion support.
- Save status reflects a successful local-storage write. A failed write returns null and can be retried.
- `sknx-mark.svg` is the original vector SknX brand mark, used in the module and the home tool tile.
- Verification: `node --test test/sknx-*.test.mjs`; build then `node test/run-sknx-ui.mjs`.
  `SKNX_SHOTS=/tmp/stewardmd-sknx-ux` exports browser screenshots using synthetic test images.

**Historical notes below are out of date for feature defaults:** this checkout's `sknx-flags.js`
defaults module, cloud, Rx and realvision ON with existing owner-waiver comments. This UI refresh
does not change those flags or assert clinical approval. The browser harness explicitly disables
realvision/cloud via query overrides for mock tests. `sknx-store.js` uses localStorage, not encryption.

On-device dermatology (lesion/rash) decision support. ThoreX sibling. Mock-first; educational, clinician-only.
Design spec: `docs/superpowers/specs/2026-08-03-sknx-ai-design.md`. Plans: `docs/superpowers/plans/2026-08-03-sknx-ai-phase1.md`, `...-phase2.md`, `2026-08-04-sknx-ai-phase3.md`.

## Status
- **Phase 1 (foundation): merged** to main (#621), flag `smd_sknx` def:false (enable per device with `?sknx=1`).
- **Phase 2 (evidence RAG + real Gemini report + educational features): MERGED** to main (PR #622), R1+R2 clean. Educational only, no Rx.
- **Phase 3 (clinician-confirmed Rx): built on branch `claude/sknx-phase3`**, flag `smd_sknx_rx` def:false (OFF). `sknx-rx.js` drafts a class-level first-line regimen the clinician confirms/doses/signs in the existing `SMD_RX` pad; malignant/referral cases are never draftable. **The flag must NOT flip on without R1 clinical + R3-DPDP + R7 sign-off.** e2e proves ZERO `.sknx-rx` on a malignant referral even with the flag on + a verified prescriber.
- **Real 59-condition cloud classifier: on branch `claude/sknx-cloud` (PR #631)**, flag `smd_sknx_cloud` def:false. Google **Derm Foundation** embeddings + a **SCIN**-trained head (59 general-derm conditions), served from **Cloud Run** (`sknx-derm`, asia-south1, scale-to-zero). Held-out **top-1 64% / top-3 85% / AUC 0.914**. `sknx-cloudvision.js` POSTs the image, maps the differential to raw (BCC+SCC/SCCIS→lesionProbs→guardrail refers). EXPERIMENTAL, opt-in, **sends the image off-device** (validation-only; needs consent + R1/R3 before non-validation use). **Model + one-command deploy live OUTSIDE the repo: `/Users/diwakarkumar/Developer/sknx-server/` (`bash deploy.sh`)** (deploy is classifier-blocked for the agent; owner runs it). Validation report + console: `models.stewardmd.in/sknx/{validation_report,validate}.html`.

## Key files
- `sknx-flags.js` — flag registry (`smd_sknx`, `smd_sknx_ondevice`, `smd_sknx_cloud` tri, `smd_sknx_haptics`; Phase 3 adds `smd_sknx_rx`).
- `sknx-engines.js` — **THE clinical core**: malignancy/red-flag referral guardrail (`REFER_THRESHOLD 0.15`, case/synonym-robust match, false-negative-averse). `makeAnalysis(raw, entitlement)` → `{differential,lesion,referral,referralReason,rxEligible,disclaimerKey}`. Touch with extreme care (R1).
- `sknx-features.js` (morphometrics) · `sknx-vision.js` (native-plugin bridge + fallback) · `sknx-realvision.js` (WASM ONNX 7-class HAM) · `sknx-cloudvision.js` (**cloud 59-cond Derm Foundation classifier**, `SMD_SKNX_CLOUDVISION`, def-OFF, `?sknxcloud=1`; POSTs image→Cloud Run `/classify`, maps to raw) · `sknx-providers.js` (seam: pickVision cloud > native > WASM > mock; real failure = honest error, never mock) · `sknx-entitlement.js` (free/v1/v2beta) · `sknx-store.js` · `sknx.js` · `sknx-screens.js`/`.css`.
- **Phase 2:** `sknx-evidence.js` (seeded corpus + deterministic retrieve = Vectorize stand-in; citations can't be hallucinated) · `sknx-llm.js` (reasoner `buildReport`→reportPayload, `explainAs`; guidelineSummary/references ONLY from evidence; NO Rx) · `sknx-report.js` (render + Explain-Like + branded PDF via `SMD_NATIVE.sharePdfFromHtml`) · `sknx-compare.js` (curated feature matrix + cited sources) · **`functions/api/sknx/[[path]].js`** (REAL Gemini via `callGemini`, mirrors thorex proxy) + `functions/api/sknx/report-core.mjs` (pure, node-testable core).
- **Phase 3:** `sknx-rx.js` (`SMD_SKNX_RX.eligible`/`draftFor`/`openDraft`; the 5-condition Rx gate + curated `REGIMENS` map + `REFER_ONLY` set). Wires a single `.sknx-rx` "Draft prescription" affordance into `sknx-screens.js` `rxAffordance(a)`; reuses `SMD_RX.open({topic,regimen})` from `prescription.js`.

## Hard invariants (each has a test)
- **NO raw image to the server/LLM** — `report-core.validateReportRequest` rejects image-bearing keys (400) + whitelists to `{analysis,features,evidence,context}`; the LLM gets TEXT only.
- **NO hallucinated citations** — `guidelineSummary`/`references` derive ONLY from the vetted `evidence[]` (reuses `sknx-llm.buildReport` as single source of truth); the LLM writes only the free-text `discussion`.
- **NO Rx in Phase 2** — management/investigations/followup are educational principles; LLM discussion dropped if it looks like an Rx (`looksLikeRx`). Rx is Phase 3, gated.
- **Malignancy → refer, never prescribe** — Phase-1 guardrail; the CDP e2e proves a melanoma mock routes to `.sknx-refer` with ZERO `.sknx-rx`.

## Gotchas
- Load order (index.html): the Phase-2 scripts must load `evidence → llm → report → compare` (report uses the payload shape; evidence before llm).
- `functions/api/sknx/[[path]].js` is ESM-in-.js (Cloudflare) → NOT node-testable; the pure logic lives in `report-core.mjs` so `test/sknx-api.test.mjs` can import it. `sknx_llm` must be registered in `_features.js` (parity with `thorex_llm`) or `requireFeature` 403s when `FEATURES_ON=1`.
- The analysis object may not carry `features`; the report degrades gracefully (`features:{}`), red flags still derive from `referral`/`referralReason`.
- Real vision models (ISIC/HAM10000/DermNet/Fitzpatrick/PAD-UFES) are the ONE asset-dependent piece (weights + native Core ML/TFLite toolchain) — everything else (Gemini reasoning, Vectorize seam) is real/mockable. The cloud classifier (PR #631) now fills the general-derm gap with a real validated 59-condition model.
- **⚠️ MELANOMA GAP (cloud classifier):** the 59 SCIN conditions have NO melanoma class, and `sknx-cloudvision.js` sends `features:{}` (no ABCDE) → the cloud engine CANNOT rule out melanoma. A pigmented/changing/bleeding lesion still needs clinical melanoma assessment. Follow-up: run the on-device HAM engine (has melanoma/BCC/SCC) as a PARALLEL cancer screen alongside the cloud differential. The console + README carry a loud persistent caveat.

Deps: [[ThoreX]] (proxy + PDF pattern) · [[Infra]] (Gemini/Vertex, Vectorize `KB_VECTORIZE`) · [[AI Control Center]] (`sknx_llm` feature) · `SMD_RX` (prescription.js, Phase 3).
