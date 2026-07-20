# KardioX AI — Production Readiness Report (Phase 6G)

Date: 2026-07-21 · Branch: `feat/kardiox-ai` · PR #511 · Flag `smd_kardiox`: **OFF**

**Bottom line:** the *infrastructure* around KardioX is production-quality. The *clinical AI* is **not
ready** — there are no trained/validated ECG models and no clinical validation. KardioX must remain
disabled for end users until the blockers below are closed. This report is deliberately honest: nothing
here claims working AI inference that does not exist.

---

## 1. Completed architecture

**Frontend (flag-gated OFF):** 19-screen KardioX module (capture → explainable report → history/compare →
100-ECG Learn platform → settings/privacy), encrypted on-device store (AES-GCM), API client speaking the
v1 contract, health-gated mock↔RemoteAnalyzer switch. 150 JS tests. Untouched by Phase 6.

**Backend pipeline (`backend/kardiox/`, 43 modules, 88 tests):**
- **Edge Worker** (`functions/api/kardiox/[[path]].js`): same-origin ingress, auth hook, upload
  validation (size/MIME/magic), ephemeral R2 put → FastAPI → **immediate R2 delete** (zero retention),
  security headers.
- **FastAPI app**: versioned `/v1`, OpenAPI/Swagger, CORS, contract error envelope, request/correlation
  IDs, structured JSON logging (PII-free), `/metrics` (Prometheus), `/v1/health` + `/v1/ready`, async
  jobs API, lifespan with startup validation + graceful shutdown.
- **13-stage orchestrator**: per-stage timeout + transient-retry + metrics + tracing + **failure
  isolation** (critical stages surface a clean contract error; optional stages degrade to partial).
- **8 providers behind a uniform capability layer** (version, deps, config validation, timeout/retry
  policy, async health): preprocessing (OpenCV, real), quality gate (OpenCV, real), digitization
  (classical, real), signal extraction (WFDB/NumPy, real), rhythm (deterministic real + TorchECG
  integration seam), measurement (NeuroKit2, real), rule engine (deterministic, real + tested), Gemini
  explanation (real, constrained, non-blocking).
- **Model-integration seam** (`app/services/models`): TorchScript/ONNX/state_dict/TF/ensemble backends,
  hot-swappable by config, never fabricate output.

**Deterministic clinical logic is real:** rate/regularity, intervals (PR/QRS/QT/QTc), axis, ST/territory,
morphology diagnoses (AV block, BBB, LVH/RVH, axis, QTc, ST elevation/depression, WPW, Brugada,
hyperkalemia) — each with criteria, confidence, differentials, and what-to-verify. **No diagnosis bypasses
the Rule Engine; Gemini only explains rule-validated findings.**

---

## 2. Remaining blockers (must close before public release)

| # | Blocker | Owner | Type |
|---|---|---|---|
| B1 | **No trained rhythm/beat/morphology model** — TorchECG integration exists; weights do not. | ML | model |
| B2 | **No learned digitizer** — classical baseline only; limited on real phone photos. | ML | model |
| B3 | **No clinical validation** of the end-to-end pipeline vs annotated references. | Clinical/ML | validation |
| B4 | **No clinician sign-off** of the Rule Engine criteria + 100-ECG Learn content (all review-pending). | Clinical | validation |
| B5 | **No regulatory / intended-use (SaMD) determination.** | Regulatory | governance |
| B6 | **Quality-gate thresholds uncalibrated** against a labelled good/bad photo set. | ML | tuning |
| B7 | **Deployment not executed** — container not built/pushed; R2 binding + env + secrets not set on Pages. | Infra | deploy |
| B8 | **No load/latency benchmarking** on target hardware (see §9). | Infra | perf |

Until B1–B5 are closed, every model-backed provider stays `implemented=False` (→ `/v1/ready` red in live
mode) and `smd_kardiox` stays OFF.

---

## 3. External dependencies

- **Runtime (API image):** fastapi, uvicorn, pydantic(-settings), structlog, httpx, boto3, python-multipart.
- **Vision/signal (ML image, `INSTALL_ML=true`):** numpy, scipy, opencv-python-headless, neurokit2, wfdb.
- **Model serving (separate GPU image):** torch + torch_ecg (or onnxruntime/tensorflow), google-generativeai.
- **Infra:** Cloudflare Pages + R2 (ephemeral bucket), a container host for FastAPI (Fly/Render/Cloud
  Run/ECS/VM), optional GPU host for the model, optional Redis for a distributed rate-limiter/job queue.
- **Licenses:** all permissive (Apache-2.0/BSD/MIT) — see `docs/RESEARCH.md`. Gemini requires a Google API
  key + acceptance of its terms.

---

## 4. Model requirements

- **Rhythm/arrhythmia classifier** (12-lead): sinus/AF/flutter/SVT/VT/paced/other. Input `(1, C, T)` per the
  `signal_tensor` contract; output class probabilities + a label map. Package as TorchScript/ONNX.
- **Beat classifier** (optional): per-beat normal/PVC/PAC/paced.
- **Morphology model** (optional): subtle ischemia/hypertrophy patterns the deterministic rules can't
  capture. Must still feed the Rule Engine — models propose, rules validate.
- **Learned digitizer** (optional but recommended): robust photo → per-lead signal (PhysioNet
  `ecg-image-kit`-trained).
- Every model: documented input/output, a held-out validation report, and a version string.

## 5. Dataset requirements

