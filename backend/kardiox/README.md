# KardioX AI — Pipeline Backend

Production **scaffold** for the KardioX ECG-interpretation pipeline. The full architecture is real
(routing, versioning, DI, R2, streaming, auth, structured logging, OpenAPI, orchestration, error
contract); the per-stage **ECG models are the only pending piece** — each service raises a typed
`StageNotImplemented` behind a stable interface. A **`mock` mode** returns the canonical result so the
iOS app connects end-to-end the moment this is deployed.

> Decision support + education, **NOT a diagnostic device.** Every report carries the mandated
> disclaimer; clinical content + models require clinician sign-off and validation before any release.

## Architecture

```
iOS app ──HTTPS──▶ Cloudflare edge Worker ──▶ R2 (ephemeral upload)
 (RemoteAnalyzer)   functions/api/kardiox/         │
                       │  put uploads/<sid>         │ read by sessionId
                       ▼                            ▼
                    FastAPI pipeline ── OpenCV ▸ Digitize ▸ WFDB ▸ TorchECG ▸ NeuroKit2 ▸ RuleEngine ▸ Gemini
                       │  (13 stages, provider seam)
                       ▼
                    ECGAnalysis JSON  ──▶ edge DELETEs R2 object ──▶ app (encrypts + stores locally)
```

- **Edge Worker** (Cloudflare Pages Function, same origin as the app): auth, ephemeral R2 put, calls the
  pipeline by `sessionId`, deletes the R2 object immediately, returns the contract JSON. Zero retention.
- **FastAPI pipeline**: versioned `/v1`, provider-based 13-stage orchestrator, SSE progress, OpenAPI.
- **Provider seam**: swap a real model in by flipping one env var — routes + iOS never change.

## Folder structure

```
backend/kardiox/
├── app/
│   ├── main.py                 # FastAPI factory (OpenAPI, CORS, handlers, /v1 mount)
│   ├── core/                   # config · logging · security(auth) · errors(contract) · versioning
│   ├── api/
│   │   ├── deps.py             # DI (settings, providers, R2)
│   │   └── v1/                 # router · health · analyze (POST + SSE stream)
│   ├── models/                 # ecg.py (ECGAnalysis, 1:1 with iOS) · progress.py
│   ├── services/               # base.py (7 interfaces) + preprocessing/digitization/wfdb_io/
│   │                           #   rhythm/measurement/gemini (NotImplemented) + rules.py (REAL) + registry.py
│   ├── pipeline/               # stages.py (13) · orchestrator.py
│   ├── storage/                # r2.py (S3-compatible ephemeral read/delete)
│   └── mock/                   # sample.py (canonical AF result for mock mode)
├── tests/                      # api + provider tests
├── Dockerfile · docker-compose.yml · Makefile · .github/workflows/ci.yml
├── requirements.txt · requirements-ml.txt · .env.example · .dockerignore
functions/api/kardiox/[[path]].js   # the Cloudflare edge Worker (lives with the StewardMD Pages app)
```

## API contract (v1) — matches the iOS `RemoteAnalyzer`

- `POST /v1/ecg/analyze` — body `{ sessionId, layoutHint?, pages? }`; header `Accept: application/vnd.kardiox.v1+json`, `X-Pipeline-Token`. Returns `ECGAnalysis` JSON (mock mode) or runs the pipeline (live).
- `GET /v1/ecg/analyze/stream?sessionId=…` — Server-Sent Events: `progress` events per stage, then `result`.
- `GET /v1/health` — `{ status, apiVersion, mode, providers:[{stage,name,implemented}], modelsReady }`.
- Errors: `{ "error": { "code", "message", "stage" } }` with codes `bad_image` (400) · `layout_undetected`
  (422) · `rate_limited` (429) · `pipeline_unavailable` (503) · `timeout` (504) · `not_implemented` (501).
- OpenAPI/Swagger at `/docs`, ReDoc at `/redoc`.

## Run locally

```bash
cd backend/kardiox
cp .env.example .env            # KARDIOX_MODE=mock by default
python -m venv .venv && source .venv/bin/activate
make install                    # requirements + pytest/ruff
make dev                        # http://localhost:8000/docs
# or: docker compose up --build
curl -s localhost:8000/v1/health | jq
curl -s -H 'Accept: application/vnd.kardiox.v1+json' \
     -H 'content-type: application/json' \
     -d '{"sessionId":"demo"}' localhost:8000/v1/ecg/analyze | jq
make test
```

## Deploy

**Pipeline (FastAPI):** build the Docker image and run it on any container host (Fly.io, Render, Cloud
Run, ECS, a VM). Set env from `.env.example`; expose `/v1`. For GPU inference later, split an `api` +
`worker` behind a queue (see `docker-compose.yml` note) — the provider seam already isolates that.

