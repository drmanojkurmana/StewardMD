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

## Remaining work for REAL ECG interpretation

1. **Preprocessing (OpenCV)** — deskew/crop, CLAHE, glare + gridline removal → `OpenCVPreprocessing.enhance`.
2. **Digitization (OpenCV)** — detect the 12-lead panel, extract ink centre-lines, read calibration → `OpenCVDigitization.digitize`.
3. **Signal extraction (WFDB/NumPy)** — px→mV/ms → `WfdbSignal.to_signal`.
4. **Rhythm / beats / morphology (TorchECG)** — train/adapt models → `TorchECGRhythm.*` (needs labelled datasets, e.g. PhysioNet, + GPU serving).
5. **Measurement + ST (NeuroKit2)** — delineation, intervals, axis, J-point ST → `NeuroKitMeasurement.*`.
6. **Gemini explanation** — constrained prompt, server-side key → `GeminiExplainer.explain`.
7. **Quality gate** — add a provider that scores usability and routes poor images to `bad_image`.
8. **Validation + regulatory** — clinical validation of the end-to-end pipeline, clinician sign-off of
   the RuleEngine + Learn-ECG content, and an intended-use/SaMD review before any clinical launch.

The rule engine (stage 11) is already implemented and tested (`services/rules.py`).