- **PTB-XL** (21k 12-lead, labelled) — primary training + measurement validation.
- **MIT-BIH Arrhythmia**, **CPSC** — rhythm/beat training.
- **PhysioNet/CinC 2024 ECG-image set** + `ecg-image-kit` synthetic generation — digitizer training/eval.
- A **local labelled good/bad photo set** for quality-gate threshold calibration (B6).
- All open-access via PhysioNet data-use agreements; not redistributed. A held-out test set never seen in
  training is required for the validation report.

## 6. GPU requirements

- **Training:** 1 modern GPU (≥16 GB, e.g. A10/A100/4090) for the rhythm model; hours-to-days depending on
  architecture + dataset. Not needed in-repo.
- **Inference:** CPU is sufficient for a single 12-lead classification at clinic volumes; a small GPU (T4)
  only if batch/throughput demands it. The API image stays CPU/slim; the model runs in a separate
  `worker`/model image (the seam already isolates this).

## 7. Clinical validation requirements

- End-to-end accuracy vs a cardiologist-adjudicated held-out set: report sensitivity/specificity/PPV/NPV +
  confusion matrix per finding; measurement error (bias ± limits of agreement) for HR/PR/QRS/QTc/axis vs
  reference.
- Rule Engine + Learn-ECG content **signed off by a qualified clinician** (all currently review-pending).
- Failure-mode analysis (poor images, atypical layouts, paced/artifact) and a documented safe-fail policy.
- Prospective evaluation before any autonomous use; decision-support framing retained throughout.

## 8. Regulatory considerations

- Likely **Software as a Medical Device (SaMD)** in most jurisdictions (India CDSCO, US FDA, EU MDR). An
  intended-use statement + risk classification must precede any clinical claim.
- Current posture: **decision support + education, NOT a diagnostic device**; disclaimer on every report;
  no autonomous diagnosis; data ephemeral + encrypted; PII-free logs. This posture must be formally
  reviewed, not assumed.
- India DPDP alignment inherited from StewardMD's privacy baseline; confirm for ECG data specifically.

## 9. Performance benchmarks

**Not yet measured** — no load test has been run on target hardware (B8). Honest status: targets + method,
not results.

- **Targets (to validate):** classical pipeline (preprocess→digitize→signal→measure→rules) < ~3 s/ECG on
  a 2-vCPU container; model inference < ~1 s/ECG on CPU; end-to-end p95 < 90 s (the client timeout).
- **Instrumentation is in place:** `/metrics` exposes `kardiox_pipeline_duration_seconds`,
  `kardiox_stage_duration_seconds{stage}`, error/retry counters, in-flight gauge.
- **How to measure:** deploy in `live` with classical providers, replay a labelled image set through
  `POST /v1/ecg/analyze`, scrape `/metrics` (or use k6/locust), record per-stage p50/p95 + error rates.

## 10. Deployment checklist

- [ ] Build API image (`docker build`) and, for classical stages, the ML variant (`--build-arg INSTALL_ML=true`).
- [ ] Deploy FastAPI to a container host; expose `/v1`; set env from `.env.example`.
- [ ] Create the `kardiox-ephemeral` R2 bucket + lifecycle auto-expire backstop.
- [ ] Bind **`KARDIOX_R2`** on the Pages project; set **`KARDIOX_PIPELINE_URL`** + **`KARDIOX_PIPELINE_TOKEN`**
      (same token on the pipeline); give the pipeline an R2 S3 token (`KARDIOX_R2_*`).
- [ ] Set `KARDIOX_ENVIRONMENT=prod` (startup validation enforces token/CORS/R2) + tighten `KARDIOX_CORS_ORIGINS`.
- [ ] Confirm `GET /v1/health` = ok and `GET /v1/ready` behavior (mock→ready; live→red until models load).
- [ ] Point the app's `SMD_KARDIOX_PROVIDERS` at `liveProviders` (RemoteAnalyzer) — no other frontend change.
- [ ] (When models exist) place checkpoints, set `KARDIOX_PROVIDER_*` + `KARDIOX_RHYTHM_MODEL_*`, flip
      provider `implemented=True` **after validation**.
- [ ] Enable `smd_kardiox` for end users **only after B1–B5 close**.

---

## 11. Production readiness score

Scored 0–10 per dimension (honest; infrastructure is strong, clinical readiness is not).

| Dimension | Score | Notes |
|---|---:|---|
| Backend architecture / providers | 9 | Uniform seam, health/version/config, tested |
| Orchestration robustness | 9 | Timeout/retry/isolation/tracing; one provider can't crash it |
| Observability | 9 | IDs, structured logs, `/metrics`, health + readiness |
| Security | 8 | Upload validation, sanitization, headers, rate-limit hook, audit; pen-test pending |
| Deployment tooling | 8 | Multi-stage image, lifespan, probes; **not yet deployed** |
| Model-integration readiness | 9 | Hot-swappable backends + ensemble; documented; no code change to add a model |
| **Trained clinical AI** | **1** | **No validated models exist** |
| **Clinical validation / sign-off** | **1** | **Not started** |
| Regulatory | 2 | Posture defined; formal review not done |
| Performance validation | 3 | Instrumented; not benchmarked |

**Infrastructure readiness: ~8.5/10.**
**Clinical readiness: ~1.5/10.**
**OVERALL: NOT READY for public release.** Blocked on trained + validated models, clinical sign-off, and
regulatory review (B1–B5). The engineering is built so that once those land, going live is a
config + validation exercise — not a rebuild.