**Edge Worker:** `functions/api/kardiox/[[path]].js` deploys automatically with the StewardMD Cloudflare
Pages project. In the Pages project settings add:
- R2 bucket binding **`KARDIOX_R2`** (create an `kardiox-ephemeral` bucket; set a lifecycle rule to auto-expire objects as a backstop).
- env vars **`KARDIOX_PIPELINE_URL`** (the FastAPI base URL) and **`KARDIOX_PIPELINE_TOKEN`** (shared secret, also set as `KARDIOX_PIPELINE_TOKEN` on the pipeline).
- give the pipeline an R2 **S3 API token** (`KARDIOX_R2_*`) so it can read the upload.

**Activate real analysis:** set `KARDIOX_MODE=live` and flip provider env vars (`KARDIOX_PROVIDER_RHYTHM=torchecg`, etc.) as each model is implemented + validated.

**Connect the iOS app:** point `SMD_KARDIOX_PROVIDERS` at `liveProviders` (RemoteAnalyzer, baseUrl
`/api/kardiox`) — no other frontend change. The existing `RemoteAnalyzer` already speaks this contract.

## Phase 5 — pipeline implementation status

See `docs/RESEARCH.md` for the OSS survey, licenses, and the real-vs-model boundary per stage.

1. IMPLEMENTED **Preprocessing (OpenCV)** — decode/crop/perspective/deskew/color-gridline-removal/glare/
   CLAHE/adaptive-threshold/speckle + lead-region detection (`OpenCVPreprocessing.enhance`). Classical CV.
2. IMPLEMENTED **Digitization** — `ClassicalDigitization`: 3x4 layout → per-column ink centre-line +
   calibration. Real baseline; a learned digitizer (PhysioNet `ecg-image-kit`) drops into the same seam.
3. IMPLEMENTED **Signal extraction (WFDB/NumPy)** — calibrated px→mV/ms resample (`WfdbSignal.to_signal`).
4. IMPLEMENTED/BOUNDARY **Rhythm** — `DeterministicRhythm` (real, model-free rate/regularity/P-wave; NO
   diagnosis) done. `TorchECGRhythm` is real integration that loads a checkpoint — **ships no weights**
   (needs PTB-XL/MIT-BIH training + GPU + validation; raises pipeline_unavailable without a checkpoint).
5. IMPLEMENTED **Measurement + ST (NeuroKit2)** — delineation, HR/PR/QRS/QT/QTc, axis, per-lead voltages,
   J-point ST + territory (`NeuroKitMeasurement.*`).
6. IMPLEMENTED **Morphology + Rule Engine (5E/5F)** — deterministic morphology diagnoses (AV block, BBB,
   LVH/RVH, axis, QTc, ST elevation/depression, WPW, Brugada, hyperkalemia) on measured features; each
   carries criteria, confidence, differentials, and what-to-verify (`rules.morphology_diagnoses`).
7. IMPLEMENTED **Gemini explanation** — constrained to validated findings, server-side disclaimer,
   NON-blocking (`GeminiExplainer.explain`). Activate with KARDIOX_PROVIDER_GEMINI=gemini + a key.

**Providers are real code but implemented=False** (a validation gate, surfaced by /v1/health modelsReady)
— flip True only after clinical validation. Default provider env is `none`; opt each stage in as validated.
Activate the full real pipeline:
```
KARDIOX_MODE=live KARDIOX_PROVIDER_PREPROCESSING=opencv KARDIOX_PROVIDER_DIGITIZATION=classical \
KARDIOX_PROVIDER_WFDB=wfdb KARDIOX_PROVIDER_RHYTHM=deterministic KARDIOX_PROVIDER_MEASUREMENT=neurokit2 \
KARDIOX_PROVIDER_GEMINI=gemini
```

### Still required (externally gated)
- **Trained rhythm/beat/morphology model** (TorchECG checkpoint) + **learned digitizer** for production
  accuracy — datasets, GPU, training.
- **Quality gate** provider that scores usability and routes poor images to bad_image.
- **Clinical validation** vs annotated references (PTB-XL), **clinician sign-off** of the RuleEngine +
  Learn-ECG content, and an **intended-use / SaMD** review before launch.

## Ops endpoints (Phase 5 backend expansion)
- `GET /metrics` — Prometheus text (analyze/jobs counts, errors by code, in-flight gauge, latency).
  Restrict to the internal network in production.
- `POST /v1/ecg/jobs` → 202 {jobId}; `GET /v1/ecg/jobs/{id}` — optional async fire-and-poll path
  (in-memory store; Redis/RQ is the scale path). The synchronous /v1/ecg/analyze is unchanged.

The rule engine (stage 11) is implemented + tested (`services/rules.py`).
